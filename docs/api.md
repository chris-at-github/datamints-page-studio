# Modio – Schnittstellen (Server, Worker, Overlay)

Ergänzt den Projektplan um die konkreten Formate.

## Job-Dateien

Ein Job ist eine JSON-Datei `jobs/<status>/<job-id>.json`. Der Ordner ist der Status:

| Ordner | Status | Bedeutung |
|---|---|---|
| `pending/` | `pending` | angelegt vom Server, wartet |
| `running/` | `running` | wird vom Worker bearbeitet |
| `review/` | `review` | Annotation umgesetzt, `check-diff.sh` hat Treffer gemeldet, wartet auf Entscheidung |
| `done/` | `done` | erfolgreich abgeschlossen |
| `failed/` | `failed` | fehlgeschlagen |

Job-ID: `job-<yyyymmddHHMMSS>-<6 hex>`, dadurch ergibt die alphabetische Sortierung die Reihenfolge.

```json
{
  "id": "job-20261112153000-a1b2c3",
  "type": "annotate",
  "slug": "example-de",
  "status": "running",
  "created": "2026-11-12T15:30:00.000Z",
  "updated": "2026-11-12T15:30:02.000Z",
  "params": { },
  "result": { },
  "error": null,
  "log": "logs/job-20261112153000-a1b2c3.log"
}
```

| type | params | Skript |
|---|---|---|
| `site-new` | `{ url, slug, urls: [..] }` | `site-new.sh <url> <slug> [urls.txt]` |
| `site-recrawl` | `{}` | `site-recrawl.sh <slug>` |
| `annotate` | Annotation (siehe unten) mit `references: [{type:"upload",file}|{type:"url",url}]`; Sammelauftrag: zusätzlich `batch: true, items: [Annotation, …]` | `run-annotation.sh <slug> <job.json>` (ein Claude-Lauf, ein Schritt A-xxx) |
| `decision` | `{ jobId, action: "accept"|"discard" }` | `commit-step.sh <slug> <id> --accept` bzw. `discard-step.sh <slug>` |
| `rollback` | `{ target: "A-003"|"baseline"|<commit> }` | `rollback.sh <slug> <target>` |
| `report` | `{}` | `report.sh <slug>` |
| `design-save` | `{ file: "jobs/assets/<job-id>-design.json" }` | `design-save.sh <slug> <datei>` |
| `tokens-propose` | `{}` | `tokens-propose.sh <slug>` |
| `pages-add` | `{ urls: [..] }` | `pages-add.sh <slug> <urls.txt>` |
| `local-commit` | `{}` | `local-commit.sh <slug>` (Exit 3 → `review` wie bei Annotationen) |
| `inspect-apply` | `{ file: "jobs/assets/<job-id>-inspect.json", page, selector }` | `inspect-apply.sh <slug> <datei>` (Exit 3 → `review`) |
| `areas-sync` | `{ page, add?: { name, selector } }` | `areas-sync.sh <slug> <page> [--add <name> <selector>]` |
| `draft` | neu: Annotation (wie `annotate`, ohne Nachbessern) plus `rect: {width, height}` und `bausteine: [{ kind, tag, classes, count, sample, style }]`; neue Version: `{ draft: "D-001", prompt }` | `draft-create.sh <slug> <job.json>` |
| `draft-apply` | `{ draft, version? }` | `draft-apply.sh <slug> <draft> [version]` (Exit 3 → `review`) |
| `draft-discard` | `{ draft }` | `draft-discard.sh <slug> <draft>` |

`site-recrawl` hat `params.keepDesign` (Standard `true`) und ruft `site-recrawl.sh <slug> --keep-design|--no-keep-design` auf.

`result` ist die JSON-Zeile, die das Skript auf stdout ausgegeben hat. Für `annotate`:

- fertig: `{ "status": "committed", "annotationId": "A-003", "commit": "<sha>", "summary": "…", "warnings": [..] }`
- keine Änderung: `{ "status": "nochange", "annotationId": "A-003", "summary": "…" }`
- Prüfung nötig (Job liegt in `review/`): `{ "status": "review", "annotationId": "A-003", "summary": "…", "hits": [{ "rule", "file", "line", "text" }], "warnings": [..], "diff": "…" }`

### Prüfstufen (`check-diff.sh`)

`hits` sind Treffer der Stufe **block** (kein Commit, Status „Prüfung nötig“, Exit 3), `warnings` Treffer der Stufe **warn** (nur Hinweis im Overlay, in `annotations/A-xxx.json` unter `check.warnings` und im Report).

| Regel | Stufe | Auslöser |
|---|---|---|
| `script-tag`, `event-handler`, `iframe`, `object-embed`, `javascript-url`, `css-expression`, `meta-refresh`, `base-tag`, `form-action`, `unknown-domain` | block | riskante Inhalte (unverändert) |
| `path-outside` | block | Änderung außerhalb von `www/`, `overrides.css`, `components/mx-*.css`, `design/`, `annotations/` |
| `tokens-invalid`, `tokens-removed` | block | `design/tokens.json` kein gültiges JSON, Wert abgelehnt oder Datei gelöscht |
| `token-locked` | block | gesperrten Token geändert, entfernt oder entsperrt (außer `allow_token_change`) |
| `notes-without-remember` | block | `design/notes.md` geändert ohne `remember` |
| `notes-content` | block | URL, HTML, Codeblock oder mehr als `NOTES_MAX_LINES` Zeilen in `notes.md` |
| `tokens-css-manual` | block | `design/tokens.css` weicht vom Ergebnis von `tokens-build.sh` ab |
| `token-literal` | warn | Literalwert in `overrides.css` entspricht einem Farb- oder Schrift-Token |
| `token-new` | warn | neuer, nicht gesperrter Token |
| `docs-changed` | block | weitere `design/*.md` (Hintergrundwissen) geändert ohne `remember` |
| `consistency-changed` | block | `design/consistency.json` geändert ohne `remember` |
| `consistency` | warn | Bereich aus `consistency.json` weicht auf einzelnen Seiten ab oder fehlt (`check-consistency.sh`, nur durch den Schritt neu entstandene Abweichungen) |
| `areas-unclear` | warn | Gleicher Bereich wurde im Schritt auf mehreren Seiten unterschiedlich geändert und deshalb nicht übertragen |
| `consistency-config` | warn | `consistency.json` ungültig oder Selektor nicht auswertbar |

`design/consistency.json`:

```json
{
  "shared": [
    { "name": "Header", "selector": "header.site-header", "pages": "all" },
    { "name": "Footer", "selector": "footer.site-footer", "pages": ["/www.example.de/leistungen/"] }
  ],
  "ignore": ["class:active", "class:current", "aria-current"]
}
```

`pages`: `"all"` oder Liste von Seitenpfad-Präfixen (wie `page` in der Annotation). `ignore`: Klassen (`class:<name>`) und Attribute, die beim Vergleich entfallen.

## Exit-Codes der Skripte

`0` Erfolg, `1` Fehler, `2` falscher Aufruf, `3` Prüfung nötig (nur `commit-step.sh` und `run-annotation.sh`).

## HTTP-API

Alle `/api/`-Routen verlangen den Header `X-Modio-Token` (bei `GET /api/events` alternativ `?token=`, weil `EventSource` keine Header setzen kann). Ein vorhandener `Origin`-Header muss in `MODIO_ALLOWED_ORIGINS` stehen.

| Route | Body | Antwort |
|---|---|---|
| `POST /api/sites` | JSON `{ url, slug?, urls?: [..] }` | `202 { job }` |
| `POST /api/sites/<slug>/recrawl` | JSON `{ keepDesign?: true }` | `202 { job }` |
| `POST /api/sites/<slug>/annotations` | `multipart/form-data`: Feld `annotation` (JSON), Dateien im Feld `images` | `202 { job }`, `409` wenn für die Website schon ein Job aktiv ist oder auf Prüfung wartet |
| `POST /api/jobs/<job-id>/decision` | JSON `{ action: "accept"|"discard" }` | `202 { job }` |
| `GET /api/sites/<slug>/pages` | – | `{ entry, pages: [{ path, title, url }] }` Seiten des Abzugs (Ordner der Einstiegsseite) |
| `GET /api/sites/<slug>/queue` | – | `{ items: [{ id, created, page, selector, prompt, references }] }` gesammelte Annotationen |
| `POST /api/sites/<slug>/queue` | wie `annotations` (multipart) | `201 { item, items }` – in die Queue aufnehmen (auch während ein Schritt läuft; kein Nachbessern; max. 20) |
| `DELETE /api/sites/<slug>/queue/<id>` | – | `{ items }` – aus der Queue entfernen (mit hochgeladenen Bildern) |
| `POST /api/sites/<slug>/queue/run` | JSON `{ thorough?: true }` | `202 { job }` – alle als **ein** `annotate`-Job (Sammelauftrag), Queue danach leer |
| `POST /api/sites/<slug>/local-commit` | – | `202 { job }`: von Hand geänderte Dateien als Schritt übernehmen |
| `POST /api/sites/<slug>/inspect` | JSON `{ page, items: [{ selector, html, css? }], rules: [{ selector, decls, media? }] }` | `202 { job }`: im Inspektor geänderte Elemente (`css`: Inline-Styles als Regel in `overrides.css`) und im Styles-Panel geänderte CSS-Regeln (als Regel in `overrides.css`) übernehmen |
| `GET /api/sites/<slug>/status` | – | `{ changed, files }`: ungespeicherte Änderungen im Abzug (nur lesend) |
| `POST /api/sites/<slug>/areas/sync` | JSON `{ page: "/www.example.de/index.html", add?: { name, selector } }` | `202 { job }` (`areas-sync`): Bereiche der Seite auf alle Seiten übernehmen, mit `add` vorher als Bereich aufnehmen |
| `POST /api/sites/<slug>/pages` | JSON `{ urls: [..] }` (max. 100, nur Seiten derselben Website) | `202 { job }` (`pages-add`) |
| `POST /api/sites/<slug>/rollback` | JSON `{ target }` | `202 { job }` |
| `POST /api/sites/<slug>/report` | – | `202 { job }` |
| `GET /api/sites/<slug>/design` | – | `{ initialized, tokens, notes, scan, consistency, warnings, annotationId }` (Hinweise des letzten Schritts) |
| `PUT /api/sites/<slug>/design` | JSON `{ tokens?, notes?, consistency? }` | `202 { job }` (`design-save`) |
| `POST /api/sites/<slug>/tokens/propose` | – | `202 { job }` (`tokens-propose`) |
| `GET /api/sites/<slug>/history` | – | Inhalt von `.history.json` |
| `GET /api/sites/<slug>/drafts` | – | `{ drafts: [{ id, page, selector, prompt, created, status: "open"|"applied"|"discarded", appliedAs, appliedVersion, revises, versions: [{ v, prompt, created, summary, name, title, costUsd, warnings, bausteine, befund, platzhalter }] }], components: ["mx-…"] }` |
| `POST /api/sites/<slug>/drafts` | wie `annotations` (multipart), Annotation zusätzlich mit `rect` und `bausteine`; optional `mode: "brief"` (nur anlegen und Briefing für claude.ai erzeugen, kein Claude-Lauf) oder `mode: "import"` mit `importHtml` (HTML aus claude.ai, höchstens 1,5 MB; Prompt dann optional) | `202 { job }` (`draft`); `409` nur, wenn ein Auftrag läuft oder wartet (eine offene Prüfung blockiert nicht) |
| `GET /api/sites/<slug>/drafts/<D-xxx>` | – | `{ draft }` |
| `GET /api/sites/<slug>/drafts/<D-xxx>/versions/<n>` | – | `{ version, name, html }` Markup einer Version (geprüft) für das Live-Umschalten in der Vorschau |
| `POST /api/sites/<slug>/drafts/<D-xxx>/versions` | JSON `{ prompt }` | `202 { job }` (`draft`, neue Version, setzt die Claude-Session des Entwurfs fort) |
| `POST /api/projects` | JSON `{ slug, title }` | `202 { job }` (`project-new`): neues Projekt ohne Website (Leinwand mit freien Plätzen, Vorlagen unter `design/`) |
| `POST /api/sites/<slug>/package` | – | `202 { job }` (`project-package`): Tokens aus `design/tokens-quelle.css` übernehmen (Commit unter `design/`), Paket für Claude in `paket/` erzeugen; Ergebnis `{ dir, tokens, files, warnings }` |
| `POST /api/sites/<slug>/export` | – | `202 { job }` (`project-export`): Komponenten nach `export/<zeitpunkt>/` (bei neuen Projekten mit den Variablen aus `tokens-quelle.css`); Ergebnis `{ dir, components, files, warnings }` |
| `POST /api/sites/<slug>/drafts/<D-xxx>/import` | JSON `{ html, prompt? }` (HTML aus claude.ai, höchstens 1,5 MB) | `202 { job }` (`draft` mit `importFile`): bereinigen, dann übernimmt Claude ohne Neugestaltung als neue Version (frische Session, Effort `DRAFT_IMPORT_EFFORT`) |
| `POST /api/sites/<slug>/drafts/<D-xxx>/brief` | – | `202 { job }` (`draft-brief`): Briefing neu erzeugen |
| `GET /api/sites/<slug>/drafts/<D-xxx>/brief` | – | `{ created, text, files: [{ file, kind: "html"|"md"|"png", viewport?, cut?, size }] }`; `404` ohne Briefing |
| `GET /api/sites/<slug>/drafts/<D-xxx>/brief/<datei>` | – | Datei als Download (`Content-Disposition: attachment`); nur Dateien aus `brief.json` |
| `POST /api/sites/<slug>/drafts/<D-xxx>/apply` | JSON `{ version? }` (Standard: neueste) | `202 { job }` (`draft-apply`) |
| `POST /api/sites/<slug>/drafts/<D-xxx>/discard` | – | `202 { job }` (`draft-discard`) |
| `GET /api/jobs/<job-id>/log` | – | `{ lines: [..] }` laufende Ausgabe (Skript-Log und Claude-Ereignisse aus `logs/claude-<job-id>.json`, stream-json), lesbar aufbereitet |
| `GET /api/jobs?slug=<slug>` | – | `{ jobs: [..] }` aktive Jobs (pending, running, review) und die letzten 20 abgeschlossenen |
| `GET /api/events` | – | SSE: `event: job` mit dem Job als JSON, `event: reload` mit `{ slug }` |

Annotation (Feld `annotation`):

```json
{
  "page": "/www.example.de/leistungen/index.html",
  "selector": "main > section.hero h1",
  "html": "<h1 …>…</h1>",
  "text": "…",
  "viewport": { "width": 1440, "height": 900 },
  "prompt": "…",
  "thorough": false,
  "remember": false,
  "followup": false,
  "followup_of": null,
  "allow_token_change": false,
  "references": [{ "type": "url", "url": "https://…" }]
}
```

- `remember`: Claude darf `design/notes.md` ändern und genannte Werte als gesperrte Tokens eintragen.
- `followup` + `followup_of` („Nachbessern“): setzt die Session des genannten Schritts fort, sofern seitdem kein Rücksprung, Verwerfen oder neuer Stand erfolgt ist; sonst frische Session.
- `allow_token_change`: Änderungen an gesperrten Tokens blockieren die Prüfung nicht.

Hochgeladene Dateien hängt der Server als `{ "type": "upload", "file": "jobs/assets/<job-id>-<n>.<ext>" }` an `references` an.

`.history.json`:

```json
{ "slug": "example-de", "head": "<sha>", "baseline": "<sha>",
  "steps": [{ "id": "A-001", "commit": "<sha>", "date": "…", "prompt": "…", "summary": "…", "page": "…", "selector": "…" }] }
```

## Overlay-Konfiguration

Der Server schleust vor `</body>` ein:

```html
<script>window.__MODIO__={"slug":"…","token":"…","base":"/s/<slug>","imageMaxCount":3,"imageMaxMb":10}</script>
<script src="/__modio/overlay.js" defer></script>
```

Vor `</head>` bindet er `/s/<slug>/__tokens.css` (aus `design/tokens.css`) und danach `/s/<slug>/__overrides.css` ein.

**CSS-Ebenen:** Sobald `components/mx-*.css` existiert (oder in der Vorschau eines Entwurfs), legt der Server alle Stylesheets des Originals (`<link rel="stylesheet">` als `@import … layer(legacy)`, `<style>` als `@layer legacy { … }`) sowie `__tokens.css` und `__overrides.css` in `@layer legacy`. `/s/<slug>/__components.css` (alle Komponenten, `?exclude=<name>` lässt eine aus) steht ohne Ebene darüber. Das Verhalten bestehender Overrides bleibt dadurch gleich.

**Vorschau eines Entwurfs:** `<seite>?__modio_draft=D-001&__modio_v=2` liefert die Seite mit dem Element des Entwurfs durch die Komponente ersetzt (gleiches Verfahren wie `draft-apply.sh`) und bindet `/s/<slug>/__draft.css?d=D-001&v=2` ein. `window.__MODIO__.preview = { draft, version }`; das Overlay sperrt dort Auswahl und Änderungserkennung.

### Neue Projekte ohne Website (`site.json` mit `kind: "neu"`)

`project-new.sh` legt statt eines Abzugs `www/leinwand/index.html` an: eine Leinwand mit freien Plätzen (`<section class="modio-platz" id="platz-<n>" data-modio-platz>`). Ein Entwurf ersetzt einen Platz; ist danach keiner mehr frei, ergänzt `draft-apply.sh` einen neuen. Gepflegt wird in `design/`: `notes.md` (Regeln), `projekt.md` und weitere `.md` (Hintergrund), `tokens-quelle.css` (Design-Tokens als CSS-Variablen im `:root`-Block). `project-package.sh` übernimmt die Variablen als gesperrte Tokens (`design.mjs import-css`: Kategorie aus dem Namen, Verweise per `var()` werden zu `var(--modio-…)`, `clamp()`/`calc()` erlaubt, Werte ohne Kategorie wie Schriftstärken landen in `tokens-map.json` unter `ohneToken`) und schreibt `paket/` (`CLAUDE.md`, `tokens.css`, `regeln.md`, Hintergrund, `README.md`, `entwuerfe/`; nicht versioniert, `entwuerfe/` bleibt beim Neuerzeugen). `project-export.sh` schreibt je Komponente `component.html`/`component.css` und schreibt dabei `var(--modio-…)` über `tokens-map.json` auf die Variablen des Projekts zurück; Tokens nur aus Modio stehen in `modio-zusatz.css`. Neu einlesen und Seiten hinzufügen sind für neue Projekte gesperrt.

### Entwürfe (`sites/<slug>/drafts/D-xxx/`, nicht versioniert)

`draft.json` (Metadaten, Versionen mit `source: "import"` bei Importen, `sessionId`, `sessionCostUsd`, `appliedAs`, `external: true` bei Gestaltung in claude.ai, `material`), `layout.json` (gemessenes Hauptraster), `brief/` (Briefing: `briefing.md`, `<id>-element.html`, `<id>-hintergrund.md`, `<id>-desktop.png`, `<id>-mobil.png`, `brief.json`), `import-v<n>.html` (bereinigter Import) und `import-v<n>.original.html`, `CLAUDE.md` (aus `templates/DRAFT.md`), `source.html`, `bausteine.json`, `refs/`, je Version `v<n>/befund.json` (`[{ id: "P1", gruppe: "pflicht"|"inhalt"|"funktionen"|"feinschliff", titel, text, umgesetzt }]`, Pflicht beim Erzeugen, ältere Entwürfe ohne bleiben gültig), `component.html`, `component.css`, `meta.json` (`{ name, title, bausteine: [{ key, label, source: "neu"|"bestand", klassen: { neu, bestand } }] }`; Baustein-Elemente tragen `data-mx-baustein="<key>"`, das Overlay tauscht in der Vorschau die Klassen für „neu/wie bisher“ live). Ergänzte Funktionen tragen `data-mx-platzhalter="<was anzubinden ist>"`; beim Übernehmen stehen Platzhalter und offene Befundpunkte in der Zusammenfassung des Schritts.

Prüfung (`scripts/lib/draft.mjs`): genau ein Wurzelelement mit Klasse `mx-<name>`; CSS nur in `@scope (.mx-<name>)` (auch innerhalb von `@media`/`@supports`/`@container`), Keyframes `mx-<name>…`; verboten sind Scripts, Event-Handler, iframes, `<style>`/`<link>`/`<meta>`/`<base>`, `@import`, `@layer`, `javascript:` und Domains, die nicht im Ausgangsmaterial oder als Host der Website vorkommen. Ist eine Version ungültig, bekommt Claude eine Korrekturrunde.

**Überarbeitung:** Ist das gewählte Element selbst eine übernommene Komponente (Wurzel mit Klasse `mx-<name>` und `components/mx-<name>.css` vorhanden), setzt `draft-create.sh` `revises: <name>`, legt das bisherige CSS als `bestand-komponente.css` bei und verlangt denselben Namen; `draft-apply.sh` ersetzt dann die vorhandene CSS-Datei.

**Gestaltung in claude.ai:** `draft-create.sh` mit `mode: "brief"` legt den Entwurf ohne Version an und ruft `draft-brief.sh`: Briefing-Text (Auftrag, Hauptraster, Token-Block, gesperrte Tokens, Regeln aus `notes.md`, Gestaltungsleitlinien, Ausgabeformat: ein HTML-Artefakt ohne React/JavaScript, ein `<style>`, ein Wurzelelement, keine externen Schriften/Bilder) und Dateien zum Hochladen. Ein Import (`importFile`) wird mit `draft.mjs import-clean` bereinigt (Scripts, Handler, Frames, `<link>`, `@import`, externe `@font-face`; React-Artefakte ohne statisches HTML werden abgewiesen) und von Claude in einer frischen Session ohne Neugestaltung übernommen: Komponentenformat, Werte auf Tokens, Hauptraster, Inhalte und Pfade aus `source.html`. Bereinigungshinweise erscheinen als Warnungen der Version.

Status „übernommen“ ergibt sich aus dem Abzug: `appliedAs` gesetzt und `annotations/<appliedAs>.json` vorhanden. Nach Verwerfen der Prüfung oder einem Rücksprung ist der Entwurf wieder offen.

Ausgelieferte Seiten erhalten eine Content-Security-Policy, die Scripts und Verbindungen nur zur eigenen Adresse erlaubt.
