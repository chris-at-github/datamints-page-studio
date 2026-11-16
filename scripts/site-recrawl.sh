#!/usr/bin/env bash
# Neu einlesen: Report erzeugen, Site-Ordner archivieren, neuen Abzug mit neuer Baseline anlegen.
# Aufruf: site-recrawl.sh <slug> [--keep-design|--no-keep-design]
#   --keep-design (Standard): design/tokens.json, notes.md und consistency.json in die neue Baseline übernehmen
source "$(dirname "$0")/lib/common.sh"
require_cmd git jq
require_site "${1:-}"
[[ "$(jq -r '.kind // ""' "$SITE/site.json")" != neu ]] || die "Neues Projekt ohne Website: hier gibt es keinen Abzug zum Einlesen"
KEEP_DESIGN=true
case "${2:-}" in
  ""|--keep-design) ;;
  --no-keep-design) KEEP_DESIGN=false ;;
  *) usage "site-recrawl.sh <slug> [--keep-design|--no-keep-design]" ;;
esac

URL="$(jq -r .url "$SITE/site.json")"
"$SCRIPTS_DIR/report.sh" "$SLUG" >/dev/null || log "Report konnte nicht erzeugt werden (wird ignoriert)"

ARCHIVE="$ARCHIVE_DIR/$SLUG-$(date '+%Y%m%d-%H%M%S')"
mv "$SITE" "$ARCHIVE"
log "Archiviert: ${ARCHIVE#$MODIO_ROOT/}"

set +e
if [[ "$KEEP_DESIGN" == "true" ]]; then
  NEW="$(DESIGN_FROM="$ARCHIVE" "$SCRIPTS_DIR/site-new.sh" "$URL" "$SLUG" "$ARCHIVE/urls.txt")"
else
  NEW="$(env -u DESIGN_FROM "$SCRIPTS_DIR/site-new.sh" "$URL" "$SLUG" "$ARCHIVE/urls.txt")"
fi
rc=$?
set -e
if (( rc != 0 )); then
  log "Neuer Abzug fehlgeschlagen, stelle archivierten Stand wieder her"
  [[ -e "$SITE" ]] || mv "$ARCHIVE" "$SITE"
  die "Neu einlesen fehlgeschlagen: $(jq -r '.error // "unbekannt"' <<<"$NEW" 2>/dev/null || echo unbekannt)"
fi
emit_json "$(jq -c --arg a "${ARCHIVE#$MODIO_ROOT/}" --argjson keep "$KEEP_DESIGN" '. + {archive:$a, keepDesign:$keep}' <<<"$NEW")"
