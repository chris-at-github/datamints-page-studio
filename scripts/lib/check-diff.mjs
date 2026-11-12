// Analysiert einen Unified-Diff (stdin) auf riskante Änderungen.
// Aufruf: git diff -U0 | node check-diff.mjs <site-dir> <names-file>
// Umgebung: CHECK_REMEMBER=true (notes.md darf geändert werden), CHECK_ALLOW_TOKEN_CHANGE=true (gesperrte Tokens dürfen geändert werden)
// Ausgabe: { files, hits (Stufe block), warnings (Stufe warn) }
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseTokens, buildCss, validateNotes, NOTES_MAX_LINES } from './design.mjs';

const [siteDir, namesFile] = process.argv.slice(2);
const REMEMBER = process.env.CHECK_REMEMBER === 'true';
const ALLOW_TOKEN_CHANGE = process.env.CHECK_ALLOW_TOKEN_CHANGE === 'true';
const diff = fs.readFileSync(0, 'utf8');
const hits = [];
const warnings = [];
const files = new Set();

// Bekannte Domains: alle Hosts, die im letzten Commit bereits vorkommen
const known = new Set();
try {
  const out = execFileSync('git', ['-C', siteDir, 'grep', '-hoIE', '(https?:)?//[A-Za-z0-9.-]+\\.[A-Za-z]{2,}', 'HEAD', '--'], {
    maxBuffer: 256 * 1024 * 1024,
    encoding: 'latin1',
  });
  for (const m of out.split('\n')) if (m) known.add(m.replace(/^(https?:)?\/\//i, '').toLowerCase());
} catch {
  /* keine Treffer */
}
const site = JSON.parse(fs.readFileSync(path.join(siteDir, 'site.json'), 'utf8'));
if (site.host) known.add(site.host.toLowerCase());

const allowedPath = (f) => f.startsWith('www/') || f === 'overrides.css' || f.startsWith('annotations/') || f.startsWith('design/');

const rules = [
  { rule: 'script-tag', re: /<\s*script\b/i },
  { rule: 'event-handler', re: /<[^>]*\son[a-z]+\s*=|\son[a-z]+\s*=\s*["'][^"']*["']/i, html: true },
  { rule: 'iframe', re: /<\s*iframe\b/i },
  { rule: 'object-embed', re: /<\s*(object|embed)\b/i },
  { rule: 'javascript-url', re: /javascript\s*:/i },
  { rule: 'css-expression', re: /expression\s*\(|-moz-binding|behavior\s*:/i, css: true },
  { rule: 'meta-refresh', re: /http-equiv\s*=\s*["']?refresh/i },
  { rule: 'base-tag', re: /<\s*base\b/i },
  { rule: 'form-action', re: /<\s*form\b[^>]*action\s*=\s*["']?(https?:)?\/\//i },
];

// Geänderte Pfade (auch Binärdateien und Löschungen)
for (const f of fs.readFileSync(namesFile, 'utf8').split('\0').filter(Boolean)) {
  files.add(f);
  if (!allowedPath(f)) hits.push({ rule: 'path-outside', file: f, line: 0, text: 'Änderung außerhalb von www/, overrides.css, design/ und annotations/' });
}

// Hunks sammeln: entfernte und hinzugefügte Zeilen je Abschnitt. Gemeldet wird nur, was eine Änderung neu
// hinzufügt (in den neuen Zeilen häufiger als in den entfernten). Wichtig bei minifizierten Seiten, auf denen
// die ganze Seite in einer Zeile steht und vorhandene Scripts sonst bei jeder Änderung auffallen würden.
const hunks = [];
{
  let file = null, cur = null, line = 0;
  for (const raw of diff.split('\n')) {
    const fm = raw.match(/^\+\+\+ b\/(.*)$/);
    if (fm) { file = fm[1]; cur = null; continue; }
    if (raw.startsWith('--- ')) continue;
    const hm = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hm) { line = Number(hm[1]); cur = { file, removed: [], added: [] }; hunks.push(cur); continue; }
    if (!file || !cur) continue;
    if (raw.startsWith('-')) cur.removed.push(raw.slice(1));
    else if (raw.startsWith('+')) { cur.added.push({ text: raw.slice(1), line }); line++; }
  }
}
const countOf = (re, texts) => texts.reduce((n, t) => n + (t.match(new RegExp(re.source, re.flags.replace('g', '') + 'g')) || []).length, 0);
for (const h of hunks) {
  if (!h.file || h.file.startsWith('annotations/')) continue; // Metadaten des Skripts
  const isHtml = /\.(html?|svg|xml)$/i.test(h.file);
  const isCss = /\.css$/i.test(h.file);
  const addedTexts = h.added.map((a) => a.text);
  for (const r of rules) {
    if (r.html && !isHtml) continue;
    if (r.css && !isCss) continue;
    if (countOf(r.re, addedTexts) <= countOf(r.re, h.removed)) continue;
    const at = h.added.find((a) => r.re.test(a.text));
    const m = at.text.match(r.re);
    const from = Math.max(0, (m ? m.index : 0) - 80);
    hits.push({ rule: r.rule, file: h.file, line: at.line, text: at.text.slice(from, from + 300).trim() });
  }
  const hostRe = /(?:https?:)?\/\/([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
  const before = new Set(h.removed.flatMap((t) => [...t.matchAll(hostRe)].map((m) => m[1].toLowerCase())));
  for (const a of h.added) {
    for (const m of a.text.matchAll(hostRe)) {
      const host = m[1].toLowerCase();
      if (!known.has(host) && !before.has(host)) {
        const from = Math.max(0, m.index - 80);
        hits.push({ rule: 'unknown-domain', file: h.file, line: a.line, text: `${host}: ${a.text.slice(from, from + 200).trim()}` });
      }
    }
  }
}

// ---------- Design-Vorgaben ----------
const readWork = (f) => { try { return fs.readFileSync(path.join(siteDir, f), 'utf8'); } catch { return null; } };
const readHead = (f) => { try { return execFileSync('git', ['-C', siteDir, 'show', `HEAD:${f}`], { encoding: 'utf8' }); } catch { return null; } };

const tokensText = readWork('design/tokens.json');
const tokensHeadText = readHead('design/tokens.json');
const newTokens = tokensText === null ? { tokens: {}, errors: [] } : parseTokens(tokensText);
const oldTokens = tokensHeadText === null ? { tokens: {}, errors: [] } : parseTokens(tokensHeadText);

if (files.has('design/tokens.json')) {
  if (tokensText === null && tokensHeadText !== null) {
    hits.push({ rule: 'tokens-removed', file: 'design/tokens.json', line: 0, text: 'design/tokens.json wurde gelöscht' });
  }
  for (const e of newTokens.errors) hits.push({ rule: 'tokens-invalid', file: 'design/tokens.json', line: 0, text: e });
  if (!newTokens.errors.length) {
    for (const [key, t] of Object.entries(oldTokens.tokens)) {
      if (t.locked !== true) continue;
      const n = newTokens.tokens[key];
      let what = null;
      if (!n) what = 'entfernt';
      else if (n.value.trim() !== t.value.trim()) what = `Wert ${t.value} → ${n.value}`;
      else if (n.locked !== true) what = 'Sperre aufgehoben';
      if (what && !ALLOW_TOKEN_CHANGE) hits.push({ rule: 'token-locked', file: 'design/tokens.json', line: 0, text: `${key} (gesperrt): ${what}` });
    }
    for (const [key, t] of Object.entries(newTokens.tokens)) {
      if (!oldTokens.tokens[key] && t.locked !== true) warnings.push({ rule: 'token-new', file: 'design/tokens.json', line: 0, text: `Neuer Token ${key} = ${t.value}` });
    }
  }
}

// tokens.css wird generiert: geändert ist nur erlaubt, wenn sie exakt dem Build-Ergebnis entspricht
if (files.has('design/tokens.css')) {
  const css = readWork('design/tokens.css');
  const expected = newTokens.errors.length ? null : buildCss(newTokens.tokens);
  if (css !== expected) hits.push({ rule: 'tokens-css-manual', file: 'design/tokens.css', line: 0, text: 'design/tokens.css von Hand geändert (wird aus tokens.json erzeugt)' });
}

if (files.has('design/notes.md')) {
  if (!REMEMBER) hits.push({ rule: 'notes-without-remember', file: 'design/notes.md', line: 0, text: 'notes.md geändert, obwohl „Als Regel merken“ nicht gesetzt war' });
  const notes = readWork('design/notes.md');
  if (notes !== null) for (const e of validateNotes(notes, NOTES_MAX_LINES)) hits.push({ rule: 'notes-content', file: 'design/notes.md', line: 0, text: e });
}

// consistency.json steuert die Konsistenzprüfung: nur mit „Als Regel merken“ änderbar
if (files.has('design/consistency.json') && !REMEMBER) {
  hits.push({ rule: 'consistency-changed', file: 'design/consistency.json', line: 0, text: 'consistency.json geändert, obwohl „Als Regel merken“ nicht gesetzt war' });
}

// Hinweis: Literalwert in overrides.css, für den es einen Token gibt (nur Farben und Schriften)
if (!newTokens.errors.length) {
  const candidates = Object.entries(newTokens.tokens)
    .filter(([k]) => k.startsWith('color.') || k.startsWith('font.'))
    .map(([k, t]) => ({ key: k, value: t.value.trim(), lower: t.value.trim().toLowerCase() }))
    .filter((c) => c.value.length >= 3);
  let f = null, ln = 0;
  for (const raw of diff.split('\n')) {
    const fm = raw.match(/^\+\+\+ b\/(.*)$/);
    if (fm) { f = fm[1]; continue; }
    const hm = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hm) { ln = Number(hm[1]); continue; }
    if (f !== 'overrides.css' || !raw.startsWith('+') || raw.startsWith('+++')) continue;
    const text = raw.slice(1);
    const lower = text.toLowerCase();
    for (const c of candidates) {
      const i = lower.indexOf(c.lower);
      if (i < 0) continue;
      const before = lower[i - 1] || ' ';
      const after = lower[i + c.lower.length] || ' ';
      if (/[a-z0-9-]/.test(before) || /[a-z0-9]/.test(after)) continue; // nur ganze Werte
      warnings.push({ rule: 'token-literal', file: f, line: ln, text: `Token verwenden: var(--modio-${c.key.replace('.', '-')}) statt ${c.value}` });
    }
    ln++;
  }
}

process.stdout.write(JSON.stringify({ files: [...files], hits, warnings }));
