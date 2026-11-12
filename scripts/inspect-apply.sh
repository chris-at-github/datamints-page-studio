#!/usr/bin/env bash
# Übernimmt ein im Browser-Inspektor geändertes Element als Schritt A-xxx (über local-commit.sh/commit-step.sh,
# also mit Sicherheitsprüfung und automatischer Übertragung gleicher Bereiche).
# Aufruf: inspect-apply.sh <slug> <payload.json>
#   payload: { page, items: [{selector, html, css?}], rules: [{selector, decls, media?}] }   (siehe scripts/lib/inspect.mjs)
# Exit 0: committed/nochange, Exit 3: Prüfung nötig
source "$(dirname "$0")/lib/common.sh"
require_cmd git jq node
require_site "${1:-}"
FILE="${2:-}"
[[ -f "$FILE" ]] || usage "inspect-apply.sh <slug> <payload.json>"
[[ -z "$(git_site status --porcelain)" ]] || die "Der Abzug enthält nicht übernommene Änderungen. Erst übernehmen („Lokale Änderungen übernehmen“ im Verlauf) oder verwerfen."

# Kommentar im overrides.css-Block mit der ID, die local-commit.sh gleich vergibt (Worker arbeitet nacheinander)
NEXT="$(printf 'A-%03d' "$(next_annotation_number)")"
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
jq --arg id "$NEXT" '. + {cssId:$id}' "$FILE" >"$TMP"
set +e
OUT="$(node "$LIB_DIR/inspect.mjs" "$SITE" "$TMP")"; rc=$?
set -e
if (( rc != 0 )); then
  git_site checkout -q -- . 2>/dev/null || true
  die "$(jq -r '.error // "Übernahme fehlgeschlagen"' <<<"$OUT" 2>/dev/null || echo "Übernahme fehlgeschlagen")"
fi
PAGE="$(jq -r .page <<<"$OUT")"; SEL="$(jq -r '.elements | join(", ")' <<<"$OUT")"; NR="$(jq -r .rules <<<"$OUT")"
DESC="Änderung aus dem Inspektor"
[[ -n "$SEL" ]] && DESC+=": $SEL"
(( NR > 0 )) && DESC+="$([[ -n "$SEL" ]] && echo ";" || echo ":") $NR CSS-Regel(n)"
exec "$SCRIPTS_DIR/local-commit.sh" "$SLUG" "$DESC" "$PAGE" "$(jq -r '.elements[0] // ""' <<<"$OUT")"
