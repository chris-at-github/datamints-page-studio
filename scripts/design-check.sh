#!/usr/bin/env bash
# Gestaltungsprüfung mit dem Detektor des Skills „impeccable“ (impeccable detect): scannt die ausgelieferte Seite
# vorher und nachher im Browser (Chromium) und meldet nur Befunde, die durch den Schritt neu entstanden sind
# (z. B. zu wenig Kontrast, überlaufende Inhalte, zu lange Zeilen). Vorher-Altlasten der Website zählen nicht.
#   Annotation: offener Schritt gegen HEAD, sonst der letzte Commit (muss zu ihr gehören) gegen seinen Vorgänger;
#               Seiten der Annotation (bei Sammelaufträgen je Eintrag, höchstens 6).
#   Entwurf:    Seite mit dem Element durch die Komponente ersetzt (wie die Vorschau) gegen die Seite ohne Entwurf;
#               nur Befunde innerhalb der Komponente. Bibliotheks-Entwürfe werden nicht geprüft.
# Ansichten: DESIGN_CHECK_VIEWPORTS (Standard "desktop:1440x900,mobil:390x844"). DESIGN_CHECK=off schaltet ab.
# Detektor: IMPECCABLE_CMD (Standard .claude/skills/impeccable/scripts/impeccable), Browser: IMPECCABLE_BROWSER,
# sonst PLAYWRIGHT_CHROMIUM, sonst das Chromium von Playwright.
# Aufruf: design-check.sh <slug> <annotation-id|entwurf-id> [version]
# Exit 0: keine neuen Befunde, 3: neue Befunde (Prüfung nötig), 4: Detektor oder Browser nicht verfügbar bzw. abgeschaltet
source "$(dirname "$0")/lib/common.sh"
require_cmd git jq node
require_site "${1:-}"
ID="${2:-}"
VERSION_ARG="${3:-}"
valid_annotation_id "$ID" || valid_draft_id "$ID" || usage "design-check.sh <slug> <annotation-id|entwurf-id> [version]"

if [[ "${DESIGN_CHECK:-on}" == off ]]; then
  emit status unavailable id "$ID" error "Gestaltungsprüfung abgeschaltet (DESIGN_CHECK=off)"
  exit 4
fi
export IMPECCABLE_CMD="$(abspath "${IMPECCABLE_CMD:-./.claude/skills/impeccable/scripts/impeccable}")"

VIEWPORTS="[]"
IFS=',' read -ra VPS <<<"${DESIGN_CHECK_VIEWPORTS:-desktop:1440x900,mobil:390x844}"
for v in "${VPS[@]}"; do
  [[ "$v" =~ ^([a-z0-9-]+):([0-9]{3,4})x([0-9]{3,4})$ ]] || die "Ungültige Ansicht in DESIGN_CHECK_VIEWPORTS: $v (Form name:BREITExHÖHE)"
  VIEWPORTS="$(jq -c --arg n "${BASH_REMATCH[1]}" --argjson w "${BASH_REMATCH[2]}" --argjson h "${BASH_REMATCH[3]}" '. + [{name:$n, width:$w, height:$h}]' <<<"$VIEWPORTS")"
done

if valid_annotation_id "$ID"; then
  ANN_FILE="$SITE/annotations/$ID.json"
  [[ -f "$ANN_FILE" ]] || die "Annotation nicht gefunden: $ID"
  # Vergleichsstand wie render-check.sh
  if [[ -n "$(git_site status --porcelain -- www overrides.css components design)" ]]; then
    BEFORE="HEAD"
  else
    SUBJECT="$(git_site log -1 --format=%s)"
    [[ "$SUBJECT" == "[$ID]"* ]] || die "Keine offenen Änderungen und $ID ist nicht der letzte Schritt (nur offener oder letzter Schritt prüfbar)"
    git_site rev-parse -q --verify HEAD^ >/dev/null || die "Kein Vorgänger zum Vergleichen"
    BEFORE="$(git_site rev-parse HEAD^)"
  fi
  PAGES="$(jq -c '(if .batch == true then .items else [.] end) | map(select((.page // "") != "") | "/" + (.page | ltrimstr("/"))) | unique | .[0:6]' "$ANN_FILE")"
  [[ "$(jq length <<<"$PAGES")" -gt 0 ]] || die "Annotation ohne Seite"
  SPEC="$(jq -cn --arg before "$BEFORE" --argjson p "$PAGES" --argjson v "$VIEWPORTS" '{mode:"annotation", before:$before, pages:$p, viewports:$v}')"
  WHAT="$(jq length <<<"$PAGES") Seite(n)"
else
  DDIR="$SITE/drafts/$ID"
  [[ -f "$DDIR/draft.json" ]] || die "Entwurf nicht gefunden: $ID"
  if [[ "$(jq -r '.target // ""' "$DDIR/draft.json")" == library ]]; then
    emit status unavailable id "$ID" error "Bibliotheks-Entwürfe werden nicht geprüft"
    exit 4
  fi
  VERSION="${VERSION_ARG:-$(jq -r '[.versions[].v] | max // 0' "$DDIR/draft.json")}"
  [[ "$VERSION" =~ ^[0-9]+$ && -d "$DDIR/v$VERSION" ]] || die "Version nicht gefunden: $ID v$VERSION"
  PAGE="$(jq -r .page "$DDIR/draft.json")"
  [[ "$PAGE" != *".."* && -f "$SITE/www$PAGE" ]] || die "Seite des Entwurfs nicht im Abzug: $PAGE"
  SPEC="$(jq -cn --arg d "$DDIR" --argjson ver "$VERSION" --arg page "$PAGE" --arg sel "$(jq -r .selector "$DDIR/draft.json")" --argjson v "$VIEWPORTS" \
    '{mode:"draft", draftDir:$d, version:$ver, page:$page, selector:$sel, viewports:$v}')"
  WHAT="v$VERSION"
fi

log "$SLUG $ID: Gestaltungsprüfung ($WHAT, $(jq -r 'map(.name) | join(", ")' <<<"$VIEWPORTS"))"
set +e
OUT="$(timeout "${DESIGN_CHECK_TIMEOUT:-300}" node "$LIB_DIR/design-check.mjs" "$SITE" "$SLUG" "$SPEC" 2>>"$LOG_FILE")"
rc=$?
set -e
(( rc == 124 )) && die "Gestaltungsprüfung: Zeitüberschreitung nach ${DESIGN_CHECK_TIMEOUT:-300} s"
jq -e . >/dev/null 2>&1 <<<"$OUT" || die "Gestaltungsprüfung fehlgeschlagen (Exit $rc)"
OUT="$(jq -c --arg id "$ID" '. + {id:$id}' <<<"$OUT")"
if (( rc == 4 )); then
  log "Gestaltungsprüfung nicht verfügbar: $(jq -r .error <<<"$OUT")"
  emit_json "$OUT"; exit 4
fi
(( rc == 0 || rc == 3 )) || die "Gestaltungsprüfung fehlgeschlagen: $(jq -r '.error // "unbekannt"' <<<"$OUT")"
log "$SLUG $ID: Gestaltungsprüfung $(jq -r .status <<<"$OUT"), $(jq -r '.findings | length' <<<"$OUT") neue Befunde"
emit_json "$OUT"
exit "$rc"
