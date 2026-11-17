// Hilfen für page-delete.sh
//   node page-delete.mjs links <www-dir> <seite>              -> {count, files}: Links anderer Seiten auf <seite>
//   node page-delete.mjs urls <www-dir> <urls.txt> <seite> <ausgabe>
//        -> schreibt urls.txt ohne die URLs, die auf <seite> zeigen, nach <ausgabe>; stdout {removed}
// <seite> ist der Pfad unter www/ mit führendem / (z. B. /seiten/kontakt.html oder /www.example.com/a/index.html).
// Muss vor dem Löschen laufen (die URL-Zuordnung prüft wie entry-path.mjs, welche Datei existiert).
import fs from 'node:fs';
import path from 'node:path';

const [mode, wwwDir, ...rest] = process.argv.slice(2);
const norm = (p) => path.posix.normalize(p);

function htmlFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '_modio-assets') htmlFiles(p, out); }
    else if (/\.html?(@.*)?$/i.test(e.name)) out.push(p);
  }
  return out;
}

if (mode === 'links') {
  const target = norm(rest[0]);
  const files = [];
  let count = 0;
  for (const f of htmlFiles(wwwDir)) {
    const rel = '/' + path.relative(wwwDir, f).split(path.sep).join('/');
    if (rel === target) continue;
    const text = fs.readFileSync(f, 'latin1');
    let n = 0;
    for (const m of text.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      let href = (m[1] ?? m[2] ?? m[3] ?? '').trim().replace(/[#?].*$/, '');
      if (!href || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(href)) continue;
      try { href = decodeURIComponent(href); } catch { /* unverändert */ }
      let p = href.startsWith('/') ? norm(href) : norm(path.posix.join(path.posix.dirname(rel), href));
      if (p.endsWith('/')) p += 'index.html';
      if (p === target) n++;
    }
    if (n) { files.push(rel); count += n; }
  }
  process.stdout.write(JSON.stringify({ count, files: files.sort() }));
} else if (mode === 'urls') {
  const [urlsFile, page, outFile] = rest;
  const target = norm(page);
  // Wie entry-path.mjs: die erste vorhandene Kandidatendatei ist die Seite der URL
  const pageOf = (url) => {
    let u;
    try { u = new URL(url); } catch { return null; }
    const host = u.port ? `${u.hostname}+${u.port}` : u.hostname;
    let p;
    try { p = decodeURIComponent(u.pathname); } catch { return null; }
    const query = u.search ? '@' + u.search.slice(1) : '';
    const base = path.posix.join('/', host, p);
    const cands = p.endsWith('/') ? [base + 'index.html' + query, base + 'index.html']
      : [base + query, base + query + '.html', base, base + '.html', base + '/index.html'];
    for (const c of cands) {
      const f = path.join(wwwDir, c);
      if (fs.existsSync(f) && fs.statSync(f).isFile() && /\.html?(@.*)?$/i.test(f)) return c;
    }
    return null;
  };
  const lines = fs.existsSync(urlsFile) ? fs.readFileSync(urlsFile, 'utf8').split('\n') : [];
  const keep = [], removed = [];
  for (const l of lines) {
    const u = l.replace(/\r$/, '').trim();
    if (u && pageOf(u) === target) removed.push(u); else keep.push(l);
  }
  fs.writeFileSync(outFile, keep.join('\n'));
  process.stdout.write(JSON.stringify({ removed }));
} else {
  process.stderr.write('Aufruf: page-delete.mjs links|urls …\n');
  process.exit(2);
}
