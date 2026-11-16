# shellcheck shell=bash
# Hauptraster eines Entwurfs: Messung (layout.json) und Kurzfassung für Prompts und Briefings.
# Eingebunden von draft-create.sh und draft-brief.sh; erwartet SITE, SLUG, LIB_DIR, LOG_FILE, DDIR, PAGE, SELECTOR, DID.

# Misst das Hauptraster einmal je Entwurf (der Abzug ändert sich durch Entwürfe nicht). Ohne Playwright entfällt die Messung.
draft_measure_layout() {
  [[ -f "$DDIR/layout.json" ]] && return 0
  local vps layout lrc
  vps="$(jq -c '[(.viewport // null) | select(type == "object" and (.width // 0) >= 320) | {name:"auswahl", width:(.width|floor), height:((.height // 900)|floor)}]
    | . as $sel | $sel + ([{name:"desktop",width:1440,height:900},{name:"tablet",width:768,height:1024},{name:"mobil",width:390,height:844}]
    | map(select(. as $d | all($sel[]; ((.width - $d.width) | fabs) > 100))))' "$DDIR/draft.json")"
  set +e; layout="$(timeout "${RENDER_TIMEOUT:-180}" node "$LIB_DIR/render.mjs" layout "$SITE" "$SLUG" "$PAGE" "$SELECTOR" "$vps" 2>>"$LOG_FILE")"; lrc=$?; set -e
  if (( lrc == 0 )) && jq -e '.status == "ok"' >/dev/null 2>&1 <<<"$layout"; then
    jq '{gemessen: (now | todate), seite: $page, selektor: $sel, ansichten: .viewports}' --arg page "$PAGE" --arg sel "$SELECTOR" <<<"$layout" >"$DDIR/layout.json"
    log "$DID: Hauptraster gemessen ($(jq -r '[.viewports[].width] | map(tostring) | join(", ")' <<<"$layout") px)"
  else
    log "$DID: Hauptraster nicht gemessen: $(jq -r '.error // "unbekannt"' <<<"$layout" 2>/dev/null || echo unbekannt)"
  fi
}

# Kurzfassung je Bildschirmbreite (leer, wenn nicht gemessen)
draft_layout_text() {
  [[ -f "$DDIR/layout.json" ]] || return 0
  jq -r '.ansichten | sort_by(-.width)[] | select(.error | not) |
    "- \(.width) px Bildschirm: Element \(.element.w) px breit" +
    (if .inner then ", Inhaltsbreite \(.inner.w) px (\(.inner.node), max-width \(.inner.maxWidth), Abstand links \(.inner.x - .element.x) px)" else "" end) +
    (if .columns == null then "; eine Spalte, keine Hauptspalten"
     elif .columns.stacked then "; Hauptspalten untereinander in \(.columns.node): " + ([.columns.cols[] | "\(.node) \(.w) px"] | join(" / "))
     else "; Hauptspalten nebeneinander in \(.columns.node) (Abstand \(.columns.gap)): " + ([.columns.cols | sort_by(.x)[] | "\(.node) \(.w) px"] | join(" | ")) end)' "$DDIR/layout.json"
}
