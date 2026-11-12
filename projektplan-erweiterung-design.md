# Modio – Erweiterung: Kontext, Design-Tokens und Website-Regeln

Ergänzung zu `projektplan-modio.md`. Stand: 12.11.2026

Dieses Dokument beschreibt, was zum bestehenden Plan hinzukommt oder sich ändert. Es kann nach dem Grundbau als Arbeitsauftrag für Claude Code verwendet werden. Die Umsetzung erfolgt in den Phasen E1 bis E5 (Abschnitt 14). Den Stand der Umsetzung und die Abweichungen hält Abschnitt 17 fest.

## 1. Kurzfassung

1. **Jede Annotation läuft in einer frischen Claude-Session.** Das Wissen über frühere Schritte kommt nicht aus einem wachsenden Gesprächsverlauf, sondern aus Dateien im Site-Repo. `--resume` gibt es nur noch für einen Knopf „Nachbessern“.
2. **Jede Website bekommt ein Design-Gedächtnis** im Ordner `design/`: feste Design-Tokens (`tokens.json`, z. B. Primärfarbe, Radius der Buttons, Schrift) und Website-Regeln (`notes.md`, z. B. Du-Ansprache, „Header auf allen Seiten gleich“). Beides liegt im Site-Repo und wird mit jedem Schritt versioniert. Ein Rücksprung setzt es automatisch mit zurück.
3. **Der Kontext wird per Skript zusammengesetzt** (`context.sh`), nicht von Claude selbst gesammelt.
4. **Regeln werden, wo möglich, regelbasiert geprüft** (`check-diff.sh`, optional `check-consistency.sh`), statt sich nur auf Claude zu verlassen.

## 2. Entscheidungen im Überblick

| Thema | Entscheidung | Grund |
|---|---|---|
| Session | Frisch pro Annotation, Resume nur für „Nachbessern“ | Der Cache für unveränderten Prompt-Anfang hält standardmäßig nur etwa 5 Minuten. Bei deinem Rhythmus (ansehen, nachdenken, neuer Prompt) läuft er meist ab, und ein wachsender Verlauf wird dann jedes Mal komplett neu verarbeitet. Nach einem Rücksprung passt ein alter Verlauf außerdem nicht mehr zum Stand der Seite. |
| Wissen über frühere Schritte | Aus `annotations/`, `design/tokens.json` und `design/notes.md` | Liegt im Repo, wird beim Rücksprung automatisch mitgesetzt. |
| Feste Werte | `design/tokens.json` ist die einzige Quelle, `design/tokens.css` wird daraus generiert | Ein Ort, maschinenlesbar, direkt für Report und Übernahme ins echte Projekt nutzbar. |
| Regeln in Prosa | `design/notes.md`, Änderungen nur auf ausdrücklichen Wunsch („merken“) | Verhindert, dass sich unbemerkt Regeln ansammeln. |
| Startkontext | Schlank halten (Abschnitt 10) | Weniger Ballast, weniger Kosten, weniger Angriffsfläche. |

## 3. Wichtiger Hinweis zu `--bare` (Korrektur)

In der Kostenbetrachtung hatte ich `--bare` empfohlen. Das hat eine Einschränkung, die dort fehlte: `--bare` überspringt OAuth und Keychain, die Anmeldung muss dann über `ANTHROPIC_API_KEY` (oder einen `apiKeyHelper` in den per `--settings` übergebenen Einstellungen) kommen. Wer Claude Code über die Anmeldung mit einem Claude-Konto nutzt, bekommt mit `--bare` die Meldung „Not logged in“. Außerdem lädt `--bare` weder CLAUDE.md noch Settings automatisch, alles muss per Flag übergeben werden.

Deshalb gilt in Modio:

- Ein Schalter `CLAUDE_BARE` in der `.env` entscheidet (Standard: `false`).
- `CLAUDE_BARE=true` (nur mit API-Key): Aufruf mit `--bare`, die Regeln aus `sites/<slug>/CLAUDE.md` per `--append-system-prompt-file`, die Einstellungen per `--settings`.
- `CLAUDE_BARE=false` (Anmeldung per Claude-Konto): Aufruf ohne `--bare`. Damit werden globale Dinge aus `~/.claude` mitgeladen (MCP-Server, Skills, Plugins, Auto-Memory). Wie sich das für den Modio-Aufruf begrenzen lässt (z. B. über Optionen für MCP-Konfiguration und Settings-Quellen), ist beim Bau mit `claude --help` bzw. der aktuellen Doku zu prüfen und festzuhalten.
- In beiden Fällen werden die Deny-Regeln aus Abschnitt 7 des Hauptplans **explizit per `--settings`** übergeben. Da der Aufruf im Ordner `sites/<slug>/` läuft, der ein eigenes Git-Repo ist, ist nicht sicher, dass Einstellungen aus dem Tool-Ordner gefunden werden.

## 4. Neue Dateien je Website

```
sites/<slug>/
  design/
    tokens.json          feste Design-Tokens (Quelle, versioniert)
    tokens.css           generiert aus tokens.json (versioniert, nicht von Hand ändern)
    notes.md             Website-Regeln in Prosa (versioniert)
    consistency.json     optional: Bereiche, die auf allen Seiten gleich sein müssen
  .scan.json             Kandidaten aus tokens-scan.sh (nicht versioniert, in .gitignore)
```

Alles unter `design/` gehört ins Site-Repo und ist Teil des Baseline-Commits. `site-new.sh` legt die Dateien mit leerer `tokens.json` und einer `notes.md`-Vorlage an.

## 5. Design-Tokens

### 5.1 Format

```json
{
  "tokens": {
    "color.primary":       { "value": "#0B5FA5", "locked": true,  "note": "Primärfarbe, Buttons und Links" },
    "color.primary-hover": { "value": "#094B84", "locked": true },
    "color.text":          { "value": "#1F2933", "locked": true },
    "color.surface":       { "value": "#FFFFFF", "locked": false },
    "font.body":           { "value": "'Inter', system-ui, sans-serif", "locked": true },
    "font.size-base":      { "value": "1rem", "locked": false },
    "radius.button":       { "value": "8px", "locked": true, "note": "Alle Buttons" },
    "radius.card":         { "value": "12px", "locked": false },
    "space.section":       { "value": "4rem", "locked": false },
    "shadow.card":         { "value": "0 2px 8px rgba(0,0,0,.08)", "locked": false }
  }
}
```

- Schlüssel: `<kategorie>.<name>`. Erlaubte Kategorien: `color`, `font`, `size`, `radius`, `space`, `shadow`, `breakpoint`.
- `locked: true` bedeutet fest: Claude darf den Wert nicht ändern (Abschnitt 7). `locked: false` ist ein änderbarer Vorschlag.
- `note` ist optional und erklärt die Verwendung.

### 5.2 Generierung und Auslieferung

`tokens-build.sh <slug>` erzeugt `design/tokens.css` aus der JSON, z. B.:

```css
/* generiert aus tokens.json, nicht von Hand ändern */
:root {
  --modio-color-primary: #0B5FA5;
  --modio-radius-button: 8px;
}
```

Der Name ergibt sich aus Kategorie und Name mit Präfix `--modio-` (Punkte werden zu Bindestrichen). Claude hat im Headless-Modus keine Shell, deshalb ruft `run-annotation.sh` das Skript nach dem Claude-Aufruf und vor `check-diff.sh` auf.

Der Server liefert die Datei unter `/s/<slug>/__tokens.css` aus und bindet sie beim Einschleusen **vor** `__overrides.css` ein.

**Sicherheitsregel für die Generierung:** Weil aus `tokens.json` CSS entsteht, prüft `tokens-build.sh` jeden Wert. Werte mit `url(`, `@`, `;`, `{`, `}`, `<`, `>`, `\` oder `/*` werden abgelehnt (sonst ließe sich über einen Token-Wert eine externe Anfrage einschleusen). Zusätzlich wird je Kategorie das Format geprüft: Farben als Hex, `rgb(a)`, `hsl(a)` oder Farbname, Maße als Zahl mit Einheit, Schriften nur als Liste aus Namen. Bei einem Fehler bricht der Build ab und der Schritt erhält den Status „Prüfung nötig“.

### 5.3 Wirkung

Tokens verändern die Originalseite nicht von selbst. Sie wirken dort, wo `overrides.css` sie verwendet. Deshalb gilt die Regel: In `overrides.css` stehen `var(--modio-…)`-Verweise statt Literalwerten, wenn ein passender Token existiert. Ein Prompt wie „alle Buttons wie der Primärbutton“ führt dann zu Overrides, die auf `--modio-radius-button` und `--modio-color-primary` verweisen.

### 5.4 Befüllen

1. **Von Hand** in `design/tokens.json` (oder später im Design-Panel, Abschnitt 12).
2. **Per „merken“:** Beim Absenden einer Annotation mit dem Haken „Als Regel merken“ legt Claude einen genannten Wert („Primärfarbe ist #0B5FA5“) als Token mit `locked: true` an.
3. **Aus dem Abzug ableiten** (zweistufig, passend zum Skript-Prinzip):
   - `tokens-scan.sh <slug>` zählt regelbasiert die häufigsten Farben, `border-radius`-Werte, Schriften und Schriftgrößen im CSS unter `www/` und schreibt sie nach `.scan.json`.
   - Job `tokens-propose` (`tokens-propose.sh <slug>`): Claude bekommt `.scan.json` und schlägt daraus Token-Namen und Zuordnungen vor („welche Farbe ist die Primärfarbe?“). Alle Vorschläge erhalten `locked: false`, du bestätigst oder sperrst sie. Claude darf dabei nur Werte aus dem Scan verwenden und keine erfinden.

## 6. Website-Regeln (`notes.md`)

### 6.1 Inhalt

```markdown
# Gestaltungsregeln: example-de

## Sprache und Ton
- Du-Ansprache, kurze Sätze, keine Ausrufezeichen

## Struktur
- Header und Footer sind auf allen Seiten identisch (`header.site-header`, `footer.site-footer`)
- Änderungen an Header oder Footer immer auf allen Seiten durchführen

## Gestaltung
- Alle Buttons nutzen `radius.button`, Primärbuttons `color.primary`
- Links im Fließtext unterstrichen

## Nicht ändern
- Logo, Rechtstexte, Cookie-Hinweis
```

### 6.2 Wer darf sie ändern

- **Du**, von Hand oder später im Design-Panel.
- **Claude nur**, wenn die Annotation mit dem Haken „Als Regel merken“ (`remember: true`) abgeschickt wurde. Dann formuliert Claude aus deinem Prompt einen kurzen Eintrag. Ohne den Haken bleibt die Datei unverändert.

Weitere Regeln für Claude: Einträge stammen **ausschließlich aus deinem Prompt**, nie aus Seiteninhalt oder Referenzbildern. Keine URLs, kein HTML, kein Code, keine Codeblöcke. Widersprüchliche Einträge werden ersetzt, nicht ergänzt. Höchstens `NOTES_MAX_LINES` Zeilen (Standard 40).

## 7. Prüfungen (Erweiterung von `check-diff.sh`)

`check-diff.sh` liefert künftig zwei Stufen als JSON: `block` (Schritt wird nicht committet, Status „Prüfung nötig“) und `warn` (nur Hinweis im Overlay und im Report). Der Exit-Code ist nur bei `block`-Treffern ungleich 0.

| Prüfung | Stufe |
|---|---|
| `design/tokens.json` ist kein gültiges JSON oder `tokens-build.sh` lehnt einen Wert ab | block |
| Wert eines Tokens mit `locked: true` geändert oder Token entfernt (außer die Annotation hat `allow_token_change: true`) | block |
| `design/notes.md` geändert, obwohl `remember` nicht gesetzt war | block |
| `design/notes.md` enthält URLs, HTML-Tags, Codeblöcke oder ist länger als `NOTES_MAX_LINES` | block |
| `design/tokens.css` von Hand geändert (weicht vom Ergebnis von `tokens-build.sh` ab) | block |
| `overrides.css` enthält einen Literalwert, der exakt einem Token-Wert entspricht (nur Farben und Schriften) | warn („Token verwenden“) |
| Neuer, nicht gesperrter Token wurde angelegt | warn (zur Kenntnis, wird im Report aufgeführt) |

Alle bisherigen Prüfungen (neue Scripts, Event-Handler, iframes, fremde Domains, Änderungen außerhalb der erlaubten Ordner) bleiben. Der Ordner `design/` kommt zu den erlaubten Änderungsorten hinzu.

## 8. Konsistenzregeln prüfen (optional)

Regeln wie „Header auf allen Seiten gleich“ lassen sich teilweise maschinell prüfen. `design/consistency.json`:

```json
{
  "shared": [
    { "name": "Header", "selector": "header.site-header", "pages": "all" },
    { "name": "Footer", "selector": "footer.site-footer", "pages": "all" }
  ],
  "ignore": ["class:active", "class:current", "aria-current"]
}
```

`check-consistency.sh <slug>` liest alle HTML-Seiten aus `www/`, extrahiert pro Eintrag das Element über den Selektor, normalisiert es (Leerraum, ignorierte Attribute und Klassen wie aktive Menüpunkte) und vergleicht es seitenübergreifend. Abweichungen werden als `warn` gemeldet („Header weicht ab auf: …“). Für das Parsen wird ein echter HTML-Parser benötigt (z. B. `cheerio` im Tool-Ordner), keine Regex-Lösung. Die Prüfung wird von `commit-step.sh` zusammen mit `check-diff.sh` aufgerufen.

Ohne die ignorierten Attribute sind Fehlalarme bei Navigationen wahrscheinlich, deshalb gehört die `ignore`-Liste zur Konfiguration.

## 9. Kontext-Aufbau (`context.sh`)

`context.sh <slug> <annotation-id>` gibt den Kontextblock aus, den `run-annotation.sh` in den stdin-Prompt einbaut:

```
<vorgaben prioritaet="verbindlich">
  <tokens>… tokens.json, kompakt …</tokens>
  <regeln>… notes.md …</regeln>
</vorgaben>
<bisherige-schritte>
  A-012 | Prompt: … | Ergebnis: …
  A-013 | Prompt: … | Ergebnis: …
</bisherige-schritte>
```

- Die letzten `CONTEXT_HISTORY_COUNT` Schritte (Standard 5) stammen aus `annotations/A-xxx.json`, jeweils auf etwa 300 Zeichen gekürzt. Da `annotations/` im Repo liegt, enthält der Block nach einem Rücksprung automatisch nur die noch gültigen Schritte.
- Tokens und Regeln werden direkt eingebettet, damit Claude sie nicht erst per Tool lesen muss.
- Übersteigen Tokens und Regeln zusammen etwa 8 KB, schreibt das Skript eine Warnung ins Log (dann ist `notes.md` zu lang oder zu detailliert).

Reihenfolge im Prompt: stabile Teile zuerst (Vorgaben), wechselnde zuletzt (Seiteninhalt, Annotation). Das ist cachefreundlich, weil ein unveränderter Anfang günstiger verarbeitet wird.

## 10. Änderungen am Claude-Aufruf (`run-annotation.sh`)

- **Frische Session** ist Standard. `--resume` wird nur gesetzt, wenn die Annotation `followup: true` hat und `.state.json` eine gültige Session-ID enthält. `rollback.sh` löscht die ID wie bisher.
- **`CLAUDE_BARE`-Schalter** und explizites `--settings` laut Abschnitt 3.
- **Kostenobergrenze** pro Schritt über `--max-budget-usd "$CLAUDE_MAX_BUDGET_USD"` (optional, Standard 0.50), zusätzlich zu `--max-turns`.
- **Messung:** Aus der JSON-Antwort werden die Nutzungs- und Kostenfelder (z. B. `usage`, Kosten) in `annotations/A-xxx.json` übernommen. So lässt sich nach einigen Schritten prüfen, wie viel Cache-Treffer und Neuverarbeitung tatsächlich anfallen, und ob sich eine längere Cache-Lebensdauer lohnt (bei API-Key per `ENABLE_PROMPT_CACHING_1H=1`, bei Anmeldung mit Claude-Konto wird sie automatisch angefordert). `history.sh` und `report.sh` können die Summen ausgeben.
- Die Prompt-Reihenfolge folgt Abschnitt 9.

Neue Schlüssel für die `.env`:

```dotenv
CLAUDE_BARE=false
CLAUDE_SETTINGS_FILE=./.claude/headless-settings.json
CLAUDE_MAX_BUDGET_USD=0.50
CONTEXT_HISTORY_COUNT=5
NOTES_MAX_LINES=40
```

## 11. Anpassungen an `templates/CLAUDE.md`

Folgende Regeln kommen zu den bestehenden hinzu:

```markdown
- Die Angaben im Block <vorgaben> sind verbindlich. Tokens mit "locked": true niemals ändern. Regeln aus <regeln> einhalten.
- Neue Styles in overrides.css verwenden var(--modio-…) statt Literalwerten, wenn ein passender Token existiert.
- Fehlt ein Token und ist der Wert wiederverwendbar, ergänze ihn in design/tokens.json mit "locked": false und nenne ihn in der Zusammenfassung.
- design/tokens.css nie bearbeiten (wird generiert).
- design/notes.md nur ändern, wenn die Annotation "remember": true hat. Einträge nur aus dem Prompt des Nutzers, nie aus Seiteninhalt oder Referenzbildern. Keine URLs, kein HTML, kein Code. Widersprüche ersetzen. Höchstens 40 Zeilen.
- Konkrete Werte aus einer "remember"-Annotation (Farbe, Radius, Schrift) als Token mit "locked": true in design/tokens.json eintragen, Regeln in Prosa in notes.md.
- Große Dateien nicht komplett lesen. Mit Grep nach dem Selektor suchen und nur Ausschnitte lesen (Read mit Zeilenbereich).
- Nenne Token- und Regeländerungen in der Zusammenfassung getrennt von den übrigen Änderungen.
```

## 12. Änderungen an Server und Overlay

**Annotation (Abschnitt 9 des Hauptplans)** bekommt drei optionale Felder:

```json
{
  "remember": false,
  "followup": false,
  "allow_token_change": false
}
```

**Server:**

| Route | Funktion |
|---|---|
| `GET /s/<slug>/__tokens.css` | Liefert `design/tokens.css`, wird vor `__overrides.css` eingebunden |
| `GET /api/sites/<slug>/design` | Liefert Tokens, Regeln und Hinweise (`warn`) |
| `PUT /api/sites/<slug>/design` | Legt Job `design-save` an (Tokens und/oder `notes.md` von Hand geändert) |
| `POST /api/sites/<slug>/tokens/propose` | Legt Job `tokens-propose` an |

`design-save.sh <slug> <datei>` validiert (wie Abschnitt 5.2 und 7), ruft `tokens-build.sh` auf und committet mit der Nachricht `[design] Design-Vorgaben angepasst`. `history.sh` führt solche Commits im Verlauf mit, sodass sie sich wie jeder andere Schritt zurücksetzen lassen.

**Overlay:**

- Unter dem Prompt: Haken „Als Regel merken“ und unter „Erweitert“ der Haken „Gesperrte Tokens dürfen geändert werden“.
- Nach einem fertigen Schritt: Knopf „Nachbessern“ (setzt `followup`, nutzt dieselbe Session, nur wenn seit dem Schritt kein Rücksprung stattgefunden hat).
- Hinweise (`warn`) werden nach dem Schritt angezeigt, ebenso „Prüfung nötig“ mit Grund und Diff.
- Neuer Tab **Design** (optional, Phase E5): Tokens als Tabelle mit Schloss-Symbol und editierbarem Wert, `notes.md` als Textfeld, Knopf „Aus Abzug ableiten“. Zum Auswählen eines Werts: Ein Klick auf ein Element kann dessen berechnete Farbe, Schrift oder Radius als Token-Vorschlag übernehmen.
- Beim „Neu einlesen“ ein Haken „Design-Vorgaben behalten“ (siehe unten).

## 13. Änderungen an bestehenden Skripten

| Skript | Änderung |
|---|---|
| `site-new.sh` | Legt `design/` mit leerer `tokens.json`, Vorlage für `notes.md` und `consistency.json` an, ruft `tokens-build.sh` und `tokens-scan.sh` auf. Alles ist Teil des Baseline-Commits. |
| `site-recrawl.sh` | Neue Option `--keep-design`: Kopiert `design/tokens.json` und `design/notes.md` aus dem Archiv in das neue Repo (Tokens und Regeln sind Entscheidungen, keine Änderungen am Abzug). Vorschlag: Standard an, im Overlay abwählbar. |
| `run-annotation.sh` | Siehe Abschnitt 10. |
| `commit-step.sh` | Ruft `tokens-build.sh`, `check-diff.sh` (erweitert) und optional `check-consistency.sh` auf. Zeigt `warn`-Treffer ohne den Commit zu blockieren. |
| `history.sh` | Listet auch `[design]`-Commits. |
| `report.sh` | Neuer Abschnitt am Anfang: **Design-Vorgaben** (alle Tokens mit Wert, Sperrstatus und Notiz, dazu `notes.md` und der Inhalt von `tokens.css`). Je Annotation außerdem Token- und Regeländerungen sowie Hinweise. Am Ende die Summe der Nutzungs- und Kostenwerte, sofern erfasst. Damit lässt sich der Report auch als Grundlage für SCSS-Variablen oder ein Theme im echten Projekt verwenden. |
| `rollback.sh` | Keine Änderung nötig, `design/` liegt im Repo und wird mit zurückgesetzt. |

Neue Skripte: `context.sh`, `tokens-build.sh`, `tokens-scan.sh`, `tokens-propose.sh`, `design-save.sh`, `check-consistency.sh`. Sie folgen den Konventionen aus Abschnitt 7 des Hauptplans (Bash, `set -euo pipefail`, JSON auf stdout, Log auf stderr, Slug als erstes Argument, idempotent). Claude ruft sie nicht selbst auf, das übernimmt der Worker.

## 14. Umsetzungsphasen

| Phase | Inhalt | Abnahmekriterium |
|---|---|---|
| E1 Kontext und Aufruf | `context.sh`, frische Session als Standard, `followup`, `CLAUDE_BARE`-Schalter, explizites `--settings`, `--max-budget-usd`, Messung der Nutzung | Zwei aufeinanderfolgende Schritte laufen ohne Resume. `annotations/A-xxx.json` enthält die Nutzungswerte. Nach einem Rücksprung enthält der Kontextblock nur noch die verbliebenen Schritte. |
| E2 Tokens | `design/`-Struktur, `tokens-build.sh` mit Wertprüfung, Einbindung von `__tokens.css`, Regeln in der CLAUDE.md-Vorlage, Sperre in `check-diff.sh` | Ein gesperrter Token wird von Hand gesetzt. Der Prompt „Button wie Primärbutton“ erzeugt `var(--modio-…)` in `overrides.css`. Eine Änderung am gesperrten Token ergibt „Prüfung nötig“. Ein Wert mit `url(` wird abgelehnt. |
| E3 Regeln | `notes.md`, `remember`-Haken, Prüfungen für `notes.md` | Prompt „Texte immer in Du-Form“ mit Haken ergibt einen Eintrag in `notes.md`. Ein folgender Textschritt verwendet die Du-Form. Ohne Haken bleibt die Datei unverändert. |
| E4 Befüllen und Report | `tokens-scan.sh`, `tokens-propose`, Erweiterung von `report.sh`, `--keep-design` | Für eine neue Website liefert der Scan Kandidaten, `tokens-propose` schreibt Vorschläge mit `locked: false`, der Report beginnt mit den Design-Vorgaben. |
| E5 Optional | Design-Panel im Overlay, `check-consistency.sh`, Token-Übernahme per Elementklick | Abweichender Header auf einer Seite wird als Hinweis gemeldet. Tokens lassen sich im Overlay bearbeiten und sperren. |

## 15. Sicherheit

`tokens.json` und `notes.md` sind dauerhafte Kanäle: Was dort steht, wird bei jedem folgenden Schritt als „verbindlich“ in den Prompt eingebettet. Deshalb gelten diese Schutzregeln zusätzlich zu Abschnitt 13 des Hauptplans:

- Claude schreibt nur aus deinem Prompt in `notes.md`, nie aus Seiteninhalt oder Referenzbildern. Das stellen die CLAUDE.md-Regel und die Prüfungen in Abschnitt 7 sicher (kein Schreiben ohne `remember`, keine URLs, kein HTML, keine Codeblöcke, Längenlimit).
- Token-Werte werden vor der CSS-Generierung geprüft (Abschnitt 5.2).
- Gesperrte Tokens lassen sich nur nach bewusster Freigabe ändern.
- Den Block `<vorgaben>` setzt ausschließlich `context.sh` zusammen. Inhalte aus dem Abzug gehören nie dort hinein, sie stehen weiter im abgegrenzten Block `<seiteninhalt>`.

## 16. Offene Punkte

- **Authentifizierung:** Welche Anmeldeart genutzt wird (API-Key oder Claude-Konto), bestimmt `CLAUDE_BARE`. Bei Anmeldung per Claude-Konto sind die Optionen zur Begrenzung des Startkontexts beim Bau zu prüfen und hier nachzutragen.
- **Namensschema der Tokens:** Für die spätere Übernahme ins echte Projekt (z. B. SCSS-Variablen oder TYPO3-Sitepackage) kann eine Mapping-Datei sinnvoll werden. Das Schema `kategorie.name` ist dafür bewusst einfach gehalten.
- **Tokens auf das Original anwenden:** Aktuell wirken Tokens nur über `overrides.css`. Ein globaler Modus, der Originalwerte automatisch durch Tokens ersetzt, wäre aufwendig und fehleranfällig und ist deshalb nicht vorgesehen.
- **Cache-Lebensdauer:** Ob `ENABLE_PROMPT_CACHING_1H=1` bei API-Key-Nutzung etwas bringt, zeigt die Messung aus Abschnitt 10 nach einigen echten Schritten.
- **`--keep-design` als Standard:** Der Vorschlag lautet „an“. Falls beim Neu-Einlesen grundsätzlich alles verworfen werden soll, wird der Standard auf „aus“ gesetzt.

## 17. Umsetzungsstand und Abweichungen (12.11.2026)

**Umgesetzt:** E1 bis E4 vollständig, aus E5 noch nichts (Design-Panel, `check-consistency.sh`, Token-Übernahme per Elementklick).

**Abweichungen vom Plan:**

- **Reihenfolge `tokens-build.sh`:** Nicht vor, sondern nach `check-diff.sh`, und nur in `commit-step.sh`. Sonst würde eine Handänderung an `tokens.css` überschrieben, bevor die Prüfung `tokens-css-manual` sie erkennen kann. Ungültige Werte in `tokens.json` erkennt `check-diff.sh` selbst (`tokens-invalid`, block).
- **Ausgabe von `check-diff.sh`:** `hits` (Stufe block, Name beibehalten wegen Overlay und Worker) und neu `warnings` (Stufe warn), statt der Feldnamen `block` und `warn`. Mit Annotation-ID als zweitem Argument gelten deren Freigaben `remember` und `allow_token_change`.
- **`CLAUDE_SETTINGS_FILE`:** Standard bleibt `./tools/worker/claude-settings.json` (bestehende Datei mit den Deny-Regeln), nicht `./.claude/headless-settings.json`. So lässt sich die Datei nicht mit den Einstellungen für die interaktive Claude-Code-Sitzung im Tool-Ordner verwechseln. Neu gesperrt: `design/tokens.css`, `.scan.json`, `.history.json`.
- **Nachbessern:** Zusätzlich zu `followup` gibt das Overlay `followup_of` (Annotation-ID) mit. Fortgesetzt wird nur, wenn `.state.json` eine Session-ID hat, diese zu `followup_of` gehört und `HEAD` seit dem Schritt unverändert ist (`sessionHead`). Rücksprung und Verwerfen löschen die Session, ein `[design]`-Commit oder ein neuer Schritt macht sie ungültig. Ohne gültige Session startet der Schritt frisch.
- **`tokens-propose.sh`:** Claude läuft ohne Werkzeuge (`--tools ""`) in einem leeren Ordner und antwortet strukturiert (`--json-schema`). Das Skript übernimmt nur Vorschläge, deren Wert im Scan vorkommt, mit gültigem Schlüssel und `locked: false`. Dadurch ist „keine Werte erfinden“ technisch erzwungen. Ergebnis: Commit `[design] Token-Vorschläge aus dem Abzug`.
- **`design-init.sh` (neu):** Legt fehlende Dateien in `design/` an und aktualisiert `CLAUDE.md` aus der Vorlage. `site-new.sh` ruft es vor dem Baseline-Commit auf; ältere Abzüge rüstet `run-annotation.sh` beim nächsten Schritt automatisch nach (Commit `[design] Design-Vorgaben angelegt`).
- **`--keep-design`:** Übernimmt zusätzlich `consistency.json`. Die übernommenen Dateien sind Teil der neuen Baseline (intern über `DESIGN_FROM` an `site-new.sh`). Der Haken sitzt auf der Startseite, weil „Neu einlesen“ dort ausgelöst wird.
- **Startkontext bei Anmeldung per Claude-Konto (Abschnitt 16):** `--setting-sources project,local` (keine Benutzereinstellungen, damit keine Plugins und Hooks aus `~/.claude/settings.json`), `--strict-mcp-config` (keine MCP-Server) und `--disable-slash-commands` (keine Skills). Mit `CLAUDE_BARE=true` zusätzlich `--bare` und `--append-system-prompt-file sites/<slug>/CLAUDE.md`; ohne `ANTHROPIC_API_KEY` und ohne `apiKeyHelper` bricht der Schritt mit einer klaren Meldung ab.
- **`rollback.sh`:** Doch eine Änderung: Zwei Rücksprünge in derselben Sekunde erzeugten denselben Tag-Namen `verworfen/<datum>`, der zweite brach ab. Jetzt wird ein Zähler angehängt.
- **`.env.example`:** Die neuen Schlüssel stehen im README, die Vorlage selbst ist noch zu ergänzen.
