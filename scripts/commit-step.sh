#!/usr/bin/env bash
# Prüft und committet die Änderungen eines Schritts als Snapshot.
# Ablauf: check-diff.sh (block/warn) + check-consistency.sh (warn) -> tokens-build.sh -> Commit. Hinweise (warn) blockieren nicht,
# sie landen in der Ausgabe und in annotations/<id>.json (.check.warnings).
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
  [[ "$(state_get sessionAnnotation)" == "$ID" ]] && state_set sessionHead "\"$(git_site rev-parse HEAD)\""
  emit status nochange slug "$SLUG" annotationId "$ID" summary "$SUMMARY"
  exit 0
fi

# Seitenübergreifende Konsistenz (nur Hinweise, Fehler der Prüfung blockieren nicht)
CONS_WARN="[]"
if [[ -f "$SITE/design/consistency.json" ]]; then
  CONS="$("$SCRIPTS_DIR/check-consistency.sh" "$SLUG" --changed-only 2>/dev/null)" && CONS_WARN="$(jq -c '.warnings // []' <<<"$CONS")" \
    || log "$ID: Konsistenzprüfung fehlgeschlagen, wird übersprungen"
fi

WARNINGS="[]"
if [[ "$ACCEPT" != "--accept" ]]; then
  set +e
  CHECK="$("$SCRIPTS_DIR/check-diff.sh" "$SLUG" "$ID")"
  rc=$?
  set -e
  if (( rc == 3 )); then
    DIFF="$(git_site diff --no-color --no-ext-diff --stat --patch -- . | head -c 300000)"
    log "$ID: Prüfung nötig"
    emit_json "$(jq -c --arg slug "$SLUG" --arg id "$ID" --arg diff "$DIFF" --arg summary "$SUMMARY" --argjson cons "$CONS_WARN" \
      '{status:"review", slug:$slug, annotationId:$id, summary:$summary, hits:.hits, warnings:((.warnings // []) + $cons), files:.files, diff:$diff}' <<<"$CHECK")"
    exit 3
  elif (( rc != 0 )); then
    die "check-diff.sh fehlgeschlagen"
  fi
  WARNINGS="$(jq -c '.warnings // []' <<<"$CHECK")"
else
  log "$ID: nach manueller Prüfung übernommen"
  CHECK="$("$SCRIPTS_DIR/check-diff.sh" "$SLUG" "$ID" || true)"
  WARNINGS="$(jq -c '.warnings // []' <<<"$CHECK" 2>/dev/null || echo '[]')"
fi

WARNINGS="$(jq -c --argjson cons "$CONS_WARN" '. + $cons' <<<"$WARNINGS")"

# tokens.css aus tokens.json erzeugen (nach der Prüfung, damit Handänderungen erkannt werden)
if [[ -f "$SITE/design/tokens.json" ]]; then
  set +e
  BUILD="$("$SCRIPTS_DIR/tokens-build.sh" "$SLUG")"; rc=$?
  set -e
  (( rc == 0 )) || die "tokens.json ist ungültig, Schritt kann nicht übernommen werden: $(jq -r '.error // empty' <<<"$BUILD" 2>/dev/null). Bitte verwerfen."
fi

# Hinweise in der Annotation festhalten (für Report und Verlauf)
if [[ -f "$ANN" ]]; then
  tmp="$(mktemp)"
  jq --argjson w "$WARNINGS" '.check = {warnings:$w}' "$ANN" >"$tmp" && mv "$tmp" "$ANN" && chmod 644 "$ANN"
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
# Nach Übernahme passt die Session dieses Schritts zum neuen Stand (für „Nachbessern“)
[[ "$(state_get sessionAnnotation)" == "$ID" ]] && state_set sessionHead "\"$COMMIT\""
emit status committed slug "$SLUG" annotationId "$ID" commit "$COMMIT" summary "$SUMMARY" accepted "json:$([[ "$ACCEPT" == "--accept" ]] && echo true || echo false)" warnings "json:$WARNINGS"
