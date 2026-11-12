#!/usr/bin/env bash
# Zählt häufige Farben, Radien, Schriften und Schriftgrößen im CSS des Abzugs und schreibt .scan.json.
# Aufruf: tokens-scan.sh <slug>
source "$(dirname "$0")/lib/common.sh"
require_cmd node jq
require_site "${1:-}"

OUT="$(node "$LIB_DIR/design.mjs" scan "$SITE")" || die "Scan fehlgeschlagen"
log "$SLUG: Scan mit $(jq -r '"\(.colors) Farben, \(.radii) Radien, \(.fonts) Schriften, \(.fontSizes) Schriftgrößen"' <<<"$OUT")"
emit_json "$(jq -c --arg slug "$SLUG" '. + {slug:$slug}' <<<"$OUT")"
