// Alte Namen (Modio) in einem Abzug auf datamints Page Studio umstellen.
// Gleiche Regeln wie bei der Umbenennung des Tools: MODIO_* -> DPS_*, --modio-* -> --dps-*,
// _modio-assets -> _dps-assets, data-modio-* -> data-dps-*, Modio -> Page Studio.
//
// Aufruf:
//   node rename-names.mjs <ordner> [--dry-run]   Textdateien und Pfade im Ordner (ohne .git) umstellen;
//                                                Ausgabe: eine JSON-Zeile mit Zählern und betroffenen Dateien
//   node rename-names.mjs --stdin                Text von stdin umstellen (Commit-Nachrichten)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RULES = [
  [/modio\.ddev\.site/g, 'datamints-page-studio.ddev.site'],
  [/modio\.local/g, 'dps.local'],
  [/X-Modio-Token/g, 'X-DPS-Token'],
  [/x-modio-token/g, 'x-dps-token'],
  [/\bModio-/g, 'Page-Studio-'],
  [/-Modio\b/g, '-Page-Studio'],
  [/\bModio\b/g, 'Page Studio'],
  [/MODIO/g, 'DPS'],
  [/([a-z])Modio/g, '$1Dps'],
  [/(?<![a-zA-Z])modio([A-Z])/g, 'dps$1'],
  // kein Buchstabe davor: Wörter wie „commodious“ bleiben unberührt
  [/(?<![a-zA-Z])modio/g, 'dps'],
];
const ANY = /modio/i;
// Was danach nicht mehr vorkommen darf (für die Kontrolle in site-migrate.sh, grep -P)
export const LEFTOVER = '(?<![a-zA-Z])modio|\\bModio|MODIO';
const SKIP_DIRS = new Set(['.git', '.render', 'node_modules']);

export function renameText(s) {
  if (!ANY.test(s)) return { text: s, count: 0 };
  let count = 0;
  for (const [re, to] of RULES) s = s.replace(re, (...m) => { count++; return to.replace('$1', m[1]); });
  return { text: s, count };
}

// Binärdateien (Schriften, Bilder) bleiben unberührt: Nullbyte in den ersten 8 KB oder kein gültiges UTF-8
function readText(file) {
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 8192).includes(0)) return null;
  const s = buf.toString('utf8');
  if (s.includes('�') && !buf.includes(Buffer.from('�'))) return null;
  return s;
}

export function renameTree(root, { dryRun = false } = {}) {
  const res = { files: [], replacements: 0, renamed: [] };
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(ent.name)) continue;
      let p = path.join(dir, ent.name);
      // Pfade zuerst umbenennen (z. B. www/_modio-assets), dann weiter darin
      if (ANY.test(ent.name)) {
        const to = path.join(dir, renameText(ent.name).text);
        if (fs.existsSync(to)) throw new Error(`Ziel existiert bereits: ${path.relative(root, to)}`);
        res.renamed.push(path.relative(root, p) + ' -> ' + path.relative(root, to));
        if (!dryRun) { fs.renameSync(p, to); p = to; }
      }
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile()) {
        const s = readText(p);
        if (s === null) continue;
        const r = renameText(s);
        if (!r.count) continue;
        res.files.push({ file: path.relative(root, p), count: r.count });
        res.replacements += r.count;
        if (!dryRun) fs.writeFileSync(p, r.text);
      }
    }
  };
  walk(root);
  return res;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  if (args[0] === '--leftover') {
    process.stdout.write(LEFTOVER + '\n');
  } else if (args[0] === '--stdin') {
    process.stdout.write(renameText(fs.readFileSync(0, 'utf8')).text);
  } else if (args[0]) {
    const r = renameTree(path.resolve(args[0]), { dryRun: args.includes('--dry-run') });
    if (!args.includes('--quiet')) process.stdout.write(JSON.stringify(r) + '\n');
  } else {
    process.stderr.write('Aufruf: rename-names.mjs <ordner> [--dry-run] | --stdin\n');
    process.exit(2);
  }
}
