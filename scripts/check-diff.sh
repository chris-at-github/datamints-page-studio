#!/usr/bin/env bash
# Prüft die ungestagten Änderungen regelbasiert auf riskante Inhalte und Verstöße gegen die Design-Vorgaben.
# Aufruf: check-diff.sh <slug> [annotation-id]
#   Mit annotation-id gelten deren Freigaben "remember" und "allow_token_change".
# Ausgabe: {status, slug, files, hits (block), warnings (warn)}
# Exit 0: keine block-Treffer (Hinweise möglich), Exit 3: block-Treffer
source "$(dirname "$0")/lib/common.sh"
require_cmd git node jq
require_site "${1:-}"
ID="${2:-}"
if [[ -n "$ID" ]]; then valid_annotation_id "$ID" || usage "check-diff.sh <slug> [annotation-id]"; fi

REMEMBER=false; ALLOW_TOKEN_CHANGE=false; LINKS_AS_WARNINGS=false
if [[ -n "$ID" && -f "$SITE/annotations/$ID.json" ]]; then
  REMEMBER="$(jq -r 'if .remember == true then "true" else "false" end' "$SITE/annotations/$ID.json")"
  ALLOW_TOKEN_CHANGE="$(jq -r 'if .allow_token_change == true then "true" else "false" end' "$SITE/annotations/$ID.json")"
  # Seitenimport in ein neues Projekt (page-import.sh): Links auf fremde Domains nur als Hinweis
  [[ "$(jq -r '.source // ""' "$SITE/annotations/$ID.json")" == import && "$(site_kind "$SITE")" == neu ]] && LINKS_AS_WARNINGS=true
fi

# Neue Dateien sichtbar machen, ohne sie zu stagen
git_site add --intent-to-add --all
NAMES="$(mktemp)"; trap 'rm -f "$NAMES"' EXIT
git_site diff --name-only -z >"$NAMES"
RESULT="$(git_site diff --no-color --no-ext-diff -U0 | CHECK_REMEMBER="$REMEMBER" CHECK_ALLOW_TOKEN_CHANGE="$ALLOW_TOKEN_CHANGE" CHECK_LINKS_AS_WARNINGS="$LINKS_AS_WARNINGS" \
  node "$LIB_DIR/check-diff.mjs" "$SITE" "$NAMES")" || die "Diff-Prüfung fehlgeschlagen"
COUNT="$(jq '.hits | length' <<<"$RESULT")"
WARN="$(jq '.warnings | length' <<<"$RESULT")"
emit_json "$(jq -c --arg slug "$SLUG" '{status:(if (.hits|length)>0 then "review" else "ok" end), slug:$slug} + .' <<<"$RESULT")"
if (( COUNT > 0 )); then log "$COUNT auffällige Änderung(en), $WARN Hinweis(e) in $SLUG"; exit 3; fi
log "Keine auffälligen Änderungen in $SLUG$( (( WARN > 0 )) && printf ' (%s Hinweis(e))' "$WARN")"
