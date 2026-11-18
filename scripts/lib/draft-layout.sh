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

# Kurzfassung für Prompts und Briefings: ein Satz zur Breite (leer, wenn nicht gemessen).
# Nennt die Tokens container.max-width und container.spacing-x, wenn vorhanden, sonst die gemessenen Pixel.
# Spalten stehen nur in layout.json (Ausgangspunkt, nicht verbindlich).
draft_layout_text() {
  [[ -f "$DDIR/layout.json" ]] || return 0
  local tokens='{}'
  [[ -f "$SITE/design/tokens.json" ]] && tokens="$(jq -c '.tokens // {}' "$SITE/design/tokens.json" 2>/dev/null || echo '{}')"
  jq -r --argjson t "$tokens" '
    def px: if . == null then null else ((tostring | capture("^(?<n>[0-9.]+)px$") | .n | tonumber)? // null) end;
    def ref($key; $measured; $label):
      ($t[$key].value // null) as $v | ($v | px) as $vp
      | if $v == null then "\($measured) px"
        elif $vp != null and (($vp - $measured) | fabs) > 2 then "var(--dps-\($key | gsub("\\."; "-"))) (\($v); gemessen \($measured) px)"
        else "var(--dps-\($key | gsub("\\."; "-"))) (\($v))" end;
    [.ansichten[] | select(.error | not)] | sort_by(-.width) as $v
    | if ($v | length) == 0 then empty else
      $v[0] as $big | $v[-1] as $small
      | ($big.element.w >= $big.width - 20) as $full
      | (if $big.inner then $big.inner.w elif $full then null else $big.element.w end) as $max
      | (($small.inner // $small.element).x | round) as $gut
      | (($t["container.max-width"].value // null) | px) as $tmax
      | (if $full and $max == null then "Das Element geht über die volle Breite des Bildschirms."
         elif $full then "Das Element geht über die volle Breite; Texte und Bedienelemente bleiben innerhalb von \(ref("container.max-width"; $max | round; ""))."
         elif $tmax != null and $max < $tmax - 20 then "Das Element ist auf großen Bildschirmen \($max | round) px breit (schmaler als die Inhaltsbreite)."
         else "Das Element liegt in der Inhaltsbreite: höchstens \(ref("container.max-width"; $max | round; ""))." end)
      + (if $gut > 0 then " Auf schmalen Bildschirmen \(ref("container.spacing-x"; $gut; "")) Rand je Seite." else " Auf schmalen Bildschirmen ohne Seitenrand." end)
    end' "$DDIR/layout.json"
}
