// Sichtprüfung im Browser: rendert Seiten des Abzugs vorher (Git-Stand) und nachher (Arbeitsverzeichnis)
// mit Playwright/Chromium, misst die gewählten Elemente und nimmt Ausschnitte auf.
// Aufruf: node render.mjs <siteDir> <slug> <outDir> <spec.json-String>
//         node render.mjs layout <siteDir> <slug> <seite> <selektor> <viewports-json>   (Hauptraster messen, für Entwürfe)
//   spec: { before: "HEAD", targets: [{page, selector}], viewports: [{name, width, height}] }
// Ausgabe: eine JSON-Zeile. Exit 0 ohne Fehler-Befunde, 3 mit Fehler-Befunden, 4 Playwright/Browser fehlt, 1 Fehler.
// Sicherheit: Die Seite läuft ohne Netz. Erlaubt sind nur Anfragen an den eigenen, nur lokal gebundenen Server.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { layerLegacyCss } from './draft.mjs';

const out = (o, code = 0) => { process.stdout.write(JSON.stringify(o) + '\n'); process.exit(code); };

const MIME = {
  '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8',
};
// wie die Auslieferung im Bridge-Server (SITE_CSP)
const SITE_CSP = "script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'";

const STYLE_PROPS = ['display', 'position', 'visibility', 'opacity', 'color', 'background-color', 'background-image', 'font-family', 'font-size',
  'font-weight', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'padding', 'margin', 'border', 'border-radius',
  'box-shadow', 'width', 'height', 'max-width', 'gap', 'flex-direction', 'justify-content', 'align-items', 'grid-template-columns', 'z-index'];

// ---------- Dateien: nachher aus dem Arbeitsverzeichnis, vorher aus Git (nur geänderte Dateien) ----------

function git(siteDir, args, opts = {}) {
  return execFileSync('git', ['-C', siteDir, ...args], { maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], ...opts });
}

function changedFiles(siteDir, ref) {
  const split = (b) => b.toString('utf8').split('\0').filter(Boolean);
  return new Set([...split(git(siteDir, ['diff', '--name-only', '-z', '--no-renames', ref])),
    ...split(git(siteDir, ['ls-files', '--others', '--exclude-standard', '-z']))]);
}

export function makeReader(siteDir, mode, ref) {
  const changed = mode === 'before' ? changedFiles(siteDir, ref) : null;
  const read = async (rel) => {
    if (changed && changed.has(rel)) {
      try { return git(siteDir, ['show', `${ref}:${rel}`]); } catch { return null; } // im alten Stand nicht vorhanden
    }
    try { return await fsp.readFile(path.join(siteDir, rel)); } catch { return null; }
  };
  const components = async () => {
    let names;
    if (mode === 'before') {
      try { names = git(siteDir, ['ls-tree', '--name-only', ref, 'components/']).toString('utf8').split('\n').map((p) => path.basename(p)); } catch { names = []; }
    } else {
      names = await fsp.readdir(path.join(siteDir, 'components')).catch(() => []);
    }
    return names.filter((f) => /^mx-[a-z0-9-]+\.css$/.test(f)).sort();
  };
  return { read, components };
}

// ---------- Lokaler Server, liefert wie der Bridge-Server aus (ohne Overlay) ----------

function injectHtml(buf, base, layered) {
  let head;
  if (layered) {
    head = `<style data-modio="layers">@import url("${base}/__tokens.css") layer(legacy);@import url("${base}/__overrides.css") layer(legacy);</style>` +
      `<link rel="stylesheet" href="${base}/__components.css" data-modio="components">`;
  } else {
    head = `<link rel="stylesheet" href="${base}/__tokens.css" data-modio="tokens"><link rel="stylesheet" href="${base}/__overrides.css" data-modio="overrides">`;
  }
  let html = buf.toString('latin1');
  if (layered) html = layerLegacyCss(html);
  const hi = html.search(/<\/head\s*>/i);
  html = hi >= 0 ? html.slice(0, hi) + head + html.slice(hi) : head + html;
  return Buffer.from(html, 'latin1');
}

export async function startServer(reader, slug) {
  const base = `/s/${slug}`;
  const send = (res, status, body, type) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': SITE_CSP });
    res.end(body);
  };
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (!u.pathname.startsWith(base + '/')) return send(res, 404, 'nicht gefunden', 'text/plain');
      const rest = u.pathname.slice(base.length);
      if (rest === '/__tokens.css') return send(res, 200, (await reader.read('design/tokens.css')) || '', MIME['.css']);
      if (rest === '/__overrides.css') return send(res, 200, (await reader.read('overrides.css')) || '', MIME['.css']);
      if (rest === '/__components.css') {
        const parts = [];
        for (const f of await reader.components()) parts.push(((await reader.read(`components/${f}`)) || '').toString('utf8'));
        return send(res, 200, parts.join('\n'), MIME['.css']);
      }
      let rel;
      try { rel = decodeURIComponent(rest); } catch { return send(res, 400, 'ungültig', 'text/plain'); }
      const norm = path.posix.normalize(rel);
      if (rel.includes('\0') || norm.startsWith('/..') || norm.includes('/../')) return send(res, 403, 'verboten', 'text/plain');
      const p = 'www' + norm.replace(/\/$/, '');
      const candidates = [];
      if (u.search) candidates.push(p + '@' + u.search.slice(1)); // wget --restrict-file-names=windows
      candidates.push(p, p + '/index.html', p + '.html');
      for (const c of candidates) {
        const buf = await reader.read(c);
        if (!buf) continue;
        if (c === p + '/index.html' && !rest.endsWith('/')) {
          res.writeHead(301, { Location: `${base}${rest}/` });
          return res.end();
        }
        const ext = path.extname(c).toLowerCase();
        let type = MIME[ext];
        if (!type) {
          const m = c.match(/\.(css|js|svg|png|jpe?g|gif|webp|woff2?)@/i);
          type = (m && MIME['.' + m[1].toLowerCase().replace('jpg', 'jpeg')]) || 'application/octet-stream';
        }
        const body = type === 'text/html' ? injectHtml(buf, base, (await reader.components()).length > 0) : buf;
        return send(res, 200, body, type);
      }
      return send(res, 404, 'nicht im Abzug', 'text/plain');
    } catch (e) {
      return send(res, 500, String(e.message), 'text/plain');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}`, base };
}

// ---------- Messung im Browser ----------

function measure([sel, props]) {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const describe = (n) => n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (typeof n.className === 'string' && n.className.trim() ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  const doc = document.documentElement;
  const pageOverflowX = Math.max(doc.scrollWidth, document.body ? document.body.scrollWidth : 0) - window.innerWidth;
  let els;
  try { els = document.querySelectorAll(sel); } catch { return { error: 'Ungültiger Selektor', pageOverflowX }; }
  if (!els.length) return { count: 0, pageOverflowX };
  const el = els[0];
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const style = {};
  for (const p of props) style[p] = cs.getPropertyValue(p);
  const visible = r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  // wirksamer Hintergrund: erster nicht transparenter Vorfahr; Verläufe werden über ihre Farben ausgewertet,
  // Hintergrundbilder (url) nicht
  let bgs = null; let bgImage = false;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (s.backgroundImage && s.backgroundImage !== 'none') {
      if (/url\(/i.test(s.backgroundImage)) { bgImage = true; break; }
      const stops = (s.backgroundImage.match(/rgba?\([^)]+\)/g) || []).map(parse).filter((c) => c && c.a > 0.5);
      if (stops.length) { bgs = stops; break; }
    }
    const c = parse(s.backgroundColor);
    if (c && c.a > 0.5) { bgs = [c]; break; }
  }
  if (!bgs && !bgImage) bgs = [{ r: 255, g: 255, b: 255, a: 1 }];
  const hasText = (el.innerText || '').trim().length > 0;
  let contrast = null;
  const fg = parse(cs.color);
  if (hasText && bgs && fg) {
    const ratio = (x, y) => { const a = lum(x), b = lum(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
    contrast = Math.round(Math.min(...bgs.map((b) => ratio(fg, b))) * 100) / 100;
  }
  const fontPx = parseFloat(cs.fontSize) || 16;
  const largeText = fontPx >= 24 || (fontPx >= 18.66 && Number(cs.fontWeight) >= 700);
  // Text, der abgeschnitten wird oder seitlich herausragt. Dekoration (absolut positioniert, ohne Text) zählt nicht.
  const er = el.getBoundingClientRect();
  let overflowX = 0;
  const clipped = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (t) => (t.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
  const range = document.createRange();
  for (let t = walker.nextNode(), k = 0; t && k < 400; t = walker.nextNode(), k++) {
    const p = t.parentElement;
    if (!p || p.closest('[aria-hidden="true"]') || getComputedStyle(p).visibility === 'hidden') continue;
    range.selectNodeContents(t);
    const rects = [...range.getClientRects()].filter((x) => x.width > 0 && x.height > 0);
    if (!rects.length) continue;
    for (const x of rects) overflowX = Math.max(overflowX, er.left - x.left, x.right - er.right);
    // nächster abschneidender Vorfahr innerhalb des Elements (einschließlich)
    for (let n = p; n && el.contains(n); n = n.parentElement) {
      const s = getComputedStyle(n);
      if (!/(hidden|clip)/.test(s.overflowX + ' ' + s.overflowY)) continue;
      const cr = n.getBoundingClientRect();
      if (rects.some((x) => x.left < cr.left - 2 || x.right > cr.right + 2 || x.top < cr.top - 2 || x.bottom > cr.bottom + 2)) {
        const d = describe(n);
        if (!clipped.includes(d)) clipped.push(d);
      }
      break;
    }
    if (clipped.length >= 5) break;
  }
  // Elemente im Fluss, die breiter als das Element sind
  for (const c of el.children) {
    const s = getComputedStyle(c);
    if (s.position === 'absolute' || s.position === 'fixed' || s.display === 'none') continue;
    const cr = c.getBoundingClientRect();
    if (cr.width > 0) overflowX = Math.max(overflowX, er.left - cr.left, cr.right - er.right);
  }
  overflowX = Math.max(0, Math.round(overflowX));
  // Wird das Element in der Mitte von etwas Fremdem verdeckt?
  let covered = null;
  const cx = Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth - 1);
  const cy = Math.min(Math.max(r.top + Math.min(r.height / 2, 40), 0), window.innerHeight - 1);
  const top = document.elementFromPoint(cx, cy);
  if (visible && top && !el.contains(top) && !top.contains(el)) covered = describe(top);
  return {
    count: els.length, visible, pageOverflowX, overflowX, clipped, covered, contrast, largeText, bgImage,
    rect: { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) },
    style,
  };
}

// ---------- Ablauf ----------

async function main() {
  const [siteDir, slug, outDir, specArg] = process.argv.slice(2);
  if (!siteDir || !slug || !outDir || !specArg) out({ status: 'error', error: 'Aufruf: render.mjs <siteDir> <slug> <outDir> <spec>' }, 1);
  const spec = JSON.parse(specArg);
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { out({ status: 'unavailable', error: 'Playwright ist nicht installiert (npm install)' }, 4); }
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
  } catch (e) {
    out({ status: 'unavailable', error: `Chromium startet nicht (npx playwright install chromium oder PLAYWRIGHT_CHROMIUM setzen): ${String(e.message).split('\n')[0]}` }, 4);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const servers = {
    before: await startServer(makeReader(siteDir, 'before', spec.before || 'HEAD'), slug),
    after: await startServer(makeReader(siteDir, 'after'), slug),
  };
  const results = [];
  const issues = [];
  const timeoutMs = Number(process.env.RENDER_TIMEOUT_MS || 20000);
  try {
    for (const vp of spec.viewports) {
      const shots = {};
      for (const mode of ['before', 'after']) {
        const { origin, base } = servers[mode];
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block' });
        // nur der eigene Server, keine anderen Adressen (auch kein anderer lokaler Port)
        await ctx.route('**/*', (route) => {
          const u = route.request().url();
          return u.startsWith(origin + '/') || u.startsWith('data:') || u.startsWith('blob:') ? route.continue() : route.abort();
        });
        const page = await ctx.newPage();
        const pageErrors = [];
        page.on('pageerror', (e) => pageErrors.push(String(e.message).split('\n')[0].slice(0, 200)));
        const loaded = new Map();
        for (const [i, t] of spec.targets.entries()) {
          const url = `${origin}${base}${t.page.split('/').map(encodeURIComponent).join('/')}`;
          if (!loaded.has(t.page)) {
            try {
              await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
            } catch (e) {
              loaded.set(t.page, false);
              shots[`${i}-${mode}`] = { error: `Seite lädt nicht: ${String(e.message).split('\n')[0]}` };
              continue;
            }
            await page.addStyleTag({ content: '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important}' }).catch(() => {});
            await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
            await page.waitForTimeout(250);
            loaded.set(t.page, true);
          } else if (!loaded.get(t.page)) { shots[`${i}-${mode}`] = { error: 'Seite lädt nicht' }; continue; }
          const m = await page.evaluate(measure, [t.selector, STYLE_PROPS]);
          m.pageErrors = [...pageErrors];
          if (m.rect) {
            const pad = 120;
            const fullH = await page.evaluate(() => document.documentElement.scrollHeight);
            const y = Math.max(0, m.rect.y - pad);
            const h = Math.max(1, Math.min(m.rect.h + 2 * pad, 1800, fullH - y));
            const file = path.join(outDir, `${vp.name}-${i + 1}-${mode === 'before' ? 'vorher' : 'nachher'}.png`);
            await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y, width: vp.width, height: h } }).catch(() => {});
            if (fs.existsSync(file)) m.image = file;
          }
          shots[`${i}-${mode}`] = m;
        }
        await ctx.close();
      }
      for (const [i, t] of spec.targets.entries()) {
        const b = shots[`${i}-before`] || {}; const a = shots[`${i}-after`] || {};
        const where = `${vp.name} ${vp.width}×${vp.height}, Element ${i + 1} (${t.selector})`;
        const add = (level, rule, message) => issues.push({ level, rule, viewport: vp.name, target: i + 1, message: `${where}: ${message}` });
        if (a.error) add('fehler', 'load', a.error);
        else if (a.count === 0) add(b.count > 0 ? 'fehler' : 'hinweis', 'not-found', b.count > 0 ? 'Element nach der Änderung nicht mehr gefunden (Selektor passt nicht mehr oder Element entfernt)' : 'Selektor findet das Element weder vorher noch nachher');
        else {
          if (b.visible && !a.visible) add('fehler', 'hidden', 'Element ist nach der Änderung unsichtbar');
          if (a.pageOverflowX > 1 && !(b.pageOverflowX > 1)) add('fehler', 'page-overflow-x', `Seite scrollt jetzt horizontal (${a.pageOverflowX} px zu breit)`);
          if (a.overflowX > 1 && !(b.overflowX > 1)) add('fehler', 'element-overflow', `Inhalt ragt seitlich aus dem Element (${a.overflowX} px)`);
          const newClip = (a.clipped || []).filter((c) => !(b.clipped || []).includes(c));
          if (newClip.length) add('fehler', 'clipped', `Text wird abgeschnitten in: ${newClip.join(', ')}`);
          if (a.covered && !b.covered) add('fehler', 'covered', `Element wird verdeckt von ${a.covered}`);
          const minA = a.largeText ? 3 : 4.5; const minB = b.largeText ? 3 : 4.5;
          // Fehler: neu unter dem Mindestwert oder deutlich schlechter als vorher; Hinweis: spürbar gesunken
          if (a.contrast !== null && a.contrast < minA && (b.contrast === null || b.contrast >= minB || a.contrast < b.contrast - 1)) add('fehler', 'contrast', `Kontrast Text/Hintergrund nur ${a.contrast}:1${b.contrast !== null ? ` (vorher ${b.contrast}:1)` : ''}, mind. ${minA}:1`);
          else if (a.contrast !== null && b.contrast !== null && a.contrast < minA && a.contrast < b.contrast - 0.25) add('hinweis', 'contrast', `Kontrast Text/Hintergrund gesunken: ${b.contrast}:1 → ${a.contrast}:1 (mind. ${minA}:1)`);
          if (a.bgImage && !b.bgImage) add('hinweis', 'contrast-unknown', 'Hintergrundbild: Kontrast bitte im Bild prüfen');
          if (a.count > 1 && a.count !== b.count) add('hinweis', 'multi-match', `Selektor trifft ${a.count} Elemente`);
        }
        const newErrors = (a.pageErrors || []).filter((e) => !(b.pageErrors || []).includes(e));
        if (newErrors.length) add('fehler', 'js-error', `Neue Script-Fehler: ${newErrors.slice(0, 3).join(' | ')}`);
        const styleChanges = {};
        if (a.style && b.style) for (const p of STYLE_PROPS) if (a.style[p] !== b.style[p]) styleChanges[p] = [b.style[p], a.style[p]];
        const pixelsSame = !!(a.image && b.image) && fs.readFileSync(a.image).equals(fs.readFileSync(b.image));
        results.push({
          viewport: vp, target: i + 1, page: t.page, selector: t.selector,
          before: b.rect ? { rect: b.rect, contrast: b.contrast, count: b.count } : { count: b.count ?? null, error: b.error },
          after: a.rect ? { rect: a.rect, contrast: a.contrast, count: a.count } : { count: a.count ?? null, error: a.error },
          styleChanges, unchanged: pixelsSame,
          images: { vorher: b.image || null, nachher: a.image || null },
        });
      }
    }
  } finally {
    await browser.close().catch(() => {});
    for (const s of Object.values(servers)) s.server.close();
  }
  // Keine sichtbare Änderung an den gewählten Elementen in keiner Ansicht: Hinweis (Änderung kann woanders liegen)
  if (results.length && results.every((r) => r.unchanged)) {
    issues.push({ level: 'hinweis', rule: 'unchanged', viewport: null, target: null, message: 'An den gewählten Elementen ist in keiner Ansicht eine Änderung zu sehen' });
  }
  const errors = issues.filter((i) => i.level === 'fehler').length;
  out({ status: errors ? 'issues' : 'ok', errors, issues, results, dir: outDir }, errors ? 3 : 0);
}

// ---------- Hauptraster eines Elements (für Entwürfe) ----------
// Gemessen werden Breite und Lage des Elements, die Inhaltsbreite (nächster Vorfahr mit max-width) und die
// Hauptspalten: die erste Ebene unterhalb des Elements, auf der 2–4 Kinder nebeneinander stehen. Gesucht wird in der
// breitesten Ansicht; in den anderen Ansichten wird derselbe Knoten gemessen (Spalten ggf. untereinander).
// Inneres (Kartenraster, Listen) gehört bewusst nicht zum Hauptraster.
export function measureLayout([sel, path0]) {
  const describe = (n) => n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (typeof n.className === 'string' && n.className.trim() ? '.' + n.className.trim().split(/\s+/).filter((c) => !c.startsWith('modio')).slice(0, 3).join('.') : '');
  const box = (n) => { const r = n.getBoundingClientRect(); return { x: Math.round(r.left + window.scrollX), w: Math.round(r.width) }; };
  let el;
  try { el = document.querySelector(sel); } catch { return { error: 'Ungültiger Selektor' }; }
  if (!el) return { error: 'Element nicht gefunden' };
  const cs = getComputedStyle(el);
  const element = { node: describe(el), ...box(el), maxWidth: cs.maxWidth, paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight };
  let container = null;
  for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (s.maxWidth !== 'none') { container = { node: describe(n), maxWidth: s.maxWidth, ...box(n), self: n === el }; break; }
  }
  // Inhaltsbreite innerhalb des Elements (z. B. .wrapper/.container): erster Nachfahr mit max-width
  let inner = null;
  for (const n of el.querySelectorAll('*')) {
    const s = getComputedStyle(n);
    if (s.maxWidth !== 'none' && s.display !== 'none' && !/^(img|svg|video|picture|input|select|textarea|button)$/i.test(n.tagName) && n.getBoundingClientRect().width > el.getBoundingClientRect().width * 0.5) {
      inner = { node: describe(n), maxWidth: s.maxWidth, ...box(n) }; break;
    }
  }
  const kidsOf = (n) => [...n.children].filter((c) => {
    const s = getComputedStyle(c);
    if (s.display === 'none' || s.position === 'absolute' || s.position === 'fixed') return false;
    const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0;
  });
  // Bezugsbreite für Spalten: Inhaltsbreite, falls vorhanden, sonst das Element
  const elW = inner ? inner.w : el.getBoundingClientRect().width;
  let colNode = null; let path = null;
  if (path0) {
    colNode = el;
    for (const i of path0) { colNode = colNode && colNode.children[i]; }
    path = colNode ? path0 : null;
  } else {
    const queue = [[el, []]];
    while (queue.length) {
      const [n, p] = queue.shift();
      const kids = kidsOf(n);
      if (kids.length >= 2) {
        const r0 = kids[0].getBoundingClientRect();
        const row = kids.filter((k) => { const r = k.getBoundingClientRect(); return r.top < r0.bottom - 1 && r.bottom > r0.top + 1; });
        if (row.length >= 2 && row.length <= 4 && row.every((k) => k.getBoundingClientRect().width >= elW * 0.15)) { colNode = n; path = p; break; }
      }
      if (p.length < 4) for (const k of kids) queue.push([k, [...p, [...n.children].indexOf(k)]]);
    }
  }
  let columns = null;
  if (colNode) {
    const s = getComputedStyle(colNode);
    const kids = kidsOf(colNode);
    const cols = kids.map((k) => ({ node: describe(k), ...box(k), top: Math.round(k.getBoundingClientRect().top + window.scrollY) }));
    const stacked = cols.length > 1 && cols.every((c) => Math.abs(c.x - cols[0].x) < 2);
    columns = { node: describe(colNode), display: s.display, gap: s.columnGap, gridTemplateColumns: s.gridTemplateColumns !== 'none' ? s.gridTemplateColumns : null, stacked,
      cols: cols.slice(0, 4).map(({ node, x, w }) => ({ node, x, w })) };
  }
  return { viewport: window.innerWidth, element, container, inner, columns, path };
}

async function layoutMain() {
  const [, siteDir, slug, page, selector, vpArg] = process.argv.slice(2);
  if (!siteDir || !slug || !page || !selector || !vpArg) out({ status: 'error', error: 'Aufruf: render.mjs layout <siteDir> <slug> <seite> <selektor> <viewports>' }, 1);
  const viewports = JSON.parse(vpArg).sort((a, b) => b.width - a.width);
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { out({ status: 'unavailable', error: 'Playwright ist nicht installiert (npm install)' }, 4); }
  let browser;
  try { browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined }); } catch (e) {
    out({ status: 'unavailable', error: `Chromium startet nicht: ${String(e.message).split('\n')[0]}` }, 4);
  }
  const srv = await startServer(makeReader(siteDir, 'after'), slug);
  const result = [];
  let path0 = null;
  try {
    for (const vp of viewports) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block' });
      await ctx.route('**/*', (route) => {
        const u = route.request().url();
        return u.startsWith(srv.origin + '/') || u.startsWith('data:') || u.startsWith('blob:') ? route.continue() : route.abort();
      });
      const pg = await ctx.newPage();
      try {
        await pg.goto(`${srv.origin}${srv.base}/${page.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')}`, { waitUntil: 'load', timeout: Number(process.env.RENDER_TIMEOUT_MS || 20000) });
        await pg.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
        const m = await pg.evaluate(measureLayout, [selector, path0]);
        if (path0 === null && m.path) path0 = m.path;
        result.push({ name: vp.name, width: vp.width, ...m });
      } catch (e) {
        result.push({ name: vp.name, width: vp.width, error: String(e.message).split('\n')[0] });
      }
      await ctx.close();
    }
  } finally {
    await browser.close().catch(() => {});
    srv.server.close();
  }
  const ok = result.some((r) => !r.error);
  out({ status: ok ? 'ok' : 'error', error: ok ? undefined : result[0]?.error, viewports: result.map(({ path, ...r }) => r) }, ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'layout') layoutMain().catch((e) => out({ status: 'error', error: e.message }, 1));
  else main().catch((e) => out({ status: 'error', error: e.message }, 1));
}
