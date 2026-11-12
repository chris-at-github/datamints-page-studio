// Analysiert einen Unified-Diff (stdin) auf riskante Änderungen.
// Aufruf: git diff -U0 | node check-diff.mjs <site-dir>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [siteDir, namesFile] = process.argv.slice(2);
const diff = fs.readFileSync(0, 'utf8');
const hits = [];
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

const allowedPath = (f) => f.startsWith('www/') || f === 'overrides.css' || f.startsWith('annotations/');

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
  if (!allowedPath(f)) hits.push({ rule: 'path-outside', file: f, line: 0, text: 'Änderung außerhalb von www/, overrides.css und annotations/' });
}

let file = null;
let line = 0;
for (const raw of diff.split('\n')) {
  const fm = raw.match(/^\+\+\+ b\/(.*)$/);
  if (fm) { file = fm[1]; continue; }
  if (raw.startsWith('--- ')) continue;
  const hm = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
  if (hm) { line = Number(hm[1]); continue; }
  if (!file || !raw.startsWith('+')) continue;
  if (file.startsWith('annotations/')) { line++; continue; } // Metadaten des Skripts
  const text = raw.slice(1);
  const isHtml = /\.(html?|svg|xml)$/i.test(file);
  const isCss = /\.css$/i.test(file);
  for (const r of rules) {
    if (r.html && !isHtml) continue;
    if (r.css && !isCss) continue;
    if (r.re.test(text)) hits.push({ rule: r.rule, file, line, text: text.trim().slice(0, 300) });
  }
  for (const m of text.matchAll(/(?:https?:)?\/\/([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g)) {
    const host = m[1].toLowerCase();
    if (!known.has(host)) hits.push({ rule: 'unknown-domain', file, line, text: `${host}: ${text.trim().slice(0, 200)}` });
  }
  line++;
}

process.stdout.write(JSON.stringify({ files: [...files], hits }));
