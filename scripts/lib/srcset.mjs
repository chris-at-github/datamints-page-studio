// Lädt Bilder aus srcset-Attributen nach (<picture><source srcset>, <img srcset>) und schreibt sie auf lokale,
// relative Pfade um. wget übernimmt nur <img src>; die srcset-Varianten blieben sonst als Verweise auf die
// Live-Website (meist wurzelrelativ wie /fileadmin/…) stehen und liefen im Abzug ins Leere.
// Geladen wird nur von der Website selbst und den Domains aus allowed-domains.txt; Ablage wie bei wget
// (www/<host>[+port]/<pfad>, Query als @…). Schlägt ein Download fehl, wird die absolute URL eingesetzt,
// damit das Bild wenigstens online erscheint.
// Aufruf: node srcset.mjs <www-dir> <urls.txt> <allowed-domains.txt>
// Ausgabe: {files, candidates, downloaded, present, failed:[url…]}
import fs from 'node:fs';
import path from 'node:path';
import { readAllowedDomains, hostAllowed, walk } from './html-utils.mjs';

const [wwwDir, urlsFile, allowedFile] = process.argv.slice(2);
if (!wwwDir || !urlsFile) {
  console.error('Aufruf: node srcset.mjs <www-dir> <urls.txt> [allowed-domains.txt]');
  process.exit(2);
}
const firstUrl = fs.readFileSync(urlsFile, 'utf8').split('\n').map((l) => l.trim()).find(Boolean) || '';
const scheme = /^http:/i.test(firstUrl) ? 'http:' : 'https:';
const allowed = readAllowedDomains(allowedFile || '', []);
const UA = process.env.CRAWL_USER_AGENT || 'Mozilla/5.0 (datamints Page Studio)';
const AUTH = process.env.CRAWL_HTTP_USER
  ? 'Basic ' + Buffer.from(`${process.env.CRAWL_HTTP_USER}:${process.env.CRAWL_HTTP_PASSWORD || ''}`).toString('base64')
  : null;

const hostDirOf = (u) => u.hostname.toLowerCase() + (u.port ? '+' + u.port : '');
const originOf = (hostDir) => {
  const [host, port] = hostDir.split('+');
  return `${scheme}//${host}${port ? ':' + port : ''}`;
};

// Lokaler Dateipfad (absolut) zu einer URL oder null
function localPath(u) {
  let p;
  try { p = decodeURIComponent(u.pathname); } catch { return null; }
  if (!p || p.endsWith('/') || p.includes('\0') || p.split('/').includes('..')) return null;
  const query = u.search ? '@' + u.search.slice(1) : '';
  const f = path.join(wwwDir, hostDirOf(u), p.replace(/^\/+/, '') + query);
  return path.relative(wwwDir, f).startsWith('..') ? null : f;
}

const relRef = (fromFile, target) =>
  path.relative(path.dirname(fromFile), target).split(path.sep)
    .map((s) => encodeURIComponent(s).replace(/%40/g, '@')).join('/');

// srcset in Kandidaten zerlegen: [{url, desc}]
function parseSrcset(value) {
  return value.split(/,(?=\s|$)|,(?=[^,\s]+\s+[\d.]+[wx]\b)/).map((part) => {
    const m = part.trim().match(/^(\S+)(\s+.*)?$/);
    return m ? { url: m[1], desc: m[2] || '' } : null;
  }).filter(Boolean);
}

const files = walk(wwwDir, (p) => /\.html?$/i.test(p));
const SRCSET_RE = /(<(?:source|img)\b[^>]*?\ssrcset\s*=\s*)("([^"]*)"|'([^']*)')/gi;

// Erster Durchlauf: was muss geladen werden?
const jobs = new Map(); // lokaler Pfad -> URL
function plan(file, raw) {
  const value = Buffer.from(raw.replace(/&amp;/g, '&'), 'latin1').toString('utf8');
  if (/^(data|blob):/i.test(value)) return null;
  const hostDir = path.relative(wwwDir, file).split(path.sep)[0];
  const isRemote = /^([a-z][a-z0-9+.-]*:)?\/\//i.test(value) || value.startsWith('/');
  if (!isRemote) {
    // bereits lokal (von wget umgeschrieben) oder relativer Verweis der Live-Seite?
    try {
      if (fs.existsSync(path.resolve(path.dirname(file), decodeURIComponent(value.split(/[?#]/)[0])))) return null;
    } catch { /* weiter als URL */ }
  }
  const pageUrl = originOf(hostDir) + '/' + path.relative(path.join(wwwDir, hostDir), file).split(path.sep).join('/');
  let u;
  try { u = new URL(value, pageUrl); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const sameSite = hostDirOf(u) === hostDir;
  if (!sameSite && !hostAllowed(u.hostname, allowed)) return null;
  const local = localPath(u);
  if (!local) return null;
  u.hash = '';
  return { url: u, local, sameSite };
}

let candidates = 0;
for (const file of files) {
  const html = fs.readFileSync(file, 'latin1');
  for (const m of html.matchAll(SRCSET_RE)) {
    for (const c of parseSrcset(m[3] ?? m[4] ?? '')) {
      const p = plan(file, c.url);
      if (!p) continue;
      candidates++;
      if (!fs.existsSync(p.local)) jobs.set(p.local, p);
    }
  }
}

// Laden (4 gleichzeitig)
const failed = new Set();
let downloaded = 0;
async function fetchOne({ url, local, sameSite }) {
  const headers = { 'User-Agent': UA };
  if (AUTH && sameSite) headers.Authorization = AUTH;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(local), { recursive: true });
      fs.writeFileSync(local, buf);
      downloaded++;
      console.error(`srcset: ${url.href} -> ${path.relative(wwwDir, local)}`);
      return;
    } catch (e) {
      if (attempt === 1) {
        failed.add(local);
        console.error(`srcset: FEHLER ${url.href}: ${e.message}`);
      }
    }
  }
}
const queue = [...jobs.values()];
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) await fetchOne(queue.shift());
}));

// Zweiter Durchlauf: umschreiben
let changedFiles = 0;
const failedUrls = new Set();
for (const file of files) {
  const orig = fs.readFileSync(file, 'latin1');
  const html = orig.replace(SRCSET_RE, (m, pre, quoted, dq, sq) => {
    const q = quoted[0];
    const out = parseSrcset(dq ?? sq ?? '').map((c) => {
      const p = plan(file, c.url);
      if (!p) return c.url + c.desc;
      if (failed.has(p.local) || !fs.existsSync(p.local)) {
        failedUrls.add(p.url.href);
        return p.url.href + c.desc;
      }
      return relRef(file, p.local) + c.desc;
    }).join(', ');
    return pre + q + out + q;
  });
  if (html !== orig) {
    fs.writeFileSync(file, html, 'latin1');
    changedFiles++;
  }
}

process.stdout.write(JSON.stringify({
  files: changedFiles, candidates, downloaded, present: candidates - jobs.size, failed: [...failedUrls],
}) + '\n');
