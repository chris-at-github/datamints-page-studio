#!/usr/bin/env bash
# Übernimmt von Hand gemachte Änderungen im Abzug (Editor, Chrome-Workspaces, Inspektor) als Schritt A-xxx.
# Läuft wie ein Claude-Schritt durch commit-step.sh: Sicherheitsprüfung (block/warn), gleiche Bereiche übertragen,
# Konsistenzprüfung, tokens-build, Commit. Die Freigaben "remember" und "allow_token_change" sind gesetzt,
# weil der Nutzer selbst die Änderung gemacht hat (Regeln und gesperrte Tokens dürfen geändert werden).
# Aufruf: local-commit.sh <slug> [beschreibung] [seite] [selektor]
# Exit 0: committed/nochange, Exit 3: Prüfung nötig (Entscheidung wie bei Annotationen)
source "$(dirname "$0")/lib/common.sh"
require_cmd git jq
require_site "${1:-}"
DESC="${2:-Lokale Änderung übernommen}"; PAGE="${3:-}"; SELECTOR="${4:-}"

if [[ -z "$(git_site status --porcelain --untracked-files=all -- . ':(exclude)annotations/')" ]]; then
  log "$SLUG: keine lokalen Änderungen"
  emit status nochange slug "$SLUG" summary "Keine lokalen Änderungen gefunden."
  exit 0
fi

COUNTER="$(next_annotation_number)"
state_set counter "$COUNTER"
ID="$(printf 'A-%03d' "$COUNTER")"
FILES="$(git_site status --porcelain --untracked-files=all -- . ':(exclude)annotations/' | sed -E 's/^...//' | head -50 | jq -R . | jq -sc .)"
mkdir -p "$SITE/annotations"
jq -n --arg id "$ID" --arg prompt "$DESC" --arg page "$PAGE" --arg sel "$SELECTOR" --arg created "$(now_iso)" --argjson files "$FILES" '{
  id:$id, source:"local", created:$created, prompt:$prompt,
  page:(if $page == "" then null else $page end), selector:(if $sel == "" then null else $sel end),
  remember:true, allow_token_change:true,
  result:{summary:("Von Hand geändert: " + ($files | join(", ")))}
}' >"$SITE/annotations/$ID.json"
chmod 644 "$SITE/annotations/$ID.json"
log "$SLUG: lokale Änderungen als $ID"

set +e
OUT="$("$SCRIPTS_DIR/commit-step.sh" "$SLUG" "$ID")"; rc=$?
set -e
if (( rc != 0 && rc != 3 )); then die "commit-step.sh fehlgeschlagen: $(jq -r '.error // empty' <<<"$OUT" 2>/dev/null)"; fi
emit_json "$OUT"
exit "$rc"
