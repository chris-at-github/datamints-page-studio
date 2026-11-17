// Server-Test für „Seite importieren“ bei neuen Projekten und „Seite löschen“ (ohne Worker: Jobs werden nur angelegt).
// Aufruf: node tests/page-import-server-test.mjs <base-url> <projekt-mit-seiten> <projekt-ohne-seiten> <abzug-slug> <token>
import fs from 'node:fs';
import path from 'node:path';

const [BASE, NEU, LEER, ABZUG, TOKEN] = process.argv.slice(2);
const JOBS = process.env.TEST_JOBS_DIR;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (!cond) { fail++; console.error(`  ✗ ${name} ${extra}`); }
};
const auth = { 'X-Modio-Token': TOKEN, 'Content-Type': 'application/json' };
const post = (slug, body) => fetch(`${BASE}/api/sites/${slug}/pages/import`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
const html = '<!doctype html><html><head><title>Über uns</title></head><body><h1>Über uns</h1></body></html>';

// Projekt ohne Seiten: Platzhalter mit Overlay statt 404
let r = await fetch(`${BASE}/s/${LEER}/`, { redirect: 'manual' });
let text = await r.text();
check('Platzhalter ohne Seiten', r.status === 200 && text.includes('data-modio-empty') && text.includes('"empty":true') && text.includes('/__modio/overlay.js'), r.status);
r = await fetch(`${BASE}/api/sites/${LEER}/pages`, { headers: auth });
let d = await r.json();
check('Seitenliste leer, kind neu, Ordner seiten (veralteter entry übergangen)', d.kind === 'neu' && d.pages.length === 0 && d.entry === null && d.importDir === 'seiten', JSON.stringify(d));

// Projekt mit Seiten: Weiterleitung auf die Startseite, Liste mit Pfad als Adresse
r = await fetch(`${BASE}/s/${NEU}/`, { redirect: 'manual' });
check('Weiterleitung auf startseite.html', r.status === 302 && r.headers.get('location') === `/s/${NEU}/seiten/startseite.html`, r.headers.get('location'));
r = await fetch(`${BASE}/api/sites/${NEU}/pages`, { headers: auth });
d = await r.json();
check('Seitenliste mit Startseite', d.entry === '/seiten/startseite.html' && d.pages[0]?.path === '/seiten/startseite.html' && d.pages[0]?.url === '/seiten/startseite.html', JSON.stringify(d));

// Import-Endpunkt
r = await post(NEU, { name: 'Ungültig Name', html });
check('Ungültiger Seitenname abgewiesen', r.status === 400);
r = await post(NEU, { name: 'ueber-uns', html: 'kein html' });
check('Datei ohne HTML abgewiesen', r.status === 400);
r = await post(ABZUG, { name: 'ueber-uns', html });
check('Bei Abzügen abgewiesen', r.status === 400);
r = await post(NEU, { name: 'startseite', html });
d = await r.json();
check('Vorhandene Seite: 409 mit exists', r.status === 409 && d.exists === true && d.page === '/seiten/startseite.html', JSON.stringify(d));

r = await post(NEU, { name: 'ueber-uns', html });
d = await r.json();
const job = d.job;
check('Import legt Job page-import an', r.status === 202 && job?.type === 'page-import' && job.params.page === '/seiten/ueber-uns.html' && job.params.replace === false, JSON.stringify(d));
if (job) {
  const file = path.join(JOBS, 'assets', `${job.id}-page.html`);
  check('HTML-Datei für den Worker abgelegt', fs.existsSync(file) && fs.readFileSync(file, 'utf8') === html);
  r = await post(NEU, { name: 'kontakt', html });
  check('Zweiter Import während eines offenen Jobs abgewiesen', r.status === 409);
  // aufräumen
  fs.rmSync(file, { force: true });
  for (const dir of ['pending', 'running']) fs.rmSync(path.join(JOBS, dir, `${job.id}.json`), { force: true });
}
r = await post(NEU, { name: 'startseite', html, replace: true });
d = await r.json();
check('Ersetzen mit replace: true', r.status === 202 && d.job?.params.replace === true, JSON.stringify(d));
if (d.job) {
  fs.rmSync(path.join(JOBS, 'assets', `${d.job.id}-page.html`), { force: true });
  fs.rmSync(path.join(JOBS, 'pending', `${d.job.id}.json`), { force: true });
}

// Seite löschen
const del = (slug, page) => fetch(`${BASE}/api/sites/${slug}/pages/delete`, { method: 'POST', headers: auth, body: JSON.stringify({ page }) });
r = await del(NEU, '/seiten/gibt-es-nicht.html');
check('Löschen: unbekannte Seite 404', r.status === 404);
r = await del(NEU, '/../site.json');
check('Löschen: ungültiger Pfad 404', r.status === 404);
const abzugEntry = (await (await fetch(`${BASE}/api/sites/${ABZUG}/pages`, { headers: auth })).json()).entry;
r = await del(ABZUG, abzugEntry);
check('Löschen: Startseite eines Abzugs 400', r.status === 400, String(r.status));
r = await del(NEU, '/seiten/startseite.html');
d = await r.json();
check('Löschen legt Job page-delete an', r.status === 202 && d.job?.type === 'page-delete' && d.job.params.page === '/seiten/startseite.html', JSON.stringify(d));
if (d.job) fs.rmSync(path.join(JOBS, 'pending', `${d.job.id}.json`), { force: true });

process.exit(fail ? 1 : 0);
