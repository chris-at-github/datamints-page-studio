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
  check('Overlay: Vorschau-Band sichtbar', await ov('.pvband.open').isVisible() && (await ov('.pvband').innerText()).includes('D-001'));
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
  await ov('.pvband button:has-text("v2")').click();
  await page.waitForTimeout(500);
  check('Live: v2 ohne Neuladen', await page.evaluate(() => window.__noReload === 1 && document.querySelector('.mx-hero h1').textContent === 'Version zwei' && location.search.includes('__modio_v=2')));
  await ov('.pvband button:has-text("Aktuell")').click();
  await page.waitForTimeout(500);
  check('Live: „Aktuell“ zeigt das bisherige Element', await page.evaluate(() => window.__noReload === 1 && !!document.querySelector('section.hero .hero__title') && !document.querySelector('.mx-hero') && document.querySelector('link[data-modio="draft"]').disabled));
  await page.keyboard.press('v');
  await page.waitForTimeout(500);
  check('Live: Taste V zurück zur zuletzt gezeigten Version', await page.evaluate(() => window.__noReload === 1 && document.querySelector('.mx-hero h1')?.textContent === 'Version zwei'));
  await ov('.pvband button:has-text("v1")').click();
  await page.waitForTimeout(500);
  await ov('.pvband button:has-text("Bearbeiten")').click();
  await page.waitForTimeout(400);
  const panelText = await ov('#modio-drafts').textContent();
  check('Entwurfs-Panel öffnet D-001 mit Bausteinen und Befund', await ov('#modio-drafts.open').isVisible() && panelText.includes('Bausteine') && panelText.includes('P2 · Kontrast Orange') && panelText.includes('1 offen'));
  await ov('#modio-drafts textarea[data-fk="ta"]').fill('Etwas ruhiger bitte');
  await ov('#modio-drafts .sb-body').evaluate((n) => { n.scrollTop = 200; });
  const scBefore = await ov('#modio-drafts .sb-body').evaluate((n) => n.scrollTop);
  await ov('label.bf-item:has-text("P2") input').check();
  check('Befundpunkt umschalten zählt als Änderung', (await ov('#modio-drafts').textContent()).includes('Neue Version (1 Änderung(en) gewählt)'));
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
  await ov('.pvband button:has-text("Platzhalter zeigen")').click();
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
  await ov('.pvband button:has-text("v2")').click();
  await page.waitForTimeout(500);
  check('Live ohne preview.name (älterer Server)', await page.evaluate(() => window.__noReload2 === 1 && document.querySelector('.mx-hero h1')?.textContent === 'Version zwei'));
  await ov('.pvband button:has-text("Bearbeiten")').click();
  await page.waitForTimeout(300);
  check('Ohne preview.name: Element wählen möglich', !(await ov('button:has-text("Element im Entwurf wählen")').isDisabled()));

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
  await ov('button:has-text("Entwurf erstellen")').click();
  await page.waitForTimeout(600);
  const ann = body && JSON.parse((body.match(/name="annotation"\r\n\r\n([\s\S]*?)\r\n--/) || [])[1] || 'null');
  check('Entwurf erstellen: Annotation mit Prompt und Selektor gesendet', ann?.prompt === 'Hero moderner gestalten' && /hero/.test(ann.selector || ''), body?.slice(0, 200));
  check('Entwurf erstellen: Bausteine und Breite gemessen', Array.isArray(ann?.bausteine) && ann.bausteine.some((b) => b.kind === 'heading' && b.style?.['font-size']) && ann.rect?.width > 0, JSON.stringify(ann?.bausteine)?.slice(0, 200));
  check('Keine JavaScript-Fehler', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
process.exit(fail ? 1 : 0);
