#!/usr/bin/env node
// Kunden-Export (site-share.sh): Seiten als eigenständige HTML-Dateien ohne Webserver (CSS von Page Studio
// eingebettet, kein Overlay) und/oder ganzseitige Screenshots Desktop und Mobil, dazu eine Übersicht index.html.
// Bilder und andere Adressen fremder Server bleiben, wie sie sind (laden aus dem Netz).
// Aufruf: share.mjs <siteDir> <slug> <outDir> <beides|bilder|html>
// Ausgabe: { pages: [{ page, title, html, screenshots: { desktop, mobil } }], warnings }
import fs from 'node:fs';
import path from 'node:path';
import { sitePages } from './consistency.mjs';
import { layerLegacyCss } from './draft.mjs';
import { startServer, makeReader } from './render.mjs';
import { exitJson } from './stdout.mjs';

const out = (obj, code = 0) => exitJson(obj, code);
const VIEWPORTS = [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobil', width: 390, height: 844 }];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
// CSS als latin1-Zeichenkette, damit es byte-treu in die (latin1 gelesene) Seite passt
const asLatin1 = (s) => Buffer.from(s, 'utf8').toString('latin1');

function componentsCss(siteDir) {
  const dir = path.join(siteDir, 'components');
  const files = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((f) => /^mx-[a-z0-9-]+\.css$/.test(f)).sort();
  return files.map((f) => read(path.join(dir, f))).join('\n');
}

// Relative url() im CSS von Page Studio beziehen sich auf die Wurzel des Abzugs (der Server liefert es dort aus);
// eingebettet gelten sie relativ zur Seite: auf die Ordnertiefe der Seite umschreiben
function rebase(cssText, prefix) {
  if (!prefix) return cssText;
  return cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, u) =>
    (/^(data:|blob:|[a-z][a-z0-9+.-]*:|\/|#)/i.test(u.trim()) ? m : `url(${q}${prefix}${u.trim().replace(/^\.\//, '')}${q})`));
}

// Wie die Auslieferung im Bridge-Server, aber mit eingebettetem CSS statt Verweisen auf den Server und ohne Overlay
function standalone(buf, cssRoot, page) {
  const prefix = '../'.repeat(page.split('/').length - 1);
  const css = { tokens: rebase(cssRoot.tokens, prefix), overrides: rebase(cssRoot.overrides, prefix), components: rebase(cssRoot.components, prefix) };
  let html = buf.toString('latin1');
  let head;
  if (css.components.trim()) {
    html = layerLegacyCss(html);
    head = `<style data-dps="tokens">@layer legacy {\n${asLatin1(css.tokens)}\n}</style>` +
      `<style data-dps="overrides">@layer legacy {\n${asLatin1(css.overrides)}\n}</style>` +
      `<style data-dps="components">\n${asLatin1(css.components)}\n</style>`;
  } else {
    head = `<style data-dps="tokens">\n${asLatin1(css.tokens)}\n</style><style data-dps="overrides">\n${asLatin1(css.overrides)}\n</style>`;
  }
  const hi = html.search(/<\/head\s*>/i);
  html = hi >= 0 ? html.slice(0, hi) + head + html.slice(hi) : head + html;
  return Buffer.from(html, 'latin1');
}

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

const titleOf = (text) => {
  const m = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
};
const shotName = (page) => page.replace(/\.html?$/i, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'seite';

async function screenshots(siteDir, slug, outDir, pages, warnings) {
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { warnings.push('Screenshots nicht möglich: Playwright ist nicht installiert (npm install)'); return null; }
  let browser;
  try { browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined }); } catch (e) {
    warnings.push(`Screenshots nicht möglich: Chromium startet nicht (${String(e.message).split('\n')[0]})`); return null;
  }
  const srv = await startServer(makeReader(siteDir, 'after'), slug);
  const result = {};
  const dir = path.join(outDir, 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  try {
    for (const page of pages) {
      result[page] = {};
      for (const vp of VIEWPORTS) {
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block' });
        // Eigener Server vollständig; fremde Server nur für Bilder, Schriften, Stylesheets und Medien (wie die Seite sie zeigt)
        await ctx.route('**/*', (route) => {
          const req = route.request(); const u = req.url();
          if (u.startsWith(srv.origin + '/') || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
          if (/^https?:/.test(u) && !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u) && ['image', 'font', 'stylesheet', 'media'].includes(req.resourceType())) return route.continue();
          return route.abort();
        });
        const p = await ctx.newPage();
        try {
          await p.goto(`${srv.origin}${srv.base}/${page}`, { waitUntil: 'load', timeout: 30000 });
          await p.addStyleTag({ content: '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important}' }).catch(() => {});
          // Durch die Seite scrollen, damit Bilder mit loading="lazy" laden
          await p.evaluate(async () => {
            for (let y = 0; y < document.documentElement.scrollHeight; y += Math.max(400, innerHeight - 100)) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
            scrollTo(0, 0);
          });
          await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
          await p.waitForTimeout(300);
          const file = `${shotName(page)}-${vp.name}.png`;
          await p.screenshot({ path: path.join(dir, file), fullPage: true });
          result[page][vp.name] = `screenshots/${file}`;
        } catch (e) {
          warnings.push(`Screenshot ${page} (${vp.name}) fehlgeschlagen: ${String(e.message).split('\n')[0]}`);
        } finally {
          await ctx.close();
        }
      }
    }
  } finally {
    srv.server.close();
    await browser.close();
  }
  return result;
}

function indexHtml(title, created, entries, what) {
  const items = entries.map((e) => {
    const thumb = e.screenshots.desktop ? `<a class="thumb" href="${esc(e.html || e.screenshots.desktop)}"><img src="${esc(e.screenshots.desktop)}" alt="" loading="lazy"></a>` : '';
    const links = [
      e.html ? `<a class="primary" href="${esc(e.html)}">Seite öffnen</a>` : '',
      e.screenshots.desktop ? `<a href="${esc(e.screenshots.desktop)}">Screenshot Desktop</a>` : '',
      e.screenshots.mobil ? `<a href="${esc(e.screenshots.mobil)}">Screenshot Mobil</a>` : '',
    ].filter(Boolean).join('');
    return `<li>${thumb}<div><h2>${esc(e.title || e.page)}</h2><p class="path">${esc(e.page)}</p><p class="links">${links}</p></div></li>`;
  }).join('\n');
  const how = what === 'bilder'
    ? 'Die Screenshots zeigen jede Seite in voller Länge, einmal in Desktop-Breite (1440 px) und einmal in Mobil-Breite (390 px).'
    : 'Die Seiten öffnen sich direkt im Browser, ohne Webserver. Wie die Seite auf dem Smartphone wirkt, sehen Sie, wenn Sie das Browserfenster schmal ziehen. Bilder werden aus dem Internet geladen; ohne Verbindung fehlen sie.' +
      (what === 'beides' ? ' Zusätzlich gibt es zu jeder Seite Screenshots in Desktop- und Mobil-Breite.' : '');
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} – Entwurfsstand</title>
<style>
body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1f2328;background:#f4f3ef}
header{padding:32px clamp(16px,4vw,48px) 24px;background:#fff;border-bottom:1px solid #e1ded8}
h1{margin:0 0 4px;font-size:26px}
header p{margin:4px 0 0;color:#57606a;max-width:70ch}
ul{list-style:none;margin:0;padding:24px clamp(16px,4vw,48px);display:grid;gap:20px}
li{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start;background:#fff;border:1px solid #e1ded8;border-radius:12px;padding:16px}
.thumb{display:block;width:320px;max-width:100%;height:200px;overflow:hidden;border:1px solid #e1ded8;border-radius:6px;flex:none}
.thumb img{width:100%;display:block}
h2{margin:0;font-size:19px}
.path{margin:2px 0 12px;color:#57606a;font-size:13px}
.links{display:flex;flex-wrap:wrap;gap:8px;margin:0}
.links a{padding:6px 12px;border:1px solid #c9c6bf;border-radius:6px;color:#1f2328;text-decoration:none;font-size:14px}
.links a.primary{background:#0f5d5d;border-color:#0f5d5d;color:#fff}
.links a:hover{border-color:#0f5d5d}
</style>
</head>
<body>
<header><h1>${esc(title)}</h1><p>Entwurfsstand vom ${esc(created)}. ${esc(how)}</p></header>
<ul>
${items}
</ul>
</body>
</html>
`;
}

async function main() {
  const [siteDir, slug, outDir, what] = process.argv.slice(2);
  if (!siteDir || !slug || !outDir || !['beides', 'bilder', 'html'].includes(what)) out({ error: 'Aufruf: share.mjs <siteDir> <slug> <outDir> <beides|bilder|html>' }, 2);
  const pages = sitePages(siteDir);
  if (!pages.length) out({ error: 'Keine Seiten im Projekt' }, 1);
  const warnings = [];
  let site = {};
  try { site = JSON.parse(read(path.join(siteDir, 'site.json'))) || {}; } catch { site = {}; }
  const title = site.title || slug;
  const entries = pages.map((page) => ({ page, title: titleOf(read(path.join(siteDir, 'www', page))), html: null, screenshots: {} }));

  if (what !== 'bilder') {
    const www = path.join(outDir, 'website');
    copyTree(path.join(siteDir, 'www'), www);
    const css = { tokens: read(path.join(siteDir, 'design', 'tokens.css')), overrides: read(path.join(siteDir, 'overrides.css')), components: componentsCss(siteDir) };
    for (const e of entries) {
      const file = path.join(www, e.page);
      fs.writeFileSync(file, standalone(fs.readFileSync(file), css, e.page));
      e.html = `website/${e.page}`;
    }
  }
  if (what !== 'html') {
    const shots = await screenshots(siteDir, slug, outDir, pages, warnings);
    if (!shots && what === 'bilder') out({ error: warnings[0] || 'Screenshots nicht möglich' }, 4);
    if (shots) for (const e of entries) e.screenshots = shots[e.page] || {};
  }
  const created = new Date().toLocaleString('de-DE', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Berlin' });
  fs.writeFileSync(path.join(outDir, 'index.html'), indexHtml(title, created, entries, what));
  out({ pages: entries, warnings });
}

main().catch((e) => out({ error: e.message }, 1));
