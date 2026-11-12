// Schreibt absolute Links auf Seiten der eigenen Website auf lokale, relative Pfade um,
// sofern die Zielseite im Abzug vorhanden ist (z. B. nach pages-add.sh).
// Geändert werden nur href-Attribute; die Datei wird byte-treu (latin1) gelesen und geschrieben.
// Aufruf: node relink.mjs <www-dir> <host-ordner> <host>
// Ausgabe: {files, links}
import fs from 'node:fs';
import path from 'node:path';

const [wwwDir, hostDir, host] = process.argv.slice(2);
if (!wwwDir || !hostDir || !host) {
  console.error('Aufruf: node relink.mjs <www-dir> <host-ordner> <host>');
  process.exit(2);
}
const root = path.join(wwwDir, hostDir);
const bare = host.toLowerCase().replace(/^www\./, '');
const hosts = new Set([bare, 'www.' + bare]);
const port = hostDir.includes('+') ? hostDir.split('+').pop() : '';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && /\.html?$/i.test(e.name)) out.push(p);
  }
  return out;
}

// Lokale Datei (relativ zu root, POSIX) zu einer URL; gleiche Kandidaten wie entry-path.mjs
function localFor(u) {
  let p;
  try { p = decodeURIComponent(u.pathname); } catch { return null; }
  if (p.includes('\0') || p.split('/').includes('..')) return null;
  const query = u.search ? '@' + u.search.slice(1) : '';
  const base = p.replace(/^\/+/, '');
  const cands = p.endsWith('/')
    ? [base + 'index.html' + query, base + 'index.html']
    : [base + query, base + query + '.html', base, base + '.html', base + '/index.html'];
  for (const c of cands) {
    const f = path.join(root, c);
    if (/\.html?$/i.test(c) && fs.existsSync(f) && fs.statSync(f).isFile()) return c.split(path.sep).join('/');
  }
  return null;
}

let files = 0, links = 0;
if (fs.existsSync(root)) {
  for (const file of walk(root)) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    const html = fs.readFileSync(file, 'latin1');
    let n = 0;
    const out = html.replace(/(\shref\s*=\s*)(["'])(https?:\/\/[^"'\s]+)\2/gi, (m, pre, q, url) => {
      let u;
      try { u = new URL(url.replace(/&amp;/g, '&')); } catch { return m; }
      if (!hosts.has(u.hostname.toLowerCase()) || (u.port || '') !== port) return m;
      const target = localFor(u);
      if (!target) return m;
      let r = path.posix.relative(path.posix.dirname(rel), target) || path.posix.basename(target);
      r = r.split('/').map((s) => encodeURIComponent(s).replace(/%40/g, '@')).join('/');
      n++;
      return pre + q + r + (u.hash || '') + q;
    });
    if (n) {
      fs.writeFileSync(file, out, 'latin1');
      files++;
      links += n;
    }
  }
}
process.stdout.write(JSON.stringify({ files, links }) + '\n');
