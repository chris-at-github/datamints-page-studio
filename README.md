# Modio

Lokales Werkzeug zur Website-Optimierung per Element-Annotation und Claude Code. Konzept: [projektplan-modio.md](projektplan-modio.md), Schnittstellen: [docs/api.md](docs/api.md).

## Einrichtung (WSL2)

Voraussetzungen: DDEV ≥ 1.24.3, Node.js ≥ 20.6, git, wget, curl, jq, file, Claude Code (angemeldet).

```bash
npm install
cp .env.example .env                       # dann MODIO_API_TOKEN setzen:
sed -i "s|<zufälliger Wert.*>|$(openssl rand -hex 32)|" .env
ddev start                                 # Bridge-Server: https://modio.ddev.site:3443
npm run worker                             # Worker in der WSL (eigenes Terminal, läuft dauerhaft)
```

`inotify-tools` und ImageMagick werden nicht gebraucht: Der Worker ist ein Node-Prozess, Bilder verarbeitet `sharp`.

## Bedienung

1. `https://modio.ddev.site:3443` öffnen, URL eintragen (optional Seitenliste) → Abzug wird erstellt. Weitere Seiten einer bestehenden Website später über „Seiten hinzufügen“ in der Websiteliste: Die bisherigen Schritte bleiben erhalten, nur fehlende Dateien kommen dazu, Links auf die neuen Seiten zeigen danach auf den Abzug.
2. „Öffnen“ → Website mit Overlay. **Alt+A** schaltet den Auswahlmodus, **Pfeil hoch** wählt das Elternelement, Klick oder Enter bestätigt.
3. Prompt eingeben, optional Referenzbilder (Drag-and-drop, Strg+V, Datei, Bild-URL), „gründlich“ = Opus statt Sonnet → Absenden.
4. Claude setzt um, der Snapshot entsteht, die Seite lädt neu. Bei auffälligen Änderungen erscheint der Prüfdialog.
5. „Verlauf“ → zu jedem Stand zurückspringen. „Nachbessern“ korrigiert den letzten Schritt in derselben Claude-Session.
6. „Als Regel merken“ speichert Werte als gesperrte Tokens (`design/tokens.json`) und Regeln (`design/notes.md`), die in jedem folgenden Schritt verbindlich sind. Details: [projektplan-erweiterung-design.md](projektplan-erweiterung-design.md).
7. Der Knopf „Design“ im Overlay öffnet die Design-Vorgaben: Tokens bearbeiten und sperren, Regeln pflegen, Werte per Klick auf ein Element übernehmen oder aus dem Abzug ableiten lassen.
8. Gleiche Bereiche (z. B. Header, Footer): Element auswählen und im Annotationsdialog „Auf allen Seiten übernehmen“ wählen. Der Bereich landet in `design/consistency.json` und wird ohne Claude auf alle Seiten kopiert (relative Links und aktiver Menüpunkt werden je Seite angepasst). Im Design-Panel unter „Gleiche Bereiche“ lassen sich alle Bereiche der aktuellen Seite erneut übertragen oder Bereiche entfernen. Weicht ein Schritt davon ab, erscheint ein Hinweis. Neue Seiten („Seiten hinzufügen“) übernehmen die Bereiche automatisch, wenn die vorhandenen Seiten sich einig sind.
9. Startseite → „Report erzeugen“ → `sites/<slug>/CHANGES.md`.

Neue Einstellungen in der `.env` (alle optional):

```dotenv
CLAUDE_BARE=false                                  # true nur mit ANTHROPIC_API_KEY oder apiKeyHelper
CLAUDE_SETTINGS_FILE=./tools/worker/claude-settings.json
CLAUDE_MAX_BUDGET_USD=0.50                         # leer oder 0 = ohne Obergrenze
CONTEXT_HISTORY_COUNT=5
NOTES_MAX_LINES=40
```

Ohne DDEV: `npm run server` (Port aus `BRIDGE_PORT`, Origin muss in `MODIO_ALLOWED_ORIGINS` stehen).

## Tests

```bash
npm test                                                     # Phase 1: Skripte per Kommandozeile (lokale Testseite)
node --env-file=.env tests/api-test.mjs <base-url> <slug>    # Phase 2: Auslieferung, Injektion, Token/Origin
MODIO_TEST_ANNOTATE=1 node --env-file=.env tests/api-test.mjs <base-url> <slug>   # Phase 3: echte Annotation (Claude)
node --env-file=.env tests/overlay-test.mjs <base-url> <slug>                     # Phase 4/5: Browser (Playwright)
```

Für die Tests ab Phase 2 müssen Server und Worker laufen und eine Website aus `tests/fixture/site` angelegt sein
(`python3 -m http.server 8765 --directory tests/fixture/site` und `./scripts/site-new.sh http://127.0.0.1:8765/ testfirma`).
Fehlt der passende Playwright-Browser, `PLAYWRIGHT_CHROMIUM=/pfad/zu/chrome` setzen.

## Abweichungen und Ergänzungen zum Projektplan

- **Worker in Node** statt `inotifywait` (Polling + `fs.watch`), Bildverarbeitung mit `sharp` statt ImageMagick.
- **Job-Ordner `jobs/review/`** für Schritte mit Status „Prüfung nötig“; Entscheidungen laufen als eigener Job-Typ `decision`.
- **Exit-Code 3** = Prüfung nötig (`commit-step.sh`, `run-annotation.sh`, `check-diff.sh`).
- **Content-Security-Policy** für ausgelieferte Abzüge: Scripts und `fetch` nur zur eigenen Adresse (zusätzlicher Schutz gegen Datenabfluss).
- **`clean.sh`** entfernt außerdem `integrity`-Attribute (Prettier verändert das CSS, sonst blockiert der Browser die Stylesheets) und CSP-Meta-Tags der Originalseite. Der Host der Website gilt automatisch als eigene Domain.
- **Headless-Claude** läuft mit `--setting-sources project,local`, `--strict-mcp-config` und `tools/worker/claude-settings.json` (Deny-Regeln für Bash, Netzwerk, `.env`, Zugangsdaten, `.git`, `annotations/`). `MODIO_API_TOKEN` wird aus der Umgebung von Claude entfernt.
- **`Write`** ist zusätzlich zu `Read,Edit,Grep,Glob` freigegeben (neue Dateien, leere `overrides.css`).
- **Referenzbilder einbauen:** Claude verlinkt `www/_modio-assets/<datei>`, das Skript kopiert die Datei nur, wenn sie tatsächlich verlinkt wurde.
- **`CHANGES.md`, `.state.json`, `.history.json`** sind im Site-Repo ignoriert, damit sie nicht als Änderung im nächsten Schritt landen.
- **`.claude/settings.json`** im Tool-Ordner sperrt neben `.env` und Zugangsdaten auch direkte `git`-, `curl`- und `wget`-Aufrufe.
