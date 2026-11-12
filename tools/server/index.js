// Modio Bridge-Server: Startseite, Auslieferung der Abzüge mit Overlay, API, Job-Dateien, SSE.
// Start: node --env-file=.env tools/server/index.js
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import busboy from 'busboy';
import { renderStartPage } from './startpage.js';

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

function injectHtml(buf, slug) {
  const cfg = JSON.stringify({ slug, token: TOKEN, base: `/s/${slug}`, imageMaxCount: IMAGE_MAX_COUNT, imageMaxMb: IMAGE_MAX_MB })
    .replace(/</g, '\\u003c');
  const head = `<link rel="stylesheet" href="/s/${slug}/__overrides.css" data-modio="overrides">`;
  const body = `<script data-modio="config">window.__MODIO__=${cfg}</script><script src="/__modio/overlay.js" defer data-modio="overlay"></script>`;
  let html = buf.toString('latin1'); // byte-treu, Injektion ist reines ASCII
  const hi = html.search(/<\/head\s*>/i);
  html = hi >= 0 ? html.slice(0, hi) + head + html.slice(hi) : head + html;
  const bodyMatches = [...html.matchAll(/<\/body\s*>/gi)];
  const bi = bodyMatches.length ? bodyMatches.at(-1).index : -1;
  html = bi >= 0 ? html.slice(0, bi) + body + html.slice(bi) : html + body;
  return Buffer.from(html, 'latin1');
}

async function serveSite(req, res, slug, rest, search) {
  const dir = siteDir(slug);
  if (!siteExists(slug)) return sendError(res, 404, 'Website nicht gefunden');

  if (rest === '' || rest === '/') {
    const site = await readJson(path.join(dir, 'site.json'), {});
    if (!site.entry) return sendError(res, 404, 'Kein Einstiegspfad');
    res.writeHead(302, { Location: `/s/${slug}${site.entry.split('/').map(encodeURIComponent).join('/')}`, 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (rest === '/__overrides.css') {
    const css = await fsp.readFile(path.join(dir, 'overrides.css')).catch(() => Buffer.alloc(0));
    return send(res, 200, css, { 'Content-Type': 'text/css; charset=utf-8' });
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
    if (type === 'text/html') buf = injectHtml(buf, slug);
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

function validateAnnotation(a, uploadCount) {
  if (!a || typeof a !== 'object') return 'Annotation fehlt';
  if (typeof a.prompt !== 'string' || !a.prompt.trim()) return 'Prompt fehlt';
  if (a.prompt.length > 10000) return 'Prompt zu lang';
  if (typeof a.page !== 'string' || !a.page.startsWith('/') || a.page.includes('..')) return 'Ungültige Seite';
  if (typeof a.selector !== 'string' || !a.selector || a.selector.length > 2000) return 'Ungültiger Selektor';
  const refs = Array.isArray(a.references) ? a.references : [];
  if (refs.some((r) => r?.type !== 'url' || !validHttpUrl(r.url))) return 'Bild-URLs müssen http- oder https-Adressen sein';
  if (refs.length + uploadCount > IMAGE_MAX_COUNT) return `Höchstens ${IMAGE_MAX_COUNT} Referenzbilder`;
  return null;
}

async function handleApi(req, res, url) {
  const authError = checkAuth(req, url);
  if (authError) return sendError(res, 403, authError);
  const p = url.pathname;
  let m;

  if (p === '/api/events' && req.method === 'GET') return sse.add(req, res);

  if (p === '/api/sites' && req.method === 'GET') return send(res, 200, await readJson(path.join(STATE_DIR, 'sites.json'), { sites: [] }));

  if (p === '/api/sites' && req.method === 'POST') {
    const body = await readBody(req);
    if (!validHttpUrl(body.url)) return sendError(res, 400, 'Bitte eine gültige http- oder https-URL angeben');
    const slug = body.slug ? String(body.slug).trim() : slugFromUrl(body.url);
    if (!validSlug(slug)) return sendError(res, 400, 'Ungültiger Kurzname (a-z, 0-9, Bindestrich)');
    if (siteExists(slug)) return sendError(res, 409, `Website ${slug} existiert bereits`);
    const pending = await listJobs((j) => j.type === 'site-new' && j.slug === slug);
    if (pending.some((j) => ACTIVE.includes(j.status))) return sendError(res, 409, `Website ${slug} wird bereits angelegt`);
    const urls = (Array.isArray(body.urls) ? body.urls : []).map((u) => String(u).trim()).filter(Boolean);
    if (urls.length > 500) return sendError(res, 400, 'Höchstens 500 Seiten');
    const bad = urls.find((u) => !validHttpUrl(u));
    if (bad) return sendError(res, 400, `Ungültige URL in der Seitenliste: ${bad}`);
    return send(res, 202, { job: await createJob('site-new', slug, { url: body.url, slug, urls }) });
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

  if (p === '/api/jobs' && req.method === 'GET') {
    const slug = url.searchParams.get('slug');
    if (slug && !validSlug(slug)) return sendError(res, 400, 'Ungültiger Slug');
    const jobs = await listJobs((j) => !slug || j.slug === slug);
    const active = jobs.filter((j) => ACTIVE.includes(j.status));
    const finished = jobs.filter((j) => !ACTIVE.includes(j.status)).slice(-20);
    return send(res, 200, { jobs: [...finished, ...active].map(slimJob) });
  }

  if ((m = p.match(/^\/api\/sites\/([^/]+)\/(recrawl|annotations|rollback|history|report)$/))) {
    const [, slug, action] = m;
    if (!validSlug(slug)) return sendError(res, 400, 'Ungültiger Slug');
    if (!siteExists(slug)) return sendError(res, 404, 'Website nicht gefunden');

    if (action === 'history' && req.method === 'GET') {
      return send(res, 200, await readJson(path.join(siteDir(slug), '.history.json'), { slug, head: null, baseline: null, steps: [] }));
    }
    if (req.method !== 'POST') return sendError(res, 405, 'Methode nicht erlaubt');

    if (action === 'annotations') {
      if (await busyCheck(res, slug, 'Eine neue Annotation')) return req.resume();
      const id = newJobId();
      const { annotation, files } = await parseAnnotationUpload(req, id);
      const err = validateAnnotation(annotation, files.length);
      if (err) {
        await Promise.all(files.map((f) => fsp.rm(path.join(ROOT, f), { force: true })));
        return sendError(res, 400, err);
      }
      const params = {
        site: slug,
        page: annotation.page,
        selector: annotation.selector,
        html: String(annotation.html || '').slice(0, 50000),
        text: String(annotation.text || '').slice(0, 5000),
        viewport: annotation.viewport && { width: Number(annotation.viewport.width) || null, height: Number(annotation.viewport.height) || null },
        prompt: annotation.prompt.trim(),
        thorough: annotation.thorough === true,
        references: [...files.map((file) => ({ type: 'upload', file })), ...(annotation.references || []).map((r) => ({ type: 'url', url: r.url }))],
      };
      return send(res, 202, { job: await createJob('annotate', slug, params, id) });
    }
    if (action === 'recrawl') {
      if (await busyCheck(res, slug, 'Neu einlesen')) return;
      return send(res, 202, { job: await createJob('site-recrawl', slug, {}) });
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
      if (status === 'done' && prevStatus !== 'done' && ['annotate', 'rollback', 'decision', 'site-recrawl'].includes(job.type)) {
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
