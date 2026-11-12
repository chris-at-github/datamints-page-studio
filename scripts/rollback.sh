#!/usr/bin/env bash
# Springt zu einem früheren Stand zurück. Der verlassene Stand bleibt als Tag verworfen/<datum> erhalten.
# Aufruf: rollback.sh <slug> <annotation-id|baseline|commit>
source "$(dirname "$0")/lib/common.sh"
require_cmd git jq
require_site "${1:-}"
TARGET="${2:-}"
[[ -n "$TARGET" ]] || usage "rollback.sh <slug> <annotation-id|baseline|commit>"

if [[ "$TARGET" == "baseline" ]]; then
  COMMIT="$(git_site rev-parse baseline)"
elif valid_annotation_id "$TARGET"; then
  COMMIT="$(git_site log --format=%H --fixed-strings --grep="[$TARGET] " baseline..HEAD | head -n1)"
  [[ -n "$COMMIT" ]] || die "Schritt $TARGET nicht im aktuellen Verlauf gefunden"
elif [[ "$TARGET" =~ ^[0-9a-f]{7,40}$ ]]; then
  COMMIT="$(git_site rev-parse --verify --quiet "$TARGET^{commit}")" || die "Commit nicht gefunden: $TARGET"
  git_site merge-base --is-ancestor baseline "$COMMIT" || die "Commit liegt nicht im Verlauf seit baseline"
else
  die "Ungültiges Ziel: $TARGET" 2
fi

HEAD_BEFORE="$(git_site rev-parse HEAD)"
TAG="verworfen/$(date '+%Y%m%d-%H%M%S')"
# Mehrere Rücksprünge in derselben Sekunde: eindeutigen Tag-Namen wählen
if git_site rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  n=2; while git_site rev-parse -q --verify "refs/tags/$TAG-$n" >/dev/null; do n=$((n + 1)); done; TAG="$TAG-$n"
fi
if [[ "$HEAD_BEFORE" != "$COMMIT" ]]; then
  # Auch nicht committete Reste sichern? Nein: verworfen wird der letzte Snapshot.
  git_site tag "$TAG" "$HEAD_BEFORE"
else
  TAG=""
fi
git_site reset -q --hard "$COMMIT"
git_site clean -fdq
state_set sessionId null
log "Rücksprung in $SLUG auf ${COMMIT:0:10} ($TARGET)${TAG:+, vorheriger Stand: $TAG}"
emit status ok slug "$SLUG" target "$TARGET" commit "$COMMIT" previous "$HEAD_BEFORE" tag "$TAG"
