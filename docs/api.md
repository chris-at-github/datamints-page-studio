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
| `annotate` | Annotation (siehe unten) mit `references: [{type:"upload",file}|{type:"url",url}]` | `run-annotation.sh <slug> <job.json>` |
| `decision` | `{ jobId, action: "accept"|"discard" }` | `commit-step.sh <slug> <id> --accept` bzw. `discard-step.sh <slug>` |
| `rollback` | `{ target: "A-003"|"baseline"|<commit> }` | `rollback.sh <slug> <target>` |
| `report` | `{}` | `report.sh <slug>` |

`result` ist die JSON-Zeile, die das Skript auf stdout ausgegeben hat. Für `annotate`:

- fertig: `{ "status": "committed", "annotationId": "A-003", "commit": "<sha>", "summary": "…" }`
- keine Änderung: `{ "status": "nochange", "annotationId": "A-003", "summary": "…" }`
- Prüfung nötig (Job liegt in `review/`): `{ "status": "review", "annotationId": "A-003", "summary": "…", "hits": [{ "rule", "file", "line", "text" }], "diff": "…" }`

## Exit-Codes der Skripte

`0` Erfolg, `1` Fehler, `2` falscher Aufruf, `3` Prüfung nötig (nur `commit-step.sh` und `run-annotation.sh`).

## HTTP-API

Alle `/api/`-Routen verlangen den Header `X-Modio-Token` (bei `GET /api/events` alternativ `?token=`, weil `EventSource` keine Header setzen kann). Ein vorhandener `Origin`-Header muss in `MODIO_ALLOWED_ORIGINS` stehen.

| Route | Body | Antwort |
|---|---|---|
| `POST /api/sites` | JSON `{ url, slug?, urls?: [..] }` | `202 { job }` |
| `POST /api/sites/<slug>/recrawl` | – | `202 { job }` |
| `POST /api/sites/<slug>/annotations` | `multipart/form-data`: Feld `annotation` (JSON), Dateien im Feld `images` | `202 { job }`, `409` wenn für die Website schon ein Job aktiv ist oder auf Prüfung wartet |
| `POST /api/jobs/<job-id>/decision` | JSON `{ action: "accept"|"discard" }` | `202 { job }` |
| `POST /api/sites/<slug>/rollback` | JSON `{ target }` | `202 { job }` |
| `POST /api/sites/<slug>/report` | – | `202 { job }` |
| `GET /api/sites/<slug>/history` | – | Inhalt von `.history.json` |
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
  "references": [{ "type": "url", "url": "https://…" }]
}
```

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

Ausgelieferte Seiten erhalten eine Content-Security-Policy, die Scripts und Verbindungen nur zur eigenen Adresse erlaubt.
