// Design-Gedächtnis einer Website: Tokens prüfen und als CSS erzeugen, notes.md prüfen,
// Kontextblock für Claude bauen, CSS-Werte im Abzug zählen, Token-Vorschläge übernehmen.
// Aufruf: node design.mjs <befehl> <site-dir> [argumente]
//   build                         tokens.json prüfen und design/tokens.css schreiben
//   context <annotation-id> <n>   Kontextblock (Vorgaben + letzte n Schritte)
//   scan                          häufige Farben, Radien, Schriften, Schriftgrößen nach .scan.json
//   save <payload.json>           Tokens, notes.md und/oder consistency.json von Hand übernehmen (geprüft)
//   merge <proposals.json>        Token-Vorschläge mit locked:false übernehmen (nur Werte aus .scan.json)
// Ausgabe: eine JSON-Zeile auf stdout. Exit 0 ok, 3 Prüfung nötig, 1 Fehler.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readConfig as readConsistency, areaError } from './consistency.mjs';

export const CATEGORIES = ['color', 'font', 'size', 'radius', 'space', 'shadow', 'breakpoint'];
const KEY_RE = new RegExp(`^(${CATEGORIES.join('|')})\\.[a-z0-9]+(?:-[a-z0-9]+)*$`);
const FORBIDDEN = ['url(', '@', ';', '{', '}', '<', '>', '\\', '/*', '*/', '\n', '\r'];
const ALLOWED_FUNCS = new Set(['rgb', 'rgba', 'hsl', 'hsla']);
const MEASURE = '(?:-?(?:\\d+\\.?\\d*|\\.\\d+)(?:px|rem|em|%|vw|vh|vmin|vmax|ch|ex|pt)?)';
const MEASURES_RE = new RegExp(`^${MEASURE}(?:\\s+${MEASURE}){0,3}$`, 'i');
const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FN_RE = /^(?:rgba?|hsla?)\((?:[0-9.,%\s/+-]|deg|turn|rad)+\)$/i;
const COLOR_NAME_RE = /^[a-z]{3,20}$/i;
const FONT_NAME = `(?:"[^"\\n]{1,60}"|'[^'\\n]{1,60}'|[A-Za-z0-9][A-Za-z0-9 -]{0,60})`;
const FONT_RE = new RegExp(`^\\s*${FONT_NAME}\\s*(?:,\\s*${FONT_NAME}\\s*)*$`);
const SHADOW_RE = /^(?:[a-z0-9#.,%()\s/+-])+$/i;

export const cssVarName = (key) => '--modio-' + key.replace('.', '-');
export const NOTES_MAX_LINES = Number(process.env.NOTES_MAX_LINES || 40);

function isColor(v) {
  return HEX_RE.test(v) || COLOR_FN_RE.test(v) || COLOR_NAME_RE.test(v);
}

// Prüft einen einzelnen Wert; gibt eine Fehlermeldung oder null zurück.
export function checkValue(key, value) {
  if (typeof value !== 'string' || !value.trim()) return 'Wert fehlt';
  const v = value.trim();
  if (v.length > 200) return 'Wert zu lang';
  const bad = FORBIDDEN.find((f) => v.toLowerCase().includes(f));
  if (bad) return `unzulässiges Zeichen „${bad.trim() || 'Zeilenumbruch'}“`;
  for (const m of v.matchAll(/([a-z-]+)\s*\(/gi)) {
    if (!ALLOWED_FUNCS.has(m[1].toLowerCase())) return `Funktion ${m[1]}() nicht erlaubt`;
  }
  const cat = key.split('.')[0];
  switch (cat) {
    case 'color':
      return isColor(v) ? null : 'keine gültige Farbe (Hex, rgb(a), hsl(a) oder Farbname)';
    case 'font':
      return FONT_RE.test(v) ? null : 'keine gültige Schriftliste';
    case 'size':
    case 'radius':
    case 'space':
    case 'breakpoint':
      return MEASURES_RE.test(v) ? null : 'kein gültiges Maß (Zahl mit Einheit)';
    case 'shadow':
      return SHADOW_RE.test(v) ? null : 'kein gültiger Schatten';
    default:
      return 'unbekannte Kategorie';
  }
}

// Prüft eine geparste tokens.json; gibt { tokens, errors } zurück.
export function validateTokens(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { tokens: {}, errors: ['tokens.json muss ein Objekt sein'] };
  const tokens = data.tokens ?? {};
  if (typeof tokens !== 'object' || Array.isArray(tokens)) return { tokens: {}, errors: ['"tokens" muss ein Objekt sein'] };
  for (const [key, t] of Object.entries(tokens)) {
    if (!KEY_RE.test(key)) { errors.push(`${key}: ungültiger Schlüssel (erlaubt: ${CATEGORIES.join(', ')} + .name)`); continue; }
    if (!t || typeof t !== 'object' || Array.isArray(t)) { errors.push(`${key}: Eintrag muss ein Objekt sein`); continue; }
    const err = checkValue(key, t.value);
    if (err) errors.push(`${key}: ${err}`);
    if (t.locked !== undefined && typeof t.locked !== 'boolean') errors.push(`${key}: "locked" muss true oder false sein`);
    if (t.note !== undefined && (typeof t.note !== 'string' || t.note.length > 200 || /[<>\n]/.test(t.note))) {
      errors.push(`${key}: "note" muss kurzer Text ohne < > sein`);
    }
  }
  return { tokens, errors };
}

export function parseTokens(text) {
  try { return validateTokens(JSON.parse(text)); } catch (e) { return { tokens: {}, errors: [`kein gültiges JSON: ${e.message}`] }; }
}

export function buildCss(tokens) {
  const lines = Object.keys(tokens).sort().map((k) => `  ${cssVarName(k)}: ${tokens[k].value.trim()};`);
  return `/* generiert aus tokens.json, nicht von Hand ändern */\n:root {\n${lines.join('\n')}${lines.length ? '\n' : ''}}\n`;
}

// Prüft notes.md; gibt eine Liste von Fehlern zurück.
export function validateNotes(text, maxLines = NOTES_MAX_LINES) {
  const errors = [];
  const lines = text.replace(/\n+$/, '').split('\n');
  if (lines.length > maxLines) errors.push(`notes.md hat ${lines.length} Zeilen (höchstens ${maxLines})`);
  if (/https?:\/\/|\bwww\.|(^|[\s(])\/\/[a-z0-9]/i.test(text)) errors.push('notes.md enthält eine URL');
  if (/<\/?[a-z!][^>]*>/i.test(text)) errors.push('notes.md enthält HTML');
  if (/^\s*(```|~~~)/m.test(text)) errors.push('notes.md enthält einen Codeblock');
  return errors;
}

// Text für den Prompt: keine Block-Tags, keine spitzen Klammern
const neutral = (s) => String(s ?? '').replace(/</g, '‹').replace(/>/g, '›');
const oneLine = (s, max) => {
  const t = neutral(s).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};

const read = (f, fallback = null) => { try { return fs.readFileSync(f, 'utf8'); } catch { return fallback; } };
const git = (site, ...args) => execFileSync('git', ['-C', site, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

export function tokenLines(tokens) {
  return Object.keys(tokens).sort().map((k) => {
    const t = tokens[k];
    return `${k} = ${t.value.trim()} → var(${cssVarName(k)})${t.locked ? ' [gesperrt]' : ''}${t.note ? ' – ' + oneLine(t.note, 120) : ''}`;
  });
}

function context(site, currentId, count) {
  const { tokens } = parseTokens(read(path.join(site, 'design/tokens.json'), '{}'));
  const notesRaw = read(path.join(site, 'design/notes.md'), '').trim();
  // Nur Überschriften (leere Vorlage) zählt nicht als Regel
  const notes = notesRaw.split('\n').some((l) => l.trim() && !/^#+\s/.test(l.trim())) ? notesRaw : '';
  const tl = tokenLines(tokens);
  // Seitenübergreifend gleiche Bereiche aus consistency.json
  let shared = [];
  try {
    const c = JSON.parse(read(path.join(site, 'design/consistency.json'), '{}'));
    shared = (Array.isArray(c.shared) ? c.shared : [])
      .filter((x) => x && typeof x.selector === 'string')
      .map((x) => `${oneLine(x.name || x.selector, 60)}: ${x.selector.replace(/\s+/g, " ").trim().slice(0, 120).replace(/</g, "‹")} (${x.pages === undefined || x.pages === 'all' ? 'alle Seiten' : 'ausgewählte Seiten'})`);
  } catch { /* ungültig, meldet check-consistency */ }
  const vorgaben = [
    '<vorgaben prioritaet="verbindlich">',
    '<tokens>',
    tl.length ? tl.join('\n') : '(noch keine Tokens)',
    '</tokens>',
    '<regeln>',
    notes ? neutral(notes) : '(noch keine Regeln)',
    '</regeln>',
    ...(shared.length ? ['<gleiche-bereiche hinweis="auf allen betroffenen Seiten identisch ändern">', shared.join('\n').replace(/</g, '‹'), '</gleiche-bereiche>'] : []),
    '</vorgaben>',
  ].join('\n');

  // Nur Schritte, die im aktuellen Stand committet sind (nach einem Rücksprung automatisch weniger)
  let ids = [];
  try {
    ids = git(site, 'ls-tree', '--name-only', 'HEAD', 'annotations/')
      .split('\n')
      .map((f) => (f.match(/^annotations\/(A-\d+)\.json$/) || [])[1])
      .filter((id) => id && id !== currentId)
      .sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
  } catch { /* noch kein Commit */ }
  const steps = ids.slice(-count).map((id) => {
    let a = {};
    try { a = JSON.parse(git(site, 'show', `HEAD:annotations/${id}.json`)); } catch { /* defekt */ }
    return `${id} | Prompt: ${oneLine(a.prompt, 140)} | Ergebnis: ${oneLine(a.result?.summary || '–', 140)}`;
  });
  const verlauf = ['<bisherige-schritte>', steps.length ? steps.join('\n') : '(keine)', '</bisherige-schritte>'].join('\n');
  return { context: `${vorgaben}\n${verlauf}`, vorgabenBytes: Buffer.byteLength(vorgaben), steps: steps.length, tokens: tl.length };
}

// ---------- Scan des Abzugs ----------

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function normColor(c) {
  let v = c.trim().toLowerCase().replace(/\s+/g, '');
  if (/^#[0-9a-f]{3}$/.test(v)) v = '#' + v.slice(1).split('').map((x) => x + x).join('');
  if (/^#[0-9a-f]{6}ff$/.test(v)) v = v.slice(0, 7);
  return v;
}
const normFont = (f) => f.trim().replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').replace(/\s*!important$/i, '');
const normMeasure = (m) => m.trim().replace(/\s+/g, ' ').replace(/\s*!important$/i, '').toLowerCase();

function scan(site) {
  const www = path.join(site, 'www');
  const files = fs.existsSync(www) ? walk(www) : [];
  const counts = { color: new Map(), radius: new Map(), font: new Map(), fontSize: new Map() };
  const inc = (m, k) => { if (k) m.set(k, (m.get(k) || 0) + 1); };
  let cssFiles = 0;
  for (const f of files) {
    const isCss = /\.css(@|$)/i.test(f);
    const isHtml = /\.html?(@|$)/i.test(f);
    if (!isCss && !isHtml) continue;
    let text = read(f, '');
    if (isHtml) {
      const parts = [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
      parts.push(...[...text.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)].map((m) => m[1]));
      text = parts.join('\n');
    } else cssFiles++;
    text = text.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of text.matchAll(/#[0-9a-f]{3,8}\b|(?:rgba?|hsla?)\([^)]*\)/gi)) {
      const c = normColor(m[0]);
      if (!checkValue('color.x', c)) inc(counts.color, c);
    }
    for (const m of text.matchAll(/border-radius\s*:\s*([^;}{]+)/gi)) {
      const v = normMeasure(m[1]);
      if (!checkValue('radius.x', v)) inc(counts.radius, v);
    }
    for (const m of text.matchAll(/font-family\s*:\s*([^;}{]+)/gi)) {
      const v = normFont(m[1]);
      if (!checkValue('font.x', v) && !/^(inherit|initial|unset|revert)$/i.test(v)) inc(counts.font, v);
    }
    for (const m of text.matchAll(/font-size\s*:\s*([^;}{]+)/gi)) {
      const v = normMeasure(m[1]);
      if (!checkValue('size.x', v)) inc(counts.fontSize, v);
    }
  }
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, count]) => ({ value, count }));
  const result = {
    scanned: new Date().toISOString(),
    files: cssFiles,
    colors: top(counts.color, 24),
    radii: top(counts.radius, 10),
    fonts: top(counts.font, 10),
    fontSizes: top(counts.fontSize, 12),
  };
  fs.writeFileSync(path.join(site, '.scan.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

// ---------- Schreiben ----------

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

const stringifyTokens = (tokens) => JSON.stringify({ tokens }, null, 2) + '\n';

function build(site) {
  const file = path.join(site, 'design/tokens.json');
  const text = read(file);
  if (text === null) return { code: 1, out: { status: 'error', error: 'design/tokens.json fehlt' } };
  const { tokens, errors } = parseTokens(text);
  if (errors.length) return { code: 3, out: { status: 'review', error: 'tokens.json abgelehnt: ' + errors.join('; '), errors } };
  writeAtomic(path.join(site, 'design/tokens.css'), buildCss(tokens));
  return { code: 0, out: { status: 'ok', tokens: Object.keys(tokens).length } };
}

function save(site, payloadFile) {
  let payload;
  try { payload = JSON.parse(read(payloadFile, '')); } catch { return { code: 1, out: { status: 'error', error: 'Eingabe ist kein gültiges JSON' } }; }
  const errors = [];
  let tokens = null;
  if (payload.tokens !== undefined) {
    const r = validateTokens({ tokens: payload.tokens });
    errors.push(...r.errors);
    tokens = r.tokens;
  }
  if (payload.notes !== undefined) {
    if (typeof payload.notes !== 'string') errors.push('notes muss Text sein');
    else errors.push(...validateNotes(payload.notes));
  }
  let consistency = null;
  if (payload.consistency !== undefined) {
    const c = payload.consistency;
    if (!c || typeof c !== 'object' || Array.isArray(c)) errors.push('consistency muss ein Objekt sein');
    else {
      const r = readConsistency(JSON.stringify(c));
      errors.push(...r.errors.map((e) => 'consistency: ' + e));
      const bad = r.shared.map((x) => areaError(x.name, x.selector)).find(Boolean);
      if (bad) errors.push(`consistency: ${bad}`);
      if (r.ignore.some((x) => !/^(class:)?[A-Za-z0-9_:-]{1,60}$/.test(x))) errors.push('consistency: ignore enthält ungültige Einträge');
      consistency = { shared: r.shared, ignore: r.ignore };
    }
  }
  if (tokens === null && payload.notes === undefined && consistency === null) errors.push('Weder Tokens, Regeln noch Konsistenzbereiche übergeben');
  if (errors.length) return { code: 3, out: { status: 'review', error: errors.join('; '), errors } };
  if (tokens !== null) writeAtomic(path.join(site, 'design/tokens.json'), stringifyTokens(tokens));
  if (payload.notes !== undefined) writeAtomic(path.join(site, 'design/notes.md'), payload.notes.replace(/\s*$/, '\n'));
  if (consistency !== null) writeAtomic(path.join(site, 'design/consistency.json'), JSON.stringify(consistency, null, 2) + '\n');
  return build(site);
}

function merge(site, proposalsFile) {
  let proposals;
  try { proposals = JSON.parse(read(proposalsFile, '')); } catch { return { code: 1, out: { status: 'error', error: 'Vorschläge sind kein gültiges JSON' } }; }
  const list = Array.isArray(proposals) ? proposals : proposals?.tokens;
  if (!Array.isArray(list)) return { code: 1, out: { status: 'error', error: 'Vorschläge: Liste "tokens" fehlt' } };
  const scanData = JSON.parse(read(path.join(site, '.scan.json'), '{}'));
  const allowed = new Set();
  for (const c of scanData.colors || []) allowed.add('color|' + normColor(c.value));
  for (const r of scanData.radii || []) allowed.add('measure|' + normMeasure(r.value));
  for (const s of scanData.fontSizes || []) allowed.add('measure|' + normMeasure(s.value));
  for (const f of scanData.fonts || []) allowed.add('font|' + normFont(f.value));
  const kindOf = (key) => {
    const cat = key.split('.')[0];
    if (cat === 'color') return 'color';
    if (cat === 'font') return 'font';
    return 'measure';
  };
  const norm = { color: normColor, font: normFont, measure: normMeasure };

  const file = path.join(site, 'design/tokens.json');
  const current = parseTokens(read(file, '{"tokens":{}}'));
  if (current.errors.length) return { code: 3, out: { status: 'review', error: 'Bestehende tokens.json ist ungültig: ' + current.errors.join('; ') } };
  const tokens = { ...current.tokens };
  const added = [];
  const skipped = [];
  for (const p of list.slice(0, 40)) {
    const key = String(p?.key || '');
    const kind = KEY_RE.test(key) ? kindOf(key) : null;
    const value = kind ? norm[kind](String(p?.value || '')) : '';
    let reason = null;
    if (!kind) reason = 'ungültiger Schlüssel';
    else if (tokens[key]) reason = 'existiert bereits';
    else if (!allowed.has(`${kind}|${value}`)) reason = 'Wert nicht im Scan';
    else reason = checkValue(key, value);
    if (reason) { skipped.push({ key, value, reason }); continue; }
    const note = typeof p.note === 'string' ? p.note.replace(/[<>\n]/g, ' ').slice(0, 200).trim() : '';
    tokens[key] = { value, locked: false, ...(note ? { note } : {}) };
    added.push(key);
  }
  if (added.length) writeAtomic(file, stringifyTokens(tokens));
  const b = build(site);
  if (b.code !== 0) return b;
  return { code: 0, out: { status: 'ok', added, skipped } };
}

// ---------- CLI ----------

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, site, ...rest] = process.argv.slice(2);
  let r;
  try {
    switch (cmd) {
      case 'build': r = build(site); break;
      case 'context': r = { code: 0, out: { status: 'ok', ...context(site, rest[0] || '', Math.max(0, Number(rest[1] ?? 5))) } }; break;
      case 'scan': { const s = scan(site); r = { code: 0, out: { status: 'ok', file: '.scan.json', colors: s.colors.length, radii: s.radii.length, fonts: s.fonts.length, fontSizes: s.fontSizes.length } }; break; }
      case 'save': r = save(site, rest[0]); break;
      case 'merge': r = merge(site, rest[0]); break;
      default: r = { code: 2, out: { status: 'error', error: `Unbekannter Befehl: ${cmd}` } };
    }
  } catch (e) {
    r = { code: 1, out: { status: 'error', error: e.message } };
  }
  process.stdout.write(JSON.stringify(r.out) + '\n');
  process.exit(r.code);
}
