# datamints Page Studio – Schnittstellen (Server, Worker, Overlay)

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
| `page-import` | `{ name, page, file, replace }` | `page-import.sh <slug> <name> <file> [--replace]` (Exit 3 → `review`) |
| `page-delete` | `{ page }` | `page-delete.sh <slug> <page>` (Exit 3 → `review`) |
| `component-delete` | `{ name, variant? }` | `component-delete.sh <slug> <name> [variante]` (Exit 3 → `review`) |
| `component-sync` | `{ name }` | `component-sync.sh <slug> <name>` (Exit 3 → `review`) |
| `component-rename` | `{ name, newName }` | `component-rename.sh <slug> <name> <neuer-name>` (Exit 3 → `review`) |
| `component-merge` | `{ name, into, variant }` | `component-merge.sh <slug> <name> <into> <variant>` (Exit 3 → `review`) |
| `local-commit` | `{}` | `local-commit.sh <slug>` (Exit 3 → `review` wie bei Annotationen) |
| `inspect-apply` | `{ file: "jobs/assets/<job-id>-inspect.json", page, selector }` | `inspect-apply.sh <slug> <datei>` (Exit 3 → `review`) |
| `areas-sync` | `{ page, add?: { name, selector } }` | `areas-sync.sh <slug> <page> [--add <name> <selector>]` |
| `draft` | neu: Annotation (wie `annotate`, ohne Nachbessern) plus `rect: {width, height}` und `bausteine: [{ kind, tag, classes, count, sample, style }]`, optional `mode: "brief"\|"component"` (mit `componentName`) oder `importFile`, optional `placement: "before"\|"after"` (Komponente als neues Element davor/danach einfügen statt das Element zu ersetzen; nicht bei `component`); neue Version: `{ draft: "D-001", prompt }` | `draft-create.sh <slug> <job.json>` |
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
| `path-outside` | block | Änderung außerhalb von `www/`, `overrides.css`, `components/mx-*.css\|.html\|.json`, `design/`, `annotations/` |
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
| `component-structure` | warn | Eingesetzte Bibliotheks-Komponente weicht außerhalb ihrer Slots von der Vorlage ihrer Variante ab, hat eine unbekannte Variante oder falsche Modifier (nur durch den Schritt neu entstandene Abweichungen; optionale Slots dürfen fehlen) |

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

Alle `/api/`-Routen verlangen den Header `X-DPS-Token` (bei `GET /api/events` alternativ `?token=`, weil `EventSource` keine Header setzen kann). Ein vorhandener `Origin`-Header muss in `DPS_ALLOWED_ORIGINS` stehen.

| Route | Body | Antwort |
|---|---|---|
| `POST /api/sites` | JSON `{ url, slug?, urls?: [..] }` | `202 { job }` |
| `POST /api/sites/<slug>/recrawl` | JSON `{ keepDesign?: true }` | `202 { job }` |
| `POST /api/sites/<slug>/annotations` | `multipart/form-data`: Feld `annotation` (JSON), Dateien im Feld `images` | `202 { job }`, `409` wenn für die Website schon ein Job aktiv ist oder auf Prüfung wartet |
| `POST /api/jobs/<job-id>/decision` | JSON `{ action: "accept"|"discard" }` | `202 { job }` |
| `POST /api/jobs/<job-id>/cancel` | – | Nur Entwürfe (`draft`). Wartend: `200 { job }`, sofort nach `failed/` mit `cancelled: true`, `error: "Abgebrochen"`, Uploads entfernt. Laufend: `202 { job, cancelling: true }`, legt `jobs/running/<job-id>.cancel` an; der Worker beendet das Skript samt Unterprozessen (SIGTERM, nach 10 s SIGKILL), `draft-create.sh` räumt per Trap auf (neuer Entwurf: Ordner weg, neue Version: `v<n>/` und Import-Dateien weg; Exit 5) und der Job landet mit `cancelled: true` in `failed/`. Ist die Version schon geschrieben, läuft das Skript zu Ende (Job `done`). `400` bei anderen Typen, `409`, wenn der Job nicht mehr wartet oder läuft |
| `GET /api/sites/<slug>/pages` | – | `{ kind: "abzug"\|"neu", entry, pages: [{ path, title, url }], importDir? }` Seiten des Abzugs (Ordner der Einstiegsseite). Neue Projekte: alle Seiten unter `www/`, `url` ist der Pfad, `entry` ohne feste Einstiegsseite `index.html`, sonst `startseite.html`, sonst die erste Seite, `importDir` Zielordner für Importe |
| `GET /api/sites/<slug>/queue` | – | `{ items: [{ id, created, page, selector, prompt, references }] }` gesammelte Annotationen |
| `POST /api/sites/<slug>/queue` | wie `annotations` (multipart) | `201 { item, items }` – in die Queue aufnehmen (auch während ein Schritt läuft; kein Nachbessern; max. 20) |
| `DELETE /api/sites/<slug>/queue/<id>` | – | `{ items }` – aus der Queue entfernen (mit hochgeladenen Bildern) |
| `POST /api/sites/<slug>/queue/run` | JSON `{ thorough?: true }` | `202 { job }` – alle als **ein** `annotate`-Job (Sammelauftrag), Queue danach leer |
| `POST /api/sites/<slug>/local-commit` | – | `202 { job }`: von Hand geänderte Dateien als Schritt übernehmen |
| `POST /api/sites/<slug>/inspect` | JSON `{ page, items: [{ selector, html, css? }], rules: [{ selector, decls, media? }] }` | `202 { job }`: im Inspektor geänderte Elemente (`css`: Inline-Styles als Regel in `overrides.css`) und im Styles-Panel geänderte CSS-Regeln (als Regel in `overrides.css`) übernehmen |
| `GET /api/sites/<slug>/status` | – | `{ changed, files }`: ungespeicherte Änderungen im Abzug (nur lesend) |
| `POST /api/sites/<slug>/areas/sync` | JSON `{ page: "/www.example.de/index.html", add?: { name, selector } }` | `202 { job }` (`areas-sync`): Bereiche der Seite auf alle Seiten übernehmen, mit `add` vorher als Bereich aufnehmen |
| `POST /api/sites/<slug>/pages` | JSON `{ urls: [..] }` (max. 100, nur Seiten derselben Website) | `202 { job }` (`pages-add`) |
| `POST /api/sites/<slug>/pages/import` | JSON `{ name, html, replace? }` (nur `kind: "neu"`, `name` wie ein Slug, HTML ≤ 1,5 MB) | `202 { job }` (`page-import`); `409 { error, exists: true, page }`, wenn die Seite existiert und `replace` nicht `true` ist; `409` bei laufendem Auftrag |
| `POST /api/sites/<slug>/pages/delete` | JSON `{ page }` (Pfad aus `GET …/pages`) | `202 { job }` (`page-delete`); `404`, wenn die Seite nicht in der Liste ist; `400` für die Startseite eines Abzugs; `409` bei laufendem Auftrag |
| `POST /api/sites/<slug>/rollback` | JSON `{ target }` | `202 { job }` |
| `POST /api/sites/<slug>/report` | – | `202 { job }` |
| `GET /api/sites/<slug>/design` | – | `{ initialized, tokens, notes, scan, consistency, warnings, annotationId }` (Hinweise des letzten Schritts) |
| `PUT /api/sites/<slug>/design` | JSON `{ tokens?, notes?, consistency? }` | `202 { job }` (`design-save`) |
| `POST /api/sites/<slug>/tokens/propose` | – | `202 { job }` (`tokens-propose`) |
| `GET /api/sites/<slug>/history` | – | Inhalt von `.history.json` |
| `POST /api/sites/<slug>/components/delete` | JSON `{ name, variant? }` | `202 { job }` (`component-delete`); `404` unbekannte Komponente oder Variante; `400` für die einzige Variante; `409` bei laufendem Auftrag |
| `POST /api/sites/<slug>/components/draft` | JSON `{ name, prompt, variant?, newVariant?: { key, label } }` | `202 { job }` (`draft` mit `mode: "library"`): Komponente auf der Komponentenseite ändern (`variant`: nur diese Variante) oder Variante hinzufügen (`newVariant`); nur neue Projekte (`400` bei Abzügen), `400` ohne Prompt, ungültiger oder schon vorhandener Variantenname; `404` unbekannte Komponente oder Variante; `409` wenn ein Auftrag läuft oder wartet |
| `POST /api/sites/<slug>/components/rename` | JSON `{ name, newName }` | `202 { job }` (`component-rename`); nur neue Projekte (`400`), `400` ungültiger oder gleicher Name, `404` unbekannte Komponente, `409` wenn `mx-<newName>` schon existiert oder ein Auftrag läuft |
| `POST /api/sites/<slug>/components/merge` | JSON `{ name, into, variant }` | `202 { job }` (`component-merge`): `name` als Variante `variant` von `into` weiterführen; nur neue Projekte (`400`), `400` wenn `into` Slots von `name` fehlen, `404` unbekannte Komponente oder Variante, `409` bei laufendem Auftrag |
| `POST /api/sites/<slug>/components/sync` | JSON `{ name }` | `202 { job }` (`component-sync`): abweichende Kopien nach der Vorlage angleichen; nur neue Projekte (`400`), `404` unbekannte Komponente, `409` bei laufendem Auftrag |
| `GET /api/sites/<slug>/components` | – | `{ components: [{ name, title, beschreibung, herkunft, vorschau, slots, varianten }], url }` Komponenten-Bibliothek (gültige `components/mx-<name>.json` mit Vorlage), `url` der Komponentenseite |
| `GET /api/sites/<slug>/drafts` | – | `{ drafts: [{ id, page, selector, prompt, created, status: "open"|"applied"|"discarded", appliedAs, appliedVersion, revises, renames, component, target: "library"|null, placement: "replace"|"before"|"after", newVariant: { key, label }|null, variant, versions: [{ v, prompt, created, summary, name, title, costUsd, warnings, bausteine, befund, platzhalter }] }], components: ["mx-…"] }` |
| `POST /api/sites/<slug>/drafts` | wie `annotations` (multipart), Annotation zusätzlich mit `rect` und `bausteine`, optional `placement: "before"|"after"` (davor/danach einfügen, Standard: Element ersetzen); optional `mode: "brief"` (nur anlegen und Briefing für claude.ai erzeugen, kein Claude-Lauf) oder `mode: "import"` mit `importHtml` (HTML aus claude.ai, höchstens 1,5 MB; Prompt dann optional) oder `mode: "component"` mit `componentName` (nur neue Projekte, sonst `400`; Prompt optional) | `202 { job }` (`draft`); `409` nur, wenn ein Auftrag läuft oder wartet (eine offene Prüfung blockiert nicht) |
| `GET /api/sites/<slug>/drafts/<D-xxx>` | – | `{ draft }` |
| `GET /api/sites/<slug>/drafts/<D-xxx>/versions/<n>` | – | `{ version, name, html }` Markup einer Version (geprüft) für das Live-Umschalten in der Vorschau |
| `POST /api/sites/<slug>/drafts/<D-xxx>/versions` | JSON `{ prompt }` | `202 { job }` (`draft`, neue Version, setzt die Claude-Session des Entwurfs fort) |
| `POST /api/projects` | JSON `{ slug, title }` | `202 { job }` (`project-new`): neues Projekt ohne Website (ohne Seiten, Vorlagen unter `design/`) |
| `POST /api/sites/<slug>/package` | – | `202 { job }` (`project-package`): Tokens aus `design/tokens-quelle.css` übernehmen (Commit unter `design/`), Paket für Claude in `paket/` erzeugen; Ergebnis `{ dir, tokens, files, warnings }` |
| `POST /api/sites/<slug>/share` | JSON `{ what: "beides"\|"bilder"\|"html" }` (Standard `beides`) | `202 { job }` (`site-share`): Kunden-Export als ZIP im gemeinsamen Export-Ordner (`EXPORT_DIR`, Standard `export/` im Tool-Ordner); Ergebnis `{ what, zip, zipHost, bytes, pages: [{ page, title, html, screenshots: { desktop, mobil } }], warnings }`; `400` bei ungültiger Auswahl, `409` nur bei laufendem Auftrag |
| `POST /api/sites/<slug>/export` | – | `202 { job }` (`project-export`): Komponenten nach `<EXPORT_DIR>/<slug>-komponenten-<zeitpunkt>/` (bei neuen Projekten mit den Variablen aus `tokens-quelle.css`); Ergebnis `{ dir, components, files, warnings }` |
| `POST /api/sites/<slug>/drafts/<D-xxx>/import` | JSON `{ html, prompt? }` (HTML aus claude.ai, höchstens 1,5 MB) | `202 { job }` (`draft` mit `importFile`): bereinigen, dann übernimmt Claude ohne Neugestaltung als neue Version (frische Session, Effort `DRAFT_IMPORT_EFFORT`) |
| `POST /api/sites/<slug>/drafts/<D-xxx>/brief` | – | `202 { job }` (`draft-brief`): Briefing neu erzeugen |
| `GET /api/sites/<slug>/drafts/<D-xxx>/brief` | – | `{ created, text, files: [{ file, kind: "html"|"md"|"png", viewport?, cut?, size }], dir }` (`dir`: Ordner des Briefings, unter WSL als Windows-Pfad `\\wsl.localhost\<distro>\…`); `404` ohne Briefing |
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
<script>window.__DPS__={"slug":"…","token":"…","base":"/s/<slug>","imageMaxCount":3,"imageMaxMb":10}</script>
<script src="/__dps/overlay.js" defer></script>
```

Vor `</head>` bindet er `/s/<slug>/__tokens.css` (aus `design/tokens.css`) und danach `/s/<slug>/__overrides.css` ein.

**CSS-Ebenen:** Sobald `components/mx-*.css` existiert (oder in der Vorschau eines Entwurfs), legt der Server alle Stylesheets des Originals (`<link rel="stylesheet">` als `@import … layer(legacy)`, `<style>` als `@layer legacy { … }`) sowie `__tokens.css` und `__overrides.css` in `@layer legacy`. `/s/<slug>/__components.css` (alle Komponenten, `?exclude=<name>` lässt eine aus) steht ohne Ebene darüber. Das Verhalten bestehender Overrides bleibt dadurch gleich.

**Komponentenseite:** `/s/<slug>/__komponenten` (nicht im Abzug) zeigt alle Bibliotheks-Komponenten mit jeder Variante, gerendert aus der Vorlage. Die Stylesheets der Herkunftsseite (Schriften, Icon-Fonts) liegen wie auf jeder Seite in `@layer legacy`, darüber Tokens, `overrides.css` und `__components.css`; `<base>` zeigt auf den Ordner der Herkunftsseite. Das Overlay läuft mit `window.__DPS__.library = true` (keine Auswahl, keine Änderungserkennung; im Panel „Seiten“ als feste, nicht löschbare Seite „Komponenten“). `window.__DPS__.kind` ist `"neu"` oder `"abzug"` (Overlay: „Komponente speichern“ nur bei neuen Projekten).
Darstellung: Komponenten mit bekannter Breite am Einsatzort unter 640 px (`vorschau.breite` in der Beschreibung, sonst `rect.width` des neuesten Entwurfs, der sie angelegt hat) stehen in dieser Breite, ihre Varianten nebeneinander (`kb-schmal`, `--kb-w`; die Vorschau lässt sich an der Ecke breiter oder schmaler ziehen). Mit `vorschau.spalten` stehen so viele Varianten in einer Zeile (`kb-spalten`, `--kb-cols`), z. B. 3 bei Gestaltung × Form. Die Vorschaufläche hat keinen Rahmen und nur rechts 16 px Innenabstand für den Anfasser zum Ziehen; ein gestrichelter Umriss (`outline`, Abstand 3 px) erscheint nur beim Überfahren und beim Ziehen. Breite Komponenten und solche ohne bekannte Breite füllen die Seite, Varianten untereinander. Nur die Darstellung, die Komponente selbst bleibt unverändert; Container Queries der Komponente greifen in der gezeigten Breite.

**Vorschau eines Entwurfs:** `<seite>?__dps_draft=D-001&__dps_v=2` liefert die Seite mit dem Element des Entwurfs durch die Komponente ersetzt (gleiches Verfahren wie `draft-apply.sh`) und bindet `/s/<slug>/__draft.css?d=D-001&v=2` ein. `window.__DPS__.preview = { draft, version }`; das Overlay sperrt dort Auswahl und Änderungserkennung. Entwürfe mit Ziel Bibliothek haben ihre Vorschau auf `/s/<slug>/__komponenten?__dps_draft=D-001&__dps_v=2` (Komponentenseite mit der Komponente in der Entwurfsversion; `preview` und `library` gesetzt; Versionen laden die Seite neu, kein Live-Umschalten und keine Hinweise zu Elementen, weil die Komponente dort je Variante steht). Ist der Entwurf nicht offen oder kein Bibliotheks-Entwurf, leitet der Server auf die Komponentenseite um.

### Neue Projekte ohne Website (`site.json` mit `kind: "neu"`)

`project-new.sh` legt ein Projekt ohne Seiten an (`entry: null`). `/s/<slug>/` liefert dann eine Platzhalterseite mit Overlay (`window.__DPS__.empty = true`, das Panel „Seiten“ öffnet sich), die nicht im Abzug liegt. Seiten kommen mit `page-import.sh` dazu: die HTML-Datei wird byte-genau `www/seiten/<name>.html` (bei Altprojekten mit Leinwand im Ordner der Einstiegsseite), als Schritt A-xxx mit `source: "import"` über `commit-step.sh` (Sicherheitsprüfung, dabei Links `<a href>` auf fremde Domains nur als Hinweis `link-domain` je Domain, `CHECK_LINKS_AS_WARNINGS`; gleiche Bereiche werden bei Importen nicht übertragen). `--replace` ersetzt eine vorhandene Seite (Exit 4 ohne). Altprojekte mit Leinwand (`www/leinwand/index.html`, freie Plätze `<section class="dps-platz" … data-dps-platz>`) funktionieren weiter: Nur auf Seiten mit Plätzen ergänzt `draft-apply.sh` nach der Übernahme einen neuen Platz, und nur dort gilt `source.html` in Entwurf und Briefing als „kein Material“. Gepflegt wird in `design/`: `notes.md` (Regeln), `projekt.md` und weitere `.md` (Hintergrund), `tokens-quelle.css` (Design-Tokens als CSS-Variablen im `:root`-Block). `project-package.sh` übernimmt die Variablen als gesperrte Tokens (`design.mjs import-css`: Kategorie aus dem Namen, Verweise per `var()` werden zu `var(--dps-…)`, `clamp()`/`calc()` erlaubt, Werte ohne Kategorie wie Schriftstärken landen in `tokens-map.json` unter `ohneToken`) und schreibt `paket/` (`CLAUDE.md`, `tokens.css`, `regeln.md`, Hintergrund, `README.md`, `entwuerfe/`; nicht versioniert, `entwuerfe/` bleibt beim Neuerzeugen). `project-export.sh` schreibt je Komponente `component.html`/`component.css` und schreibt dabei `var(--dps-…)` über `tokens-map.json` auf die Variablen des Projekts zurück; Tokens nur aus Page Studio stehen in `dps-zusatz.css`. Neu einlesen und Seiten hinzufügen sind für neue Projekte gesperrt.

### Komponenten-Bibliothek (neue Projekte)

Eine Bibliotheks-Komponente besteht aus `components/mx-<name>.css` (wie jede übernommene Komponente), `components/mx-<name>.html` (Vorlage: Wurzel mit Klasse `mx-<name>`, `data-mx-variant="<Standard>"` und dessen Modifiern, `data-mx-slot="<key>"` an jeder austauschbaren Stelle, Slots aller Varianten) und `components/mx-<name>.json`:

```json
{ "name": "button", "title": "Button", "beschreibung": "Aktion auslösen", "herkunft": "/seiten/startseite.html",
  "slots": [{ "key": "text", "label": "Beschriftung", "typ": "text", "pflicht": true }, { "key": "icon", "label": "Icon", "typ": "icon", "pflicht": false }],
  "varianten": [{ "key": "primary", "label": "Primary", "klassen": "mx-button--primary", "slots": ["text"] },
                { "key": "primary-icon", "label": "Primary mit Icon", "klassen": "mx-button--primary mx-button--icon" }],
  "vorschau": { "breite": 206, "spalten": 2 } }
```

`vorschau` (optional) betrifft nur die Komponentenseite: `breite` in px, die das Element beim Anlegen hatte (`draft-apply.sh` setzt sie aus `rect.width` des Entwurfs; Entwürfe auf der Komponentenseite und Umbenennen behalten sie), `spalten` = Varianten je Zeile (1–12; setzt Claude in `component.json` des Entwurfs, ohne Angabe bleibt die bisherige).

Slot-Typen: `text`, `richtext`, `bild`, `icon`, `link`, `liste`. Varianten sind feste, benannte Kombinationen von Modifiern `mx-<name>--…` (CSS im selben `@scope`, z. B. `:scope.mx-button--primary`); `slots` einer Variante nennt die Slots, die es in ihr gibt (ohne Angabe: alle). Die erste Variante ist der Standard. Eingesetzte Komponenten (Instanzen) sind Kopien der gerenderten Variante (`components.mjs render`: Modifier getauscht, fremde Slots entfernt) mit `data-mx-variant`. Die Wurzel einer Instanz darf zusätzliche Kontextklassen tragen (Anpassung an den Einsatzort, gestaltet von der Umgebung); Klassen der Vorlage müssen bleiben. Elemente mit Klasse `mx-<name>` ohne `data-mx-variant` gelten nicht als Instanz.

`component-delete.sh` (Schritt mit `source: "component-delete"`, keine Übertragung gleicher Bereiche): Ohne Variante entfallen `mx-<name>.json` und `.html`; `mx-<name>.css` bleibt, solange Elemente mit der Klasse auf den Seiten stehen. Mit Variante entfällt deren Eintrag; Slots, die keine verbliebene Variante hat, fallen aus Beschreibung und Vorlage; zeigt die Vorlage die gelöschte Variante, zeigt sie danach die erste verbliebene. Die einzige Variante lässt sich nicht löschen (Exit 2). In beiden Fällen verlieren die betroffenen Instanzen byte-genau `data-mx-variant` und ihre `data-mx-slot` (eingebettete andere Komponenten bleiben gekennzeichnet); Markup und Klassen bleiben. Ausgabe: Ergebnis von `commit-step.sh` plus `{ name, variant, unmarked, pages, removedFiles, keptCss, removedSlots }`. Die Komponentenseite zeigt je Komponente und Variante die Zahl der Verwendungen (`data-kb-uses`), je Komponente die Zahl abweichender Kopien (`data-kb-off`) und im Overlay Papierkorb-Symbole zum Löschen sowie die Knöpfe „Ändern …“ (Komponente und je Variante), „Variante hinzufügen …“ und „N Kopie(n) angleichen“.

**Umbenennen:** `component-rename.sh <slug> <name> <neuer-name>` (Schritt mit `source: "component-rename"`, Rücksprung möglich) benennt `components/mx-<name>.css|html|json` um und ersetzt die Klasse `mx-<name>` (als ganzes Wort, auch Modifier `mx-<name>--…` und `@scope`) byte-genau in allen `.html`/`.css` unter `www/`, in `components/` und in `overrides.css`; in der Beschreibung `name` und die Klassen der Varianten. Ausgabe: Ergebnis von `commit-step.sh` plus `{ name, newName, files, replaced }`. Exit 2: ungültiger oder schon vergebener Name, Exit 4: nicht in der Bibliothek.

**Zusammenführen:** `component-merge.sh <slug> <quelle> <ziel> <variante>` (Schritt mit `source: "component-merge"`, Rücksprung möglich), z. B. zwei Buttons zu einem mit Varianten. Jede gekennzeichnete Kopie von `mx-<quelle>` auf den Seiten und in den Vorlagen anderer Bibliotheks-Komponenten wird wie beim Angleichen als Variante `<variante>` von `mx-<ziel>` neu aufgebaut (Slots nach Schlüssel, eingebettete Komponenten, Kontextklassen, `id`, übrige Attribute der Wurzel); die Klassen der alten Vorlage entfallen. Danach entfallen `mx-<quelle>.json` und `.html`, das CSS sobald kein Element mehr die Klasse trägt (`keptCss`); Stylesheets, die `mx-<quelle>` noch nennen, stehen in `cssRefs`. `mx-<ziel>` muss alle Slots von `mx-<quelle>` haben (sonst Exit 2, vorher per „Ändern …“ ergänzen). Ausgabe: Ergebnis von `commit-step.sh` plus `{ name, into, variant, merged, pages, templates, skipped, placeholders, removedFiles, keptCss, cssRefs }`. Exit 4: Komponente nicht in der Bibliothek. Im Overlay: „Umbenennen …“ und „Zusammenführen …“ an jeder Komponente der Komponentenseite.

**Ändern auf der Komponentenseite:** `draft-create.sh` mit `mode: "library"` (`component`, `variant`, `newVariant`) legt einen Entwurf mit `draft.json .target = "library"`, `page: "/__komponenten"`, `selector: ".mx-<name>"` an. Material ist die Vorlage `components/mx-<name>.html` (`source.html`) mit Beschreibung (`bestand-komponente.json`); keine Messung des Hauptrasters, kein Briefing für claude.ai. Varianten, die auf Seiten verwendet werden (und eine neue Variante), sind Pflicht: `draft.mjs validate` mit `DRAFT_REQUIRED_VARIANTS` meldet eine fehlende als Fehler; entfernen geht nur über `component-delete.sh`. `draft-apply.sh` schreibt bei diesem Ziel nur `components/mx-<name>.css|.html|.json` (kein Element auf einer Seite, Schritt ohne `page`/`selector`), `herkunft` bleibt. Die Ausgabe nennt mit `deviating` die Kopien auf den Seiten, die danach von der Vorlage abweichen; das CSS wirkt sofort auf allen Seiten, der Aufbau erst nach dem Angleichen.

**Angleichen:** `component-sync.sh <slug> <name>` (Schritt mit `source: "component-sync"`, keine Übertragung gleicher Bereiche, Rücksprung möglich) baut jede abweichende Kopie aus der Vorlage ihrer Variante neu auf (`components.mjs sync`, `syncInstance`). Übernommen werden Slot-Inhalte nach Schlüssel und Reihenfolge, an Slots die Attribute `src srcset sizes alt width height href target rel title aria-label datetime loading`, bei Icon-Slots die Klasse, eingebettete andere Komponenten sowie Kontextklassen, `id` und die übrigen Attribute der Wurzel (z. B. `type`, `data-…`, `aria-…`; nicht `data-mx-*`). Ist die Wurzel selbst ein Slot (Button mit Text als Slot), zählt sie als dieser Slot. Optionale Slots, die die Kopie nicht hatte, entfallen; fehlende Pflicht-Slots behalten den Beispielinhalt der Vorlage (`placeholders`). Mehrdeutiges (ein Slot mehrfach, in der Vorlage anders oft), unbekannte Varianten und Stellen ohne eindeutige Quelltext-Spanne bleiben unverändert (`skipped`). Byte-genau: ersetzt wird nur die Quelltext-Spanne der Kopie. Ausgabe: Ergebnis von `commit-step.sh` plus `{ name, synced, pages, skipped: [{ page, reason }], placeholders: [{ page, slot }] }`; `status: "nochange"`, wenn keine Kopie abweicht. Exit 4: Komponente nicht in der Bibliothek.

Entstehung: `draft-create.sh` mit `mode: "component"` legt einen Entwurf mit `draft.json .component = { name }` an. Claude bekommt `seiten-css.css` (CSS der Seite, `draft.mjs page-css`) und gestaltet nicht neu; jede Version braucht `component.json` (`draft.mjs validate` mit `DRAFT_REQUIRE_LIBRARY=1`, geprüft von `validateLibrary`). Ist das Element schon eine übernommene Komponente, bleibt deren Name. Überarbeitungen von Bibliotheks-Komponenten (normaler Entwurf auf `.mx-<name>`) bekommen `bestand-komponente.json` und brauchen ebenfalls `component.json`. `draft-apply.sh` schreibt Vorlage und Beschreibung (`herkunft` = Seite des Entwurfs) und setzt auf der Seite die gerenderte Variante ein. Kontext für Claude (`context.sh`, auch in Entwürfen): Block `<komponenten>` mit Name, Titel, Beschreibung, Varianten, Slots und Pfad der Vorlage sowie den Regeln zum Einsetzen. `project-export.sh` exportiert Bibliotheks-Komponenten mit Vorlage, `component.json` und allen Varianten in `vorschau.html`.

`page-delete.sh` löscht eine Seite (Abzüge und neue Projekte) als Schritt A-xxx mit `source: "delete"` über `commit-step.sh`; ein Rücksprung holt sie zurück. Bei Abzügen entfernt es die URL der Seite aus `urls.txt` (dafür erlaubt `check-diff.sh` bei diesem Schritt Änderungen an `urls.txt`, `CHECK_ALLOW_URLS`), die Startseite (`entry`) lässt sich nicht löschen. Links anderer Seiten auf die gelöschte Seite bleiben und erscheinen als Hinweis `page-links`; Bilder und CSS der Seite bleiben liegen. Ausgabe: Ergebnis von `commit-step.sh` plus `{ page, removedUrls, links: { count, files } }`.

### Entwürfe (`sites/<slug>/drafts/D-xxx/`, nicht versioniert)

`draft.json` (Metadaten, Versionen mit `source: "import"` bei Importen, `sessionId`, `sessionCostUsd`, `appliedAs`, `external: true` bei Gestaltung in claude.ai, `material`), `layout.json` (gemessenes Hauptraster), `brief/` (Briefing: `briefing.md`, `<id>-element.html`, `<id>-hintergrund.md`, `<id>-desktop.png`, `<id>-mobil.png`, `brief.json`), `import-v<n>.html` (bereinigter Import) und `import-v<n>.original.html`, `CLAUDE.md` (aus `templates/DRAFT.md`), `source.html`, `bausteine.json`, `refs/`, je Version `v<n>/befund.json` (`[{ id: "P1", gruppe: "pflicht"|"inhalt"|"funktionen"|"feinschliff", titel, text, umgesetzt }]`, Pflicht beim Erzeugen, ältere Entwürfe ohne bleiben gültig), `component.html`, `component.css`, `meta.json` (`{ name, title, bausteine: [{ key, label, source: "neu"|"bestand", klassen: { neu, bestand } }] }`; Baustein-Elemente tragen `data-mx-baustein="<key>"`, das Overlay tauscht in der Vorschau die Klassen für „neu/wie bisher“ live). Ergänzte Funktionen tragen `data-mx-platzhalter="<was anzubinden ist>"`; beim Übernehmen stehen Platzhalter und offene Befundpunkte in der Zusammenfassung des Schritts.

Prüfung (`scripts/lib/draft.mjs`): genau ein Wurzelelement mit Klasse `mx-<name>`; CSS nur in `@scope (.mx-<name>)` (auch innerhalb von `@media`/`@supports`/`@container`), Keyframes `mx-<name>…`; verboten sind Scripts, Event-Handler, iframes, `<style>`/`<link>`/`<meta>`/`<base>`, `@import`, `@layer`, `javascript:` und Domains, die nicht im Ausgangsmaterial oder als Host der Website vorkommen. Ist eine Version ungültig, bekommt Claude eine Korrekturrunde.

**Überarbeitung:** Ist das gewählte Element selbst eine übernommene Komponente (Wurzel mit Klasse `mx-<name>` und `components/mx-<name>.css` vorhanden), setzt `draft-create.sh` `revises: <name>`, legt das bisherige CSS als `bestand-komponente.css` bei und verlangt denselben Namen; `draft-apply.sh` ersetzt dann die vorhandene CSS-Datei. Ausnahme „Als Komponente“ mit anderem Namen: Eine Komponente ohne Bibliotheks-Eintrag wird umbenannt (`renames: <alter Name>`, neue Klasse und neuer Scope); `draft-apply.sh` entfernt das alte CSS, sobald keine Seite die alte Klasse mehr verwendet. Bibliotheks-Komponenten behalten ihren Namen (Hinweis im Entwurf).

**Gestaltung in claude.ai:** `draft-create.sh` mit `mode: "brief"` legt den Entwurf ohne Version an und ruft `draft-brief.sh`: Briefing-Text (Auftrag, Hauptraster, Token-Block, gesperrte Tokens, Regeln aus `notes.md`, Gestaltungsleitlinien, Ausgabeformat: ein HTML-Artefakt ohne React/JavaScript, ein `<style>`, ein Wurzelelement, keine externen Schriften/Bilder) und Dateien zum Hochladen. Ein Import (`importFile`) wird mit `draft.mjs import-clean` bereinigt (Scripts, Handler, Frames, `<link>`, `@import`, externe `@font-face`; React-Artefakte ohne statisches HTML werden abgewiesen) und von Claude in einer frischen Session ohne Neugestaltung übernommen: Komponentenformat, Werte auf Tokens, Hauptraster, Inhalte und Pfade aus `source.html`. Bereinigungshinweise erscheinen als Warnungen der Version.

Status „übernommen“ ergibt sich aus dem Abzug: `appliedAs` gesetzt und `annotations/<appliedAs>.json` vorhanden. Nach Verwerfen der Prüfung oder einem Rücksprung ist der Entwurf wieder offen.

Ausgelieferte Seiten erhalten eine Content-Security-Policy, die Scripts und Verbindungen nur zur eigenen Adresse erlaubt.
