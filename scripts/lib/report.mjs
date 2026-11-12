// Erzeugt CHANGES.md aus dem Verlauf seit baseline.
// Aufruf: node report.mjs <site-dir>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseTokens, cssVarName } from './design.mjs';

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

// ---------- Design-Vorgaben (Grundlage für SCSS-Variablen oder ein Theme im echten Projekt) ----------
const readSite = (f) => { try { return fs.readFileSync(path.join(siteDir, f), 'utf8'); } catch { return null; } };
const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const tokensText = readSite('design/tokens.json');
out.push('## Design-Vorgaben', '');
if (tokensText === null) {
  out.push('_Für diesen Abzug sind keine Design-Vorgaben angelegt._', '');
} else {
  const { tokens, errors } = parseTokens(tokensText);
  const keys = Object.keys(tokens).sort();
  out.push('### Tokens', '');
  if (errors.length) out.push(`> Achtung: tokens.json ist ungültig: ${errors.join('; ')}`, '');
  if (keys.length) {
    out.push('| Token | Wert | CSS-Variable | Gesperrt | Notiz |', '|---|---|---|---|---|');
    for (const k of keys) {
      const t = tokens[k];
      out.push(`| \`${k}\` | \`${cell(t.value)}\` | \`${cssVarName(k)}\` | ${t.locked ? 'ja' : 'nein'} | ${cell(t.note || '')} |`);
    }
    out.push('');
  } else out.push('_Noch keine Tokens._', '');
  const notes = (readSite('design/notes.md') || '').trim();
  out.push('### Regeln (notes.md)', '', notes ? fence(notes, 'markdown') : '_Keine Regeln._', '');
  const tcss = readSite('design/tokens.css');
  if (tcss) out.push('### tokens.css', '', fence(tcss, 'css'), '');
}

const totals = { cost: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0, counted: 0 };

for (const line of log) {
  const [commit, date, subject] = line.split('\t');
  const id = (subject.match(/^\[(A-\d+)\]/) || [])[1] || null;
  let ann = {};
  if (id) {
    try { ann = JSON.parse(git('show', `${commit}:annotations/${id}.json`)); } catch { /* manuelle Änderung */ }
  }
  const isDesign = !id && subject.startsWith('[design]');
  const isPages = !id && subject.startsWith('[seiten]');
  out.push(`## ${id || (isDesign ? 'Design' : isPages ? 'Seiten' : commit.slice(0, 10))}${ann.prompt ? '' : ': ' + subject.replace(/^\[(design|seiten)\]\s*/, '')}`, '');
  out.push(`- Datum: ${dateDe(date)}`, `- Commit: \`${commit.slice(0, 10)}\``);
  if (isPages) {
    // Neue Seiten: URLs aus der Commit-Nachricht statt eines riesigen Diffs
    const urls = git('show', '-s', '--format=%b', commit).split('\n').map((l) => l.trim()).filter((l) => /^https?:\/\//.test(l));
    const changed = git('show', '--format=', '--name-status', commit).split('\n').filter(Boolean);
    const added = changed.filter((l) => l.startsWith('A')).length;
    const modified = changed.filter((l) => l.startsWith('M') && /\.html?$/i.test(l)).length;
    out.push('', '**Hinzugefügte Seiten**', '', ...urls.map((u) => `- <${u}>`), '');
    out.push(`${added} Datei(en) neu im Abzug, Links in ${modified} vorhandenen Seite(n) auf lokale Seiten umgeschrieben.`, '');
    continue;
  }
  if (ann.page) out.push(`- Seite: \`${ann.page}\``);
  if (ann.selector) out.push(`- Selektor: \`${ann.selector.replace(/`/g, "'")}\``);
  if (ann.thorough) out.push('- Modus: gründlich');
  if (ann.remember) out.push('- Als Regel gemerkt: ja');
  if (ann.followup) out.push(`- Nachbesserung${ann.followup_of ? ' zu ' + ann.followup_of : ''}`);
  if (ann.allow_token_change) out.push('- Gesperrte Tokens durften geändert werden');
  out.push('');
  const r = ann.result || {};
  if (r.costUsd != null || r.usage) {
    totals.counted++;
    totals.cost += Number(r.costUsd || 0);
    totals.input += Number(r.usage?.input_tokens || 0);
    totals.output += Number(r.usage?.output_tokens || 0);
    totals.cacheRead += Number(r.usage?.cache_read_input_tokens || 0);
    totals.cacheCreation += Number(r.usage?.cache_creation_input_tokens || 0);
  }
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
  const designDiff = git('show', '--format=', '--no-color', commit, '--', 'design/tokens.json', 'design/notes.md');
  if (designDiff.trim()) out.push('**Token- und Regeländerungen**', '', fence(designDiff, 'diff'), '');
  const warns = ann.check?.warnings || [];
  if (warns.length) out.push('**Hinweise der Prüfung**', '', ...warns.map((w) => `- ${w.rule}: ${String(w.text || '').replace(/\n/g, ' ')}`), '');
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
if (totals.counted) {
  out.push('## Nutzung und Kosten', '');
  out.push(`Erfasst für ${totals.counted} Schritt(e):`, '');
  out.push(`- Kosten: ${totals.cost.toFixed(4)} USD`);
  out.push(`- Eingabe-Tokens (neu verarbeitet): ${totals.input}`);
  out.push(`- Cache-Treffer (gelesen): ${totals.cacheRead}`);
  out.push(`- Cache geschrieben: ${totals.cacheCreation}`);
  out.push(`- Ausgabe-Tokens: ${totals.output}`, '');
}
fs.writeFileSync(path.join(siteDir, 'CHANGES.md'), out.join('\n'));
process.stdout.write(JSON.stringify({ file: 'CHANGES.md', steps: log.length }));
