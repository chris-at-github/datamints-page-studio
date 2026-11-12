// Phase-2/3-Test gegen einen laufenden Bridge-Server.
// Aufruf: node --env-file=.env tests/api-test.mjs [base-url] [slug]
// Mit MODIO_TEST_ANNOTATE=1 wird zusätzlich eine echte Annotation (Claude Code) angelegt und abgewartet.
const BASE = process.argv[2] || `http://localhost:${process.env.BRIDGE_PORT || 3000}`;
const SLUG = process.argv[3] || 'testfirma';
const TOKEN = process.env.MODIO_API_TOKEN;
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name} ${extra}`); }
};
const auth = { 'X-Modio-Token': TOKEN };

console.log(`Server ${BASE}, Website ${SLUG}`);
let r = await fetch(`${BASE}/`);
check('Startseite erreichbar', r.ok && (await r.text()).includes(SLUG));

r = await fetch(`${BASE}/s/${SLUG}/`, { redirect: 'manual' });
const loc = r.headers.get('location');
check('Weiterleitung auf Einstiegspfad', r.status === 302 && loc?.startsWith(`/s/${SLUG}/`), loc);

r = await fetch(BASE + loc);
const html = await r.text();
check('Abzug ausgeliefert', r.ok);
check('overrides.css eingebunden', html.includes(`/s/${SLUG}/__overrides.css`));
check('Overlay-Script eingebunden', html.includes('/__modio/overlay.js'));
check('Overlay-Konfiguration vor </body>', /window\.__MODIO__=[\s\S]*<\/body>/i.test(html));
check('CSP gesetzt', (r.headers.get('content-security-policy') || '').includes("connect-src 'self'"));

r = await fetch(`${BASE}/s/${SLUG}/__overrides.css`);
check('overrides.css lieferbar', r.ok && r.headers.get('content-type').startsWith('text/css'));
r = await fetch(`${BASE}/__modio/overlay.js`);
check('overlay.js lieferbar', r.ok && (await r.text()).length > 1000);
r = await fetch(`${BASE}/s/${SLUG}/%2e%2e/%2e%2e/.env`);
check('Pfad außerhalb des Abzugs abgewiesen', r.status === 403 || r.status === 404, r.status);

r = await fetch(`${BASE}/api/sites/${SLUG}/history`);
check('API ohne Token abgewiesen', r.status === 403);
r = await fetch(`${BASE}/api/sites/${SLUG}/history`, { headers: { 'X-Modio-Token': 'falsch' } });
check('API mit falschem Token abgewiesen', r.status === 403);
r = await fetch(`${BASE}/api/sites/${SLUG}/history`, { headers: { ...auth, Origin: 'https://fremd.example' } });
check('Fremde Origin abgewiesen', r.status === 403);
r = await fetch(`${BASE}/api/sites/${SLUG}/history`, { headers: auth });
check('History mit Token', r.ok && Array.isArray((await r.json()).steps));
r = await fetch(`${BASE}/api/jobs?slug=${SLUG}`, { headers: auth });
check('Jobliste mit Token', r.ok && Array.isArray((await r.json()).jobs));

// Validierung
const form = (ann, files = []) => {
  const fd = new FormData();
  fd.append('annotation', JSON.stringify(ann));
  for (const f of files) fd.append('images', f.blob, f.name);
  return fd;
};
r = await fetch(`${BASE}/api/sites/${SLUG}/annotations`, { method: 'POST', headers: auth, body: form({ page: '/x.html', selector: 'h1', prompt: '' }) });
check('Annotation ohne Prompt abgewiesen', r.status === 400);
r = await fetch(`${BASE}/api/sites/${SLUG}/annotations`, {
  method: 'POST', headers: auth,
  body: form({ page: '/x.html', selector: 'h1', prompt: 'x' }, [{ blob: new Blob(['<svg/>'], { type: 'image/svg+xml' }), name: 'a.svg' }]),
});
check('SVG-Upload abgewiesen', r.status === 400);
r = await fetch(`${BASE}/api/sites/${SLUG}/annotations`, { method: 'POST', headers: auth, body: form({ page: '/x.html', selector: 'h1', prompt: 'x', references: [{ type: 'url', url: 'file:///etc/passwd' }] }) });
check('Nicht-HTTP-Bild-URL abgewiesen', r.status === 400);

if (process.env.MODIO_TEST_ANNOTATE === '1') {
  const sharp = (await import('sharp')).default;
  const png = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#1f6feb' } }).png().toBuffer();
  const page = decodeURIComponent(loc.slice(`/s/${SLUG}`.length));
  r = await fetch(`${BASE}/api/sites/${SLUG}/annotations`, {
    method: 'POST', headers: auth,
    body: form(
      {
        page, selector: 'main > section.hero > h1.hero__title',
        html: '<h1 class="hero__title">Willkommen bei Testfirma</h1>', text: 'Willkommen bei Testfirma',
        viewport: { width: 1440, height: 900 },
        prompt: 'Hintergrundfarbe der Hero-Sektion wie im Referenzbild (kräftiges Blau), Headline in Weiß.',
        thorough: false,
      },
      [{ blob: new Blob([png], { type: 'image/png' }), name: 'ref.png' }],
    ),
  });
  const { job } = await r.json();
  check('Annotation angenommen (202)', r.status === 202 && job?.id, r.status);
  r = await fetch(`${BASE}/api/sites/${SLUG}/annotations`, { method: 'POST', headers: auth, body: form({ page, selector: 'h1', prompt: 'zweiter' }) });
  check('Zweite Annotation während Lauf abgewiesen (409)', r.status === 409, r.status);
  console.log('  … warte auf Worker und Claude Code');
  const t0 = Date.now();
  let final;
  while (Date.now() - t0 < 15 * 60 * 1000) {
    await new Promise((res) => setTimeout(res, 3000));
    const { jobs } = await (await fetch(`${BASE}/api/jobs?slug=${SLUG}`, { headers: auth })).json();
    final = jobs.find((j) => j.id === job.id);
    if (['done', 'failed', 'review'].includes(final?.status)) break;
  }
  check('Annotation abgeschlossen', final?.status === 'done', `${final?.status} ${final?.error || ''}`);
  check('Snapshot erstellt', final?.result?.status === 'committed', JSON.stringify(final?.result)?.slice(0, 300));
  if (final?.result?.summary) console.log('\n  Zusammenfassung:\n  ' + final.result.summary.replace(/\n/g, '\n  ') + '\n');
}

console.log(`\nErgebnis: ${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
