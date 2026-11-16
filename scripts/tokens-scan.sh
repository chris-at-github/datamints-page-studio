#!/usr/bin/env bash
# Zählt häufige Farben, Radien, Schriften und Schriftgrößen im CSS des Abzugs und schreibt .scan.json.
# Misst zusätzlich auf der Startseite Inhaltsbreite und Seitenrand (.container; ohne Playwright entfällt das).
# Aufruf: tokens-scan.sh <slug>
source "$(dirname "$0")/lib/common.sh"
require_cmd node jq
require_site "${1:-}"

OUT="$(node "$LIB_DIR/design.mjs" scan "$SITE")" || die "Scan fehlgeschlagen"
ENTRY="$(jq -r '.entry // ""' "$SITE/site.json")"
if [[ -n "$ENTRY" && "$(site_kind "$SITE")" != neu ]]; then
  set +e; CONT="$(timeout "${RENDER_TIMEOUT:-180}" node "$LIB_DIR/render.mjs" container "$SITE" "$SLUG" "$ENTRY" 2>>"$LOG_FILE")"; crc=$?; set -e
  if (( crc == 0 )) && jq -e '.status == "ok"' >/dev/null 2>&1 <<<"$CONT"; then
    tmp="$(mktemp)"; jq --argjson c "$(jq -c '{maxWidth, spacingX, xs}' <<<"$CONT")" '.container = $c' "$SITE/.scan.json" >"$tmp" && mv "$tmp" "$SITE/.scan.json"
    OUT="$(jq -c --argjson c "$(jq -c '{maxWidth, spacingX}' <<<"$CONT")" '.container = $c' <<<"$OUT")"
    log "$SLUG: Inhaltsbreite $(jq -r '.maxWidth // "?"' <<<"$CONT"), Seitenrand $(jq -r '.spacingX // "?"' <<<"$CONT")"
  else
    log "$SLUG: Inhaltsbreite nicht gemessen: $(jq -r '.error // "unbekannt"' <<<"$CONT" 2>/dev/null || echo unbekannt)"
  fi
fi
log "$SLUG: Scan mit $(jq -r '"\(.colors) Farben, \(.radii) Radien, \(.fonts) Schriften, \(.fontSizes) Schriftgrößen"' <<<"$OUT")"
emit_json "$(jq -c --arg slug "$SLUG" '. + {slug:$slug}' <<<"$OUT")"
