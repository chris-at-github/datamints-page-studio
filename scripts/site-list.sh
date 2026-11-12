#!/usr/bin/env bash
# Listet alle Websites und schreibt state/sites.json.
# Aufruf: site-list.sh
source "$(dirname "$0")/lib/common.sh"
require_cmd git jq

SITES="[]"
for dir in "$SITES_DIR"/*/; do
  [[ -f "$dir/site.json" && -d "$dir/.git" ]] || continue
  slug="$(basename "$dir")"
  steps="$(git -C "$dir" rev-list --count baseline..HEAD 2>/dev/null || echo 0)"
  last="$(git -C "$dir" log -1 --format=%aI 2>/dev/null || echo "")"
  report="false"; [[ -f "$dir/CHANGES.md" ]] && report="true"
  entry="$(jq -c --argjson steps "$steps" --arg last "$last" --argjson report "$report" \
    '{slug, url, host, entry, crawledAt, steps:$steps, lastChange:$last, hasReport:$report}' "$dir/site.json")"
  SITES="$(jq -c --argjson e "$entry" '. + [$e]' <<<"$SITES")"
done
OUT="$(jq -c '{sites: (. | sort_by(.slug)), updated: (now | todate)}' <<<"$SITES")"
tmp="$(mktemp "$STATE_DIR/.sites.XXXXXX")"; printf '%s\n' "$OUT" >"$tmp"; mv "$tmp" "$STATE_DIR/sites.json"
chmod 644 "$STATE_DIR/sites.json"
emit_json "$OUT"
