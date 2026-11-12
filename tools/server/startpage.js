// Startseite: Liste der Websites, Formular „Neue URL“, Aktionen je Website, Auftragsstatus.
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const dateDe = (iso) => (iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '–');

const domainOf = (u) => { try { return new URL(u).host; } catch { return u; } };

function siteRow(s) {
  return `<tr data-slug="${esc(s.slug)}">
    <td><strong>${esc(s.slug)}</strong><br><a class="muted site-url" href="${esc(s.url)}" title="${esc(s.url)}" rel="noreferrer noopener" target="_blank">${esc(s.host || domainOf(s.url))}</a></td>
    <td class="num">${esc(s.pages ?? '–')}</td>
    <td class="num">${esc(s.steps)}</td>
    <td>${esc(dateDe(s.crawledAt))}</td>
    <td>${esc(dateDe(s.lastChange))}</td>
    <td class="actions">
      <a class="btn primary" href="/s/${esc(s.slug)}/">Öffnen</a>
      <span class="menu-wrap">
        <button class="btn menu-btn" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="menu-${esc(s.slug)}" aria-label="Weitere Aktionen für ${esc(s.slug)}">Aktionen <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
        <span class="menu" id="menu-${esc(s.slug)}" role="menu" hidden>
          <button type="button" role="menuitem" data-action="pages">Seiten hinzufügen</button>
          <button type="button" role="menuitem" data-action="local-commit">Lokale Änderungen übernehmen</button>
          <button type="button" role="menuitem" data-action="recrawl">Neu einlesen</button>
          <button type="button" role="menuitem" data-action="report">Report erzeugen</button>
          ${s.hasReport ? `<a role="menuitem" href="/report/${esc(s.slug)}" target="_blank">Report ansehen</a>` : ''}
        </span>
      </span>
    </td>
  </tr>`;
}

export function renderStartPage({ sites, token }) {
  const rows = sites.length
    ? sites.map(siteRow).join('')
    : '<tr><td colspan="6" class="muted">Noch keine Websites. Lege oben die erste an.</td></tr>';
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Modio</title>
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  :root { --fg:#1d2330; --muted:#667085; --line:#e4e7ec; --bg:#f6f7f9; --accent:#3b5bdb; --err:#c92a2a; --ok:#2b8a3e; --warn:#e67700; }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color:var(--fg); background:var(--bg); }
  header { background:#fff; border-bottom:1px solid var(--line); padding:16px 32px; display:flex; align-items:baseline; gap:16px; }
  header h1 { margin:0; font-size:22px; }
  main { max-width:1200px; margin:0 auto; padding:24px 32px 64px; }
  section { background:#fff; border:1px solid var(--line); border-radius:10px; padding:20px 24px; margin-bottom:24px; }
  h2 { font-size:17px; margin:0 0 12px; }
  label { display:block; font-weight:600; margin:10px 0 4px; }
  input[type=url], input[type=text], textarea { width:100%; padding:8px 10px; border:1px solid #cfd4dc; border-radius:6px; font:inherit; }
  textarea { min-height:90px; font-family: ui-monospace, monospace; font-size:13px; }
  .row { display:grid; grid-template-columns: 2fr 1fr; gap:16px; }
  .btn { display:inline-block; padding:6px 12px; border:1px solid #cfd4dc; border-radius:6px; background:#fff; color:var(--fg); font:inherit; font-size:14px; cursor:pointer; text-decoration:none; margin:2px 0; }
  .btn:hover { background:#f2f4f7; }
  .btn.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  .btn.primary:hover { filter:brightness(1.1); }
  .btn:disabled { opacity:.5; cursor:not-allowed; }
  :focus-visible { outline:3px solid #91a7ff; outline-offset:2px; }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:10px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-size:13px; color:var(--muted); font-weight:600; }
  td.actions { white-space:nowrap; text-align:right; }
  th.actions { text-align:right; }
  .menu-wrap { position:relative; display:inline-block; }
  .menu-btn { display:inline-flex; align-items:center; gap:4px; }
  .menu { position:absolute; right:0; top:calc(100% + 4px); z-index:10; min-width:190px; background:#fff; border:1px solid var(--line); border-radius:8px; box-shadow:0 8px 24px rgba(16,24,40,.14); padding:4px; display:flex; flex-direction:column; text-align:left; }
  .menu[hidden] { display:none; }
  .menu > * { display:block; width:100%; text-align:left; padding:7px 10px; border:0; border-radius:5px; background:none; font:inherit; font-size:14px; color:var(--fg); text-decoration:none; cursor:pointer; }
  .menu > *:hover, .menu > *:focus-visible { background:#f2f4f7; outline:none; }
  .menu > *:focus-visible { box-shadow:inset 0 0 0 2px #91a7ff; }
  .muted.site-url { word-break:normal; }
  .muted { color:var(--muted); font-size:13px; word-break:break-all; }
  #msg { min-height:1.5em; margin-top:10px; }
  .err { color:var(--err); } .ok { color:var(--ok); }
  #jobs td { font-size:14px; }
  #jobs td.when { white-space:nowrap; }
  #jobs .err { font-size:13px; }
  .st { display:inline-block; min-width:110px; font-weight:600; }
  .st-pending { color:var(--muted); } .st-running { color:var(--accent); } .st-review { color:var(--warn); }
  .st-done { color:var(--ok); } .st-failed { color:var(--err); }
  dialog { border:1px solid var(--line); border-radius:10px; padding:20px 24px; width:min(640px, calc(100vw - 32px)); box-shadow:0 12px 40px rgba(0,0,0,.25); }
  dialog::backdrop { background:rgba(16,24,40,.35); }
  dialog h2 { margin-bottom:4px; }
  dialog p.muted { word-break:normal; overflow-wrap:anywhere; }
  dialog .actions { display:flex; justify-content:flex-end; gap:8px; margin-top:12px; }
  details { margin:14px 0 6px; }
  details summary { cursor:pointer; color:var(--muted); list-style:none; display:inline-flex; align-items:center; gap:6px; }
  details summary::-webkit-details-marker { display:none; }
  details summary .chev { transition:transform .15s ease; }
  details[open] summary .chev { transform:rotate(90deg); }
  details[open] summary { margin-bottom:4px; }
  @media (prefers-reduced-motion:reduce) { details summary .chev { transition:none; } }
  label.inline { display:flex; gap:8px; align-items:center; font-weight:400; font-size:14px; margin:0 0 8px; }
  label.inline.below { margin:12px 0 0; }
</style>
</head>
<body>
<header><h1>Modio</h1><span class="muted">Websites lokal optimieren per Element-Annotation und Claude Code</span></header>
<main>
  <section>
    <h2>Neue Website</h2>
    <form id="new-site">
      <div class="row">
        <div><label for="url">URL der Startseite</label><input id="url" name="url" type="url" required placeholder="https://www.example.de/"></div>
        <div><label for="slug">Kurzname (optional)</label><input id="slug" name="slug" type="text" pattern="[a-z0-9][a-z0-9-]{0,62}" placeholder="aus der URL"></div>
      </div>
      <details><summary><svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>Weitere Seiten abziehen (optional)</summary>
        <label for="urls">Seitenliste, eine URL pro Zeile</label>
        <textarea id="urls" name="urls" placeholder="https://www.example.de/leistungen/&#10;https://www.example.de/kontakt/"></textarea>
      </details>
      <p><button class="btn primary" type="submit">Abzug erstellen</button></p>
      <div id="msg" role="status" aria-live="polite"></div>
    </form>
  </section>
  <section>
    <h2>Websites</h2>
    <table>
      <thead><tr><th>Website</th><th class="num">Seiten</th><th class="num">Schritte</th><th>Abzug</th><th>Letzte Änderung</th><th class="actions">Aktionen</th></tr></thead>
      <tbody id="sites">${rows}</tbody>
    </table>
    <label class="inline below"><input type="checkbox" id="keep-design" checked> Beim Neu einlesen Design-Vorgaben (Tokens und Regeln) behalten</label>
  </section>
  <section>
    <h2>Aufträge</h2>
    <table>
      <thead><tr><th>Status</th><th>Auftrag</th><th>Website</th><th>Erstellt</th><th>Details</th></tr></thead>
      <tbody id="jobs"><tr><td colspan="5" class="muted">Lade …</td></tr></tbody>
    </table>
  </section>
</main>
<dialog id="pages-dialog" aria-labelledby="pages-title">
  <form id="pages-form" method="dialog">
    <h2 id="pages-title">Seiten hinzufügen</h2>
    <p class="muted" id="pages-site"></p>
    <label for="pages-urls">Weitere Seiten derselben Website, eine URL pro Zeile</label>
    <textarea id="pages-urls" required></textarea>
    <p class="muted">Bisherige Schritte und Design-Vorgaben bleiben erhalten. Neue Seiten kommen im Originalzustand dazu, die Regeln aus overrides.css und die Tokens gelten auch für sie. Direkte HTML-Änderungen früherer Schritte (z. B. am Header) haben die neuen Seiten noch nicht.</p>
    <div id="pages-msg" class="err" role="alert"></div>
    <div class="actions">
      <button class="btn" type="button" id="pages-cancel">Abbrechen</button>
      <button class="btn primary" type="submit">Seiten laden</button>
    </div>
  </form>
</dialog>
<script>
(() => {
  const TOKEN = ${JSON.stringify(token).replace(/</g, '\\u003c')};
  const LABEL = { 'site-new': 'Neue Website', 'site-recrawl': 'Neu einlesen', annotate: 'Annotation', decision: 'Entscheidung', rollback: 'Rücksprung', report: 'Report', 'design-save': 'Design-Vorgaben', 'tokens-propose': 'Token-Vorschläge', 'pages-add': 'Seiten hinzufügen', 'areas-sync': 'Bereiche angleichen', 'local-commit': 'Lokale Änderungen', 'inspect-apply': 'Inspektor-Änderung' };
  const STATUS = { pending: 'wartet', running: 'läuft', review: 'Prüfung nötig', done: 'fertig', failed: 'fehlgeschlagen' };
  const msg = document.getElementById('msg');
  const jobsEl = document.getElementById('jobs');
  const jobs = new Map();

  async function api(path, opts = {}) {
    const res = await fetch(path, { ...opts, headers: { 'X-Modio-Token': TOKEN, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }
  function say(text, cls) { msg.textContent = text; msg.className = cls || ''; }

  document.getElementById('new-site').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const urls = f.urls.value.split(/\\s+/).map((s) => s.trim()).filter(Boolean);
    try {
      const { job } = await api('/api/sites', { method: 'POST', body: JSON.stringify({ url: f.url.value.trim(), slug: f.slug.value.trim() || undefined, urls }) });
      say('Abzug für ' + job.slug + ' wird erstellt …', 'ok');
      upsert(job);
      f.reset();
    } catch (err) { say(err.message, 'err'); }
  });

  // Aktionsmenü je Website
  let openMenu = null;
  function closeMenu(focusBtn) {
    if (!openMenu) return;
    openMenu.menu.hidden = true;
    openMenu.btn.setAttribute('aria-expanded', 'false');
    if (focusBtn) openMenu.btn.focus();
    openMenu = null;
  }
  function showMenu(btn, focusFirst) {
    closeMenu();
    const menu = document.getElementById(btn.getAttribute('aria-controls'));
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    openMenu = { btn, menu };
    if (focusFirst) menu.querySelector('[role=menuitem]').focus();
  }
  document.getElementById('sites').addEventListener('click', (e) => {
    const mb = e.target.closest('.menu-btn');
    if (!mb) return;
    if (openMenu && openMenu.btn === mb) closeMenu(); else showMenu(mb, e.detail === 0);
  });
  document.addEventListener('click', (e) => { if (openMenu && !e.target.closest('.menu-wrap')) closeMenu(); });
  document.addEventListener('keydown', (e) => {
    const mb = e.target.closest && e.target.closest('.menu-btn');
    if (mb && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); showMenu(mb, true); return; }
    if (!openMenu) return;
    const items = [...openMenu.menu.querySelectorAll('[role=menuitem]')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
    else if (e.key === 'Tab') closeMenu();
  });

  document.getElementById('sites').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const slug = btn.closest('tr').dataset.slug;
    const action = btn.dataset.action;
    closeMenu();
    if (action === 'pages') { openPages(slug); return; }
    const keepDesign = document.getElementById('keep-design').checked;
    if (action === 'recrawl' && !confirm('Website „' + slug + '“ neu einlesen?\\n\\nDer bisherige Stand wird mit Report archiviert, alle Änderungen sind danach nicht mehr aktiv.\\n' +
      (keepDesign ? 'Tokens und Regeln werden übernommen.' : 'Tokens und Regeln werden NICHT übernommen.'))) return;
    btn.disabled = true;
    try {
      const opts = { method: 'POST' };
      if (action === 'recrawl') opts.body = JSON.stringify({ keepDesign });
      const { job } = await api('/api/sites/' + slug + '/' + action, opts);
      upsert(job);
    }
    catch (err) { alert(err.message); }
    finally { btn.disabled = false; }
  });

  // Seiten hinzufügen
  const pagesDialog = document.getElementById('pages-dialog');
  const pagesForm = document.getElementById('pages-form');
  const pagesUrls = document.getElementById('pages-urls');
  const pagesMsg = document.getElementById('pages-msg');
  let pagesSlug = null;
  function openPages(slug) {
    pagesSlug = slug;
    const row = document.querySelector('tr[data-slug="' + CSS.escape(slug) + '"] a.site-url');
    document.getElementById('pages-site').textContent = slug + (row ? ' · ' + row.href : '');
    pagesUrls.placeholder = row ? new URL('weitere-seite/', row.href).href + '\\n' + new URL('kontakt/', row.href).href : '';
    pagesMsg.textContent = '';
    pagesDialog.showModal();
    pagesUrls.focus();
  }
  document.getElementById('pages-cancel').addEventListener('click', () => pagesDialog.close());
  pagesForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const urls = pagesUrls.value.split(/\\s+/).map((s) => s.trim()).filter(Boolean);
    if (!urls.length) { pagesMsg.textContent = 'Bitte mindestens eine URL eintragen.'; return; }
    const btn = pagesForm.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const { job } = await api('/api/sites/' + pagesSlug + '/pages', { method: 'POST', body: JSON.stringify({ urls }) });
      upsert(job);
      pagesUrls.value = '';
      pagesDialog.close();
    } catch (err) { pagesMsg.textContent = err.message; }
    finally { btn.disabled = false; }
  });

  function pagesDetails(r) {
    const parts = [];
    if (r.added?.length) parts.push(r.added.length + ' Seite(n) neu');
    if (r.present?.length) parts.push(r.present.length + ' schon im Abzug');
    if (r.duplicate?.length) parts.push(r.duplicate.length + ' schon in der Liste');
    if (r.failed?.length) parts.push('nicht geladen: ' + r.failed.join(', '));
    if (r.rejected?.length) parts.push('andere Website, ignoriert: ' + r.rejected.join(', '));
    if (r.areas?.changed?.length) parts.push('übernommen: ' + [...new Set(r.areas.changed.flatMap((c) => c.areas))].join(', '));
    if (r.areas?.unclear?.length) parts.push('nicht übernommen (Seiten uneinheitlich): ' + r.areas.unclear.join(', '));
    return parts.join(' · ') || 'keine neuen Seiten';
  }

  const MAX_JOBS = 10;
  function cell(text, cls) { const td = document.createElement('td'); if (cls) td.className = cls; if (text != null) td.textContent = text; return td; }
  function render() {
    const list = [...jobs.values()].sort((a, b) => b.id.localeCompare(a.id)).slice(0, MAX_JOBS);
    jobsEl.textContent = '';
    if (!list.length) { const tr = document.createElement('tr'); const td = cell('Keine Aufträge.', 'muted'); td.colSpan = 5; tr.append(td); jobsEl.append(tr); return; }
    for (const j of list) {
      const tr = document.createElement('tr');
      const status = cell();
      const st = document.createElement('span');
      st.className = 'st st-' + j.status; st.textContent = STATUS[j.status] || j.status;
      status.append(st);
      const details = cell();
      if (j.type === 'annotate' && j.params?.prompt) details.append('„' + j.params.prompt.slice(0, 80) + (j.params.prompt.length > 80 ? '…' : '') + '“');
      if (j.type === 'pages-add' && j.status === 'done' && j.result) details.append(pagesDetails(j.result));
      if ((j.type === 'local-commit' || j.type === 'inspect-apply') && j.status === 'done' && j.result) details.append(j.result.status === 'nochange' ? 'keine Änderungen' : 'übernommen als ' + (j.result.annotationId || ''));
      if ((j.type === 'local-commit' || j.type === 'inspect-apply') && j.status === 'review') details.append('Prüfung nötig – im Overlay entscheiden');
      if (j.type === 'areas-sync' && j.status === 'done' && j.result) details.append((j.result.areas || []).join(', ') + ': ' + ((j.result.changed || []).length ? (j.result.changed || []).length + ' Seite(n) angeglichen' : 'schon gleich'));
      if (j.type === 'report' && j.status === 'done') { const a = document.createElement('a'); a.href = '/report/' + j.slug; a.target = '_blank'; a.textContent = 'Report ansehen'; details.append(a); }
      if (j.error) { const e = document.createElement('div'); e.className = 'err'; e.textContent = j.error; details.append(e); }
      const when = new Date(j.created).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
      tr.append(status, cell(LABEL[j.type] || j.type), cell(j.slug), cell(when, 'when'), details);
      jobsEl.append(tr);
    }
  }
  function upsert(job) { jobs.set(job.id, job); render(); }

  api('/api/jobs').then((d) => { d.jobs.forEach((j) => jobs.set(j.id, j)); render(); }).catch((e) => { jobsEl.textContent = e.message; });
  const es = new EventSource('/api/events?token=' + encodeURIComponent(TOKEN));
  es.addEventListener('job', (e) => upsert(JSON.parse(e.data)));
  // Liste neu laden, aber keine laufende Eingabe verwerfen
  es.addEventListener('sites', () => { if (!document.getElementById('url').value && !document.getElementById('urls').value && !pagesDialog.open) location.reload(); });
})();
</script>
</body>
</html>`;
}
