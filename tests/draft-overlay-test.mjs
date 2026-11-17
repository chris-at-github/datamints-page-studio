// Browser-Test (Playwright) für Entwürfe: Vorschau, CSS-Ebenen im Rendering, „Entwurf erstellen“ mit Bausteinen.
// Von tests/run.sh gestartet (Server läuft, Entwurf D-001 mit Komponente mx-hero liegt vor).
// Aufruf: node tests/draft-overlay-test.mjs <base-url> <slug> <entry>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

// Passt die installierte Browser-Version nicht zur Playwright-Version, den neuesten vorhandenen Headless-Chromium nehmen
function fallbackChromium() {
  const dir = path.join(os.homedir(), '.cache', 'ms-playwright');
  const cands = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((d) => /^chromium_headless_shell-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of cands) {
    const f = path.join(dir, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
    if (fs.existsSync(f)) return f;
  }
  return undefined;
}

const [BASE, SLUG, ENTRY] = process.argv.slice(2);
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name} ${extra}`); }
};
const pageUrl = `${BASE}/s/${SLUG}${ENTRY.split('/').map(encodeURIComponent).join('/')}`;
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined })
  .catch(() => chromium.launch({ executablePath: fallbackChromium() }));
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
  const ov = (sel) => page.locator(`#modio-overlay-host ${sel}`);

  // Vorschau
  await page.goto(`${pageUrl}?__modio_draft=D-001&__modio_v=1`);
  await page.waitForTimeout(800);
  check('Vorschau: Entwurfs-Panel öffnet sich, Status zeigt die Vorschau', await ov('#modio-drafts.open').isVisible() && (await ov('.bar .status').innerText()).includes('Vorschau D-001 · v1') && (await ov('.pvband').count()) === 0);
  const st = await page.evaluate(() => {
    const h = document.querySelector('.mx-hero h1');
    const cs = h && getComputedStyle(h);
    return h ? { color: cs.color, ls: cs.letterSpacing, pad: getComputedStyle(document.querySelector('.mx-hero')).paddingTop } : null;
  });
  check('Ebenen: Komponente schlägt spezifischere Alt-Regel (main section h1)', st && st.color === 'rgb(255, 255, 255)', JSON.stringify(st));
  check('Ebenen: nicht gesetzte Eigenschaften erbt die Komponente weiter (letter-spacing)', st && st.ls === '3px', JSON.stringify(st));
  check('Vorschau: Auswählen gesperrt', await ov('.bar button[aria-pressed]').first().isDisabled());
  // Live-Umschalten zwischen Versionen und „Aktuell“ ohne Neuladen
  await page.evaluate(() => { window.__noReload = 1; });
  await ov('#modio-drafts .vtabs button:has-text("v2")').click();
  await page.waitForTimeout(500);
  check('Live: v2 ohne Neuladen', await page.evaluate(() => window.__noReload === 1 && document.querySelector('.mx-hero h1').textContent === 'Version zwei' && location.search.includes('__modio_v=2')));
  await ov('#modio-drafts .vtabs button:has-text("Aktuell")').click();
  await page.waitForTimeout(500);
  check('Live: „Aktuell“ zeigt das bisherige Element', await page.evaluate(() => window.__noReload === 1 && !!document.querySelector('section.hero .hero__title') && !document.querySelector('.mx-hero') && document.querySelector('link[data-modio="draft"]').disabled));
  await page.keyboard.press('v');
  await page.waitForTimeout(500);
  check('Live: Taste V zurück zur zuletzt gezeigten Version', await page.evaluate(() => window.__noReload === 1 && document.querySelector('.mx-hero h1')?.textContent === 'Version zwei'));
  await ov('#modio-drafts .vtabs button:has-text("v1")').click();
  await page.waitForTimeout(500);
  await page.waitForTimeout(200);
  const panelText = await ov('#modio-drafts').textContent();
  check('Entwurfs-Panel öffnet D-001 mit Bausteinen und Befund', await ov('#modio-drafts.open').isVisible() && panelText.includes('Bausteine') && panelText.includes('P2 · Kontrast Orange') && panelText.includes('1 offen'));
  await ov('#modio-drafts textarea[data-fk="ta"]').fill('Etwas ruhiger bitte');
  await ov('#modio-drafts .sb-body').evaluate((n) => { n.scrollTop = 200; });
  const scBefore = await ov('#modio-drafts .sb-body').evaluate((n) => n.scrollTop);
  check('Befund zunächst zugeklappt', !(await ov('details.bfdet:has-text("Befund von Claude")').evaluate((n) => n.open)));
  await ov('details.bfdet:has-text("Befund von Claude") > summary').click();
  await ov('.bf-item:has-text("P2") button.bf-act').click();
  check('Befundpunkt vormerken zählt als Änderung', (await ov('#modio-drafts').textContent()).includes('Neue Version (1 Änderung(en) gewählt)') && (await ov('.bf-item:has-text("P2") button.bf-act').textContent()) === 'wird umgesetzt');
  check('Text im Feld „Nachbessern“ bleibt erhalten', (await ov('#modio-drafts textarea[data-fk="ta"]').inputValue()) === 'Etwas ruhiger bitte');
  check('Scrollposition bleibt erhalten', (await ov('#modio-drafts .sb-body').evaluate((n) => n.scrollTop)) === scBefore, String(scBefore));
  // Bausteine live
  await ov('.bst-row:has-text("Button") button:has-text("wie bisher")').click();
  check('Baustein live auf „wie bisher“', await page.evaluate(() => { const a = document.querySelector('[data-mx-baustein="button"]'); return a.classList.contains('btn') && !a.classList.contains('hero__cta'); }));
  await ov('.bst-row:has-text("Button") button:has-text("neu")').click();
  check('Baustein live zurück auf „neu“', await page.evaluate(() => document.querySelector('[data-mx-baustein="button"]').classList.contains('hero__cta')));
  // Hinweis zu einem Element
  await ov('button:has-text("Element im Entwurf wählen")').click();
  await page.locator('.mx-hero h1').click();
  await page.waitForTimeout(300);
  const noteText = await ov('ul.nlist').textContent().catch(() => '');
  check('Element im Entwurf gewählt (Hinweis mit Selektor)', noteText.includes('Willkommen'), noteText.slice(0, 120));
  await ov('textarea.ndesc').first().fill('Überschrift kleiner');
  check('Hinweis zählt als Änderung', (await ov('#modio-drafts').textContent()).includes('Neue Version (2 Änderung(en) gewählt)'));
  await ov('#modio-drafts button.phbtn').click();
  check('Platzhalter markieren', await page.evaluate(() => !!document.querySelector('style[data-modio="platzhalter"]') && document.querySelector('[data-mx-platzhalter]').title.includes('Merkliste')));

  // Älterer Server ohne preview.name: Live-Funktionen müssen trotzdem gehen (Name aus den Entwurfsdaten)
  await page.route('**/*__modio_draft=*', async (route) => {
    const r = await route.fetch();
    await route.fulfill({ response: r, body: (await r.text()).replace(',"name":"hero"', '') });
  });
  await page.goto(`${pageUrl}?__modio_draft=D-001&__modio_v=1`);
  await page.waitForTimeout(900);
  await page.unroute('**/*__modio_draft=*');
  await page.evaluate(() => { window.__noReload2 = 1; });
  await ov('#modio-drafts .vtabs button:has-text("v2")').click();
  await page.waitForTimeout(500);
  check('Live ohne preview.name (älterer Server)', await page.evaluate(() => window.__noReload2 === 1 && document.querySelector('.mx-hero h1')?.textContent === 'Version zwei'));
  await page.waitForTimeout(200);
  check('Ohne preview.name: Element wählen möglich', !(await ov('button:has-text("Element im Entwurf wählen")').isDisabled()));

  await ov('#modio-drafts button.exitbtn').click();
  await page.waitForTimeout(800);
  check('„Vorschau beenden“ führt zur normalen Seite', !page.url().includes('__modio_draft') && (await ov('#modio-drafts button.exitbtn').count()) === 0, page.url());

  // Normale Seite: Entwurf erstellen sendet Bausteine
  await page.goto(pageUrl);
  await page.waitForTimeout(800);
  let body = null;
  await page.route('**/api/sites/*/drafts', async (route) => {
    body = route.request().postData();
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ job: { id: 'job-20261113000000-abcdef', type: 'draft', slug: SLUG, status: 'pending' } }) });
  });
  await ov('.bar button[aria-pressed]').first().click();
  await page.locator('section.hero').click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(300);
  await ov('#modio-prompt').fill('Hero moderner gestalten');
  await ov('.pfoot button:has-text("Entwurf")').click();
  await page.waitForTimeout(600);
  const ann = body && JSON.parse((body.match(/name="annotation"\r\n\r\n([\s\S]*?)\r\n--/) || [])[1] || 'null');
  check('Entwurf erstellen: Annotation mit Prompt und Selektor gesendet', ann?.prompt === 'Hero moderner gestalten' && /hero/.test(ann.selector || ''), body?.slice(0, 200));
  check('Entwurf erstellen: Bausteine und Breite gemessen', Array.isArray(ann?.bausteine) && ann.bausteine.some((b) => b.kind === 'heading' && b.style?.['font-size']) && ann.rect?.width > 0, JSON.stringify(ann?.bausteine)?.slice(0, 200));

  // Annotationsdialog: Aufbau (Kopf mit X, Footer mit Split-Button, Kürzel-Hinweis), Direkt umsetzen über das Menü
  const annOf = () => body && JSON.parse((body.match(/name="annotation"\r\n\r\n([\s\S]*?)\r\n--/) || [])[1] || 'null');
  const selectHero = async () => {
    // neu laden: der simulierte Auftrag gilt sonst als laufend und sperrt weitere Entwürfe
    await page.goto(pageUrl);
    await page.waitForTimeout(800);
    await ov('.bar button[aria-pressed]').first().click();
    await page.locator('section.hero').click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(300);
  };
  await selectHero();
  const dlg = await page.evaluate(() => {
    const p = document.querySelector('#modio-overlay-host').shadowRoot.querySelector('.panel.prompt');
    const vis = [...p.querySelectorAll('.phead button, .tokrow button, .pfoot button')].filter((b) => b.offsetParent);
    return {
      text: p.textContent, urlField: !!p.querySelector('input[type="url"]'),
      heights: [...new Set(vis.map((b) => b.getBoundingClientRect().height))],
      wraps: vis.filter((b) => getComputedStyle(b).whiteSpace !== 'nowrap').length,
      foot: [...p.querySelectorAll('.pfoot button')].filter((b) => b.offsetParent).map((b) => b.textContent.trim() || b.title),
      keys: p.querySelector('.pkeys').textContent, menuHidden: p.querySelector('.qmenu').hidden,
    };
  });
  check('Dialog: ohne Bild-URL, Abbrechen und claude.ai', !dlg.urlField && !/Abbrechen|URL hinzufügen|claude\.ai|HTML importieren/.test(dlg.text), dlg.text.slice(0, 200));
  check('Dialog: Footer Entwurf und Split-Button In die Queue', dlg.foot.includes('Entwurf') && dlg.foot.includes('In die Queue') && dlg.menuHidden, JSON.stringify(dlg.foot));
  check('Dialog: Buttons mit gleicher Höhe, ohne Umbruch', dlg.heights.length === 1 && dlg.wraps === 0, JSON.stringify(dlg.heights));
  check('Dialog: Kürzel-Hinweis unter dem Footer', /Strg\+Enter In die Queue · Esc Schließen/.test(dlg.keys), dlg.keys);
  let direct = null;
  await page.route('**/api/sites/*/annotations', async (route) => {
    direct = route.request().postData();
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ job: { id: 'job-20261113000002-abcdef', type: 'annotate', slug: SLUG, status: 'pending' } }) });
  });
  await ov('#modio-prompt').fill('Abstand oben kleiner');
  await ov('.split button[aria-haspopup="menu"]').click();
  await page.waitForTimeout(200);
  const item = ov('.qmenu button[role="menuitem"]');
  check('Split-Button: Menü mit „Direkt umsetzen“ und Kürzel', await item.isVisible() && /Direkt umsetzen.*Strg\+Umschalt\+Enter/.test(await item.textContent()));
  await item.click();
  await page.waitForTimeout(600);
  check('Direkt umsetzen aus dem Menü sendet die Annotation', direct && direct.includes('Abstand oben kleiner') && !(await ov('.panel.prompt').isVisible()), String(direct).slice(0, 120));
  await page.unroute('**/api/sites/*/annotations');
  await selectHero();
  await ov('.phead button').click();
  await page.waitForTimeout(200);
  check('X schließt den Dialog', !(await ov('.panel.prompt').isVisible()));

  // Entwurfs-Panel: Briefing (von tests/run.sh erzeugt) kopieren/herunterladen und Import als neue Version
  await page.unroute('**/api/sites/*/drafts');
  await ov('.bar button[aria-controls="modio-drafts"]').click();
  await page.waitForTimeout(400);
  await ov('#modio-drafts button.ditem:has-text("D-001")').click();
  await page.waitForTimeout(800);
  await ov('#modio-drafts details.claude > summary').click();
  await page.waitForTimeout(300);
  check('Panel: Bereich „Gestaltung in claude.ai“ mit Briefing', (await ov('#modio-drafts details.claude').count()) === 1 && (await ov('#modio-drafts textarea.brieftext').inputValue()).includes('## Auftrag') && (await ov('#modio-drafts ul.brieffiles').textContent()).includes('D-001-element.html'));
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), ov('#modio-drafts ul.brieffiles button:has-text("D-001-element.html")').click()]);
  check('Panel: Briefing-Datei herunterladen', dl && dl.suggestedFilename() === 'D-001-element.html', String(dl && dl.suggestedFilename()));
  let impBody = null;
  await page.route('**/api/sites/*/drafts/D-001/import', async (route) => {
    impBody = route.request().postDataJSON();
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ job: { id: 'job-20261113000001-abcdef', type: 'draft', slug: SLUG, status: 'pending' } }) });
  });
  await ov('#modio-drafts input[data-fk="imp-note"]').fill('Abstände etwas größer');
  await ov('#modio-drafts details.claude input[type="file"]').setInputFiles({ name: 'v3.html', mimeType: 'text/html', buffer: Buffer.from('<section><h2>Version aus claude.ai</h2></section>') });
  await page.waitForTimeout(800);
  check('Panel: HTML als neue Version importieren (mit Hinweis)', impBody?.html?.includes('Version aus claude.ai') && impBody.prompt === 'Abstände etwas größer', JSON.stringify(impBody)?.slice(0, 160));

  // Token-Popup: Komponenten aus der Bibliothek als Bezug einfügen (eine Zeile je Variante)
  await page.unroute('**/api/sites/*/drafts/D-001/import');
  await page.route('**/api/sites/*/components', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ components: [{
    name: 'produktkachel', title: 'Produktkachel', slots: [{ key: 'titel', typ: 'text' }, { key: 'bild', typ: 'bild' }, { key: 'preis', typ: 'text' }],
    varianten: [{ key: 'standard', label: 'Standard' }, { key: 'kompakt', label: 'Kompakt', slots: ['titel', 'preis'] }],
  }] }) }));
  await selectHero();
  await ov('#modio-prompt').fill('Darunter 3×');
  await ov('#modio-prompt').press('Control+ ');
  await page.waitForTimeout(500);
  const popText = await ov('#modio-tokpop ul').textContent();
  check('Popup: Gruppe Komponenten mit einer Zeile je Variante', popText.includes('Komponenten') && (popText.match(/mx-produktkachel/g) || []).length === 2, popText.slice(0, 300));
  await ov('#modio-tokpop input').fill('kompakt');
  await page.waitForTimeout(200);
  await ov('#modio-tokpop input').press('Enter');
  await page.waitForTimeout(200);
  check('Popup: Bezug mit Variante und deren Slots eingefügt', (await ov('#modio-prompt').inputValue()) === 'Darunter 3× mx-produktkachel (Variante kompakt; Slots: titel, preis)', await ov('#modio-prompt').inputValue());
  await page.unroute('**/api/sites/*/components');

  check('Keine JavaScript-Fehler', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
process.exit(fail ? 1 : 0);
