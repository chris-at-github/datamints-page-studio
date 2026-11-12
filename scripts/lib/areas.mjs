// Gleiche Bereiche angleichen: überträgt Bereiche aus design/consistency.json (z. B. Header, Footer)
// von einer Quellseite auf andere Seiten des Abzugs.
//  - Ersetzt wird nur das Element selbst (Position aus dem Parser), der Rest der Datei bleibt byte-gleich.
//  - Relative Links im übernommenen Bereich werden an die Ordnertiefe der Zielseite angepasst.
//  - Markierungen aus "ignore" (z. B. aktiver Menüpunkt) bleiben wie auf der Zielseite: entfernt aus der
//    Quelle, wieder gesetzt an Elementen mit demselben Linkziel wie vorher auf der Zielseite.
// Aufruf:
//   node areas.mjs sync <site-dir> <quellseite> [--add <name> <selektor>]
//       alle Bereiche (bzw. nur den neu aufgenommenen) von der Quellseite auf alle anderen Seiten
//   node areas.mjs after-add <site-dir> <seite>...
//       nach pages-add.sh: neue Seiten erhalten Bereiche, bei denen sich die übrigen Seiten einig sind
// Ausgabe: eine JSON-Zeile
import fs from 'node:fs';
import path from 'node:path';
import { readConfig, normalize, resolveLink, sitePages, inScope, loadCheerio, areaError } from './consistency.mjs';

let cheerio;

function readHtml(file) {
  const buf = fs.readFileSync(file);
  const utf8 = buf.toString('utf8');
  if (Buffer.from(utf8, 'utf8').equals(buf)) return { text: utf8, enc: 'utf8' };
  return { text: buf.toString('latin1'), enc: 'latin1' };
}

function markerSets(ignore) {
  return {
    classes: new Set(ignore.filter((x) => x.startsWith('class:')).map((x) => x.slice(6))),
    attrs: new Set(ignore.filter((x) => !x.startsWith('class:')).map((x) => x.replace(/^attr:/, '').toLowerCase())),
  };
}

// Schlüssel eines Elements für Markierungen: Tag + Linkziel (eigenes href oder erster Link darin)
function linkKey($, el, page) {
  const own = $(el).attr('href');
  const href = own !== undefined ? own : $(el).find('a[href]').first().attr('href');
  return href === undefined ? null : `${el.name}|${resolveLink(String(href).trim(), page)}`;
}

const isRelative = (v) => v && !/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(v);

function rebase(v, from, to) {
  if (!isRelative(v)) return v;
  try {
    const u = new URL(v, 'http://modio.local/' + from);
    let rel = path.posix.relative(path.posix.dirname('/' + to), decodeURIComponent(u.pathname));
    if (!rel) rel = path.posix.basename(u.pathname);
    if (u.pathname.endsWith('/') && !rel.endsWith('/')) rel += '/';
    return rel.split('/').map((s) => encodeURIComponent(s).replace(/%40/g, '@')).join('/') + u.search + u.hash;
  } catch { return v; }
}

// Ersetzt den Bereich `selector` in dstHtml durch die Fassung aus srcHtml. Gibt {html} oder {skip: grund} zurück.
export function transplant({ srcHtml, srcPage, dstHtml, dstPage, selector, ignore }) {
  const $s = cheerio.load(srcHtml);
  const sn = $s(selector).first();
  if (!sn.length) return { skip: 'fehlt auf der Quellseite' };
  const $d = cheerio.load(dstHtml, { sourceCodeLocationInfo: true });
  const dn = $d(selector).first();
  if (!dn.length) return { skip: 'fehlt auf der Seite' };
  if (normalize($s, sn[0], ignore, srcPage) === normalize($d, dn[0], ignore, dstPage)) return { skip: 'schon gleich' };
  const loc = dn[0].sourceCodeLocation;
  if (!loc || loc.startOffset == null || loc.endOffset == null) return { skip: 'Position nicht ermittelbar' };

  const mk = markerSets(ignore);
  // Markierungen der Zielseite merken
  const keep = new Map();
  dn.find('*').addBack().each((_, el) => {
    const cls = String($d(el).attr('class') || '').split(/\s+/).filter((c) => mk.classes.has(c));
    const attrs = Object.entries(el.attribs || {}).filter(([k]) => mk.attrs.has(k.toLowerCase()));
    if (!cls.length && !attrs.length) return;
    const key = linkKey($d, el, dstPage);
    if (key) keep.set(key, { cls, attrs });
  });

  const $f = cheerio.load($s.html(sn), null, false);
  $f('*').each((_, el) => {
    const $el = $f(el);
    for (const k of Object.keys(el.attribs || {})) if (mk.attrs.has(k.toLowerCase())) $el.removeAttr(k);
    for (const c of mk.classes) $el.removeClass(c);
    if ($el.attr('class') === '') $el.removeAttr('class');
    for (const a of ['href', 'src', 'action', 'poster']) {
      const v = $el.attr(a);
      if (v !== undefined) $el.attr(a, rebase(v.trim(), srcPage, dstPage));
    }
    const srcset = $el.attr('srcset');
    if (srcset) $el.attr('srcset', srcset.split(',').map((part) => {
      const [u, ...d] = part.trim().split(/\s+/);
      return [rebase(u, srcPage, dstPage), ...d].join(' ');
    }).join(', '));
  });
  $f('*').each((_, el) => {
    const m = keep.get(linkKey($f, el, dstPage));
    if (!m) return;
    m.cls.forEach((c) => $f(el).addClass(c));
    m.attrs.forEach(([k, v]) => $f(el).attr(k, v));
  });
  return { html: dstHtml.slice(0, loc.startOffset) + $f.html() + dstHtml.slice(loc.endOffset) };
}

function loadConfig(site) {
  const file = path.join(site, 'design', 'consistency.json');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{"shared":[],"ignore":["class:active","class:current","aria-current"]}';
  return { file, ...readConfig(text) };
}

function writeConfig(file, cfg) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ shared: cfg.shared, ignore: cfg.ignore }, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function applyTo(site, srcPage, dstPage, areas, ignore, result) {
  const www = path.join(site, 'www');
  const src = readHtml(path.join(www, srcPage)).text;
  const dst = readHtml(path.join(www, dstPage));
  let html = dst.text;
  const done = [];
  for (const a of areas) {
    const r = transplant({ srcHtml: src, srcPage, dstHtml: html, dstPage, selector: a.selector, ignore });
    if (r.html) { html = r.html; done.push(a.name); }
    else if (r.skip !== 'schon gleich') result.skipped.push({ page: '/' + dstPage, area: a.name, reason: r.skip });
  }
  if (done.length) {
    fs.writeFileSync(path.join(www, dstPage), html, dst.enc);
    result.changed.push({ page: '/' + dstPage, areas: done });
  }
}

export async function sync(site, srcPageArg, add) {
  cheerio = await loadCheerio();
  const srcPage = String(srcPageArg || '').replace(/^\/+/, '');
  const pages = sitePages(site);
  if (!pages.includes(srcPage)) throw new Error(`Quellseite nicht im Abzug: /${srcPage}`);
  const cfg = loadConfig(site);
  if (cfg.errors.length) throw new Error('consistency.json ungültig: ' + cfg.errors.join('; '));
  let areas = cfg.shared;
  let added = false;
  if (add) {
    const err = areaError(add.name, add.selector);
    if (err) throw new Error(err);
    const $s = cheerio.load(readHtml(path.join(site, 'www', srcPage)).text);
    let found;
    try { found = $s(add.selector).length; } catch { throw new Error(`Ungültiger Selektor: ${add.selector}`); }
    if (!found) throw new Error(`Selektor trifft auf der Quellseite nichts: ${add.selector}`);
    let area = cfg.shared.find((s) => s.selector === add.selector);
    if (!area) {
      area = { name: add.name, selector: add.selector, pages: 'all' };
      cfg.shared.push(area);
      writeConfig(cfg.file, cfg);
      added = true;
    }
    areas = [area];
  }
  if (!areas.length) throw new Error('Keine Bereiche in consistency.json');
  const result = { source: '/' + srcPage, areas: areas.map((a) => a.name), added, changed: [], skipped: [] };
  for (const p of pages) {
    if (p === srcPage) continue;
    const inArea = areas.filter((a) => inScope(a, p));
    if (inArea.length) applyTo(site, srcPage, p, inArea, cfg.ignore, result);
  }
  return result;
}

export async function afterAdd(site, newPagesArg) {
  const cfg = loadConfig(site);
  const result = { changed: [], skipped: [], unclear: [] };
  if (!cfg.shared.length) return result;
  cheerio = await loadCheerio();
  const newPages = newPagesArg.map((p) => String(p).replace(/^\/+/, ''));
  const all = sitePages(site);
  const existing = all.filter((p) => !newPages.includes(p));
  let entry = '';
  try { entry = String(JSON.parse(fs.readFileSync(path.join(site, 'site.json'), 'utf8')).entry || '').replace(/^\/+/, ''); } catch { /* egal */ }
  const parsed = new Map(existing.map((p) => [p, cheerio.load(readHtml(path.join(site, 'www', p)).text)]));
  for (const a of cfg.shared) {
    const versions = new Map();
    for (const p of existing) {
      if (!inScope(a, p)) continue;
      const $ = parsed.get(p);
      let n;
      try { n = $(a.selector).first(); } catch { n = null; }
      if (n && n.length) versions.set(p, normalize($, n[0], cfg.ignore, p));
    }
    const distinct = new Set(versions.values());
    if (distinct.size !== 1) {
      if (distinct.size > 1) result.unclear.push(a.name);
      continue;
    }
    const src = versions.has(entry) ? entry : [...versions.keys()][0];
    for (const p of newPages) if (all.includes(p) && inScope(a, p)) applyTo(site, src, p, [a], cfg.ignore, result);
  }
  // pro Seite zusammenfassen
  const byPage = new Map();
  for (const c of result.changed) byPage.set(c.page, [...(byPage.get(c.page) || []), ...c.areas]);
  result.changed = [...byPage].map(([page, areas]) => ({ page, areas }));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const [cmd, site, ...rest] = process.argv.slice(2);
  const run = async () => {
    if (!site || !fs.existsSync(site)) throw Object.assign(new Error('Website-Ordner fehlt'), { code: 2 });
    if (cmd === 'sync') {
      const i = rest.indexOf('--add');
      const add = i >= 0 ? { name: rest[i + 1], selector: rest[i + 2] } : null;
      if (add && (!add.name || !add.selector)) throw Object.assign(new Error('--add <name> <selektor>'), { code: 2 });
      return sync(site, rest[0], add);
    }
    if (cmd === 'after-add') return afterAdd(site, rest);
    throw Object.assign(new Error('Aufruf: node areas.mjs sync|after-add <site-dir> …'), { code: 2 });
  };
  run()
    .then((r) => process.stdout.write(JSON.stringify(r) + '\n'))
    .catch((e) => { process.stdout.write(JSON.stringify({ error: e.message }) + '\n'); process.exit(e.code === 2 ? 2 : 1); });
}
