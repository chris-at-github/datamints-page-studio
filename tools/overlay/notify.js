// Systembenachrichtigung, wenn ein Durchlauf endet und gerade kein Page-Studio-Tab aktiv ist.
// Wird von Overlay und Websiteliste geladen; mehrere offene Tabs melden einen Job nur einmal.
(function () {
  'use strict';
  if (window.dpsNotify) return;

  var ACTIVE_KEY = 'dps-active-at';
  var CLAIM_PREFIX = 'dps-notified:';
  var ACTIVE_WINDOW = 5000; // so lange gilt ein gerade verlassener Tab noch als aktiv
  var RUNNING = { pending: true, running: true };
  var OUTCOME = { done: 'fertig', review: 'Prüfung nötig', failed: 'fehlgeschlagen' };
  var supported = 'Notification' in window && window.isSecureContext;
  var seen = {};
  var asked = false;

  function store(fn) { try { return fn(window.localStorage); } catch (e) { return null; } }
  function focused() { return document.visibilityState === 'visible' && document.hasFocus(); }

  // Jeder Tab mit Fokus hinterlegt regelmäßig einen Zeitstempel, damit andere Tabs schweigen
  function markActive() {
    if (focused()) store(function (s) { s.setItem(ACTIVE_KEY, String(Date.now())); });
  }
  setInterval(markActive, 2000);
  window.addEventListener('focus', markActive);
  document.addEventListener('visibilitychange', markActive);
  markActive();

  function userActive() {
    if (focused()) return true;
    var t = Number(store(function (s) { return s.getItem(ACTIVE_KEY); })) || 0;
    return Date.now() - t < ACTIVE_WINDOW;
  }

  // Erster Tab, der den Job beansprucht, meldet ihn; alte Einträge nach einem Tag aufräumen
  function claim(id) {
    var ok = store(function (s) {
      var key = CLAIM_PREFIX + id;
      if (s.getItem(key)) return false;
      s.setItem(key, String(Date.now()));
      for (var i = s.length - 1; i >= 0; i--) {
        var k = s.key(i);
        if (k && k.indexOf(CLAIM_PREFIX) === 0 && Date.now() - Number(s.getItem(k)) > 86400000) s.removeItem(k);
      }
      return true;
    });
    return ok !== false;
  }

  function observe(job, label) {
    if (!job || !job.id) return;
    var prev = seen[job.id];
    seen[job.id] = job.status;
    if (!prev || !RUNNING[prev] || RUNNING[job.status] || !OUTCOME[job.status]) return;
    if (job.cancelled || !supported || Notification.permission !== 'granted') return;
    if (userActive() || !claim(job.id)) return;
    var r = job.result || {};
    var body = [job.slug, r.annotationId || r.draft].filter(Boolean).join(' · ');
    if (job.status === 'failed') {
      var err = job.error || r.error;
      if (err) body += (body ? '\n' : '') + String(err).slice(0, 200);
    }
    try {
      var n = new Notification('Page Studio: ' + (label || job.type) + ' ' + OUTCOME[job.status], {
        body: body,
        tag: 'dps-' + job.id,
        icon: '/__dps/notify-icon.png', // PNG: SVG zeigen Benachrichtigungen nicht überall an
      });
      n.onclick = function () { window.focus(); n.close(); };
    } catch (e) { /* z. B. Browser ohne Notification-Konstruktor */ }
  }

  // Erlaubnis einmal je Tab erfragen, aufgerufen beim Start eines Auftrags (Nutzergeste)
  function ask() {
    if (asked || !supported || Notification.permission !== 'default') return;
    asked = true;
    try { Notification.requestPermission(); } catch (e) { /* ignorieren */ }
  }

  window.dpsNotify = { observe: observe, ask: ask };
})();
