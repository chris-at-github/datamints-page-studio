#!/usr/bin/env bash
# Sichtprüfung im Browser: rendert die Seite(n) einer Annotation vorher und nachher (Playwright/Chromium, ohne Netz),
# misst die gewählten Elemente und legt Ausschnitte als PNG unter sites/<slug>/.render/<annotation-id>/ ab.
# Vorher = letzter Commit, nachher = Arbeitsverzeichnis (offener Schritt). Ist der Schritt schon committet
# und der letzte im Verlauf, wird er mit seinem Vorgänger verglichen.
# Ansichten: RENDER_VIEWPORTS (Standard "desktop:1440x900,mobil:390x844"), dazu der Viewport der Auswahl, falls abweichend.
# Aufruf: render-check.sh <slug> <annotation-id>
# Exit 0: keine Fehler-Befunde, 3: Fehler-Befunde (Prüfung nötig), 4: Playwright/Browser nicht verfügbar
source "$(dirname "$0")/lib/common.sh"
require_cmd git jq node
require_site "${1:-}"
ID="${2:-}"
valid_annotation_id "$ID" || usage "render-check.sh <slug> <annotation-id>"
ANN_FILE="$SITE/annotations/$ID.json"
[[ -f "$ANN_FILE" ]] || die "Annotation nicht gefunden: $ID"

# Vergleichsstand: offener Schritt gegen HEAD, sonst der letzte Commit (muss zu dieser Annotation gehören) gegen seinen Vorgänger
# nur darstellungsrelevante Pfade zählen (nicht annotations/, drafts/ usw.)
if [[ -n "$(git_site status --porcelain -- www overrides.css components design)" ]]; then
  BEFORE="HEAD"
else
  SUBJECT="$(git_site log -1 --format=%s)"
  [[ "$SUBJECT" == "[$ID]"* ]] || die "Keine offenen Änderungen und $ID ist nicht der letzte Schritt (nur offener oder letzter Schritt prüfbar)"
  git_site rev-parse -q --verify HEAD^ >/dev/null || die "Kein Vorgänger zum Vergleichen"
  BEFORE="$(git_site rev-parse HEAD^)"
fi

# Bilder liegen im Abzug (für Claude lesbar), aber nur lokal ignoriert: kein Commit, keine erkannte Änderung
EXCLUDE="$SITE/.git/info/exclude"
grep -qxF '.render/' "$EXCLUDE" 2>/dev/null || { mkdir -p "$(dirname "$EXCLUDE")"; printf '.render/\n' >>"$EXCLUDE"; }
OUT_DIR="$SITE/.render/$ID"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# Ansichten
VIEWPORTS="[]"
IFS=',' read -ra VPS <<<"${RENDER_VIEWPORTS:-desktop:1440x900,mobil:390x844}"
for v in "${VPS[@]}"; do
  [[ "$v" =~ ^([a-z0-9-]+):([0-9]{3,4})x([0-9]{3,4})$ ]] || die "Ungültige Ansicht in RENDER_VIEWPORTS: $v (Form name:BREITExHÖHE)"
  VIEWPORTS="$(jq -c --arg n "${BASH_REMATCH[1]}" --argjson w "${BASH_REMATCH[2]}" --argjson h "${BASH_REMATCH[3]}" '. + [{name:$n, width:$w, height:$h}]' <<<"$VIEWPORTS")"
done
# Viewport der Auswahl ergänzen, wenn er von allen Ansichten um mehr als 100 px abweicht
VIEWPORTS="$(jq -c --slurpfile ann "$ANN_FILE" '
  ($ann[0].viewport // null) as $v
  | if ($v | type) == "object" and (($v.width // 0) | type) == "number" and $v.width >= 280 and $v.width <= 3000
       and all(.[]; ((.width - $v.width) | fabs) > 100)
    then . + [{name:"auswahl", width:($v.width | floor), height:(([$v.height // 900, 400] | max) | floor | if . > 2000 then 2000 else . end)}]
    else . end' <<<"$VIEWPORTS")"

# Ziele: Seite und Selektor der Annotation, bei Sammelaufträgen je Eintrag (höchstens 6)
TARGETS="$(jq -c '(if .batch == true then .items else [.] end)
  | map(select((.page // "") != "" and (.selector // "") != "") | {page: ("/" + (.page | ltrimstr("/"))), selector})
  | unique | .[0:6]' "$ANN_FILE")"
[[ "$(jq length <<<"$TARGETS")" -gt 0 ]] || die "Annotation ohne Seite und Selektor"

SPEC="$(jq -cn --arg before "$BEFORE" --argjson t "$TARGETS" --argjson v "$VIEWPORTS" '{before:$before, targets:$t, viewports:$v}')"
log "$SLUG $ID: Sichtprüfung ($(jq -r 'map(.name) | join(", ")' <<<"$VIEWPORTS"), $(jq length <<<"$TARGETS") Element(e))"
set +e
OUT="$(timeout "${RENDER_TIMEOUT:-180}" node "$LIB_DIR/render.mjs" "$SITE" "$SLUG" "$OUT_DIR" "$SPEC" 2>>"$LOG_FILE")"
rc=$?
set -e
(( rc == 124 )) && die "Sichtprüfung: Zeitüberschreitung nach ${RENDER_TIMEOUT:-180} s"
jq -e . >/dev/null 2>&1 <<<"$OUT" || die "Sichtprüfung fehlgeschlagen (Exit $rc)"
if (( rc == 4 )); then
  log "Sichtprüfung nicht verfügbar: $(jq -r .error <<<"$OUT")"
  emit_json "$OUT"; exit 4
fi
(( rc == 0 || rc == 3 )) || die "Sichtprüfung fehlgeschlagen: $(jq -r '.error // "unbekannt"' <<<"$OUT")"

# Bildpfade relativ zum Abzug, Ergebnis zusätzlich als Datei
OUT="$(jq -c --arg site "$SITE/" '.dir |= ltrimstr($site) | .results |= map(.images |= map_values(if . then ltrimstr($site) else . end))' <<<"$OUT")"
jq . <<<"$OUT" >"$OUT_DIR/result.json"
log "$SLUG $ID: Sichtprüfung $(jq -r '.status' <<<"$OUT"), $(jq -r '.errors' <<<"$OUT") Fehler, $(jq -r '.issues | length' <<<"$OUT") Befunde"
emit_json "$OUT"
exit "$rc"
