// Entfernt Scripts, iframes, Embeds und Objects fremder Domains aus allen HTML-Dateien.
// Entfernt außerdem integrity-Attribute (Prettier verändert CSS) und CSP-Meta-Tags.
// Aufruf: node clean.mjs <www-dir> <allowed-domains.txt> [site-host]
import fs from 'node:fs';
import { readAllowedDomains, hostAllowed, walk, resourceHost, attr } from './html-utils.mjs';

const [wwwDir, allowedFile, siteHost] = process.argv.slice(2);
const allowed = readAllowedDomains(allowedFile, [siteHost]);
const files = walk(wwwDir, (p) => /\.html?$/i.test(p));
const removedList = [];
let removed = 0;

// Inline-Script ist fremd, wenn es URLs zu nicht erlaubten Domains enthält (z. B. Tracking-Loader).
function inlineForeign(code) {
  const hosts = [...code.matchAll(/(?:https?:)?\\?\/\\?\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)].map((m) => m[1]);
  return hosts.some((h) => !hostAllowed(h, allowed));
}

for (const file of files) {
  const orig = fs.readFileSync(file, 'latin1'); // byte-treu, unabhängig von der Kodierung
  let html = orig;

  const decide = (match, openTag, kind) => {
    const src = attr(openTag, kind === 'object' ? 'data' : 'src');
    let foreign;
    if (src !== null && src !== '') {
      const host = resourceHost(src, file, wwwDir);
      foreign = host !== null && !hostAllowed(host, allowed);
    } else if (kind === 'script') {
      const type = (attr(openTag, 'type') || '').toLowerCase();
      if (/json|template|text\/x-/.test(type)) return match;
      foreign = inlineForeign(match);
    } else {
      foreign = true; // iframe/embed/object ohne Quelle (z. B. srcdoc) immer entfernen
    }
    if (!foreign) return match;
    removed++;
    removedList.push({ file: file.slice(wwwDir.length), kind, src: src || '(inline)' });
    return `<!-- dps: ${kind} entfernt -->`;
  };

  html = html.replace(/(<script\b[^>]*>)[\s\S]*?<\/script\s*>/gi, (m, open) => decide(m, open, 'script'));
  html = html.replace(/(<iframe\b[^>]*>)[\s\S]*?<\/iframe\s*>/gi, (m, open) => decide(m, open, 'iframe'));
  html = html.replace(/(<object\b[^>]*>)[\s\S]*?<\/object\s*>/gi, (m, open) => decide(m, open, 'object'));
  html = html.replace(/(<embed\b[^>]*>)/gi, (m, open) => decide(m, open, 'embed'));
  // integrity/crossorigin: lokale Kopien stimmen nach Formatierung nicht mehr mit dem Hash überein
  html = html.replace(/<(link|script)\b[^>]*>/gi, (tag) =>
    tag.replace(/\s(integrity|crossorigin)(\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/gi, ''),
  );
  // Seiteneigene CSP würde das Overlay blockieren; der Bridge-Server setzt eine eigene
  html = html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi, '');

  if (html !== orig) fs.writeFileSync(file, html, 'latin1');
}

process.stdout.write(JSON.stringify({ files: files.length, removed, allowed, details: removedList.slice(0, 200) }));
