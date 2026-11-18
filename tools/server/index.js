// Modio Bridge-Server: Startseite, Auslieferung der Abzüge mit Overlay, API, Job-Dateien, SSE.
// Start: node --env-file=.env tools/server/index.js
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import busboy from 'busboy';
import { renderStartPage } from './startpage.js';
import { loadCheerio } from '../../scripts/lib/consistency.mjs';
import { loadVersion, replaceElement, layerLegacyCss, readText, validateBefund, instanceHtml } from '../../scripts/lib/draft.mjs';
import { listLibrary, libraryPage } from '../../scripts/lib/components.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const env = process.env;
const abs = (p, d) => path.resolve(ROOT, p || d);
const SITES_DIR = abs(env.SITES_DIR, './sites');
const JOBS_DIR = abs(env.JOBS_DIR, './jobs');
const STATE_DIR = abs(env.STATE_DIR, './state');
const OVERLAY_FILE = path.join(ROOT, 'tools/overlay/overlay.js');
const FAVICON_SVG = path.join(ROOT, 'tools/server/favicon.svg');
const FAVICON_ICO = path.join(ROOT, 'tools/server/favicon.ico');
const PORT = Number(env.BRIDGE_PORT || 3000);
const TOKEN = env.MODIO_API_TOKEN || '';
const IMAGE_MAX_COUNT = Number(env.IMAGE_MAX_COUNT || 3);
const IMAGE_MAX_MB = Number(env.IMAGE_MAX_MB || 10);
const ALLOWED_ORIGINS = new Set(
  (env.MODIO_ALLOWED_ORIGINS || 'https://modio.ddev.site:3443,http://modio.ddev.site:3080,http://localhost:3000')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean),
);
const STATUSES = ['pending', 'running', 'review', 'done', 'failed'];
const ACTIVE = ['pending', 'running', 'review'];
const CANCELABLE = ['draft']; // Aufträge mit Abbrechen-Knopf (Worker: CANCEL_TYPES)
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

if (!TOKEN || TOKEN.length < 16 || TOKEN.startsWith('<')) {
  console.error('MODIO_API_TOKEN fehlt oder ist zu kurz (.env prüfen, z. B. openssl rand -hex 32).');
  process.exit(1);
}
for (const s of STATUSES.concat('assets')) fs.mkdirSync(path.join(JOBS_DIR, s), { recursive: true });

const MIME = {
  '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.md': 'text/plain; charset=utf-8',
};

// Abzüge: nur Scripts und Verbindungen zur eigenen Adresse, keine fremden Frames/Plugins
const SITE_CSP = [
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'self'",
  "frame-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
const APP_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'";

// ---------- Hilfsfunktionen ----------

const validSlug = (s) => typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,62}$/.test(s);
const validJobId = (s) => typeof s === 'string' && /^job-\d{14}-[0-9a-f]{6}$/.test(s);
const validHttpUrl = (s) => {
  if (typeof s !== 'string' || s.length > 2048) return false;
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
};
const slugFromUrl = (url) =>
  new URL(url).hostname.replace(/^www\./, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
const siteDir = (slug) => path.join(SITES_DIR, slug);
const siteExists = (slug) => fs.existsSync(path.join(siteDir(slug), 'site.json'));

function newJobId() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `job-${ts}-${crypto.randomBytes(3).toString('hex')}`;
}

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const payload = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isBuf || typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}
const sendError = (res, status, error) => send(res, status, { error });

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
}

async function readBody(req, limit = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('Anfrage zu groß'), { status: 413 });
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('Ungültiges JSON'), { status: 400 }); }
}

// ---------- Jobs ----------

async function listJobs(filter = () => true) {
  const jobs = [];
  for (const status of STATUSES) {
    let files = [];
    try { files = await fsp.readdir(path.join(JOBS_DIR, status)); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const job = await readJson(path.join(JOBS_DIR, status, f));
      if (job && filter(job)) jobs.push({ ...job, status });
    }
  }
  return jobs.sort((a, b) => a.id.localeCompare(b.id));
}

async function findJob(id) {
  for (const status of STATUSES) {
    const job = await readJson(path.join(JOBS_DIR, status, `${id}.json`));
    if (job) return { ...job, status };
  }
  return null;
}

async function activeJobsFor(slug) {
  return listJobs((j) => j.slug === slug).then((jobs) => jobs.filter((j) => ACTIVE.includes(j.status)));
}

async function createJob(type, slug, params, id = newJobId()) {
  const now = new Date().toISOString();
  const job = { id, type, slug, status: 'pending', created: now, updated: now, params, result: null, error: null, log: `logs/${id}.log` };
  const tmp = path.join(JOBS_DIR, `.${id}.tmp`);
  await fsp.writeFile(tmp, JSON.stringify(job, null, 2));
  await fsp.rename(tmp, path.join(JOBS_DIR, 'pending', `${id}.json`));
  return job;
}

// ---------- Auslieferung der Abzüge ----------

// opts.layered: Alt-CSS (samt tokens.css und overrides.css) in @layer legacy, Komponenten ohne Ebene darüber.
// opts.preview: { draft, version, name } – Vorschau eines Entwurfs (dessen CSS statt der gleichnamigen Komponente)
// opts.empty: Platzhalter eines neuen Projekts ohne Seiten (Overlay öffnet „Seiten“)
function injectHtml(buf, slug, opts = {}) {
  const { layered = false, preview = null, empty = false, kind = null, library = false } = opts;
  const cfg = JSON.stringify({ slug, token: TOKEN, base: `/s/${slug}`, imageMaxCount: IMAGE_MAX_COUNT, imageMaxMb: IMAGE_MAX_MB,
    preview: preview ? { draft: preview.draft, version: preview.version, name: preview.name } : null, ...(empty ? { empty: true } : {}), ...(kind ? { kind } : {}), ...(library ? { library: true } : {}) })
    .replace(/</g, '\\u003c');
  const b = `/s/${slug}`;
  let head;
  if (layered) {
    const exclude = preview ? `?exclude=${encodeURIComponent(preview.name)}` : '';
    head = `<style data-modio="layers">@import url("${b}/__tokens.css") layer(legacy);@import url("${b}/__overrides.css") layer(legacy);</style>` +
      `<link rel="stylesheet" href="${b}/__components.css${exclude}" data-modio="components">` +
      (preview ? `<link rel="stylesheet" href="${b}/__draft.css?d=${preview.draft}&amp;v=${preview.version}" data-modio="draft">` : '');
  } else {
    // Tokens vor overrides.css, damit overrides.css die Variablen verwenden kann
    head = `<link rel="stylesheet" href="${b}/__tokens.css" data-modio="tokens"><link rel="stylesheet" href="${b}/__overrides.css" data-modio="overrides">`;
  }
  head += '<link rel="icon" href="/favicon.svg" type="image/svg+xml" data-modio="favicon">';
  const body = `<script data-modio="config">window.__MODIO__=${cfg}</script><script src="/__modio/overlay.js" defer data-modio="overlay"></script>`;
  let html = buf.toString('latin1'); // byte-treu, Injektion ist reines ASCII
  if (layered) html = layerLegacyCss(html);
  const hi = html.search(/<\/head\s*>/i);
  html = hi >= 0 ? html.slice(0, hi) + head + html.slice(hi) : head + html;
  const bodyMatches = [...html.matchAll(/<\/body\s*>/gi)];
  const bi = bodyMatches.length ? bodyMatches.at(-1).index : -1;
  html = bi >= 0 ? html.slice(0, bi) + body + html.slice(bi) : html + body;
  return Buffer.from(html, 'latin1');
}

function emptyProjectHtml(title) {
  const t = String(title).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${t} – noch ohne Seiten</title>
<style>body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#1f2328;background:#fff}main{max-width:640px;margin:0 auto;padding:96px 24px}h1{margin:0 0 8px;font-size:28px}p{margin:0 0 12px;color:#57606a}</style></head>
<body><main data-modio-empty><h1>${t}</h1><p>Dieses Projekt hat noch keine Seiten.</p><p>Eine Seite aus Claude Chat als HTML-Datei herunterladen und unten in der Leiste über <strong>Seiten › Seite importieren …</strong> einspielen.</p></main></body></html>`;
}

// ---------- Komponenten und Entwürfe ----------

const validDraftId = (s) => typeof s === 'string' && /^D-\d{3,}$/.test(s);
async function componentFiles(slug) {
  return (await fsp.readdir(path.join(siteDir(slug), 'components')).catch(() => []))
    .filter((f) => /^mx-[a-z0-9-]+\.css$/.test(f)).sort();
}

// Status wie draft_status in common.sh: übernommen, solange der Schritt im Abzug liegt
function draftStatus(slug, d) {
  if (d.status === 'discarded') return 'discarded';
  if (d.appliedAs && /^A-\d{3,}$/.test(d.appliedAs) && fs.existsSync(path.join(siteDir(slug), 'annotations', `${d.appliedAs}.json`))) return 'applied';
  return 'open';
}

async function readDraft(slug, id) {
  if (!validDraftId(id)) return null;
  const dir = path.join(siteDir(slug), 'drafts', id);
  const d = await readJson(path.join(dir, 'draft.json'), null);
  if (!d) return null;
  const versions = await Promise.all((d.versions || []).map(async (v) => {
    const meta = await readJson(path.join(dir, `v${v.v}`, 'meta.json'), {});
    const befundText = await fsp.readFile(path.join(dir, `v${v.v}`, 'befund.json'), 'utf8').catch(() => null);
    return { v: v.v, prompt: v.prompt, created: v.created, summary: v.summary, name: v.name, title: v.title, costUsd: v.costUsd, warnings: v.warnings || [], source: v.source || null,
      bausteine: Array.isArray(meta.bausteine) ? meta.bausteine.slice(0, 30) : [],
      befund: befundText === null ? [] : validateBefund(befundText).befund, platzhalter: v.platzhalter || 0 };
  }));
  const brief = await readJson(path.join(dir, 'brief', 'brief.json'), null);
  return { id: d.id, page: d.page, selector: d.selector, prompt: d.prompt, created: d.created, status: draftStatus(slug, d),
    external: d.external === true, brief: brief ? { created: brief.created } : null,
    appliedAs: d.appliedAs || null, appliedVersion: d.appliedVersion || null, revises: d.revises || null, renames: d.renames || null, component: d.component?.name || null,
    target: d.target || null, newVariant: d.newVariant || null, variant: d.variant || null, versions };
}

async function listDrafts(slug) {
  const ids = (await fsp.readdir(path.join(siteDir(slug), 'drafts')).catch(() => [])).filter(validDraftId)
    .sort((a, b) => Number(b.slice(2)) - Number(a.slice(2)));
  return (await Promise.all(ids.map((id) => readDraft(slug, id)))).filter(Boolean);
}

// Vorschau: Seite mit dem Element durch die Komponente ersetzt. Gibt { buf, preview } oder { error } zurück.
async function draftPreview(slug, file, rel, draftId, versionArg) {
  const d = await readDraft(slug, draftId);
  if (!d) return { error: 'Entwurf nicht gefunden', leave: true };
  if (d.status !== 'open') return { error: `Entwurf ${d.status === 'applied' ? 'übernommen' : 'verworfen'}`, leave: true };
  const version = Number(versionArg) || Math.max(0, ...d.versions.map((v) => v.v));
  if (!d.versions.some((v) => v.v === version)) return { error: `Version ${versionArg} nicht gefunden` };
  if ('/' + rel.replace(/^\/+/, '') !== d.page) return { error: 'Der Entwurf gehört zu einer anderen Seite' };
  const dir = siteDir(slug);
  const v = await loadVersion(dir, path.join(dir, 'drafts', draftId), version);
  if (v.errors.length) return { error: `Entwurf ungültig: ${v.errors.join('; ')}` };
  const src = readText(file);
  const cheerio = await loadCheerio();
  const r = replaceElement(cheerio, src.text, d.selector, instanceHtml(cheerio, v));
  if (r.error) return { error: r.error };
  return { buf: Buffer.from(r.text, src.enc), preview: { draft: draftId, version, name: v.name } };
}

async function serveSite(req, res, slug, rest, search) {
  const dir = siteDir(slug);
  if (!siteExists(slug)) return sendError(res, 404, 'Website nicht gefunden');

  if (rest === '' || rest === '/') {
    const site = await readJson(path.join(dir, 'site.json'), {});
    let entry = site.entry;
    if (site.kind === 'neu' && (!entry || !fs.existsSync(path.join(dir, 'www', path.normalize(entry))))) {
      entry = (await listSitePages(slug)).entry;
      // Neues Projekt noch ohne Seiten: Platzhalter mit Overlay (nicht im Abzug), dort „Seiten › Seite importieren …“
      if (!entry) {
        const buf = injectHtml(Buffer.from(emptyProjectHtml(site.title || slug), 'utf8'), slug, { empty: true, kind: 'neu' });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': SITE_CSP, 'Content-Length': buf.length });
        return res.end(req.method === 'HEAD' ? undefined : buf);
      }
    }
    if (!entry) return sendError(res, 404, 'Kein Einstiegspfad');
    res.writeHead(302, { Location: `/s/${slug}${entry.split('/').map(encodeURIComponent).join('/')}`, 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (rest === '/__overrides.css') {
    const css = await fsp.readFile(path.join(dir, 'overrides.css')).catch(() => Buffer.alloc(0));
    return send(res, 200, css, { 'Content-Type': 'text/css; charset=utf-8' });
  }
  if (rest === '/__tokens.css') {
    const css = await fsp.readFile(path.join(dir, 'design', 'tokens.css')).catch(() => Buffer.alloc(0));
    return send(res, 200, css, { 'Content-Type': 'text/css; charset=utf-8' });
  }
  const sp = new URLSearchParams(search || '');
  if (rest === '/__components.css') {
    const exclude = `mx-${sp.get('exclude') || ''}.css`;
    const parts = [];
    for (const f of await componentFiles(slug)) if (f !== exclude) parts.push(await fsp.readFile(path.join(dir, 'components', f), 'utf8').catch(() => ''));
    return send(res, 200, parts.join('\n'), { 'Content-Type': 'text/css; charset=utf-8' });
  }
  if (rest === '/__komponenten' || rest === '/__komponenten/') {
    // Komponenten-Bibliothek: alle Komponenten mit ihren Varianten (nicht Teil des Abzugs)
    // ?__modio_draft=D-xxx&__modio_v=n: Vorschau eines Entwurfs mit Ziel Bibliothek (die Komponente in der Entwurfsversion)
    const site = await readJson(path.join(dir, 'site.json'), {});
    let override = null, preview = null;
    const did = sp.get('__modio_draft');
    if (did !== null) {
      const d = validDraftId(did) ? await readDraft(slug, did) : null;
      if (!d || d.status !== 'open' || d.target !== 'library') {
        // Verworfen, übernommen oder kein Bibliotheks-Entwurf: zur normalen Komponentenseite
        res.writeHead(302, { Location: `/s/${slug}/__komponenten`, 'Cache-Control': 'no-store' });
        return res.end();
      }
      const version = Number(sp.get('__modio_v')) || Math.max(0, ...d.versions.map((v) => v.v));
      if (!d.versions.some((v) => v.v === version)) return sendError(res, 409, `Vorschau nicht möglich: Version ${sp.get('__modio_v')} nicht gefunden`);
      const v = await loadVersion(dir, path.join(dir, 'drafts', did), version).catch(() => null);
      if (!v || v.errors.length || !v.library) return sendError(res, 409, 'Vorschau nicht möglich: Entwurf ungültig');
      override = { name: v.name, template: v.html, spec: v.library };
      preview = { draft: did, version, name: v.name };
    }
    const buf = injectHtml(Buffer.from(await libraryPage(dir, { slug, title: site.title || slug, override }), 'utf8'), slug,
      { layered: true, kind: site.kind === 'neu' ? 'neu' : 'abzug', library: true, preview });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': SITE_CSP, 'Content-Length': buf.length });
    return res.end(req.method === 'HEAD' ? undefined : buf);
  }
  if (rest === '/__draft.css') {
    const id = sp.get('d') || '';
    const version = Number(sp.get('v'));
    if (!validDraftId(id) || !Number.isInteger(version) || version < 1) return sendError(res, 400, 'Ungültiger Entwurf');
    const v = await loadVersion(dir, path.join(dir, 'drafts', id), version).catch(() => null);
    if (!v || v.errors.length) return sendError(res, 404, 'Entwurf nicht gefunden oder ungültig');
    return send(res, 200, v.css, { 'Content-Type': 'text/css; charset=utf-8' });
  }
  // Vorschau eines Entwurfs: ?__modio_draft=D-001&__modio_v=2 (nicht Teil des wget-Dateinamens)
  const previewId = sp.get('__modio_draft');
  const previewV = sp.get('__modio_v');
  if (previewId !== null) {
    sp.delete('__modio_draft'); sp.delete('__modio_v');
    search = sp.toString() ? '?' + sp.toString() : '';
  }

  const www = path.join(dir, 'www');
  let rel;
  try { rel = decodeURIComponent(rest); } catch { return sendError(res, 400, 'Ungültiger Pfad'); }
  if (rel.includes('\0')) return sendError(res, 400, 'Ungültiger Pfad');
  const candidates = [];
  const base = path.join(www, path.normalize(rel));
  if (!base.startsWith(www + path.sep)) return sendError(res, 403, 'Pfad außerhalb des Abzugs');
  if (search) candidates.push(base + '@' + search.slice(1)); // wget --restrict-file-names=windows
  candidates.push(base, path.join(base, 'index.html'), base + '.html');

  for (const file of candidates) {
    let st;
    try { st = await fsp.stat(file); } catch { continue; }
    if (!st.isFile()) continue;
    if (rest.endsWith('/') === false && file === path.join(base, 'index.html')) {
      res.writeHead(301, { Location: `/s/${slug}${rest}/`, 'Cache-Control': 'no-store' });
      return res.end();
    }
    const ext = path.extname(file).toLowerCase();
    let type = MIME[ext];
    if (!type) {
      // wget-Dateinamen ohne Endung (z. B. "…?ver=1" -> "@ver=1"): Typ aus Namen raten
      const m = file.match(/\.(css|js|svg|png|jpe?g|gif|webp|woff2?)@/i);
      type = (m && MIME['.' + m[1].toLowerCase().replace('jpg', 'jpeg')]) || 'application/octet-stream';
    }
    let buf = await fsp.readFile(file);
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': SITE_CSP };
    if (type === 'text/html') {
      let preview = null;
      if (previewId !== null) {
        const p = await draftPreview(slug, file, rel, previewId, previewV);
        if (p.leave) {
          // Verworfene oder übernommene Entwürfe: zur normalen Seite statt einer Fehlerseite
          res.writeHead(302, { Location: `/s/${slug}${rest}${search}`, 'Cache-Control': 'no-store' });
          return res.end();
        }
        if (p.error) return sendError(res, 409, `Vorschau nicht möglich: ${p.error}`);
        buf = p.buf; preview = p.preview;
      }
      const kind = (await readJson(path.join(dir, 'site.json'), {})).kind === 'neu' ? 'neu' : 'abzug';
      buf = injectHtml(buf, slug, { layered: !!preview || (await componentFiles(slug)).length > 0, preview, kind });
    }
    res.writeHead(200, { ...headers, 'Content-Length': buf.length });
    return res.end(req.method === 'HEAD' ? undefined : buf);
  }
  return sendError(res, 404, `Nicht im Abzug: ${rel}`);
}

// ---------- API ----------

function checkAuth(req, url) {
  const origin = req.headers.origin;
  if (origin && origin !== 'null') {
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const self = `${proto}://${req.headers.host}`;
    if (!ALLOWED_ORIGINS.has(origin) && origin !== self) return 'Origin nicht erlaubt';
  } else if (origin === 'null') {
    return 'Origin nicht erlaubt';
  }
  const given = req.headers['x-modio-token'] || (url.pathname === '/api/events' ? url.searchParams.get('token') : null) || '';
  const a = Buffer.from(String(given));
  const b = Buffer.from(TOKEN);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return 'Token fehlt oder ist falsch';
  return null;
}

// Entwürfe ändern den Abzug nicht: nur blockieren, wenn gerade ein Auftrag läuft oder wartet (Prüfung ist egal)
async function draftBusyCheck(res, slug) {
  const active = (await activeJobsFor(slug)).filter((j) => j.status !== 'review');
  if (active.length) {
    sendError(res, 409, `Für ${slug} läuft bereits ein Auftrag (${active[0].type}). Der Entwurf ist erst danach möglich.`);
    return true;
  }
  return false;
}

function validateBausteine(a) {
  if (a.bausteine !== undefined && (!Array.isArray(a.bausteine) || a.bausteine.length > 40 || JSON.stringify(a.bausteine).length > 40000)) return 'Ungültige Bausteine';
  if (a.rect !== undefined && a.rect !== null && (typeof a.rect !== 'object' || !Number.isFinite(Number(a.rect.width)))) return 'Ungültige Elementgröße';
  return null;
}

async function busyCheck(res, slug, what) {
  const active = await activeJobsFor(slug);
  if (active.length) {
    const review = active.find((j) => j.status === 'review');
    sendError(res, 409, review
      ? `Für ${slug} wartet ein Schritt auf Prüfung (${review.id}). Erst übernehmen oder verwerfen.`
      : `Für ${slug} läuft bereits ein Auftrag (${active[0].type}). ${what} ist erst danach möglich.`);
    return true;
  }
  return false;
}

function parseAnnotationUpload(req, jobId) {
  return new Promise((resolve, reject) => {
    let bb;
    try {
      bb = busboy({ headers: req.headers, limits: { files: IMAGE_MAX_COUNT, fileSize: IMAGE_MAX_MB * 1024 * 1024, fields: 5, fieldSize: 2 * 1024 * 1024 } });
    } catch (e) {
      return reject(Object.assign(new Error('multipart/form-data erwartet'), { status: 400 }));
    }
    let annotation = null;
    const files = [];
    const writes = [];
    let error = null;
    bb.on('field', (name, val, info) => {
      if (name !== 'annotation') return;
      if (info.valueTruncated) error = 'Annotation zu groß';
      try { annotation = JSON.parse(val); } catch { error = 'Annotation ist kein gültiges JSON'; }
    });
    bb.on('file', (name, stream, info) => {
      const ext = IMAGE_TYPES[info.mimeType];
      if (name !== 'images' || !ext) {
        error = error || `Nicht erlaubter Dateityp: ${info.mimeType} (erlaubt: PNG, JPEG, GIF, WebP)`;
        return stream.resume();
      }
      const rel = `jobs/assets/${jobId}-${files.length + 1}.${ext}`;
      files.push(rel);
      const out = fs.createWriteStream(path.join(JOBS_DIR, 'assets', path.basename(rel)));
      stream.on('limit', () => { error = `Bild größer als ${IMAGE_MAX_MB} MB`; });
      writes.push(new Promise((r) => out.on('close', r)));
      stream.pipe(out);
    });
    bb.on('filesLimit', () => { error = `Höchstens ${IMAGE_MAX_COUNT} Bilder`; });
    bb.on('error', (e) => reject(Object.assign(e, { status: 400 })));
    bb.on('close', async () => {
      await Promise.all(writes);
      if (error) {
        await Promise.all(files.map((f) => fsp.rm(path.join(ROOT, f), { force: true })));
        return reject(Object.assign(new Error(error), { status: 400 }));
      }
      resolve({ annotation, files });
    });
    req.pipe(bb);
  });
}

// HTML aus claude.ai (Artefakt): nur Form prüfen, bereinigt wird im Skript
const IMPORT_MAX_BYTES = 1536 * 1024;
function validateImportHtml(html) {
  if (typeof html !== 'string' || !html.trim()) return 'HTML-Datei fehlt';
  if (Buffer.byteLength(html) > IMPORT_MAX_BYTES) return 'HTML-Datei zu groß (höchstens 1,5 MB)';
  if (!/<[a-z!]/i.test(html)) return 'Die Datei enthält kein HTML';
  return null;
}

function validateAnnotation(a, uploadCount) {
  if (!a || typeof a !== 'object') return 'Annotation fehlt';
  if (typeof a.prompt !== 'string' || !a.prompt.trim()) return 'Prompt fehlt';
  if (a.prompt.length > 10000) return 'Prompt zu lang';
  if (typeof a.page !== 'string' || !a.page.startsWith('/') || a.page.includes('..')) return 'Ungültige Seite';
  if (typeof a.selector !== 'string' || !a.selector || a.selector.length > 2000) return 'Ungültiger Selektor';
  const refs = Array.isArray(a.references) ? a.references : [];
  if (refs.some((r) => r?.type !== 'url' || !validHttpUrl(r.url))) return 'Bild-URLs müssen http- oder https-Adressen sein';
  if (refs.length + uploadCount > IMAGE_MAX_COUNT) return `Höchstens ${IMAGE_MAX_COUNT} Referenzbilder`;
  for (const k of ['remember', 'followup', 'allow_token_change', 'thorough']) {
    if (a[k] !== undefined && typeof a[k] !== 'boolean') return `${k} muss true oder false sein`;
  }
  if (a.followup_of !== undefined && a.followup_of !== null && !/^A-\d{3,}$/.test(String(a.followup_of))) return 'Ungültige Annotation für Nachbessern';
  return null;
}

// Design-Vorgaben von Hand: nur Form prüfen, Inhalt prüft design-save.sh
function validateDesign(body) {
  if (!body || typeof body !== 'object') return 'JSON-Objekt erwartet';
  if (body.tokens === undefined && body.notes === undefined && body.consistency === undefined) return 'tokens, notes oder consistency angeben';
  if (body.consistency !== undefined && (typeof body.consistency !== 'object' || body.consistency === null || Array.isArray(body.consistency))) return 'consistency muss ein Objekt sein';
  if (body.tokens !== undefined && (typeof body.tokens !== 'object' || body.tokens === null || Array.isArray(body.tokens))) return 'tokens muss ein Objekt sein';
  if (body.tokens && Object.keys(body.tokens).length > 200) return 'Höchstens 200 Tokens';
  if (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 20000)) return 'notes muss Text (max. 20 000 Zeichen) sein';
  return null;
}

// Laufende Ausgabe eines Jobs für das Overlay: Skript-Log und Claude-Ereignisse (stream-json), lesbar aufbereitet
async function tailFile(file, bytes) {
  let fh;
  try {
    fh = await fsp.open(file, 'r');
    const { size } = await fh.stat();
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    const text = buf.toString('utf8');
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
  } catch { return ''; } finally { await fh?.close(); }
}
const short = (s, n = 160) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
function toolLine(t) {
  const i = t.input || {};
  const rel = (v) => String(v || '').replace(/^.*?\/sites\/[^/]+\/?/, '') || '.';
  const icon = { Read: '📖', Edit: '✏️', Write: '📝', Grep: '🔎', Glob: '🔎', MultiEdit: '✏️' }[t.name] || '🔧';
  if (t.name === 'Grep' || t.name === 'Glob') return `${icon} ${t.name} „${short(i.pattern, 80)}“${i.path ? ' in ' + short(rel(i.path), 80) : ''}`;
  const target = i.file_path || i.path || i.command || '';
  return `${icon} ${t.name}${target ? ' ' + short(rel(target), 120) : ''}`;
}
async function jobLogLines(id) {
  const lines = [];
  const claude = await tailFile(path.join(ROOT, 'logs', `claude-${id}.json`), 512 * 1024);
  for (const raw of claude.split('\n')) {
    if (!raw.trim()) continue;
    let ev;
    try { ev = JSON.parse(raw); } catch { continue; }
    if (ev.type === 'system' && ev.subtype === 'init') lines.push(`▶ Claude gestartet (${ev.model || 'Modell unbekannt'})`);
    else if (ev.type === 'assistant') {
      for (const c of ev.message?.content || []) {
        if (c.type === 'text' && c.text?.trim()) lines.push('💬 ' + short(c.text, 240));
        else if (c.type === 'tool_use') lines.push(toolLine(c));
      }
    } else if (ev.type === 'user') {
      for (const c of ev.message?.content || []) if (c.type === 'tool_result' && c.is_error) lines.push('⚠ ' + short(typeof c.content === 'string' ? c.content : JSON.stringify(c.content), 160));
    } else if (ev.type === 'result') lines.push(`✔ Claude fertig (${ev.num_turns ?? '?'} Runden${ev.total_cost_usd != null ? ', ' + Number(ev.total_cost_usd).toFixed(3) + ' USD' : ''})`);
  }
  // Skript-Log ohne Zeitstempel-Rauschen, nur Modio-Meldungen
  const script = (await tailFile(path.join(ROOT, 'logs', `${id}.log`), 64 * 1024)).split('\n')
    .filter((l) => /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d \[/.test(l)).map((l) => '· ' + short(l.replace(/^\d{4}-\d\d-\d\d (\d\d:\d\d:\d\d) \[[^\]]+\] /, '$1 '), 200));
  return (lines.length ? [...script.slice(-4), ...lines] : script).slice(-40);
}

// Neue Projekte: Ordner für importierte Seiten (wie page-import.sh: Ordner der Einstiegsseite, sonst "seiten")
function importDir(dir, site) {
  const d = String(site.entry || '').split('/')[1] || '';
  return d && d !== '..' && fs.existsSync(path.join(dir, 'www', d)) ? d : 'seiten';
}

// Neue Projekte ohne feste Einstiegsseite: index.html, sonst startseite.html, sonst die erste Seite
function defaultEntry(pages) {
  const by = (name) => pages.find((p) => p.path.split('/').pop() === name);
  return (by('index.html') || by('startseite.html') || pages[0] || {}).path || null;
}

// Seiten des Abzugs (HTML-Dateien im Ordner der Einstiegsseite) mit Titel und ursprünglicher Adresse.
// Neue Projekte (kind "neu"): alle Seiten unter www/, Adresse ist der Pfad.
async function listSitePages(slug) {
  const dir = siteDir(slug);
  const site = await readJson(path.join(dir, 'site.json'), {});
  const neu = site.kind === 'neu';
  const kind = neu ? 'neu' : 'abzug';
  const entryDir = String(site.entry || '').split('/')[1] || '';
  // Neue Projekte: ohne (vorhandenen) Ordner der Einstiegsseite alle Seiten unter www/
  const hostDir = neu && (!entryDir || entryDir === '..' || !fs.existsSync(path.join(dir, 'www', entryDir))) ? '' : entryDir;
  const root = path.join(dir, 'www', hostDir);
  if ((!neu && !hostDir) || hostDir.includes('..') || !fs.existsSync(root)) {
    // Neue Projekte ohne Seiten (auch ohne www/): kein Einstieg, auch wenn site.json noch einen alten nennt
    return neu ? { kind, entry: null, pages: [], importDir: importDir(dir, site) } : { kind, entry: site.entry || null, pages: [] };
  }
  const files = [];
  const walk = async (d) => {
    for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== '_modio-assets') await walk(p); }
      else if (/\.html?(@.*)?$/i.test(e.name)) files.push(p);
      if (files.length > 1000) return;
    }
  };
  await walk(root);
  const proto = /^https:/i.test(site.url || '') ? 'https' : 'http';
  const pages = await Promise.all(files.map(async (f) => {
    const rel = '/' + path.relative(path.join(dir, 'www'), f).split(path.sep).join('/');
    let title = '';
    try {
      const fh = await fsp.open(f, 'r');
      const buf = Buffer.alloc(65536);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      await fh.close();
      const m = buf.subarray(0, bytesRead).toString('utf8').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (m) title = m[1].replace(/\s+/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    } catch { /* ohne Titel */ }
    if (neu) return { path: rel, title, url: rel };
    const urlPath = rel.slice(hostDir.length + 1).replace(/(^|\/)index\.html?$/i, '$1').replace(/@(.*)$/, '?$1');
    return { path: rel, title, url: `${proto}://${hostDir.replace('+', ':')}${urlPath}` };
  }));
  pages.sort((a, b) => a.path.localeCompare(b.path));
  const entry = neu ? (pages.some((p) => p.path === site.entry) ? site.entry : defaultEntry(pages)) : site.entry || null;
  pages.sort((a, b) => (a.path === entry ? -1 : b.path === entry ? 1 : 0));
  return { kind, entry, pages, ...(neu ? { importDir: importDir(dir, site) } : {}) };
}

// Job-Parameter einer Annotation (direkt oder aus der Queue)
function annotationParams(slug, annotation, files) {
  return {
    site: slug,
    page: annotation.page,
    selector: annotation.selector,
    html: String(annotation.html || '').slice(0, 50000),
    text: String(annotation.text || '').slice(0, 5000),
    viewport: annotation.viewport && { width: Number(annotation.viewport.width) || null, height: Number(annotation.viewport.height) || null },
    prompt: annotation.prompt.trim(),
    thorough: annotation.thorough === true,
    remember: annotation.remember === true,
    followup: annotation.followup === true,
    followup_of: annotation.followup === true && annotation.followup_of ? String(annotation.followup_of) : null,
    allow_token_change: annotation.allow_token_change === true,
    references: [...files.map((file) => ({ type: 'upload', file })), ...(annotation.references || []).map((r) => ({ type: 'url', url: r.url }))],
  };
}

// Queue gesammelter Annotationen: jobs/queue/<slug>/<id>.json
// Reihenfolge der Aufnahme (IDs sind nur sekundengenau)
const byCreated = (a, b) => String(a.created).localeCompare(String(b.created)) || String(a.id).localeCompare(String(b.id));
const queueSummary = (q) => ({ id: q.id, created: q.created, page: q.params.page, selector: q.params.selector, prompt: q.params.prompt, references: (q.params.references || []).length });
async function readQueue(slug) {
  const dir = path.join(JOBS_DIR, 'queue', slug);
  const files = (await fsp.readdir(dir).catch(() => [])).filter((f) => /^job-\d{14}-[0-9a-f]{6}\.json$/.test(f)).sort();
  return (await Promise.all(files.map((f) => readJson(path.join(dir, f), null)))).filter(Boolean).sort(byCreated).map(queueSummary);
}

// Tokens, Regeln, Scan und Hinweise des letzten Schritts für das Overlay
async function readDesign(slug) {
  const dir = siteDir(slug);
  const tokensFile = await readJson(path.join(dir, 'design', 'tokens.json'), null);
  const notes = await fsp.readFile(path.join(dir, 'design', 'notes.md'), 'utf8').catch(() => null);
  const scan = await readJson(path.join(dir, '.scan.json'), null);
  const consistency = await readJson(path.join(dir, 'design', 'consistency.json'), null);
  let warnings = [];
  let annotationId = null;
  const ids = (await fsp.readdir(path.join(dir, 'annotations')).catch(() => []))
    .map((f) => (f.match(/^(A-\d+)\.json$/) || [])[1])
    .filter(Boolean)
    .sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
  if (ids.length) {
    annotationId = ids.at(-1);
    // Hinweise nur, solange dieser Schritt der aktuelle Stand ist (danach z. B. angeglichen oder überholt)
    const history = await readJson(path.join(dir, '.history.json'), null);
    const last = history?.steps?.at(-1);
    if (!history || (last && last.id === annotationId && last.commit === history.head)) {
      const ann = await readJson(path.join(dir, 'annotations', `${annotationId}.json`), {});
      warnings = ann.check?.warnings || [];
    }
  }
  return { slug, initialized: !!tokensFile, tokens: tokensFile?.tokens || {}, notes: notes ?? '', scan, consistency, warnings, annotationId };
}

async function handleApi(req, res, url) {
  const authError = checkAuth(req, url);
  if (authError) return sendError(res, 403, authError);
  const p = url.pathname;
  let m;

  if (p === '/api/events' && req.method === 'GET') return sse.add(req, res);

  if (p === '/api/sites' && req.method === 'GET') return send(res, 200, await readJson(path.join(STATE_DIR, 'sites.json'), { sites: [] }));

  if (p === '/api/projects' && req.method === 'POST') {
    // Neues Projekt ohne Website (Gestaltung neuer Designs)
    const body = await readBody(req);
    const slug = String(body.slug || '').trim();
    const title = String(body.title || '').trim() || slug;
    if (!validSlug(slug)) return sendError(res, 400, 'Ungültiger Kurzname (a-z, 0-9, Bindestrich)');
    if (title.length > 80 || /[\0\n]/.test(title)) return sendError(res, 400, 'Titel zu lang (höchstens 80 Zeichen)');
    if (siteExists(slug)) return sendError(res, 409, `${slug} existiert bereits`);
    const pending = await listJobs((j) => (j.type === 'project-new' || j.type === 'site-new') && j.slug === slug);
    if (pending.some((j) => ACTIVE.includes(j.status))) return sendError(res, 409, `${slug} wird bereits angelegt`);
    return send(res, 202, { job: await createJob('project-new', slug, { slug, title }) });
  }

  if (p === '/api/sites' && req.method === 'POST') {
    const body = await readBody(req);
    if (!validHttpUrl(body.url)) return sendError(res, 400, 'Bitte eine gültige http- oder https-URL angeben');
    const slug = body.slug ? String(body.slug).trim() : slugFromUrl(body.url);
    if (!validSlug(slug)) return sendError(res, 400, 'Ungültiger Kurzname (a-z, 0-9, Bindestrich)');
    if (siteExists(slug)) return sendError(res, 409, `Website ${slug} existiert bereits. Weitere Seiten dieser Website über „Seiten hinzufügen“ in der Websiteliste ergänzen.`);
    const pending = await listJobs((j) => j.type === 'site-new' && j.slug === slug);
    if (pending.some((j) => ACTIVE.includes(j.status))) return sendError(res, 409, `Website ${slug} wird bereits angelegt`);
    const urls = (Array.isArray(body.urls) ? body.urls : []).map((u) => String(u).trim()).filter(Boolean);
    if (urls.length > 500) return sendError(res, 400, 'Höchstens 500 Seiten');
    const bad = urls.find((u) => !validHttpUrl(u));
    if (bad) return sendError(res, 400, `Ungültige URL in der Seitenliste: ${bad}`);
    return send(res, 202, { job: await createJob('site-new', slug, { url: body.url, slug, urls }) });
  }

  if ((m = p.match(/^\/api\/jobs\/(job-\d{14}-[0-9a-f]{6})\/log$/)) && req.method === 'GET') {
    return send(res, 200, { lines: await jobLogLines(m[1]) });
  }
  if ((m = p.match(/^\/api\/jobs\/([^/]+)\/decision$/)) && req.method === 'POST') {
    if (!validJobId(m[1])) return sendError(res, 400, 'Ungültige Job-ID');
    const body = await readBody(req);
    if (!['accept', 'discard'].includes(body.action)) return sendError(res, 400, 'action muss accept oder discard sein');
    const job = await findJob(m[1]);
    if (!job) return sendError(res, 404, 'Job nicht gefunden');
    if (job.status !== 'review') return sendError(res, 409, 'Job wartet nicht auf Prüfung');
    const dup = await listJobs((j) => j.type === 'decision' && j.params?.jobId === job.id);
    if (dup.some((j) => ['pending', 'running'].includes(j.status))) return sendError(res, 409, 'Entscheidung wird bereits verarbeitet');
    return send(res, 202, { job: await createJob('decision', job.slug, { jobId: job.id, action: body.action, annotationId: job.result?.annotationId }) });
  }

  if ((m = p.match(/^\/api\/jobs\/([^/]+)\/cancel$/)) && req.method === 'POST') {
    if (!validJobId(m[1])) return sendError(res, 400, 'Ungültige Job-ID');
    let job = await findJob(m[1]);
    if (!job) return sendError(res, 404, 'Job nicht gefunden');
    if (!CANCELABLE.includes(job.type)) return sendError(res, 400, 'Abbrechen gibt es nur für Entwürfe');
    if (job.status === 'pending') {
      // Noch nicht gestartet: selbst als abgebrochen ablegen. Schlägt das Verschieben fehl, hat der Worker ihn gerade übernommen.
      const to = path.join(JOBS_DIR, 'failed', `${job.id}.json`);
      let moved = false;
      try { await fsp.rename(path.join(JOBS_DIR, 'pending', `${job.id}.json`), to); moved = true; } catch { /* inzwischen gestartet */ }
      if (moved) {
        const now = new Date().toISOString();
        const done = { ...job, status: 'failed', cancelled: true, error: 'Abgebrochen', result: { status: 'cancelled', error: 'Abgebrochen' }, finished: now, updated: now };
        const tmp = path.join(JOBS_DIR, `.${job.id}.cancel.tmp`);
        await fsp.writeFile(tmp, JSON.stringify(done, null, 2));
        await fsp.rename(tmp, to);
        const files = [...(job.params?.references || []).filter((r) => r.type === 'upload').map((r) => r.file), job.params?.importFile].filter(Boolean);
        for (const f of files) if (/^jobs\/assets\/[^/]+$/.test(f)) await fsp.rm(path.join(ROOT, f), { force: true });
        return send(res, 200, { job: slimJob(done) });
      }
      job = await findJob(m[1]);
    }
    if (job?.status !== 'running') return sendError(res, 409, 'Der Entwurf läuft nicht mehr');
    // Laufender Auftrag: der Worker beendet ihn, sobald er die Markierung sieht
    await fsp.writeFile(path.join(JOBS_DIR, 'running', `${job.id}.cancel`), new Date().toISOString());
    return send(res, 202, { job: slimJob(job), cancelling: true });
  }

  if (p === '/api/jobs' && req.method === 'GET') {
    const slug = url.searchParams.get('slug');
    if (slug && !validSlug(slug)) return sendError(res, 400, 'Ungültiger Slug');
    const jobs = await listJobs((j) => !slug || j.slug === slug);
    const active = jobs.filter((j) => ACTIVE.includes(j.status));
    const finished = jobs.filter((j) => !ACTIVE.includes(j.status)).slice(-20);
    return send(res, 200, { jobs: [...finished, ...active].map(slimJob) });
  }

  if ((m = p.match(/^\/api\/sites\/([^/]+)\/drafts\/(D-\d{3,})\/versions\/(\d{1,4})$/)) && req.method === 'GET') {
    // Markup einer Version für das Live-Umschalten in der Vorschau (geprüft wie die Vorschau selbst)
    const [, slug, id, vs] = m;
    if (!validSlug(slug) || !siteExists(slug)) return sendError(res, 404, 'Website nicht gefunden');
    const dir = siteDir(slug);
    const v = await loadVersion(dir, path.join(dir, 'drafts', id), Number(vs)).catch(() => null);
    if (!v || !v.html) return sendError(res, 404, 'Version nicht gefunden');
    if (v.errors.length) return sendError(res, 409, `Version ungültig: ${v.errors.join('; ')}`);
    return send(res, 200, { version: Number(vs), name: v.name, html: instanceHtml(await loadCheerio(), v) });
  }
  // Briefing für claude.ai: Text und Dateien (nur die in brief.json genannten)
  if ((m = p.match(/^\/api\/sites\/([^/]+)\/drafts\/(D-\d{3,})\/brief(?:\/([A-Za-z0-9._-]{1,100}))?$/)) && req.method === 'GET') {
    const [, slug, id, file] = m;
    if (!validSlug(slug) || !siteExists(slug)) return sendError(res, 404, 'Website nicht gefunden');
    const bdir = path.join(siteDir(slug), 'drafts', id, 'brief');
    const meta = await readJson(path.join(bdir, 'brief.json'), null);
    if (!meta) return sendError(res, 404, 'Kein Briefing vorhanden');
    if (!file) {
      const text = await fsp.readFile(path.join(bdir, meta.text || 'briefing.md'), 'utf8').catch(() => '');
      const files = await Promise.all((meta.files || []).map(async (f) => ({ ...f, size: (await fsp.stat(path.join(bdir, f.file)).catch(() => ({ size: 0 }))).size })));
      return send(res, 200, { created: meta.created, text, files });
    }
    if (!(meta.files || []).some((f) => f.file === file)) return sendError(res, 404, 'Datei nicht im Briefing');
    const buf = await fsp.readFile(path.join(bdir, file)).catch(() => null);
    if (!buf) return sendError(res, 404, 'Datei fehlt');
    const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8';
    // als Download, nie als Seite im Origin des Werkzeugs anzeigen
    return send(res, 200, buf, { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${file}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  }
  if ((m = p.match(/^\/api\/sites\/([^/]+)\/drafts\/(D-\d{3,})(?:\/(versions|apply|discard|brief|import))?$/))) {
    const [, slug, id, action] = m;
    if (!validSlug(slug)) return sendError(res, 400, 'Ungültiger Slug');
    if (!siteExists(slug)) return sendError(res, 404, 'Website nicht gefunden');
    const draft = await readDraft(slug, id);
    if (!draft) return sendError(res, 404, 'Entwurf nicht gefunden');
    if (!action && req.method === 'GET') return send(res, 200, { draft });
    if (!action || req.method !== 'POST') return sendError(res, 405, 'Methode nicht erlaubt');
    if (draft.status !== 'open') return sendError(res, 409, `${id} ist nicht mehr offen`);
    const body = await readBody(req, action === 'import' ? IMPORT_MAX_BYTES + 64 * 1024 : undefined);
    if (action === 'brief') {
      if (await draftBusyCheck(res, slug)) return;
      return send(res, 202, { job: await createJob('draft-brief', slug, { draft: id }) });
    }
    if (action === 'import') {
      const err = validateImportHtml(body.html);
      if (err) return sendError(res, 400, err);
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 10000) : '';
      if (await draftBusyCheck(res, slug)) return;
      const jobId = newJobId();
      const file = `jobs/assets/${jobId}-import.html`;
      await fsp.writeFile(path.join(JOBS_DIR, 'assets', path.basename(file)), body.html);
      return send(res, 202, { job: await createJob('draft', slug, { draft: id, prompt: prompt || 'Übernahme des Entwurfs aus claude.ai', importFile: file }, jobId) });
    }
    if (action === 'versions') {
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
      if (!prompt) return sendError(res, 400, 'Prompt fehlt');
      if (prompt.length > 10000) return sendError(res, 400, 'Prompt zu lang');
      if (await draftBusyCheck(res, slug)) return;
      return send(res, 202, { job: await createJob('draft', slug, { draft: id, prompt }) });
    }
    if (action === 'apply') {
      const version = body.version === undefined ? undefined : Number(body.version);
      if (version !== undefined && !draft.versions.some((v) => v.v === version)) return sendError(res, 400, 'Version nicht gefunden');
      if (await busyCheck(res, slug, 'Das Übernehmen des Entwurfs')) return;
      return send(res, 202, { job: await createJob('draft-apply', slug, { draft: id, version, page: draft.page, selector: draft.selector }) });
    }
    if (action === 'discard') {
      if (await draftBusyCheck(res, slug)) return;
      return send(res, 202, { job: await createJob('draft-discard', slug, { draft: id }) });
    }
  }

  if ((m = p.match(/^\/api\/sites\/([^/]+)\/queue\/(job-\d{14}-[0-9a-f]{6})$/)) && req.method === 'DELETE') {
    const [, slug, qid] = m;
    if (!validSlug(slug)) return sendError(res, 400, 'Ungültiger Slug');
    const file = path.join(JOBS_DIR, 'queue', slug, `${qid}.json`);
    const item = await readJson(file, null);
    if (!item) return sendError(res, 404, 'Nicht in der Queue');
    for (const r of item.params?.references || []) {
      if (r.type === 'upload' && /^jobs\/assets\/[^/]+$/.test(r.file)) await fsp.rm(path.join(ROOT, r.file), { force: true });
    }
    await fsp.rm(file, { force: true });
    sse.emit('queue', { slug });
    return send(res, 200, { items: await readQueue(slug) });
  }
  if ((m = p.match(/^\/api\/sites\/([^/]+)\/pages\/import$/)) && req.method === 'POST') {
    // Neues Projekt: HTML-Seite (z. B. aus Claude Chat) unverändert als Seite übernehmen
    const slug = m[1];
    if (!validSlug(slug)) return sendError(res, 400, 'Ungültiger Slug');
    if (!siteExists(slug)) return sendError(res, 404, 'Website nicht gefunden');
    const site = await readJson(path.join(siteDir(slug), 'site.json'), {});
    if (site.kind !== 'neu') return sendError(res, 400, 'Seiten importieren gibt es nur bei neuen Projekten. Bei Abzügen: Seiten hinzufügen.');
    const body = await readBody(req, IMPORT_MAX_BYTES + 64 * 1024);
    const name = String(body.name || '').trim();
    if (!validSlug(name)) return sendError(res, 400, 'Ungültiger Seitenname (a-z, 0-9, Bindestrich)');
    const err = validateImportHtml(body.html);
    if (err) return sendError(res, 400, err);
    const page = `/${importDir(siteDir(slug), site)}/${name}.html`;
    const exists = fs.existsSync(path.join(siteDir(slug), 'www', page));
    if (exists && body.replace !== true) return send(res, 409, { error: `Die Seite ${page} gibt es schon.`, exists: true, page });
    if (await busyCheck(res, slug, 'Der Import')) return;
    const jobId = newJobId();
    const file = `jobs/assets/${jobId}-page.html`;
    await fsp.writeFile(path.join(JOBS_DIR, 'assets', path.basename(file)), body.html);
    return send(res, 202, { job: await createJob('page-import', slug, { name, page, file, replace: exists }, jobId) });
  }

  if ((m = p.match(/^\/api\/sites\/([^/]+)\/components\/delete$/)) && req.method === 'POST') {
    // Komponente oder Variante aus der Bibliothek löschen (Verwendungen bleiben als Markup ohne Kennzeichnung)
    const slug = m[1];
    if (!validSlug(slug)) return sendError(res, 400, 'Ungültiger Slug');
    if (!siteExists(slug)) return sendError(res, 404, 'Website nicht gefunden');
    const body = await readBody(req);
    const name = String(body.name || ''), variant = body.variant ? String(body.variant) : '';
    const comp = (await listLibrary(siteDir(slug))).find((c) => c.name === name);
    if (!comp) return sendError(res, 404, 'Komponente nicht in der Bibliothek');
    if (variant && !comp.varianten.some((v) => v.key === variant)) return sendError(res, 404, 'Variante nicht gefunden');
    if (variant && comp.varianten.length === 1) return sendError(res, 400, 'Das ist die einzige Variante: stattdessen die Komponente löschen');
    if (await busyCheck(res, slug, 'Das Löschen')) return;
    return send(res, 202, { job: await createJob('component-delete', slug, variant ? { name, variant } : { name }) });
  }
  if ((m = p.match(/^\/api\/sites\/([^/]+)\/components\/sync$/)) && req.method === 'POST') {
    // Kopien einer Komponente nach der Vorlage angleichen (nur neue Projekte)
    const slug = m[1];
    if (!validSlug(slug)) return sendError(res, 400, 'Ungültiger Slug');
    if (!siteExists(slug)) return sendError(res, 404, 'Website nicht gefunden');
    if ((await readJson(path.join(siteDir(slug), 'site.json'), {})).kind !== 'neu') return sendError(res, 400, 'Komponenten-Bibliothek gibt es nur bei neuen Projekten');
    const body = await readBody(req);
    const name = String(body.name || '');
    if (!(await listLibrary(siteDir(slug))).some((c) => c.name === name)) return sendError(res, 404, 'Komponente nicht in der Bibliothek');
    if (await busyCheck(res, slug, 'Das Angleichen')) return;
    return send(res, 202, { job: await createJob('component-sync', slug, { name }) });
  }
  if ((m = p.match(/^\/api\/sites\/([^/]+)\/components\/(rename|merge)$/)) && req.method === 'POST') {
    // Komponente umbenennen oder in eine andere zusammenführen (nur neue Projekte)
    const slug = m[1], action = m[2];
    if (!validSlug(slug)) return sendError(res, 400, 'Ungültiger Slug');
    if (!siteExists(slug)) return sendError(res, 404, 'Website nicht gefunden');
    if ((await readJson(path.join(siteDir(slug), 'site.json'), {})).kind !== 'neu') return sendError(res, 400, 'Komponenten-Bibliothek gibt es nur bei neuen Projekten');
    const body = await readBody(req);
    const re = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
    const name = String(body.name || '');
    const library = await listLibrary(siteDir(slug));
    if (!library.some((c) => c.name === name)) return sendError(res, 404, 'Komponente nicht in der Bibliothek');
    if (action === 'rename') {
      const newName = String(body.newName || '').trim();
      if (!re.test(newName) || newName.length > 60) return sendError(res, 400, 'Ungültiger Name (a-z, 0-9, Bindestrich)');
      if (newName === name) return sendError(res, 400, 'Der neue Name ist der bisherige');
      if (['css', 'html', 'json'].some((x) => fs.existsSync(path.join(siteDir(slug), 'components', `mx-${newName}.${x}`)))) return sendError(res, 409, `mx-${newName} gibt es schon`);
      if (await busyCheck(res, slug, 'Das Umbenennen')) return;
      return send(res, 202, { job: await createJob('component-rename', slug, { name, newName }) });
    }
    const into = String(body.into || ''), variant = String(body.variant || '');
    const target = library.find((c) => c.name === into);
    if (!target || into === name) return sendError(res, 404, 'Ziel-Komponente nicht in der Bibliothek');
    if (!target.varianten.some((v) => v.key === variant)) return sendError(res, 404, 'Variante nicht gefunden');
    const src = library.find((c) => c.name === name);
    const missing = src.slots.filter((s) => !target.slots.some((t) => t.key === s.key)).map((s) => s.key);
    if (missing.length) return sendError(res, 400, `mx-${into} hat diese Inhalte von mx-${name} nicht: ${missing.join(', ')}. Erst in mx-${into} ergänzen (Ändern …).`);
    if (await busyCheck(res, slug, 'Das Zusammenführen')) return;
    return send(res, 202, { job: await createJob('component-merge', slug, { name, into, variant }) });
  }
  if ((m = p.match(/^\/api\/sites\/([^/]+)\/components\/draft$/)) && req.method === 'POST') {
    // Komponente auf der Komponentenseite ändern oder Variante hinzufügen (Entwurf mit Ziel Bibliothek, nur neue Projekte)
    const slug = m[1];
    if (!validSlug(slug)) return sendError(res, 400, 'Ungültiger Slug');
    if (!siteExists(slug)) return sendError(res, 404, 'Website nicht gefunden');
    if ((await readJson(path.join(siteDir(slug), 'site.json'), {})).kind !== 'neu') return sendError(res, 400, 'Komponenten-Bibliothek gibt es nur bei neuen Projekten');
    const body = await readBody(req);
    const name = String(body.name || ''), prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const variant = body.variant ? String(body.variant) : '';
    const comp = (await listLibrary(siteDir(slug))).find((c) => c.name === name);
    if (!comp) return sendError(res, 404, 'Komponente nicht in der Bibliothek');
    if (!prompt || prompt.length > 10000) return sendError(res, 400, 'Bitte beschreiben, was sich ändern soll');
    if (variant && !comp.varianten.some((v) => v.key === variant)) return sendError(res, 404, 'Variante nicht gefunden');
    let newVariant = null;
    if (body.newVariant) {
      const key = String(body.newVariant.key || ''), label = String(body.newVariant.label || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(key) || key.length > 40) return sendError(res, 400, 'Ungültiger Variantenname (a-z, 0-9, Bindestrich, mit Buchstaben beginnen)');
      if (comp.varianten.some((v) => v.key === key)) return sendError(res, 400, `Variante ${key} gibt es schon`);
      newVariant = { key, label: label || key };
    }
    if (await draftBusyCheck(res, slug)) return;
    return send(res, 202, { job: await createJob('draft', slug, { site: slug, mode: 'library', component: name, variant, newVariant, prompt, viewport: null, references: [] }) });
  }
  if ((m = p.match(/^\/api\/sites\/([^/]+)\/pages\/delete$/)) && req.method === 'POST') {
    // Seite löschen (Abzüge und neue Projekte) als Schritt; die Startseite eines Abzugs bleibt
    const slug = m[1];
    if (!validSlug(slug)) return sendError(res, 400, 'Ungültiger Slug');
    if (!siteExists(slug)) return sendError(res, 404, 'Website nicht gefunden');
    const body = await readBody(req);
    const page = String(body.page || '');
    const list = await listSitePages(slug);
    if (!list.pages.some((x) => x.path === page)) return sendError(res, 404, 'Seite nicht gefunden');
    if (list.kind !== 'neu' && page === list.entry) return sendError(res, 400, 'Die Startseite des Abzugs lässt sich nicht löschen.');
    if (await busyCheck(res, slug, 'Das Löschen')) return;
    return send(res, 202, { job: await createJob('page-delete', slug, { page }) });
  }

  if ((m = p.match(/^\/api\/sites\/([^/]+)\/(recrawl|annotations|rollback|history|report|design|tokens\/propose|pages|areas\/sync|local-commit|inspect|status|queue|queue\/run|drafts|components|package|export)$/))) {
    const [, slug, action] = m;
    if (!validSlug(slug)) return sendError(res, 400, 'Ungültiger Slug');
    if (!siteExists(slug)) return sendError(res, 404, 'Website nicht gefunden');
    if ((action === 'recrawl' || (action === 'pages' && req.method === 'POST')) && (await readJson(path.join(siteDir(slug), 'site.json'), {})).kind === 'neu') {
      return sendError(res, 400, 'Neues Projekt ohne Website: Neu einlesen und Seiten hinzufügen gibt es hier nicht (Seiten: „Seite importieren …“)');
    }

    if (action === 'history' && req.method === 'GET') {
      return send(res, 200, await readJson(path.join(siteDir(slug), '.history.json'), { slug, head: null, baseline: null, steps: [] }));
    }
    if (action === 'design' && req.method === 'GET') return send(res, 200, await readDesign(slug));
    if (action === 'queue' && req.method === 'GET') return send(res, 200, { items: await readQueue(slug) });
    if (action === 'drafts' && req.method === 'GET') return send(res, 200, { drafts: await listDrafts(slug), components: (await componentFiles(slug)).map((f) => f.slice(0, -4)) });
    if (action === 'pages' && req.method === 'GET') return send(res, 200, await listSitePages(slug));
    if (action === 'components' && req.method === 'GET') {
      const list = await listLibrary(siteDir(slug));
      return send(res, 200, { components: list, url: `/s/${slug}/__komponenten` });
    }
    if (action === 'status' && req.method === 'GET') {
      // Nur lesend: ungespeicherte Änderungen im Abzug (für „Änderungen übernehmen“ im Overlay)
      const out = await new Promise((resolve) => execFile('git', ['-C', siteDir(slug), 'status', '--porcelain', '--untracked-files=all', '--', '.', ':(exclude)annotations/'],
        { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : stdout)));
      const files = out.split('\n').filter(Boolean).map((l) => l.slice(3));
      return send(res, 200, { changed: files.length, files: files.slice(0, 50) });
    }
    if (action === 'design' && req.method === 'PUT') {
      const body = await readBody(req, 512 * 1024);
      const err = validateDesign(body);
      if (err) return sendError(res, 400, err);
      if (await busyCheck(res, slug, 'Das Speichern der Design-Vorgaben')) return;
      const id = newJobId();
      const file = `jobs/assets/${id}-design.json`;
      const payload = {};
      if (body.tokens !== undefined) payload.tokens = body.tokens;
      if (body.notes !== undefined) payload.notes = body.notes;
      if (body.consistency !== undefined) payload.consistency = body.consistency;
      await fsp.writeFile(path.join(ROOT, file), JSON.stringify(payload, null, 2));
      return send(res, 202, { job: await createJob('design-save', slug, { file }, id) });
    }
    if (req.method !== 'POST') return sendError(res, 405, 'Methode nicht erlaubt');

    if (action === 'tokens/propose') {
      if (await busyCheck(res, slug, 'Das Ableiten von Tokens')) return;
      return send(res, 202, { job: await createJob('tokens-propose', slug, {}) });
    }

    if (action === 'annotations') {
      if (await busyCheck(res, slug, 'Eine neue Annotation')) return req.resume();
      const id = newJobId();
      const { annotation, files } = await parseAnnotationUpload(req, id);
      const err = validateAnnotation(annotation, files.length);
      if (err) {
        await Promise.all(files.map((f) => fsp.rm(path.join(ROOT, f), { force: true })));
        return sendError(res, 400, err);
      }
      const params = annotationParams(slug, annotation, files);
      return send(res, 202, { job: await createJob('annotate', slug, params, id) });
    }
    if (action === 'drafts') {
      if (await draftBusyCheck(res, slug)) return req.resume();
      const id = newJobId();
      const { annotation, files } = await parseAnnotationUpload(req, id);
      const mode = annotation && ['brief', 'import', 'component'].includes(annotation.mode) ? annotation.mode : null;
      if (mode === 'import' && annotation && (typeof annotation.prompt !== 'string' || !annotation.prompt.trim())) annotation.prompt = 'Übernahme des Entwurfs aus claude.ai';
      if (mode === 'component' && annotation && (typeof annotation.prompt !== 'string' || !annotation.prompt.trim())) annotation.prompt = 'Als Komponente für die Bibliothek anlegen';
      let err = validateAnnotation(annotation, files.length) || validateBausteine(annotation) || (mode === 'import' ? validateImportHtml(annotation.importHtml) : null);
      if (!err && mode === 'component') {
        // Komponenten-Bibliothek: nur neue Projekte, Name wie eine Klasse mx-<name>
        const name = String(annotation.componentName || '');
        if ((await readJson(path.join(siteDir(slug), 'site.json'), {})).kind !== 'neu') err = 'Komponenten-Bibliothek gibt es nur bei neuen Projekten';
        else if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name) || name.length > 40) err = 'Ungültiger Komponentenname (a-z, 0-9, Bindestrich, mit Buchstaben beginnen)';
      }
      if (err) {
        await Promise.all(files.map((f) => fsp.rm(path.join(ROOT, f), { force: true })));
        return sendError(res, 400, err);
      }
      const { page, selector, html, text, viewport, prompt, references } = annotationParams(slug, annotation, files);
      const params = { site: slug, page, selector, html, text, viewport, prompt, references,
        rect: annotation.rect ? { width: Math.round(Number(annotation.rect.width)) || null, height: Math.round(Number(annotation.rect.height)) || null } : null,
        bausteine: annotation.bausteine || [] };
      if (mode === 'brief') params.mode = 'brief';
      if (mode === 'component') { params.mode = 'component'; params.componentName = String(annotation.componentName); }
      if (mode === 'import') {
        params.importFile = `jobs/assets/${id}-import.html`;
        await fsp.writeFile(path.join(JOBS_DIR, 'assets', path.basename(params.importFile)), annotation.importHtml);
      }
      return send(res, 202, { job: await createJob('draft', slug, params, id) });
    }
    if (action === 'queue') {
      // Sammeln: kein Busy-Check, die Queue darf wachsen, während ein Schritt läuft
      const id = newJobId();
      const { annotation, files } = await parseAnnotationUpload(req, id);
      let err = validateAnnotation(annotation, files.length);
      if (!err && annotation.followup === true) err = 'Nachbessern kann nicht in die Queue';
      if (!err && (await readQueue(slug)).length >= 20) err = 'Höchstens 20 Annotationen in der Queue';
      if (err) {
        await Promise.all(files.map((f) => fsp.rm(path.join(ROOT, f), { force: true })));
        return sendError(res, 400, err);
      }
      const dir = path.join(JOBS_DIR, 'queue', slug);
      await fsp.mkdir(dir, { recursive: true });
      const item = { id, created: new Date().toISOString(), params: annotationParams(slug, annotation, files) };
      await fsp.writeFile(path.join(dir, `${id}.json`), JSON.stringify(item, null, 2));
      sse.emit('queue', { slug });
      return send(res, 201, { item: queueSummary(item), items: await readQueue(slug) });
    }
    if (action === 'queue/run') {
      const body = await readBody(req);
      if (await busyCheck(res, slug, 'Das Umsetzen der Queue')) return;
      const dir = path.join(JOBS_DIR, 'queue', slug);
      const files = (await fsp.readdir(dir).catch(() => [])).filter((f) => /^job-\d{14}-[0-9a-f]{6}\.json$/.test(f)).sort();
      const items = (await Promise.all(files.map((f) => readJson(path.join(dir, f), null)))).filter(Boolean).sort(byCreated).map((q) => q.params);
      if (!items.length) return sendError(res, 400, 'Die Queue ist leer');
      const prompt = items.length === 1 ? items[0].prompt
        : `Sammelauftrag (${items.length} Annotationen)\n\n` + items.map((it, i) => `${i + 1}) ${it.prompt}`).join('\n');
      const params = items.length === 1 ? { ...items[0], thorough: body.thorough !== false }
        : { site: slug, batch: true, items, page: items[0].page, selector: items[0].selector, prompt, thorough: body.thorough !== false,
            remember: false, followup: false, followup_of: null, allow_token_change: false, references: [] };
      const job = await createJob('annotate', slug, params);
      await Promise.all(files.map((f) => fsp.rm(path.join(dir, f), { force: true })));
      sse.emit('queue', { slug });
      return send(res, 202, { job });
    }
    if (action === 'package') {
      // Tokens aus tokens-quelle.css übernehmen (Commit unter design/) und Paket für Claude erzeugen
      if (await busyCheck(res, slug, 'Das Paket')) return;
      return send(res, 202, { job: await createJob('project-package', slug, {}) });
    }
    if (action === 'export') {
      if (await draftBusyCheck(res, slug)) return;
      return send(res, 202, { job: await createJob('project-export', slug, {}) });
    }
    if (action === 'recrawl') {
      const body = await readBody(req);
      if (await busyCheck(res, slug, 'Neu einlesen')) return;
      return send(res, 202, { job: await createJob('site-recrawl', slug, { keepDesign: body.keepDesign !== false }) });
    }
    if (action === 'local-commit') {
      if (await busyCheck(res, slug, 'Das Übernehmen lokaler Änderungen')) return;
      return send(res, 202, { job: await createJob('local-commit', slug, {}) });
    }
    if (action === 'inspect') {
      const body = await readBody(req, 1024 * 1024);
      const page = String(body.page || '');
      const selector = String(body.selector || '').trim();
      // Mehrere Elemente (items) und CSS-Regeln (rules) auf einmal; einzelnes Element (selector/html) weiter möglich
      const items = Array.isArray(body.items) ? body.items : selector ? [{ selector, html: body.html, css: body.css }] : [];
      const rules = Array.isArray(body.rules) ? body.rules : [];
      if (!/^\/[^\0\n]{1,500}$/.test(page) || page.split('/').includes('..')) return sendError(res, 400, 'Ungültige Seite');
      if (!items.length && !rules.length) return sendError(res, 400, 'Keine Änderungen übergeben');
      if (items.length > 50 || rules.length > 100) return sendError(res, 400, 'Zu viele Änderungen auf einmal');
      for (const it of items) {
        const sel = String(it?.selector || '').trim(), html = String(it?.html || '');
        if (!sel || sel.length > 500 || /[\0\n]/.test(sel)) return sendError(res, 400, 'Ungültiger Selektor');
        if (!html.trim() || html.length > 500000) return sendError(res, 400, 'HTML fehlt oder ist zu groß');
        if (it.css && String(it.css).length > 5000) return sendError(res, 400, 'CSS zu lang');
      }
      for (const r of rules) {
        if (!r || typeof r.selector !== 'string' || !r.selector.trim() || r.selector.length > 500 || typeof r.decls !== 'string' || r.decls.length > 5000) return sendError(res, 400, 'Ungültige CSS-Regel');
        if (r.media !== undefined && r.media !== null && (typeof r.media !== 'string' || r.media.length > 300)) return sendError(res, 400, 'Ungültige Media-Bedingung');
      }
      if (await busyCheck(res, slug, 'Das Übernehmen aus dem Inspektor')) return;
      const id = newJobId();
      const file = `jobs/assets/${id}-inspect.json`;
      const clean = {
        page,
        items: items.map((it) => ({ selector: String(it.selector).trim(), html: String(it.html), css: it.css ? String(it.css) : '' })),
        rules: rules.map((r) => ({ selector: r.selector.trim(), decls: r.decls, media: r.media || null })),
      };
      await fsp.writeFile(path.join(ROOT, file), JSON.stringify(clean));
      return send(res, 202, { job: await createJob('inspect-apply', slug, { file, page, elements: clean.items.length, rules: clean.rules.length }, id) });
    }
    if (action === 'areas/sync') {
      const body = await readBody(req);
      const page = String(body.page || '');
      if (!/^\/[^\0\n]{1,500}$/.test(page) || page.split('/').includes('..')) return sendError(res, 400, 'Ungültige Seite');
      let add = null;
      if (body.add !== undefined && body.add !== null) {
        const name = String(body.add.name || '').trim(), selector = String(body.add.selector || '').trim();
        if (!name || name.length > 60 || !selector || selector.length > 200 || /[<{};@\\\n]/.test(name + selector)) return sendError(res, 400, 'Ungültiger Bereich');
        add = { name, selector };
      }
      if (await busyCheck(res, slug, 'Das Angleichen der Bereiche')) return;
      return send(res, 202, { job: await createJob('areas-sync', slug, add ? { page, add } : { page }) });
    }
    if (action === 'pages') {
      const body = await readBody(req);
      const urls = [...new Set((Array.isArray(body.urls) ? body.urls : []).map((u) => String(u).trim()).filter(Boolean))];
      if (!urls.length) return sendError(res, 400, 'Mindestens eine URL angeben');
      if (urls.length > 100) return sendError(res, 400, 'Höchstens 100 Seiten auf einmal');
      const bad = urls.find((u) => !validHttpUrl(u));
      if (bad) return sendError(res, 400, `Ungültige URL: ${bad}`);
      if (await busyCheck(res, slug, 'Das Hinzufügen von Seiten')) return;
      return send(res, 202, { job: await createJob('pages-add', slug, { urls }) });
    }
    if (action === 'rollback') {
      const body = await readBody(req);
      const target = String(body.target || '');
      if (!/^(baseline|A-\d{3,}|[0-9a-f]{7,40})$/.test(target)) return sendError(res, 400, 'Ungültiger Zielstand');
      if (await busyCheck(res, slug, 'Ein Rücksprung')) return;
      return send(res, 202, { job: await createJob('rollback', slug, { target }) });
    }
    if (action === 'report') {
      if (await busyCheck(res, slug, 'Der Report')) return;
      return send(res, 202, { job: await createJob('report', slug, {}) });
    }
  }
  return sendError(res, 404, 'Unbekannte API-Route');
}

// Große Felder (HTML-Ausschnitt, Diff) nicht bei jeder Statusmeldung mitschicken
function slimJob(job) {
  const params = job.params ? { ...job.params } : job.params;
  if (params?.html) params.html = params.html.slice(0, 500);
  return { ...job, params };
}

// ---------- Server-Sent Events ----------

const sse = {
  clients: new Set(),
  add(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    this.clients.add(res);
    req.on('close', () => this.clients.delete(res));
  },
  emit(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of this.clients) c.write(msg);
  },
};
setInterval(() => { for (const c of sse.clients) c.write(': ping\n\n'); }, 20000).unref();

// Beobachtet jobs/ und state/sites.json per Polling (robust über Container-Mounts hinweg)
const seen = new Map();
let sitesMtime = 0;
async function scanJobs(initial = false) {
  const current = new Map();
  for (const status of STATUSES) {
    let entries = [];
    try { entries = await fsp.readdir(path.join(JOBS_DIR, status)); } catch { continue; }
    for (const f of entries) {
      if (!f.endsWith('.json')) continue;
      const file = path.join(JOBS_DIR, status, f);
      let st;
      try { st = await fsp.stat(file); } catch { continue; }
      const key = `${status}:${st.mtimeMs}`;
      const id = f.slice(0, -5);
      current.set(id, key);
      if (initial || seen.get(id) === key) continue;
      const job = await readJson(file);
      if (!job) continue;
      job.status = status;
      sse.emit('job', slimJob(job));
      const prevStatus = seen.get(id)?.split(':')[0];
      if (status === 'done' && prevStatus !== 'done' && ['annotate', 'rollback', 'decision', 'site-recrawl', 'draft-apply'].includes(job.type)) {
        sse.emit('reload', { slug: job.slug, job: job.id });
      }
    }
  }
  seen.clear();
  for (const [k, v] of current) seen.set(k, v);
  try {
    const st = await fsp.stat(path.join(STATE_DIR, 'sites.json'));
    if (st.mtimeMs !== sitesMtime) {
      const changed = sitesMtime !== 0;
      sitesMtime = st.mtimeMs;
      if (changed && !initial) sse.emit('sites', await readJson(path.join(STATE_DIR, 'sites.json'), { sites: [] }));
    }
  } catch { /* noch keine Liste */ }
}
let scanning = false;
setInterval(async () => {
  if (scanning) return;
  scanning = true;
  try { await scanJobs(); } finally { scanning = false; }
}, 700).unref();

// ---------- Router ----------

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { return sendError(res, 400, 'Ungültige URL'); }
  const p = url.pathname;
  try {
    if (p.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(res, 405, 'Methode nicht erlaubt');

    if (p === '/' || p === '/index.html') {
      const sites = await readJson(path.join(STATE_DIR, 'sites.json'), { sites: [] });
      const html = renderStartPage({ sites: sites.sites || [], token: TOKEN });
      return send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': APP_CSP, 'X-Frame-Options': 'DENY' });
    }
    if (p === '/__modio/overlay.js') {
      const js = await fsp.readFile(OVERLAY_FILE);
      return send(res, 200, js, { 'Content-Type': 'text/javascript; charset=utf-8' });
    }
    let m;
    if ((m = p.match(/^\/report\/([^/]+)$/))) {
      if (!validSlug(m[1])) return sendError(res, 400, 'Ungültiger Slug');
      const md = await fsp.readFile(path.join(siteDir(m[1]), 'CHANGES.md')).catch(() => null);
      if (!md) return sendError(res, 404, 'Noch kein Report vorhanden');
      return send(res, 200, md, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    }
    if ((m = p.match(/^\/s\/([^/]+)(\/.*)?$/))) {
      if (!validSlug(m[1])) return sendError(res, 400, 'Ungültiger Slug');
      if (m[2] === undefined) { res.writeHead(302, { Location: `/s/${m[1]}/` }); return res.end(); }
      return await serveSite(req, res, m[1], m[2], url.search);
    }
    if (p === '/favicon.svg') {
      const svg = await fsp.readFile(FAVICON_SVG);
      return send(res, 200, svg, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
    }
    if (p === '/favicon.ico') {
      const ico = await fsp.readFile(FAVICON_ICO);
      return send(res, 200, ico, { 'Content-Type': 'image/x-icon', 'Cache-Control': 'public, max-age=86400' });
    }
    return sendError(res, 404, 'Nicht gefunden');
  } catch (e) {
    if (!res.headersSent) sendError(res, e.status || 500, e.status ? e.message : 'Interner Fehler');
    if (!e.status) console.error(e);
  }
});

await scanJobs(true);
server.listen(PORT, '0.0.0.0', () => console.log(`Modio Bridge-Server auf 0.0.0.0:${PORT}`));
