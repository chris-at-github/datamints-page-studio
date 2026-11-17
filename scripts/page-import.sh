#!/usr/bin/env bash
# Importiert eine HTML-Seite (z. B. ein Artefakt aus Claude Chat) unverändert als Seite eines neuen Projekts.
# Die Datei wird byte-genau übernommen: keine Link-Anpassung, kein Übernehmen gleicher Bereiche, kein Claude-Lauf.
# Jeder Import ist ein Schritt A-xxx (source "import") und läuft durch commit-step.sh (Sicherheitsprüfung, Commit),
# damit Verlauf, Report und Rücksprung wie bei jedem anderen Schritt funktionieren.
# Ziel: www/<ordner>/<seite>.html; <ordner> ist der Ordner der Einstiegsseite (Altprojekte: leinwand), sonst "seiten".
# Aufruf: page-import.sh <slug> <seite> <datei.html> [--replace]
# Exit 0: committed, Exit 3: Prüfung nötig (z. B. Scripts oder fremde Domains in der Seite)
source "$(dirname "$0")/lib/common.sh"
require_cmd git jq
require_site "${1:-}"
NAME="${2:-}"; FILE="${3:-}"; REPLACE="${4:-}"
[[ -n "$NAME" && -n "$FILE" ]] || usage "page-import.sh <slug> <seite> <datei.html> [--replace]"
[[ -z "$REPLACE" || "$REPLACE" == "--replace" ]] || usage "page-import.sh <slug> <seite> <datei.html> [--replace]"
[[ "$(site_kind "$SITE")" == neu ]] || die "Seiten importieren gibt es nur bei neuen Projekten (ohne Website). Bei Abzügen: Seiten hinzufügen." 2
valid_slug "$NAME" || die "Ungültiger Seitenname: $NAME (a-z, 0-9, Bindestrich)" 2
FILE="$(abspath "$FILE")"
[[ -f "$FILE" ]] || die "Datei nicht gefunden: $FILE" 2
MAX="${IMPORT_MAX_BYTES:-1572864}"
(( $(stat -c %s "$FILE") <= MAX )) || die "HTML-Datei zu groß (höchstens $((MAX / 1024)) KB)" 2
grep -qiE '<[a-z!]' "$FILE" || die "Die Datei enthält kein HTML" 2
[[ -z "$(git_site status --porcelain --untracked-files=all -- . ':(exclude)annotations/')" ]] \
  || die "Der Abzug enthält nicht übernommene Änderungen. Erst übernehmen oder verwerfen."

ENTRY="$(jq -r '.entry // ""' "$SITE/site.json")"
DIR="$(cut -d/ -f2 <<<"$ENTRY")"
[[ -n "$ENTRY" && -n "$DIR" && "$DIR" != ".." && -d "$SITE/www/$DIR" ]] || DIR="seiten"
PAGE="/$DIR/$NAME.html"
TARGET="$SITE/www/$DIR/$NAME.html"
REPLACED=false
if [[ -e "$TARGET" ]]; then
  [[ "$REPLACE" == "--replace" ]] || die "Die Seite $PAGE gibt es schon. Zum Ersetzen erneut mit --replace importieren." 4
  REPLACED=true
fi

COUNTER="$(next_annotation_number)"
state_set counter "$COUNTER"
ID="$(printf 'A-%03d' "$COUNTER")"
SRC="$(basename "$FILE")"
mkdir -p "$SITE/annotations" "$SITE/www/$DIR"
jq -n --arg id "$ID" --arg page "$PAGE" --arg created "$(now_iso)" --argjson replaced "$REPLACED" '{
  id:$id, source:"import", created:$created,
  prompt:("Seite \($page) \(if $replaced then "ersetzt" else "importiert" end)"),
  page:$page, selector:null, remember:false, allow_token_change:false,
  import:{replaced:$replaced},
  result:{summary:(if $replaced then "Seite \($page) durch eine neue Fassung ersetzt (unverändert importiert)." else "Seite \($page) unverändert importiert." end)}
}' >"$SITE/annotations/$ID.json"
chmod 644 "$SITE/annotations/$ID.json"
cp "$FILE" "$TARGET"
chmod 644 "$TARGET"
log "$SLUG: $SRC als $PAGE ($ID$([[ "$REPLACED" == true ]] && printf ', ersetzt'))"

set +e
OUT="$("$SCRIPTS_DIR/commit-step.sh" "$SLUG" "$ID")"; rc=$?
set -e
if (( rc != 0 && rc != 3 )); then
  git_site checkout -q -- . 2>/dev/null || true
  git_site clean -fdq 2>/dev/null || true
  die "commit-step.sh fehlgeschlagen: $(jq -r '.error // empty' <<<"$OUT" 2>/dev/null)"
fi
emit_json "$(jq -c --arg page "$PAGE" --argjson replaced "$REPLACED" '. + {page:$page, replaced:$replaced}' <<<"$OUT")"
exit "$rc"
