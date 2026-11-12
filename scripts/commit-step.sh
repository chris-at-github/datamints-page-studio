#!/usr/bin/env bash
# Prüft und committet die Änderungen eines Schritts als Snapshot.
# Aufruf: commit-step.sh <slug> <annotation-id> [--accept]
# Exit 0: committed/nochange, Exit 3: Prüfung nötig
source "$(dirname "$0")/lib/common.sh"
require_cmd git jq
require_site "${1:-}"
ID="${2:-}"; ACCEPT="${3:-}"
valid_annotation_id "$ID" || usage "commit-step.sh <slug> <annotation-id> [--accept]"
[[ -z "$ACCEPT" || "$ACCEPT" == "--accept" ]] || usage "commit-step.sh <slug> <annotation-id> [--accept]"

ANN="$SITE/annotations/$ID.json"
SUMMARY=""; [[ -f "$ANN" ]] && SUMMARY="$(jq -r '.result.summary // ""' "$ANN")"

# Änderungen außerhalb der Annotations-Metadaten?
CHANGES="$(git_site status --porcelain --untracked-files=all -- . ':(exclude)annotations/')"
if [[ -z "$CHANGES" ]]; then
  log "$ID: keine Änderung an der Seite"
  git_site reset -q -- annotations/ 2>/dev/null || true
  git_site clean -fdq -- annotations/
  git_site checkout -q -- annotations/ 2>/dev/null || true
  emit status nochange slug "$SLUG" annotationId "$ID" summary "$SUMMARY"
  exit 0
fi

if [[ "$ACCEPT" != "--accept" ]]; then
  set +e
  CHECK="$("$SCRIPTS_DIR/check-diff.sh" "$SLUG")"
  rc=$?
  set -e
  if (( rc == 3 )); then
    DIFF="$(git_site diff --no-color --no-ext-diff --stat --patch -- . | head -c 300000)"
    log "$ID: Prüfung nötig"
    emit_json "$(jq -c --arg slug "$SLUG" --arg id "$ID" --arg diff "$DIFF" --arg summary "$SUMMARY" \
      '{status:"review", slug:$slug, annotationId:$id, summary:$summary, hits:.hits, files:.files, diff:$diff}' <<<"$CHECK")"
    exit 3
  elif (( rc != 0 )); then
    die "check-diff.sh fehlgeschlagen"
  fi
else
  log "$ID: nach manueller Prüfung übernommen"
fi

MSG="$(mktemp)"; trap 'rm -f "$MSG"' EXIT
PROMPT="Manuelle Änderung"
[[ -f "$ANN" ]] && PROMPT="$(jq -r '.prompt // "Manuelle Änderung"' "$ANN")"
{
  printf '[%s] %s\n' "$ID" "$PROMPT"
  [[ "$ACCEPT" == "--accept" ]] && printf '\nNach manueller Prüfung übernommen.\n'
  true
} >"$MSG"

git_site add -A
git_site commit -q -F "$MSG"
COMMIT="$(git_site rev-parse HEAD)"
log "$ID: Snapshot ${COMMIT:0:10}"
emit status committed slug "$SLUG" annotationId "$ID" commit "$COMMIT" summary "$SUMMARY" accepted "json:$([[ "$ACCEPT" == "--accept" ]] && echo true || echo false)"
