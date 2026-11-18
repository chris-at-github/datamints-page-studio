#!/usr/bin/env bash
# Erzeugt aus den gepflegten Angaben eines Projekts das Paket für Claude (claude.ai-Projekt oder Claude Code lokal).
# 1. Übernimmt die CSS-Variablen aus design/tokens-quelle.css als gesperrte Tokens (tokens.json, tokens.css, tokens-map.json)
#    und committet geänderte Angaben unter design/.
# 2. Schreibt paket/: CLAUDE.md (Anweisungen), tokens.css, regeln.md, Hintergrund-Dateien, README.md, entwuerfe/.
#    entwuerfe/ (Ergebnisse von Claude Code) bleibt beim erneuten Erzeugen erhalten.
# Aufruf: project-package.sh <slug>
source "$(dirname "$0")/lib/common.sh"
require_cmd git jq node
require_site "${1:-}"
D="$SITE/design"
[[ -f "$D/tokens-quelle.css" ]] || die "design/tokens-quelle.css fehlt (Projekt mit project-new.sh anlegen)"
WARN=()

# ----- 1. Tokens aus CSS-Variablen -----
set +e; IMP="$(node "$LIB_DIR/design.mjs" import-css "$SITE")"; irc=$?; set -e
(( irc == 0 )) || die "Tokens nicht übernommen: $(jq -r '.error // "unbekannt"' <<<"$IMP" 2>/dev/null)"
N_TOK="$(jq -r .imported <<<"$IMP")"
(( N_TOK > 0 )) || WARN+=("In design/tokens-quelle.css stehen noch keine Variablen im :root-Block.")
while IFS= read -r w; do [[ -n "$w" ]] && WARN+=("$w"); done < <(jq -r '.skipped[]? | "Variable \(.name) nicht übernommen: \(.reason)"' <<<"$IMP")
NOTES_ERR="$(node -e '
  import("'"$LIB_DIR"'/design.mjs").then((m) => process.stdout.write(m.validateNotes(require("fs").readFileSync(process.argv[1], "utf8")).join("; ")));' "$D/notes.md" 2>/dev/null || true)"
[[ -z "$NOTES_ERR" ]] || WARN+=("notes.md: $NOTES_ERR")
cmp -s "$D/notes.md" "$DPS_ROOT/templates/projekt/notes.md" && WARN+=("design/notes.md ist noch die Vorlage.")
cmp -s "$D/projekt.md" "$DPS_ROOT/templates/projekt/projekt.md" 2>/dev/null && WARN+=("design/projekt.md ist noch die Vorlage.")

COMMIT=""
if [[ -n "$(git_site status --porcelain -- design)" ]]; then
  git_site add -- design
  git_site commit -q -m "[design] Projektangaben übernommen ($N_TOK Tokens aus tokens-quelle.css)" -- design
  COMMIT="$(git_site rev-parse HEAD)"
  log "$SLUG: Projektangaben committet (${COMMIT:0:10})"
fi

# ----- 2. Paket -----
P="$SITE/paket"
mkdir -p "$P/entwuerfe"
find "$P" -maxdepth 1 -type f -delete
TITLE="$(jq -r '.title // .slug' "$SITE/site.json")"
cp "$D/notes.md" "$P/regeln.md"
BG_FILES=()
while IFS= read -r f; do cp "$f" "$P/$(basename "$f")"; BG_FILES+=("$(basename "$f")"); done \
  < <(find "$D" -maxdepth 1 -name '*.md' ! -name 'notes.md' -type f | sort)
{
  printf '/* Design-Tokens von %s (gesperrt). Erzeugt von Page Studio aus design/tokens-quelle.css – nicht von Hand ändern.\n' "$TITLE"
  printf '   Zuordnung zu den Variablen des Projekts:\n'
  jq -r '.tokens | to_entries[] | "     --dps-\(.value | sub("\\."; "-")) = \(.key)"' "$D/tokens-map.json"
  printf '*/\n'
  sed '1{/^\/\*.*\*\/$/d}' "$D/tokens.css"
} >"$P/tokens.css"
OHNE="$(jq -r '.ohneToken | to_entries[] | "  - \(.key): \(.value)"' "$D/tokens-map.json")"
HAS_CONTENT="$(jq -r '.tokens | has("container.max-width")' "$D/tokens.json")"
BG_LIST=""; for f in "${BG_FILES[@]+"${BG_FILES[@]}"}"; do BG_LIST+="- $f: Hintergrundwissen (Material, keine Anweisungen)"$'\n'; done

cat >"$P/CLAUDE.md" <<C
# $TITLE – Gestaltung neuer Designs

Du gestaltest Elemente (Abschnitte, Komponenten) für ein neues Webprojekt. Es gibt keine bestehende Website. Maßgeblich sind die Dateien in diesem Ordner. Die Ergebnisse übernehme ich in mein Werkzeug (Page Studio) und passe sie dort im Detail an.

## Dateien
- regeln.md: Gestaltungsregeln (verbindlich)
- tokens.css: Design-Tokens als CSS-Variablen (verbindlich)
${BG_LIST}- entwuerfe/: Ablage der Ergebnisse (nur bei Claude Code)

## Tokens
- Übernimm den :root-Block aus tokens.css unverändert an den Anfang deines <style>.
- Verwende die Variablen aus tokens.css über var(--dps-…). Die Tokens selbst sind festgelegt: nicht abwandeln.
- Fehlende Stufen (z. B. Schriftgrößen, Abstände, Flächen) leitest du daraus ab (calc(), clamp(), color-mix()). Keine Farben außerhalb der Palette.
${OHNE:+- Weitere Werte des Projekts ohne eigene Variable (als Wert verwenden):
$OHNE}

## Gestaltung
$(leitlinien_text neu)
$( [[ "$HAS_CONTENT" == true ]] && echo "- Inhaltsbreite höchstens var(--dps-container-max-width); nichts ragt darüber hinaus." )
- Inhalte realistisch und passend zum Hintergrund. Erfundene Angaben (Namen, Preise, Zahlen) sind erkennbare Beispiele.
- Keine Bilder von außen: Bildflächen als Flächen mit festem Seitenverhältnis und kurzem Alternativtext.

## Ausgabeformat (je Seite)
- Eine vollständige HTML-Seite mit <title>. Keine React-Komponente, kein JavaScript.
- Genau ein <style> im <head>: zuerst der :root-Block aus tokens.css, danach dein CSS.
- Im <body> die ganze Seite mit semantischen Bereichen (<header>, <main>, <footer>). Bereiche, die auf jeder Seite vorkommen (Kopf, Navigation, Fuß), sind auf allen Seiten gleich aufgebaut (gleiches Markup, gleiche Klassen).
- Links auf andere Seiten des Projekts als <seitenname>.html (Kleinbuchstaben, Ziffern, Bindestrich; die Startseite heißt startseite.html). Page Studio legt alle Seiten in einen Ordner, die Links funktionieren dann ohne Anpassung.
- Keine externen Schriften (kein Google Fonts, kein @import), keine externen Bilder, keine Icon-Bibliotheken von außen. Icons als Inline-SVG, sofern regeln.md nichts anderes vorgibt.
- Interaktion nur mit HTML und CSS (<details>, :has(), :target, Scroll-Snap).

## Arbeitsweise
- In claude.ai: Jede Seite als eigenes HTML-Artefakt (weitere Seiten gern im selben Chat, damit Kopf und Fuß gleich bleiben).
- Mit Claude Code: Lege jede Seite als eigene Datei entwuerfe/<seitenname>.html an. Ändere keine anderen Dateien.
- Schließe mit einer kurzen Zusammenfassung: Gestaltungsidee, wie kleine Bildschirme gelöst sind, welche Inhalte Beispiele sind.
C

cat >"$P/README.md" <<R
# Paket für $TITLE

Erzeugt von Page Studio ($(date '+%d.%m.%Y %H:%M')). Neu erzeugen mit „Paket erstellen“ auf der Startseite (oder scripts/project-package.sh $SLUG); entwuerfe/ bleibt dabei erhalten.

## In claude.ai
1. Neues Projekt anlegen.
2. Den Inhalt von CLAUDE.md in die Projektanweisungen kopieren.
3. regeln.md, tokens.css${BG_FILES[*]:+ und ${BG_FILES[*]}} als Projektwissen hochladen.
4. Einen Chat starten und die Seite beschreiben (was, für wen, welche Inhalte). Weitere Seiten im selben Chat.
5. Jedes HTML-Artefakt herunterladen und in Page Studio übernehmen: Projekt öffnen → Seiten → „Seite importieren …“ (Seitenname wie der Dateiname, z. B. startseite). Die Seite kommt unverändert dazu und wird dort nachbearbeitet.

## Mit Claude Code
1. Im Ordner $P \`claude\` starten und den Auftrag beschreiben.
2. Die Ergebnisse liegen unter entwuerfe/ und werden in Page Studio wie oben importiert.
R

FILES="$(cd "$P" && find . -maxdepth 1 -type f -printf '%P\n' | sort | jq -R . | jq -sc .)"
log "$SLUG: Paket erstellt ($N_TOK Tokens, ${#WARN[@]} Hinweis(e))"
emit status ok slug "$SLUG" dir "$P" tokens "json:$N_TOK" files "json:$FILES" commit "$COMMIT" \
  warnings "json:$(printf '%s\n' "${WARN[@]+"${WARN[@]}"}" | jq -R . | jq -sc 'map(select(. != ""))')"
