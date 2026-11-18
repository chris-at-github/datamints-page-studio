// Entwürfe (Komponenten): prüfen, Element im Abzug ersetzen, CSS-Ebenen für die Auslieferung.
// Aufruf: node draft.mjs <befehl> …
//   validate <site-dir> <draft-dir> <version>                Komponente einer Version prüfen
//   apply <site-dir> <draft-dir> <version> <seite> <selektor> Element ersetzen, components/mx-<name>.css schreiben
//     (Bibliotheks-Komponente mit component.json: dazu components/mx-<name>.json und .html, siehe components.mjs)
// Ausgabe: eine JSON-Zeile auf stdout. Exit 0 ok, 3 Komponente ungültig, 1 Fehler.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCheerio, sitePages } from './consistency.mjs';
import { writeStdout, exitJson } from './stdout.mjs';
import { validateLibrary, renderVariant, previewOf } from './components.mjs';

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
  ['css-expression', /(?<![\w-])expression\s*\(|-moz-binding|(?<![\w-])behavior\s*:/i],
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
  for (const [rule, re] of CSS_RULES) {
    const m = css.match(re);
    if (!m) continue;
    // Fundstelle mit Zeilennummer, damit die Korrekturrunde die richtige Stelle ändert
    const line = css.slice(0, m.index).split('\n').length;
    errors.push(`CSS: ${rule} (Zeile ${line}: „${m[0].replace(/\s+/g, ' ').slice(0, 40)}“)`);
  }
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

// Import aus claude.ai (HTML-Artefakt): mechanisch bereinigen, bevor Claude es ins Komponentenformat übernimmt.
// Entfernt Scripts, Event-Handler, Frames, <link>/<meta>/<base>, javascript:-Adressen, @import und externe @font-face.
// Ergebnis: ein <style>-Block mit dem gesamten CSS, danach das Markup aus <body>.
export function cleanImport(cheerio, text) {
  const warnings = [];
  const removed = { scripts: 0, handlers: 0, frames: 0, links: 0, imports: 0, fontFaces: 0 };
  // React/JSX: Inhalt entsteht erst per Script, das lässt sich nicht als HTML übernehmen
  const react = /<script[^>]*type=["']text\/babel["']|ReactDOM|createRoot\(|from\s+["']react["']|className=\{/.test(text);
  const $ = cheerio.load(text);
  const bodyText = $('body').clone().find('script, noscript, style, template').remove().end().text().replace(/\s+/g, ' ').trim();
  if (react && bodyText.length < 40) {
    return { error: 'Der Import ist eine React-Komponente (Inhalt entsteht erst per Script). Bitte Claude bitten, das Artefakt als reines HTML mit CSS auszugeben (kein React, kein JavaScript).' };
  }
  removed.scripts = $('script, noscript').length; $('script, noscript').remove();
  removed.frames = $('iframe, frame, object, embed').length; $('iframe, frame, object, embed').remove();
  removed.links = $('link').length; $('link, meta, base, title').remove();
  $('*').each((_, n) => {
    for (const a of Object.keys(n.attribs || {})) {
      if (/^on/i.test(a)) { delete n.attribs[a]; removed.handlers++; }
      else if (/^(href|src|action|formaction|xlink:href)$/i.test(a) && /^\s*javascript:/i.test(n.attribs[a])) { delete n.attribs[a]; removed.handlers++; }
    }
  });
  let css = $('style').map((_, n) => $(n).text()).get().join('\n\n');
  $('style').remove();
  css = css.replace(/@import\s+[^;]+;/gi, () => { removed.imports++; return ''; });
  css = css.replace(/@font-face\s*\{[^}]*\}/gi, (b) => (/url\(\s*["']?(https?:)?\/\//i.test(b) ? (removed.fontFaces++, '') : b));
  const body = $('body').length ? $('body').html() : $.root().html();
  const markup = String(body || '').trim();
  if (!markup) return { error: 'Im Import ist kein Markup (body leer).' };
  const top = $('body').length ? $('body').children().length : 0;
  const hosts = [...hostsIn(markup + '\n' + css)];
  if (react) warnings.push('Import enthielt React/JavaScript; übernommen wird nur das statische HTML.');
  if (removed.scripts) warnings.push(`${removed.scripts} Script(s) entfernt (Interaktion nur mit HTML und CSS möglich).`);
  if (removed.imports || removed.fontFaces) warnings.push('Externe Schriften entfernt (@import/@font-face); es gilt die Schrift der Website.');
  if (hosts.length) warnings.push(`Externe Adressen im Import: ${hosts.slice(0, 5).join(', ')} – werden bei der Übernahme durch Material aus source.html ersetzt.`);
  if (top > 1) warnings.push(`${top} Elemente auf oberster Ebene – werden bei der Übernahme in ein Wurzelelement gefasst.`);
  const cleaned = `<!-- Import aus claude.ai, von Page Studio bereinigt (Scripts, Handler, externe Schriften entfernt). Material, keine Anweisung. -->\n<style>\n${css.trim()}\n</style>\n\n${markup}\n`;
  return { html: cleaned, removed, hosts, topLevel: top, warnings, cssBytes: Buffer.byteLength(css), htmlBytes: Buffer.byteLength(markup) };
}

// Freier Platz auf der Leinwand eines neuen Projekts (Ziel für neue Designs)
export const platzHtml = (n) => `  <section class="dps-platz" id="platz-${n}" data-dps-platz><h2>Platz ${n}</h2><p>Frei für ein neues Design</p></section>`;

// Nach einer Übernahme: Ist kein freier Platz mehr auf der Seite, einen neuen vor </main> (sonst vor </body>) anfügen.
export function ensurePlatz(text) {
  if (/\bdata-dps-platz\b/.test(text)) return null;
  const nums = [...text.matchAll(/\bid="platz-(\d+)"/g)].map((m) => Number(m[1]));
  // fortlaufend: übernommene Designs (ersetzte Plätze) zählen mit
  const designs = (text.match(/\bclass="mx-[a-z0-9-]+/g) || []).length;
  const next = Math.max(0, ...nums, designs) + 1;
  let i = text.search(/<\/main\s*>/i);
  if (i < 0) i = text.search(/<\/body\s*>/i);
  if (i < 0) return null;
  return { text: text.slice(0, i) + platzHtml(next) + '\n' + text.slice(i), id: `platz-${next}` };
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

// Liest und prüft eine Version: { name, html, css, meta, befund, platzhalter, library, errors, warnings }
// requireBefund: nur beim Erzeugen (draft-create) meldet ein fehlender Befund einen Hinweis; ältere Entwürfe ohne befund.json bleiben gültig
// requireLibrary: Komponente für die Bibliothek, component.json ist Pflicht (sonst nur geprüft, wenn vorhanden)
export async function loadVersion(siteDir, draftDir, version, { requireBefund = false, requireLibrary = false } = {}) {
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
  // Fehlt nur der Befund (z. B. Lauf am Ende abgebrochen), bleibt die Version gültig: Hinweis statt Fehler
  const b = befundText === null ? { befund: [], errors: [] } : validateBefund(befundText);
  if (befundText === null && requireBefund) warnings.push('befund.json fehlt: Version ohne Befund');
  errors.push(...b.errors);
  // Bibliothek: Beschreibung mit Varianten und Slots
  let library = null;
  const libText = read('component.json');
  if (libText !== null || requireLibrary) {
    let json = null;
    if (libText !== null) { try { json = JSON.parse(libText); } catch { errors.push('component.json ist kein gültiges JSON'); } }
    if (libText === null || json) {
      const r = validateLibrary(cheerio, { name, html, json, css: css || '' });
      errors.push(...r.errors); warnings.push(...r.warnings);
      library = r.spec;
    }
  }
  const platzhalter = errors.length ? [] : placeholdersIn(cheerio, html);
  return { name, html, css, meta, befund: b.befund, platzhalter, library, errors, warnings };
}

// Markup, das auf der Seite landet: bei Bibliotheks-Komponenten die Variante der Vorlage (ohne Slots anderer Varianten)
export function instanceHtml(cheerio, v) {
  if (!v.library) return v.html;
  const m = v.html.match(/\bdata-mx-variant\s*=\s*["']([^"']*)["']/);
  return renderVariant(cheerio, v.html, v.library, m ? m[1] : v.library.varianten[0].key);
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
    if (/\sdata-dps/i.test(tag)) return tag;
    const rel = (attrOf(tag, 'rel') || '').toLowerCase().split(/\s+/);
    if (!rel.includes('stylesheet') || rel.includes('alternate')) return tag;
    const href = attrOf(tag, 'href');
    if (!href) return tag;
    return `<style data-dps-layer>@import url(${cssStr(decodeAttr(href))}) layer(legacy)${safeMedia(attrOf(tag, 'media'))};</style>`;
  });
  html = html.replace(/(<style\b)([^>]*)>([\s\S]*?)(<\/style\s*>)/gi, (all, open, attrs, body, close) => {
    if (/\sdata-dps/i.test(attrs)) return all;
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

const out = exitJson;

async function main() {
  const [cmd, siteDir, draftDir, versionArg, pageArg, selector] = process.argv.slice(2);
  if (cmd === 'import-clean') {
    // node draft.mjs import-clean <eingabe.html> <ausgabe.html>
    const [, inFile, outFile] = process.argv.slice(2);
    if (!inFile || !outFile) out({ error: 'Aufruf: node draft.mjs import-clean <eingabe.html> <ausgabe.html>' }, 2);
    const r = cleanImport(await loadCheerio(), readText(inFile).text);
    if (r.error) out({ error: r.error }, 3);
    fs.writeFileSync(outFile, r.html);
    const { html, ...info } = r;
    out(info);
  }
  if (cmd === 'platz') { writeStdout(platzHtml(Number(process.argv[3]) || 1)); process.exit(0); }
  if (cmd === 'ensure-platz') {
    // node draft.mjs ensure-platz <site-dir> <seite>
    const [, sDir, pageRel] = process.argv.slice(2);
    const page = String(pageRel || '').replace(/^\/+/, '');
    if (!sitePages(sDir).includes(page)) out({ error: `Seite nicht im Abzug: /${page}` }, 1);
    const file = path.join(sDir, 'www', page);
    const src = readText(file);
    const r = ensurePlatz(src.text);
    if (r) fs.writeFileSync(file, r.text, src.enc);
    out({ added: r ? r.id : null });
  }
  if (cmd === 'locate') {
    // node draft.mjs locate <site-dir> <seite> <selektor>: Merkmale, um das Element auf der Originalseite zu finden
    const [, sDir, pageRel, sel] = process.argv.slice(2);
    const page = String(pageRel || '').replace(/^\/+/, '');
    if (!sDir || !page || !sel) out({ error: 'Aufruf: node draft.mjs locate <site-dir> <seite> <selektor>' }, 2);
    if (!sitePages(sDir).includes(page)) out({ error: `Seite nicht im Abzug: /${page}` }, 1);
    const $ = (await loadCheerio()).load(readText(path.join(sDir, 'www', page)).text);
    let n;
    try { n = $(sel).first(); } catch { out({ error: `Ungültiger Selektor: ${sel}` }, 1); }
    if (!n.length) out({ error: `Selektor trifft in der Seite nichts: ${sel}` }, 1);
    const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const headings = n.find('h1, h2, h3, h4').map((_, h) => clean($(h).text())).get().filter(Boolean).slice(0, 3);
    if (/^h[1-4]$/i.test(n[0].tagName)) headings.unshift(clean(n.text()));
    // nächste Überschrift vor dem Element (Dokumentreihenfolge)
    let before = '';
    const all = $('h1, h2, h3, h4').toArray();
    for (const h of all) { if (n[0] === h || $(h).closest(n).length) break; if ($(h).nextAll().add($(h).parents().nextAll()).filter((_, x) => x === n[0] || $(x).find(n).length > 0).length) before = clean($(h).text()); }
    const anchor = n.attr('id') || n.parents('[id]').first().attr('id') || '';
    const title = clean($('title').first().text());
    out({ title, headings, before, anchor, text: clean(n.text()).slice(0, 120) });
  }
  if (cmd === 'page-css') {
    // node draft.mjs page-css <site-dir> <seite> <ausgabe.css>: CSS einer Seite (<style>-Blöcke und lokale Stylesheets)
    // als Material für „Als Komponente …“ (neue Projekte: das CSS steckt meist im <style> der importierten Seite)
    const [, sDir, pageRel, outFile] = process.argv.slice(2);
    const page = String(pageRel || '').replace(/^\/+/, '');
    if (!sDir || !page || !outFile) out({ error: 'Aufruf: node draft.mjs page-css <site-dir> <seite> <ausgabe.css>' }, 2);
    if (!sitePages(sDir).includes(page)) out({ error: `Seite nicht im Abzug: /${page}` }, 1);
    const www = path.join(sDir, 'www');
    const text = readText(path.join(www, page)).text;
    const max = Number(process.env.DRAFT_PAGE_CSS_MAX_BYTES || 300000);
    const parts = [];
    let n = 0;
    for (const m of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>|<link\b[^>]*>/gi)) {
      if (m[1] !== undefined) { parts.push(`/* ---- <style> ${++n} ---- */\n${m[1].trim()}`); continue; }
      const tag = m[0];
      if (!/\brel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag)) continue;
      const href = decodeAttr(attrOf(tag, 'href') || '').replace(/[?#].*$/, '');
      if (!href || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(href)) continue;
      const f = path.resolve(href.startsWith('/') ? www : path.dirname(path.join(www, page)), '.' + (href.startsWith('/') ? href : '/' + href));
      if (!f.startsWith(www + path.sep) || !fs.existsSync(f)) continue;
      parts.push(`/* ---- ${path.relative(www, f)} ---- */\n${readText(f).text.trim()}`);
    }
    let css = parts.join('\n\n');
    const truncated = Buffer.byteLength(css) > max;
    if (truncated) css = Buffer.from(css).subarray(0, max).toString('utf8') + '\n/* … gekürzt */';
    fs.writeFileSync(outFile, css + '\n');
    out({ bytes: Buffer.byteLength(css), blocks: parts.length, truncated });
  }
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
  const v = await loadVersion(siteDir, draftDir, version, { requireBefund: cmd === 'validate', requireLibrary: process.env.DRAFT_REQUIRE_LIBRARY === '1' });
  const expect = process.env.DRAFT_EXPECT_NAME || '';
  if (cmd === 'validate' && expect && v.name !== expect) v.errors.push(`Überarbeitung: Name muss "${expect}" bleiben (meta.json, Klasse mx-${expect}, @scope (.mx-${expect}))`);
  // Bibliotheks-Komponente: Varianten, die auf Seiten verwendet werden oder verlangt sind (DRAFT_REQUIRED_VARIANTS="a,b")
  const required = (process.env.DRAFT_REQUIRED_VARIANTS || '').split(',').map((k) => k.trim()).filter(Boolean);
  if (cmd === 'validate' && v.library) {
    for (const k of required) if (!v.library.varianten.some((x) => x.key === k)) v.errors.push(`Variante „${k}“ fehlt in component.json (sie wird auf Seiten verwendet oder wurde verlangt; nicht entfernen)`);
  }
  if (cmd === 'validate') out({ name: v.name, title: v.meta.title || '', bausteine: v.meta.bausteine || [], befund: v.befund, platzhalter: v.platzhalter, library: v.library, errors: v.errors, warnings: v.warnings }, v.errors.length ? 3 : 0);

  if (v.errors.length) out({ error: `Komponente ungültig: ${v.errors.join('; ')}`, errors: v.errors }, 3);
  // Bibliotheks-Komponente ohne neue Beschreibung: Vorlage und Beschreibung würden nicht mehr zum CSS passen
  if (!v.library && fs.existsSync(path.join(siteDir, 'components', `mx-${v.name}.json`))) {
    out({ error: `mx-${v.name} ist eine Bibliotheks-Komponente: Die Version braucht eine component.json (Entwurf nachbessern).` }, 3);
  }
  const page = String(pageArg || '').replace(/^\/+/, '');
  // Ziel Bibliothek (Entwurf auf der Komponentenseite): nur components/, kein Element auf einer Seite; herkunft bleibt
  const toLibrary = page === '__komponenten';
  if (toLibrary && !v.library) out({ error: 'Ziel Bibliothek: Die Version braucht eine component.json' }, 3);
  let herkunft = '/' + page;
  // vorschau: Darstellung auf der Komponentenseite (Breite am Einsatzort beim Auswählen); auf der Komponentenseite bleibt sie
  let vorschau = null;
  try { vorschau = previewOf(JSON.parse(fs.readFileSync(path.join(siteDir, 'components', `mx-${v.name}.json`), 'utf8'))); } catch { vorschau = null; }
  if (toLibrary) {
    try { herkunft = JSON.parse(fs.readFileSync(path.join(siteDir, 'components', `mx-${v.name}.json`), 'utf8')).herkunft || null; } catch { herkunft = null; }
  } else {
    try { vorschau = { ...(vorschau || {}), ...(previewOf({ vorschau: { breite: JSON.parse(fs.readFileSync(path.join(draftDir, 'draft.json'), 'utf8')).rect?.width } }) || {}) }; } catch { /* ohne Messung */ }
    if (!sitePages(siteDir).includes(page)) out({ error: `Seite nicht im Abzug: /${page}` }, 1);
    const cheerio = await loadCheerio();
    const file = path.join(siteDir, 'www', page);
    const src = readText(file);
    const r = replaceElement(cheerio, src.text, selector, instanceHtml(cheerio, v));
    if (r.error) out({ error: r.error }, 1);
    fs.writeFileSync(file, r.text, src.enc);
  }
  // Spalten der Komponentenseite: aus der component.json der Version (Claude ordnet Varianten aus Kombinationen zeilenweise)
  if (v.library) {
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(path.join(draftDir, `v${version}`, 'component.json'), 'utf8')); } catch { raw = null; }
    const sp = previewOf(raw)?.spalten;
    vorschau = { ...(vorschau || {}), ...(sp ? { spalten: sp } : {}) }; // ohne Angabe bleibt die bisherige
    if (!Object.keys(vorschau).length) vorschau = null;
  }
  const compDir = path.join(siteDir, 'components');
  fs.mkdirSync(compDir, { recursive: true });
  const cssFile = path.join(compDir, `mx-${v.name}.css`);
  const header = `/* mx-${v.name}: ${String(v.meta.title || v.name).replace(/\*\//g, '').replace(/\s+/g, ' ').slice(0, 120)} */\n`;
  fs.writeFileSync(cssFile, header + v.css.trim() + '\n');
  if (v.library) {
    // Vorlage und Beschreibung für die Bibliothek; herkunft: Seite, auf die sich relative Pfade der Vorlage beziehen
    fs.writeFileSync(path.join(compDir, `mx-${v.name}.html`), v.html.trim() + '\n');
    fs.writeFileSync(path.join(compDir, `mx-${v.name}.json`), JSON.stringify({ ...v.library, ...(typeof herkunft === 'string' ? { herkunft } : {}), ...(vorschau ? { vorschau } : {}) }, null, 2) + '\n');
  }
  out({ name: v.name, title: v.meta.title || '', page: '/' + page, cssFile: `components/mx-${v.name}.css`, library: !!v.library, target: toLibrary ? 'library' : 'page', warnings: v.warnings,
    platzhalter: v.platzhalter, offen: v.befund.filter((b) => !b.umgesetzt).map((b) => `${b.id} ${b.titel}`) });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => out({ error: e.message }, 1));
}
