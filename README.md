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

**Node-Versionen:** Der Bridge-Server läuft im DDEV-Container (Node 22, `.ddev/config.yaml`), Worker und Skripte in der WSL. Die Skripte wählen ihre Node-Version selbst (`scripts/lib/node-env.sh`): zuerst `MODIO_NODE` aus der `.env`, dann ein passender `node` im PATH (ab 20.6), dann nvm (Version aus `.nvmrc`). Ein alter System-Node wie `/usr/bin/node` 18 wird so auch in Shells ohne nvm übergangen; findet sich keine passende Version, bricht das Skript mit einer klaren Meldung ab. `npm run worker` selbst in einer Shell mit nvm starten (`nvm use`).

## Bedienung

1. `https://modio.ddev.site:3443` öffnen, URL eintragen (optional Seitenliste) → Abzug wird erstellt. Weitere Seiten einer bestehenden Website später über „Seiten hinzufügen“ in der Websiteliste: Die bisherigen Schritte bleiben erhalten, nur fehlende Dateien kommen dazu, Links auf die neuen Seiten zeigen danach auf den Abzug. Seiten löschen: Panel „Seiten“ im Overlay → Papierkorb-Symbol, nach Rückfrage ein Schritt A-xxx; die URL verschwindet auch aus `urls.txt`, die Startseite bleibt. Links anderer Seiten auf die gelöschte Seite werden als Hinweis gemeldet.
2. „Öffnen“ → Website mit Overlay. **Alt+A** schaltet den Auswahlmodus, **Pfeil hoch** wählt das Elternelement, Klick oder Enter bestätigt.
3. Prompt eingeben, optional Referenzbilder (Drag-and-drop, Strg+V, Datei, Bild-URL) → „In die Queue aufnehmen“ (Strg+Enter) oder „Direkt umsetzen“ (Strg+Umschalt+Enter). Gesammelte Annotationen setzt „Queue umsetzen (n)“ in der Leiste als **einen** Schritt in einer Claude-Session um; sammeln geht auch, während ein Schritt läuft.
4. Claude setzt um, der Snapshot entsteht, die Seite lädt neu. Bei auffälligen Änderungen erscheint der Prüfdialog.
5. „Verlauf“ → zu jedem Stand zurückspringen. „Nachbessern“ korrigiert den letzten Schritt in derselben Claude-Session.
6. Tokens und Regeln pflegst du im Design-Panel. Im Annotationsdialog fügt „Token einfügen“ (oder Strg+Leertaste) einen Token wie `color.primary` in den Prompt ein; Claude setzt ihn als `var(--modio-color-primary)` um. Details: [projektplan-erweiterung-design.md](projektplan-erweiterung-design.md).
7. Der Knopf „Design“ im Overlay öffnet die Design-Vorgaben: Tokens bearbeiten und sperren, Regeln pflegen, Werte per Klick auf ein Element übernehmen oder aus dem Abzug ableiten lassen.
8. Gleiche Bereiche (z. B. Header, Footer): Im Design-Panel unter „Gleiche Bereiche“ → „Auswählen“, Element bzw. Elternelement in der Pfadleiste wählen, „Übernehmen“. Der Bereich landet mit einem Selektor ohne Positionsangaben in `design/consistency.json`; die Seiten bleiben dabei unverändert. „Für alle Seiten übernehmen“ kopiert die Bereiche der geöffneten Seite ohne Claude auf alle Seiten (relative Links und aktiver Menüpunkt werden je Seite angepasst). Ändert danach ein Schritt einen gleichen Bereich auf einer Seite, überträgt `commit-step.sh` die Änderung automatisch auf alle Seiten (im selben Commit). Haben mehrere Seiten ihn unterschiedlich geändert, erscheint nur ein Hinweis. Neue Seiten („Seiten hinzufügen“) übernehmen die Bereiche automatisch, wenn die vorhandenen Seiten sich einig sind.
10. Eigene Änderungen ohne Claude: Sobald Modio Änderungen erkennt, erscheint in der Leiste „Änderungen übernehmen (n)“. Erkannt werden im Inspektor geänderte Elemente (HTML, Text, Inline-Styles), im Styles-Panel geänderte CSS-Regeln (landen als Regel in `overrides.css`) und geänderte Dateien im Abzug (Editor, Chrome-DevTools-Workspaces). Im Panel wählst du aus, was übernommen wird (mit Diff). Alles läuft durch dieselbe Prüfung wie Claude-Schritte und wird ein Schritt A-xxx im Verlauf. Änderungen, die Scripts der Website selbst machen (beim Laden oder laufend), blendet Modio so weit wie möglich aus.
9. Startseite → „Report erzeugen“ → `sites/<slug>/CHANGES.md`.
11. Entwürfe: Element wählen → „Entwurf erstellen“. Claude gestaltet es ohne Altlasten als Komponente, die Vorschau zeigt die echte Seite. Im Panel „Entwürfe“ Versionen, „Aktuell“ (Taste V) und Bausteine live vergleichen, nachbessern, übernehmen. Details: [projektplan-erweiterung-entwurf.md](projektplan-erweiterung-entwurf.md). Das Ausgangsmaterial (`source.html`) kommt ungekürzt aus der Seitendatei, nicht aus dem auf 20 000 Zeichen gekürzten Browser-HTML. Ältere Entwürfe mit gekürztem Material werden bei der nächsten Version einmal nachgeladen. Vor dem ersten Entwurf misst Playwright das Hauptraster des Elements (Breite, Inhaltsbreite, Hauptspalten je Bildschirmbreite) in `layout.json`. Es ist für Claude verbindlich, innerhalb der Spalten bleibt die Gestaltung frei.
12. Gestaltung in claude.ai: Element wählen, Auftrag eingeben → „In claude.ai gestalten“. Modio legt einen Entwurf ohne Version an und erstellt ein Briefing. Im Panel „Entwürfe“ unter „Gestaltung in claude.ai“: „Briefing kopieren“ und in einen neuen Chat auf claude.ai einfügen, die Dateien (Element-HTML, Hintergrundwissen, Screenshots) dort hochladen. Das fertige HTML-Artefakt herunterladen und mit „HTML importieren“ übernehmen: Claude bringt es ohne Neugestaltung ins Komponentenformat (Tokens, Hauptraster, Inhalte aus dem Abzug). Danach wie gewohnt mit Hinweisen nachbessern und übernehmen. Ein Import geht auch direkt im Annotationsdialog („HTML importieren …“) oder als neue Version jedes offenen Entwurfs.

### Neue Designs ohne bestehende Website

1. Startseite → „Neues Projekt (ohne Website)“: Titel und Kurzname. Modio legt `sites/<kurzname>/` ohne Seiten und mit Vorlagen unter `design/` an.
2. Angaben pflegen: `design/notes.md` (Gestaltungsregeln), `design/projekt.md` und weitere `.md` (Angebot, Zielgruppen, Funktionen), `design/tokens-quelle.css` (Design-Tokens als CSS-Variablen, z. B. `--color-primary`, `--font-body`, `--space-m`).
3. „Aktionen → Paket erstellen“: Die Variablen werden gesperrte Tokens, `sites/<kurzname>/paket/` enthält CLAUDE.md, tokens.css, Regeln und Hintergrund. In claude.ai als Projekt verwenden (CLAUDE.md als Projektanweisungen, übrige Dateien als Projektwissen) oder lokal mit Claude Code im Paket-Ordner arbeiten (Ergebnisse unter `entwuerfe/`). Claude liefert je Seite eine vollständige HTML-Datei, Links auf andere Seiten als `<seitenname>.html`. Details in `paket/README.md`.
4. Projekt öffnen → in der Leiste „Seiten“ → „Seite importieren …“: HTML-Datei wählen, Seitenname angeben (die erste Seite heißt vorgeschlagen `startseite`). Die Datei wird unverändert zu `www/seiten/<seitenname>.html`, ein Schritt A-xxx im Verlauf (Rücksprung möglich). Enthält sie Scripts, Formulare mit fremdem Ziel oder eingebundene Dateien von fremden Servern (Bilder, Schriften, Stylesheets), wartet der Schritt wie jede Änderung auf Prüfung. Links (`<a href>`) auf fremde Domains erscheinen nur als Hinweis, je Domain zusammengefasst. Ein vorhandener Seitenname wird nach Rückfrage ersetzt (ebenfalls als Schritt). Weitere Seiten kommen auf demselben Weg dazu. Start ist `index.html`, sonst `startseite.html`, sonst die erste Seite. Löschen: im Panel „Seiten“ das Papierkorb-Symbol neben der Seite, nach Rückfrage ein Schritt A-xxx (Rücksprung holt die Seite zurück).
5. Nachbearbeiten wie bei jedem Abzug: Elementhinweise, Inspektor, gleiche Bereiche, Entwürfe für einzelne Bereiche (auch „In claude.ai gestalten“: das Briefing legt den bisherigen Bereich bei). Hinweis: Die Vorschau lädt keine Scripts von fremden Servern (z. B. Tailwind-CDN). Deshalb verlangt das Paket reines HTML und CSS.
6. „Aktionen → Komponenten exportieren“: `sites/<kurzname>/export/<zeitpunkt>/` mit je Komponente component.html und component.css (mit den eigenen Variablennamen), tokens.css, komponenten.css und vorschau.html.

Einstellungen in der `.env` (alle optional). Werte, die beim Aufruf eines Skripts ausdrücklich gesetzt sind (`CLAUDE_EFFORT=max ./scripts/…`), haben Vorrang vor der `.env`. `CLAUDE_BARE=true` (alte Schreibweise) gilt als `CLAUDE_AUTH=api`.

```dotenv
CLAUDE_AUTH=konto                                  # konto = Claude-Abo (API-Schlüssel wird dem Aufruf entzogen)
                                                   # api   = ANTHROPIC_API_KEY oder apiKeyHelper, Aufruf mit --bare
# ANTHROPIC_API_KEY=sk-ant-…                       # darf dauerhaft stehen bleiben, wirkt nur mit CLAUDE_AUTH=api
CLAUDE_MODEL=claude-opus-5-5                       # Standard für alle Läufe (Annotation, Entwurf, Token-Vorschläge)
CLAUDE_EFFORT=high                                 # low | medium | high | xhigh | max
DRAFT_MODEL=                                       # leer = CLAUDE_MODEL
DRAFT_EFFORT=                                      # leer = CLAUDE_EFFORT
CLAUDE_SETTINGS_FILE=./tools/worker/claude-settings.json
CLAUDE_MAX_BUDGET_USD=1.50                         # je Annotation; leer oder 0 = ohne Obergrenze
DRAFT_MAX_BUDGET_USD=4.00                          # je Entwurfslauf
DRAFT_SOURCE_MAX_BYTES=200000                      # Ausgangsmaterial eines Entwurfs (Element aus der Seitendatei), darüber gekürzt mit Warnung
DRAFT_IMPORT_EFFORT=medium                         # Übernahme eines Imports aus claude.ai (keine Neugestaltung)
DRAFT_IMPORT_MAX_BUDGET_USD=2.00                   # je Übernahme eines Imports
# DESIGN_SKILL_FILE=/pfad/zu/SKILL.md              # nicht gesetzt = installiertes Plugin frontend-design, leer gesetzt = ohne Skill
DESIGN_DOCS_MAX_BYTES=60000                        # weitere design/*.md als Hintergrund
CONTEXT_HISTORY_COUNT=5
RENDER_REVIEW=always                               # Sichtprüfung nach jeder Annotation: always | issues | off
RENDER_MAX_ROUNDS=1                                # höchstens so viele Korrekturrunden nach der Sichtprüfung
RENDER_VIEWPORTS=desktop:1440x900,mobil:390x844    # Ansichten der Sichtprüfung (dazu der Viewport der Auswahl, falls abweichend)
# PLAYWRIGHT_CHROMIUM=/pfad/zu/chrome              # nur falls der Playwright-Browser nicht installiert werden kann
# MODIO_NODE=/home/<user>/.nvm/versions/node/v24.13.1/bin/node   # fester Node für alle Skripte (sonst automatisch)
NOTES_MAX_LINES=40
```

**Sichtprüfung:** Nach dem Umsetzen rendert `render-check.sh` die Seite vorher und nachher mit Playwright (Chromium, ohne Netz, nur ein lokal gebundener Server), misst das gewählte Element (Stilwerte, abgeschnittener oder überstehender Text, horizontales Scrollen, Verdeckung, Kontrast, neue Script-Fehler) und legt Ausschnitte unter `sites/<slug>/.render/<id>/` ab (lokal ignoriert, nicht im Verlauf). Claude sieht sich die Bilder in derselben Session an und bessert bei Bedarf einmal nach; das kostet je Annotation etwa 5–10 s Rendern plus eine kurze Claude-Runde. Gemeldet werden nur Verschlechterungen gegenüber vorher. Fehlt Playwright oder der Browser, wird die Sichtprüfung übersprungen. Der Browser muss zur installierten Playwright-Version passen: nach `npm install` einmal `./node_modules/.bin/playwright install chromium` (nicht ein globales `npx playwright`).

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
