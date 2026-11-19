#!/usr/bin/env node
// Gestaltungsprüfung mit dem Detektor des Skills „impeccable“ (impeccable detect) für design-check.sh.
// Liefert die Seiten vorher und nachher wie der Bridge-Server aus (render.mjs), scannt beide je Ansicht und meldet nur
// Befunde, die nachher neu sind. Bei Entwürfen nur Befunde innerhalb der Komponente (Element im Entwurf).
// Aufruf: design-check.mjs <siteDir> <slug> <spec>
//   spec Annotation: { mode: "annotation", before: "HEAD", pages: ["/…html"], viewports: [{name, width, height}] }
//   spec Entwurf:    { mode: "draft", draftDir, version, page, selector, viewports }
// Ausgabe: { status: ok|issues|unavailable, findings: [...], counts: {before, after}, scans }, Exit 0 / 3 / 4
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startServer, makeReader } from './render.mjs';
import { loadVersion, instanceHtml, placeElement, placementOf, readText } from './draft.mjs';
import { loadCheerio } from './consistency.mjs';
import { exitJson } from './stdout.mjs';

const out = (obj, code = 0) => exitJson(obj, code);
const TIMEOUT_MS = Number(process.env.DESIGN_CHECK_TIMEOUT_MS || 90000);

function detect(cmd, url, vp, env, cwd) {
  return new Promise((resolve) => {
    const args = ['detect', '--json', '--no-advisory', '--viewport', `${vp.width}x${vp.height}`, url];
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ error: e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      let findings = null;
      try { findings = JSON.parse(stdout); } catch { /* unten */ }
      if (!Array.isArray(findings) || code === 1) {
        resolve({ error: (stderr.trim().split('\n').filter(Boolean).pop() || `Exit ${code}`).slice(0, 300) });
      } else resolve({ findings });
    });
  });
}

// Vorher und nachher laufen auf verschiedenen Ports: Adressen des Prüfservers aus den Texten entfernen (sonst gilt
// z. B. jeder Script-Fehler mit Fundstelle als neu)
const LOCAL_URL = /https?:\/\/127\.0\.0\.1:\d+\/s\/[^/\s)]+/g;
const plain = (s) => String(s || '').replace(LOCAL_URL, '');
// Zum Vergleich auch Zeile und Spalte weglassen: Ein Entwurf verschiebt die Zeilen der Seite
const keyOf = (f) => `${f.antipattern}|${f.selector || plain(f.snippet).replace(/:\d+:\d+\b/g, '')}`;

async function browserPath() {
  for (const p of [process.env.IMPECCABLE_BROWSER, process.env.PLAYWRIGHT_CHROMIUM]) if (p && fs.existsSync(p)) return p;
  try {
    const { chromium } = await import('playwright');
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch { /* kein Playwright */ }
  return null;
}

// Entwurf: welche Selektoren liegen in der Komponente? (ein Treffer innerhalb genügt; ohne Treffer bleibt der Befund)
async function insideComponent(url, origin, name, selectors, vp) {
  const keep = new Map();
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { return null; }
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined }).catch(() => null);
  if (!browser) return null;
  try {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    await ctx.route('**/*', (route) => {
      const u = route.request().url();
      return u.startsWith(origin + '/') || u.startsWith('data:') || u.startsWith('blob:') ? route.continue() : route.abort();
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
    const res = await page.evaluate(([sels, cls]) => sels.map((s) => {
      let els;
      try { els = [...document.querySelectorAll(s)]; } catch { return null; }
      if (!els.length) return null;
      return els.some((e) => e.closest('.' + cls));
    }), [selectors, `mx-${name}`]);
    selectors.forEach((s, i) => keep.set(s, res[i]));
  } finally {
    await browser.close().catch(() => {});
  }
  return keep;
}

async function main() {
  const [siteDir, slug, specArg] = process.argv.slice(2);
  if (!siteDir || !slug || !specArg) out({ status: 'error', error: 'Aufruf: design-check.mjs <siteDir> <slug> <spec>' }, 1);
  const spec = JSON.parse(specArg);
  const cmd = process.env.IMPECCABLE_CMD;
  if (!cmd || !fs.existsSync(cmd)) out({ status: 'unavailable', error: `Detektor nicht gefunden (${cmd || 'IMPECCABLE_CMD leer'})` }, 4);
  const browser = await browserPath();
  if (!browser) out({ status: 'unavailable', error: 'Kein Chromium für den Detektor (npx playwright install chromium oder IMPECCABLE_BROWSER setzen)' }, 4);
  const env = { ...process.env, IMPECCABLE_BROWSER: browser };
  const viewports = spec.viewports?.length ? spec.viewports : [{ name: 'desktop', width: 1440, height: 900 }];

  let before, after, pages, draftName = null;
  if (spec.mode === 'draft') {
    const draftDir = spec.draftDir;
    const v = await loadVersion(siteDir, draftDir, Number(spec.version));
    if (v.errors.length) out({ status: 'error', error: `Entwurf ungültig: ${v.errors.join('; ')}` }, 1);
    const cheerio = await loadCheerio();
    const pageRel = 'www' + spec.page;
    const src = readText(path.join(siteDir, pageRel));
    let placement = 'replace';
    try { placement = placementOf(JSON.parse(fs.readFileSync(path.join(draftDir, 'draft.json'), 'utf8'))); } catch { /* ersetzen */ }
    const r = placeElement(cheerio, src.text, spec.selector, instanceHtml(cheerio, v), placement);
    if (r.error) out({ status: 'error', error: `Element nicht ersetzbar: ${r.error}` }, 1);
    const base = makeReader(siteDir, 'after');
    const draftReader = { ...base, read: async (rel) => (rel === pageRel ? Buffer.from(r.text, src.enc) : base.read(rel)) };
    draftName = v.name;
    before = await startServer(base, slug);
    after = await startServer(draftReader, slug, { draft: { name: v.name, css: v.css } });
    pages = [spec.page];
  } else {
    before = await startServer(makeReader(siteDir, 'before', spec.before || 'HEAD'), slug);
    after = await startServer(makeReader(siteDir, 'after'), slug);
    pages = (spec.pages || []).slice(0, 6);
  }

  const findings = new Map();
  const scans = [];
  let nBefore = 0, nAfter = 0;
  try {
    for (const page of pages) {
      for (const vp of viewports) {
        const [b, a] = await Promise.all([
          detect(cmd, `${before.origin}${before.base}${page}`, vp, env, siteDir),
          detect(cmd, `${after.origin}${after.base}${page}`, vp, env, siteDir),
        ]);
        if (a.error || b.error) {
          scans.push({ page, viewport: vp.name, error: a.error || b.error });
          continue;
        }
        scans.push({ page, viewport: vp.name, before: b.findings.length, after: a.findings.length });
        nBefore += b.findings.length; nAfter += a.findings.length;
        const old = new Set(b.findings.map(keyOf));
        for (const f of a.findings) {
          const k = `${page}|${keyOf(f)}`;
          if (old.has(keyOf(f))) continue;
          if (findings.has(k)) { findings.get(k).viewports.push(vp.name); continue; }
          findings.set(k, { rule: f.antipattern, name: f.name, severity: f.severity, page, selector: f.selector || null,
            snippet: plain(f.snippet).slice(0, 300), description: String(f.description || '').slice(0, 500), viewports: [vp.name] });
        }
      }
    }
    let list = [...findings.values()];
    if (draftName && list.length) {
      const sels = [...new Set(list.map((f) => f.selector).filter(Boolean))];
      const inside = sels.length ? await insideComponent(`${after.origin}${after.base}${spec.page}`, after.origin, draftName, sels, viewports[0]) : null;
      if (inside) list = list.filter((f) => !f.selector || inside.get(f.selector) !== false);
    }
    list = list.slice(0, 30);
    if (scans.length && scans.every((s) => s.error)) {
      out({ status: 'unavailable', error: `Detektor fehlgeschlagen: ${scans[0].error}`, scans }, 4);
    }
    out({ status: list.length ? 'issues' : 'ok', findings: list, counts: { before: nBefore, after: nAfter }, scans }, list.length ? 3 : 0);
  } finally {
    before.server.close(); after.server.close();
  }
}

main().catch((e) => out({ status: 'error', error: e.message }, 1));
