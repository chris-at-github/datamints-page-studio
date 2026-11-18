// Seitenübergreifende Konsistenz: Bereiche aus design/consistency.json (z. B. Header, Footer) müssen
// auf allen Seiten gleich sein. Vergleicht das normalisierte HTML je Bereich und meldet Abweichungen als warn.
// Aufruf: node consistency.mjs <site-dir> [--changed-only]
//   --changed-only  nur Abweichungen melden, die durch die ungespeicherten Änderungen (gegenüber HEAD)
//                   neu entstanden sind oder sich verändert haben
// Ausgabe: eine JSON-Zeile {pages, entries, warnings:[{rule, file, line, text}]}
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// cheerio erst bei Bedarf laden: design.mjs nutzt nur readConfig und soll auch ohne cheerio laufen
let cheerio = null;
export async function loadCheerio() {
  if (cheerio) return cheerio;
  try { cheerio = await import('cheerio'); } catch (e) {
    throw new Error(`cheerio nicht ladbar (Node ${process.version}, benötigt >= 20.18): ${e.message}`);
  }
  return cheerio;
}

const MAX_LIST = 8;

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else if (e.isFile() && /\.html?(@.*)?$/i.test(e.name)) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

// Konfiguration lesen und prüfen; Fehler werden als Hinweis gemeldet, nicht als Abbruch
export function readConfig(text) {
  const errors = [];
  let data;
  try { data = JSON.parse(text); } catch (e) { return { shared: [], ignore: [], errors: [`consistency.json ist kein gültiges JSON: ${e.message}`] }; }
  const shared = [];
  for (const [i, s] of (Array.isArray(data?.shared) ? data.shared : []).entries()) {
    if (!s || typeof s.selector !== 'string' || !s.selector.trim()) { errors.push(`shared[${i}]: selector fehlt`); continue; }
    const pages = s.pages === undefined || s.pages === 'all' ? 'all' : Array.isArray(s.pages) ? s.pages.filter((p) => typeof p === 'string') : null;
    if (!pages) { errors.push(`shared[${i}]: pages muss "all" oder eine Liste von Seitenpfaden sein`); continue; }
    shared.push({ name: typeof s.name === 'string' && s.name.trim() ? s.name.trim() : s.selector, selector: s.selector, pages });
  }
  const ignore = (Array.isArray(data?.ignore) ? data.ignore : []).filter((x) => typeof x === 'string');
  return { shared, ignore, errors };
}

// Prüft Name und Selektor eines Bereichs (landen im Prompt-Kontext): Meldung oder null
export function areaError(name, selector) {
  if (typeof name !== 'string' || !name.trim() || name.length > 60 || /[<{};@\\\n]/.test(name)) return 'Name des Bereichs: 1–60 Zeichen, ohne < { } ; @ \\';
  if (typeof selector !== 'string' || !selector.trim() || selector.length > 200 || /[<{};@\\\n]/.test(selector)) return 'Selektor ungültig (max. 200 Zeichen, ohne < { } ; @ \\)';
  return null;
}

// Normalisiert ein Element: ignorierte Attribute und Klassen entfernen, Attribute sortieren, Leerraum zusammenfassen
// Relative Links seitenunabhängig machen: auf den Pfad im Abzug auflösen (index.html entfällt)
export function resolveLink(v, page) {
  if (!page || !v || /^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(v)) return v;
  try {
    const u = new URL(v, 'http://dps.local/' + page);
    return u.pathname.replace(/(^|\/)index\.html?$/i, '$1') + u.search + u.hash;
  } catch { return v; }
}

export function normalize($, node, ignore, page = '') {
  const ignClasses = new Set(ignore.filter((x) => x.startsWith('class:')).map((x) => x.slice(6)));
  const ignAttrs = new Set(ignore.filter((x) => !x.startsWith('class:')).map((x) => x.replace(/^attr:/, '').toLowerCase()));
  const ser = (n) => {
    if (n.type === 'text') return n.data.replace(/\s+/g, ' ');
    if (n.type !== 'tag' && n.type !== 'script' && n.type !== 'style') return '';
    const attrs = Object.entries(n.attribs || {})
      .filter(([k]) => !ignAttrs.has(k.toLowerCase()))
      .map(([k, v]) => {
        if (k.toLowerCase() === 'class') v = v.split(/\s+/).filter((c) => c && !ignClasses.has(c)).sort().join(' ');
        if (/^(href|src|action|poster)$/i.test(k)) v = resolveLink(v.trim(), page);
        return [k.toLowerCase(), v.replace(/\s+/g, ' ').trim()];
      })
      .filter(([k, v]) => !(k === 'class' && !v))
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([k, v]) => ` ${k}="${v}"`)
      .join('');
    return `<${n.name}${attrs}>${(n.children || []).map(ser).join('')}</${n.name}>`;
  };
  return ser(node).replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
}

// Normalisierte Fassung je Bereich für eine Seite; null, wenn der Bereich fehlt
function extract(html, shared, ignore, page) {
  const $ = cheerio.load(html);
  return shared.map((s) => {
    try {
      const n = $(s.selector).first();
      return n.length ? normalize($, n[0], ignore, page) : null;
    } catch { return undefined; } // ungültiger Selektor
  });
}

// Abweichungen eines Bereichs: Mehrheitsfassung als Referenz, die übrigen Seiten weichen ab.
// Bei Gleichstand gewinnt die Fassung der unveränderten Seiten (dann gilt die geänderte Seite als abweichend).
function deviations(values, changed = new Set()) {
  const counts = new Map();
  for (const [p, v] of values.entries()) {
    if (!v) continue;
    const c = counts.get(v) || [0, 0];
    c[0]++;
    if (!changed.has(p)) c[1]++;
    counts.set(v, c);
  }
  if (counts.size <= 1) return { ref: [...counts.keys()][0] || null, differ: [] };
  const ref = [...counts.entries()].sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1])[0][0];
  return { ref, differ: [...values.entries()].filter(([, v]) => v && v !== ref).map(([p]) => p).sort() };
}

const fmt = (pages) => pages.slice(0, MAX_LIST).map((p) => '/' + p).join(', ') + (pages.length > MAX_LIST ? ` und ${pages.length - MAX_LIST} weitere` : '');

function changedPages(site) {
  const out = execFileSync('git', ['-C', site, 'status', '--porcelain', '-z', '--untracked-files=all', '--', 'www'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const files = new Set();
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (!e) continue;
    const st = e.slice(0, 2);
    files.add(e.slice(3));
    if (st[0] === 'R' || st[0] === 'C') i++; // Quellpfad folgt
  }
  return [...files].filter((f) => f.startsWith('www/') && /\.html?(@.*)?$/i.test(f)).map((f) => f.slice(4));
}

function headVersion(site, page) {
  try { return execFileSync('git', ['-C', site, 'show', `HEAD:www/${page}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; }
}

// Seiten der Website selbst (Ordner der Einstiegsseite), keine mitgeladenen fremden Dokumente; Pfade relativ zu www/
export function sitePages(site) {
  const www = path.join(site, 'www');
  let scope = '';
  try { scope = String(JSON.parse(fs.readFileSync(path.join(site, 'site.json'), 'utf8')).entry || '').split('/')[1] || ''; } catch { /* ohne site.json alles */ }
  if (scope && (scope.includes('..') || !fs.existsSync(path.join(www, scope)))) scope = '';
  return fs.existsSync(www) ? walk(scope ? path.join(www, scope) : www).map((p) => (scope ? scope + '/' : '') + p).sort() : [];
}

export const inScope = (s, p) => s.pages === 'all' || s.pages.some((pre) => ('/' + p).startsWith(pre.startsWith('/') ? pre : '/' + pre));

export async function check(site, { changedOnly = false } = {}) {
  const cfgFile = path.join(site, 'design', 'consistency.json');
  const warnings = [];
  if (!fs.existsSync(cfgFile)) return { pages: 0, entries: 0, warnings };
  const { shared, ignore, errors } = readConfig(fs.readFileSync(cfgFile, 'utf8'));
  for (const e of errors) warnings.push({ rule: 'consistency-config', file: 'design/consistency.json', line: 0, text: e });
  if (!shared.length) return { pages: 0, entries: 0, warnings };
  await loadCheerio();

  const www = path.join(site, 'www');
  const pages = sitePages(site);
  const now = new Map(); // page -> [werte je Bereich]
  for (const p of pages) now.set(p, extract(fs.readFileSync(path.join(www, p), 'utf8'), shared, ignore, p));

  let before = null;
  let changed = [];
  if (changedOnly) {
    changed = changedPages(site);
    if (!changed.length) return { pages: pages.length, entries: shared.length, warnings };
    before = new Map(now);
    for (const p of changed) {
      const old = headVersion(site, p);
      if (old === null) before.delete(p);
      else before.set(p, extract(old, shared, ignore, p));
    }
  }

  shared.forEach((s, i) => {
    const valuesOf = (m) => new Map([...m.entries()].filter(([p]) => inScope(s, p)).map(([p, v]) => [p, v[i]]));
    const cur = valuesOf(now);
    if ([...cur.values()].some((v) => v === undefined)) {
      warnings.push({ rule: 'consistency-config', file: 'design/consistency.json', line: 0, text: `${s.name}: ungültiger Selektor „${s.selector}“` });
      return;
    }
    const missing = s.pages === 'all' ? [] : [...cur.entries()].filter(([, v]) => v === null).map(([p]) => p);
    const d = deviations(cur, new Set(changed));
    if (before) {
      const prev = valuesOf(before);
      const pd = deviations(prev, new Set(changed));
      const pMissing = s.pages === 'all' ? [] : [...prev.entries()].filter(([, v]) => v === null).map(([p]) => p);
      if (d.differ.join('\n') === pd.differ.join('\n') && missing.join('\n') === pMissing.join('\n')) return;
    }
    if (d.differ.length) {
      const others = [...cur.values()].filter((v) => v && v === d.ref).length;
      warnings.push({ rule: 'consistency', file: 'www/' + d.differ[0], line: 0, text: `${s.name} ist nicht auf allen Seiten gleich, anders als auf ${others} weiteren Seite(n): ${fmt(d.differ)}. Angleichen im Design-Panel unter „Gleiche Bereiche“.` });
    }
    if (missing.length) {
      warnings.push({ rule: 'consistency', file: 'www/' + missing[0], line: 0, text: `${s.name} fehlt auf: ${fmt(missing)}` });
    }
  });
  return { pages: pages.length, entries: shared.length, warnings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const site = process.argv[2];
  if (!site || !fs.existsSync(site)) {
    console.error('Aufruf: node consistency.mjs <site-dir> [--changed-only]');
    process.exit(2);
  }
  check(site, { changedOnly: process.argv.includes('--changed-only') })
    .then((r) => process.stdout.write(JSON.stringify(r) + '\n'))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
