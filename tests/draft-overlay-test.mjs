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
  const ov = (sel) => page.locator(`#dps-overlay-host ${sel}`);

  // Vorschau
  await page.goto(`${pageUrl}?__dps_draft=D-001&__dps_v=1`);
  await page.waitForTimeout(800);
  check('Vorschau: Entwurfs-Panel öffnet sich, Status zeigt die Vorschau', await ov('#dps-drafts.open').isVisible() && (await ov('.bar .status').innerText()).includes('Vorschau D-001 · v1') && (await ov('.pvband').count()) === 0);
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
  await ov('#dps-drafts .vtabs button:has-text("v2")').click();
  await page.waitForTimeout(500);
  check('Live: v2 ohne Neuladen', await page.evaluate(() => window.__noReload === 1 && document.querySelector('.mx-hero h1').textContent === 'Version zwei' && location.search.includes('__dps_v=2')));
  await ov('#dps-drafts .vtabs button:has-text("Aktuell")').click();
  await page.waitForTimeout(500);
  check('Live: „Aktuell“ zeigt das bisherige Element', await page.evaluate(() => window.__noReload === 1 && !!document.querySelector('section.hero .hero__title') && !document.querySelector('.mx-hero') && document.querySelector('link[data-dps="draft"]').disabled));
  await page.keyboard.press('v');
  await page.waitForTimeout(500);
  check('Live: Taste V zurück zur zuletzt gezeigten Version', await page.evaluate(() => window.__noReload === 1 && document.querySelector('.mx-hero h1')?.textContent === 'Version zwei'));
  await ov('#dps-drafts .vtabs button:has-text("v1")').click();
  await page.waitForTimeout(500);
  await page.waitForTimeout(200);
  const panelText = await ov('#dps-drafts').textContent();
  check('Entwurfs-Panel öffnet D-001 mit Bausteinen und Befund', await ov('#dps-drafts.open').isVisible() && panelText.includes('Bausteine') && panelText.includes('P2 · Kontrast Orange') && panelText.includes('1 offen'));
  await ov('#dps-drafts textarea[data-fk="ta"]').fill('Etwas ruhiger bitte');
  await ov('#dps-drafts .sb-body').evaluate((n) => { n.scrollTop = 200; });
  const scBefore = await ov('#dps-drafts .sb-body').evaluate((n) => n.scrollTop);
  check('Befund zunächst zugeklappt', !(await ov('details.bfdet:has-text("Befund von Claude")').evaluate((n) => n.open)));
  await ov('details.bfdet:has-text("Befund von Claude") > summary').click();
  await ov('.bf-item:has-text("P2") button.bf-act').click();
  check('Befundpunkt vormerken zählt als Änderung', (await ov('#dps-drafts').textContent()).includes('Neue Version (1 Änderung(en) gewählt)') && (await ov('.bf-item:has-text("P2") button.bf-act').textContent()) === 'wird umgesetzt');
  check('Text im Feld „Nachbessern“ bleibt erhalten', (await ov('#dps-drafts textarea[data-fk="ta"]').inputValue()) === 'Etwas ruhiger bitte');
  check('Scrollposition bleibt erhalten', (await ov('#dps-drafts .sb-body').evaluate((n) => n.scrollTop)) === scBefore, String(scBefore));
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
  const noteSel = () => ov('ul.nlist .nmeta .sel-full').first().textContent();
  const sel0 = await noteSel();
  const crumbs = await ov('ul.nlist .nmeta .crumbs button').allTextContents();
  check('Hinweis: Pfad bis zur Komponente, Selektor sichtbar', crumbs.length >= 2 && crumbs[0].includes('mx-hero') && sel0.includes('.mx-hero'), JSON.stringify([crumbs, sel0]));
  await ov('ul.nlist .nmeta .crumbs button').nth(crumbs.length - 2).click();
  const sel1 = await noteSel();
  check('Hinweis: Elternelement über die Pfadleiste wählen', sel1 !== sel0 && sel1.includes('.mx-hero') && (await ov('ul.nlist .nmeta .crumbs button').count()) === crumbs.length, JSON.stringify([sel0, sel1]));
  await ov('ul.nlist .nmeta button.sel-edit').first().click();
  await ov('ul.nlist .nmeta input.textin').fill('body');
  check('Hinweis: Selektor außerhalb der Komponente abgelehnt', (await ov('ul.nlist .nmeta .hint').textContent()).includes('außerhalb der Komponente'));
  await ov('ul.nlist .nmeta input.textin').fill('.mx-hero h1');
  await ov('ul.nlist .nmeta input.textin').press('Enter');
  check('Hinweis: Selektor von Hand angepasst', (await noteSel()).includes('.mx-hero h1') && (await ov('ul.nlist .nhead code').first().textContent()).includes('h1'), await noteSel());
  await ov('textarea.ndesc').first().fill('Überschrift kleiner');
  check('Hinweis zählt als Änderung', (await ov('#dps-drafts').textContent()).includes('Neue Version (2 Änderung(en) gewählt)'));
  // Token oder Komponente in den Hinweis einfügen
  await page.route('**/api/sites/*/components', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ components: [{
    name: 'knopf', title: 'Knopf', slots: [{ key: 'text', typ: 'text' }], varianten: [{ key: 'primaer', label: 'Primär' }],
  }] }) }));
  await ov('ul.nlist button.tokbtn').first().click();
  await page.waitForTimeout(500);
  check('Hinweis: Auswahl Token/Komponente öffnet am Hinweis', await ov('ul.nlist #dps-tokpop').isVisible());
  await ov('#dps-tokpop input').fill('knopf');
  await page.waitForTimeout(200);
  await ov('#dps-tokpop input').press('Enter');
  await page.waitForTimeout(200);
  const noteVal = await ov('textarea.ndesc').first().inputValue();
  check('Hinweis: Komponente eingefügt', noteVal === 'Überschrift kleiner mx-knopf (Variante primaer; Slots: text)', noteVal);
  check('Hinweis: Popup danach zu', !(await ov('#dps-tokpop').isVisible()));
  await ov('#dps-drafts textarea[data-fk="ta"]').fill('Darunter');
  await ov('#dps-drafts textarea[data-fk="ta"]').press('Control+ ');
  await page.waitForTimeout(500);
  check('Nachbessern: Auswahl öffnet am Feld', await ov('#dps-drafts .dsec #dps-tokpop').isVisible());
  await ov('#dps-tokpop input').fill('knopf');
  await page.waitForTimeout(200);
  await ov('#dps-tokpop input').press('Enter');
  await page.waitForTimeout(200);
  const fixVal = await ov('#dps-drafts textarea[data-fk="ta"]').inputValue();
  check('Nachbessern: Komponente eingefügt', fixVal === 'Darunter mx-knopf (Variante primaer; Slots: text)', fixVal);
  await ov('#dps-drafts textarea[data-fk="ta"]').fill('');
  await page.unroute('**/api/sites/*/components');
  await ov('#dps-drafts button.phbtn').click();
  check('Platzhalter markieren', await page.evaluate(() => !!document.querySelector('style[data-dps="platzhalter"]') && document.querySelector('[data-mx-platzhalter]').title.includes('Merkliste')));

  // Älterer Server ohne preview.name: Live-Funktionen müssen trotzdem gehen (Name aus den Entwurfsdaten)
  await page.route('**/*__dps_draft=*', async (route) => {
    const r = await route.fetch();
    await route.fulfill({ response: r, body: (await r.text()).replace(',"name":"hero"', '') });
  });
  await page.goto(`${pageUrl}?__dps_draft=D-001&__dps_v=1`);
  await page.waitForTimeout(900);
  await page.unroute('**/*__dps_draft=*');
  await page.evaluate(() => { window.__noReload2 = 1; });
  await ov('#dps-drafts .vtabs button:has-text("v2")').click();
  await page.waitForTimeout(500);
  check('Live ohne preview.name (älterer Server)', await page.evaluate(() => window.__noReload2 === 1 && document.querySelector('.mx-hero h1')?.textContent === 'Version zwei'));
  await page.waitForTimeout(200);
  check('Ohne preview.name: Element wählen möglich', !(await ov('button:has-text("Element im Entwurf wählen")').isDisabled()));

  await ov('#dps-drafts button.exitbtn').click();
  await page.waitForTimeout(800);
  check('„Vorschau beenden“ führt zur normalen Seite', !page.url().includes('__dps_draft') && (await ov('#dps-drafts button.exitbtn').count()) === 0, page.url());

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
  await ov('#dps-prompt').fill('Hero moderner gestalten');
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
    const p = document.querySelector('#dps-overlay-host').shadowRoot.querySelector('.panel.prompt');
    const vis = [...p.querySelectorAll('.phead button, .tokrow button, .pfoot button')].filter((b) => b.offsetParent);
    return {
      text: p.textContent, urlField: !!p.querySelector('input[type="url"]'),
      heights: [...new Set(vis.map((b) => b.getBoundingClientRect().height))],
      wraps: vis.filter((b) => getComputedStyle(b).whiteSpace !== 'nowrap').length,
      foot: [...p.querySelectorAll('.pfoot button')].filter((b) => b.offsetParent).map((b) => b.textContent.trim() || b.title),
      keys: p.querySelector('.pkeys').textContent, menuHidden: p.querySelector('.qmenu').hidden,
      primary: [...p.querySelectorAll('.pfoot button.primary')].filter((b) => b.offsetParent).map((b) => b.textContent.trim()),
    };
  });
  check('Dialog: ohne Bild-URL, Abbrechen und claude.ai', !dlg.urlField && !/Abbrechen|URL hinzufügen|claude\.ai|HTML importieren/.test(dlg.text), dlg.text.slice(0, 200));
  check('Dialog: Footer Split-Button In die Queue und Hauptknopf Entwurf erstellen', dlg.foot.includes('In die Queue') && dlg.foot[dlg.foot.length - 1] === 'Entwurf erstellen' && dlg.primary.join() === 'Entwurf erstellen' && dlg.menuHidden, JSON.stringify(dlg));
  check('Dialog: Buttons mit gleicher Höhe, ohne Umbruch', dlg.heights.length === 1 && dlg.wraps === 0, JSON.stringify(dlg.heights));
  check('Dialog: Kürzel-Hinweis unter dem Footer', /Strg\+Enter Entwurf erstellen · Esc Schließen/.test(dlg.keys), dlg.keys);
  let direct = null;
  await page.route('**/api/sites/*/annotations', async (route) => {
    direct = route.request().postData();
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ job: { id: 'job-20261113000002-abcdef', type: 'annotate', slug: SLUG, status: 'pending' } }) });
  });
  await ov('#dps-prompt').fill('Abstand oben kleiner');
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
  // Verschieben an der Kopfzeile, beim nächsten Öffnen wieder an der Standardposition
  await selectHero();
  const box0 = await ov('.panel.prompt').boundingBox();
  const h = await ov('.phead h2').boundingBox();
  await page.mouse.move(h.x + 10, h.y + 5);
  await page.mouse.down();
  await page.mouse.move(h.x - 290, h.y - 195, { steps: 5 });
  await page.mouse.up();
  const box1 = await ov('.panel.prompt').boundingBox();
  check('Dialog lässt sich an der Kopfzeile verschieben', Math.abs(box1.x - (box0.x - 300)) < 2 && Math.abs(box1.y - (box0.y - 200)) < 2, JSON.stringify([box0, box1]));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  await ov('.bar button[aria-pressed]').first().click();
  await page.locator('section.hero').click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(300);
  const box2 = await ov('.panel.prompt').boundingBox();
  check('Nach erneutem Öffnen an der Standardposition', Math.abs(box2.x - box0.x) < 2 && Math.abs(box2.y - box0.y) < 2, JSON.stringify([box0, box2]));

  // Entwurfs-Panel: Briefing (von tests/run.sh erzeugt) kopieren/herunterladen und Import als neue Version
  await page.unroute('**/api/sites/*/drafts');
  await ov('.bar button[aria-controls="dps-drafts"]').click();
  await page.waitForTimeout(400);
  await ov('#dps-drafts button.ditem:has-text("D-001")').click();
  await page.waitForTimeout(800);
  await ov('#dps-drafts details.claude > summary').click();
  await page.waitForTimeout(300);
  // Leiste waagerecht verschieben, Doppelklick setzt zurück
  const hb = await ov('#dps-drafts .sb-head h2').boundingBox();
  const pb0 = await ov('#dps-drafts').boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 - 300, hb.y + hb.height / 2 + 80, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(350); // Leiste gleitet (transition)
  const pb1 = await ov('#dps-drafts').boundingBox();
  const bar1 = await ov('.bar').boundingBox();
  check('Entwurfsleiste waagerecht verschoben, Leiste weicht aus', Math.abs(pb0.x - pb1.x - 300) < 3 && pb1.y === pb0.y && (bar1.x > pb1.x + pb1.width || bar1.x + bar1.width < pb1.x), JSON.stringify([pb0, pb1, bar1]));
  await ov('#dps-drafts .sb-head h2').dblclick();
  check('Entwurfsleiste per Doppelklick zurück am rechten Rand', Math.abs((await ov('#dps-drafts').boundingBox()).x - pb0.x) < 2);
  check('Panel: Bereich „Gestaltung in claude.ai“ mit Briefing', (await ov('#dps-drafts details.claude').count()) === 1 && (await ov('#dps-drafts textarea.brieftext').inputValue()).includes('## Auftrag') && (await ov('#dps-drafts ul.brieffiles').textContent()).includes('D-001-element.html'));
  // Briefing anpassen: Kopieren nimmt den angepassten Text; Ordnerpfad kopieren
  await page.evaluate(() => { navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }; });
  await ov('#dps-drafts details.claude details > summary').click();
  const bt = ov('#dps-drafts textarea.brieftext');
  await bt.fill((await bt.inputValue()) + '\nZusatz: bitte dunkler Hintergrund');
  await ov('#dps-drafts button:has-text("Briefing kopieren")').click();
  await page.waitForTimeout(200);
  check('Briefing angepasst und kopiert', (await page.evaluate(() => window.__copied || '')).endsWith('Zusatz: bitte dunkler Hintergrund') && (await ov('#dps-drafts .briefedit').textContent()).includes('angepasst'));
  await ov('#dps-drafts button:has-text("Original wiederherstellen")').click();
  check('Briefing: Original wiederhergestellt', !(await bt.inputValue()).includes('Zusatz:') && (await ov('#dps-drafts .briefedit').textContent()) === '');
  await ov('#dps-drafts button.pathbtn').click();
  await page.waitForTimeout(200);
  const copiedPath = await page.evaluate(() => window.__copied || '');
  check('Ordnerpfad kopieren', /[\\/]drafts[\\/]D-001[\\/]brief$/.test(copiedPath) && (!process.env.WSL_DISTRO_NAME || copiedPath.startsWith('\\\\wsl.localhost\\')), copiedPath);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), ov('#dps-drafts ul.brieffiles button:has-text("D-001-element.html")').click()]);
  check('Panel: Briefing-Datei herunterladen', dl && dl.suggestedFilename() === 'D-001-element.html', String(dl && dl.suggestedFilename()));
  let impBody = null;
  await page.route('**/api/sites/*/drafts/D-001/import', async (route) => {
    impBody = route.request().postDataJSON();
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ job: { id: 'job-20261113000001-abcdef', type: 'draft', slug: SLUG, status: 'pending' } }) });
  });
  await ov('#dps-drafts input[data-fk="imp-note"]').fill('Abstände etwas größer');
  await ov('#dps-drafts details.claude input[type="file"]').setInputFiles({ name: 'v3.html', mimeType: 'text/html', buffer: Buffer.from('<section><h2>Version aus claude.ai</h2></section>') });
  await page.waitForTimeout(800);
  check('Panel: HTML als neue Version importieren (mit Hinweis)', impBody?.html?.includes('Version aus claude.ai') && impBody.prompt === 'Abstände etwas größer', JSON.stringify(impBody)?.slice(0, 160));

  // Token-Popup: Komponenten aus der Bibliothek als Bezug einfügen (eine Zeile je Variante)
  await page.unroute('**/api/sites/*/drafts/D-001/import');
  await page.route('**/api/sites/*/components', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ components: [{
    name: 'produktkachel', title: 'Produktkachel', slots: [{ key: 'titel', typ: 'text' }, { key: 'bild', typ: 'bild' }, { key: 'preis', typ: 'text' }],
    varianten: [{ key: 'standard', label: 'Standard' }, { key: 'kompakt', label: 'Kompakt', slots: ['titel', 'preis'] }],
  }] }) }));
  await selectHero();
  await ov('#dps-prompt').fill('Darunter 3×');
  await ov('#dps-prompt').press('Control+ ');
  await page.waitForTimeout(500);
  const popText = await ov('#dps-tokpop ul').textContent();
  check('Popup: Gruppe Komponenten mit einer Zeile je Variante', popText.includes('Komponenten') && (popText.match(/mx-produktkachel/g) || []).length === 2, popText.slice(0, 300));
  await ov('#dps-tokpop input').fill('kompakt');
  await page.waitForTimeout(200);
  await ov('#dps-tokpop input').press('Enter');
  await page.waitForTimeout(200);
  check('Popup: Bezug mit Variante und deren Slots eingefügt', (await ov('#dps-prompt').inputValue()) === 'Darunter 3× mx-produktkachel (Variante kompakt; Slots: titel, preis)', await ov('#dps-prompt').inputValue());
  await page.unroute('**/api/sites/*/components');

  check('Keine JavaScript-Fehler', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
process.exit(fail ? 1 : 0);
