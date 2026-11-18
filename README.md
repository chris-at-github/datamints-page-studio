# datamints Page Studio

Lokales Werkzeug zur Website-Optimierung per Element-Annotation und Claude Code. Konzept: [projektplan-page-studio.md](projektplan-page-studio.md), Schnittstellen: [docs/api.md](docs/api.md).

## Einrichtung (WSL2)

Voraussetzungen: DDEV ≥ 1.24.3, Node.js ≥ 20.6, git, wget, curl, jq, file, Claude Code (angemeldet).

```bash
git clone <repo-url> ~/www/datamints-page-studio && cd ~/www/datamints-page-studio
./install.sh                               # prüft Voraussetzungen, npm install, Playwright-Chromium, .env mit Token
ddev start                                 # Bridge-Server: https://datamints-page-studio.ddev.site:3443
npm run worker                             # Worker in der WSL (eigenes Terminal, läuft dauerhaft)
```

`install.sh` ist mehrfach ausführbar; eine vorhandene `.env` bleibt unverändert. Der Ordnername ist frei, die Adresse ergibt sich aus `name:` in `.ddev/config.yaml`. Läuft auf demselben Rechner noch eine alte Installation (Modio) mit denselben Ports 3080/3443, diese vorher mit `ddev stop` beenden.

`inotify-tools` und ImageMagick werden nicht gebraucht: Der Worker ist ein Node-Prozess, Bilder verarbeitet `sharp`.

**Node-Versionen:** Der Bridge-Server läuft im DDEV-Container (Node 22, `.ddev/config.yaml`), Worker und Skripte in der WSL. Die Skripte wählen ihre Node-Version selbst (`scripts/lib/node-env.sh`): zuerst `DPS_NODE` aus der `.env`, dann ein passender `node` im PATH (ab 20.6), dann nvm (Version aus `.nvmrc`). Ein alter System-Node wie `/usr/bin/node` 18 wird so auch in Shells ohne nvm übergangen; findet sich keine passende Version, bricht das Skript mit einer klaren Meldung ab. `npm run worker` selbst in einer Shell mit nvm starten (`nvm use`).

### Abzüge aus einer Modio-Installation übernehmen

Bis 2026-11 hieß das Werkzeug Modio. Abzüge von dort übernimmt `site-migrate.sh` in die neue Installation:

```bash
./scripts/site-migrate.sh <slug> ~/www/modio --dry-run   # nur anzeigen, was sich ändert
./scripts/site-migrate.sh <slug> ~/www/modio             # übernehmen
```

Das Skript kopiert `sites/<slug>/` (und archivierte Stände `archive/<slug>-*`) und stellt die alten Namen um: `--modio-*` → `--dps-*`, `_modio-assets` → `_dps-assets`, `data-modio-*` → `data-dps-*`, von Claude vergebene Klassen wie `modio-btn` → `dps-btn`, „Modio“ → „Page Studio“. Umgeschrieben werden Seiten, CSS, Komponenten, Annotationen, Entwürfe und der **ganze Verlauf samt Tags**, damit Rücksprünge auf ältere Schritte weiter passen (die Commit-IDs ändern sich dabei). Binärdateien wie Schriften bleiben unverändert, Wörter mit „modio“ in der Mitte (z. B. *commodious*) ebenfalls. Die alte Installation wird nur gelesen. Voraussetzung: In der alten Installation gibt es für die Website keine offenen Jobs, keine gesammelten Annotationen und keine nicht übernommenen Änderungen. „Nachbessern“ des letzten Schritts startet nach dem Umzug neu, Entwürfe setzen mit einer frischen Claude-Sitzung fort.

## Bedienung

1. `https://datamints-page-studio.ddev.site:3443` öffnen, URL eintragen (optional Seitenliste) → Abzug wird erstellt. Weitere Seiten einer bestehenden Website später über „Seiten hinzufügen“ in der Websiteliste: Die bisherigen Schritte bleiben erhalten, nur fehlende Dateien kommen dazu, Links auf die neuen Seiten zeigen danach auf den Abzug. Seiten löschen: Panel „Seiten“ im Overlay → Papierkorb-Symbol, nach Rückfrage ein Schritt A-xxx; die URL verschwindet auch aus `urls.txt`, die Startseite bleibt. Links anderer Seiten auf die gelöschte Seite werden als Hinweis gemeldet.
2. „Öffnen“ → Website mit Overlay. **Alt+A** schaltet den Auswahlmodus, **Pfeil hoch** wählt das Elternelement, Klick oder Enter bestätigt.
3. Prompt eingeben, optional Referenzbilder (Drag-and-drop, auch einer Bild-URL aus einem anderen Fenster, Strg+V, Datei) → „In die Queue“ (Strg+Alt+Enter) oder im Menü des Split-Buttons „Direkt umsetzen“ (Strg+Umschalt+Enter). Geschlossen wird der Dialog mit X oder Esc. Gesammelte Annotationen setzt „Queue umsetzen (n)“ in der Leiste als **einen** Schritt in einer Claude-Session um; sammeln geht auch, während ein Schritt läuft.
4. Claude setzt um, der Snapshot entsteht, die Seite lädt neu. Bei auffälligen Änderungen erscheint der Prüfdialog.
5. „Verlauf“ → zu jedem Stand zurückspringen. „Nachbessern“ korrigiert den letzten Schritt in derselben Claude-Session.
6. Tokens und Regeln pflegst du im Design-Panel. Im Annotationsdialog fügt „Token oder Komponente einfügen“ (oder Strg+Leertaste) einen Token wie `color.primary` in den Prompt ein; Claude setzt ihn als `var(--dps-color-primary)` um. Dasselbe Popup listet in neuen Projekten die Komponenten der Bibliothek, je Variante eine Zeile; eingefügt wird ein Bezug wie `mx-produktkachel (Variante kompakt; Slots: titel, preis)`. Anzahl und Inhalte schreibst du frei dazu, z. B. „Darunter 3× … : Espresso 4,90 €, …“. Details: [projektplan-erweiterung-design.md](projektplan-erweiterung-design.md).
7. Der Knopf „Design“ im Overlay öffnet die Design-Vorgaben: Tokens bearbeiten und sperren, Regeln pflegen, Werte per Klick auf ein Element übernehmen oder aus dem Abzug ableiten lassen.
8. Gleiche Bereiche (z. B. Header, Footer): Im Design-Panel unter „Gleiche Bereiche“ → „Auswählen“, Element bzw. Elternelement in der Pfadleiste wählen, „Übernehmen“. Der Bereich landet mit einem Selektor ohne Positionsangaben in `design/consistency.json`; die Seiten bleiben dabei unverändert. „Für alle Seiten übernehmen“ kopiert die Bereiche der geöffneten Seite ohne Claude auf alle Seiten (relative Links und aktiver Menüpunkt werden je Seite angepasst). Ändert danach ein Schritt einen gleichen Bereich auf einer Seite, überträgt `commit-step.sh` die Änderung automatisch auf alle Seiten (im selben Commit). Haben mehrere Seiten ihn unterschiedlich geändert, erscheint nur ein Hinweis. Neue Seiten („Seiten hinzufügen“) übernehmen die Bereiche automatisch, wenn die vorhandenen Seiten sich einig sind.
10. Eigene Änderungen ohne Claude: Sobald Page Studio Änderungen erkennt, erscheint in der Leiste „Änderungen übernehmen (n)“. Erkannt werden im Inspektor geänderte Elemente (HTML, Text, Inline-Styles), im Styles-Panel geänderte CSS-Regeln (landen als Regel in `overrides.css`) und geänderte Dateien im Abzug (Editor, Chrome-DevTools-Workspaces). Im Panel wählst du aus, was übernommen wird (mit Diff). Alles läuft durch dieselbe Prüfung wie Claude-Schritte und wird ein Schritt A-xxx im Verlauf. Änderungen, die Scripts der Website selbst machen (beim Laden oder laufend), blendet Page Studio so weit wie möglich aus.
9. Startseite → „Report erzeugen“ → `sites/<slug>/CHANGES.md`.
11. Entwürfe: Element wählen → „Entwurf erstellen“ (Hauptknopf im Dialog, Strg+Enter). Claude gestaltet es ohne Altlasten als Komponente, die Vorschau zeigt die echte Seite. Im Panel „Entwürfe“ Versionen, „Aktuell“ (Taste V) und Bausteine live vergleichen, nachbessern, übernehmen. Details: [projektplan-erweiterung-entwurf.md](projektplan-erweiterung-entwurf.md). Das Ausgangsmaterial (`source.html`) kommt ungekürzt aus der Seitendatei, nicht aus dem auf 20 000 Zeichen gekürzten Browser-HTML. Ältere Entwürfe mit gekürztem Material werden bei der nächsten Version einmal nachgeladen. Vor dem ersten Entwurf misst Playwright das Hauptraster des Elements (Breite, Inhaltsbreite, Hauptspalten je Bildschirmbreite) in `layout.json`. Es ist für Claude verbindlich, innerhalb der Spalten bleibt die Gestaltung frei.
12. Gestaltung in claude.ai: Der Einstieg im Annotationsdialog ist entfallen. Für vorhandene Entwürfe bleibt im Panel „Entwürfe“ der Bereich „Gestaltung in claude.ai“: „Briefing kopieren“ und in einen neuen Chat auf claude.ai einfügen, die Dateien (Element-HTML, Hintergrundwissen, Screenshots) dort hochladen. Das fertige HTML-Artefakt herunterladen und mit „HTML importieren“ übernehmen: Claude bringt es ohne Neugestaltung ins Komponentenformat (Tokens, Hauptraster, Inhalte aus dem Abzug). Danach wie gewohnt mit Hinweisen nachbessern und übernehmen. Ein Import geht als neue Version jedes offenen Entwurfs.

### Neue Designs ohne bestehende Website

1. Startseite → „Neues Projekt (ohne Website)“: Titel und Kurzname. Page Studio legt `sites/<kurzname>/` ohne Seiten und mit Vorlagen unter `design/` an.
2. Angaben pflegen: `design/notes.md` (Gestaltungsregeln), `design/projekt.md` und weitere `.md` (Angebot, Zielgruppen, Funktionen), `design/tokens-quelle.css` (Design-Tokens als CSS-Variablen, z. B. `--color-primary`, `--font-body`, `--space-m`).
3. „Aktionen → Paket erstellen“: Die Variablen werden gesperrte Tokens, `sites/<kurzname>/paket/` enthält CLAUDE.md, tokens.css, Regeln und Hintergrund. In claude.ai als Projekt verwenden (CLAUDE.md als Projektanweisungen, übrige Dateien als Projektwissen) oder lokal mit Claude Code im Paket-Ordner arbeiten (Ergebnisse unter `entwuerfe/`). Claude liefert je Seite eine vollständige HTML-Datei, Links auf andere Seiten als `<seitenname>.html`. Details in `paket/README.md`.
4. Projekt öffnen → in der Leiste „Seiten“ → „Seite importieren …“: HTML-Datei wählen, Seitenname angeben (die erste Seite heißt vorgeschlagen `startseite`). Die Datei wird unverändert zu `www/seiten/<seitenname>.html`, ein Schritt A-xxx im Verlauf (Rücksprung möglich). Enthält sie Scripts, Formulare mit fremdem Ziel oder eingebundene Dateien von fremden Servern (Bilder, Schriften, Stylesheets), wartet der Schritt wie jede Änderung auf Prüfung. Links (`<a href>`) auf fremde Domains erscheinen nur als Hinweis, je Domain zusammengefasst. Ein vorhandener Seitenname wird nach Rückfrage ersetzt (ebenfalls als Schritt). Weitere Seiten kommen auf demselben Weg dazu. Start ist `index.html`, sonst `startseite.html`, sonst die erste Seite. Löschen: im Panel „Seiten“ das Papierkorb-Symbol neben der Seite, nach Rückfrage ein Schritt A-xxx (Rücksprung holt die Seite zurück).
5. Nachbearbeiten wie bei jedem Abzug: Elementhinweise, Inspektor, gleiche Bereiche, Entwürfe für einzelne Bereiche. Hinweis: Die Vorschau lädt keine Scripts von fremden Servern (z. B. Tailwind-CDN). Deshalb verlangt das Paket reines HTML und CSS.
6. Komponenten-Bibliothek: Element auswählen → im Dialog „Komponente speichern“ (links im Footer) → Name eingeben (Prompt optional, z. B. gewünschte Varianten) → „Anlegen“. Claude gestaltet nicht neu. Er löst das Element mit seinem CSS als Komponente heraus, markiert die austauschbaren Inhalte (Slots: Text, Bild, Icon, Link …) und legt feste Varianten an (z. B. Primary, Secondary, mit Icon). Danach geht es wie bei Entwürfen weiter: Vorschau, nachbessern, übernehmen. Übernommen liegen Vorlage, Beschreibung und CSS in `components/mx-<name>.html|.json|.css`. Die Komponentenseite `/s/<kurzname>/__komponenten` zeigt alle Komponenten mit allen Varianten; der Link steht im Panel „Entwürfe“. Claude kennt die Bibliothek bei jeder Annotation („setze hier 6 Produktkacheln ein“, „Button-Text: Jetzt kaufen“). Eingesetzt wird eine Kopie der Vorlage, Claude ändert nur die Slots. Ändert ein Schritt den Aufbau einer eingesetzten Komponente, erscheint ein Hinweis (`component-structure`). Anpassungen an einen Einsatzort (z. B. Button in der Produktkarte) sind keine Variante: Die eingesetzte Komponente bekommt eine zusätzliche Kontextklasse auf ihrer Wurzel, gestaltet von der umgebenden Komponente. Die Komponentenseite ist im Panel „Seiten“ als feste Seite „Komponenten“ erreichbar. Löschen: dort das Papierkorb-Symbol an der Komponente oder an einer Variante (Schritt A-xxx, Rücksprung möglich). Verwendungen bleiben als normales Markup mit Klassen und CSS stehen, sind aber nicht mehr als Komponente gekennzeichnet. Gepflegt wird auf der Komponentenseite: „Ändern …“ (an der Komponente oder an einer Variante) und „Variante hinzufügen …“ starten einen Entwurf mit der Vorlage als Material, die Vorschau zeigt die Komponentenseite mit der Entwurfsversion; „Übernehmen“ ändert nur Vorlage, Beschreibung und CSS, Varianten in Verwendung bleiben Pflicht. Weichen danach Kopien auf den Seiten im Aufbau ab, baut „N Kopie(n) angleichen“ sie als eigener Schritt nach der Vorlage neu auf; Texte, Bilder, Links und Kontextklassen bleiben.
7. „Aktionen → Komponenten exportieren“: `sites/<kurzname>/export/<zeitpunkt>/` mit je Komponente component.html und component.css (mit den eigenen Variablennamen), tokens.css, komponenten.css und vorschau.html. Bibliotheks-Komponenten haben zusätzlich component.json (Varianten, Slots); die Vorschau zeigt alle Varianten.

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
# DPS_NODE=/home/<user>/.nvm/versions/node/v24.13.1/bin/node   # fester Node für alle Skripte (sonst automatisch)
NOTES_MAX_LINES=40
```

**Sichtprüfung:** Nach dem Umsetzen rendert `render-check.sh` die Seite vorher und nachher mit Playwright (Chromium, ohne Netz, nur ein lokal gebundener Server), misst das gewählte Element (Stilwerte, abgeschnittener oder überstehender Text, horizontales Scrollen, Verdeckung, Kontrast, neue Script-Fehler) und legt Ausschnitte unter `sites/<slug>/.render/<id>/` ab (lokal ignoriert, nicht im Verlauf). Claude sieht sich die Bilder in derselben Session an und bessert bei Bedarf einmal nach; das kostet je Annotation etwa 5–10 s Rendern plus eine kurze Claude-Runde. Gemeldet werden nur Verschlechterungen gegenüber vorher. Fehlt Playwright oder der Browser, wird die Sichtprüfung übersprungen. Der Browser muss zur installierten Playwright-Version passen: nach `npm install` einmal `./node_modules/.bin/playwright install chromium` (nicht ein globales `npx playwright`).

Ohne DDEV: `npm run server` (Port aus `BRIDGE_PORT`, Origin muss in `DPS_ALLOWED_ORIGINS` stehen).

## Tests

```bash
npm test                                                     # Phase 1: Skripte per Kommandozeile (lokale Testseite)
node --env-file=.env tests/api-test.mjs <base-url> <slug>    # Phase 2: Auslieferung, Injektion, Token/Origin
DPS_TEST_ANNOTATE=1 node --env-file=.env tests/api-test.mjs <base-url> <slug>   # Phase 3: echte Annotation (Claude)
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
- **Headless-Claude** läuft mit `--setting-sources project,local`, `--strict-mcp-config` und `tools/worker/claude-settings.json` (Deny-Regeln für Bash, Netzwerk, `.env`, Zugangsdaten, `.git`, `annotations/`). `DPS_API_TOKEN` wird aus der Umgebung von Claude entfernt.
- **`Write`** ist zusätzlich zu `Read,Edit,Grep,Glob` freigegeben (neue Dateien, leere `overrides.css`).
- **Referenzbilder einbauen:** Claude verlinkt `www/_dps-assets/<datei>`, das Skript kopiert die Datei nur, wenn sie tatsächlich verlinkt wurde.
- **`CHANGES.md`, `.state.json`, `.history.json`** sind im Site-Repo ignoriert, damit sie nicht als Änderung im nächsten Schritt landen.
- **`.claude/settings.json`** im Tool-Ordner sperrt neben `.env` und Zugangsdaten auch direkte `git`-, `curl`- und `wget`-Aufrufe.
