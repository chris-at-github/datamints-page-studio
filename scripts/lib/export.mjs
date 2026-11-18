// Komponenten-Export: je Komponente component.html und component.css, dazu Tokens, Sammel-CSS und Vorschau.
// Bei neuen Projekten (design/tokens-map.json) werden var(--dps-…) wieder auf die Variablen des Projekts
// (design/tokens-quelle.css) umgeschrieben; Tokens ohne Gegenstück stehen in dps-zusatz.css.
// Aufruf: node export.mjs <site-dir> <ziel-ordner>
// Ausgabe: eine JSON-Zeile { status, dir, components: [{ name, title, page }], warnings }
import fs from 'node:fs';
import path from 'node:path';
import { loadCheerio, sitePages } from './consistency.mjs';
import { readText, extractElement } from './draft.mjs';
import { cssVarName } from './design.mjs';
import { exitJson } from './stdout.mjs';
import { listLibrary, renderVariant } from './components.mjs';

const out = exitJson;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

const [siteDir, target] = process.argv.slice(2);
if (!siteDir || !target) out({ status: 'error', error: 'Aufruf: node export.mjs <site-dir> <ziel-ordner>' }, 2);
const compDir = path.join(siteDir, 'components');
const names = (fs.existsSync(compDir) ? fs.readdirSync(compDir) : []).filter((f) => /^mx-[a-z0-9-]+\.css$/.test(f)).map((f) => f.slice(3, -4)).sort();
if (!names.length) out({ status: 'error', error: 'Keine Komponenten vorhanden (erst einen Entwurf übernehmen)' }, 1);

const map = readJson(path.join(siteDir, 'design', 'tokens-map.json'), null);
const tokens = readJson(path.join(siteDir, 'design', 'tokens.json'), { tokens: {} }).tokens || {};
// --dps-<kategorie>-<name> -> --<name im Projekt>
const rename = new Map();
if (map) for (const [orig, key] of Object.entries(map.tokens || {})) rename.set(cssVarName(key), orig);
const usedExtra = new Set();
const rewrite = (text) => text.replace(/--dps-[a-z0-9-]+/g, (v) => {
  if (rename.has(v)) return rename.get(v);
  usedExtra.add(v);
  return v;
});

const cheerio = await loadCheerio();
const pages = sitePages(siteDir);
// Bibliotheks-Komponenten: Vorlage statt Fundstelle auf einer Seite, dazu component.json mit Varianten und Slots
const library = await listLibrary(siteDir, { withTemplate: true });
const warnings = [];
const components = [];
fs.mkdirSync(path.join(target, 'komponenten'), { recursive: true });
for (const name of names) {
  let html = null; let page = null;
  const lib = library.find((c) => c.name === name);
  if (lib) { html = lib.template.trim(); page = lib.herkunft; }
  for (const p of lib ? [] : pages) {
    const text = readText(path.join(siteDir, 'www', p)).text;
    if (!text.includes(`mx-${name}`)) continue;
    const r = extractElement(cheerio, text, `.mx-${name}`);
    if (r.html) { html = r.html; page = '/' + p; break; }
  }
  const cssRaw = fs.readFileSync(path.join(compDir, `mx-${name}.css`), 'utf8');
  const title = (cssRaw.match(/^\/\*\s*mx-[a-z0-9-]+:\s*(.*?)\s*\*\//) || [])[1] || name;
  if (!html) { warnings.push(`mx-${name}: Markup in keiner Seite gefunden, nur CSS exportiert`); }
  const dir = path.join(target, 'komponenten', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'component.css'), rewrite(cssRaw));
  if (html) fs.writeFileSync(path.join(dir, 'component.html'), rewrite(html).trim() + '\n');
  if (lib) {
    const { template, ...spec } = lib;
    fs.writeFileSync(path.join(dir, 'component.json'), JSON.stringify(spec, null, 2) + '\n');
  }
  const variants = lib ? lib.varianten.map((v) => ({ label: v.label, key: v.key, html: rewrite(renderVariant(cheerio, lib.template, lib, v.key)).trim() })) : null;
  components.push({ name, title: lib ? lib.title : title, page, html: html ? rewrite(html).trim() : null, variants });
}

// Tokens: Datei des Projekts (neue Projekte) oder die erzeugten --dps-Variablen
const quelle = path.join(siteDir, 'design', 'tokens-quelle.css');
if (map && fs.existsSync(quelle)) fs.copyFileSync(quelle, path.join(target, 'tokens.css'));
else fs.copyFileSync(path.join(siteDir, 'design', 'tokens.css'), path.join(target, 'tokens.css'));
// Tokens, die nur in Page Studio existieren (z. B. im Design-Panel ergänzt), samt Verweisen darin
const extra = [];
const seen = new Set();
const queue = [...usedExtra];
while (queue.length) {
  const v = queue.shift();
  if (seen.has(v)) continue;
  seen.add(v);
  const key = Object.keys(tokens).find((k) => cssVarName(k) === v);
  if (!key) { warnings.push(`${v}: Token nicht gefunden`); continue; }
  const val = tokens[key].value;
  for (const m of val.matchAll(/--dps-[a-z0-9-]+/g)) if (!rename.has(m[0])) queue.push(m[0]);
  extra.push(`  ${v}: ${rewrite(val)};`);
}
const files = ['tokens.css'];
if (map && extra.length) {
  fs.writeFileSync(path.join(target, 'dps-zusatz.css'), `/* Tokens, die nur in Page Studio angelegt wurden (nicht in tokens-quelle.css) */\n:root {\n${extra.sort().join('\n')}\n}\n`);
  files.push('dps-zusatz.css');
  warnings.push(`${extra.length} Token(s) nur in Page Studio angelegt: dps-zusatz.css einbinden oder in tokens-quelle.css übernehmen`);
}
fs.writeFileSync(path.join(target, 'komponenten.css'), components.map((c) => fs.readFileSync(path.join(target, 'komponenten', c.name, 'component.css'), 'utf8').trim()).join('\n\n') + '\n');
files.push('komponenten.css');

const site = readJson(path.join(siteDir, 'site.json'), {});
const links = files.map((f) => `<link rel="stylesheet" href="${f}">`).join('\n');
fs.writeFileSync(path.join(target, 'vorschau.html'), `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(site.title || site.slug || 'Export')} – Komponenten</title>
${links}
<style>.export-hinweis{font:13px/1.4 system-ui,sans-serif;color:#667085;margin:32px auto 8px;max-width:1200px;padding:0 24px}</style>
</head>
<body>
${components.filter((c) => c.html).map((c) => (c.variants
  ? c.variants.map((v) => `<p class="export-hinweis">mx-${esc(c.name)} · ${esc(c.title)} · Variante ${esc(v.label)} (${esc(v.key)})</p>\n${v.html}`).join('\n\n')
  : `<p class="export-hinweis">mx-${esc(c.name)} · ${esc(c.title)}</p>\n${c.html}`)).join('\n\n')}
</body>
</html>
`);
fs.writeFileSync(path.join(target, 'README.md'), `# Komponenten-Export: ${site.title || site.slug}

Erzeugt von Page Studio am ${new Date().toLocaleString('de-DE')}.

## Einbinden
1. ${map ? 'tokens.css (die Variablen des Projekts aus design/tokens-quelle.css)' : 'tokens.css (Design-Tokens als --dps-Variablen)'} einbinden${files.includes('dps-zusatz.css') ? ', dazu dps-zusatz.css' : ''}.
2. komponenten.css einbinden (oder je Komponente component.css). Jede Komponente ist mit @scope (.mx-<name>) gekapselt.
3. Das Markup aus component.html an der gewünschten Stelle einsetzen. Elemente mit data-mx-platzhalter sind im echten Projekt anzubinden.
4. Komponenten aus der Bibliothek haben zusätzlich component.json: Varianten (Klassen auf dem Wurzelelement, data-mx-variant) und austauschbare Inhalte (Elemente mit data-mx-slot, z. B. als Parameter eines Templates).

vorschau.html zeigt alle Komponenten mit diesen Dateien.

## Komponenten
${components.map((c) => `- mx-${c.name}: ${c.title}${c.variants ? ` (Varianten: ${c.variants.map((v) => v.label).join(', ')})` : c.page ? ` (Seite ${c.page})` : ''}`).join('\n')}
${warnings.length ? `\n## Hinweise\n${warnings.map((w) => `- ${w}`).join('\n')}\n` : ''}`);

out({ status: 'ok', dir: target, components: components.map(({ name, title, page, variants }) => ({ name, title, page, ...(variants ? { variants: variants.map((v) => v.key) } : {}) })), files: [...files, 'vorschau.html', 'README.md'], warnings });
