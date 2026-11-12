// Hilfsfunktionen für Domain-Prüfung und HTML-Dateien.
import fs from 'node:fs';
import path from 'node:path';

export function readAllowedDomains(file, extra = []) {
  const list = fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim().toLowerCase()).filter(Boolean)
    : [];
  for (const h of extra) {
    if (!h) continue;
    const host = h.toLowerCase().replace(/\+\d+$/, '');
    list.push(host, host.replace(/^www\./, ''));
  }
  return [...new Set(list)];
}

export function hostAllowed(host, allowed) {
  host = host.toLowerCase().replace(/\+\d+$/, '').replace(/:\d+$/, '');
  return allowed.some((d) => host === d || host.endsWith('.' + d));
}

export function walk(dir, filter, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, filter, out);
    else if (filter(p)) out.push(p);
  }
  return out;
}

/**
 * Ermittelt den Host einer Ressource.
 * - absolute URL (http, https, //) -> Host der URL
 * - relativer Pfad nach wget --span-hosts -> erstes Segment unterhalb von www/
 * Gibt null zurück, wenn kein Host bestimmbar ist (data:, leere Angabe).
 */
export function resourceHost(src, htmlFile, wwwDir) {
  src = src.trim().replace(/&amp;/g, '&');
  if (!src || /^(data|blob|about|javascript):/i.test(src)) return null;
  const abs = src.match(/^(?:[a-z][a-z0-9+.-]*:)?\/\/([^/?#:]+)/i);
  if (abs) return abs[1].toLowerCase();
  let target;
  try {
    target = src.startsWith('/')
      ? path.join(wwwDir, decodeURIComponent(src.split(/[?#]/)[0]))
      : path.resolve(path.dirname(htmlFile), decodeURIComponent(src.split(/[?#]/)[0]));
  } catch {
    return null;
  }
  const rel = path.relative(wwwDir, target);
  if (rel.startsWith('..')) return null;
  return rel.split(path.sep)[0].toLowerCase();
}

export function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
}
