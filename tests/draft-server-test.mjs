// Prüft Vorschau, CSS-Ebenen und Entwurfs-API gegen einen laufenden Bridge-Server (von tests/run.sh gestartet).
// Aufruf: node tests/draft-server-test.mjs <base-url> <slug> <entry> <token> before|after
const [BASE, SLUG, ENTRY, TOKEN, MODE] = process.argv.slice(2);
const auth = { 'X-Modio-Token': TOKEN };
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name} ${extra}`); }
};
const page = `${BASE}/s/${SLUG}${ENTRY.split('/').map(encodeURIComponent).join('/')}`;

if (MODE === 'before') {
  let html = await (await fetch(page)).text();
  check('Server: ohne Komponenten keine CSS-Ebenen', !html.includes('layer(legacy)') && html.includes('data-modio="overrides"'));

  const r = await fetch(`${page}?__modio_draft=D-001&__modio_v=1`);
  html = await r.text();
  check('Vorschau ausgeliefert', r.ok, r.status);
  check('Vorschau: Element durch Komponente ersetzt', html.includes('<section class="mx-hero">') && !html.includes('hero__title'));
  check('Vorschau: Alt-CSS, tokens.css und overrides.css in @layer legacy', /@import url\("[^"]*style\.css"\) layer\(legacy\)/.test(html) && html.includes('__overrides.css") layer(legacy)'));
  check('Vorschau: Entwurfs-CSS und Komponenten ohne Ebene', html.includes(`__draft.css?d=D-001&amp;v=1`) && html.includes('__components.css?exclude=hero'));
  check('Vorschau: Overlay kennt den Entwurf', html.includes('"preview":{"draft":"D-001","version":1}'));

  const css = await (await fetch(`${BASE}/s/${SLUG}/__draft.css?d=D-001&v=1`)).text();
  check('Entwurfs-CSS lieferbar', css.includes('@scope (.mx-hero)'));

  const list = await (await fetch(`${BASE}/api/sites/${SLUG}/drafts`, { headers: auth })).json();
  const d = list.drafts?.find((x) => x.id === 'D-001');
  check('API: Entwurfsliste mit Version und Bausteinen', d?.status === 'open' && d.versions[0]?.name === 'hero' && d.versions[0].bausteine[0]?.source === 'bestand', JSON.stringify(list).slice(0, 300));

  const wrong = await fetch(`${BASE}/s/${SLUG}/__draft.css?d=D-999&v=1`);
  check('Unbekannter Entwurf: 404', wrong.status === 404, wrong.status);
  const noauth = await fetch(`${BASE}/api/sites/${SLUG}/drafts`);
  check('API ohne Token abgewiesen', noauth.status === 403);
  const bad = await fetch(`${BASE}/api/sites/${SLUG}/drafts/D-001/versions`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{"prompt":""}' });
  check('Neue Version ohne Prompt abgewiesen', bad.status === 400, bad.status);
} else {
  const html = await (await fetch(page)).text();
  check('Server: mit Komponente liegt Alt-CSS in @layer legacy', html.includes('layer(legacy)') && html.includes('data-modio="components"') && !html.includes('__draft.css'));
  const css = await (await fetch(`${BASE}/s/${SLUG}/__components.css`)).text();
  check('__components.css enthält die Komponente', css.includes('@scope (.mx-hero)'));
  const list = await (await fetch(`${BASE}/api/sites/${SLUG}/drafts`, { headers: auth })).json();
  check('API: Entwurf als übernommen gemeldet', list.drafts?.find((x) => x.id === 'D-001')?.status === 'applied' && list.components.includes('mx-hero'));
  const ap = await fetch(`${BASE}/api/sites/${SLUG}/drafts/D-001/apply`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{}' });
  check('Übernommener Entwurf: apply abgewiesen (409)', ap.status === 409, ap.status);
}
process.exit(fail ? 1 : 0);
