// Prüft Vorschau, CSS-Ebenen und Entwurfs-API gegen einen laufenden Bridge-Server (von tests/run.sh gestartet).
// Aufruf: node tests/draft-server-test.mjs <base-url> <slug> <entry> <token> before|after
const [BASE, SLUG, ENTRY, TOKEN, MODE] = process.argv.slice(2);
const auth = { 'X-DPS-Token': TOKEN };
// Eigener Job-Ordner des Test-Servers (nicht jobs/, sonst greift ein laufender Worker die Test-Jobs auf)
const JOBS = process.env.TEST_JOBS_DIR || 'jobs';
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name} ${extra}`); }
};
const page = `${BASE}/s/${SLUG}${ENTRY.split('/').map(encodeURIComponent).join('/')}`;

if (MODE === 'before') {
  let html = await (await fetch(page)).text();
  check('Server: ohne Komponenten keine CSS-Ebenen', !html.includes('layer(legacy)') && html.includes('data-dps="overrides"'));

  const r = await fetch(`${page}?__dps_draft=D-001&__dps_v=1`);
  html = await r.text();
  check('Vorschau ausgeliefert', r.ok, r.status);
  check('Vorschau: Element durch Komponente ersetzt', html.includes('<section class="mx-hero">') && !html.includes('hero__title'));
  check('Vorschau: Alt-CSS, tokens.css und overrides.css in @layer legacy', /@import url\("[^"]*style\.css"\) layer\(legacy\)/.test(html) && html.includes('__overrides.css") layer(legacy)'));
  check('Vorschau: Entwurfs-CSS und Komponenten ohne Ebene', html.includes(`__draft.css?d=D-001&amp;v=1`) && html.includes('__components.css?exclude=hero'));
  check('Vorschau: Overlay kennt den Entwurf', html.includes('"preview":{"draft":"D-001","version":1,"name":"hero"}'));

  const css = await (await fetch(`${BASE}/s/${SLUG}/__draft.css?d=D-001&v=1`)).text();
  check('Entwurfs-CSS lieferbar', css.includes('@scope (.mx-hero)'));

  const list = await (await fetch(`${BASE}/api/sites/${SLUG}/drafts`, { headers: auth })).json();
  const d = list.drafts?.find((x) => x.id === 'D-001');
  check('API: Entwurfsliste mit Version und Bausteinen', d?.status === 'open' && d.versions[0]?.name === 'hero' && d.versions[0].bausteine[0]?.klassen?.bestand === 'btn' && d.versions[0].befund.length === 2 && d.versions[0].befund[1].umgesetzt === false, JSON.stringify(list).slice(0, 300));

  const vm = await (await fetch(`${BASE}/api/sites/${SLUG}/drafts/D-001/versions/2`, { headers: auth })).json();
  check('API: Markup einer Version für das Live-Umschalten', vm.html?.includes('Version zwei') && vm.name === 'hero', JSON.stringify(vm).slice(0, 200));
  const wrong = await fetch(`${BASE}/s/${SLUG}/__draft.css?d=D-999&v=1`);
  check('Unbekannter Entwurf: 404', wrong.status === 404, wrong.status);
  const noauth = await fetch(`${BASE}/api/sites/${SLUG}/drafts`);
  check('API ohne Token abgewiesen', noauth.status === 403);
  const bad = await fetch(`${BASE}/api/sites/${SLUG}/drafts/D-001/versions`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{"prompt":""}' });
  check('Neue Version ohne Prompt abgewiesen', bad.status === 400, bad.status);

  // Briefing für claude.ai (von tests/run.sh mit draft-brief.sh erzeugt)
  const br = await fetch(`${BASE}/api/sites/${SLUG}/drafts/D-001/brief`, { headers: auth });
  const bj = br.ok ? await br.json() : {};
  check('API: Briefing mit Text und Dateien', br.ok && bj.text?.includes('## Auftrag') && bj.files?.some((f) => f.file === 'D-001-element.html' && f.size > 0), br.status);
  const dl = await fetch(`${BASE}/api/sites/${SLUG}/drafts/D-001/brief/D-001-element.html`, { headers: auth });
  check('API: Briefing-Datei als Download', dl.ok && /attachment/.test(dl.headers.get('content-disposition') || '') && dl.headers.get('x-content-type-options') === 'nosniff', dl.status);
  const dlx = await fetch(`${BASE}/api/sites/${SLUG}/drafts/D-001/brief/draft.json`, { headers: auth });
  check('API: nur Dateien aus dem Briefing', dlx.status === 404, dlx.status);
  const dln = await fetch(`${BASE}/api/sites/${SLUG}/drafts/D-001/brief/D-001-element.html`);
  check('API: Briefing ohne Token abgewiesen', dln.status === 403, dln.status);
  const ld = (await (await fetch(`${BASE}/api/sites/${SLUG}/drafts`, { headers: auth })).json()).drafts?.find((x) => x.id === 'D-001');
  check('API: Entwurf meldet vorhandenes Briefing', !!ld?.brief?.created);

  // Import als neue Version: Form prüfen, Job anlegen (ohne Worker), danach aufräumen
  const fs = await import('node:fs');
  const post = (body) => fetch(`${BASE}/api/sites/${SLUG}/drafts/D-001/import`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const ie = await post({ html: 'kein html' });
  check('Import ohne HTML abgewiesen', ie.status === 400, ie.status);
  const ib = await post({ html: '<p>' + 'x'.repeat(1600 * 1024) + '</p>' });
  check('Import über 1,5 MB abgewiesen', ib.status === 400 || ib.status === 413, ib.status);
  const io = await post({ html: '<section><h2>Import</h2></section>', prompt: 'Bitte übernehmen' });
  const ij = io.ok ? await io.json() : {};
  const jf = ij.job ? `${JOBS}/pending/${ij.job.id}.json` : '';
  const job = jf && fs.existsSync(jf) ? JSON.parse(fs.readFileSync(jf, 'utf8')) : null;
  check('Import legt Entwurfs-Job mit Import-Datei an', io.status === 202 && job?.type === 'draft' && job.params.draft === 'D-001' && /^jobs\/assets\/job-[0-9a-f-]+-import\.html$/.test(job.params.importFile) && fs.readFileSync(`${JOBS}/assets/${job.params.importFile.split('/').pop()}`, 'utf8').includes('<h2>Import</h2>'), io.status);
  if (job) { fs.rmSync(jf, { force: true }); fs.rmSync(job.params.importFile, { force: true }); }
} else {
  const html = await (await fetch(page)).text();
  check('Server: mit Komponente liegt Alt-CSS in @layer legacy', html.includes('layer(legacy)') && html.includes('data-dps="components"') && !html.includes('__draft.css'));
  const css = await (await fetch(`${BASE}/s/${SLUG}/__components.css`)).text();
  check('__components.css enthält die Komponente', css.includes('@scope (.mx-hero)'));
  const list = await (await fetch(`${BASE}/api/sites/${SLUG}/drafts`, { headers: auth })).json();
  check('API: Entwurf als übernommen gemeldet', list.drafts?.find((x) => x.id === 'D-001')?.status === 'applied' && list.components.includes('mx-hero'));
  const pr = await fetch(`${page}?__dps_draft=D-001&__dps_v=1`, { redirect: 'manual' });
  check('Vorschau eines übernommenen Entwurfs leitet zur Seite um', pr.status === 302 && !(pr.headers.get('location') || '').includes('__dps_draft'), `${pr.status} ${pr.headers.get('location')}`);
  const ap = await fetch(`${BASE}/api/sites/${SLUG}/drafts/D-001/apply`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{}' });
  check('Übernommener Entwurf: apply abgewiesen (409)', ap.status === 409, ap.status);
}
process.exit(fail ? 1 : 0);
