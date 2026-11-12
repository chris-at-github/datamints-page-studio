#!/usr/bin/env bash
# Gibt den Verlauf seit baseline aus und schreibt ihn nach .history.json.
# Schritte: Annotationen ([A-xxx]), Design-Änderungen ([design]), hinzugefügte Seiten ([seiten]) und sonstige Commits.
# totals: Summe der erfassten Kosten und Token-Nutzung aller Annotationen im aktuellen Stand.
# Aufruf: history.sh <slug>
source "$(dirname "$0")/lib/common.sh"
require_cmd git jq
require_site "${1:-}"

STEPS="[]"
while IFS=$'\t' read -r COMMIT DATE SUBJECT; do
  [[ -n "$COMMIT" ]] || continue
  ID="$(sed -nE 's/^\[(A-[0-9]+)\].*/\1/p' <<<"$SUBJECT")"
  ANN="{}"
  if [[ -n "$ID" ]]; then
    ANN="$(git_site show "$COMMIT:annotations/$ID.json" 2>/dev/null || echo '{}')"
    jq -e . >/dev/null 2>&1 <<<"$ANN" || ANN="{}"
  fi
  STEP="$(jq -c --arg id "$ID" --arg c "$COMMIT" --arg d "$DATE" --arg s "$SUBJECT" '{
      id: (if $id == "" then null else $id end), commit:$c, date:$d,
      kind: (if $id != "" then "annotation" elif ($s | startswith("[design]")) then "design" elif ($s | startswith("[seiten]")) then "pages" else "manual" end),
      prompt: (.prompt // ($s | sub("^\\[A-[0-9]+\\] "; ""))),
      summary: (.result.summary // null), page: (.page // null), selector: (.selector // null),
      thorough: (.thorough // false), references: ((.references // []) | length),
      remember: (.remember // false), followup: (.followup // false),
      warnings: ((.check.warnings // []) | length),
      costUsd: (.result.costUsd // null), usage: (.result.usage // null)
    }' <<<"$ANN")"
  STEPS="$(jq -c --argjson s "$STEP" '. + [$s]' <<<"$STEPS")"
done < <(git_site log --reverse --format='%H%x09%aI%x09%s' baseline..HEAD)

OUT="$(jq -c -n --arg slug "$SLUG" --arg head "$(git_site rev-parse HEAD)" --arg base "$(git_site rev-parse baseline)" \
  --argjson steps "$STEPS" '{slug:$slug, head:$head, baseline:$base, steps:$steps,
    totals: {
      costUsd: ([$steps[].costUsd // 0] | add // 0),
      inputTokens: ([$steps[].usage.input_tokens // 0] | add // 0),
      outputTokens: ([$steps[].usage.output_tokens // 0] | add // 0),
      cacheReadTokens: ([$steps[].usage.cache_read_input_tokens // 0] | add // 0),
      cacheCreationTokens: ([$steps[].usage.cache_creation_input_tokens // 0] | add // 0)
    }}')"
tmp="$(mktemp "$SITE/.history.XXXXXX")"; printf '%s\n' "$OUT" >"$tmp"; mv "$tmp" "$SITE/.history.json"; chmod 644 "$SITE/.history.json"
emit_json "$OUT"
