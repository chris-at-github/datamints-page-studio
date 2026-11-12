// Ermittelt den lokalen Pfad (relativ zu www/, mit führendem /) zur angegebenen URL.
// Aufruf: node entry-path.mjs <www-dir> <url>
import fs from 'node:fs';
import path from 'node:path';

const [wwwDir, url] = process.argv.slice(2);
const u = new URL(url);
const host = u.port ? `${u.hostname}+${u.port}` : u.hostname; // wget: host:port -> host+port bei windows-Namen
let p = decodeURIComponent(u.pathname);
const query = u.search ? '@' + u.search.slice(1) : '';

const candidates = [];
const base = path.posix.join('/', host, p);
if (p.endsWith('/')) {
  candidates.push(base + 'index.html' + query, base + 'index.html');
} else {
  candidates.push(base + query, base + query + '.html', base, base + '.html', base + '/index.html');
}
for (const c of candidates) {
  const f = path.join(wwwDir, c);
  if (fs.existsSync(f) && fs.statSync(f).isFile() && /\.html?$/i.test(f)) {
    process.stdout.write(c);
    process.exit(0);
  }
}
// Mit ENTRY_STRICT=1 kein Fallback (pages-add.sh: jede Seite muss selbst gefunden werden)
if (process.env.ENTRY_STRICT === '1') process.exit(1);
// Fallback: erste HTML-Datei im Host-Ordner
const hostDir = path.join(wwwDir, host);
if (fs.existsSync(path.join(hostDir, 'index.html'))) {
  process.stdout.write(`/${host}/index.html`);
  process.exit(0);
}
process.exit(1);
