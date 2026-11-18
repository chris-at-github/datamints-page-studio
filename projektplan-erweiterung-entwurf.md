# datamints Page Studio – Erweiterung: Entwurf und Integration (Komponenten)

Ergänzung zu `projektplan-page-studio.md` und `projektplan-erweiterung-design.md`. Stand: 13.11.2026

## 1. Ziel

Gestaltungsaufträge sollen das Niveau erreichen, das Claude im Chat liefert. Heute arbeitet Claude in `run-annotation.sh` mit Overrides gegen fremdes CSS („nur Nötiges ändern“, Spezifität, `!important`), und die meiste Denkarbeit geht in die Altlasten statt in die Gestaltung.

Neu ist ein Ablauf in zwei Phasen:

1. **Entwurf:** Claude entwirft das gewählte Element als eigenständige **Komponente**, also Markup und eigenes CSS ab null. Er sieht nur den Inhalt des Elements, die Tokens, die Regeln und die Bausteine der Seite, aber kein Original-CSS. Entwürfe haben Versionen und werden wie im Chat nachgebessert (die Session wird fortgesetzt). Die Website bleibt dabei unberührt.
2. **Integration:** Der freigegebene Entwurf wird **per Skript ohne Claude** übernommen. Das Element in der Seite wird byte-genau durch das Markup der Komponente ersetzt, ihr CSS landet in `components/<name>.css`. Danach läuft alles wie bei jedem Schritt durch `commit-step.sh` (Prüfung, gleiche Bereiche übertragen, Commit A-xxx).

## 2. Entscheidungen

| Thema | Entscheidung | Grund |
|---|---|---|
| Isolation vom Alt-CSS | Cascade Layers: Original-CSS, `tokens.css` und `overrides.css` liegen in `@layer legacy`, Komponenten stehen ohne Ebene | CSS ohne Ebene schlägt CSS in einer Ebene unabhängig von der Spezifität, `!important`-Kämpfe entfallen. Weil `overrides.css` mit in `legacy` liegt, bleibt das Verhalten bestehender Schritte unverändert. Wir haben in den Zielprojekten vollen Zugriff auf die Einbindung des CSS. |
| Eigene Styles | `@scope (.mx-<name>) { … }`, Wurzelelement mit Klasse `mx-<name>` | Kurze Selektoren innen, nichts läuft nach außen aus. |
| Bausteine aus dem Bestand | Original-Klassen (z. B. `.btn.btn-primary`), dafür kein neues CSS | Was behalten wird, kostet im Code nichts und gestaltet sich über das Theme selbst. |
| Bausteine erfassen | Das Overlay misst beim Anlegen des Entwurfs per `getComputedStyle` typische Elemente der Seite (Buttons, Links, Überschriften, Text) | Gemessen wird die echt gerenderte Seite, ohne Playwright und ohne laufenden Server im Skript. |
| Vorschau | Die echte Seite mit ersetztem Element: `…/seite.html?__dps_draft=D-001&v=3` | Was man sieht, ist exakt das Ergebnis nach der Übernahme. Der Server ersetzt nach demselben Verfahren wie `draft-apply.sh`. |
| Integration | Deterministisches Skript, kein Claude | Keine Qualitätsverluste beim Zusammenführen, schnell, kostenlos. |
| Ablage der Entwürfe | `sites/<slug>/drafts/D-xxx/` (in `.gitignore`) | Iterationen gehören nicht in den Verlauf. Erst die Übernahme ist ein Schritt. Bei Umbenennen und Archivieren wandern sie mit. |
| Modell und Budget | Standard Opus, `DRAFT_MAX_BUDGET_USD` (Standard 2.00) | Gestaltung ist die Stelle, an der sich das stärkere Modell lohnt. |
| Aktivierung der Ebenen | Automatisch, sobald `components/*.css` existiert (und immer in der Vorschau) | Kein Schalter nötig. Ein Rücksprung vor die erste Komponente schaltet die Ebenen wieder ab. |

## 3. Dateien

```
sites/<slug>/
  components/mx-<name>.css         CSS der übernommenen Komponente (versioniert)
  drafts/D-001/                    nicht versioniert
    draft.json                     Metadaten, Versionen, Status
    CLAUDE.md                      Regeln für Entwürfe (aus templates/DRAFT.md)
    source.html                    HTML-Ausschnitt des gewählten Elements (Material)
    bausteine.json                 gemessene Bausteine der Seite
    refs/                          Referenzbilder
    v1/component.html              Markup (genau ein Wurzelelement mit Klasse mx-<name>)
    v1/component.css               @scope (.mx-<name>) { … }
    v1/meta.json                   { name, title, bausteine: [{ key, label, source: "bestand"|"neu" }] }
```

`draft.json`:

```json
{ "id": "D-001", "slug": "…", "page": "/www.example.de/index.html", "selector": "main > section.teaser",
  "prompt": "…", "created": "…", "status": "open|applied|discarded", "sessionId": "…",
  "appliedAs": null, "appliedVersion": null,
  "versions": [{ "v": 1, "prompt": "…", "created": "…", "summary": "…", "name": "teaser", "model": "…", "costUsd": 0.4 }] }
```

## 4. Skripte

| Skript | Aufruf | Aufgabe |
|---|---|---|
| `draft-create.sh` | `draft-create.sh <slug> <job.json>` | Neuer Entwurf (D-xxx, v1) oder neue Version (`params.draft` + `params.prompt`) per Claude. Prüft das Ergebnis (`draft.mjs validate`). |
| `draft-apply.sh` | `draft-apply.sh <slug> <draft-id> [version]` | Ersetzt das Element, schreibt `components/mx-<name>.css`, legt `annotations/A-xxx.json` an und ruft `commit-step.sh` auf. Exit 3 = Prüfung nötig. |
| `draft-discard.sh` | `draft-discard.sh <slug> <draft-id>` | Markiert einen Entwurf als verworfen. |

Gemeinsame Logik steckt in `scripts/lib/draft.mjs`: prüfen (keine Scripts, Event-Handler, iframes, fremde Domains, `@import`, `url()` nur relativ oder data:, genau ein Wurzelelement mit `mx-<name>`, CSS mit `@scope (.mx-<name>)`), Element ersetzen (byte-genau über die Positionen aus dem Parser) und CSS-Ebenen für die Auslieferung.

## 5. Server, Worker, Overlay

- **Server:**
  - `POST /api/sites/<slug>/drafts` (multipart wie bei Annotationen, zusätzlich `bausteine` in der Annotation) → Job `draft`.
  - `POST /api/sites/<slug>/drafts/<id>/versions` `{ prompt }` → Job `draft` mit `params.draft`.
  - `POST /api/sites/<slug>/drafts/<id>/apply` `{ version? }` → Job `draft-apply`.
  - `POST /api/sites/<slug>/drafts/<id>/discard` → Job `draft-discard`.
  - `GET /api/sites/<slug>/drafts` → Liste.
  - Vorschau über `?__dps_draft=D-001&v=3`.
  - Auslieferung von `__components.css`. Sind Komponenten vorhanden oder ist die Vorschau aktiv, wird das Alt-CSS in `@layer legacy` gelegt.
- **Worker:** Job-Typen `draft`, `draft-apply` (Exit 3 → `review`) und `draft-discard`.
- **Overlay:**
  - Im Prompt-Dialog kommt der Knopf „Entwurf erstellen“ dazu.
  - Neues Panel „Entwürfe“: Liste, Versionen, Umschalten zwischen „Aktuell“ und „Entwurf“ (Vorschau), Bausteine mit „alt/neu“ (ein Wechsel erzeugt eine neue Version), Nachbessern, Übernehmen, Verwerfen.
  - In der Vorschau zeigt ein Hinweisband den Entwurf und die Version.

## 6. Übernahme ins echte Projekt

`CHANGES.md` bekommt den Abschnitt „Komponenten und CSS-Ebenen“:

1. Einmalig das Theme-CSS in die Ebene `legacy` legen, z. B. per `@import url(theme.css) layer(legacy);` oder über einen Wrapper im Build. Bisherige Overrides gehören mit in `legacy`.
2. Je Komponente gilt: Markup ersetzt das Element (Seite und Selektor stehen im Schritt), und `components/mx-<name>.css` wird ohne Ebene eingebunden.

Einschränkungen: `!important` im Alt-CSS und Inline-Styles wirken weiterhin. In Komponenten deshalb kein `!important`.

## 7. Umsetzungsphasen

- **K1:** `draft.mjs`, `draft-create.sh`, `draft-apply.sh`, `draft-discard.sh`, `templates/DRAFT.md`, die Erweiterung von `check-diff` (`components/`) und Tests.
- **K2:** Server (API, Vorschau, Ebenen, `__components.css`) und Worker.
- **K3:** Overlay (Knopf „Entwurf erstellen“, Panel „Entwürfe“, Bausteine messen, Vorschau-Band).
- **K4:** Report, `templates/CLAUDE.md` (spätere Schritte an Komponenten ändern `components/…`), `docs/api.md`, `site-rename.sh`.

## 8. Später

- Screenshot-Abgleich per Playwright (Entwurf und Seite) und Selbstkontrolle durch Claude anhand von Bildern.
- Eine Komponente mehrfach verwenden (gleiche Komponente auf mehreren Seiten mit anderem Inhalt).
- Referenzbilder direkt in Entwürfe einbauen.

## 9. Umsetzungsstand (13.11.2026)

K1 bis K4 sind umgesetzt:

- **Skripte:** `draft-create.sh`, `draft-apply.sh` und `draft-discard.sh`, dazu `scripts/lib/draft.mjs` und `templates/DRAFT.md`. `add-reference.sh` nimmt auch Entwurfs-IDs an, `check-diff` lässt `components/mx-*.css` zu (mit Token-Hinweisen wie bei `overrides.css`).
- **Server und Worker:** Entwurfs-API, Vorschau im Seitenkontext, `__components.css`, `__draft.css`, CSS-Ebenen sowie die Job-Typen `draft`, `draft-apply` und `draft-discard`.
- **Overlay:** Knopf „Entwurf erstellen“ (Strg+Alt+Enter), Panel „Entwürfe“ (Versionen, Bausteine „neu/wie bisher“, Nachbessern, Übernehmen, Verwerfen) und das Vorschau-Band mit Umschalten „Aktuell / v1 / v2 …“ (Taste V). Nach einem fertigen Entwurf öffnet sich die Vorschau automatisch.
- **Report:** Abschnitt „Komponenten und CSS-Ebenen“ und Bezug zum Entwurf je Schritt.
- **Regeln:** `templates/CLAUDE.md` (spätere Annotationen an Komponenten ändern `components/…`, `drafts/` tabu) und `run-annotation.sh`.
- **Tests** (`tests/run.sh`): Prüfung und Übernahme, `draft-create.sh` mit simuliertem Claude (`tests/fake-claude/`), Server (`tests/draft-server-test.mjs`) und Browser (`tests/draft-overlay-test.mjs`, prüft im echten Rendering, dass die Komponente eine spezifischere Alt-Regel schlägt). Mit `SKIP_BROWSER=1` lässt sich der Browser-Test überspringen.

Abweichungen vom ursprünglichen Gedanken:

- Die Integration läuft ohne Claude (deterministisch). Ein zweiter Claude-Lauf zum Zusammenführen entfällt.
- Bausteine misst das Overlay im Browser, nicht ein Playwright-Skript.

## 10. Ergänzung: Leitlinien, Skill und Hintergrundwissen (13.11.2026)

Gilt für Entwürfe und Annotationen:

- **Gestaltungsleitlinien** (seit 16.11.2026 einzige Quelle `templates/leitlinien.md` mit den Abschnitten „Für alle Projekte“, „Zusätzlich bei bestehenden Websites“ und „Rangfolge“; die Skripte setzen sie in die `CLAUDE.md` jedes Abzugs, den Systemprompt der Entwürfe, das Briefing für claude.ai und das Paket neuer Projekte ein): moderner, Weiterentwicklung statt Redesign, Designkonzept bleibt erkennbar, kein KI-Look, Rundungen und Schatten sparsam, reines CSS mit Custom Properties, Tokens, kleine Bildschirme. Dazu eine Rangfolge: Regeln → verbindliche Vorgaben → Leitlinien → Hintergrund → Skill.
- **Skill „frontend-design“:** Der Inhalt der `SKILL.md` wird fest an den Systemprompt angehängt (bei Annotationen nur der Skill, die Leitlinien stehen dort schon in der CLAUDE.md) (`build_system_prompt` in `common.sh`). Den Pfad legt `DESIGN_SKILL_FILE` in der `.env` fest. Standard ist das installierte Plugin unter `~/.claude/plugins/…`; ein leerer Wert schaltet den Skill ab. Entwürfe speichern ihren Systemprompt als `drafts/D-xxx/SYSTEM.md`.
- **Hintergrundwissen:** Alle weiteren `design/*.md` außer `notes.md` kommen als Block `<hintergrund>` in den Kontext (`DESIGN_DOCS_MAX_BYTES`, Standard 60 000; was darüber hinausgeht, wird nur mit Pfad genannt). Änderungen daran blockiert `check-diff` ohne „Als Regel merken“ (Regel `docs-changed`).
- **Gelockerte Regeln:** `templates/CLAUDE.md` verlangt keine minimale Änderung mehr, sondern eine hochwertige Umsetzung innerhalb des gewählten Elements und Auftrags. `templates/DRAFT.md` versteht den Entwurf als Weiterentwicklung des bestehenden Erscheinungsbilds.

## 11. Ergänzung: Befund, Platzhalter, Textkorrekturen (13.11.2026)

Damit Entwürfe so durchdacht werden wie im Chat:

- **A – erst Befund, dann Entwurf:** Claude prüft das Element gegen `notes.md`, die Tokens, die Leitlinien und das Hintergrundwissen und schreibt `befund.json` in vier Gruppen (Pflicht, Inhalt, Funktionen, Feinschliff). Was eine Entscheidung braucht, bleibt offen (`umgesetzt: false`, mit möglichen Wegen). Das Panel zeigt den Befund mit Haken. Umschalten erzeugt mit „Neue Version“ einen Auftrag, Punkte umzusetzen oder zurückzunehmen.
- **C – Platzhalter:** Funktionen, die laut Hintergrund existieren, aber im Ausgangsmaterial fehlen, darf Claude ergänzen. Sie sind mit `data-mx-platzhalter` gekennzeichnet, berechenbare Werte werden ausgerechnet, Bedienelemente sind `<button type="button">` ohne Ziel. Das Vorschau-Band hat „Platzhalter zeigen“. Beim Übernehmen stehen die Platzhalter in der Zusammenfassung und im Report.
- **D – Textkorrekturen:** Texte, die gegen `<regeln>` verstoßen (Ansprache, Ton, Bezeichnungen, Schreibweisen), korrigiert Claude in Entwürfen und Annotationen und nennt die Korrekturen.
- **B – Screenshots und Selbstprüfung:** zurückgestellt.

## 12. Ergänzung: Bedienung und Überarbeitung (13.11.2026)

- **Panel behält den Zustand:** Scrollposition, Fokus, Text in „Nachbessern“ und Hinweise bleiben erhalten, wenn Befundpunkte oder Bausteine umgeschaltet werden.
- **Live-Umschalten in der Vorschau:** Versionen und „Aktuell“ wechseln ohne Neuladen (im Band, in den Versions-Reitern, Taste V). Das Markup kommt über `GET …/drafts/<id>/versions/<n>`, das CSS über `__draft.css`, und die URL wird mitgeführt.
- **Bausteine live:** Baustein-Elemente tragen `data-mx-baustein`, `meta.json` nennt `klassen.neu` und `klassen.bestand`. Das Overlay tauscht nur die Klassen, das CSS für „neu“ liegt immer vor. Endgültig wird die Wahl erst mit „Neue Version“. Ältere Versionen ohne `klassen` sind nicht live umschaltbar (Hinweis im Panel).
- **Hinweise zu Elementen:** „Element im Entwurf wählen“ (nur innerhalb der Komponente, ↑ = Elternelement) legt einen Hinweis mit Selektor relativ zur Komponente an. Beschreibungen gehen gesammelt in die nächste Version.
- **Überarbeitung übernommener Komponenten:** Ein Entwurf auf einer Komponente behält deren Namen, bekommt das bisherige CSS als Material und ersetzt beim Übernehmen `components/mx-<name>.css`.
