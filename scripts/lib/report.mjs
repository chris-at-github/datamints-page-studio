// Erzeugt CHANGES.md aus dem Verlauf seit baseline.
// Aufruf: node report.mjs <site-dir>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const siteDir = process.argv[2];
const git = (...args) => execFileSync('git', ['-C', siteDir, ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
const site = JSON.parse(fs.readFileSync(path.join(siteDir, 'site.json'), 'utf8'));

const fence = (text, lang = '') => {
  let f = '```';
  while (text.includes(f)) f += '`';
  return `${f}${lang}\n${text.replace(/\n$/, '')}\n${f}`;
};

// Overrides-Blöcke je Annotation aus overrides.css (Kommentar /* A-xxx: … */ bis zum nächsten)
function overrideBlocks(css) {
  const blocks = {};
  const re = /\/\*\s*(A-\d+)\s*:[\s\S]*?\*\//g;
  const marks = [...css.matchAll(re)].map((m) => ({ id: m[1], index: m.index }));
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index : css.length;
    blocks[m.id] = (blocks[m.id] ? blocks[m.id] + '\n' : '') + css.slice(m.index, end).trim();
  });
  return blocks;
}

const log = git('log', '--reverse', '--format=%H%x09%aI%x09%s', 'baseline..HEAD').split('\n').filter(Boolean);
const baselineDate = git('log', '-1', '--format=%aI', 'baseline').trim();
const css = fs.existsSync(path.join(siteDir, 'overrides.css')) ? fs.readFileSync(path.join(siteDir, 'overrides.css'), 'utf8') : '';
const blocks = overrideBlocks(css);

const out = [];
const dateDe = (iso) => new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
out.push(`# Änderungen: ${site.host || site.slug}`, '');
out.push(`- URL: ${site.url}`);
out.push(`- Abzug vom: ${site.crawledAt ? dateDe(site.crawledAt) : dateDe(baselineDate)}`);
out.push(`- Zeitraum: ${dateDe(baselineDate)} – ${log.length ? dateDe(log.at(-1).split('\t')[1]) : dateDe(baselineDate)}`);
out.push(`- Anzahl Schritte: ${log.length}`, '');
out.push(
  '> Hinweis: Dieser Report enthält Inhalte fremder Websites und von Claude erzeugten Code. ' +
    'Vor der Verwendung im echten Projekt durchsehen und Claude Code dort nicht mit automatischer Freigabe ausführen.',
  '',
);
out.push(
  'Umsetzung im echten Projekt: Styles aus den `overrides.css`-Blöcken in das jeweilige Stylesheet übertragen, ' +
    'HTML-Änderungen gemäß Diff in die Templates übernehmen.',
  '',
);

for (const line of log) {
  const [commit, date, subject] = line.split('\t');
  const id = (subject.match(/^\[(A-\d+)\]/) || [])[1] || null;
  let ann = {};
  if (id) {
    try { ann = JSON.parse(git('show', `${commit}:annotations/${id}.json`)); } catch { /* manuelle Änderung */ }
  }
  out.push(`## ${id || commit.slice(0, 10)}${ann.prompt ? '' : ': ' + subject}`, '');
  out.push(`- Datum: ${dateDe(date)}`, `- Commit: \`${commit.slice(0, 10)}\``);
  if (ann.page) out.push(`- Seite: \`${ann.page}\``);
  if (ann.selector) out.push(`- Selektor: \`${ann.selector.replace(/`/g, "'")}\``);
  if (ann.thorough) out.push('- Modus: gründlich');
  out.push('');
  if (ann.prompt) out.push('**Prompt**', '', ann.prompt.split('\n').map((l) => '> ' + l).join('\n'), '');
  const refs = ann.references || [];
  if (refs.length) {
    out.push('**Referenzbilder**', '');
    refs.forEach((r, i) => {
      if (r.path) out.push(`![Referenz ${i + 1}](${r.path})${r.sourceUrl ? `  \nQuelle: <${r.sourceUrl}>` : ''}`, '');
      else if (r.error) out.push(`- Referenz ${i + 1}: nicht übernommen (${r.error})`, '');
    });
  }
  if (ann.result?.summary) out.push('**Zusammenfassung (Claude)**', '', ann.result.summary.trim(), '');
  const files = git('show', '--format=', '--name-only', commit).split('\n').filter((f) => f && !f.startsWith('annotations/'));
  if (files.length) out.push('**Betroffene Dateien**', '', ...files.map((f) => `- \`${f}\``), '');
  if (id && blocks[id]) out.push('**overrides.css**', '', fence(blocks[id], 'css'), '');
  const htmlDiff = git('show', '--format=', '--no-color', commit, '--', ':(glob)www/**/*.htm', ':(glob)www/**/*.html');
  if (htmlDiff.trim()) {
    const max = 60000;
    const d = htmlDiff.length > max ? htmlDiff.slice(0, max) + '\n… (gekürzt)' : htmlDiff;
    out.push('**HTML-Diff**', '', fence(d, 'diff'), '');
  }
  for (const shot of ['before', 'after']) {
    const p = `annotations/assets/${id}-${shot}.png`;
    if (id && fs.existsSync(path.join(siteDir, p))) out.push(`![${shot === 'before' ? 'Vorher' : 'Nachher'}](${p})`, '');
  }
}

out.push('## Vollständige overrides.css', '', css.trim() ? fence(css, 'css') : '_leer_', '');
fs.writeFileSync(path.join(siteDir, 'CHANGES.md'), out.join('\n'));
process.stdout.write(JSON.stringify({ file: 'CHANGES.md', steps: log.length }));
