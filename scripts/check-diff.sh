#!/usr/bin/env bash
# Prüft die ungestagten Änderungen regelbasiert auf riskante Inhalte.
# Aufruf: check-diff.sh <slug>     Exit 0: keine Treffer, Exit 3: Treffer
source "$(dirname "$0")/lib/common.sh"
require_cmd git node
require_site "${1:-}"

# Neue Dateien sichtbar machen, ohne sie zu stagen
git_site add --intent-to-add --all
NAMES="$(mktemp)"; trap 'rm -f "$NAMES"' EXIT
git_site diff --name-only -z >"$NAMES"
RESULT="$(git_site diff --no-color --no-ext-diff -U0 | node "$LIB_DIR/check-diff.mjs" "$SITE" "$NAMES")" || die "Diff-Prüfung fehlgeschlagen"
COUNT="$(jq '.hits | length' <<<"$RESULT")"
emit_json "$(jq -c --arg slug "$SLUG" '{status:(if (.hits|length)>0 then "review" else "ok" end), slug:$slug} + .' <<<"$RESULT")"
if (( COUNT > 0 )); then log "$COUNT auffällige Änderung(en) in $SLUG"; exit 3; fi
log "Keine auffälligen Änderungen in $SLUG"
