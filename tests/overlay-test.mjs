// Phase-4/5-Test im Browser (Playwright): Auswahl, Prompt mit Referenzbild, Reload, Prüfdialog, Rücksprung.
// Voraussetzungen: Bridge-Server und Worker laufen, Website existiert.
// Aufruf: node --env-file=.env tests/overlay-test.mjs [base-url] [slug]
// Optional: PLAYWRIGHT_CHROMIUM=/pfad/zu/chrome
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const BASE = process.argv[2] || `http://localhost:${process.env.BRIDGE_PORT || 3000}`;
const SLUG = process.argv[3] || 'testfirma';
const ROOT = path.resolve(import.meta.dirname, '..');
const SITE = path.join(ROOT, 'sites', SLUG);
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name} ${extra}`); }
};

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(e.message));
page.on('dialog', (d) => d.accept());

const ov = (sel) => page.locator(`#dps-overlay-host ${sel}`);

console.log('Overlay laden');
await page.goto(`${BASE}/s/${SLUG}/`);
await page.waitForSelector('#dps-overlay-host', { state: 'attached', timeout: 5000 });
check('Overlay eingebunden', await page.locator('#dps-overlay-host').count() === 1);
check('Seite normal bedienbar (Auswahl aus)', (await ov('button:has-text("Auswählen")').getAttribute('aria-pressed')) === 'false');
await ov('button:has-text("Auswählen")').waitFor({ state: 'visible' });
await page.waitForFunction(() => {
  const b = [...document.querySelector('#dps-overlay-host').shadowRoot.querySelectorAll('button')].find((x) => x.textContent === 'Auswählen');
  return b && !b.disabled;
}, null, { timeout: 10000 });

console.log('Auswahlmodus');
const urlBefore = page.url();
await page.keyboard.press('Alt+a');
await page.hover('header nav a');
await page.click('header nav a');
await page.waitForTimeout(300);
check('Link-Klick im Auswahlmodus navigiert nicht', page.url() === urlBefore);
check('Prompt-Dialog öffnet sich', await ov('textarea').isVisible());
await page.keyboard.press('Escape');

await page.keyboard.press('Alt+a');
await page.hover('main p');
await page.keyboard.press('ArrowUp');
await page.keyboard.press('Enter');
check('Pfeil nach oben wählt Elternelement', /section|hero/.test(await page.evaluate(() => document.querySelector('#dps-overlay-host').shadowRoot.textContent)));
await page.keyboard.press('Escape');
await page.keyboard.press('Alt+a');
await page.hover('h1.hero__title');
await page.click('h1.hero__title');
check('Element gewählt', await ov('textarea').isVisible());
const meta = await page.evaluate(() => document.querySelector('#dps-overlay-host').shadowRoot.textContent);
check('Selektor angezeigt', /hero__title/.test(meta));

console.log('Pfadleiste im Annotationsdialog');
const crumbs = ov('.crumbs button');
const crumbCount = await crumbs.count();
check('Pfadleiste zeigt Vorfahren', crumbCount >= 2, String(crumbCount));
await crumbs.nth(crumbCount - 2).hover();
const pvShown = await page.evaluate(() => {
  const pv = document.querySelector('#dps-overlay-host').shadowRoot.querySelector('.hl.pv');
  return getComputedStyle(pv).display === 'block' && pv.textContent.length > 0;
});
check('Hover über Elternglied zeigt Vorschau', pvShown);
await crumbs.nth(crumbCount - 2).click();
check('Klick wählt Elternelement', !/hero__title/.test(await ov('.sel-full').textContent()));
await crumbs.nth(crumbCount - 1).click();
check('Zurück zum ursprünglichen Element', /hero__title/.test(await ov('.sel-full').textContent()));

console.log('Annotation mit Referenzbild absenden');
const png = await sharp({ create: { width: 300, height: 120, channels: 3, background: '#e8590c' } }).png().toBuffer();
await ov('textarea').fill('Headline in Orange wie im Referenzbild einfärben und Schriftgröße auf 56px erhöhen.');
await ov('input[type=file]').setInputFiles({ name: 'orange.png', mimeType: 'image/png', buffer: png });
await page.waitForTimeout(200);
check('Vorschau des Referenzbilds', (await ov('.thumbs img').count()) === 1);
const reload = page.waitForEvent('load', { timeout: 10 * 60 * 1000 });
await ov('button:has-text("Absenden")').click();
await page.waitForTimeout(500);
const statusText = await page.evaluate(() => document.querySelector('#dps-overlay-host').shadowRoot.querySelector('.status')?.textContent || '');
check('Status zeigt laufenden Job', /warte|arbeitet|Warteschlange|läuft/i.test(statusText), statusText);
console.log('  … warte auf Claude Code und Reload');
await reload;
await page.waitForLoadState('networkidle');
const h1 = await page.evaluate(() => {
  const s = getComputedStyle(document.querySelector('h1.hero__title'));
  return { size: s.fontSize, color: s.color };
});
check('Änderung nach Reload sichtbar (56px)', h1.size === '56px', JSON.stringify(h1));
const css = fs.readFileSync(path.join(SITE, 'overrides.css'), 'utf8');
check('Override-Block kommentiert', /\/\*\s*A-\d+:/.test(css));

console.log('Prüfdialog (simulierter Treffer)');
const hist = JSON.parse(fs.readFileSync(path.join(SITE, '.history.json'), 'utf8'));
const entry = path.join(SITE, 'www', JSON.parse(fs.readFileSync(path.join(SITE, 'site.json'), 'utf8')).entry);
fs.appendFileSync(entry, '\n<!-- test --><button onclick="x()">x</button>\n');
const reviewId = `job-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-abcdef`;
fs.writeFileSync(path.join(ROOT, 'jobs/review', `${reviewId}.json`), JSON.stringify({
  id: reviewId, type: 'annotate', slug: SLUG, status: 'review', created: new Date().toISOString(), updated: new Date().toISOString(),
  params: { prompt: 'Simulierter Schritt' },
  result: { status: 'review', annotationId: 'A-999', hits: [{ rule: 'event-handler', file: 'www/x.html', line: 1, text: '<button onclick="x()">' }], diff: '+<button onclick="x()">x</button>' },
}));
await page.reload();
await ov('button:has-text("verwerfen")').waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
check('Prüfdialog erscheint', await ov('button:has-text("verwerfen")').isVisible());
check('Trefferliste zeigt Regel', (await page.evaluate(() => document.querySelector('#dps-overlay-host').shadowRoot.textContent)).includes('event-handler'));
const reload2 = page.waitForEvent('load', { timeout: 60000 });
await ov('button:has-text("verwerfen")').click();
await reload2.catch(() => {});
await page.waitForTimeout(500);
check('Verworfen: Änderung entfernt', !fs.readFileSync(entry, 'utf8').includes('onclick="x()"'));
check('Review-Job abgeschlossen', fs.existsSync(path.join(ROOT, 'jobs/done', `${reviewId}.json`)));

console.log('Verlauf und Rücksprung');
await page.waitForLoadState('networkidle');
await ov('button[aria-controls=dps-history]').click();
await ov('li:has-text("Ausgangsstand")').waitFor({ timeout: 5000 });
const stepCount = await ov('li:has-text("A-0")').count();
check('Verlauf listet Schritte', stepCount >= 1 && stepCount === hist.steps.length, `${stepCount} vs ${hist.steps.length}`);
const reload3 = page.waitForEvent('load', { timeout: 60000 });
await ov('li:has-text("Ausgangsstand") button').first().click();
await reload3;
await page.waitForLoadState('networkidle');
const size = await page.evaluate(() => getComputedStyle(document.querySelector('h1.hero__title')).fontSize);
check('Rücksprung auf Ausgangsstand', size === '32px', size);
check('overrides.css wieder leer', fs.readFileSync(path.join(SITE, 'overrides.css'), 'utf8').trim() === '');

const relevantErrors = consoleErrors.filter((e) => !/favicon|Failed to load resource/.test(e));
check('Keine JS-Fehler', relevantErrors.length === 0, relevantErrors.join(' | '));
await browser.close();
console.log(`\nErgebnis: ${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
