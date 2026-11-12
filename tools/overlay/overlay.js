/*
 * Modio Overlay
 * Wird vom Bridge-Server in jede ausgelieferte HTML-Seite eingeschleust.
 * Konfiguration: window.__MODIO__ = { slug, token, base, imageMaxCount, imageMaxMb }
 * Schnittstellen: siehe docs/api.md
 */
(function () {
  'use strict';

  var CFG = window.__MODIO__;
  if (!CFG || !CFG.slug || !CFG.token) return;
  if (window.__MODIO_LOADED__) return;
  window.__MODIO_LOADED__ = true;

  var SLUG = String(CFG.slug);
  var TOKEN = String(CFG.token);
  var BASE = String(CFG.base || '/s/' + SLUG);
  var IMAGE_MAX_COUNT = Number(CFG.imageMaxCount) || 3;
  var IMAGE_MAX_MB = Number(CFG.imageMaxMb) || 10;
  var IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  var ACTIVE = { pending: 1, running: 1, review: 1 };
  var RELOAD_TYPES = { annotate: 1, rollback: 1, decision: 1, 'site-recrawl': 1, 'design-save': 1, 'tokens-propose': 1 };
  // Jobs, die den Stand der Website verändern (der jüngste entscheidet, ob „Nachbessern“ möglich ist)
  var STATE_TYPES = { annotate: 1, rollback: 1, decision: 1, 'site-recrawl': 1, 'design-save': 1, 'tokens-propose': 1 };
  var MAX_HTML = 20000;
  var MAX_TEXT = 2000;
  var FLASH_KEY = 'modio-flash-' + SLUG;

  // ---------------------------------------------------------------- Hilfen

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'text') n.textContent = v;
        else if (k === 'class') n.className = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? '' : v);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  function clear(n) {
    while (n.firstChild) n.removeChild(n.firstChild);
  }

  // Icons aus Lucide (https://lucide.dev, ISC-Lizenz), als SVG-Elemente eingebettet
  var ICONS = {
    click: ['path:M14 4.1 12 6', 'path:m5.1 8-2.9-.8', 'path:m6 12-1.9 2', 'path:M7.2 2.2 8 5.1',
      'path:M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z'],
    history: ['path:M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'path:M3 3v5h5', 'path:M12 7v5l4 2'],
    grid: ['rect:3,3,7,7', 'rect:14,3,7,7', 'rect:14,14,7,7', 'rect:3,14,7,7'],
    x: ['path:M18 6 6 18', 'path:m6 6 12 12'],
    refresh: ['path:M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'path:M21 3v5h-5',
      'path:M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'path:M8 16H3v5'],
    undo: ['path:M9 14 4 9l5-5', 'path:M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11'],
    flag: ['path:M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z', 'path:M4 22v-7'],
    check: ['circle:12,12,10', 'path:m9 12 2 2 4-4'],
    sparkles: ['path:M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z',
      'path:M20 3v4', 'path:M22 5h-4'],
  };
  var SVGNS = 'http://www.w3.org/2000/svg';
  function icon(name, size) {
    var svg = document.createElementNS(SVGNS, 'svg');
    var attrs = { width: size || 16, height: size || 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
      'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'ic' };
    Object.keys(attrs).forEach(function (k) { svg.setAttribute(k, attrs[k]); });
    (ICONS[name] || []).forEach(function (spec) {
      var i = spec.indexOf(':');
      var kind = spec.slice(0, i), val = spec.slice(i + 1), n;
      if (kind === 'path') { n = document.createElementNS(SVGNS, 'path'); n.setAttribute('d', val); }
      else if (kind === 'rect') {
        var r = val.split(','); n = document.createElementNS(SVGNS, 'rect');
        n.setAttribute('x', r[0]); n.setAttribute('y', r[1]); n.setAttribute('width', r[2]); n.setAttribute('height', r[3]); n.setAttribute('rx', 1);
      } else if (kind === 'circle') {
        var c = val.split(','); n = document.createElementNS(SVGNS, 'circle');
        n.setAttribute('cx', c[0]); n.setAttribute('cy', c[1]); n.setAttribute('r', c[2]);
      }
      if (n) svg.appendChild(n);
    });
    return svg;
  }

  // Knopf mit Icon und (optional sichtbarem) Text; Text austauschbar über .modioLabel
  function iconButton(name, text, attrs, iconOnly) {
    var label = el('span', { class: iconOnly ? 'sr' : 'lbl', text: text });
    attrs = attrs || {};
    attrs.type = attrs.type || 'button';
    if (iconOnly && !attrs.title) attrs.title = text;
    var b = el('button', attrs, [icon(name), label]);
    b.classList.add(iconOnly ? 'icon-only' : 'has-icon');
    b.modioLabel = label;
    return b;
  }

  function truncate(s, max) {
    s = String(s == null ? '' : s);
    return s.length > max ? s.slice(0, max) + '…' : s;
  }

  function fmtDate(s) {
    if (!s) return '';
    var d = new Date(s);
    if (isNaN(d)) return String(s);
    return d.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  }

  function api(method, path, body) {
    var opts = { method: method, headers: { 'X-Modio-Token': TOKEN }, credentials: 'same-origin' };
    if (body instanceof FormData) {
      opts.body = body;
    } else if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(path, opts).then(function (res) {
      return res.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = { error: txt }; }
        if (!res.ok) {
          var err = new Error((data && data.error) || ('HTTP ' + res.status));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function currentPage() {
    var p = location.pathname;
    try { p = decodeURIComponent(p); } catch (e) { /* unverändert */ }
    if (p.indexOf(BASE) === 0) p = p.slice(BASE.length);
    if (!p || p.charAt(0) !== '/') p = '/' + p;
    if (p.charAt(p.length - 1) === '/') p += 'index.html';
    return p;
  }

  // ---------------------------------------------------------- Selektoren

  function esc(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function looksGenerated(name) {
    return (
      !name ||
      name.length > 40 ||
      /\d{3,}/.test(name) ||
      /^[0-9]/.test(name) ||
      /[:[\]()]/.test(name) ||
      /^(ember|react|ng-|vue|svelte-|css-|sc-|jsx-|__)/i.test(name) ||
      /[a-z][A-Z0-9]{5,}/.test(name) && /[0-9]/.test(name)
    );
  }

  function isUnique(sel) {
    try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; }
  }

  function segmentFor(node) {
    var tag = node.tagName.toLowerCase();
    var seg = tag;
    var classes = Array.prototype.filter.call(node.classList || [], function (c) {
      return !looksGenerated(c) && c.indexOf('modio') !== 0;
    }).slice(0, 3);
    if (classes.length) seg += '.' + classes.map(esc).join('.');
    var parent = node.parentElement;
    if (parent) {
      var same = Array.prototype.filter.call(parent.children, function (c) {
        try { return c.matches(seg); } catch (e) { return false; }
      });
      if (same.length > 1) {
        var idx = 1;
        var sib = node;
        while ((sib = sib.previousElementSibling)) if (sib.tagName === node.tagName) idx++;
        seg += ':nth-of-type(' + idx + ')';
      }
    }
    return seg;
  }

  function selectorFor(target) {
    if (target.id && !looksGenerated(target.id) && isUnique('#' + esc(target.id))) return '#' + esc(target.id);
    var path = [];
    var node = target;
    while (node && node.nodeType === 1) {
      if (node !== target && node.id && !looksGenerated(node.id) && isUnique('#' + esc(node.id))) {
        path.unshift('#' + esc(node.id));
        var withId = path.join(' > ');
        if (isUnique(withId)) return withId;
        path.shift();
      }
      if (node === document.body || node === document.documentElement) {
        path.unshift(node.tagName.toLowerCase());
      } else {
        path.unshift(segmentFor(node));
      }
      var sel = path.join(' > ');
      if (isUnique(sel) && path.length > 1) return sel;
      if (path.length === 1 && isUnique(sel) && node.tagName !== 'DIV' && node.tagName !== 'SPAN') return sel;
      node = node.parentElement;
    }
    return path.join(' > ');
  }

  function describe(node) {
    if (!node || node.nodeType !== 1) return '';
    var s = node.tagName.toLowerCase();
    if (node.id) s += '#' + node.id;
    var cls = Array.prototype.slice.call(node.classList || [], 0, 3);
    if (cls.length) s += '.' + cls.join('.');
    return truncate(s, 60);
  }

  // ----------------------------------------------------------- Oberfläche

  var host = document.createElement('div');
  host.id = 'modio-overlay-host';
  host.setAttribute('data-modio', '');
  host.setAttribute(
    'style',
    'all:initial !important;position:fixed !important;inset:0 !important;width:100vw !important;height:100vh !important;' +
      'pointer-events:none !important;z-index:2147483647 !important;display:block !important;margin:0 !important;padding:0 !important;' +
      'border:0 !important;background:transparent !important;transform:none !important;'
  );
  var root = host.attachShadow({ mode: 'open' });

  var STYLE =
    ':host{all:initial}' +
    '*{box-sizing:border-box}' +
    '.ui{font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1d2330}' +
    '.hl{position:fixed;pointer-events:none;border:2px solid #2563eb;background:rgba(37,99,235,.10);border-radius:2px;display:none;transition:all .05s}' +
    '.hl.sel{border-color:#d97706;background:rgba(217,119,6,.10)}' +
    '.hl.pv{border:2px dashed #7c3aed;background:rgba(124,58,237,.08);transition:none}' +
    '.hl.pv .hl-label{background:#7c3aed}' +
    '.crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:2px;margin:4px 0 2px}' +
    '.crumbs .sep{color:#9ca3af;padding:0 1px}' +
    '.crumbs button{font:12px/1.3 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:2px 6px;border-radius:5px;border-color:transparent;background:transparent;color:#374151}' +
    '.crumbs button:hover,.crumbs button:focus-visible{background:#ede9fe;border-color:#c4b5fd}' +
    '.crumbs button[aria-current=true]{background:#fef3c7;border-color:#d97706;color:#92400e;font-weight:600}' +
    '.sel-full{color:#6b7280;font-size:11px;margin-top:2px}' +
    '.hl-label{position:absolute;left:-2px;top:-24px;background:#2563eb;color:#fff;font:12px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:4px 6px;border-radius:3px;white-space:nowrap;max-width:60vw;overflow:hidden;text-overflow:ellipsis}' +
    '.hl.sel .hl-label{background:#d97706}' +
    '.hl.below .hl-label{top:auto;bottom:-24px}' +
    '.bar{position:fixed;right:16px;bottom:16px;display:flex;gap:6px;align-items:center;pointer-events:auto;background:#fff;border:1px solid #cfd5df;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.18);padding:6px}' +
    '.brand{font-weight:700;padding:0 6px;color:#2563eb;letter-spacing:.02em}' +
    'button{font:inherit;cursor:pointer;border:1px solid #cfd5df;background:#f6f7f9;color:#1d2330;border-radius:7px;padding:6px 10px}' +
    'button:hover:not([disabled]){background:#eceff3}' +
    'button[disabled]{opacity:.5;cursor:not-allowed}' +
    'button.primary{background:#2563eb;border-color:#2563eb;color:#fff}' +
    'button.primary:hover:not([disabled]){background:#1d4ed8}' +
    'button.danger{background:#fff;border-color:#dc2626;color:#b91c1c}' +
    'button.on{background:#dbeafe;border-color:#2563eb}' +
    'button:focus-visible,textarea:focus-visible,input:focus-visible,summary:focus-visible,.drop:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}' +
    '.status{max-width:280px;padding:0 6px;font-size:13px;color:#4b5563;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.status.running,.status.pending{color:#1d4ed8}' +
    '.status.review{color:#b45309;font-weight:600}' +
    '.status.failed{color:#b91c1c;font-weight:600}' +
    '.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:currentColor;margin-right:6px;vertical-align:middle}' +
    '.running .dot,.pending .dot{animation:pulse 1s infinite alternate}' +
    '@keyframes pulse{from{opacity:.25}to{opacity:1}}' +
    '.panel{position:fixed;right:16px;bottom:72px;width:440px;max-width:calc(100vw - 32px);max-height:calc(100vh - 100px);overflow:auto;pointer-events:auto;background:#fff;border:1px solid #cfd5df;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.25);padding:14px 16px;display:none}' +
    '.panel.wide{width:760px}' +
    '.panel.open{display:block}' +
    '.panel h2{font-size:16px;margin:0 0 8px}' +
    '.meta{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#4b5563;background:#f3f4f6;border-radius:6px;padding:6px 8px;margin-bottom:8px;word-break:break-all}' +
    'textarea{width:100%;min-height:96px;resize:vertical;font:inherit;padding:8px;border:1px solid #cfd5df;border-radius:8px}' +
    'input[type=url]{flex:1;font:inherit;padding:6px 8px;border:1px solid #cfd5df;border-radius:7px;min-width:0}' +
    'label{display:block}' +
    '.row{display:flex;gap:8px;align-items:center;margin-top:8px}' +
    '.row.end{justify-content:flex-end}' +
    '.spacer{flex:1}' +
    '.drop{margin-top:10px;border:2px dashed #cfd5df;border-radius:8px;padding:10px;text-align:center;color:#4b5563;font-size:13px}' +
    '.drop.over{border-color:#2563eb;background:#eff6ff}' +
    '.thumbs{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}' +
    '.thumb{position:relative;width:84px;height:84px;border:1px solid #cfd5df;border-radius:6px;overflow:hidden;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:11px;color:#4b5563;text-align:center}' +
    '.thumb img{width:100%;height:100%;object-fit:cover}' +
    '.thumb button{position:absolute;top:2px;right:2px;padding:0 6px;line-height:20px;border-radius:50%;background:rgba(255,255,255,.92)}' +
    '.thumb .tag{position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.55);color:#fff;font-size:10px;padding:1px 3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.err{color:#b91c1c;font-size:13px;margin-top:6px;white-space:pre-wrap}' +
    '.hint{color:#4b5563;font-size:12px;margin-top:4px}' +
    '.hits{margin:0 0 10px;padding:0;list-style:none}' +
    '.hits li{border-left:3px solid #d97706;background:#fffbeb;padding:4px 8px;margin-bottom:4px;font-size:13px}' +
    '.hits li.warn{border-left-color:#2563eb;background:#eff6ff}' +
    '.hits code{font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all}' +
    'pre.diff{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#0f172a;color:#e2e8f0;border-radius:8px;padding:8px;max-height:45vh;overflow:auto;white-space:pre;margin:0}' +
    'pre.diff .add{color:#86efac;background:rgba(34,197,94,.12);display:block}' +
    'pre.diff .del{color:#fca5a5;background:rgba(239,68,68,.12);display:block}' +
    'pre.diff .hunk{color:#93c5fd;display:block}' +
    'pre.diff .file{color:#fde68a;font-weight:700;display:block}' +
    'pre.diff .ctx{display:block}' +
    '.steps{list-style:none;margin:0;padding:0}' +
    '.step{border:1px solid #e5e7eb;border-radius:8px;padding:8px 10px;margin-bottom:8px}' +
    '.step.current{border-color:#2563eb;box-shadow:0 0 0 1px #2563eb inset}' +
    '.step-head{display:flex;gap:8px;align-items:baseline}' +
    '.step-id{font-weight:700}' +
    '.step-date{color:#6b7280;font-size:12px}' +
    '.badge{font-size:11px;background:#2563eb;color:#fff;border-radius:10px;padding:1px 7px}' +
    '.step-prompt{margin:4px 0;white-space:pre-wrap;word-break:break-word}' +
    '.step-sel{font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#6b7280;word-break:break-all}' +
    'details{margin-top:4px;font-size:13px}' +
    'details p{white-space:pre-wrap;margin:4px 0 0;color:#374151}' +
    '.toast{position:fixed;right:16px;bottom:72px;max-width:440px;pointer-events:auto;background:#1d2330;color:#fff;border-radius:10px;padding:10px 36px 10px 12px;box-shadow:0 8px 28px rgba(0,0,0,.3);display:none;white-space:pre-wrap;font-size:13px}' +
    '.toast.open{display:block}' +
    '.toast.error{background:#991b1b}' +
    '.toast button{position:absolute;top:6px;right:6px;background:transparent;border:0;color:#fff;padding:2px 6px}' +
    '.switch{display:flex;gap:6px;align-items:center;font-size:13px;cursor:pointer}' +
    '.adv{margin-top:8px;font-size:13px}' +
    '.adv summary{color:#4b5563;cursor:pointer}' +
    '.adv .switch{margin-top:6px}' +
    '.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}' +
    '.ic{flex:none;display:block}' +
    'button.has-icon,a.btn{display:inline-flex;align-items:center;gap:6px}' +
    'button.icon-only{display:inline-flex;align-items:center;justify-content:center;padding:6px;width:32px;height:32px}' +
    'button.ghost,a.ghost{background:transparent;border-color:transparent}' +
    'button.ghost:hover:not([disabled]),a.ghost:hover{background:#eceff3}' +
    'a.btn{font:inherit;text-decoration:none;color:#1d2330;border:1px solid #cfd5df;background:#f6f7f9;border-radius:7px;padding:6px 10px}' +
    'a.btn.icon-only{padding:6px;width:32px;height:32px;justify-content:center}' +
    'a.btn:hover{background:#eceff3}' +
    'a:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}' +
    '.brand{display:inline-flex;align-items:center;gap:6px}' +
    '.sep{width:1px;align-self:stretch;background:#e5e7eb;margin:2px 2px}' +
    /* Verlauf als Sidebar links, volle Höhe */
    '.sidebar{position:fixed;top:0;right:0;bottom:0;width:400px;max-width:100vw;pointer-events:auto;background:#fff;border-left:1px solid #cfd5df;box-shadow:-8px 0 32px rgba(0,0,0,.18);display:flex;flex-direction:column;transform:translateX(105%);visibility:hidden;transition:transform .2s ease,visibility 0s linear .2s}' +
    '.sidebar.open{transform:none;visibility:visible;transition:transform .2s ease}' +
    '@media (prefers-reduced-motion:reduce){.sidebar,.sidebar.open{transition:none}}' +
    '.sb-head{display:flex;align-items:center;gap:6px;padding:12px 12px 12px 16px;border-bottom:1px solid #e5e7eb}' +
    '.sb-head h2{font-size:16px;margin:0;display:flex;align-items:center;gap:8px}' +
    '.sb-sub{padding:8px 16px;font-size:12px;color:#6b7280;border-bottom:1px solid #f1f2f4;word-break:break-all}' +
    '.sb-body{flex:1;overflow:auto;padding:14px 16px 24px}' +
    '.sb-foot{border-top:1px solid #e5e7eb;padding:10px 16px;display:flex;gap:8px}' +
    '.sb-foot a.btn{flex:1;justify-content:center}' +
    /* Zeitleiste */
    '.steps{position:relative}' +
    '.steps .step{position:relative;margin-left:22px}' +
    '.steps .step::before{content:"";position:absolute;left:-16px;top:-9px;bottom:-9px;width:2px;background:#e5e7eb}' +
    '.steps .step:first-child::before{top:14px}' +
    '.steps .step:last-child::before{bottom:calc(100% - 14px)}' +
    '.step-dot{position:absolute;left:-22px;top:9px;width:14px;height:14px;border-radius:50%;background:#fff;border:2px solid #9ca3af}' +
    '.step.current .step-dot{border-color:#2563eb;background:#2563eb;box-shadow:0 0 0 3px #dbeafe}' +
    '.step.base .step-dot{border-color:#6b7280}' +
    '.step-head{align-items:center}' +
    '.step-head .ic{color:#6b7280}' +
    '.step .row.end button{font-size:13px;padding:4px 8px}' +
    '.badge{display:inline-flex;align-items:center;gap:3px}' +
    '.step-head .badge .ic{color:#fff}' +
    /* Leiste und Hinweise neben die offene Sidebar schieben */
    '.bar,.toast{transition:right .2s ease}' +
    '.ui.sb-open .bar,.ui.sb-open .toast{right:416px}' +
    '@media (max-width:860px){.ui.sb-open .bar{right:16px;bottom:auto;top:16px;left:16px;right:auto}}';

  root.appendChild(el('style', { text: STYLE }));
  var ui = el('div', { class: 'ui' });
  root.appendChild(ui);

  // Hervorhebung
  var hlLabel = el('div', { class: 'hl-label' });
  var hl = el('div', { class: 'hl' }, [hlLabel]);
  ui.appendChild(hl);
  // Vorschau für die Pfadleiste im Annotationsdialog
  var pvLabel = el('div', { class: 'hl-label' });
  var pv = el('div', { class: 'hl pv' }, [pvLabel]);
  ui.appendChild(pv);

  // Leiste
  var btnSelect = iconButton('click', 'Auswählen', { title: 'Element auswählen (Alt+A)', 'aria-pressed': 'false' });
  var btnHistory = iconButton('history', 'Verlauf', { title: 'Verlauf und Rücksprung', 'aria-expanded': 'false', 'aria-controls': 'modio-history' });
  var btnFollowup = iconButton('refresh', 'Nachbessern', { title: 'Den letzten Schritt in derselben Claude-Session korrigieren' });
  btnFollowup.style.display = 'none';
  var lnkHome = el('a', { class: 'btn icon-only ghost', href: '/', title: 'Zur Übersicht aller Websites', 'aria-label': 'Zur Übersicht' }, [icon('grid')]);
  var statusEl = el('span', { class: 'status', role: 'status', 'aria-live': 'polite' });
  var bar = el('div', { class: 'bar', role: 'toolbar', 'aria-label': 'Modio' }, [
    el('span', { class: 'brand' }, [icon('sparkles'), 'Modio']),
    lnkHome,
    el('span', { class: 'sep', 'aria-hidden': 'true' }),
    btnSelect,
    btnHistory,
    btnFollowup,
    statusEl,
  ]);
  ui.appendChild(bar);

  // Hinweis/Toast
  var toastText = el('span');
  var toastClose = el('button', { type: 'button', 'aria-label': 'Schließen', text: '×' });
  var toast = el('div', { class: 'toast', role: 'alert' }, [toastText, toastClose]);
  ui.appendChild(toast);
  var toastTimer = null;
  toastClose.addEventListener('click', function () { toast.classList.remove('open'); });

  function showToast(msg, isError, sticky) {
    toastText.textContent = msg;
    toast.classList.toggle('error', !!isError);
    toast.classList.add('open');
    clearTimeout(toastTimer);
    if (!sticky) toastTimer = setTimeout(function () { toast.classList.remove('open'); }, 6000);
  }

  // ---------------------------------------------------- Prompt-Dialog

  var pMeta = el('div', { class: 'meta' });
  var pText = el('textarea', { id: 'modio-prompt', placeholder: 'Was soll an diesem Element geändert werden?' });
  var pFile = el('input', { type: 'file', accept: IMAGE_TYPES.join(','), multiple: true, class: 'sr', tabindex: '-1' });
  var pDrop = el('div', { class: 'drop', tabindex: '0', role: 'button' }, [
    'Referenzbilder hierher ziehen, mit Strg+V einfügen oder ',
    el('u', { text: 'Datei wählen' }),
    ' (max. ' + IMAGE_MAX_COUNT + ', je ' + IMAGE_MAX_MB + ' MB, PNG/JPEG/GIF/WebP)',
  ]);
  var pUrl = el('input', { type: 'url', placeholder: 'https://… Bild-URL', 'aria-label': 'Bild-URL' });
  var pUrlAdd = el('button', { type: 'button', text: 'URL hinzufügen' });
  var pThumbs = el('div', { class: 'thumbs' });
  var pThorough = el('input', { type: 'checkbox' });
  var pRemember = el('input', { type: 'checkbox' });
  var pAllowTokens = el('input', { type: 'checkbox' });
  var pTitle = el('h2', { id: 'modio-ph', text: 'Annotation' });
  var pErr = el('div', { class: 'err', role: 'alert' });
  var pCancel = el('button', { type: 'button', text: 'Abbrechen' });
  var pSend = el('button', { type: 'button', class: 'primary', text: 'Absenden' });
  var promptPanel = el('div', { class: 'panel', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'modio-ph' }, [
    pTitle,
    pMeta,
    el('label', { for: 'modio-prompt', class: 'sr', text: 'Prompt' }),
    pText,
    el('div', { class: 'hint', text: 'Strg+Enter sendet ab · Esc schließt' }),
    pDrop,
    pFile,
    el('div', { class: 'row' }, [pUrl, pUrlAdd]),
    pThumbs,
    el('div', { class: 'row' }, [
      el('label', { class: 'switch', title: 'Schritt mit dem gründlicheren Modell ausführen' }, [pThorough, 'gründlich']),
      el('label', { class: 'switch', title: 'Genannte Werte als gesperrte Tokens und die Regel in design/notes.md speichern' }, [pRemember, 'Als Regel merken']),
      el('span', { class: 'spacer' }),
      pCancel,
      pSend,
    ]),
    el('details', { class: 'adv' }, [
      el('summary', { text: 'Erweitert' }),
      el('label', { class: 'switch', title: 'Ohne diesen Haken stoppt die Prüfung jede Änderung an gesperrten Tokens' }, [pAllowTokens, 'Gesperrte Tokens dürfen geändert werden']),
    ]),
    pErr,
  ]);
  ui.appendChild(promptPanel);

  // ---------------------------------------------------- Prüfdialog

  var rInfo = el('div');
  var rHits = el('ul', { class: 'hits' });
  var rDiff = el('pre', { class: 'diff', tabindex: '0', 'aria-label': 'Diff' });
  var rErr = el('div', { class: 'err', role: 'alert' });
  var rClose = el('button', { type: 'button', text: 'Später' });
  var rDiscard = el('button', { type: 'button', class: 'danger', text: 'verwerfen' });
  var rAccept = el('button', { type: 'button', class: 'primary', text: 'übernehmen' });
  var reviewPanel = el('div', { class: 'panel wide', role: 'dialog', 'aria-labelledby': 'modio-rh' }, [
    el('h2', { id: 'modio-rh', text: 'Prüfung nötig' }),
    rInfo,
    rHits,
    rDiff,
    el('div', { class: 'row end' }, [rClose, el('span', { class: 'spacer' }), rDiscard, rAccept]),
    rErr,
  ]);
  ui.appendChild(reviewPanel);

  // ---------------------------------------------------- Verlauf

  var hList = el('ul', { class: 'steps' });
  var hErr = el('div', { class: 'err', role: 'alert' });
  var hClose = iconButton('x', 'Verlauf schließen', { class: 'ghost' }, true);
  var hReload = iconButton('refresh', 'Verlauf aktualisieren', { class: 'ghost' }, true);
  var historyPanel = el('aside', { id: 'modio-history', class: 'sidebar', role: 'complementary', 'aria-labelledby': 'modio-hh' }, [
    el('div', { class: 'sb-head' }, [
      el('h2', { id: 'modio-hh' }, [icon('history', 18), 'Verlauf']),
      el('span', { class: 'spacer' }),
      hReload,
      hClose,
    ]),
    el('div', { class: 'sb-sub', text: SLUG }),
    el('div', { class: 'sb-body' }, [hErr, hList]),
    el('div', { class: 'sb-foot' }, [
      el('a', { class: 'btn', href: '/' }, [icon('grid'), 'Zur Übersicht']),
    ]),
  ]);
  ui.appendChild(historyPanel);

  function mount() {
    (document.documentElement || document.body).appendChild(host);
  }
  if (document.documentElement) mount();
  else document.addEventListener('DOMContentLoaded', mount);

  // ------------------------------------------------------------ Zustand

  var selecting = false;
  var hovered = null;
  var selected = null;
  var childStack = [];
  var pathLeaf = null; // ursprünglich angeklicktes Element (Ende der Pfadleiste)
  var previewed = null;
  var refs = []; // { kind: 'file', file, url } | { kind: 'url', url }
  var jobs = {}; // id -> job
  var seenActive = {}; // id -> true, wenn in dieser Sitzung aktiv gesehen
  var reloading = false;
  var reviewJob = null;

  function activeJob() {
    var list = Object.keys(jobs).map(function (k) { return jobs[k]; }).filter(function (j) {
      return j.slug === SLUG && ACTIVE[j.status];
    });
    list.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    // review hat Vorrang (blockiert), danach running, dann pending
    var order = { review: 0, running: 1, pending: 2 };
    list.sort(function (a, b) { return order[a.status] - order[b.status]; });
    return list[0] || null;
  }

  function isBusy() {
    return !!activeJob();
  }

  var TYPE_LABEL = {
    annotate: 'Annotation',
    rollback: 'Rücksprung',
    decision: 'Entscheidung',
    report: 'Report',
    'site-recrawl': 'Neu einlesen',
    'site-new': 'Abzug',
    'design-save': 'Design-Vorgaben',
    'tokens-propose': 'Token-Vorschläge',
  };

  var followupJob = null; // Annotation, die gerade nachgebessert wird

  // Jüngster fertiger Annotationsschritt, solange danach nichts den Stand verändert hat
  function followupCandidate() {
    var list = Object.keys(jobs).map(function (k) { return jobs[k]; }).filter(function (j) {
      return j.slug === SLUG && STATE_TYPES[j.type];
    });
    list.sort(function (a, b) { return a.id < b.id ? 1 : -1; });
    var j = list[0];
    if (j && j.type === 'decision' && j.status === 'done' && j.params && j.params.action === 'accept') j = jobs[j.params.jobId];
    if (!j || j.type !== 'annotate' || j.status !== 'done') return null;
    var r = j.result || {};
    return (r.status === 'committed' || r.status === 'nochange') && r.annotationId ? j : null;
  }

  var lastFailed = null;

  function renderStatus() {
    var job = activeJob();
    clear(statusEl);
    statusEl.className = 'status';
    statusEl.onclick = null;
    statusEl.style.cursor = '';
    if (job) {
      var label = TYPE_LABEL[job.type] || job.type;
      var txt;
      if (job.status === 'pending') txt = label + ': in Warteschlange';
      else if (job.status === 'running') txt = job.type === 'annotate' ? 'Claude arbeitet …' : label + ' läuft …';
      else txt = 'Prüfung nötig – anzeigen';
      statusEl.classList.add(job.status);
      statusEl.appendChild(el('span', { class: 'dot', 'aria-hidden': 'true' }));
      statusEl.appendChild(document.createTextNode(txt));
      if (job.status === 'review') {
        statusEl.style.cursor = 'pointer';
        statusEl.onclick = function () { openReview(job); };
      }
    } else if (lastFailed) {
      statusEl.classList.add('failed');
      statusEl.appendChild(el('span', { class: 'dot', 'aria-hidden': 'true' }));
      statusEl.appendChild(document.createTextNode('Fehlgeschlagen'));
      statusEl.title = lastFailed.error || '';
    } else {
      statusEl.appendChild(document.createTextNode('bereit'));
    }
    var busy = !!job;
    btnSelect.disabled = busy;
    btnSelect.title = busy ? 'Es läuft noch ein Schritt – bitte warten' : 'Element auswählen (Alt+A)';
    pSend.disabled = busy;
    var fj = followupCandidate();
    btnFollowup.style.display = fj ? '' : 'none';
    btnFollowup.disabled = busy;
    if (fj) btnFollowup.title = 'Schritt ' + fj.result.annotationId + ' in derselben Claude-Session korrigieren';
    if (busy && selecting) stopSelecting();
    renderHistoryButtons();
  }

  // --------------------------------------------------------- Auswahlmodus

  function isOwn(e) {
    if (e.target === host) return true;
    var path = e.composedPath ? e.composedPath() : [];
    return path.indexOf(host) !== -1;
  }

  function placeBox(box, label, node) {
    if (!node || !node.getBoundingClientRect) {
      box.style.display = 'none';
      return;
    }
    var r = node.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = r.left - 2 + 'px';
    box.style.top = r.top - 2 + 'px';
    box.style.width = r.width + 4 + 'px';
    box.style.height = r.height + 4 + 'px';
    box.classList.toggle('below', r.top < 28);
    label.textContent = describe(node) + '  ' + Math.round(r.width) + '×' + Math.round(r.height);
  }

  function placeHighlight(node, isSelected) {
    hl.classList.toggle('sel', !!isSelected);
    placeBox(hl, hlLabel, node);
  }

  function showPreview(node) {
    previewed = node;
    placeBox(pv, pvLabel, node);
  }

  function hidePreview() {
    previewed = null;
    pv.style.display = 'none';
  }

  function refreshHighlight() {
    if (selecting && hovered) placeHighlight(hovered, false);
    else if (selected && promptPanel.classList.contains('open')) placeHighlight(selected, true);
    else hl.style.display = 'none';
    if (previewed && promptPanel.classList.contains('open')) placeBox(pv, pvLabel, previewed);
    else hidePreview();
  }

  function onMove(e) {
    if (!selecting) return;
    if (isOwn(e)) return;
    var t = e.target;
    if (!t || t.nodeType !== 1 || t === hovered) return;
    hovered = t;
    childStack = [];
    placeHighlight(hovered, false);
  }

  function blockEvent(e) {
    if (!selecting || isOwn(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function onClick(e) {
    if (!selecting || isOwn(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    var target = hovered || e.target;
    if (!target || target.nodeType !== 1) return;
    stopSelecting();
    openPrompt(target);
  }

  var BLOCK_EVENTS = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'auxclick', 'touchstart', 'touchend', 'submit'];

  function startSelecting() {
    if (isBusy()) {
      showToast('Es läuft noch ein Schritt. Neue Annotationen sind erst danach möglich.', false);
      return;
    }
    closePanels();
    selecting = true;
    hovered = null;
    btnSelect.classList.add('on');
    btnSelect.setAttribute('aria-pressed', 'true');
    btnSelect.modioLabel.textContent = 'Auswahl beenden';
    document.documentElement.style.cursor = 'crosshair';
  }

  function stopSelecting() {
    selecting = false;
    hovered = null;
    childStack = [];
    btnSelect.classList.remove('on');
    btnSelect.setAttribute('aria-pressed', 'false');
    btnSelect.modioLabel.textContent = 'Auswählen';
    document.documentElement.style.cursor = '';
    refreshHighlight();
  }

  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseover', onMove, true);
  window.addEventListener('click', onClick, true);
  BLOCK_EVENTS.forEach(function (t) { window.addEventListener(t, blockEvent, true); });
  window.addEventListener('scroll', refreshHighlight, true);
  window.addEventListener('resize', refreshHighlight);

  window.addEventListener(
    'keydown',
    function (e) {
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyA' || e.key === 'a' || e.key === 'A')) {
        if (promptPanel.classList.contains('open')) return;
        e.preventDefault();
        e.stopPropagation();
        if (selecting) stopSelecting();
        else startSelecting();
        return;
      }
      if (selecting) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          stopSelecting();
        } else if (e.key === 'ArrowUp' && hovered) {
          e.preventDefault();
          e.stopPropagation();
          var p = hovered.parentElement;
          if (p && p !== document.documentElement) {
            childStack.push(hovered);
            hovered = p;
            placeHighlight(hovered, false);
          }
        } else if (e.key === 'ArrowDown' && childStack.length) {
          e.preventDefault();
          e.stopPropagation();
          hovered = childStack.pop();
          placeHighlight(hovered, false);
        } else if (e.key === 'Enter' && hovered) {
          e.preventDefault();
          e.stopPropagation();
          var t = hovered;
          stopSelecting();
          openPrompt(t);
        }
        return;
      }
      if (e.key === 'Escape' && isOwn(e)) {
        if (promptPanel.classList.contains('open')) closePrompt();
        else if (historyPanel.classList.contains('open')) closeHistory();
        else if (reviewPanel.classList.contains('open')) reviewPanel.classList.remove('open');
      }
    },
    true
  );

  btnSelect.addEventListener('click', function () {
    if (selecting) stopSelecting();
    else startSelecting();
  });

  // --------------------------------------------------------- Prompt-Dialog

  function closePanels() {
    closePrompt();
    closeHistory();
    reviewPanel.classList.remove('open');
  }

  function openPrompt(target) {
    closeHistory();
    reviewPanel.classList.remove('open');
    selected = target;
    pathLeaf = target;
    followupJob = null;
    pTitle.textContent = 'Annotation';
    pRemember.checked = false;
    renderMeta();
    pErr.textContent = '';
    promptPanel.classList.add('open');
    placeHighlight(selected, true);
    setTimeout(function () { pText.focus(); }, 0);
  }

  function closePrompt() {
    promptPanel.classList.remove('open');
    selected = null;
    pathLeaf = null;
    followupJob = null;
    refreshHighlight();
  }

  // Kurzbezeichnung eines Pfadglieds: Tag plus ID oder erste sprechende Klasse
  function crumbLabel(node) {
    var s = node.tagName.toLowerCase();
    if (node.id && !looksGenerated(node.id)) return s + '#' + truncate(node.id, 24);
    var cls = Array.prototype.filter.call(node.classList || [], function (c) {
      return !looksGenerated(c) && c.indexOf('modio') !== 0;
    })[0];
    return cls ? s + '.' + truncate(cls, 24) : s;
  }

  // Nachbessern: Prompt-Dialog für den letzten Schritt, ohne neue Elementauswahl
  function openFollowup(job) {
    if (isBusy()) {
      showToast('Es läuft noch ein Schritt. Bitte warten.', false);
      return;
    }
    if (selecting) stopSelecting();
    closeHistory();
    reviewPanel.classList.remove('open');
    var prm = job.params || {};
    selected = null;
    pathLeaf = null;
    followupJob = job;
    pTitle.textContent = 'Nachbessern ' + job.result.annotationId;
    clear(pMeta);
    pMeta.appendChild(document.createTextNode(prm.page || ''));
    pMeta.appendChild(el('div', { class: 'sel-full', text: prm.selector || '' }));
    pMeta.appendChild(el('div', { class: 'hint', text: 'Bisheriger Auftrag: ' + truncate(prm.prompt || '', 200) }));
    pErr.textContent = '';
    pText.placeholder = 'Was soll am Ergebnis korrigiert werden?';
    promptPanel.classList.add('open');
    var node = null;
    try { if (prm.page === currentPage()) node = document.querySelector(prm.selector); } catch (e) { node = null; }
    if (node) placeHighlight(node, true);
    else hl.style.display = 'none';
    setTimeout(function () { pText.focus(); }, 0);
  }
  btnFollowup.addEventListener('click', function () {
    var fj = followupCandidate();
    if (fj) openFollowup(fj);
  });

  function selectCrumb(node) {
    selected = node;
    hidePreview();
    renderMeta();
    placeHighlight(selected, true);
  }

  // Seite, Pfadleiste (body bis ursprünglich gewähltes Element) und Selektor der aktuellen Auswahl
  function renderMeta() {
    clear(pMeta);
    pMeta.appendChild(document.createTextNode(currentPage()));
    var chain = [];
    for (var n = pathLeaf; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) chain.unshift(n);
    var nav = el('div', { class: 'crumbs', role: 'group', 'aria-label': 'Element-Pfad' });
    chain.forEach(function (node, i) {
      if (i) nav.appendChild(el('span', { class: 'sep', 'aria-hidden': 'true', text: '›' }));
      var b = el('button', { type: 'button', text: crumbLabel(node), title: describe(node) });
      if (node === selected) b.setAttribute('aria-current', 'true');
      b.addEventListener('mouseenter', function () { showPreview(node); });
      b.addEventListener('focus', function () { showPreview(node); });
      b.addEventListener('mouseleave', hidePreview);
      b.addEventListener('blur', hidePreview);
      b.addEventListener('click', function () {
        selectCrumb(node);
        var btns = pMeta.querySelectorAll('.crumbs button'); // nach dem Neuaufbau Fokus halten
        if (btns[i]) btns[i].focus();
        hidePreview();
      });
      nav.appendChild(b);
    });
    pMeta.appendChild(nav);
    pMeta.appendChild(el('div', { class: 'sel-full', text: selectorFor(selected) }));
  }

  function resetPrompt() {
    pText.value = '';
    pUrl.value = '';
    pThorough.checked = false;
    pRemember.checked = false;
    pAllowTokens.checked = false;
    pText.placeholder = 'Was soll an diesem Element geändert werden?';
    refs.forEach(function (r) { if (r.kind === 'file' && r.url) URL.revokeObjectURL(r.url); });
    refs = [];
    renderThumbs();
  }

  function renderThumbs() {
    clear(pThumbs);
    refs.forEach(function (r, i) {
      var label = r.kind === 'file' ? r.file.name || 'Bild' : r.url;
      var img = el('img', { alt: label, referrerpolicy: 'no-referrer' });
      img.addEventListener('error', function () {
        img.remove();
        th.insertBefore(document.createTextNode('Vorschau nicht verfügbar'), th.firstChild);
      });
      img.src = r.url;
      var rm = el('button', { type: 'button', 'aria-label': 'Bild entfernen', title: 'Entfernen', text: '×' });
      rm.addEventListener('click', function () {
        if (r.kind === 'file') URL.revokeObjectURL(r.url);
        refs.splice(i, 1);
        renderThumbs();
      });
      var th = el('div', { class: 'thumb', title: label }, [img, rm, el('span', { class: 'tag', text: r.kind === 'file' ? 'Datei' : 'URL' })]);
      pThumbs.appendChild(th);
    });
    var full = refs.length >= IMAGE_MAX_COUNT;
    pUrlAdd.disabled = full;
    pDrop.style.opacity = full ? '.5' : '';
  }

  function addFile(file) {
    if (refs.length >= IMAGE_MAX_COUNT) return 'Höchstens ' + IMAGE_MAX_COUNT + ' Referenzbilder.';
    if (!file) return null;
    if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name || '')) return 'SVG ist als Referenzbild nicht erlaubt.';
    if (IMAGE_TYPES.indexOf(file.type) === -1) return '„' + (file.name || 'Datei') + '“: nur PNG, JPEG, GIF oder WebP.';
    if (file.size > IMAGE_MAX_MB * 1024 * 1024) return '„' + (file.name || 'Datei') + '“ ist größer als ' + IMAGE_MAX_MB + ' MB.';
    refs.push({ kind: 'file', file: file, url: URL.createObjectURL(file) });
    return null;
  }

  function addFiles(list) {
    var errors = [];
    Array.prototype.forEach.call(list || [], function (f) {
      var err = addFile(f);
      if (err && errors.indexOf(err) === -1) errors.push(err);
    });
    pErr.textContent = errors.join('\n');
    renderThumbs();
  }

  function addUrl() {
    var raw = pUrl.value.trim();
    if (!raw) return;
    pErr.textContent = '';
    if (refs.length >= IMAGE_MAX_COUNT) {
      pErr.textContent = 'Höchstens ' + IMAGE_MAX_COUNT + ' Referenzbilder.';
      return;
    }
    var u;
    try { u = new URL(raw); } catch (e) {
      pErr.textContent = 'Keine gültige URL.';
      return;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      pErr.textContent = 'Nur http- und https-URLs sind erlaubt.';
      return;
    }
    if (/\.svgz?$/i.test(u.pathname)) {
      pErr.textContent = 'SVG ist als Referenzbild nicht erlaubt.';
      return;
    }
    refs.push({ kind: 'url', url: u.href });
    pUrl.value = '';
    renderThumbs();
  }

  pUrlAdd.addEventListener('click', addUrl);
  pUrl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addUrl();
    }
  });
  pDrop.addEventListener('click', function () { if (refs.length < IMAGE_MAX_COUNT) pFile.click(); });
  pDrop.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (refs.length < IMAGE_MAX_COUNT) pFile.click();
    }
  });
  pFile.addEventListener('change', function () {
    addFiles(pFile.files);
    pFile.value = '';
  });
  ['dragenter', 'dragover'].forEach(function (t) {
    promptPanel.addEventListener(t, function (e) {
      e.preventDefault();
      pDrop.classList.add('over');
    });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    promptPanel.addEventListener(t, function () { pDrop.classList.remove('over'); });
  });
  promptPanel.addEventListener('drop', function (e) {
    e.preventDefault();
    var dt = e.dataTransfer;
    if (!dt) return;
    if (dt.files && dt.files.length) {
      addFiles(dt.files);
      return;
    }
    var uri = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').split('\n')[0].trim();
    if (uri) {
      pUrl.value = uri;
      addUrl();
    }
  });
  promptPanel.addEventListener('paste', function (e) {
    var cd = e.clipboardData;
    if (!cd) return;
    var files = [];
    Array.prototype.forEach.call(cd.items || [], function (it) {
      if (it.kind === 'file') {
        var f = it.getAsFile();
        if (f) files.push(f);
      }
    });
    if (!files.length && cd.files && cd.files.length) files = Array.prototype.slice.call(cd.files);
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  });

  pText.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  });
  pSend.addEventListener('click', submit);
  pCancel.addEventListener('click', function () {
    closePrompt();
  });

  function submit() {
    if (!selected && !followupJob) return;
    if (isBusy()) {
      pErr.textContent = 'Es läuft noch ein Schritt. Bitte warten.';
      return;
    }
    var prompt = pText.value.trim();
    if (!prompt) {
      pErr.textContent = 'Bitte einen Prompt eingeben.';
      pText.focus();
      return;
    }
    if (pUrl.value.trim()) {
      addUrl();
      if (pErr.textContent) return;
    }
    var fp = followupJob ? followupJob.params || {} : null;
    var annotation = {
      page: fp ? fp.page : currentPage(),
      selector: fp ? fp.selector : selectorFor(selected),
      html: fp ? fp.html || '' : truncate(selected.outerHTML, MAX_HTML),
      text: fp ? fp.text || '' : truncate((selected.innerText || selected.textContent || '').trim(), MAX_TEXT),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      prompt: prompt,
      thorough: !!pThorough.checked,
      remember: !!pRemember.checked,
      allow_token_change: !!pAllowTokens.checked,
      followup: !!fp,
      followup_of: fp ? followupJob.result.annotationId : null,
      references: refs.filter(function (r) { return r.kind === 'url'; }).map(function (r) {
        return { type: 'url', url: r.url };
      }),
    };
    var fd = new FormData();
    fd.append('annotation', JSON.stringify(annotation));
    refs.forEach(function (r) {
      if (r.kind === 'file') fd.append('images', r.file, r.file.name || 'bild');
    });
    pSend.disabled = true;
    pErr.textContent = '';
    api('POST', '/api/sites/' + encodeURIComponent(SLUG) + '/annotations', fd)
      .then(function (data) {
        if (data && data.job) trackJob(data.job);
        resetPrompt();
        closePrompt();
        showToast('Annotation gesendet.', false);
      })
      .catch(function (err) {
        pErr.textContent =
          err.status === 409 ? 'Für diese Website läuft bereits ein Schritt oder wartet auf Prüfung.' : 'Senden fehlgeschlagen: ' + err.message;
      })
      .then(function () {
        renderStatus();
      });
  }

  // ------------------------------------------------------------- Jobs

  function trackJob(job) {
    if (!job || job.slug !== SLUG) return;
    var prev = jobs[job.id];
    jobs[job.id] = job;
    if (ACTIVE[job.status]) seenActive[job.id] = true;

    if (job.status === 'review' && (!prev || prev.status !== 'review')) {
      openReview(job);
    }
    if (reviewJob && reviewJob.id === job.id && job.status !== 'review') {
      reviewPanel.classList.remove('open');
      reviewJob = null;
    }
    if ((job.status === 'done' || job.status === 'failed') && seenActive[job.id] && (!prev || ACTIVE[prev.status])) {
      onFinished(job);
    }
    renderStatus();
  }

  function onFinished(job) {
    delete seenActive[job.id];
    if (job.status === 'failed') {
      lastFailed = job;
      showToast((TYPE_LABEL[job.type] || job.type) + ' fehlgeschlagen: ' + (job.error || (job.result && job.result.error) || 'unbekannter Fehler'), true, true);
      return;
    }
    lastFailed = null;
    var r = job.result || {};
    var msg = '';
    if (job.type === 'annotate') {
      msg = r.status === 'nochange' ? 'Keine Änderung (' + (r.annotationId || '') + ').' : 'Fertig: ' + (r.annotationId || '');
      if (r.summary) msg += '\n' + truncate(r.summary, 600);
      if (r.warnings && r.warnings.length) {
        msg += '\n\nHinweise der Prüfung:\n' + r.warnings.slice(0, 5).map(function (w) { return '– ' + truncate(w.text || w.rule, 160); }).join('\n');
      }
    } else if (job.type === 'rollback') {
      msg = 'Zurückgesprungen.';
    } else if (job.type === 'decision') {
      msg = job.params && job.params.action === 'discard' ? 'Schritt verworfen.' : 'Schritt übernommen.';
    } else if (job.type === 'report') {
      msg = 'Report erzeugt (CHANGES.md).';
    } else {
      msg = (TYPE_LABEL[job.type] || job.type) + ' fertig.';
    }
    if (RELOAD_TYPES[job.type]) {
      scheduleReload(msg);
    } else {
      showToast(msg, false);
    }
  }

  function scheduleReload(msg) {
    if (msg) {
      try { sessionStorage.setItem(FLASH_KEY, msg); } catch (e) { /* ignorieren */ }
    }
    if (reloading) return;
    reloading = true;
    setTimeout(function () { location.reload(); }, 600);
  }

  function loadJobs() {
    return api('GET', '/api/jobs?slug=' + encodeURIComponent(SLUG))
      .then(function (data) {
        (data && data.jobs ? data.jobs : []).forEach(function (j) {
          if (j.slug !== SLUG) return;
          jobs[j.id] = j;
          if (ACTIVE[j.status]) seenActive[j.id] = true;
        });
        renderStatus();
        var a = activeJob();
        if (a && a.status === 'review') openReview(a);
      })
      .catch(function (err) {
        statusEl.textContent = 'Server nicht erreichbar';
        statusEl.title = err.message;
      });
  }

  function connectEvents() {
    if (!window.EventSource) return;
    var es = new EventSource('/api/events?token=' + encodeURIComponent(TOKEN));
    es.addEventListener('job', function (e) {
      var job;
      try { job = JSON.parse(e.data); } catch (err) { return; }
      if (job && job.job) job = job.job;
      trackJob(job);
    });
    es.addEventListener('reload', function (e) {
      var d = {};
      try { d = JSON.parse(e.data); } catch (err) { /* ignorieren */ }
      if (d.slug === SLUG) scheduleReload(null);
    });
    es.addEventListener('open', function () {
      // nach Verbindungsabbruch Zustand neu abgleichen
      loadJobs();
    });
  }

  // ------------------------------------------------------------ Prüfdialog

  function renderDiff(text) {
    clear(rDiff);
    String(text || '').split('\n').forEach(function (line) {
      var cls = 'ctx';
      if (/^(diff --git|index |\+\+\+ |--- )/.test(line)) cls = 'file';
      else if (line.charAt(0) === '+') cls = 'add';
      else if (line.charAt(0) === '-') cls = 'del';
      else if (line.indexOf('@@') === 0) cls = 'hunk';
      rDiff.appendChild(el('span', { class: cls, text: line || ' ' }));
    });
  }

  function openReview(job) {
    reviewJob = job;
    closePrompt();
    closeHistory();
    var r = job.result || {};
    clear(rInfo);
    rInfo.appendChild(
      el('p', {
        text:
          (r.annotationId ? r.annotationId + ': ' : '') +
          'Die automatische Prüfung hat auffällige Änderungen gefunden. Bitte Diff ansehen und entscheiden.',
      })
    );
    if (r.summary) rInfo.appendChild(el('details', {}, [el('summary', { text: 'Zusammenfassung von Claude' }), el('p', { text: r.summary })]));
    clear(rHits);
    (r.hits || []).forEach(function (h) {
      rHits.appendChild(
        el('li', {}, [
          el('strong', { text: h.rule || 'Treffer' }),
          ' – ',
          el('code', { text: (h.file || '') + (h.line ? ':' + h.line : '') }),
          h.text ? el('div', {}, [el('code', { text: truncate(h.text, 300) })]) : null,
        ])
      );
    });
    (r.warnings || []).forEach(function (w) {
      rHits.appendChild(el('li', { class: 'warn' }, [el('strong', { text: 'Hinweis' }), ' – ', w.text || w.rule]));
    });
    renderDiff(r.diff);
    rErr.textContent = '';
    rAccept.disabled = rDiscard.disabled = false;
    reviewPanel.classList.add('open');
    setTimeout(function () { rDiff.focus(); }, 0);
  }

  function decide(action) {
    if (!reviewJob) return;
    if (action === 'discard' && !window.confirm('Änderungen dieses Schritts wirklich verwerfen?')) return;
    rAccept.disabled = rDiscard.disabled = true;
    api('POST', '/api/jobs/' + encodeURIComponent(reviewJob.id) + '/decision', { action: action })
      .then(function (data) {
        if (data && data.job) trackJob(data.job);
        reviewPanel.classList.remove('open');
      })
      .catch(function (err) {
        rErr.textContent = 'Fehler: ' + err.message;
        rAccept.disabled = rDiscard.disabled = false;
      });
  }

  rAccept.addEventListener('click', function () { decide('accept'); });
  rDiscard.addEventListener('click', function () { decide('discard'); });
  rClose.addEventListener('click', function () { reviewPanel.classList.remove('open'); });

  // --------------------------------------------------------------- Verlauf

  var rollbackButtons = [];

  function renderHistoryButtons() {
    var busy = isBusy();
    rollbackButtons.forEach(function (b) {
      b.disabled = busy || b.getAttribute('data-current') === '1';
    });
  }

  function stepItem(opts) {
    var btn = iconButton('undo', 'zu diesem Stand zurück');
    if (opts.current) btn.setAttribute('data-current', '1');
    btn.addEventListener('click', function () { rollback(opts.target, opts.label); });
    rollbackButtons.push(btn);
    var head = el('div', { class: 'step-head' }, [
      opts.base ? icon('flag', 14) : null,
      el('span', { class: 'step-id', text: opts.label }),
      el('span', { class: 'step-date', text: fmtDate(opts.date) }),
      el('span', { class: 'spacer' }),
      opts.current ? el('span', { class: 'badge' }, [icon('check', 12), 'aktuell']) : null,
    ]);
    var children = [el('span', { class: 'step-dot', 'aria-hidden': 'true' }), head];
    if (opts.prompt) children.push(el('div', { class: 'step-prompt', text: opts.prompt }));
    if (opts.page || opts.selector) children.push(el('div', { class: 'step-sel', text: [opts.page, opts.selector].filter(Boolean).join(' · ') }));
    if (opts.summary) children.push(el('details', {}, [el('summary', { text: 'Zusammenfassung' }), el('p', { text: opts.summary })]));
    children.push(el('div', { class: 'row end' }, [btn]));
    if (opts.current) btn.style.display = 'none';
    return el('li', { class: 'step' + (opts.current ? ' current' : '') + (opts.base ? ' base' : '') }, children);
  }

  function loadHistory() {
    hErr.textContent = '';
    clear(hList);
    rollbackButtons = [];
    hList.appendChild(el('li', { class: 'hint', text: 'Lade …' }));
    api('GET', '/api/sites/' + encodeURIComponent(SLUG) + '/history')
      .then(function (h) {
        clear(hList);
        h = h || {};
        var steps = h.steps || [];
        var head = h.head;
        if (!steps.length) hList.appendChild(el('li', { class: 'hint', text: 'Noch keine Schritte.' }));
        steps
          .slice()
          .reverse()
          .forEach(function (s) {
            hList.appendChild(
              stepItem({
                label: s.id || (s.commit || '').slice(0, 8),
                target: s.id || s.commit,
                date: s.date,
                prompt: s.prompt,
                summary: s.summary,
                page: s.page,
                selector: s.selector,
                current: !!head && s.commit === head,
              })
            );
          });
        hList.appendChild(
          stepItem({
            label: 'Ausgangsstand (baseline)',
            target: 'baseline',
            base: true,
            current: !!head && head === h.baseline,
          })
        );
        renderHistoryButtons();
      })
      .catch(function (err) {
        clear(hList);
        hErr.textContent = 'Verlauf konnte nicht geladen werden: ' + err.message;
      });
  }

  function rollback(target, label) {
    if (isBusy()) {
      showToast('Es läuft noch ein Schritt. Bitte warten.', false);
      return;
    }
    if (!window.confirm('Zum Stand „' + label + '“ zurückspringen?\nSpätere Schritte werden verworfen (als Tag gesichert) und erscheinen nicht mehr im Report.')) return;
    api('POST', '/api/sites/' + encodeURIComponent(SLUG) + '/rollback', { target: target })
      .then(function (data) {
        if (data && data.job) trackJob(data.job);
        closeHistory();
        showToast('Rücksprung angefordert …', false);
      })
      .catch(function (err) {
        hErr.textContent = 'Rücksprung fehlgeschlagen: ' + err.message;
      });
  }

  function closeHistory() {
    historyPanel.classList.remove('open');
    ui.classList.remove('sb-open');
    btnHistory.classList.remove('on');
    btnHistory.setAttribute('aria-expanded', 'false');
  }

  btnHistory.addEventListener('click', function () {
    if (historyPanel.classList.contains('open')) {
      closeHistory();
      return;
    }
    if (selecting) stopSelecting();
    closePrompt();
    reviewPanel.classList.remove('open');
    historyPanel.classList.add('open');
    ui.classList.add('sb-open');
    btnHistory.classList.add('on');
    btnHistory.setAttribute('aria-expanded', 'true');
    loadHistory();
    setTimeout(function () { hClose.focus(); }, 0);
  });
  hClose.addEventListener('click', function () { closeHistory(); });
  hReload.addEventListener('click', loadHistory);

  // ----------------------------------------------------------------- Start

  try {
    var flash = sessionStorage.getItem(FLASH_KEY);
    if (flash) {
      sessionStorage.removeItem(FLASH_KEY);
      showToast(flash, false);
    }
  } catch (e) { /* ignorieren */ }

  renderStatus();
  loadJobs();
  connectEvents();
})();
