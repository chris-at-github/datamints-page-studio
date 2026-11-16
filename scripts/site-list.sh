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
  pages=0; [[ -f "$dir/urls.txt" ]] && pages="$(grep -c . "$dir/urls.txt" || true)"
  [[ "$(jq -r '.kind // ""' "$dir/site.json")" == neu ]] && pages="$(find "$dir/www" -name '*.html' -type f | wc -l)"
  comps=0; [[ -d "$dir/components" ]] && comps="$(find "$dir/components" -maxdepth 1 -name 'mx-*.css' | wc -l)"
  entry="$(jq -c --argjson steps "$steps" --arg last "$last" --argjson report "$report" --argjson pages "${pages:-0}" --argjson comps "${comps:-0}" \
    '{slug, url, host, entry, crawledAt, kind:(.kind // "abzug"), title:(.title // null), created:(.created // null), steps:$steps, pages:$pages, components:$comps, lastChange:$last, hasReport:$report}' "$dir/site.json")"
  SITES="$(jq -c --argjson e "$entry" '. + [$e]' <<<"$SITES")"
done
OUT="$(jq -c '{sites: (. | sort_by(.slug)), updated: (now | todate)}' <<<"$SITES")"
tmp="$(mktemp "$STATE_DIR/.sites.XXXXXX")"; printf '%s\n' "$OUT" >"$tmp"; mv "$tmp" "$STATE_DIR/sites.json"
chmod 644 "$STATE_DIR/sites.json"
emit_json "$OUT"
