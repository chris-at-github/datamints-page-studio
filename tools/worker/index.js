// Modio Worker: arbeitet jobs/pending/ strikt nacheinander ab und ruft ausschließlich die Skripte auf.
// Start (in der WSL): node --env-file=.env tools/worker/index.js
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const JOBS_DIR = path.resolve(ROOT, process.env.JOBS_DIR || './jobs');
const SCRIPTS = path.join(ROOT, 'scripts');
const LOG_DIR = path.join(ROOT, 'logs');
const LOCK = path.join(JOBS_DIR, '.worker.lock');
const POLL_MS = 1000;
const STATUSES = ['pending', 'running', 'review', 'done', 'failed'];

for (const s of STATUSES.concat('assets')) fs.mkdirSync(path.join(JOBS_DIR, s), { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- Nur in der WSL, nicht im DDEV-Container ----------
if (process.env.IS_DDEV_PROJECT === 'true' || fs.existsSync('/.dockerenv')) {
  console.error('Der Worker muss in der WSL laufen, nicht im DDEV-Container (dort gibt es kein Claude Code).\n' +
    'Bitte außerhalb von "ddev ssh" im Projektordner starten: npm run worker');
  process.exit(1);
}

// ---------- Lock: nur ein Worker gleichzeitig ----------
// Inhalt "<host>:<pid>", damit ein Worker auf einem anderen Host (z. B. Container) erkannt wird
const LOCK_ID = `${os.hostname()}:${process.pid}`;
function acquireLock() {
  try {
    fs.writeFileSync(LOCK, LOCK_ID, { flag: 'wx' });
    return true;
  } catch {
    const content = fs.readFileSync(LOCK, 'utf8').trim();
    const [host, pidStr] = content.includes(':') ? content.split(':') : [os.hostname(), content];
    if (host !== os.hostname()) {
      console.error(`Lock gehört zu einem Worker auf Host "${host}" (z. B. im DDEV-Container). ` +
        `Diesen beenden und ${LOCK} löschen.`);
      return false;
    }
    try { process.kill(Number(pidStr), 0); return false; } catch { /* verwaist */ }
    fs.writeFileSync(LOCK, LOCK_ID);
    return true;
  }
}
if (!acquireLock()) {
  console.error(`Es läuft bereits ein Worker (Lock ${LOCK}).`);
  process.exit(1);
}
const releaseLock = () => { try { if (fs.readFileSync(LOCK, 'utf8') === LOCK_ID) fs.unlinkSync(LOCK); } catch { /* egal */ } };
let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopping = true; log('Beende nach aktuellem Job …'); if (!busy) { releaseLock(); process.exit(0); } });
process.on('exit', releaseLock);

// ---------- Job-Dateien ----------
const jobPath = (status, id) => path.join(JOBS_DIR, status, `${id}.json`);

async function writeJob(job, status) {
  job.status = status;
  job.updated = new Date().toISOString();
  const tmp = path.join(JOBS_DIR, `.${job.id}.${process.pid}.tmp`);
  await fsp.writeFile(tmp, JSON.stringify(job, null, 2));
  await fsp.rename(tmp, jobPath(status, job.id));
  for (const s of STATUSES) if (s !== status) await fsp.rm(jobPath(s, job.id), { force: true });
}

async function readJob(status, id) {
  return JSON.parse(await fsp.readFile(jobPath(status, id), 'utf8'));
}

// ---------- Skripte ausführen ----------
function runScript(name, args, logFile) {
  return new Promise((resolve) => {
    const out = fs.createWriteStream(logFile, { flags: 'a' });
    out.write(`\n$ scripts/${name} ${args.map((a) => JSON.stringify(a)).join(' ')}\n`);
    const child = spawn(path.join(SCRIPTS, name), args, { cwd: ROOT, env: process.env });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; out.write(d); });
    child.stderr.on('data', (d) => out.write(d));
    child.on('close', (code) => {
      out.end();
      const line = stdout.trim().split('\n').filter(Boolean).at(-1) || '';
      let result = null;
      try { result = JSON.parse(line); } catch { /* keine JSON-Ausgabe */ }
      resolve({ code, result });
    });
    child.on('error', (e) => { out.end(); resolve({ code: 1, result: { status: 'error', error: e.message } }); });
  });
}

// ---------- Job-Typen ----------
async function handle(job, logFile) {
  const slug = job.slug;
  switch (job.type) {
    case 'site-new': {
      const args = [job.params.url, job.params.slug || slug];
      if (job.params.urls?.length) {
        const f = path.join(JOBS_DIR, 'assets', `${job.id}-urls.txt`);
        await fsp.writeFile(f, job.params.urls.join('\n') + '\n');
        args.push(f);
      }
      return runScript('site-new.sh', args, logFile);
    }
    case 'site-recrawl':
      return runScript('site-recrawl.sh', [slug, job.params?.keepDesign === false ? '--no-keep-design' : '--keep-design'], logFile);
    case 'design-save': {
      const file = String(job.params?.file || '');
      if (!/^jobs\/assets\/job-\d{14}-[0-9a-f]{6}-design\.json$/.test(file)) return { code: 1, result: { status: 'error', error: 'Ungültige Datei' } };
      return runScript('design-save.sh', [slug, path.join(ROOT, file)], logFile);
    }
    case 'local-commit':
      return runScript('local-commit.sh', [slug], logFile);
    case 'inspect-apply': {
      const file = String(job.params?.file || '');
      if (!/^jobs\/assets\/job-\d{14}-[0-9a-f]{6}-inspect\.json$/.test(file)) return { code: 1, result: { status: 'error', error: 'Ungültige Datei' } };
      return runScript('inspect-apply.sh', [slug, path.join(ROOT, file)], logFile);
    }
    case 'areas-sync': {
      const args = [slug, String(job.params?.page || '')];
      if (job.params?.add) args.push('--add', String(job.params.add.name), String(job.params.add.selector));
      return runScript('areas-sync.sh', args, logFile);
    }
    case 'pages-add': {
      const urls = (job.params?.urls || []).map(String).filter((u) => /^https?:\/\/\S+$/.test(u));
      const f = path.join(JOBS_DIR, 'assets', `${job.id}-urls.txt`);
      await fsp.writeFile(f, urls.join('\n') + '\n');
      return runScript('pages-add.sh', [slug, f], logFile);
    }
    case 'page-delete': {
      const page = String(job.params?.page || '');
      if (!page.startsWith('/') || page.includes('..')) throw new Error('Ungültige Seite');
      return runScript('page-delete.sh', [slug, page], logFile);
    }
    case 'page-import': {
      const file = String(job.params?.file || '');
      if (!/^jobs\/assets\/job-\d{14}-[0-9a-f]{6}-page\.html$/.test(file)) return { code: 1, result: { status: 'error', error: 'Ungültige Datei' } };
      const args = [slug, String(job.params?.name || ''), path.join(JOBS_DIR, 'assets', path.basename(file))];
      if (job.params?.replace === true) args.push('--replace');
      return runScript('page-import.sh', args, logFile);
    }
    case 'tokens-propose':
      return runScript('tokens-propose.sh', [slug], logFile);
    case 'annotate':
      return runScript('run-annotation.sh', [slug, jobPath('running', job.id)], logFile);
    case 'draft':
      return runScript('draft-create.sh', [slug, jobPath('running', job.id)], logFile);
    case 'draft-apply': {
      const d = String(job.params?.draft || '');
      if (!/^D-\d{3,}$/.test(d)) return { code: 1, result: { status: 'error', error: 'Ungültiger Entwurf' } };
      const args = [slug, d];
      if (Number.isInteger(job.params?.version) && job.params.version > 0) args.push(String(job.params.version));
      return runScript('draft-apply.sh', args, logFile);
    }
    case 'project-new':
      return runScript('project-new.sh', [slug, String(job.params?.title || slug)], logFile);
    case 'project-package':
      return runScript('project-package.sh', [slug], logFile);
    case 'project-export':
      return runScript('project-export.sh', [slug], logFile);
    case 'draft-brief': {
      const d = String(job.params?.draft || '');
      if (!/^D-\d{3,}$/.test(d)) return { code: 1, result: { status: 'error', error: 'Ungültiger Entwurf' } };
      return runScript('draft-brief.sh', [slug, d], logFile);
    }
    case 'draft-discard': {
      const d = String(job.params?.draft || '');
      if (!/^D-\d{3,}$/.test(d)) return { code: 1, result: { status: 'error', error: 'Ungültiger Entwurf' } };
      return runScript('draft-discard.sh', [slug, d], logFile);
    }
    case 'rollback':
      return runScript('rollback.sh', [slug, job.params.target], logFile);
    case 'report':
      return runScript('report.sh', [slug], logFile);
    case 'decision': {
      const target = await readJob('review', job.params.jobId).catch(() => null);
      if (!target) return { code: 1, result: { status: 'error', error: 'Der zu prüfende Schritt wartet nicht mehr auf Prüfung' } };
      const id = target.result?.annotationId;
      const r = job.params.action === 'accept'
        ? await runScript('commit-step.sh', [slug, id, '--accept'], logFile)
        : await runScript('discard-step.sh', [slug], logFile);
      if (r.code === 0) {
        target.result = { ...target.result, decision: job.params.action, decisionResult: r.result, diff: undefined };
        if (job.params.action === 'accept') target.result.status = 'committed';
        else target.result.status = 'discarded';
        target.result.commit = r.result?.commit || null;
        await writeJob(target, 'done');
      }
      return r;
    }
    default:
      return { code: 1, result: { status: 'error', error: `Unbekannter Job-Typ: ${job.type}` } };
  }
}

// Status nachziehen: Verlauf und Websiteliste
async function refreshState(slug, logFile) {
  if (slug && fs.existsSync(path.join(ROOT, 'sites', slug, '.git'))) await runScript('history.sh', [slug], logFile);
  await runScript('site-list.sh', [], logFile);
}

async function processJob(id) {
  let job;
  try {
    await fsp.rename(jobPath('pending', id), jobPath('running', id)); // atomar: Job gehört diesem Worker
    job = await readJob('running', id);
  } catch (e) {
    log(`Job ${id} nicht lesbar: ${e.message}`);
    return;
  }
  const logFile = path.join(LOG_DIR, `${id}.log`);
  job.log = path.relative(ROOT, logFile);
  job.started = new Date().toISOString();
  await writeJob(job, 'running');
  log(`▶ ${id} ${job.type} ${job.slug}`);

  let r;
  try {
    r = await handle(job, logFile);
  } catch (e) {
    r = { code: 1, result: { status: 'error', error: e.message } };
  }
  job.finished = new Date().toISOString();
  job.result = r.result;
  job.exitCode = r.code;
  let status;
  if (r.code === 0) status = 'done';
  else if (r.code === 3 && ['annotate', 'local-commit', 'inspect-apply', 'draft-apply', 'page-import', 'page-delete'].includes(job.type)) status = 'review';
  else {
    status = 'failed';
    job.error = r.result?.error || `Skript endete mit Exit-Code ${r.code} (siehe ${job.log})`;
  }

  // Hochgeladene Bilder werden nach Übernahme nicht mehr gebraucht
  if ((job.type === 'annotate' || job.type === 'draft') && status !== 'review') {
    for (const ref of [...(job.params?.references || []), ...(job.params?.items || []).flatMap((it) => it.references || [])]) {
      if (ref.type === 'upload' && /^jobs\/assets\/[^/]+$/.test(ref.file)) await fsp.rm(path.join(ROOT, ref.file), { force: true });
    }
  }
  if (job.type === 'site-new' || job.type === 'pages-add') await fsp.rm(path.join(JOBS_DIR, 'assets', `${id}-urls.txt`), { force: true });
  if (job.type === 'design-save') await fsp.rm(path.join(JOBS_DIR, 'assets', `${id}-design.json`), { force: true });
  if (job.type === 'page-import') await fsp.rm(path.join(JOBS_DIR, 'assets', `${id}-page.html`), { force: true });
  if (job.type === 'inspect-apply') await fsp.rm(path.join(JOBS_DIR, 'assets', `${id}-inspect.json`), { force: true });

  await refreshState(job.slug, logFile).catch((e) => log(`Status-Aktualisierung fehlgeschlagen: ${e.message}`));
  await writeJob(job, status);
  log(`${status === 'done' ? '✔' : status === 'review' ? '⚠' : '✖'} ${id} ${status}${job.error ? ': ' + job.error : ''}`);
}

// Jobs, die bei einem Absturz in running/ hängen geblieben sind, als fehlgeschlagen markieren
async function recoverStale() {
  for (const f of await fsp.readdir(path.join(JOBS_DIR, 'running'))) {
    if (!f.endsWith('.json')) continue;
    const job = await readJob('running', f.slice(0, -5)).catch(() => null);
    if (!job) continue;
    job.error = 'Worker wurde während der Bearbeitung beendet. Nicht übernommene Änderungen ggf. per discard-step.sh verwerfen.';
    await writeJob(job, 'failed');
    log(`Verwaister Job ${job.id} als fehlgeschlagen markiert`);
  }
}

let busy = false;
async function tick() {
  if (busy || stopping) return;
  busy = true;
  try {
    while (!stopping) {
      const pending = (await fsp.readdir(path.join(JOBS_DIR, 'pending'))).filter((f) => f.endsWith('.json')).sort();
      if (!pending.length) break;
      await processJob(pending[0].slice(0, -5));
    }
  } catch (e) {
    log(`Fehler: ${e.stack || e.message}`);
  } finally {
    busy = false;
    if (stopping) { releaseLock(); process.exit(0); }
  }
}

await recoverStale();
await runScript('site-list.sh', [], path.join(LOG_DIR, 'worker.log'));
log(`Modio Worker gestartet, beobachte ${path.relative(ROOT, JOBS_DIR)}/pending`);
try {
  fs.watch(path.join(JOBS_DIR, 'pending'), () => tick());
} catch { /* Polling reicht */ }
setInterval(tick, POLL_MS);
tick();
