// Übernimmt ein im Browser (Inspektor) geändertes Element in die Datei des Abzugs.
// Ersetzt nur das Element selbst (Position aus dem Parser), der Rest der Datei bleibt byte-gleich.
// Aufruf: node inspect.mjs <site-dir> <payload.json>
//   payload: { page, items: [{ selector, html, css? }], rules: [{ selector, decls, media? }], cssId? }
//            (einzeln weiterhin: selector, html, css)
//   rules: im Styles-Panel geänderte CSS-Regeln, landen als Regel in overrides.css
//   css: Inline-Styles des Elements, die stattdessen als Regel in overrides.css landen
// Ausgabe: eine JSON-Zeile {page, selector, css}
import fs from 'node:fs';
import path from 'node:path';
import { loadCheerio, sitePages } from './consistency.mjs';

function readHtml(file) {
  const buf = fs.readFileSync(file);
  const utf8 = buf.toString('utf8');
  if (Buffer.from(utf8, 'utf8').equals(buf)) return { text: utf8, enc: 'utf8' };
  return { text: buf.toString('latin1'), enc: 'latin1' };
}

const fail = (msg, code = 1) => { process.stdout.write(JSON.stringify({ error: msg }) + '\n'); process.exit(code); };

const [site, payloadFile] = process.argv.slice(2);
if (!site || !payloadFile) fail('Aufruf: node inspect.mjs <site-dir> <payload.json>', 2);
let p;
try { p = JSON.parse(fs.readFileSync(payloadFile, 'utf8')); } catch { fail('Eingabe ist kein gültiges JSON'); }
const page = String(p.page || '').replace(/^\/+/, '');
if (!sitePages(site).includes(page)) fail(`Seite nicht im Abzug: /${page}`);
// Einzelnes Element (selector/html/css) wie bisher oder Listen items/rules
const items = Array.isArray(p.items) ? p.items : p.selector ? [{ selector: p.selector, html: p.html, css: p.css }] : [];
const rules = Array.isArray(p.rules) ? p.rules : [];
if (!items.length && !rules.length) fail('Keine Änderungen übergeben');
const id = /^A-\d{3,}$/.test(String(p.cssId || '')) ? p.cssId : 'Inspektor';
const badDecl = (d) => /[{}<>@\\]|url\s*\(|expression\s*\(|javascript:/i.test(d) || !/^-?[a-z-]+\s*:/i.test(d);
const declLines = (text) => {
  const decls = String(text || '').split(';').map((d) => d.trim()).filter(Boolean);
  if (decls.some(badDecl)) fail('Ungültige CSS-Angaben');
  return decls.map((d) => '  ' + d.replace(/\s*!important$/i, '') + ' !important;').join('\n');
};
const badSel = (s) => !s || s.length > 500 || /[{}<>;@\\]/.test(s);

const cheerio = await loadCheerio();
const file = path.join(site, 'www', page);
const src = readHtml(file);
let text = src.text;
const done = [];
for (const it of items) {
  const selector = String(it.selector || '').trim();
  const html = String(it.html || '');
  if (!selector || selector.length > 500) fail('Selektor fehlt oder ist zu lang');
  if (!html.trim() || html.length > 500000) fail('HTML fehlt oder ist zu groß');
  const $ = cheerio.load(text, { sourceCodeLocationInfo: true });
  let n;
  try { n = $(selector).first(); } catch { fail(`Ungültiger Selektor: ${selector}`); }
  if (!n.length) fail(`Selektor trifft in der Datei nichts: ${selector}`);
  const loc = n[0].sourceCodeLocation;
  if (!loc || loc.startOffset == null || loc.endOffset == null) fail(`Position nicht ermittelbar: ${selector}`);
  // Das neue HTML muss genau ein Element mit demselben Tag sein
  const roots = cheerio.load(html, null, false).root().children();
  if (roots.length !== 1 || roots[0].name !== n[0].name) fail(`${selector}: erwartet genau ein <${n[0].name}>-Element`);
  text = text.slice(0, loc.startOffset) + html + text.slice(loc.endOffset);
  done.push(selector);
}
if (items.length) fs.writeFileSync(file, text, src.enc);

let css = '';
for (const it of items) {
  if (!it.css || !String(it.css).trim()) continue;
  css += `\n/* ${id}: Inline-Styles aus dem Inspektor */\n${String(it.selector).trim()} {\n${declLines(it.css)}\n}\n`;
}
for (const r of rules) {
  const selector = String(r.selector || '').trim();
  if (badSel(selector)) fail(`Ungültiger CSS-Selektor: ${selector}`);
  const media = r.media ? String(r.media).trim() : '';
  if (media && /[{}<>;@\\]/.test(media)) fail('Ungültige Media-Bedingung');
  const block = `${selector} {\n${declLines(r.decls)}\n}`;
  css += `\n/* ${id}: CSS-Regel aus dem Inspektor */\n` + (media ? `@media ${media} {\n${block.replace(/^/gm, '  ')}\n}\n` : block + '\n');
}
if (css) fs.appendFileSync(path.join(site, 'overrides.css'), css);
process.stdout.write(JSON.stringify({ page: '/' + page, elements: done, rules: rules.length, css: !!css }) + '\n');
