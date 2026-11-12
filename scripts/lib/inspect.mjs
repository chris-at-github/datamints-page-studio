// Übernimmt ein im Browser (Inspektor) geändertes Element in die Datei des Abzugs.
// Ersetzt nur das Element selbst (Position aus dem Parser), der Rest der Datei bleibt byte-gleich.
// Aufruf: node inspect.mjs <site-dir> <payload.json>
//   payload: { page: "/www.example.de/index.html", selector, html, css?: "decl; decl", cssId?: "A-012" }
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
const selector = String(p.selector || '').trim();
const html = String(p.html || '');
if (!sitePages(site).includes(page)) fail(`Seite nicht im Abzug: /${page}`);
if (!selector || selector.length > 500) fail('Selektor fehlt oder ist zu lang');
if (!html.trim() || html.length > 500000) fail('HTML fehlt oder ist zu groß');

const cheerio = await loadCheerio();
const file = path.join(site, 'www', page);
const src = readHtml(file);
const $ = cheerio.load(src.text, { sourceCodeLocationInfo: true });
let n;
try { n = $(selector).first(); } catch { fail(`Ungültiger Selektor: ${selector}`); }
if (!n.length) fail(`Selektor trifft in der Datei nichts: ${selector}`);
const loc = n[0].sourceCodeLocation;
if (!loc || loc.startOffset == null || loc.endOffset == null) fail('Position des Elements nicht ermittelbar');
// Das neue HTML muss genau ein Element mit demselben Tag sein
const $f = cheerio.load(html, null, false);
const roots = $f.root().children();
if (roots.length !== 1 || roots[0].name !== n[0].name) fail(`Erwartet genau ein <${n[0].name}>-Element`);
fs.writeFileSync(file, src.text.slice(0, loc.startOffset) + html + src.text.slice(loc.endOffset), src.enc);

let css = '';
if (p.css && String(p.css).trim()) {
  const decls = String(p.css).split(';').map((d) => d.trim()).filter(Boolean);
  if (decls.some((d) => /[{}<>@\\]|url\s*\(|expression\s*\(/i.test(d) || !/^[a-z-]+\s*:/i.test(d))) fail('Ungültige CSS-Angaben');
  const id = /^A-\d{3,}$/.test(String(p.cssId || '')) ? p.cssId : 'Inspektor';
  css = `\n/* ${id}: Inline-Styles aus dem Inspektor */\n${selector} {\n${decls.map((d) => '  ' + d.replace(/\s*!important$/i, '') + ' !important;').join('\n')}\n}\n`;
  fs.appendFileSync(path.join(site, 'overrides.css'), css);
}
process.stdout.write(JSON.stringify({ page: '/' + page, selector, css: !!css }) + '\n');
