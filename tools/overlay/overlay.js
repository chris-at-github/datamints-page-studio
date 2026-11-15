/*
 * Modio Overlay
 * Wird vom Bridge-Server in jede ausgelieferte HTML-Seite eingeschleust.
 * Konfiguration: window.__MODIO__ = { slug, token, base, imageMaxCount, imageMaxMb, preview: { draft, version } | null }
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
  // Vorschau eines Entwurfs: Seite mit ersetztem Element, nur ansehen (keine Auswahl, keine Änderungserkennung)
  var PREVIEW = CFG.preview && CFG.preview.draft ? { draft: String(CFG.preview.draft), version: Number(CFG.preview.version), name: String(CFG.preview.name || '') } : null;
  var ACTIVE = { pending: 1, running: 1, review: 1 };
  var RELOAD_TYPES = { annotate: 1, rollback: 1, decision: 1, 'site-recrawl': 1, 'design-save': 1, 'tokens-propose': 1, 'pages-add': 1, 'areas-sync': 1, 'local-commit': 1, 'inspect-apply': 1, 'draft-apply': 1 };
  // Jobs, die den Stand der Website verändern (der jüngste entscheidet, ob „Nachbessern“ möglich ist)
  var STATE_TYPES = { annotate: 1, rollback: 1, decision: 1, 'site-recrawl': 1, 'design-save': 1, 'tokens-propose': 1, 'pages-add': 1, 'areas-sync': 1, 'local-commit': 1, 'inspect-apply': 1, 'draft-apply': 1 };
  var MAX_HTML = 20000;
  var MAX_TEXT = 2000;
  var FLASH_KEY = 'modio-flash-' + SLUG;
  var DRAFT_OPEN_KEY = 'modio-draft-open-' + SLUG;

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
    palette: ['circle:13.5,6.5,.5', 'circle:17.5,10.5,.5', 'circle:8.5,7.5,.5', 'circle:6.5,12.5,.5',
      'path:M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z'],
    lock: ['rect:3,11,18,11', 'path:M7 11V7a5 5 0 0 1 10 0v4'],
    unlock: ['rect:3,11,18,11', 'path:M7 11V7a5 5 0 0 1 9.9-1'],
    trash: ['path:M3 6h18', 'path:M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6', 'path:M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2'],
    pipette: ['path:m2 22 1-1h3l9-9', 'path:M3 21v-3l9-9',
      'path:m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z'],
    plus: ['path:M5 12h14', 'path:M12 5v14'],
    chevron: ['path:m9 18 6-6-6-6'],
    layers: ['path:m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z',
      'path:m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65', 'path:m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65'],
    files: ['path:M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', 'path:M14 2v4a2 2 0 0 0 2 2h4', 'path:M10 13H8', 'path:M16 17H8'],
    pencilSparkles: ['path:M10 3H8', 'path:m15.007 5.008 3.987 3.986', 'path:M20 15v4',
      'path:M21.174 6.813a2.82 2.82 0 0 0-3.986-3.987L3.842 16.175a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
      'path:M22 17h-4', 'path:M4 5v4', 'path:M6 7H2', 'path:M9 2v2'],
    pencil: ['path:M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z', 'path:m15 5 4 4'],
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

  function isUnique(sel, doc) {
    try { return (doc || document).querySelectorAll(sel).length === 1; } catch (e) { return false; }
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

  // Selektor für gleiche Bereiche: ohne Positionsangaben (nth-…), damit er auf allen Seiten passt.
  // Kürzester Pfad aus ID bzw. Tag mit Klassen, dessen erster Treffer das Element ist; sonst null.
  function areaSelectorFor(target) {
    function seg(node) {
      if (node.id && !looksGenerated(node.id)) return '#' + esc(node.id);
      var tag = node.tagName.toLowerCase();
      var classes = Array.prototype.filter.call(node.classList || [], function (c) {
        return !looksGenerated(c) && c.indexOf('modio') !== 0;
      }).slice(0, 2);
      return classes.length ? tag + '.' + classes.map(esc).join('.') : tag;
    }
    var first = function (sel) { try { return document.querySelector(sel); } catch (e) { return null; } };
    var path = [];
    for (var node = target; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentElement) {
      var s = node === document.body ? 'body' : seg(node);
      path.unshift(s);
      var sel = path.join(' > ');
      if (first(sel) === target) return sel;
      if (s.charAt(0) === '#') break; // über eine ID hinaus wird es nicht eindeutiger
    }
    return null;
  }

  function selectorFor(target, doc) {
    doc = doc || document;
    if (target.id && !looksGenerated(target.id) && isUnique('#' + esc(target.id), doc)) return '#' + esc(target.id);
    var path = [];
    var node = target;
    while (node && node.nodeType === 1) {
      if (node !== target && node.id && !looksGenerated(node.id) && isUnique('#' + esc(node.id), doc)) {
        path.unshift('#' + esc(node.id));
        var withId = path.join(' > ');
        if (isUnique(withId, doc)) return withId;
        path.shift();
      }
      if (node === doc.body || node === doc.documentElement) {
        path.unshift(node.tagName.toLowerCase());
      } else {
        path.unshift(segmentFor(node));
      }
      var sel = path.join(' > ');
      if (isUnique(sel, doc) && path.length > 1) return sel;
      if (path.length === 1 && isUnique(sel, doc) && node.tagName !== 'DIV' && node.tagName !== 'SPAN') return sel;
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
    '.crumbs{position:relative;display:flex;flex-wrap:nowrap;align-items:center;gap:0;margin:4px 0 2px;overflow:hidden;white-space:nowrap;scrollbar-width:none}' +
    '.crumbs::-webkit-scrollbar{display:none}' +
    '.crumbs.cl{-webkit-mask-image:linear-gradient(to right,transparent 0,#000 28px);mask-image:linear-gradient(to right,transparent 0,#000 28px)}' +
    '.crumbs.cr{-webkit-mask-image:linear-gradient(to left,transparent 0,#000 28px);mask-image:linear-gradient(to left,transparent 0,#000 28px)}' +
    '.crumbs.cl.cr{-webkit-mask-image:linear-gradient(to right,transparent 0,#000 28px,#000 calc(100% - 28px),transparent 100%);mask-image:linear-gradient(to right,transparent 0,#000 28px,#000 calc(100% - 28px),transparent 100%)}' +
    '.crumbs .csep{flex:none;color:#9ca3af;padding:0 1px;font-size:12px}' +
    '.crumbs button{flex:none;font:12px/1.3 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:1px 4px;border-radius:5px;border-color:transparent;background:transparent;color:#374151}' +
    '.crumbs button:hover,.crumbs button:focus-visible{background:#ede9fe;border-color:#c4b5fd}' +
    '.crumbs button[aria-current=true]{background:#fef3c7;border-color:#d97706;color:#92400e;font-weight:600}' +
    '.sel-full{color:#374151;font-size:11px;margin-top:6px;padding-top:6px;border-top:1px dashed #c4c9d2;word-break:break-all}' +
    '.sel-full.bad{color:#b91c1c}' +
    '.sel-full.bad{color:#b91c1c}' +
    '.sel-full.editable{cursor:text;display:flex;align-items:center}' +
    '.sel-full.editable .sel-edit{margin-left:auto;width:22px;height:22px;padding:3px;flex:none}' +
    '.sel-full .textin{margin-top:4px}' +
    '.sel-lbl{display:inline-block;font:600 10px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;text-transform:uppercase;letter-spacing:.05em;color:#fff;background:#6b7280;border-radius:3px;padding:0 5px;margin-right:6px;white-space:nowrap;flex:none}' +
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
    '.status.preview{color:#5b21b6;font-weight:600}' +
    '.status.failed{color:#b91c1c;font-weight:600}' +
    '.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:currentColor;margin-right:6px;vertical-align:middle}' +
    '.running .dot,.pending .dot{animation:pulse 1s infinite alternate}' +
    '@keyframes pulse{from{opacity:.25}to{opacity:1}}' +
    '.panel{position:fixed;right:16px;bottom:72px;width:440px;max-width:calc(100vw - 32px);max-height:calc(100vh - 100px);overflow:auto;pointer-events:auto;background:#fff;border:1px solid #cfd5df;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.25);padding:14px 16px;display:none}' +
    '.panel.wide{width:760px}' +
    '.panel.prompt{width:520px}' +
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
    'details>summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:4px;color:#4b5563}' +
    '.step details>summary{color:#1d4ed8;font-weight:500}' +
    'details>summary::-webkit-details-marker{display:none}' +
    'details>summary .ic{transition:transform .15s ease}' +
    'details[open]>summary .ic{transform:rotate(90deg)}' +
    '@media (prefers-reduced-motion:reduce){details>summary .ic{transition:none}}' +
    'details p{white-space:pre-wrap;margin:4px 0 0;color:#374151}' +
    '.toast{position:fixed;right:16px;bottom:72px;max-width:440px;pointer-events:auto;background:#1d2330;color:#fff;border-radius:10px;padding:10px 36px 10px 12px;box-shadow:0 8px 28px rgba(0,0,0,.3);display:none;white-space:pre-wrap;font-size:13px}' +
    '.toast.open{display:block}' +
    '.toast.error{background:#991b1b}' +
    '.toast > button{position:absolute;top:6px;right:6px;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,.12);border:0;border-radius:6px;color:#fff;padding:0}' +
    '.toast > button:hover:not([disabled]),.toast > button:focus-visible{background:rgba(255,255,255,.28);color:#fff}' +
    '.switch{display:flex;gap:6px;align-items:center;font-size:13px;cursor:pointer}' +
    '.adv{margin-top:8px;font-size:13px}' +
    '.adv summary{color:#4b5563;cursor:pointer}' +
    '.adv .switch{margin-top:6px}' +
    '.checks{display:flex;flex-direction:column;gap:4px;margin-top:10px}' +
    '.hintrow{margin-top:2px}' +
    'label.fl{font-size:13px;font-weight:600;margin:4px 0 4px}' +
    'input.textin{width:100%;font:inherit;padding:6px 8px;border:1px solid #cfd5df;border-radius:7px}' +
    'input.textin.mono{font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}' +
    'input.textin.bad{border-color:#dc2626;background:#fef2f2}' +
    '.hint.bad{color:#b91c1c}' +
    '.ui.sb-design .panel{right:476px}' +
    '@media (max-width:940px){.ui.sb-design .panel{right:16px}}' +
    '.hintrow .hint{margin:0}' +
    'button.tokbtn{font-size:12px;padding:3px 8px;color:#374151}' +
    '.tokpop{border:1px solid #cfd5df;border-radius:8px;padding:6px;margin-top:4px;background:#fff;box-shadow:0 6px 18px rgba(0,0,0,.12)}' +
    '.tokpop[hidden]{display:none}' +
    '.tokpop input{width:100%;font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:5px 7px;border:1px solid #cfd5df;border-radius:6px}' +
    '.tokpop ul{list-style:none;margin:6px 0 0;padding:0;max-height:180px;overflow:auto}' +
    '.tokpop li{display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:5px;cursor:pointer;font-size:12px}' +
    '.tokpop li[aria-selected=true],.tokpop li:hover{background:#eef2ff}' +
    '.tokpop li code{font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}' +
    '.tokpop li .v{margin-left:auto;color:#6b7280;font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.tokpop .empty{color:#6b7280;font-size:12px;padding:4px 6px}' +
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
    '.sb-foot a.btn,.sb-foot button{flex:1;justify-content:center}' +
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
    '@media (max-width:860px){.ui.sb-open .bar{right:16px;bottom:auto;top:16px;left:16px;right:auto}}' +
    /* Design-Panel */
    '.sidebar.design{width:460px}' +
    '.ui.sb-design .bar,.ui.sb-design .toast{right:476px}' +
    '@media (max-width:940px){.ui.sb-design .bar{right:16px;bottom:auto;top:16px;left:16px;right:auto}}' +
    '.hl.pick{border-color:#059669;background:rgba(5,150,105,.10)}' +
    '.hl.pick .hl-label{background:#059669}' +
    '.dsec{margin-bottom:18px}' +
    '.design .sb-body .dsec{border-top:1px solid #9ca3af;padding-top:14px}' +
    '.design .sb-body > div:empty + section.dsec,.design .sb-body > div > .dsec:first-child{border-top:0;padding-top:0}' +
    '.dsec h3{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin:0 0 6px;display:flex;align-items:center;gap:6px}' +
    'table.tok{width:100%;border-collapse:collapse;font-size:13px}' +
    'table.tok td{padding:3px 2px;vertical-align:middle;border-bottom:1px solid #f1f2f4}' +
    'table.tok td.k{font:12px/1.3 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all;width:40%}' +
    'table.tok td.k .sw{margin-right:6px}' +
    'table.tok td.b{width:30px;text-align:center}' +
    'table.tok input,.addrow input,.addrow select{width:100%;font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:4px 6px;border:1px solid #cfd5df;border-radius:6px;min-width:0;background:#fff}' +
    'table.tok input.bad,.addrow input.bad{border-color:#dc2626;background:#fef2f2}' +
    'table.tok button,.pick-row button{padding:3px;width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center}' +
    'button.lock[aria-pressed=true]{color:#b45309;background:#fef3c7;border-color:#f59e0b}' +
    '.sw{display:inline-block;width:14px;height:14px;border-radius:4px;border:1px solid rgba(0,0,0,.25);vertical-align:-2px;flex:none}' +
    '.addrow{display:grid;grid-template-columns:96px 1fr 1fr 32px;gap:4px;margin-top:8px}' +
    '.addrow button{padding:0;display:inline-flex;align-items:center;justify-content:center}' +
    '.chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}' +
    '.chips button{font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:2px 7px;border-radius:10px;display:inline-flex;align-items:center;gap:4px}' +
    '.chips-label{font-size:12px;color:#6b7280;margin-top:8px}' +
    '.pickbox{border:1px solid #a7f3d0;border-radius:8px;padding:8px 10px;margin-top:8px;background:#ecfdf5}' +
    '.pick-head{display:flex;align-items:center;gap:6px;font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#065f46;margin-bottom:4px;word-break:break-all}' +
    '.pick-row{display:flex;align-items:center;gap:6px;font-size:12px;padding:2px 0}' +
    '.pick-row .lbl2{width:92px;flex:none;color:#374151}' +
    '.pick-row code{flex:1;font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all}' +
    '.pick-row .is{font-size:11px;color:#065f46;background:#d1fae5;border-radius:10px;padding:1px 6px;white-space:nowrap}' +
    'textarea.notes{min-height:170px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}' +
    '.dirty{font-size:12px;color:#b45309;align-self:center}' +
    'select:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}' +
    'ul.areas{list-style:none;margin:0;padding:0}' +
    '.logpop{position:fixed;right:16px;bottom:72px;width:560px;max-width:calc(100vw - 32px);pointer-events:auto;background:#0f172a;color:#e2e8f0;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.35);display:none;overflow:hidden}' +
    '.logpop.open{display:block}' +
    '.loghead{font-size:12px;font-weight:600;color:#93c5fd;padding:8px 12px;border-bottom:1px solid #1e293b}' +
    '.logbody{max-height:45vh;overflow:auto;padding:8px 12px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}' +
    '.logline{white-space:pre-wrap;word-break:break-word}' +
    '.logbody .hint{color:#94a3b8}' +
    '.ui.sb-open .logpop{right:416px}' +
    '.ui.sb-design .logpop{right:476px}' +
    '.sidebar.drafts{width:500px}' +
    '.ui.sb-drafts .bar,.ui.sb-drafts .toast,.ui.sb-drafts .logpop,.ui.sb-drafts .panel{right:516px}' +
    '@media (max-width:980px){.ui.sb-drafts .bar{right:16px;bottom:auto;top:16px;left:16px;right:auto}}' +
    '.drafts .sb-body .dsec{border-top:1px solid #9ca3af;padding-top:14px;margin-top:14px;margin-bottom:0}' +
    '.drafts .dhead{margin-bottom:4px}' +
    '.drafts .dstate{display:inline-block;font-size:11px;font-weight:600;border-radius:4px;padding:1px 6px;background:#f3f4f6;color:#4b5563;margin-top:4px}' +
    'ul.pglist{list-style:none;margin:8px 0 6px;padding:0;max-height:50vh;overflow:auto}' +
    'ul.pglist li{display:flex;align-items:center;gap:6px;border-bottom:1px solid #f1f2f4}' +
    'a.pglink{flex:1;min-width:0;display:block;padding:6px 8px;border-radius:6px;color:#1d2330;text-decoration:none}' +
    'a.pglink:hover,a.pglink:focus-visible{background:#eef2ff}' +
    'a.pglink.current{background:#dbeafe}' +
    '.pgtitle{display:block;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.pgpath{display:block;font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    'button.icon-only{position:relative}' +
    'button .cnt{position:absolute;top:-6px;right:-6px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#dc2626;color:#fff;font:700 10px/16px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;text-align:center;box-shadow:0 0 0 2px #fff}' +
    'button.queue{background:#2563eb;border-color:#2563eb;color:#fff}' +
    'button.queue:hover:not([disabled]){background:#1d4ed8}' +
    'ul.qlist{list-style:none;margin:0 0 6px;padding:0;max-height:45vh;overflow:auto}' +
    'ul.qlist li{display:flex;gap:8px;align-items:flex-start;padding:7px 0;border-bottom:1px solid #e5e7eb}' +
    'ul.qlist .qn{flex:none;width:20px;height:20px;border-radius:50%;background:#e0e7ff;color:#3730a3;font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;margin-top:1px}' +
    'ul.qlist .qbody{flex:1;min-width:0}' +
    'ul.qlist .qprompt{white-space:pre-wrap;word-break:break-word;font-size:13px}' +
    'ul.qlist li > button{padding:3px;width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;flex:none}' +
    'button.changes{background:#fef3c7;border-color:#f59e0b;color:#92400e}' +
    'button.changes:hover:not([disabled]){background:#fde68a}' +
    'ul.chlist,ul.flist{list-style:none;margin:0;padding:0}' +
    'ul.flist li{font-size:12px;padding:1px 0}' +
    '.chitem{border-bottom:1px solid #e5e7eb;padding:6px 0}' +
    '.chitem .switch code{font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all}' +
    '.chitem .switch .hint{margin:0 0 0 6px}' +
    '.chitem pre.diff{max-height:30vh;margin-top:4px}' +
    'ul.areas li{display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #f1f2f4;font-size:13px}' +
    'ul.areas li strong{flex:none}' +
    'ul.areas li code{flex:1;font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#6b7280;word-break:break-all}' +
    'ul.areas li button{padding:3px;width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center}' +
    /* Entwürfe */
    'ul.dlist{list-style:none;margin:8px 0 0;padding:0}' +
    'ul.dlist li{margin-bottom:6px}' +
    'button.ditem{width:100%;text-align:left;display:flex;flex-direction:column;gap:2px;background:#fff;padding:8px 10px}' +
    'button.ditem:hover:not([disabled]){background:#f5f3ff;border-color:#c4b5fd}' +
    'button.ditem.applied{opacity:.7}' +
    '.ditem-head{display:flex;gap:8px;align-items:baseline;width:100%}' +
    '.ditem-head .badge{font-size:11px;color:#065f46;background:#d1fae5;border-radius:10px;padding:1px 7px}' +
    '.dver{font-size:11px;color:#6b7280}' +
    '.vtabs{display:flex;flex-wrap:wrap;gap:4px;margin:10px 0 2px}' +
    '.vtabs button,.seg button{padding:3px 9px;font-size:12px}' +
    '.vtabs button[aria-pressed=true],.seg button[aria-pressed=true]{background:#ede9fe;border-color:#7c3aed;color:#5b21b6;font-weight:600}' +
    '.vprompt{font-size:12px;color:#4b5563;margin-top:8px;white-space:pre-wrap}' +
    '.dsum{white-space:pre-wrap;font-size:13px;margin:6px 0 0}' +
    '.bst-row{display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #f1f2f4;font-size:13px}' +
    '.bst-row > span:first-child{flex:1}' +
    '.bst-row.changed > span:first-child{font-weight:600;color:#5b21b6}' +
    '.seg{display:inline-flex;gap:0}' +
    '.seg button{border-radius:0;margin-left:-1px}' +
    '.seg button:first-child{border-radius:6px 0 0 6px;margin-left:0}' +
    '.seg button:last-child{border-radius:0 6px 6px 0}' +
    '.dactions{margin-top:14px;padding-top:10px;border-top:1px solid #e5e7eb}' +
    '.bst-live{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#059669;margin-right:4px}' +
    'ul.nlist{list-style:none;margin:8px 0 0;padding:0}' +
    'ul.nlist li{border:1px solid #e5e7eb;border-radius:8px;padding:6px 8px;margin-bottom:6px}' +
    'ul.nlist li:hover{border-color:#d97706}' +
    '.nhead{display:flex;align-items:center;gap:6px;font-size:12px}' +
    '.nhead code{font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#374151;word-break:break-all}' +
    '.nhead .nsnip{color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}' +
    '.nhead button{padding:3px;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;flex:none}' +
    'textarea.ndesc{min-height:52px;margin-top:4px;font-size:13px}' +
    '.bf-group{font-size:12px;font-weight:600;color:#374151;margin:10px 0 2px}' +
    '.bf-item{display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid #f1f2f4;font-size:13px}' +
    '.bf-main{flex:1;min-width:0}' +
    '.bf-item strong{display:block;font-weight:600}' +
    '.bf-item .bf-text{display:block;color:#4b5563;font-size:12px;white-space:pre-wrap}' +
    '.bf-item.open strong{color:#b45309}' +
    '.bf-item.changed{background:#f5f3ff}' +
    '.bf-state{display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;border-radius:4px;padding:0 5px;margin:2px 0 3px;white-space:nowrap}' +
    'details.bfdet > summary{display:flex;align-items:center;gap:4px;cursor:pointer;list-style:none}' +
    'details.bfdet > summary::-webkit-details-marker{display:none}' +
    'details.bfdet > summary h3{margin:0}' +
    'details.bfdet > summary .ic{transition:transform .15s;color:#6b7280}' +
    'details.bfdet[open] > summary .ic{transform:rotate(90deg)}' +
    '.vright{margin-left:auto;display:inline-flex;gap:4px}' +
    'button.exitbtn{border-color:#c4b5fd;color:#5b21b6}' +
    '.bf-state.done{color:#065f46;background:#d1fae5}' +
    '.bf-state.todo{color:#92400e;background:#fef3c7}' +
    'button.bf-act{flex:none;font-size:12px;padding:2px 8px;white-space:nowrap}' +
    'button.bf-act[aria-pressed=true]{background:#ede9fe;border-color:#7c3aed;color:#5b21b6;font-weight:600}';

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
  // Außer „Auswählen“ nur Icons; das Label erscheint als Tooltip (title) und für Screenreader
  var btnHistory = iconButton('history', 'Verlauf', { 'aria-expanded': 'false', 'aria-controls': 'modio-history' }, true);
  var btnPages = iconButton('files', 'Seiten', { 'aria-expanded': 'false', 'aria-controls': 'modio-pages' }, true);
  var btnDesign = iconButton('palette', 'Design', { 'aria-expanded': 'false', 'aria-controls': 'modio-design' }, true);
  var btnChanges = iconButton('check', 'Änderungen übernehmen', { class: 'changes' }, true);
  btnChanges.modioCount = el('span', { class: 'cnt', 'aria-hidden': 'true' });
  btnChanges.appendChild(btnChanges.modioCount);
  btnChanges.style.display = 'none';
  var btnFollowup = iconButton('refresh', 'Nachbessern', {}, true);
  btnFollowup.style.display = 'none';
  var lnkHome = el('a', { class: 'btn icon-only ghost', href: '/', title: 'Zur Übersicht aller Websites', 'aria-label': 'Zur Übersicht' }, [icon('grid')]);
  var statusEl = el('span', { class: 'status', role: 'status', 'aria-live': 'polite' });
  var bar = el('div', { class: 'bar', role: 'toolbar', 'aria-label': 'Modio' }, [
    el('span', { class: 'brand' }, [icon('sparkles'), 'Modio']),
    lnkHome,
    el('span', { class: 'sep', 'aria-hidden': 'true' }),
    btnSelect,
    btnHistory,
    btnPages,
    btnDesign,
    btnFollowup,
    btnChanges,
    statusEl,
  ]);
  ui.appendChild(bar);

  // Hinweis/Toast
  var toastText = el('span');
  var toastClose = el('button', { type: 'button', 'aria-label': 'Schließen', title: 'Schließen' }, [icon('x', 14)]);
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
  pThorough.checked = true; // Standard: stärkeres Modell
  var pTitle = el('h2', { id: 'modio-ph', text: 'Annotation' });
  var pErr = el('div', { class: 'err', role: 'alert' });
  var pCancel = el('button', { type: 'button', text: 'Abbrechen' });
  var pSend = el('button', { type: 'button', text: 'Direkt umsetzen', title: 'Sofort als eigenen Schritt mit Claude umsetzen (Strg+Umschalt+Enter)' });
  var pQueue = el('button', { type: 'button', class: 'primary', text: 'In die Queue aufnehmen', title: 'Sammeln und später zusammen mit weiteren Annotationen in einem Schritt umsetzen (Strg+Enter)' });
  var pDraft = iconButton('pencilSparkles', 'Entwurf erstellen', { title: 'Claude gestaltet das Element ohne Altlasten als eigene Komponente neu. Erst „Übernehmen“ ändert die Website. (Strg+Alt+Enter)' });
  var pTokBtn = iconButton('palette', 'Token einfügen', { class: 'ghost tokbtn', 'aria-expanded': 'false', 'aria-controls': 'modio-tokpop', title: 'Design-Token in den Prompt einfügen (Strg+Leertaste)' });
  var pTokFilter = el('input', { type: 'text', placeholder: 'Token suchen …', 'aria-label': 'Token suchen', spellcheck: 'false' });
  var pTokList = el('ul', { role: 'listbox', 'aria-label': 'Design-Tokens' });
  var pTokPop = el('div', { id: 'modio-tokpop', class: 'tokpop', hidden: '' }, [pTokFilter, pTokList]);
  var promptPanel = el('div', { class: 'panel prompt', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'modio-ph' }, [
    pTitle,
    pMeta,
    el('label', { for: 'modio-prompt', class: 'sr', text: 'Prompt' }),
    pText,
    el('div', { class: 'row hintrow' }, [el('span', { class: 'hint', text: 'Strg+Enter: Queue · Strg+Umschalt+Enter: direkt · Esc schließt' }), el('span', { class: 'spacer' }), pTokBtn]),
    pTokPop,
    pDrop,
    pFile,
    el('div', { class: 'row' }, [pUrl, pUrlAdd]),
    pThumbs,
    el('div', { class: 'checks' }, [
      el('label', { class: 'switch', title: 'Nimmt Opus statt Sonnet: besser bei kniffligen oder seitenübergreifenden Änderungen, aber langsamer und teurer' }, [pThorough, 'Stärkeres Modell für komplexe Änderungen']),
    ]),
    pErr,
    el('div', { class: 'row end' }, [pCancel, el('span', { class: 'spacer' }), pDraft, pSend, pQueue]),
  ]);
  ui.appendChild(promptPanel);


  // ---------------------------------------------------- Bereichsdialog (gleicher Bereich)

  var aMeta = el('div', { class: 'meta' });
  var aName = el('input', { id: 'modio-area-name', type: 'text', class: 'textin', spellcheck: 'false', maxlength: '60' });
  var aErr = el('div', { class: 'err', role: 'alert' });
  var aCancel = el('button', { type: 'button', text: 'Abbrechen' });
  var aSave = el('button', { type: 'button', class: 'primary', text: 'Übernehmen' });
  var areaPanel = el('div', { class: 'panel', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'modio-ah' }, [
    el('h2', { id: 'modio-ah', text: 'Gleichen Bereich festlegen' }),
    aMeta,
    el('label', { for: 'modio-area-name', class: 'fl', text: 'Name des Bereichs' }),
    aName,
    el('div', { class: 'hint', text: 'Der Bereich wird in die Liste aufgenommen, die Seiten bleiben unverändert. Angleichen mit „Für alle Seiten übernehmen“; spätere Änderungen daran überträgt Modio automatisch.' }),
    aErr,
    el('div', { class: 'row end' }, [aCancel, aSave]),
  ]);
  ui.appendChild(areaPanel);

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

  // ---------------------------------------------------- Design-Vorgaben

  var CAT_LABEL = { color: 'Farbe', font: 'Schrift', size: 'Größe', radius: 'Radius', space: 'Abstand', shadow: 'Schatten', breakpoint: 'Breakpoint' };
  var CATS = Object.keys(CAT_LABEL);
  var dErr = el('div', { class: 'err', role: 'alert' });
  var dInfo = el('div');
  var dWarn = el('div');
  var dTokBody = el('tbody');
  var dTable = el('table', { class: 'tok' }, [dTokBody]);
  var dAddCat = el('select', { 'aria-label': 'Kategorie' }, CATS.map(function (c) { return el('option', { value: c, text: CAT_LABEL[c] }); }));
  var dAddName = el('input', { type: 'text', placeholder: 'name', 'aria-label': 'Token-Name', spellcheck: 'false' });
  var dAddVal = el('input', { type: 'text', placeholder: 'Wert', 'aria-label': 'Token-Wert', spellcheck: 'false' });
  var dAddBtn = iconButton('plus', 'Token hinzufügen', {}, true);
  var dPick = iconButton('pipette', 'Aus Element übernehmen', { title: 'Element anklicken und dessen Farbe, Schrift oder Radius als Token übernehmen', 'aria-pressed': 'false' });
  var dPropose = iconButton('sparkles', 'Aus Abzug ableiten', { title: 'Claude schlägt Tokens aus den häufigsten Werten im Abzug vor (ungesperrt)' });
  var dPickBox = el('div');
  var dAreas = el('ul', { class: 'areas' });
  var dAreaPick = iconButton('click', 'Auswählen', { title: 'Element auf der Seite anklicken (Pfeil hoch wählt das Elternelement); es wird als gleicher Bereich gemerkt und auf alle Seiten übertragen', 'aria-pressed': 'false' });
  var dAreasSync = el('button', { type: 'button', text: 'Für alle Seiten übernehmen', title: 'Kopiert alle gleichen Bereiche von der aktuell geöffneten Seite auf alle anderen Seiten (ohne Claude)' });
  var dScan = el('div');
  var dNotes = el('textarea', { id: 'modio-notes', class: 'notes', spellcheck: 'true' });
  var dDirty = el('span', { class: 'dirty', 'aria-live': 'polite' });
  var dReset = el('button', { type: 'button', text: 'Zurücksetzen' });
  var dSave = el('button', { type: 'button', class: 'primary', text: 'Speichern' });
  var dClose = iconButton('x', 'Design schließen', { class: 'ghost' }, true);
  var dReload = iconButton('refresh', 'Neu laden', { class: 'ghost' }, true);
  var designPanel = el('aside', { id: 'modio-design', class: 'sidebar design', role: 'complementary', 'aria-labelledby': 'modio-dh' }, [
    el('div', { class: 'sb-head' }, [
      el('h2', { id: 'modio-dh' }, [icon('palette', 18), 'Design-Vorgaben']),
      el('span', { class: 'spacer' }),
      dReload,
      dClose,
    ]),
    el('div', { class: 'sb-sub', text: SLUG }),
    el('div', { class: 'sb-body' }, [
      dErr,
      dInfo,
      dWarn,
      el('section', { class: 'dsec', 'aria-labelledby': 'modio-dt' }, [
        el('h3', { id: 'modio-dt', text: 'Tokens' }),
        dTable,
        el('div', { class: 'addrow' }, [dAddCat, dAddName, dAddVal, dAddBtn]),
        el('div', { class: 'row' }, [dPick, dPropose]),
        dPickBox,
        dScan,
      ]),
      el('section', { class: 'dsec', 'aria-labelledby': 'modio-da' }, [
        el('h3', { id: 'modio-da', text: 'Gleiche Bereiche' }),
        dAreas,
        el('div', { class: 'row' }, [dAreaPick, dAreasSync]),
        el('div', { class: 'hint', text: 'Bereiche, die auf allen Seiten gleich sein müssen. Ändert ein Schritt einen davon, überträgt Modio die Änderung automatisch auf alle Seiten.' }),
      ]),
      el('section', { class: 'dsec' }, [
        el('h3', {}, [el('label', { for: 'modio-notes', text: 'Regeln (notes.md)' })]),
        dNotes,
        el('div', { class: 'hint', text: 'Regeln in Prosa, keine URLs, kein HTML, kein Code. Claude hält sich bei jedem Schritt daran.' }),
      ]),
    ]),
    el('div', { class: 'sb-foot' }, [dDirty, el('span', { class: 'spacer' }), dReset, dSave]),
  ]);
  ui.appendChild(designPanel);

  function mount() {
    (document.documentElement || document.body).appendChild(host);
  }
  if (document.documentElement) mount();
  else document.addEventListener('DOMContentLoaded', mount);

  // ------------------------------------------------------------ Zustand

  var selecting = false;
  var selectMode = 'annotate'; // 'annotate' öffnet den Prompt, 'token' liest Werte, 'area' nimmt einen gleichen Bereich auf
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
    'pages-add': 'Seiten hinzufügen',
    'areas-sync': 'Bereiche angleichen',
    'local-commit': 'Lokale Änderungen',
    'inspect-apply': 'Inspektor-Änderung',
    draft: 'Entwurf',
    'draft-apply': 'Entwurf übernehmen',
    'draft-discard': 'Entwurf verwerfen',
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
    statusEl.removeAttribute('tabindex');
    statusEl.title = '';
    if (typeof hideLog === 'function' && logPop && !(job && job.status === 'running')) hideLog(true);
    statusEl.style.cursor = '';
    if (job) {
      var label = TYPE_LABEL[job.type] || job.type;
      var txt;
      if (job.status === 'pending') txt = label + ': in Warteschlange';
      else if (job.status === 'running') txt = job.type === 'annotate' ? 'Claude arbeitet …' : job.type === 'draft' ? 'Claude entwirft …' : label + ' läuft …';
      else txt = 'Prüfung nötig – anzeigen';
      statusEl.classList.add(job.status);
      statusEl.appendChild(el('span', { class: 'dot', 'aria-hidden': 'true' }));
      statusEl.appendChild(document.createTextNode(txt));
      if (job.status === 'review') {
        statusEl.style.cursor = 'pointer';
        statusEl.onclick = function () { openReview(job); };
      }
      if (job.status === 'running') {
        statusEl.setAttribute('tabindex', '0');
        statusEl.style.cursor = 'help';
        statusEl.title = 'Überfahren zeigt die laufende Ausgabe';
      }
    } else if (lastFailed) {
      statusEl.classList.add('failed');
      statusEl.appendChild(el('span', { class: 'dot', 'aria-hidden': 'true' }));
      statusEl.appendChild(document.createTextNode('Fehlgeschlagen'));
      statusEl.title = lastFailed.error || '';
    } else if (PREVIEW && typeof pvLive !== 'undefined') {
      statusEl.classList.add('preview');
      statusEl.appendChild(document.createTextNode(pvLive.shown ? 'Vorschau ' + PREVIEW.draft + ' · v' + pvLive.shown : 'Vorschau ' + PREVIEW.draft + ' · aktuelle Seite'));
      statusEl.title = 'Entwurfs-Vorschau (Klick öffnet das Panel). Taste V wechselt zwischen Entwurf und aktueller Seite.';
      statusEl.style.cursor = 'pointer';
      statusEl.onclick = function () { openDrafts(PREVIEW.draft, pvLive.shown || null, true); };
    } else {
      statusEl.appendChild(document.createTextNode('bereit'));
    }
    var busy = !!job;
    btnSelect.disabled = false; // auch während eines Schritts: Annotationen können in die Queue
    btnSelect.title = busy ? 'Element auswählen (Alt+A) – während der Schritt läuft nur in die Queue' : 'Element auswählen (Alt+A)';
    pSend.disabled = busy;
    pQueue.style.display = followupJob ? 'none' : '';
    pDraft.style.display = followupJob ? 'none' : '';
    if (PREVIEW) { btnSelect.disabled = true; btnSelect.title = 'In der Vorschau eines Entwurfs nicht möglich'; }
    pSend.classList.toggle('primary', !!followupJob);
    if (typeof renderQueueButton === 'function' && qRun) renderQueueButton();
    var fj = followupCandidate();
    btnFollowup.style.display = fj ? '' : 'none';
    btnFollowup.disabled = busy;
    if (fj) btnFollowup.title = btnFollowup.modioLabel.textContent = 'Nachbessern (' + fj.result.annotationId + ')';
    renderHistoryButtons();
    renderDesignButtons();
    if (typeof renderChangesButton === 'function' && btnChanges) renderChangesButton();
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
    else if (areaSel && areaPanel.classList.contains('open')) placeHighlight(areaSel, true);
    else hl.style.display = 'none';
    if (previewed && (promptPanel.classList.contains('open') || areaPanel.classList.contains('open'))) placeBox(pv, pvLabel, previewed);
    else hidePreview();
  }

  // Element unter dem Mauszeiger, dessen eigene Fläche den Punkt enthält. Überspringt Elemente, die nur über
  // ein Pseudo-Element darüberliegen (z. B. ganze Karte klickbar per a::after { position:absolute; inset:0 }).
  function pickAt(x, y, fallback) {
    if (!document.elementsFromPoint) return fallback;
    var list = document.elementsFromPoint(x, y);
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (n === host || n === document.documentElement || n === document.body) continue;
      var r = n.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return n;
    }
    return fallback;
  }

  function onMove(e) {
    if (!selecting) return;
    if (isOwn(e)) return;
    var t = pickAt(e.clientX, e.clientY, e.target);
    if (!t || t.nodeType !== 1 || t === hovered) return;
    if (selectMode === 'draftnote' && !(pvLive.node && pvLive.node.contains(t))) return; // nur innerhalb der Komponente
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
    if (selectMode === 'draftnote' && !(pvLive.node && pvLive.node.contains(target))) return;
    finishSelecting(target);
  }

  function finishSelecting(target) {
    var mode = selectMode;
    stopSelecting();
    if (mode === 'draftnote') addDraftNote(target);
    else if (mode === 'token') showPick(target);
    else if (mode === 'area') openAreaDialog(target);
    else openPrompt(target);
  }

  var BLOCK_EVENTS = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'auxclick', 'touchstart', 'touchend', 'submit'];

  function startSelecting(mode) {
    selectMode = mode === 'token' || mode === 'area' || mode === 'draftnote' ? mode : 'annotate';
    if (selectMode === 'annotate' && PREVIEW) return; // in der Vorschau keine Annotationen (DOM weicht von der Datei ab)
    if (selectMode === 'draftnote') {
      /* Hinweis zu einem Element der Komponente: Hervorhebung genügt, Panel bleibt offen */
    } else if (selectMode === 'annotate') {
      closePanels();
      btnSelect.classList.add('on');
      btnSelect.setAttribute('aria-pressed', 'true');
      btnSelect.modioLabel.textContent = 'Auswahl beenden';
    } else {
      var pb = selectMode === 'token' ? dPick : dAreaPick;
      pb.classList.add('on');
      pb.setAttribute('aria-pressed', 'true');
      pb.modioLabel.textContent = selectMode === 'token' ? 'Element anklicken … (Esc)' : 'Bereich anklicken, ↑ = Elternelement (Esc)';
    }
    selecting = true;
    hovered = null;
    hl.classList.toggle('pick', selectMode !== 'annotate');
    document.documentElement.style.cursor = 'crosshair';
  }

  function stopSelecting() {
    selecting = false;
    hovered = null;
    childStack = [];
    btnSelect.classList.remove('on');
    btnSelect.setAttribute('aria-pressed', 'false');
    btnSelect.modioLabel.textContent = 'Auswählen';
    dPick.classList.remove('on');
    dPick.setAttribute('aria-pressed', 'false');
    dPick.modioLabel.textContent = 'Aus Element übernehmen';
    dAreaPick.classList.remove('on');
    dAreaPick.setAttribute('aria-pressed', 'false');
    dAreaPick.modioLabel.textContent = 'Auswählen';
    hl.classList.remove('pick');
    selectMode = 'annotate';
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
        else startSelecting('annotate');
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
          if (selectMode === 'draftnote' && !(pvLive.node && pvLive.node.contains(p))) p = null; // nicht über die Komponente hinaus
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
          finishSelecting(hovered);
        }
        return;
      }
      if (e.key === 'Escape' && isOwn(e)) {
        if (!pTokPop.hidden) { e.preventDefault(); closeTokPop(true); }
        else if (selEditing) { /* Esc bricht nur die Bearbeitung des Selektors ab (eigener Handler) */ }
        else if (areaPanel.classList.contains('open')) closeAreaDialog();
        else if (changesPanel.classList.contains('open')) closeChanges();
        else if (queuePanel.classList.contains('open')) closeQueue();
        else if (pagesPanel.classList.contains('open')) closePages();
        else if (promptPanel.classList.contains('open')) closePrompt();
        else if (historyPanel.classList.contains('open')) closeHistory();
        else if (designPanel.classList.contains('open')) closeDesign();
        else if (reviewPanel.classList.contains('open')) reviewPanel.classList.remove('open');
      }
    },
    true
  );

  btnSelect.addEventListener('click', function () {
    if (selecting) stopSelecting();
    else startSelecting('annotate');
  });

  // --------------------------------------------------------- Prompt-Dialog

  function closePanels() {
    if (typeof closePages === 'function' && pagesPanel) closePages();
    if (typeof closeQueue === 'function' && queuePanel) closeQueue();
    if (typeof closeChanges === 'function') closeChanges();
    if (typeof closeDrafts === 'function' && draftsPanel) closeDrafts();
    closePrompt();
    closeAreaDialog();
    closeHistory();
    closeDesign();
    reviewPanel.classList.remove('open');
  }

  function openPrompt(target) {
    closeAreaDialog();
    closeHistory();
    reviewPanel.classList.remove('open');
    selected = target;
    pathLeaf = target;
    customSel = null;
    followupJob = null;
    pTitle.textContent = 'Annotation';
    renderMeta();
    pErr.textContent = '';
    promptPanel.classList.add('open');
    placeHighlight(selected, true);
    setTimeout(function () { pText.focus(); }, 0);
  }

  function closePrompt() {
    closeTokPop(false);
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
    closeDesign();
    reviewPanel.classList.remove('open');
    var prm = job.params || {};
    selected = null;
    pathLeaf = null;
    followupJob = job;
    pTitle.textContent = 'Nachbessern ' + job.result.annotationId;
    clear(pMeta);
    pMeta.appendChild(el('div', { class: 'sel-full' }, [el('span', { class: 'sel-lbl', text: 'Selektor' }), prm.selector || '']));
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
    customSel = null;
    hidePreview();
    renderMeta();
    placeHighlight(selected, true);
  }

  // Pfadleiste (body bis ursprünglich gewähltes Element) und Selektor der aktuellen Auswahl
  var customSel = null; // von Hand angepasster Selektor (sonst automatisch aus der Auswahl)
  var selEditing = false;

  // Vollständiger Pfad ab body (ohne body), je Ebene Tag mit ID bzw. Klassen, ohne Positionsangaben
  function fullPathFor(node) {
    var segs = [];
    for (var n = node; n && n.nodeType === 1 && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      var s = n.tagName.toLowerCase();
      if (n.id && !looksGenerated(n.id)) s += '#' + esc(n.id);
      var cls = Array.prototype.filter.call(n.classList || [], function (c) { return !looksGenerated(c) && c.indexOf('modio') !== 0; }).slice(0, 3);
      if (cls.length) s += '.' + cls.map(esc).join('.');
      segs.unshift(s);
    }
    return segs.join(' > ');
  }

  // Selektorzeile bearbeitbar machen (Doppelklick oder Stift). o: { value, base, validate, apply, rerender }
  function attachSelEditor(box, o) {
    var line = box.querySelector('.sel-full');
    if (!line) return;
    line.classList.add('editable');
    line.title = 'Doppelklick zum Bearbeiten';
    var pen = iconButton('pencil', 'Selektor bearbeiten', { class: 'ghost sel-edit' }, true);
    line.appendChild(pen);
    var start = function () {
      if (selEditing) return;
      selEditing = true;
      var input = el('input', { type: 'text', class: 'textin mono', spellcheck: 'false', maxlength: '500', 'aria-label': 'Selektor' });
      input.value = o.value();
      var info = el('div', { class: 'hint', 'aria-live': 'polite' });
      clear(line);
      line.classList.remove('editable');
      line.appendChild(el('span', { class: 'sel-lbl', text: 'Selektor' }));
      line.appendChild(input);
      line.appendChild(info);
      var found = null;
      var check = function () {
        var v = input.value.trim(), list = null, err = v && o.validate ? o.validate(v) : '';
        found = null;
        if (v && !err) {
          try { list = document.querySelectorAll(v); } catch (e) { list = null; }
          list = list ? Array.prototype.filter.call(list, function (n) { return n !== host && !host.contains(n); }) : null;
        }
        if (!v) info.textContent = 'Leer: automatischer Selektor wird verwendet.';
        else if (err) info.textContent = err;
        else if (!list) info.textContent = 'Ungültiger Selektor.';
        else if (!list.length) info.textContent = 'Trifft auf dieser Seite nichts.';
        else {
          found = list[0];
          info.textContent = list.length === 1 ? 'Trifft genau ein Element. Enter übernimmt, Esc bricht ab.' : 'Trifft ' + list.length + ' Elemente, verwendet wird das erste (hervorgehoben). Enter übernimmt.';
        }
        var bad = !!v && !found;
        info.classList.toggle('bad', bad);
        input.classList.toggle('bad', bad);
        if (found || o.base()) placeHighlight(found || o.base(), true);
        return !bad;
      };
      var done = function () { selEditing = false; o.rerender(); };
      var apply = function () {
        if (!check()) return false;
        selEditing = false;
        o.apply(input.value.trim(), found);
        return true;
      };
      input.addEventListener('input', check);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); apply(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); }
      });
      input.addEventListener('blur', function () { setTimeout(function () { if (selEditing && !apply()) done(); }, 120); });
      check();
      setTimeout(function () { input.focus(); }, 0);
    };
    pen.addEventListener('click', start);
    line.addEventListener('dblclick', start);
  }

  function renderMeta() {
    selEditing = false;
    renderCrumbs(pMeta, pathLeaf, selected, selectCrumb, promptPanel, function () { return customSel || selectorFor(selected); });
    attachSelEditor(pMeta, {
      value: function () { return customSel || fullPathFor(selected); },
      base: function () { return selected; },
      apply: function (v, found) {
        if (!v) customSel = null;
        else {
          selected = found;
          customSel = v === selectorFor(found) ? null : v;
          var inChain = false;
          for (var n = pathLeaf; n; n = n.parentElement) if (n === selected) inChain = true;
          if (!inChain) pathLeaf = selected;
        }
        renderMeta();
        placeHighlight(selected, true);
        pText.focus();
      },
      rerender: function () { renderMeta(); placeHighlight(selected, true); pText.focus(); },
    });
  }

  function renderCrumbs(box, leaf, current, onSelect, panel, selFn) {
    var old = box.querySelector('.crumbs');
    var oldScroll = old && old.modioLeaf === leaf ? old.scrollLeft : null;
    clear(box);
    var chain = [];
    for (var n = leaf; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) chain.unshift(n);
    var nav = el('div', { class: 'crumbs', role: 'group', 'aria-label': 'Element-Pfad' });
    nav.modioLeaf = leaf;
    chain.forEach(function (node, i) {
      if (i) nav.appendChild(el('span', { class: 'csep', 'aria-hidden': 'true', text: '›' }));
      var b = el('button', { type: 'button', text: crumbLabel(node), title: describe(node) });
      if (node === current) b.setAttribute('aria-current', 'true');
      b.addEventListener('mouseenter', function () { showPreview(node); });
      b.addEventListener('focus', function () { showPreview(node); });
      b.addEventListener('mouseleave', hidePreview);
      b.addEventListener('blur', hidePreview);
      b.addEventListener('click', function () {
        onSelect(node);
        var btns = box.querySelectorAll('.crumbs button'); // nach dem Neuaufbau Fokus halten
        if (btns[i]) btns[i].focus({ preventScroll: true });
        hidePreview();
      });
      nav.appendChild(b);
    });
    box.appendChild(nav);
    if (selFn) {
      var selText = selFn(current);
      box.appendChild(el('div', { class: 'sel-full' }, [el('span', { class: 'sel-lbl', text: 'Selektor' }), selText]));
    }
    nav.addEventListener('scroll', function () { crumbFade(nav); });
    nav.addEventListener('wheel', function (e) {
      var d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d || nav.scrollWidth <= nav.clientWidth) return;
      e.preventDefault();
      nav.scrollLeft += d;
    }, { passive: false });
    // Einzeilig: rechts steht die unterste Ebene, links wird abgeschnitten. Nach einem Klick bleibt der
    // gewählte Eintrag sichtbar und sein Elternelement rückt links ins Bild (so klickt man sich nach oben).
    var place = function () {
      if (oldScroll === null) nav.scrollLeft = nav.scrollWidth;
      else nav.scrollLeft = oldScroll;
      var cur = nav.querySelector('button[aria-current=true]');
      if (cur) {
        var prev = cur.previousElementSibling && cur.previousElementSibling.previousElementSibling;
        var left = (prev || cur).offsetLeft - 28;
        var right = cur.offsetLeft + cur.offsetWidth + 28 - nav.clientWidth;
        if (nav.scrollLeft > left) nav.scrollLeft = Math.max(0, left);
        if (nav.scrollLeft < right) nav.scrollLeft = right;
      }
      crumbFade(nav);
    };
    if (panel.classList.contains('open')) place();
    else setTimeout(place, 0);
  }

  function crumbFade(nav) {
    nav.classList.toggle('cl', nav.scrollLeft > 1);
    nav.classList.toggle('cr', nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1);
  }

  function resetPrompt() {
    pText.value = '';
    pUrl.value = '';
    pThorough.checked = true;
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
      if (e.altKey && !followupJob) { submit('draft'); return; }
      submit(e.shiftKey || followupJob ? 'direct' : 'queue');
    }
  });
  pSend.addEventListener('click', function () { submit('direct'); });
  pQueue.addEventListener('click', function () { submit('queue'); });
  pDraft.addEventListener('click', function () { submit('draft'); });


  // Zeilenweiser Unterschied (LCS) zweier HTML-Fassungen, Tags je Zeile
  function htmlLines(h) { return String(h).replace(/>\s*</g, '>\n<').split('\n'); }
  function lineDiff(a, b) {
    a = a.slice(0, 1500); b = b.slice(0, 1500);
    var n = a.length, m = b.length, i, j, dp = [];
    for (i = 0; i <= n; i++) { dp[i] = new Array(m + 1); dp[i][m] = 0; }
    for (j = 0; j <= m; j++) dp[n][j] = 0;
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var out = [];
    i = 0; j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { out.push(' ' + a[i]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push('-' + a[i]); i++; }
      else { out.push('+' + b[j]); j++; }
    }
    while (i < n) out.push('-' + a[i++]);
    while (j < m) out.push('+' + b[j++]);
    return out.join('\n');
  }
  function styleMap(s) {
    var m = {};
    String(s || '').split(';').forEach(function (d) {
      var k = d.indexOf(':');
      if (k > 0) m[d.slice(0, k).trim().toLowerCase()] = d.slice(k + 1).trim();
    });
    return m;
  }


  // ---- Design-Tokens in den Prompt einfügen
  var tokCache = null;
  var tokItems = [];
  var tokActive = 0;
  var tokCaret = 0;
  function loadTokens() {
    if (tokCache) return Promise.resolve(tokCache);
    return api('GET', '/api/sites/' + encodeURIComponent(SLUG) + '/design').then(function (d) {
      var t = (d && d.tokens) || {};
      tokCache = Object.keys(t).sort().map(function (k) { return { key: k, value: String((t[k] || {}).value || ''), locked: (t[k] || {}).locked === true }; });
      return tokCache;
    });
  }
  function renderTokList() {
    clear(pTokList);
    var q = pTokFilter.value.trim().toLowerCase();
    tokItems = (tokCache || []).filter(function (t) { return !q || t.key.indexOf(q) !== -1 || t.value.toLowerCase().indexOf(q) !== -1; });
    if (tokActive >= tokItems.length) tokActive = 0;
    if (!tokItems.length) {
      pTokList.appendChild(el('li', { class: 'empty', text: (tokCache || []).length ? 'Kein passender Token.' : 'Noch keine Tokens. Im Design-Panel anlegen.' }));
      return;
    }
    tokItems.forEach(function (t, i) {
      var li = el('li', { role: 'option', 'aria-selected': i === tokActive ? 'true' : 'false', title: t.value + (t.locked ? ' (gesperrt)' : '') }, [
        t.key.indexOf('color.') === 0 ? swatch(t.value) : null,
        el('code', { text: t.key }),
        el('span', { class: 'v', text: t.value }),
      ]);
      li.addEventListener('mousedown', function (e) { e.preventDefault(); insertToken(t.key); });
      pTokList.appendChild(li);
    });
    var act = pTokList.children[tokActive];
    if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest' });
  }
  function openTokPop() {
    tokCaret = pText.selectionStart || pText.value.length;
    pTokPop.hidden = false;
    pTokBtn.setAttribute('aria-expanded', 'true');
    pTokFilter.value = '';
    tokActive = 0;
    clear(pTokList);
    pTokList.appendChild(el('li', { class: 'empty', text: 'Lade …' }));
    loadTokens().then(renderTokList).catch(function (err) { clear(pTokList); pTokList.appendChild(el('li', { class: 'empty', text: 'Fehler: ' + err.message })); });
    setTimeout(function () { pTokFilter.focus(); }, 0);
  }
  function closeTokPop(focusText) {
    if (pTokPop.hidden) return;
    pTokPop.hidden = true;
    pTokBtn.setAttribute('aria-expanded', 'false');
    if (focusText) pText.focus();
  }
  function insertToken(key) {
    var v = pText.value, pos = Math.min(tokCaret, v.length);
    var before = v.slice(0, pos), after = v.slice(pos);
    var ins = (before && !/\s$/.test(before) ? ' ' : '') + key + (after && !/^\s/.test(after) ? ' ' : '');
    pText.value = before + ins + after;
    closeTokPop(false);
    pText.focus();
    var c = (before + ins).length;
    pText.setSelectionRange(c, c);
  }
  pTokBtn.addEventListener('click', function () { if (pTokPop.hidden) openTokPop(); else closeTokPop(true); });
  pTokFilter.addEventListener('input', function () { tokActive = 0; renderTokList(); });
  pTokFilter.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (tokItems.length) { tokActive = (tokActive + 1) % tokItems.length; renderTokList(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (tokItems.length) { tokActive = (tokActive - 1 + tokItems.length) % tokItems.length; renderTokList(); } }
    else if (e.key === 'Enter') { e.preventDefault(); if (tokItems[tokActive]) insertToken(tokItems[tokActive].key); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeTokPop(true); }
  });
  pTokFilter.addEventListener('blur', function () { setTimeout(function () { if (!pTokPop.contains(root.activeElement)) closeTokPop(false); }, 100); });
  pText.addEventListener('keydown', function (e) {
    if (e.key === ' ' && e.ctrlKey) { e.preventDefault(); openTokPop(); }
  });

  // Vorschlag für den Namen eines Bereichs
  function areaName(node) {
    var id = (node.id || '').toLowerCase(), tag = node.tagName.toLowerCase();
    if (/header|kopf/.test(id) || tag === 'header') return 'Header';
    if (/footer|fuss/.test(id) || tag === 'footer') return 'Footer';
    if (/nav/.test(id) || tag === 'nav') return 'Navigation';
    return crumbLabel(node);
  }



  pCancel.addEventListener('click', function () {
    closePrompt();
  });

  function submit(mode) {
    if (!selected && !followupJob) return;
    var toQueue = mode === 'queue' && !followupJob;
    var toDraft = mode === 'draft' && !followupJob;
    if (toDraft && activeJob() && activeJob().status !== 'review') {
      pErr.textContent = 'Es läuft noch ein Auftrag. Der Entwurf ist erst danach möglich.';
      return;
    }
    if (!toQueue && !toDraft && isBusy()) {
      pErr.textContent = 'Es läuft noch ein Schritt. Bitte warten oder in die Queue aufnehmen.';
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
      selector: fp ? fp.selector : customSel || selectorFor(selected),
      html: fp ? fp.html || '' : truncate(selected.outerHTML, MAX_HTML),
      text: fp ? fp.text || '' : truncate((selected.innerText || selected.textContent || '').trim(), MAX_TEXT),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      prompt: prompt,
      thorough: !!pThorough.checked,
      remember: false,
      allow_token_change: false,
      followup: !!fp,
      followup_of: fp ? followupJob.result.annotationId : null,
      references: refs.filter(function (r) { return r.kind === 'url'; }).map(function (r) {
        return { type: 'url', url: r.url };
      }),
    };
    if (toDraft) {
      var rect = selected.getBoundingClientRect();
      annotation.rect = { width: Math.round(rect.width), height: Math.round(rect.height) };
      try { annotation.bausteine = collectBausteine(); } catch (e) { annotation.bausteine = []; }
      delete annotation.followup; delete annotation.followup_of;
    }
    var fd = new FormData();
    fd.append('annotation', JSON.stringify(annotation));
    refs.forEach(function (r) {
      if (r.kind === 'file') fd.append('images', r.file, r.file.name || 'bild');
    });
    pSend.disabled = pQueue.disabled = pDraft.disabled = true;
    pErr.textContent = '';
    api('POST', '/api/sites/' + encodeURIComponent(SLUG) + (toDraft ? '/drafts' : toQueue ? '/queue' : '/annotations'), fd)
      .then(function (data) {
        if (data && data.job) trackJob(data.job);
        if (data && data.items) { queueItems = data.items; renderQueueButton(); }
        resetPrompt();
        closePrompt();
        showToast(toDraft ? 'Claude entwirft das Element als Komponente … Die Vorschau öffnet sich, sobald der Entwurf fertig ist.' : toQueue ? 'In die Queue aufgenommen (' + queueItems.length + ').' : 'Annotation gesendet.', false);
      })
      .catch(function (err) {
        pErr.textContent =
          err.status === 409 ? 'Für diese Website läuft bereits ein Schritt oder wartet auf Prüfung.' : 'Senden fehlgeschlagen: ' + err.message;
      })
      .then(function () {
        pQueue.disabled = pDraft.disabled = false;
        renderStatus();
      });
  }

  // ------------------------------------------------------------- Seitenübersicht

  var pgFilter = el('input', { type: 'text', class: 'textin', placeholder: 'Seiten filtern …', 'aria-label': 'Seiten filtern', spellcheck: 'false' });
  var pgList = el('ul', { class: 'pglist' });
  var pgInfo = el('div', { class: 'hint' });
  var pagesPanel = el('div', { id: 'modio-pages', class: 'panel', role: 'dialog', 'aria-labelledby': 'modio-pgh' }, [
    el('h2', { id: 'modio-pgh', text: 'Seiten im Abzug' }),
    pgFilter,
    pgList,
    pgInfo,
  ]);
  ui.appendChild(pagesPanel);
  var pagesData = null;
  function renderPages() {
    clear(pgList);
    var all = (pagesData && pagesData.pages) || [];
    var q = pgFilter.value.trim().toLowerCase();
    var list = all.filter(function (p) { return !q || (p.title + ' ' + p.path).toLowerCase().indexOf(q) !== -1; });
    var cur = currentPage();
    list.forEach(function (p) {
      var a = el('a', { href: BASE + p.path.split('/').map(encodeURIComponent).join('/'), class: 'pglink' + (p.path === cur ? ' current' : '') }, [
        el('span', { class: 'pgtitle', text: p.title || p.path.split('/').pop() }),
        el('span', { class: 'pgpath', text: p.url.replace(/^https?:\/\//, '') }),
      ]);
      if (p.path === cur) a.setAttribute('aria-current', 'page');
      var li = el('li', {}, [a]);
      if (pagesData && p.path === pagesData.entry) li.appendChild(el('span', { class: 'badge', text: 'Start' }));
      pgList.appendChild(li);
    });
    if (!list.length) pgList.appendChild(el('li', { class: 'hint', text: all.length ? 'Keine passende Seite.' : 'Lade …' }));
    pgInfo.textContent = all.length + ' Seite(n). Weitere Seiten: Startseite › Aktionen › „Seiten hinzufügen“.';
  }
  function openPages() {
    closePanels();
    pagesPanel.classList.add('open');
    btnPages.classList.add('on');
    btnPages.setAttribute('aria-expanded', 'true');
    pgFilter.value = '';
    renderPages();
    api('GET', '/api/sites/' + encodeURIComponent(SLUG) + '/pages').then(function (d) { pagesData = d; renderPages(); })
      .catch(function (err) { clear(pgList); pgList.appendChild(el('li', { class: 'err', text: 'Fehler: ' + err.message })); });
    setTimeout(function () { pgFilter.focus(); }, 0);
  }
  function closePages() {
    pagesPanel.classList.remove('open');
    btnPages.classList.remove('on');
    btnPages.setAttribute('aria-expanded', 'false');
  }
  btnPages.addEventListener('click', function () { if (pagesPanel.classList.contains('open')) closePages(); else openPages(); });
  pgFilter.addEventListener('input', renderPages);
  pgFilter.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { var a = pgList.querySelector('a'); if (a) { e.preventDefault(); a.click(); } }
  });

  // ------------------------------------------------- Laufende Ausgabe (Hover auf den Status)

  var logPop = el('div', { class: 'logpop', role: 'log', 'aria-live': 'polite', 'aria-label': 'Laufende Ausgabe' });
  var logHead = el('div', { class: 'loghead' });
  var logBody = el('div', { class: 'logbody' });
  logPop.appendChild(logHead);
  logPop.appendChild(logBody);
  ui.appendChild(logPop);
  var logTimer = null, logHideTimer = null, logJobId = null;
  function runningJob() { var j = activeJob(); return j && j.status === 'running' ? j : null; }
  function loadLog() {
    if (!logJobId) return;
    api('GET', '/api/jobs/' + encodeURIComponent(logJobId) + '/log').then(function (d) {
      var atBottom = logBody.scrollTop + logBody.clientHeight >= logBody.scrollHeight - 8;
      clear(logBody);
      var lines = (d && d.lines) || [];
      if (!lines.length) logBody.appendChild(el('div', { class: 'hint', text: 'Noch keine Ausgabe …' }));
      lines.forEach(function (l) { logBody.appendChild(el('div', { class: 'logline', text: l })); });
      if (atBottom) logBody.scrollTop = logBody.scrollHeight;
    }).catch(function () { /* egal */ });
  }
  function showLog() {
    var j = runningJob();
    if (!j) return;
    clearTimeout(logHideTimer);
    if (logPop.classList.contains('open') && logJobId === j.id) return;
    logJobId = j.id;
    logHead.textContent = (TYPE_LABEL[j.type] || j.type) + ' – laufende Ausgabe';
    clear(logBody);
    logPop.classList.add('open');
    loadLog();
    clearInterval(logTimer);
    logTimer = setInterval(function () { if (!runningJob()) { hideLog(true); return; } loadLog(); }, 1500);
  }
  function hideLog(now) {
    clearTimeout(logHideTimer);
    var go = function () { logPop.classList.remove('open'); clearInterval(logTimer); logJobId = null; };
    if (now) go(); else logHideTimer = setTimeout(go, 250);
  }
  statusEl.addEventListener('mouseenter', showLog);
  statusEl.addEventListener('focus', showLog);
  statusEl.addEventListener('mouseleave', function () { hideLog(false); });
  statusEl.addEventListener('blur', function () { hideLog(false); });
  logPop.addEventListener('mouseenter', function () { clearTimeout(logHideTimer); });
  logPop.addEventListener('mouseleave', function () { hideLog(false); });

  // ------------------------------------------------------------- Queue

  var queueItems = [];
  var btnQueue = iconButton('layers', 'Queue umsetzen', { class: 'queue' }, true);
  btnQueue.modioCount = el('span', { class: 'cnt', 'aria-hidden': 'true' });
  btnQueue.appendChild(btnQueue.modioCount);
  btnQueue.style.display = 'none';
  bar.insertBefore(btnQueue, statusEl);
  var qList = el('ul', { class: 'qlist' });
  var qThorough = el('input', { type: 'checkbox' });
  qThorough.checked = true;
  var qErr = el('div', { class: 'err', role: 'alert' });
  var qClose = el('button', { type: 'button', text: 'Schließen' });
  var qRun = el('button', { type: 'button', class: 'primary', text: 'Alle in einem Schritt umsetzen' });
  var queuePanel = el('div', { class: 'panel', role: 'dialog', 'aria-labelledby': 'modio-qh' }, [
    el('h2', { id: 'modio-qh', text: 'Queue' }),
    qList,
    el('div', { class: 'checks' }, [el('label', { class: 'switch', title: 'Nimmt Opus statt Sonnet' }, [qThorough, 'Stärkeres Modell für komplexe Änderungen'])]),
    qErr,
    el('div', { class: 'row end' }, [qClose, qRun]),
  ]);
  ui.appendChild(queuePanel);

  function renderQueueButton() {
    var n = queueItems.length;
    btnQueue.style.display = n ? '' : 'none';
    btnQueue.title = btnQueue.modioLabel.textContent = 'Queue umsetzen (' + n + ')';
    btnQueue.modioCount.textContent = String(n);
    btnQueue.disabled = false;
    qRun.disabled = isBusy() || !n;
    qRun.title = isBusy() ? 'Es läuft noch ein Schritt – danach umsetzen' : '';
    if (queuePanel.classList.contains('open')) renderQueue();
  }
  function renderQueue() {
    clear(qList);
    if (!queueItems.length) qList.appendChild(el('li', { class: 'hint', text: 'Die Queue ist leer.' }));
    queueItems.forEach(function (q, i) {
      var del = iconButton('trash', 'Aus der Queue entfernen', { class: 'ghost' }, true);
      del.addEventListener('click', function () {
        del.disabled = true;
        api('DELETE', '/api/sites/' + encodeURIComponent(SLUG) + '/queue/' + encodeURIComponent(q.id))
          .then(function (d) { queueItems = (d && d.items) || []; renderQueueButton(); })
          .catch(function (err) { qErr.textContent = 'Entfernen fehlgeschlagen: ' + err.message; del.disabled = false; });
      });
      qList.appendChild(el('li', {}, [
        el('span', { class: 'qn', text: String(i + 1) }),
        el('div', { class: 'qbody' }, [
          el('div', { class: 'qprompt', text: q.prompt }),
          el('div', { class: 'step-sel', text: [q.page === currentPage() ? null : q.page, q.selector, q.references ? q.references + ' Bild(er)' : null].filter(Boolean).join(' · ') }),
        ]),
        del,
      ]));
    });
  }
  function loadQueue() {
    return api('GET', '/api/sites/' + encodeURIComponent(SLUG) + '/queue')
      .then(function (d) { queueItems = (d && d.items) || []; renderQueueButton(); })
      .catch(function () { /* egal */ });
  }
  function openQueue() {
    closePanels();
    qErr.textContent = '';
    renderQueue();
    queuePanel.classList.add('open');
    setTimeout(function () { qRun.focus(); }, 0);
  }
  function closeQueue() { queuePanel.classList.remove('open'); }
  btnQueue.addEventListener('click', function () { if (queuePanel.classList.contains('open')) closeQueue(); else openQueue(); });
  qClose.addEventListener('click', closeQueue);
  qRun.addEventListener('click', function () {
    if (isBusy()) { qErr.textContent = 'Es läuft noch ein Schritt. Bitte warten.'; return; }
    qRun.disabled = true;
    api('POST', '/api/sites/' + encodeURIComponent(SLUG) + '/queue/run', { thorough: !!qThorough.checked })
      .then(function (data) {
        if (data && data.job) trackJob(data.job);
        queueItems = [];
        renderQueueButton();
        closeQueue();
        showToast('Queue wird in einem Schritt umgesetzt …', false);
      })
      .catch(function (err) { qErr.textContent = err.status === 409 ? 'Es läuft noch ein Schritt oder wartet auf Prüfung.' : 'Fehlgeschlagen: ' + err.message; qRun.disabled = false; });
  });

  // ------------------------------------------------------------- Jobs

  function trackJob(job) {
    if (!job || job.slug !== SLUG) return;
    var prev = jobs[job.id];
    // Statuswechsel eines Auftrags: gemerkten Dateistatus verwerfen (könnte Claudes Zwischenstand enthalten)
    if (!prev || prev.status !== job.status) {
      chFiles = { changed: 0, files: [] };
      if (!ACTIVE[job.status]) setTimeout(function () { if (!isBusy() && !reloading) loadFileStatus().then(renderChangesButton); }, 1500);
    }
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
      if (job.type === 'design-save' || job.type === 'tokens-propose' || job.type === 'areas-sync') {
        try { sessionStorage.removeItem(DESIGN_OPEN_KEY); } catch (e) { /* ignorieren */ }
      }
      showToast((TYPE_LABEL[job.type] || job.type) + ' fehlgeschlagen: ' + (job.error || (job.result && job.result.error) || 'unbekannter Fehler'), true, true);
      return;
    }
    lastFailed = null;
    var r = job.result || {};
    var msg = '';
    if (job.type === 'draft') {
      loadDrafts();
      if (r.draft && r.version) {
        try { sessionStorage.setItem(FLASH_KEY, 'Entwurf ' + r.draft + ' v' + r.version + (r.title ? ' („' + r.title + '“)' : '') + ' fertig. Mit „Aktuell“ und den Versionen oben vergleichen, rechts nachbessern oder übernehmen.'); sessionStorage.setItem(DRAFT_OPEN_KEY, r.draft); } catch (e) { /* ignorieren */ }
        location.href = previewUrl({ id: r.draft, page: r.page }, r.version);
      }
      return;
    }
    if (job.type === 'draft-discard') {
      if (PREVIEW && job.params && job.params.draft === PREVIEW.draft) {
        try { sessionStorage.setItem(FLASH_KEY, 'Entwurf ' + PREVIEW.draft + ' verworfen.'); } catch (e) { /* ignorieren */ }
        location.href = location.pathname + cleanSearch();
        return;
      }
      loadDrafts(); showToast('Entwurf verworfen.', false); return;
    }
    if (job.type === 'annotate' || job.type === 'local-commit' || job.type === 'inspect-apply' || job.type === 'draft-apply') {
      msg = r.status === 'nochange' && job.type !== 'annotate' ? (r.summary || 'Keine Änderungen.') : r.status === 'nochange' ? 'Keine Änderung (' + (r.annotationId || '') + ').' : 'Fertig: ' + (r.annotationId || '');
      if (r.summary) msg += '\n' + truncate(r.summary, 600);
      if (r.synced && r.synced.changed && r.synced.changed.length) msg += '\n\n' + (r.synced.areas || []).join(', ') + ' auf ' + r.synced.changed.length + ' weitere Seite(n) übertragen.';
      if (r.warnings && r.warnings.length) {
        msg += '\n\nHinweise der Prüfung:\n' + r.warnings.slice(0, 5).map(function (w) { return '– ' + truncate(w.text || w.rule, 160); }).join('\n');
      }
    } else if (job.type === 'rollback') {
      msg = 'Zurückgesprungen.';
    } else if (job.type === 'decision') {
      msg = job.params && job.params.action === 'discard' ? 'Schritt verworfen.' : 'Schritt übernommen.';
    } else if (job.type === 'report') {
      msg = 'Report erzeugt (CHANGES.md).';
    } else if (job.type === 'design-save') {
      msg = r.status === 'nochange' ? 'Design-Vorgaben unverändert.' : 'Design-Vorgaben gespeichert.';
    } else if (job.type === 'areas-sync') {
      var ch = r.changed || [];
      msg = ch.length ? (r.areas || []).join(', ') + ' auf ' + ch.length + ' Seite(n) übernommen.' : 'Alle Seiten waren schon gleich.';
      if (r.added) msg = 'Bereich „' + (r.areas || [])[0] + '“ aufgenommen. ' + msg;
      var sk = (r.skipped || []).filter(function (x) { return x.reason !== 'schon gleich'; });
      if (sk.length) msg += '\nNicht übernommen: ' + sk.slice(0, 5).map(function (x) { return x.page + ' (' + x.area + ': ' + x.reason + ')'; }).join(', ');
    } else if (job.type === 'pages-add') {
      msg = (r.added && r.added.length ? r.added.length + ' Seite(n) hinzugefügt.' : 'Keine neuen Seiten.') + (r.failed && r.failed.length ? '\nNicht geladen: ' + r.failed.join(', ') : '');
      var ar = r.areas || {};
      if (ar.changed && ar.changed.length) msg += '\nGleiche Bereiche übernommen: ' + ar.changed.map(function (c) { return c.areas.join(', '); }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join('; ');
      if (ar.unclear && ar.unclear.length) msg += '\nNicht übernommen, weil die Seiten uneinheitlich sind: ' + ar.unclear.join(', ') + ' (im Design-Panel angleichen)';
    } else if (job.type === 'tokens-propose') {
      var added = r.added || [];
      msg = added.length ? added.length + ' Token(s) aus dem Abzug übernommen (ungesperrt): ' + added.join(', ') : 'Keine neuen Tokens aus dem Abzug.';
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
    if (typeof renderChangesButton === 'function' && btnChanges) renderChangesButton();
    setTimeout(function () { if (PREVIEW) location.href = location.pathname + cleanSearch(); else location.reload(); }, 600);
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
    es.addEventListener('queue', function (e) {
      var d = {};
      try { d = JSON.parse(e.data); } catch (err) { /* ignorieren */ }
      if (d.slug === SLUG) loadQueue();
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

  function renderDiff(text) { renderDiffInto(rDiff, text); }
  function renderDiffInto(rDiff, text) {
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
    closeDesign();
    var r = job.result || {};
    clear(rInfo);
    rInfo.appendChild(
      el('p', {
        text:
          (r.annotationId ? r.annotationId + ': ' : '') +
          'Die automatische Prüfung hat auffällige Änderungen gefunden. Bitte Diff ansehen und entscheiden.',
      })
    );
    if (r.summary) rInfo.appendChild(el('details', {}, [el('summary', {}, [icon('chevron', 14), 'Rückmeldung von Claude']), el('p', { text: r.summary })]));
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
    if (opts.summary) children.push(el('details', {}, [el('summary', {}, [icon('chevron', 14), 'Rückmeldung von Claude']), el('p', { text: opts.summary })]));
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
    closeDesign();
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

  // ------------------------------------------------------- Design-Vorgaben

  var DESIGN_OPEN_KEY = 'modio-design-open-' + SLUG;
  var NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var FORBIDDEN = ['url(', '@', ';', '{', '}', '<', '>', '\\', '/*', '*/', '\n', '\r'];
  var design = null; // Stand vom Server
  var dTokens = {}; // Arbeitskopie: key -> { value, locked, note }
  var dLoaded = false;

  function cloneTokens(t) {
    var out = {};
    Object.keys(t || {}).forEach(function (k) {
      var v = t[k] || {};
      out[k] = { value: String(v.value == null ? '' : v.value), locked: v.locked === true };
      if (v.note) out[k].note = String(v.note);
    });
    return out;
  }

  // Grobe Prüfung im Browser; die verbindliche Prüfung macht design-save.sh
  function checkTokenValue(v) {
    v = String(v || '').trim();
    if (!v) return 'Wert fehlt';
    if (v.length > 200) return 'Wert zu lang';
    var low = v.toLowerCase();
    for (var i = 0; i < FORBIDDEN.length; i++) if (low.indexOf(FORBIDDEN[i]) !== -1) return 'unzulässiges Zeichen „' + (FORBIDDEN[i].trim() || 'Zeilenumbruch') + '“';
    var m, re = /([a-z-]+)\s*\(/gi;
    while ((m = re.exec(v))) if (!/^(rgb|rgba|hsl|hsla)$/i.test(m[1])) return 'Funktion ' + m[1] + '() nicht erlaubt';
    return '';
  }

  function isColorKey(k) { return k.indexOf('color.') === 0; }

  function swatch(color) {
    var s = el('span', { class: 'sw', 'aria-hidden': 'true' });
    s.style.background = color;
    return s;
  }

  // rgb(a) aus getComputedStyle in Hex (bei Deckkraft 1) umwandeln; null bei transparent
  function cssColor(v) {
    var m = String(v || '').match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
    if (!m) return v || null;
    var a = m[4] === undefined ? 1 : m[4].indexOf('%') !== -1 ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (a === 0) return null;
    if (a < 1) return 'rgba(' + m[1] + ', ' + m[2] + ', ' + m[3] + ', ' + a + ')';
    return '#' + [m[1], m[2], m[3]].map(function (x) { return ('0' + Number(x).toString(16)).slice(-2); }).join('');
  }

  function normValue(k, v) {
    v = String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (isColorKey(k)) {
      var c = cssColor(v);
      if (c && /^#[0-9a-f]{3}$/.test(c)) c = '#' + c.charAt(1) + c.charAt(1) + c.charAt(2) + c.charAt(2) + c.charAt(3) + c.charAt(3);
      return c || v;
    }
    return v.replace(/\s*,\s*/g, ',').replace(/["']/g, '');
  }

  function tokenFor(cat, value) {
    var n = normValue(cat + '.x', value);
    var keys = Object.keys(dTokens);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].split('.')[0] === cat && normValue(keys[i], dTokens[keys[i]].value) === n) return keys[i];
    }
    return null;
  }

  function sortedKeys() {
    return Object.keys(dTokens).sort(function (a, b) {
      var ca = CATS.indexOf(a.split('.')[0]), cb = CATS.indexOf(b.split('.')[0]);
      return ca - cb || (a < b ? -1 : a > b ? 1 : 0);
    });
  }

  function isDirty() {
    if (!design) return false;
    return JSON.stringify(cloneTokens(dTokens)) !== JSON.stringify(cloneTokens(design.tokens)) || dNotes.value !== (design.notes || '');
  }

  function tokensChanged() {
    return !!design && JSON.stringify(cloneTokens(dTokens)) !== JSON.stringify(cloneTokens(design.tokens));
  }

  function hasInvalid() {
    return Object.keys(dTokens).some(function (k) { return !!checkTokenValue(dTokens[k].value); });
  }

  function renderDesignButtons() {
    var busy = isBusy();
    var dirty = isDirty();
    dDirty.textContent = dirty ? 'Ungespeicherte Änderungen' : '';
    dSave.disabled = busy || !dirty || hasInvalid();
    dSave.title = busy ? 'Es läuft noch ein Schritt – bitte warten' : hasInvalid() ? 'Ungültige Werte korrigieren' : '';
    dReset.disabled = !dirty;
    dPropose.disabled = busy || !design;
    var hasAreas = !!(design && design.consistency && (design.consistency.shared || []).length);
    dAreasSync.disabled = busy || !hasAreas;
    dAreaPick.disabled = busy;
  }

  function tokenRow(key) {
    var t = dTokens[key];
    var sw = isColorKey(key) ? swatch(t.value) : null;
    var input = el('input', { type: 'text', value: t.value, 'aria-label': 'Wert für ' + key, spellcheck: 'false' });
    input.value = t.value;
    function validate() {
      var err = checkTokenValue(input.value);
      input.classList.toggle('bad', !!err);
      input.title = err;
    }
    validate();
    input.addEventListener('input', function () {
      t.value = input.value;
      if (sw) sw.style.background = input.value;
      validate();
      renderDesignButtons();
    });
    var lock = iconButton(t.locked ? 'lock' : 'unlock', t.locked ? 'Gesperrt – Claude darf den Wert nicht ändern' : 'Nicht gesperrt – Claude darf den Wert anpassen',
      { class: 'lock', 'aria-pressed': t.locked ? 'true' : 'false' }, true);
    lock.addEventListener('click', function () {
      t.locked = !t.locked;
      renderTokens();
      renderDesignButtons();
    });
    var del = iconButton('trash', 'Token ' + key + ' löschen', { class: 'ghost' }, true);
    del.addEventListener('click', function () {
      if (t.locked && !window.confirm('Den gesperrten Token ' + key + ' löschen?')) return;
      delete dTokens[key];
      renderTokens();
      renderDesignButtons();
    });
    return el('tr', {}, [
      el('td', { class: 'k', title: t.note || '' }, [sw, key]),
      el('td', {}, [input]),
      el('td', { class: 'b' }, [lock]),
      el('td', { class: 'b' }, [del]),
    ]);
  }

  function renderTokens() {
    clear(dTokBody);
    var keys = sortedKeys();
    if (!keys.length) dTokBody.appendChild(el('tr', {}, [el('td', { class: 'hint', colspan: '4', text: 'Noch keine Tokens. Unten hinzufügen, aus einem Element übernehmen oder aus dem Abzug ableiten.' })]));
    keys.forEach(function (k) { dTokBody.appendChild(tokenRow(k)); });
  }

  function renderWarnings() {
    clear(dWarn);
    var w = (design && design.warnings) || [];
    if (!w.length) return;
    var list = el('ul', { class: 'hits' });
    w.slice(0, 20).forEach(function (x) {
      list.appendChild(el('li', { class: 'warn' }, [el('strong', { text: x.rule || 'Hinweis' }), ' – ', x.text || '']));
    });
    dWarn.appendChild(el('section', { class: 'dsec' }, [el('h3', { text: 'Hinweise aus ' + (design.annotationId || 'dem letzten Schritt') }), list]));
  }

  // Wert in die Zeile „Token hinzufügen“ übernehmen
  function prefill(cat, value, name) {
    dAddCat.value = cat;
    dAddVal.value = value;
    dAddVal.classList.toggle('bad', !!checkTokenValue(value));
    var base = name || '';
    if (base) {
      var n = base, i = 2;
      while (dTokens[cat + '.' + n]) n = base + '-' + i++;
      dAddName.value = n;
    }
    dAddName.focus();
    dAddName.select();
  }

  function renderScan() {
    clear(dScan);
    var sc = design && design.scan;
    if (!sc) return;
    var groups = [
      { label: 'Farben', cat: 'color', list: sc.colors || [] },
      { label: 'Radien', cat: 'radius', list: sc.radii || [] },
      { label: 'Schriftgrößen', cat: 'size', list: sc.fontSizes || [] },
      { label: 'Schriften', cat: 'font', list: sc.fonts || [] },
    ].filter(function (g) { return g.list.length; });
    if (!groups.length) return;
    var body = [el('summary', {}, [icon('chevron', 14), 'Häufige Werte im Abzug'])];
    groups.forEach(function (g) {
      body.push(el('div', { class: 'chips-label', text: g.label }));
      var chips = el('div', { class: 'chips' });
      g.list.slice(0, 16).forEach(function (it) {
        var used = tokenFor(g.cat, it.value);
        var b = el('button', { type: 'button', title: it.count + '× im Abzug' + (used ? ' · Token ' + used : ' · als Token übernehmen') },
          [g.cat === 'color' ? swatch(it.value) : null, truncate(it.value, 40) + (used ? ' ✓' : '')]);
        b.addEventListener('click', function () { prefill(g.cat, it.value, ''); });
        chips.appendChild(b);
      });
      body.push(chips);
    });
    dScan.appendChild(el('details', { class: 'adv' }, body));
  }

  function renderAreas() {
    clear(dAreas);
    var c = (design && design.consistency) || {};
    var shared = c.shared || [];
    if (!shared.length) dAreas.appendChild(el('li', { class: 'hint', text: 'Noch keine gleichen Bereiche.' }));
    shared.forEach(function (a, i) {
      var del = iconButton('trash', 'Bereich ' + (a.name || a.selector) + ' entfernen', { class: 'ghost' }, true);
      del.addEventListener('click', function () { removeArea(i); });
      dAreas.appendChild(el('li', {}, [el('strong', { text: a.name || a.selector }), el('code', { text: a.selector }), del]));
    });
  }

  function removeArea(i) {
    var c = design.consistency || {};
    var a = (c.shared || [])[i];
    if (!a) return;
    if (!window.confirm('Bereich „' + (a.name || a.selector) + '“ nicht mehr auf Gleichheit prüfen?' + (isDirty() ? '\n\nUngespeicherte Änderungen an Tokens und Regeln gehen dabei verloren.' : ''))) return;
    var shared = (c.shared || []).filter(function (_, j) { return j !== i; });
    api('PUT', '/api/sites/' + encodeURIComponent(SLUG) + '/design', { consistency: { shared: shared, ignore: c.ignore || [] } })
      .then(function (data) {
        if (data && data.job) trackJob(data.job);
        try { sessionStorage.setItem(DESIGN_OPEN_KEY, '1'); } catch (e) { /* ignorieren */ }
        showToast('Bereich wird entfernt …', false);
      })
      .catch(function (err) { dErr.textContent = 'Entfernen fehlgeschlagen: ' + err.message; });
  }

  var areaLeaf = null, areaSel = null, areaNameTouched = false, areaCustom = null;
  var AREA_BAD = /[<{};@\\]/;
  function areaSelector() { return areaCustom || (areaSel && areaSelectorFor(areaSel)) || ''; }
  function renderAreaMeta() {
    selEditing = false;
    renderCrumbs(aMeta, areaLeaf, areaSel, function (node) {
      areaSel = node;
      areaCustom = null;
      if (!areaNameTouched) aName.value = areaName(node);
      hidePreview();
      renderAreaMeta();
    }, areaPanel, function () { return areaSelector() || 'Ohne Positionsangabe nicht eindeutig – Selektor bearbeiten oder ein übergeordnetes Element wählen'; });
    var line = aMeta.querySelector('.sel-full');
    if (line && !areaSelector()) line.classList.add('bad');
    attachSelEditor(aMeta, {
      value: function () { return areaCustom || fullPathFor(areaSel); },
      base: function () { return areaSel; },
      validate: function (v) { return AREA_BAD.test(v) ? 'Unzulässiges Zeichen (< { } ; @ \\).' : v.length > 200 ? 'Höchstens 200 Zeichen.' : ''; },
      apply: function (v, found) {
        if (!v) areaCustom = null;
        else {
          areaSel = found;
          areaCustom = v === areaSelectorFor(found) ? null : v;
          var inChain = false;
          for (var n = areaLeaf; n; n = n.parentElement) if (n === areaSel) inChain = true;
          if (!inChain) areaLeaf = areaSel;
          if (!areaNameTouched) aName.value = areaName(areaSel);
        }
        renderAreaMeta();
        aName.focus();
      },
      rerender: function () { renderAreaMeta(); aName.focus(); },
    });
    aSave.disabled = isBusy() || !areaSelector();
    if (areaSel) placeHighlight(areaSel, true);
  }
  function openAreaDialog(node) {
    closePrompt();
    areaLeaf = areaSel = node;
    areaNameTouched = false;
    areaCustom = null;
    aName.value = areaName(node);
    aErr.textContent = '';
    areaPanel.classList.add('open');
    renderAreaMeta();
    setTimeout(function () { aName.focus(); aName.select(); }, 0);
  }
  function closeAreaDialog() {
    if (!areaPanel.classList.contains('open')) return;
    areaPanel.classList.remove('open');
    areaLeaf = areaSel = null;
    areaCustom = null;
    selEditing = false;
    refreshHighlight();
  }
  aName.addEventListener('input', function () { areaNameTouched = true; });
  aName.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); aSave.click(); } });
  aCancel.addEventListener('click', closeAreaDialog);
  // Bereich nur in consistency.json aufnehmen (Seiten bleiben unverändert)
  aSave.addEventListener('click', function () {
    if (!areaSel) return;
    var selector = areaSelector();
    var name = aName.value.trim();
    if (!selector) { aErr.textContent = 'Kein eindeutiger Selektor. Bitte bearbeiten oder ein übergeordnetes Element wählen.'; return; }
    if (!name) { aErr.textContent = 'Bitte einen Namen angeben.'; return; }
    var c = (design && design.consistency) || { shared: [], ignore: ['class:active', 'class:current', 'aria-current'] };
    var shared = (c.shared || []).slice();
    if (shared.some(function (a) { return a.selector === selector; })) { aErr.textContent = 'Diesen Bereich gibt es schon (' + selector + ').'; return; }
    if (isDirty() && !window.confirm('Ungespeicherte Änderungen an Tokens und Regeln gehen dabei verloren. Trotzdem fortfahren?')) return;
    shared.push({ name: name, selector: selector, pages: 'all' });
    aSave.disabled = true;
    aErr.textContent = '';
    api('PUT', '/api/sites/' + encodeURIComponent(SLUG) + '/design', { consistency: { shared: shared, ignore: c.ignore || [] } })
      .then(function (data) {
        if (data && data.job) trackJob(data.job);
        try { sessionStorage.setItem(DESIGN_OPEN_KEY, '1'); } catch (e) { /* ignorieren */ }
        closeAreaDialog();
        showToast('Bereich „' + name + '“ wird aufgenommen …', false);
      })
      .catch(function (err) {
        aErr.textContent = err.status === 409 ? 'Es läuft noch ein Schritt oder wartet auf Prüfung.' : 'Fehlgeschlagen: ' + err.message;
        aSave.disabled = false;
      });
  });

  function syncAreas() {
    if (isDirty() && !window.confirm('Ungespeicherte Änderungen an Tokens und Regeln gehen dabei verloren. Trotzdem fortfahren?')) return;
    if (!window.confirm('Alle gleichen Bereiche von dieser Seite (' + currentPage() + ') auf alle anderen Seiten übernehmen?')) return;
    dAreasSync.disabled = true;
    api('POST', '/api/sites/' + encodeURIComponent(SLUG) + '/areas/sync', { page: currentPage() })
      .then(function (data) {
        if (data && data.job) trackJob(data.job);
        try { sessionStorage.setItem(DESIGN_OPEN_KEY, '1'); } catch (e) { /* ignorieren */ }
        showToast('Bereiche werden angeglichen …', false);
      })
      .catch(function (err) { dErr.textContent = err.status === 409 ? 'Es läuft noch ein Schritt oder wartet auf Prüfung.' : 'Fehlgeschlagen: ' + err.message; })
      .then(renderDesignButtons);
  }
  dAreasSync.addEventListener('click', syncAreas);
  dAreaPick.addEventListener('click', function () {
    if (selecting) stopSelecting();
    else startSelecting('area');
  });

  function renderDesign() {
    clear(dInfo);
    if (design && !design.initialized) {
      dInfo.appendChild(el('p', { class: 'hint', text: 'Für diese Website gibt es noch keine Design-Vorgaben. Sie werden beim Speichern oder beim nächsten Schritt angelegt.' }));
    }
    renderWarnings();
    renderAreas();
    renderTokens();
    renderScan();
    renderDesignButtons();
  }

  function loadDesign() {
    dErr.textContent = '';
    clear(dTokBody);
    dTokBody.appendChild(el('tr', {}, [el('td', { class: 'hint', text: 'Lade …' })]));
    return api('GET', '/api/sites/' + encodeURIComponent(SLUG) + '/design')
      .then(function (d) {
        design = d || { tokens: {}, notes: '' };
        dTokens = cloneTokens(design.tokens);
        dNotes.value = design.notes || '';
        dLoaded = true;
        clear(dPickBox);
        renderDesign();
      })
      .catch(function (err) {
        clear(dTokBody);
        dErr.textContent = 'Design-Vorgaben konnten nicht geladen werden: ' + err.message;
      });
  }

  function addToken() {
    var cat = dAddCat.value;
    var name = dAddName.value.trim().toLowerCase();
    var value = dAddVal.value.trim();
    var key = cat + '.' + name;
    dErr.textContent = '';
    if (!NAME_RE.test(name)) {
      dErr.textContent = 'Name: nur Kleinbuchstaben, Ziffern und Bindestriche (z. B. primary, button-hover).';
      dAddName.focus();
      return;
    }
    if (dTokens[key]) {
      dErr.textContent = 'Den Token ' + key + ' gibt es schon. Wert in der Tabelle ändern.';
      return;
    }
    var err = checkTokenValue(value);
    if (err) {
      dErr.textContent = key + ': ' + err;
      dAddVal.classList.add('bad');
      dAddVal.focus();
      return;
    }
    dTokens[key] = { value: value, locked: false };
    dAddName.value = '';
    dAddVal.value = '';
    dAddVal.classList.remove('bad');
    renderTokens();
    renderScan();
    renderDesignButtons();
    dAddName.focus();
  }

  function saveDesign() {
    if (!isDirty() || hasInvalid()) return;
    var body = {};
    if (tokensChanged()) body.tokens = cloneTokens(dTokens);
    if (dNotes.value !== (design.notes || '')) body.notes = dNotes.value;
    dSave.disabled = true;
    dErr.textContent = '';
    api('PUT', '/api/sites/' + encodeURIComponent(SLUG) + '/design', body)
      .then(function (data) {
        if (data && data.job) trackJob(data.job);
        try { sessionStorage.setItem(DESIGN_OPEN_KEY, '1'); } catch (e) { /* ignorieren */ }
        showToast('Design-Vorgaben werden gespeichert …', false);
      })
      .catch(function (err) {
        dErr.textContent = err.status === 409 ? 'Es läuft noch ein Schritt oder wartet auf Prüfung.' : 'Speichern fehlgeschlagen: ' + err.message;
      })
      .then(renderDesignButtons);
  }

  function proposeTokens() {
    if (isDirty() && !window.confirm('Ungespeicherte Änderungen gehen dabei verloren. Trotzdem Tokens aus dem Abzug ableiten?')) return;
    dPropose.disabled = true;
    dErr.textContent = '';
    api('POST', '/api/sites/' + encodeURIComponent(SLUG) + '/tokens/propose')
      .then(function (data) {
        if (data && data.job) trackJob(data.job);
        try { sessionStorage.setItem(DESIGN_OPEN_KEY, '1'); } catch (e) { /* ignorieren */ }
        showToast('Claude leitet Tokens aus dem Abzug ab …', false);
      })
      .catch(function (err) {
        dErr.textContent = err.status === 409 ? 'Es läuft noch ein Schritt oder wartet auf Prüfung.' : 'Fehlgeschlagen: ' + err.message;
      })
      .then(renderDesignButtons);
  }

  // Berechnete Werte eines angeklickten Elements als Token-Vorschläge
  function pickValues(node) {
    var cs = window.getComputedStyle(node);
    var tag = node.tagName.toLowerCase();
    var heading = /^h[1-6]$/.test(tag);
    var buttonish = tag === 'button' || (tag === 'a' && /btn|button/i.test(node.className || '')) || node.getAttribute('role') === 'button';
    var items = [];
    function add(cat, label, value, name) {
      if (!value) return;
      value = String(value).trim();
      if (checkTokenValue(value)) return;
      items.push({ cat: cat, label: label, value: value, name: name });
    }
    add('color', 'Textfarbe', cssColor(cs.color), heading ? 'heading' : buttonish ? 'button-text' : 'text');
    add('color', 'Hintergrund', cssColor(cs.backgroundColor), buttonish ? 'button' : 'background');
    if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') add('color', 'Rahmenfarbe', cssColor(cs.borderTopColor), 'border');
    add('font', 'Schrift', cs.fontFamily, heading ? 'heading' : 'body');
    add('size', 'Schriftgröße', cs.fontSize, heading ? tag : buttonish ? 'button' : 'body');
    var radius = cs.borderRadius || cs.borderTopLeftRadius;
    if (radius && !/^0(px)?$/.test(radius)) add('radius', 'Eckenradius', radius, buttonish ? 'button' : 'default');
    if (cs.boxShadow && cs.boxShadow !== 'none') add('shadow', 'Schatten', cs.boxShadow, buttonish ? 'button' : 'default');
    var pad = cs.padding || [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' ');
    if (pad && !/^(0px\s*)+$/.test(pad)) add('space', 'Innenabstand', pad, buttonish ? 'button' : tag);
    return items;
  }

  function showPick(node) {
    clear(dPickBox);
    var items = pickValues(node);
    var close = iconButton('x', 'Auswahl schließen', { class: 'ghost' }, true);
    close.addEventListener('click', function () { clear(dPickBox); });
    var box = el('div', { class: 'pickbox', role: 'group', 'aria-label': 'Werte des Elements' }, [
      el('div', { class: 'pick-head' }, [icon('pipette', 14), el('span', { class: 'spacer', text: describe(node) }), close]),
    ]);
    if (!items.length) box.appendChild(el('div', { class: 'hint', text: 'Keine übernehmbaren Werte gefunden.' }));
    items.forEach(function (it) {
      var used = tokenFor(it.cat, it.value);
      var right;
      if (used) right = el('span', { class: 'is', text: '= ' + used });
      else {
        right = iconButton('plus', 'Als Token übernehmen (' + CAT_LABEL[it.cat] + ')', {}, true);
        right.addEventListener('click', function () { prefill(it.cat, it.value, it.name); });
      }
      box.appendChild(el('div', { class: 'pick-row' }, [
        el('span', { class: 'lbl2', text: it.label }),
        it.cat === 'color' ? swatch(it.value) : null,
        el('code', { text: it.value }),
        right,
      ]));
    });
    dPickBox.appendChild(box);
    setTimeout(function () {
      var b = dPickBox.querySelector('.pick-row button') || close;
      b.focus();
    }, 0);
  }

  function openDesign() {
    if (selecting) stopSelecting();
    closePrompt();
    closeHistory();
    reviewPanel.classList.remove('open');
    designPanel.classList.add('open');
    ui.classList.add('sb-open', 'sb-design');
    btnDesign.classList.add('on');
    btnDesign.setAttribute('aria-expanded', 'true');
    // Ungespeicherte Änderungen beim erneuten Öffnen behalten
    if (!dLoaded || !isDirty()) loadDesign();
    setTimeout(function () { dClose.focus(); }, 0);
  }

  function closeDesign() {
    if (!designPanel.classList.contains('open')) return;
    if (selecting && selectMode !== 'annotate') stopSelecting();
    closeAreaDialog();
    designPanel.classList.remove('open');
    ui.classList.remove('sb-design');
    if (!historyPanel.classList.contains('open')) ui.classList.remove('sb-open');
    btnDesign.classList.remove('on');
    btnDesign.setAttribute('aria-expanded', 'false');
  }

  btnDesign.addEventListener('click', function () {
    if (designPanel.classList.contains('open')) closeDesign();
    else openDesign();
  });
  dClose.addEventListener('click', closeDesign);
  dReload.addEventListener('click', function () {
    if (isDirty() && !window.confirm('Ungespeicherte Änderungen verwerfen und neu laden?')) return;
    loadDesign();
  });
  dReset.addEventListener('click', function () {
    if (!window.confirm('Alle ungespeicherten Änderungen zurücksetzen?')) return;
    dTokens = cloneTokens(design.tokens);
    dNotes.value = design.notes || '';
    renderDesign();
  });
  dSave.addEventListener('click', saveDesign);
  dPropose.addEventListener('click', proposeTokens);
  dAddBtn.addEventListener('click', addToken);
  [dAddName, dAddVal].forEach(function (inp) {
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        addToken();
      }
    });
  });
  dAddVal.addEventListener('input', function () { dAddVal.classList.toggle('bad', !!dAddVal.value && !!checkTokenValue(dAddVal.value)); });
  dNotes.addEventListener('input', renderDesignButtons);
  dNotes.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveDesign();
    }
  });
  dPick.addEventListener('click', function () {
    if (selecting) stopSelecting();
    else startSelecting('token');
  });

  // ------------------------------------------- Änderungen erkennen (Inspektor, Styles-Panel, Dateien)
  // Vergleicht die Seite im Browser mit der Datei (Elemente) und die CSS-Regeln mit dem Stand kurz nach dem Laden.
  // Was Scripts der Website beim Laden oder fortlaufend (Slider o. Ä.) ändern, wird so weit wie möglich ausgeblendet.

  var chRef = null; // Datei-Fassung der Seite (DOMParser)
  var chNoise = new Map(); // live-Element -> outerHTML beim Grundzustand (Änderungen durch Scripts beim Laden)
  var chAnimated = new Set(); // Elemente, die sich laufend ändern
  var chSeen = new Map(); // live-Element -> { html, times: [] }
  var chCssBase = null; // key -> { selector, media, style: {prop: wert} }
  var chDom = [], chCss = [], chFiles = { changed: 0, files: [] };
  var chReady = false;
  var chSettleUntil = 0; // bis dahin gehört alles, was sich ändert, zum Ausgangszustand (späte Scripts, Stylesheets)
  var STABLE_MS = 1500; // eine Änderung zählt erst, wenn sie so lange unverändert bleibt

  function isModio(n) { return n === host || (n.nodeType === 1 && (n.hasAttribute('data-modio') || n.id === 'modio-overlay-host')); }
  function kids(n) { return Array.prototype.filter.call(n.children, function (c) { return !isModio(c); }); }
  function sameAttrs(a, b) {
    if (a.attributes.length !== b.attributes.length) return false;
    for (var i = 0; i < a.attributes.length; i++) if (b.getAttribute(a.attributes[i].name) !== a.attributes[i].value) return false;
    return true;
  }
  function ownText(n) { var t = ''; for (var c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) t += c.data; return t; }
  function sig(n) { return n.tagName + '#' + (n.id || '') + '.' + (n.getAttribute('class') || ''); }

  // Kleinste geänderte Elemente: Paare {live, ref}
  function diffWalk(live, ref, out, isRoot) {
    if (!isRoot && live.outerHTML === ref.outerHTML) return; // eigene Elemente gibt es nur direkt unter body
    if (!isRoot && (live.tagName !== ref.tagName || !sameAttrs(live, ref) || ownText(live) !== ownText(ref))) { out.push({ live: live, ref: ref }); return; }
    var lk = kids(live), rk = kids(ref), j = 0;
    for (var i = 0; i < rk.length; i++) {
      while (j < lk.length && sig(lk[j]) !== sig(rk[i]) && !(lk.length === rk.length)) j++; // von Scripts eingefügte Elemente überspringen
      if (j >= lk.length) { if (!isRoot) out.push({ live: live, ref: ref }); return; }
      diffWalk(lk[j], rk[i], out, false);
      j++;
    }
  }

  function computeDom() {
    if (!chRef || !document.body) return [];
    var pairs = [];
    diffWalk(document.body, chRef.body, pairs, true);
    var now = Date.now();
    if (now < chSettleUntil) {
      pairs.forEach(function (p) { chNoise.set(p.live, p.live.outerHTML); });
      return [];
    }
    return pairs.filter(function (p) {
      var h = p.live.outerHTML;
      if (chNoise.has(p.live) && chNoise.get(p.live) === h) return false;
      if (chAnimated.has(p.live)) return false;
      var seen = chSeen.get(p.live);
      if (!seen) chSeen.set(p.live, seen = { html: h, times: [], since: now });
      else if (seen.html !== h) {
        seen.html = h;
        seen.since = now;
        seen.times = seen.times.filter(function (t) { return now - t < 15000; }).concat(now);
        if (seen.times.length >= 3) { chAnimated.add(p.live); return false; }
      }
      if (now - seen.since < STABLE_MS) { scheduleCheckIn(STABLE_MS - (now - seen.since) + 50); return false; }
      p.after = h;
      p.before = p.ref.outerHTML;
      p.selector = selectorFor(p.ref, chRef);
      return true;
    });
  }

  // CSS-Regeln aller (lesbaren) Stylesheets der Seite, ohne die eigenen Tokens
  function cssSnapshot() {
    var snap = new Map();
    Array.prototype.forEach.call(document.styleSheets, function (sheet, si) {
      var owner = sheet.ownerNode;
      var om = owner && owner.getAttribute ? owner.getAttribute('data-modio') : null;
      if (om === 'tokens' || om === 'components' || om === 'draft') return;
      var rules;
      try { rules = sheet.cssRules; } catch (e) { return; }
      var base = (sheet.href || 'inline-' + si);
      (function walk(list, prefix, media) {
        Array.prototype.forEach.call(list || [], function (r, i) {
          var key = prefix + '/' + i;
          if (r.type === 1) {
            var st = {};
            for (var k = 0; k < r.style.length; k++) {
              var prop = r.style[k];
              st[prop] = r.style.getPropertyValue(prop) + (r.style.getPropertyPriority(prop) ? ' !important' : '');
            }
            snap.set(key, { selector: r.selectorText, media: media, style: st });
          } else if (r.type === 4) walk(r.cssRules, key, r.conditionText || (r.media && r.media.mediaText) || '');
          else if (r.type === 3) { try { if (r.styleSheet && !/__tokens\.css/.test(r.href)) walk(r.styleSheet.cssRules, key, media); } catch (e) { /* fremde Herkunft */ } }
          else if (window.CSSLayerBlockRule && r instanceof window.CSSLayerBlockRule) walk(r.cssRules, key, media);
        });
      })(rules, base, '');
    });
    return snap;
  }

  var chCssSeen = new Map(); // key -> { sig, since }
  function computeCss() {
    if (!chCssBase) return [];
    if (Date.now() < chSettleUntil) { chCssBase = cssSnapshot(); return []; }
    var out = [];
    var now = Date.now();
    cssSnapshot().forEach(function (r, key) {
      var b = chCssBase.get(key);
      var props = Object.keys(r.style).filter(function (p) { return !b || b.selector !== r.selector || b.style[p] !== r.style[p]; });
      if (!props.length) return;
      var sigText = r.selector + '|' + props.map(function (p) { return p + ':' + r.style[p]; }).join(';');
      var cs = chCssSeen.get(key);
      if (!cs || cs.sig !== sigText) { chCssSeen.set(key, cs = { sig: sigText, since: now }); }
      if (now - cs.since < STABLE_MS) return;
      out.push({
        key: key, selector: r.selector, media: r.media || null,
        decls: props.map(function (p) { return p + ': ' + r.style[p].replace(/\s*!important$/, ''); }).join('; '),
        before: b && b.selector === r.selector ? props.map(function (p) { return b.style[p] ? p + ': ' + b.style[p] : null; }).filter(Boolean).join('; ') : '',
      });
    });
    return out;
  }

  function loadFileStatus() {
    var startedIdle = !isBusy();
    return api('GET', '/api/sites/' + encodeURIComponent(SLUG) + '/status').then(function (d) {
      // Nur gelten lassen, wenn vor und nach der Abfrage kein Auftrag lief
      chFiles = startedIdle && !isBusy() && !reloading ? d || { changed: 0, files: [] } : { changed: 0, files: [] };
    }).catch(function () { /* egal */ });
  }

  var chTimer = null;
  function scheduleCheck() { clearTimeout(chTimer); chTimer = setTimeout(runCheck, 700); }
  function scheduleCheckIn(ms) { clearTimeout(chTimer); chTimer = setTimeout(runCheck, ms); }
  function runCheck() {
    if (!chReady) return;
    chDom = computeDom();
    chCss = computeCss();
    renderChangesButton();
    if (changesPanel.classList.contains('open')) renderChanges(false);
  }

  function chTotal() { return chDom.length + chCss.length + (chFiles.changed ? 1 : 0); }
  function renderChangesButton() {
    var n = chDom.length + chCss.length + chFiles.changed;
    btnChanges.style.display = n && !isBusy() && !reloading ? '' : 'none';
    btnChanges.title = btnChanges.modioLabel.textContent = 'Änderungen übernehmen (' + n + ')';
    btnChanges.modioCount.textContent = String(n);
  }

  // Grundzustand: Datei laden, Unterschiede und CSS kurz nach dem Laden als „Scripts der Website“ merken
  function initChanges() {
    if (PREVIEW) return; // Vorschau weicht absichtlich von der Datei ab
    fetch(location.pathname + location.search, { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { return r.text(); })
      .then(function (text) {
        chRef = new DOMParser().parseFromString(text, 'text/html');
        setTimeout(function () {
          var initial = [];
          diffWalk(document.body, chRef.body, initial, true);
          initial.forEach(function (p) { chNoise.set(p.live, p.live.outerHTML); });
          chCssBase = cssSnapshot();
          chSettleUntil = Date.now() + 7500; // insgesamt ca. 10 s nach dem Laden
          setTimeout(runCheck, 7600);
          chReady = true;
          new MutationObserver(function (list) {
            for (var i = 0; i < list.length; i++) {
              var t = list[i].target;
              if (t === document.documentElement || t === host || (t.nodeType === 1 && isModio(t))) continue;
              scheduleCheck();
              return;
            }
          }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
          setInterval(function () { if (!document.hidden) { chCss = computeCss(); renderChangesButton(); } }, 1000);
          setInterval(function () { if (!document.hidden && !isBusy()) loadFileStatus().then(renderChangesButton); }, 5000);
          loadFileStatus().then(runCheck);
        }, 2500);
      })
      .catch(function () { /* ohne Datei keine Erkennung */ });
  }

  // ---- Panel
  var cBody = el('div');
  var cErr = el('div', { class: 'err', role: 'alert' });
  var cCss = el('input', { type: 'checkbox' });
  var cCssRow = el('label', { class: 'switch', title: 'Geänderte Inline-Styles (style="…") nicht ins HTML schreiben, sondern als Regel mit !important in overrides.css' }, [cCss, 'Inline-Styles als Regel in overrides.css übernehmen']);
  var cClose = el('button', { type: 'button', text: 'Schließen' });
  var cApply = el('button', { type: 'button', class: 'primary', text: 'Ausgewählte übernehmen' });
  var changesPanel = el('div', { class: 'panel wide', role: 'dialog', 'aria-labelledby': 'modio-ch' }, [
    el('h2', { id: 'modio-ch', text: 'Änderungen übernehmen' }),
    cBody,
    el('div', { class: 'checks' }, [cCssRow]),
    cErr,
    el('div', { class: 'row end' }, [cClose, cApply]),
  ]);
  ui.appendChild(changesPanel);
  var chChecks = [];

  function renderChanges(resetChecks) {
    var prev = {};
    chChecks.forEach(function (c) { prev[c.id] = c.box.checked; });
    clear(cBody);
    chChecks = [];
    if (chFiles.changed) {
      var fb = el('button', { type: 'button', text: 'Dateien übernehmen' });
      fb.addEventListener('click', commitFiles);
      cBody.appendChild(el('section', { class: 'dsec' }, [
        el('h3', { text: 'Geänderte Dateien (' + chFiles.changed + ')' }),
        el('ul', { class: 'flist' }, chFiles.files.slice(0, 12).map(function (f) { return el('li', {}, [el('code', { text: f })]); })),
        el('div', { class: 'row' }, [fb, el('span', { class: 'hint', text: 'Editor, Chrome-Workspaces o. Ä. – wird geprüft und als Schritt gespeichert.' })]),
      ]));
    }
    var anyStyle = false;
    function item(id, label, sub, diffText) {
      var box = el('input', { type: 'checkbox' });
      box.checked = resetChecks || prev[id] === undefined ? true : prev[id];
      box.addEventListener('change', renderApply);
      chChecks.push({ id: id, box: box });
      var pre = el('pre', { class: 'diff' });
      renderDiffInto(pre, diffText);
      return el('li', { class: 'chitem' }, [
        el('label', { class: 'switch' }, [box, el('code', { text: label }), sub ? el('span', { class: 'hint', text: sub }) : null]),
        el('details', {}, [el('summary', {}, [icon('chevron', 14), 'Unterschied']), pre]),
      ]);
    }
    if (chDom.length) {
      cBody.appendChild(el('section', { class: 'dsec' }, [
        el('h3', { text: 'Im Inspektor geänderte Elemente (' + chDom.length + ')' }),
        el('ul', { class: 'chlist' }, chDom.map(function (p, i) {
          var so = styleMap(p.ref.getAttribute('style')), sn = styleMap(p.live.getAttribute('style'));
          p.styleChanged = Object.keys(sn).filter(function (k) { return sn[k] !== so[k]; });
          if (p.styleChanged.length) anyStyle = true;
          return item('d' + i, p.selector, null, lineDiff(htmlLines(p.before), htmlLines(p.after)));
        })),
      ]));
    }
    if (chCss.length) {
      cBody.appendChild(el('section', { class: 'dsec' }, [
        el('h3', { text: 'Im Styles-Panel geänderte CSS-Regeln (' + chCss.length + ')' }),
        el('ul', { class: 'chlist' }, chCss.map(function (r, i) {
          return item('c' + i, r.selector, r.media ? '@media ' + r.media : 'kommt als Regel in overrides.css',
            (r.before ? r.before.split('; ').map(function (d) { return '-' + d; }).join('\n') + '\n' : '') + r.decls.split('; ').map(function (d) { return '+' + d; }).join('\n'));
        })),
      ]));
    }
    if (!chFiles.changed && !chDom.length && !chCss.length) cBody.appendChild(el('p', { class: 'hint', text: 'Keine Änderungen erkannt.' }));
    cCssRow.style.display = anyStyle ? '' : 'none';
    if (resetChecks) cCss.checked = anyStyle;
    renderApply();
  }

  function renderApply() {
    var sel = chChecks.filter(function (c) { return c.box.checked; }).length;
    cApply.disabled = isBusy() || !sel || chFiles.changed > 0;
    cApply.title = chFiles.changed ? 'Erst die geänderten Dateien übernehmen (oder verwerfen)' : '';
    cApply.style.display = chDom.length || chCss.length ? '' : 'none';
  }

  function openChanges() {
    closePanels();
    cErr.textContent = '';
    loadFileStatus().then(function () {
      chDom = computeDom();
      chCss = computeCss();
      renderChanges(true);
      changesPanel.classList.add('open');
      setTimeout(function () { cClose.focus(); }, 0);
    });
  }
  function closeChanges() { changesPanel.classList.remove('open'); }

  function commitFiles() {
    api('POST', '/api/sites/' + encodeURIComponent(SLUG) + '/local-commit')
      .then(function (data) { if (data && data.job) trackJob(data.job); closeChanges(); showToast('Geänderte Dateien werden geprüft …', false); })
      .catch(function (err) { cErr.textContent = err.status === 409 ? 'Es läuft noch ein Schritt oder wartet auf Prüfung.' : 'Fehlgeschlagen: ' + err.message; });
  }

  cApply.addEventListener('click', function () {
    var on = {};
    chChecks.forEach(function (c) { on[c.id] = c.box.checked; });
    var items = [], rules = [];
    chDom.forEach(function (p, i) {
      if (!on['d' + i]) return;
      var html = p.after, css = '';
      if (cCss.checked && p.styleChanged && p.styleChanged.length) {
        var tmp = document.createElement('template');
        tmp.innerHTML = html;
        var r0 = tmp.content.firstElementChild, orig = p.ref.getAttribute('style');
        var sn = styleMap(p.live.getAttribute('style'));
        if (orig === null) r0.removeAttribute('style'); else r0.setAttribute('style', orig);
        html = r0.outerHTML;
        css = p.styleChanged.map(function (k) { return k + ': ' + sn[k]; }).join('; ');
      }
      items.push({ selector: p.selector, html: html, css: css });
    });
    chCss.forEach(function (r, i) { if (on['c' + i]) rules.push({ selector: r.selector, decls: r.decls, media: r.media }); });
    if (!items.length && !rules.length) return;
    cApply.disabled = true;
    api('POST', '/api/sites/' + encodeURIComponent(SLUG) + '/inspect', { page: currentPage(), items: items, rules: rules })
      .then(function (data) { if (data && data.job) trackJob(data.job); closeChanges(); showToast('Änderungen werden übernommen …', false); })
      .catch(function (err) { cErr.textContent = err.status === 409 ? 'Es läuft noch ein Schritt oder wartet auf Prüfung.' : 'Fehlgeschlagen: ' + err.message; renderApply(); });
  });
  cClose.addEventListener('click', closeChanges);
  btnChanges.addEventListener('click', function () { if (changesPanel.classList.contains('open')) closeChanges(); else openChanges(); });

  // ------------------------------------------------------------- Entwürfe (Komponenten)
  // Ein Entwurf entsteht ohne Altlasten als Komponente; die Vorschau zeigt die echte Seite mit ersetztem Element.
  // In der Vorschau lassen sich Versionen, „Aktuell“ und Bausteine live umschalten (ohne Neuladen).

  var drafts = [];
  var draftCurrent = null; // id des geöffneten Entwurfs
  var draftVersion = null; // gewählte Version im Panel
  var draftToggles = {}; // Baustein-key -> 'neu' | 'bestand' (vom Stand der Version abweichend)
  var draftBefund = {}; // Befund-ID -> true (umsetzen) | false (zurücknehmen)
  var draftText = {}; // Entwurf-ID -> Text im Feld „Nachbessern“ (bleibt beim Neuzeichnen erhalten)
  var draftNotes = {}; // Entwurf-ID -> [{ selector, label, snippet, desc }] Hinweise zu Elementen
  var befundOpen = false; // Befund im Panel aufgeklappt
  var ideaOpen = false; // Gestaltungsidee im Panel aufgeklappt
  function leavePreview() { location.href = location.pathname + cleanSearch(); }
  // Live-Vorschau: aktuell gezeigter Stand (0 = Aktuell) und das ersetzte Element in der Seite
  var pvLive = { node: null, shown: PREVIEW ? PREVIEW.version : null, lastV: PREVIEW ? PREVIEW.version : null, cache: {} };
  if (PREVIEW && PREVIEW.name) pvLive.node = document.querySelector('.mx-' + PREVIEW.name);

  var btnDrafts = iconButton('pencilSparkles', 'Entwürfe', { 'aria-expanded': 'false', 'aria-controls': 'modio-drafts' }, true);
  btnDrafts.modioCount = el('span', { class: 'cnt', 'aria-hidden': 'true' });
  btnDrafts.appendChild(btnDrafts.modioCount);
  bar.insertBefore(btnDrafts, btnFollowup);
  var dBody = el('div');
  var dErr = el('div', { class: 'err', role: 'alert' });
  var dClose = iconButton('x', 'Entwürfe schließen', { class: 'ghost' }, true);
  var dBack = iconButton('undo', 'Zur Liste', { class: 'ghost' }, true);
  var dTitle = el('span', { text: 'Entwürfe' });
  var dScroll = el('div', { class: 'sb-body' }, [dErr, dBody]);
  var draftsPanel = el('aside', { id: 'modio-drafts', class: 'sidebar drafts', role: 'complementary', 'aria-labelledby': 'modio-dh' }, [
    el('div', { class: 'sb-head' }, [dBack, el('h2', { id: 'modio-dh' }, [icon('pencilSparkles', 18), dTitle]), el('span', { class: 'spacer' }), dClose]),
    dScroll,
  ]);
  ui.appendChild(draftsPanel);


  var DRAFT_PARAM = '__modio_draft', DRAFT_V_PARAM = '__modio_v';
  function cleanSearch() {
    var sp = new URLSearchParams(location.search);
    sp.delete(DRAFT_PARAM); sp.delete(DRAFT_V_PARAM);
    var s = sp.toString();
    return s ? '?' + s : '';
  }
  function pageUrl(page) { return BASE + page.split('/').map(encodeURIComponent).join('/'); }
  function previewUrl(d, v) {
    var sp = new URLSearchParams(d.page === currentPage() ? cleanSearch() : '');
    sp.set(DRAFT_PARAM, d.id); sp.set(DRAFT_V_PARAM, String(v));
    return (d.page === currentPage() ? location.pathname : pageUrl(d.page)) + '?' + sp.toString();
  }
  function currentUrl(d) { return d.page === currentPage() ? location.pathname + cleanSearch() : pageUrl(d.page); }
  function latest(d) { return d.versions.length ? d.versions[d.versions.length - 1] : null; }
  function versionOf(d, v) { return d.versions.filter(function (x) { return x.v === v; })[0] || null; }
  function draftById(id) { return drafts.filter(function (x) { return x.id === id; })[0] || null; }
  function draftLabel(d) { var l = latest(d); return (l && l.title) || truncate(d.prompt, 60); }
  function draftsApi(path, body) { return api('POST', '/api/sites/' + encodeURIComponent(SLUG) + '/drafts' + path, body || {}); }
  // Element der Komponente in der Vorschau finden; Name notfalls aus den Entwurfsdaten (älterer Server ohne preview.name)
  function ensureLiveNode() {
    if (!PREVIEW || (pvLive.node && pvLive.node.isConnected)) return pvLive.node;
    if (!PREVIEW.name) {
      var d = draftById(PREVIEW.draft), v = d && versionOf(d, PREVIEW.version);
      if (v && v.name) PREVIEW.name = v.name;
    }
    if (PREVIEW.name && pvLive.shown) pvLive.node = document.querySelector('.mx-' + PREVIEW.name);
    return pvLive.node;
  }
  function liveFor(d) { return !!(PREVIEW && d && PREVIEW.draft === d.id && ensureLiveNode() && pvLive.node.isConnected); }
  // Knopf zur Live-Vorschau für Hinweise, wenn das Panel außerhalb der Vorschau geöffnet ist
  function liveButton(d, v) {
    var b = iconButton('click', PREVIEW && PREVIEW.draft === d.id ? 'Version v' + v.v + ' zeigen' : 'Live-Vorschau v' + v.v + ' öffnen');
    b.addEventListener('click', function () { showLive(d, v.v); });
    return b;
  }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function renderDraftsButton() {
    var open = drafts.filter(function (d) { return d.status === 'open'; }).length;
    btnDrafts.modioCount.textContent = String(open);
    btnDrafts.modioCount.style.display = open ? '' : 'none';
    btnDrafts.title = btnDrafts.modioLabel.textContent = 'Entwürfe' + (open ? ' (' + open + ' offen)' : '');
  }

  function loadDrafts() {
    return api('GET', '/api/sites/' + encodeURIComponent(SLUG) + '/drafts')
      .then(function (d) {
        drafts = (d && d.drafts) || [];
        var pd = PREVIEW && draftById(PREVIEW.draft);
        if (PREVIEW && (!pd || pd.status !== 'open') && !reloading) {
          try { sessionStorage.setItem(FLASH_KEY, 'Entwurf ' + PREVIEW.draft + (pd ? (pd.status === 'applied' ? ' ist übernommen' : ' ist verworfen') : ' nicht gefunden') + ' – Vorschau beendet.'); } catch (e) { /* ignorieren */ }
          reloading = true;
          leavePreview();
          return;
        }
        renderDraftsButton();
        if (draftsPanel.classList.contains('open')) renderDrafts();
        applyToggles();
        renderPreviewBand();
      })
      .catch(function (err) { dErr.textContent = 'Entwürfe nicht ladbar: ' + err.message; });
  }

  // ---- Live-Umschalten in der Vorschau

  function fetchStateHtml(d, v) {
    if (pvLive.cache[v]) return Promise.resolve(pvLive.cache[v]);
    var p = v === 0
      ? fetch(location.pathname + cleanSearch(), { cache: 'no-store', credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (t) {
        var n = new DOMParser().parseFromString(t, 'text/html').querySelector(d.selector);
        if (!n) throw new Error('Element der aktuellen Seite nicht gefunden');
        return n.outerHTML;
      })
      : api('GET', '/api/sites/' + encodeURIComponent(SLUG) + '/drafts/' + d.id + '/versions/' + v).then(function (r) { return r.html; });
    return p.then(function (html) { pvLive.cache[v] = html; return html; });
  }

  function showLive(d, v) {
    if (!liveFor(d)) { location.href = v ? previewUrl(d, v) : currentUrl(d); return Promise.resolve(); }
    if (v === pvLive.shown) return Promise.resolve();
    return fetchStateHtml(d, v).then(function (html) {
      var t = document.createElement('template');
      t.innerHTML = String(html).trim();
      var n = t.content.firstElementChild;
      if (!n) throw new Error('Leeres Markup');
      pvLive.node.replaceWith(n);
      pvLive.node = n;
      var draftLink = document.querySelector('link[data-modio="draft"]');
      var compLink = document.querySelector('link[data-modio="components"]');
      if (v) {
        if (draftLink) { draftLink.disabled = false; draftLink.href = BASE + '/__draft.css?d=' + encodeURIComponent(d.id) + '&v=' + v; }
        if (compLink && PREVIEW.name) compLink.href = BASE + '/__components.css?exclude=' + encodeURIComponent(PREVIEW.name);
        PREVIEW.version = v;
        pvLive.lastV = v;
        if (draftVersion !== v) { draftVersion = v; draftToggles = {}; draftBefund = {}; }
        try { history.replaceState(null, '', previewUrl(d, v)); } catch (e) { /* ignorieren */ }
      } else {
        if (draftLink) draftLink.disabled = true;
        if (compLink) compLink.href = BASE + '/__components.css'; // bei einer Überarbeitung: bisherige Komponente zeigen
      }
      pvLive.shown = v;
      applyToggles();
      markPlaceholders(!!document.querySelector('style[data-modio="platzhalter"]'));
      renderPreviewBand();
      if (draftsPanel.classList.contains('open')) renderDrafts();
    }).catch(function (e) { showToast('Umschalten fehlgeschlagen: ' + e.message, true); });
  }

  // Bausteine live umschalten: Klassen der gewählten Quelle setzen (CSS für „neu“ liegt immer vor)
  function splitCls(s) { return String(s || '').split(/\s+/).filter(Boolean); }
  function applyToggles() {
    if (!PREVIEW || !pvLive.node || !pvLive.shown) return;
    var d = draftById(PREVIEW.draft), v = d && versionOf(d, pvLive.shown);
    if (!v || !v.bausteine) return;
    v.bausteine.forEach(function (b) {
      var k = b.klassen || {};
      var key = String(b.key || b.label);
      var target = draftToggles[key] || (b.source === 'bestand' ? 'bestand' : 'neu');
      var add = splitCls(target === 'bestand' ? k.bestand : k.neu);
      if (!add.length || !splitCls(k.bestand).length || !splitCls(k.neu).length) return;
      var rm = splitCls(k.neu).concat(splitCls(k.bestand));
      var nodes = Array.prototype.slice.call(pvLive.node.querySelectorAll('[data-mx-baustein]')).filter(function (n) { return n.getAttribute('data-mx-baustein') === key; });
      if (pvLive.node.getAttribute('data-mx-baustein') === key) nodes.push(pvLive.node);
      nodes.forEach(function (n) {
        rm.forEach(function (c) { n.classList.remove(c); });
        add.forEach(function (c) { n.classList.add(c); });
      });
    });
  }
  function canLiveToggle(b) { var k = b.klassen || {}; return splitCls(k.neu).length > 0 && splitCls(k.bestand).length > 0; }

  function markPlaceholders(on) {
    var st = document.querySelector('style[data-modio="platzhalter"]');
    if (on && !st) document.head.appendChild(el('style', { 'data-modio': 'platzhalter', text: '[data-mx-platzhalter]{outline:2px dashed #7c3aed !important;outline-offset:2px !important;cursor:help}' }));
    if (!on && st) st.remove();
    Array.prototype.forEach.call(document.querySelectorAll('[data-mx-platzhalter]'), function (n) {
      if (on) { if (!n.hasAttribute('data-mx-title')) n.setAttribute('data-mx-title', n.getAttribute('title') || ''); n.setAttribute('title', 'Platzhalter: ' + n.getAttribute('data-mx-platzhalter')); }
      else if (n.hasAttribute('data-mx-title')) { var t = n.getAttribute('data-mx-title'); if (t) n.setAttribute('title', t); else n.removeAttribute('title'); n.removeAttribute('data-mx-title'); }
    });
  }

  // ---- Hinweise zu einzelnen Elementen der Komponente

  function relSelector(node) {
    var base = '.mx-' + (PREVIEW && PREVIEW.name || '');
    if (node === pvLive.node) return base;
    var path = [];
    for (var n = node; n && n !== pvLive.node; n = n.parentElement) path.unshift(segmentFor(n));
    return base + ' > ' + path.join(' > ');
  }
  function addDraftNote(node) {
    var d = PREVIEW && draftById(PREVIEW.draft);
    if (!d || !pvLive.node || !pvLive.node.contains(node)) return;
    var list = draftNotes[d.id] = draftNotes[d.id] || [];
    list.push({ selector: relSelector(node), label: describe(node), snippet: truncate((node.innerText || node.textContent || '').trim().replace(/\s+/g, ' '), 60), desc: '' });
    openDrafts(d.id, pvLive.shown || null, true);
    setTimeout(function () { var f = dBody.querySelector('[data-fk="note-' + (list.length - 1) + '"]'); if (f) f.focus(); }, 0);
  }
  function noteNode(n) { try { return document.querySelector(n.selector); } catch (e) { return null; } }

  // ---- Panel

  // Neu zeichnen, ohne Scrollposition und Fokus zu verlieren
  function renderDrafts() {
    var sc = dScroll.scrollTop;
    var a = root.activeElement;
    var fk = a && a.getAttribute ? a.getAttribute('data-fk') : null;
    clear(dBody);
    var d = draftCurrent && draftById(draftCurrent);
    dBack.style.display = d ? '' : 'none';
    if (d) renderDraftDetail(d);
    else renderDraftList();
    dScroll.scrollTop = sc;
    if (fk) { var f = dBody.querySelector('[data-fk="' + fk + '"]'); if (f) f.focus({ preventScroll: true }); }
  }

  function renderDraftList() {
    dTitle.textContent = 'Entwürfe';
    dBody.appendChild(el('p', { class: 'hint', text: 'Element auswählen und im Dialog „Entwurf erstellen“ wählen. Claude gestaltet es ohne Altlasten als eigene Komponente; erst „Übernehmen“ ändert die Website. Eine übernommene Komponente (Klasse mx-…) lässt sich auf demselben Weg überarbeiten.' }));
    var open = drafts.filter(function (x) { return x.status === 'open'; });
    var doneList = drafts.filter(function (x) { return x.status === 'applied'; }).slice(0, 10);
    if (!open.length) dBody.appendChild(el('p', { class: 'hint', text: 'Keine offenen Entwürfe.' }));
    var ul = el('ul', { class: 'dlist' });
    open.concat(doneList).forEach(function (x) {
      var l = latest(x);
      var b = el('button', { type: 'button', class: 'ditem' + (x.status === 'applied' ? ' applied' : '') }, [
        el('span', { class: 'ditem-head' }, [
          el('strong', { text: x.id }),
          el('span', { text: draftLabel(x) }),
          el('span', { class: 'spacer' }),
          x.status === 'applied' ? el('span', { class: 'badge', text: 'übernommen ' + (x.appliedAs || '') }) : el('span', { class: 'dver', text: x.versions.length + ' Version(en)' + (x.revises ? ' · Überarbeitung' : '') }),
        ]),
        el('span', { class: 'step-sel', text: [x.page === currentPage() ? 'diese Seite' : x.page, x.selector].join(' · ') }),
        el('span', { class: 'step-date', text: fmtDate((l && l.created) || x.created) }),
      ]);
      b.addEventListener('click', function () { draftCurrent = x.id; draftVersion = null; draftToggles = {}; draftBefund = {}; dScroll.scrollTop = 0; renderDrafts(); });
      ul.appendChild(el('li', {}, [b]));
    });
    dBody.appendChild(ul);
  }

  function renderDraftDetail(d) {
    var isOpen = d.status === 'open';
    var live = liveFor(d);
    var v = versionOf(d, draftVersion) || latest(d);
    if (v) draftVersion = v.v;
    dTitle.textContent = d.id + (v && v.title ? ' · ' + v.title : '');
    dBody.appendChild(el('div', { class: 'step-sel', text: (d.page === currentPage() ? 'diese Seite' : d.page) + ' · ' + d.selector + (d.revises ? ' · Überarbeitung von mx-' + d.revises : '') }));
    dBody.appendChild(el('div', { class: 'step-prompt', text: d.prompt }));
    if (!isOpen) dBody.appendChild(el('span', { class: 'dstate', text: d.status === 'applied' ? 'übernommen als ' + d.appliedAs + ' (v' + d.appliedVersion + ')' : 'verworfen' }));
    if (!v) { dBody.appendChild(el('p', { class: 'hint', text: 'Noch keine Version.' })); return; }

    // Versionen: in der Vorschau live umschalten, sonst nur auswählen
    var vrow = el('div', { class: 'vtabs', role: 'group', 'aria-label': 'Versionen' });
    if (live) {
      var bCur = el('button', { type: 'button', text: 'Aktuell', 'data-fk': 'vt-0', 'aria-pressed': String(pvLive.shown === 0), title: 'Seite ohne Entwurf (Taste V)' });
      bCur.addEventListener('click', function () { showLive(d, 0); });
      vrow.appendChild(bCur);
    }
    d.versions.forEach(function (x) {
      var pressed = live ? pvLive.shown === x.v : x.v === v.v;
      var b = el('button', { type: 'button', text: 'v' + x.v, 'data-fk': 'vt-' + x.v, title: x.prompt, 'aria-pressed': String(pressed) });
      b.addEventListener('click', function () {
        if (live) { showLive(d, x.v); return; }
        if (draftVersion !== x.v) { draftVersion = x.v; draftToggles = {}; draftBefund = {}; }
        renderDrafts();
      });
      vrow.appendChild(b);
    });
    dBody.appendChild(vrow);
    var vright = el('span', { class: 'vright' });
    vrow.appendChild(vright);
    if (live) {
      var phs = document.querySelectorAll('[data-mx-platzhalter]');
      if (phs.length) {
        var phOn = !!document.querySelector('style[data-modio="platzhalter"]');
        var bPh = el('button', { type: 'button', class: 'phbtn', text: 'Platzhalter (' + phs.length + ')', 'data-fk': 'ph', 'aria-pressed': String(phOn), title: 'Ergänzte Funktionen markieren, die im echten Projekt anzubinden sind' });
        bPh.addEventListener('click', function () { markPlaceholders(!phOn); renderDrafts(); });
        vright.appendChild(bPh);
      }
    }
    if (PREVIEW && PREVIEW.draft === d.id) {
      var bExit = el('button', { type: 'button', class: 'exitbtn', 'data-fk': 'exit', text: 'Vorschau beenden', title: 'Zurück zur normalen Seite' });
      bExit.addEventListener('click', leavePreview);
      vright.appendChild(bExit);
    }
    else if (isOpen) {
      var bShow = iconButton('click', 'Vorschau v' + v.v + ' in der Seite', { class: 'primary' });
      bShow.addEventListener('click', function () { location.href = previewUrl(d, v.v); });
      dBody.appendChild(el('div', { class: 'row' }, [bShow]));
    }

    if (v.prompt && v.v > 1) dBody.appendChild(el('div', { class: 'vprompt', text: 'Auftrag v' + v.v + ': ' + v.prompt }));
    if (v.summary) {
      var sdet = el('details', { class: 'dsec bfdet', open: ideaOpen ? '' : null }, [el('summary', {}, [icon('chevron', 14), el('h3', { text: 'Gestaltungsidee von Claude' })]), el('p', { class: 'dsum', text: v.summary })]);
      sdet.addEventListener('toggle', function () { ideaOpen = sdet.open; });
      dBody.appendChild(sdet);
    }
    (v.warnings || []).forEach(function (w) { dBody.appendChild(el('div', { class: 'hint bad', text: w })); });

    // Befund: Haken = in dieser Version umgesetzt; Umschalten setzt Punkte in der nächsten Version um oder nimmt sie zurück
    if (v.befund && v.befund.length) {
      var GR = { pflicht: 'Pflicht: Fehler und Barrierefreiheit', inhalt: 'Inhalt', funktionen: 'Funktionen', feinschliff: 'Feinschliff' };
      var nOpen = v.befund.filter(function (b) { return !b.umgesetzt; }).length;
      var bsec = el('details', { class: 'dsec bfdet', open: befundOpen ? '' : null }, [
        el('summary', {}, [icon('chevron', 14), el('h3', { text: 'Befund von Claude (' + v.befund.length + (nOpen ? ', ' + nOpen + ' offen' : '') + ')' })]),
        el('p', { class: 'hint', text: 'Was Claude geprüft hat. „umgesetzt“ steckt schon in v' + v.v + ', „offen“ braucht deine Entscheidung. Mit „umsetzen“ bzw. „zurücknehmen“ merkst du Punkte für die nächste Version vor (wirkt erst mit „Neue Version“).' }),
      ]);
      ['pflicht', 'inhalt', 'funktionen', 'feinschliff'].forEach(function (g) {
        var items = v.befund.filter(function (b) { return b.gruppe === g; });
        if (!items.length) return;
        bsec.appendChild(el('div', { class: 'bf-group', text: GR[g] }));
        items.forEach(function (b) {
          var changed = hasOwn(draftBefund, b.id);
          // Vormerken für die nächste Version: offene Punkte umsetzen, umgesetzte zurücknehmen; erneuter Klick hebt auf
          var act = el('button', {
            type: 'button', class: 'bf-act', 'data-fk': 'bf-' + b.id, 'aria-pressed': String(changed), disabled: isOpen ? null : '',
            text: changed ? (b.umgesetzt ? 'wird zurückgenommen' : 'wird umgesetzt') : (b.umgesetzt ? 'zurücknehmen' : 'umsetzen'),
            title: changed ? 'Vormerkung aufheben' : (b.umgesetzt ? 'In der nächsten Version rückgängig machen' : 'In der nächsten Version umsetzen'),
          });
          act.addEventListener('click', function () {
            if (changed) delete draftBefund[b.id]; else draftBefund[b.id] = !b.umgesetzt;
            renderDrafts();
          });
          bsec.appendChild(el('div', { class: 'bf-item' + (changed ? ' changed' : '') + (b.umgesetzt ? '' : ' open') }, [
            el('span', { class: 'bf-main' }, [
              el('strong', { text: b.id + ' · ' + b.titel }),
              el('span', { class: 'bf-state ' + (b.umgesetzt ? 'done' : 'todo'), text: b.umgesetzt ? 'umgesetzt' : 'offen' }),
              el('span', { class: 'bf-text', text: b.text }),
            ]),
            isOpen ? act : null,
          ]));
        });
      });
      bsec.addEventListener('toggle', function () { befundOpen = bsec.open; });
      dBody.appendChild(bsec);
    }
    if (v.platzhalter) dBody.appendChild(el('p', { class: 'hint', text: v.platzhalter + ' Platzhalter (ergänzte Funktionen, im echten Projekt anzubinden). In der Vorschau mit „Platzhalter zeigen“ markieren.' }));

    // Bausteine: neu oder wie bisher – live, wenn die Version beide Klassen kennt
    if (v.bausteine && v.bausteine.length) {
      var tb = el('div', { class: 'bst' });
      var liveHere = live && pvLive.shown === v.v;
      v.bausteine.forEach(function (b) {
        var key = String(b.key || b.label);
        var cur = draftToggles[key] || (b.source === 'bestand' ? 'bestand' : 'neu');
        var lv = liveHere && canLiveToggle(b);
        var seg = el('span', { class: 'seg', role: 'group', 'aria-label': b.label || key });
        ['neu', 'bestand'].forEach(function (s) {
          var sb = el('button', { type: 'button', text: s === 'neu' ? 'neu' : 'wie bisher', 'data-fk': 'bst-' + key + '-' + s, 'aria-pressed': String(cur === s), disabled: isOpen ? null : '' });
          sb.addEventListener('click', function () {
            var orig = b.source === 'bestand' ? 'bestand' : 'neu';
            if (s === orig) delete draftToggles[key]; else draftToggles[key] = s;
            applyToggles();
            renderDrafts();
          });
          seg.appendChild(sb);
        });
        tb.appendChild(el('div', { class: 'bst-row' + (draftToggles[key] ? ' changed' : '') }, [
          el('span', { text: b.label || key }),
          el('span', { class: 'bst-live', text: lv ? 'live' : '', title: lv ? 'Umschalten wirkt sofort in der Vorschau' : '' }),
          seg,
        ]));
      });
      var anyLive = v.bausteine.some(canLiveToggle);
      dBody.appendChild(el('section', { class: 'dsec' }, [
        el('h3', { text: 'Bausteine' }), tb,
        el('p', { class: 'hint', text: liveHere && anyLive ? 'Umschalten zeigt die Wirkung sofort. Mit „Neue Version“ setzt Claude die Wahl sauber um.' : anyLive ? 'Live umschalten geht in der Vorschau dieser Version:' : 'Die Wirkung zeigt erst eine neue Version (diese Version ist noch ohne Klassen-Angaben entstanden und nicht live umschaltbar).' }),
        anyLive && !liveHere && isOpen ? el('div', { class: 'row' }, [liveButton(d, v)]) : null,
      ]));
    }
    if (!isOpen) return;

    // Hinweise zu einzelnen Elementen
    var notes = draftNotes[d.id] = draftNotes[d.id] || [];
    var nsec = el('section', { class: 'dsec' }, [el('h3', { text: 'Hinweise zu Elementen' + (notes.length ? ' (' + notes.length + ')' : '') })]);
    var canPick = live && pvLive.shown;
    var bPick = iconButton('click', 'Element im Entwurf wählen', { 'data-fk': 'note-pick', disabled: canPick ? null : '' });
    bPick.title = canPick ? 'Ein Element der Komponente anklicken und beschreiben, was sich ändern soll (Esc bricht ab)' : 'In der Vorschau einer Version möglich';
    bPick.addEventListener('click', function () { startSelecting('draftnote'); showToast('Element in der Komponente anklicken (↑ = Elternelement, Esc bricht ab).', false); });
    nsec.appendChild(el('div', { class: 'row' }, [bPick, canPick ? null : liveButton(d, v)]));
    if (!canPick) nsec.appendChild(el('p', { class: 'hint', text: 'Elemente lassen sich in der Vorschau einer Version wählen.' }));
    var nlist = el('ul', { class: 'nlist' });
    notes.forEach(function (n, i) {
      var ta2 = el('textarea', { class: 'ndesc', 'data-fk': 'note-' + i, placeholder: 'Was soll sich an diesem Element ändern?', 'aria-label': 'Hinweis zu ' + n.label });
      ta2.value = n.desc;
      ta2.addEventListener('input', function () { n.desc = ta2.value; updateNewLabel(); });
      var del = iconButton('trash', 'Hinweis entfernen', { class: 'ghost' }, true);
      del.addEventListener('click', function () { notes.splice(i, 1); hl.style.display = 'none'; renderDrafts(); });
      var li = el('li', {}, [
        el('div', { class: 'nhead' }, [el('code', { text: n.label }), n.snippet ? el('span', { class: 'nsnip', text: '„' + n.snippet + '“' }) : null, el('span', { class: 'spacer' }), del]),
        ta2,
      ]);
      li.addEventListener('mouseenter', function () { var nn = noteNode(n); if (nn) placeHighlight(nn, true); });
      li.addEventListener('mouseleave', function () { if (!selecting) hl.style.display = 'none'; });
      nlist.appendChild(li);
    });
    if (notes.length) nsec.appendChild(nlist);
    dBody.appendChild(nsec);

    // Nachbessern und Aktionen
    var ta = el('textarea', { 'data-fk': 'ta', placeholder: 'Was soll am Entwurf insgesamt anders werden? (wie im Chat)', 'aria-label': 'Entwurf nachbessern' });
    ta.value = draftText[d.id] || '';
    var bNew = iconButton('refresh', 'Neue Version');
    function noteCount() { return notes.filter(function (n) { return n.desc.trim(); }).length; }
    function updateNewLabel() {
      var nChanged = Object.keys(draftToggles).length + Object.keys(draftBefund).length + noteCount();
      bNew.modioLabel.textContent = nChanged ? 'Neue Version (' + nChanged + ' Änderung(en) gewählt)' : 'Neue Version';
    }
    updateNewLabel();
    ta.addEventListener('input', function () { draftText[d.id] = ta.value; });
    var bApply = iconButton('check', 'v' + v.v + ' übernehmen', { class: 'primary', title: 'Ersetzt das Element in der Seite durch diese Version (Schritt mit Prüfung und Verlauf)' });
    var bDiscard = iconButton('trash', 'Verwerfen', { class: 'ghost danger' });
    var err = el('div', { class: 'err', role: 'alert' });
    dBody.appendChild(el('section', { class: 'dsec' }, [el('h3', { text: 'Nachbessern' }), ta, err, el('div', { class: 'row end' }, [bNew])]));
    dBody.appendChild(el('div', { class: 'row dactions' }, [bDiscard, el('span', { class: 'spacer' }), bApply]));
    bNew.disabled = bApply.disabled = isBusy();
    if (isBusy()) err.textContent = 'Es läuft noch ein Auftrag – danach möglich.';
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); bNew.click(); } });

    bNew.addEventListener('click', function () {
      var lines = [];
      v.bausteine.forEach(function (b) {
        var key = String(b.key || b.label), s = draftToggles[key];
        if (!s) return;
        lines.push('- ' + (b.label || key) + ': ' + (s === 'bestand' ? 'aus dem Bestand verwenden (klassen.bestand bzw. passende Klassen aus bausteine.json, kein eigenes CSS dafür nötig)' : 'neu gestalten (klassen.neu, nicht mehr aus dem Bestand)'));
      });
      var blines = [];
      (v.befund || []).forEach(function (b) {
        if (!hasOwn(draftBefund, b.id)) return;
        blines.push('- ' + b.id + ' ' + b.titel + ': ' + (draftBefund[b.id] ? 'umsetzen' : 'zurücknehmen (nicht umsetzen, Zustand wie vor diesem Punkt)'));
      });
      var nlines = notes.filter(function (n) { return n.desc.trim(); }).map(function (n) {
        return '- `' + n.selector + '`' + (n.snippet ? ' („' + n.snippet + '“)' : '') + ': ' + n.desc.trim().replace(/\n+/g, ' ');
      });
      var prompt = ta.value.trim();
      if (nlines.length) prompt = (prompt ? prompt + '\n\n' : '') + 'Hinweise zu einzelnen Elementen (Selektor in v' + v.v + '):\n' + nlines.join('\n');
      if (blines.length) prompt = (prompt ? prompt + '\n\n' : '') + 'Befund:\n' + blines.join('\n');
      if (lines.length) prompt = (prompt ? prompt + '\n\n' : '') + 'Bausteine anpassen:\n' + lines.join('\n');
      if (nlines.length || blines.length || lines.length) prompt += '\nAlles andere unverändert lassen.';
      if (!prompt) { err.textContent = 'Bitte beschreiben, was anders werden soll, oder Hinweise, Befundpunkte bzw. Bausteine wählen.'; ta.focus(); return; }
      bNew.disabled = true;
      draftsApi('/' + d.id + '/versions', { prompt: prompt })
        .then(function (data) {
          if (data && data.job) trackJob(data.job);
          draftToggles = {}; draftBefund = {}; draftText[d.id] = ''; draftNotes[d.id] = [];
          showToast('Neue Version von ' + d.id + ' wird entworfen …', false);
          renderDrafts();
        })
        .catch(function (e) { err.textContent = e.status === 409 ? 'Es läuft noch ein Auftrag.' : 'Fehlgeschlagen: ' + e.message; bNew.disabled = false; });
    });
    bApply.addEventListener('click', function () {
      if (!confirm('Version ' + v.v + ' von ' + d.id + ' übernehmen? Das Element auf ' + d.page + ' wird durch die Komponente ersetzt (als Schritt im Verlauf, Rücksprung möglich).' + (Object.keys(draftToggles).length ? '\n\nHinweis: Umgeschaltete Bausteine werden nicht übernommen. Dafür erst „Neue Version“.' : ''))) return;
      bApply.disabled = true;
      draftsApi('/' + d.id + '/apply', { version: v.v })
        .then(function (data) { if (data && data.job) trackJob(data.job); showToast(d.id + ' v' + v.v + ' wird übernommen …', false); })
        .catch(function (e) { err.textContent = e.status === 409 ? 'Es läuft noch ein Schritt oder wartet auf Prüfung.' : 'Fehlgeschlagen: ' + e.message; bApply.disabled = false; });
    });
    bDiscard.addEventListener('click', function () {
      if (!confirm(d.id + ' verwerfen?')) return;
      bDiscard.disabled = true;
      draftsApi('/' + d.id + '/discard')
        .then(function (data) { if (data && data.job) trackJob(data.job); draftCurrent = null; })
        .catch(function (e) { err.textContent = 'Fehlgeschlagen: ' + e.message; bDiscard.disabled = false; });
    });
  }

  // Vorschau-Zustand in der Statuszeile der Leiste (statt eigener Leiste)
  function renderPreviewBand() { renderStatus(); }

  function openDrafts(id, version, keep) {
    if (selecting) stopSelecting();
    var wasOpen = draftsPanel.classList.contains('open');
    if (!wasOpen) closePanels();
    if (id && (id !== draftCurrent || !keep)) {
      if (id !== draftCurrent || (version && version !== draftVersion)) { draftToggles = {}; draftBefund = {}; dScroll.scrollTop = 0; }
      draftCurrent = id;
      draftVersion = version || null;
    }
    draftsPanel.classList.add('open');
    ui.classList.add('sb-open', 'sb-drafts');
    btnDrafts.classList.add('on');
    btnDrafts.setAttribute('aria-expanded', 'true');
    dErr.textContent = '';
    renderDrafts();
    if (!wasOpen) { loadDrafts(); setTimeout(function () { dClose.focus(); }, 0); }
  }
  function closeDrafts() {
    draftsPanel.classList.remove('open');
    ui.classList.remove('sb-open', 'sb-drafts');
    btnDrafts.classList.remove('on');
    btnDrafts.setAttribute('aria-expanded', 'false');
  }
  btnDrafts.addEventListener('click', function () { if (draftsPanel.classList.contains('open')) closeDrafts(); else openDrafts(); });
  dClose.addEventListener('click', closeDrafts);
  dBack.addEventListener('click', function () { draftCurrent = null; dScroll.scrollTop = 0; renderDrafts(); });
  document.addEventListener('keydown', function (e) {
    // V: in der Vorschau zwischen Entwurf und aktueller Seite wechseln (live)
    if (!PREVIEW || selecting || e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'v' && e.key !== 'V')) return;
    var t = e.composedPath ? e.composedPath()[0] : e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    var d = draftById(PREVIEW.draft);
    if (!d) return;
    e.preventDefault();
    showLive(d, pvLive.shown ? 0 : (pvLive.lastV || latest(d).v));
  }, true);

  // Bausteine der Seite messen (für „wie bisher“): typische Elemente gruppiert nach Tag und Klassen
  function collectBausteine() {
    var groups = {}, list = [];
    var nodes = document.querySelectorAll('button, a, input[type=submit], input[type=button], h1, h2, h3, h4, p, input[type=text], input[type=email], select, textarea');
    var PROPS = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-transform', 'color', 'background-color', 'border', 'border-radius', 'padding', 'box-shadow', 'text-decoration-line'];
    for (var i = 0; i < nodes.length && i < 4000; i++) {
      var n = nodes[i];
      if (host.contains(n) || n.closest('[data-modio]')) continue;
      var r = n.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      var tag = n.tagName.toLowerCase();
      var cls = Array.prototype.filter.call(n.classList, function (c) { return !looksGenerated(c); }).sort();
      var clsText = cls.join(' ');
      var kind = /^h[1-4]$/.test(tag) ? 'heading' : tag === 'p' ? 'text'
        : (tag === 'button' || tag === 'input' && /submit|button/.test(n.type) || n.getAttribute('role') === 'button' || /(^|[-_ ])(btn|button|cta)/i.test(clsText)) ? 'button'
        : tag === 'a' ? 'link' : 'field';
      var key = kind + '|' + tag + '|' + clsText;
      var g = groups[key];
      if (!g) { g = groups[key] = { kind: kind, tag: tag, classes: clsText, count: 0, node: n }; list.push(g); }
      g.count++;
    }
    var rank = { button: 0, heading: 1, link: 2, field: 3, text: 4 };
    list.sort(function (a, b) { return rank[a.kind] - rank[b.kind] || b.count - a.count; });
    var perKind = {};
    return list.filter(function (g) { perKind[g.kind] = (perKind[g.kind] || 0) + 1; return perKind[g.kind] <= (g.kind === 'button' ? 10 : 6); })
      .slice(0, 30).map(function (g) {
        var cs = getComputedStyle(g.node), style = {};
        PROPS.forEach(function (p) { var val = cs.getPropertyValue(p); if (val && val !== 'none' && val !== 'normal') style[p] = truncate(val, 120); });
        return { kind: g.kind, tag: g.tag, classes: g.classes, count: g.count, sample: truncate((g.node.innerText || g.node.value || '').trim().replace(/\s+/g, ' '), 50), style: style };
      });
  }

  // ----------------------------------------------------------------- Start

  try {
    var flash = sessionStorage.getItem(FLASH_KEY);
    if (flash) {
      sessionStorage.removeItem(FLASH_KEY);
      showToast(flash, false);
    }
  } catch (e) { /* ignorieren */ }

  // Modio-Favicon und Titel mit Präfix, damit Tabs mit dem Abzug erkennbar sind
  (function brandTab() {
    var PREFIX = 'Modio · ';
    var fixIcons = function () {
      Array.prototype.forEach.call(document.querySelectorAll('link[rel~="icon"]:not([data-modio]), link[rel="shortcut icon"]:not([data-modio]), link[rel="apple-touch-icon"]:not([data-modio])'), function (l) { l.remove(); });
      if (!document.querySelector('link[data-modio="favicon"]') && document.head) {
        document.head.appendChild(el('link', { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml', 'data-modio': 'favicon' }));
      }
    };
    var fixTitle = function () {
      if (document.title.indexOf(PREFIX) !== 0) document.title = PREFIX + (document.title || SLUG);
    };
    fixIcons();
    fixTitle();
    if (document.head) {
      new MutationObserver(function () { fixIcons(); fixTitle(); }).observe(document.head, { childList: true, subtree: true, characterData: true });
    }
  })();

  renderStatus();
  loadJobs();
  loadQueue();
  loadDrafts().then(function () {
    var openId = null;
    try { openId = sessionStorage.getItem(DRAFT_OPEN_KEY); sessionStorage.removeItem(DRAFT_OPEN_KEY); } catch (e) { /* ignorieren */ }
    if (!openId && PREVIEW) openId = PREVIEW.draft; // in der Vorschau ist das Panel die Steuerung
    if (openId) openDrafts(openId, PREVIEW && PREVIEW.draft === openId ? PREVIEW.version : null);
  });
  connectEvents();
  if (document.readyState === 'complete') initChanges();
  else window.addEventListener('load', initChanges);
  try {
    if (sessionStorage.getItem(DESIGN_OPEN_KEY)) {
      sessionStorage.removeItem(DESIGN_OPEN_KEY);
      openDesign();
    }
  } catch (e) { /* ignorieren */ }
})();
