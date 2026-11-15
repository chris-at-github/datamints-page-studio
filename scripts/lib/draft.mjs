// Entwürfe (Komponenten): prüfen, Element im Abzug ersetzen, CSS-Ebenen für die Auslieferung.
// Aufruf: node draft.mjs <befehl> …
//   validate <site-dir> <draft-dir> <version>                Komponente einer Version prüfen
//   apply <site-dir> <draft-dir> <version> <seite> <selektor> Element ersetzen, components/mx-<name>.css schreiben
// Ausgabe: eine JSON-Zeile auf stdout. Exit 0 ok, 3 Komponente ungültig, 1 Fehler.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCheerio, sitePages } from './consistency.mjs';

export const NAME_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const MAX_HTML = 200 * 1024;
export const MAX_CSS = 100 * 1024;

export function readText(file) {
  const buf = fs.readFileSync(file);
  const utf8 = buf.toString('utf8');
  if (Buffer.from(utf8, 'utf8').equals(buf)) return { text: utf8, enc: 'utf8' };
  return { text: buf.toString('latin1'), enc: 'latin1' };
}

const hostsIn = (text) => new Set([...String(text).matchAll(/(?:https?:)?\/\/([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g)].map((m) => m[1].toLowerCase()));

const HTML_RULES = [
  ['script-tag', /<\s*script\b/i],
  ['event-handler', /<[^>]*\son[a-z]+\s*=/i],
  ['iframe', /<\s*iframe\b/i],
  ['object-embed', /<\s*(object|embed)\b/i],
  ['javascript-url', /javascript\s*:/i],
  ['meta-refresh', /<\s*meta\b/i],
  ['base-tag', /<\s*base\b/i],
  ['link-tag', /<\s*link\b/i],
  ['style-tag', /<\s*style\b/i],
  ['form-action', /<\s*form\b[^>]*action\s*=\s*["']?(https?:)?\/\//i],
];
const CSS_RULES = [
  ['css-import', /@import\b/i],
  ['css-expression', /expression\s*\(|-moz-binding|behavior\s*:/i],
  ['javascript-url', /javascript\s*:/i],
  ['style-close', /<\/?\s*style/i],
  ['css-layer', /@layer\b/i],
];

// Oberste Ebene des CSS: nur @scope (.mx-<name>) sowie @media/@supports/@container, die selbst nur @scope enthalten,
// und @keyframes mx-<name>…. Kommentare und Zeichenketten werden übersprungen.
function cssTopLevel(css) {
  const blocks = [];
  let depth = 0, start = 0, i = 0, stack = [];
  const n = css.length;
  while (i < n) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') { const e = css.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '"' || c === "'") { i++; while (i < n && css[i] !== c) { if (css[i] === '\\') i++; i++; } i++; continue; }
    if (c === '{') {
      const prelude = css.slice(start, i).replace(/\/\*[\s\S]*?\*\//g, '').trim();
      stack.push({ prelude, depth });
      if (depth <= 1) blocks.push({ prelude, depth, parent: depth === 1 ? stack[stack.length - 2]?.prelude : null });
      depth++; start = i + 1;
    } else if (c === '}') {
      depth--; stack.pop(); start = i + 1;
      if (depth < 0) return { error: 'Klammern im CSS passen nicht zusammen' };
    } else if (c === ';') {
      if (depth === 0) {
        const stmt = css.slice(start, i).replace(/\/\*[\s\S]*?\*\//g, '').trim();
        if (stmt) blocks.push({ prelude: stmt, depth: 0, statement: true });
      }
      start = i + 1;
    }
    i++;
  }
  if (depth !== 0) return { error: 'Klammern im CSS passen nicht zusammen' };
  return { blocks };
}

// Prüft Markup und CSS einer Komponente. allowedHosts: Hosts, die im Ausgangsmaterial vorkommen.
export function validateComponent(cheerio, { html, css, name, allowedHosts = new Set() }) {
  const errors = [];
  const warnings = [];
  if (!NAME_RE.test(name || '') || name.length > 40) errors.push(`Ungültiger Name „${name}“ (a-z, 0-9, Bindestrich)`);
  if (!html || !html.trim()) errors.push('component.html fehlt oder ist leer');
  if (css === null || css === undefined) errors.push('component.css fehlt');
  if (errors.length) return { errors, warnings };
  if (Buffer.byteLength(html) > MAX_HTML) errors.push('component.html ist zu groß');
  if (Buffer.byteLength(css) > MAX_CSS) errors.push('component.css ist zu groß');
  const cls = `mx-${name}`;

  for (const [rule, re] of HTML_RULES) if (re.test(html)) errors.push(`HTML: ${rule}`);
  for (const [rule, re] of CSS_RULES) if (re.test(css)) errors.push(`CSS: ${rule}`);
  for (const h of hostsIn(html)) if (!allowedHosts.has(h)) errors.push(`HTML: fremde Domain ${h}`);
  for (const h of hostsIn(css)) if (!allowedHosts.has(h)) errors.push(`CSS: fremde Domain ${h}`);
  if (/!important/i.test(css)) warnings.push('CSS enthält !important (in Komponenten nicht nötig)');

  // Genau ein Wurzelelement mit der Klasse mx-<name>, kein Text daneben
  const $ = cheerio.load(html, null, false);
  const top = $.root().contents().toArray().filter((n) => n.type !== 'comment' && !(n.type === 'text' && !n.data.trim()));
  if (top.length !== 1 || top[0].type !== 'tag') errors.push('component.html muss genau ein Wurzelelement haben');
  else if (!($(top[0]).attr('class') || '').split(/\s+/).includes(cls)) errors.push(`Wurzelelement braucht die Klasse ${cls}`);
  else if (['html', 'head', 'body'].includes(top[0].name)) errors.push(`<${top[0].name}> ist als Wurzelelement nicht erlaubt`);

  const scopeRe = new RegExp(`^@scope\\s*\\(\\s*\\.${cls}\\s*\\)(\\s*to\\s*\\([^)]*\\))?$`);
  const groupRe = /^@(media|supports|container)\b/i;
  const kfRe = new RegExp(`^@(-webkit-)?keyframes\\s+${cls}(-[a-z0-9-]+)?$`);
  const tl = cssTopLevel(css);
  if (tl.error) errors.push(`CSS: ${tl.error}`);
  else {
    let scoped = 0;
    for (const b of tl.blocks) {
      if (b.statement) { errors.push(`CSS: Anweisung außerhalb von @scope: ${b.prelude.slice(0, 80)}`); continue; }
      if (b.depth === 0) {
        if (scopeRe.test(b.prelude)) scoped++;
        else if (!groupRe.test(b.prelude) && !kfRe.test(b.prelude)) errors.push(`CSS: Regel außerhalb von @scope (.${cls}): ${b.prelude.slice(0, 80)}`);
      } else if (b.depth === 1 && b.parent && groupRe.test(b.parent)) {
        if (scopeRe.test(b.prelude)) scoped++;
        else errors.push(`CSS: In ${b.parent.slice(0, 40)} nur @scope (.${cls}) erlaubt: ${b.prelude.slice(0, 60)}`);
      }
    }
    if (!scoped) errors.push(`CSS: kein Block @scope (.${cls}) gefunden`);
  }
  return { errors, warnings };
}

// Ersetzt das erste Element zu selector im HTML-Text; der Rest bleibt byte-gleich.
export function replaceElement(cheerio, text, selector, html) {
  const $ = cheerio.load(text, { sourceCodeLocationInfo: true });
  let n;
  try { n = $(selector).first(); } catch { return { error: `Ungültiger Selektor: ${selector}` }; }
  if (!n.length) return { error: `Selektor trifft in der Seite nichts: ${selector}` };
  const loc = n[0].sourceCodeLocation;
  if (!loc || loc.startOffset == null || loc.endOffset == null) return { error: `Position nicht ermittelbar: ${selector}` };
  return { text: text.slice(0, loc.startOffset) + html.trim() + text.slice(loc.endOffset) };
}

// Element genau so aus der Seite holen, wie es beim Übernehmen ersetzt würde (Originalmarkup, ungekürzt).
export function extractElement(cheerio, text, selector) {
  const $ = cheerio.load(text, { sourceCodeLocationInfo: true });
  let all;
  try { all = $(selector); } catch { return { error: `Ungültiger Selektor: ${selector}` }; }
  if (!all.length) return { error: `Selektor trifft in der Seite nichts: ${selector}` };
  const loc = all[0].sourceCodeLocation;
  if (!loc || loc.startOffset == null || loc.endOffset == null) return { error: `Position nicht ermittelbar: ${selector}` };
  return { html: text.slice(loc.startOffset, loc.endOffset), count: all.length };
}

// Hosts, die in einem Entwurf vorkommen dürfen: Host der Website und Hosts aus dem Ausgangsmaterial.
export function allowedHostsFor(siteDir, draftDir) {
  const set = new Set();
  try {
    const site = JSON.parse(fs.readFileSync(path.join(siteDir, 'site.json'), 'utf8'));
    if (site.host) { set.add(site.host.toLowerCase()); set.add(site.host.toLowerCase().replace(/^www\./, '')); }
  } catch { /* ohne site.json */ }
  try { for (const h of hostsIn(fs.readFileSync(path.join(draftDir, 'source.html'), 'utf8'))) set.add(h); } catch { /* ohne Ausgang */ }
  return set;
}

export const BEFUND_GRUPPEN = ['pflicht', 'inhalt', 'funktionen', 'feinschliff'];

// Prüft befund.json; gibt { befund, errors } zurück (befund bereinigt)
export function validateBefund(text) {
  if (text === null || text === undefined) return { befund: [], errors: ['befund.json fehlt'] };
  let data;
  try { data = JSON.parse(text); } catch { return { befund: [], errors: ['befund.json ist kein gültiges JSON'] }; }
  if (!Array.isArray(data)) return { befund: [], errors: ['befund.json muss eine Liste sein'] };
  const errors = [];
  if (data.length > 25) errors.push('befund.json: höchstens 25 Punkte');
  const ids = new Set();
  const befund = [];
  data.slice(0, 25).forEach((b, i) => {
    const where = `befund.json Punkt ${i + 1}`;
    if (!b || typeof b !== 'object') { errors.push(`${where}: kein Objekt`); return; }
    const id = String(b.id || '');
    if (!/^P\d{1,3}$/.test(id)) errors.push(`${where}: id muss P1, P2, … sein`);
    else if (ids.has(id)) errors.push(`${where}: id ${id} doppelt`);
    ids.add(id);
    if (!BEFUND_GRUPPEN.includes(b.gruppe)) errors.push(`${where}: gruppe muss ${BEFUND_GRUPPEN.join(', ')} sein`);
    if (typeof b.titel !== 'string' || !b.titel.trim() || b.titel.length > 200) errors.push(`${where}: titel fehlt oder ist zu lang`);
    if (typeof b.text !== 'string' || b.text.length > 1500) errors.push(`${where}: text fehlt oder ist zu lang`);
    if (typeof b.umgesetzt !== 'boolean') errors.push(`${where}: umgesetzt muss true oder false sein`);
    befund.push({ id, gruppe: b.gruppe, titel: String(b.titel || '').trim(), text: String(b.text || '').trim(), umgesetzt: b.umgesetzt === true });
  });
  return { befund, errors };
}

// Platzhalter (data-mx-platzhalter) im Markup: [{ tag, text }]
export function placeholdersIn(cheerio, html) {
  if (!html) return [];
  const $ = cheerio.load(html, null, false);
  return $('[data-mx-platzhalter]').toArray().slice(0, 50).map((n) => ({ tag: n.name, text: String($(n).attr('data-mx-platzhalter') || '').slice(0, 200) }));
}

// Liest und prüft eine Version: { name, html, css, meta, befund, platzhalter, errors, warnings }
// requireBefund: nur beim Erzeugen (draft-create); ältere Entwürfe ohne befund.json bleiben für Vorschau und Übernahme gültig
export async function loadVersion(siteDir, draftDir, version, { requireBefund = false } = {}) {
  const vdir = path.join(draftDir, `v${version}`);
  const read = (f) => { try { return fs.readFileSync(path.join(vdir, f), 'utf8'); } catch { return null; } };
  let meta = {};
  try { meta = JSON.parse(read('meta.json') || '{}'); } catch { meta = {}; }
  const html = read('component.html');
  const css = read('component.css');
  const name = String(meta.name || '').trim();
  const cheerio = await loadCheerio();
  const { errors, warnings } = validateComponent(cheerio, { html, css, name, allowedHosts: allowedHostsFor(siteDir, draftDir) });
  if (!meta.name) errors.unshift('meta.json ohne name');
  const befundText = read('befund.json');
  const b = befundText === null && !requireBefund ? { befund: [], errors: [] } : validateBefund(befundText);
  errors.push(...b.errors);
  const platzhalter = errors.length ? [] : placeholdersIn(cheerio, html);
  return { name, html, css, meta, befund: b.befund, platzhalter, errors, warnings };
}

// ---------- CSS-Ebenen für die Auslieferung ----------

const attrOf = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
};
const decodeAttr = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const cssStr = (s) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r]/g, '') + '"';
const safeMedia = (m) => (m && !/[;{}<>]/.test(m) && m.trim().toLowerCase() !== 'all' ? ' ' + m.trim() : '');

// Legt alle Stylesheets und <style>-Blöcke des Originals in @layer legacy. Text ist byte-treu (latin1) gelesen.
export function layerLegacyCss(html) {
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (/\sdata-modio/i.test(tag)) return tag;
    const rel = (attrOf(tag, 'rel') || '').toLowerCase().split(/\s+/);
    if (!rel.includes('stylesheet') || rel.includes('alternate')) return tag;
    const href = attrOf(tag, 'href');
    if (!href) return tag;
    return `<style data-modio-layer>@import url(${cssStr(decodeAttr(href))}) layer(legacy)${safeMedia(attrOf(tag, 'media'))};</style>`;
  });
  html = html.replace(/(<style\b)([^>]*)>([\s\S]*?)(<\/style\s*>)/gi, (all, open, attrs, body, close) => {
    if (/\sdata-modio/i.test(attrs)) return all;
    let head = '';
    let rest = body.replace(/^\s*@charset\s+[^;]*;/i, '');
    for (;;) {
      const m = rest.match(/^\s*(?:\/\*[\s\S]*?\*\/\s*)*@import\s+(url\([^)]*\)|"[^"]*"|'[^']*')\s*([^;]*);/i);
      if (!m) break;
      const extra = m[2].trim();
      head += /\blayer\b/i.test(extra) ? `@import ${m[1]} ${extra};` : `@import ${m[1]} layer(legacy)${extra ? ' ' + extra : ''};`;
      rest = rest.slice(m[0].length);
    }
    return `${open}${attrs}>${head}@layer legacy{\n${rest}\n}${close}`;
  });
  return html;
}

// ---------- Kommandozeile ----------

const out = (o, code = 0) => { process.stdout.write(JSON.stringify(o) + '\n'); process.exit(code); };

async function main() {
  const [cmd, siteDir, draftDir, versionArg, pageArg, selector] = process.argv.slice(2);
  if (cmd === 'extract') {
    // node draft.mjs extract <site-dir> <seite> <selektor>
    const [, sDir, pageRel, sel] = process.argv.slice(2);
    const page = String(pageRel || '').replace(/^\/+/, '');
    if (!sDir || !page || !sel) out({ error: 'Aufruf: node draft.mjs extract <site-dir> <seite> <selektor>' }, 2);
    if (!sitePages(sDir).includes(page)) out({ error: `Seite nicht im Abzug: /${page}` }, 1);
    const r = extractElement(await loadCheerio(), readText(path.join(sDir, 'www', page)).text, sel);
    out(r, r.error ? 1 : 0);
  }
  const version = Number(versionArg);
  if (!['validate', 'apply'].includes(cmd) || !siteDir || !draftDir || !Number.isInteger(version) || version < 1) {
    out({ error: 'Aufruf: node draft.mjs validate|apply <site-dir> <draft-dir> <version> [seite selektor]' }, 2);
  }
  const v = await loadVersion(siteDir, draftDir, version, { requireBefund: cmd === 'validate' });
  const expect = process.env.DRAFT_EXPECT_NAME || '';
  if (cmd === 'validate' && expect && v.name !== expect) v.errors.push(`Überarbeitung: Name muss "${expect}" bleiben (meta.json, Klasse mx-${expect}, @scope (.mx-${expect}))`);
  if (cmd === 'validate') out({ name: v.name, title: v.meta.title || '', bausteine: v.meta.bausteine || [], befund: v.befund, platzhalter: v.platzhalter, errors: v.errors, warnings: v.warnings }, v.errors.length ? 3 : 0);

  if (v.errors.length) out({ error: `Komponente ungültig: ${v.errors.join('; ')}`, errors: v.errors }, 3);
  const page = String(pageArg || '').replace(/^\/+/, '');
  if (!sitePages(siteDir).includes(page)) out({ error: `Seite nicht im Abzug: /${page}` }, 1);
  const cheerio = await loadCheerio();
  const file = path.join(siteDir, 'www', page);
  const src = readText(file);
  const r = replaceElement(cheerio, src.text, selector, v.html);
  if (r.error) out({ error: r.error }, 1);
  fs.writeFileSync(file, r.text, src.enc);
  const compDir = path.join(siteDir, 'components');
  fs.mkdirSync(compDir, { recursive: true });
  const cssFile = path.join(compDir, `mx-${v.name}.css`);
  const header = `/* mx-${v.name}: ${String(v.meta.title || v.name).replace(/\*\//g, '').replace(/\s+/g, ' ').slice(0, 120)} */\n`;
  fs.writeFileSync(cssFile, header + v.css.trim() + '\n');
  out({ name: v.name, title: v.meta.title || '', page: '/' + page, cssFile: `components/mx-${v.name}.css`, warnings: v.warnings,
    platzhalter: v.platzhalter, offen: v.befund.filter((b) => !b.umgesetzt).map((b) => `${b.id} ${b.titel}`) });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => out({ error: e.message }, 1));
}
