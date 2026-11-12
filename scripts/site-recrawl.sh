#!/usr/bin/env bash
# Neu einlesen: Report erzeugen, Site-Ordner archivieren, neuen Abzug mit neuer Baseline anlegen.
# Aufruf: site-recrawl.sh <slug>
source "$(dirname "$0")/lib/common.sh"
require_cmd git jq
require_site "${1:-}"

URL="$(jq -r .url "$SITE/site.json")"
"$SCRIPTS_DIR/report.sh" "$SLUG" >/dev/null || log "Report konnte nicht erzeugt werden (wird ignoriert)"

ARCHIVE="$ARCHIVE_DIR/$SLUG-$(date '+%Y%m%d-%H%M%S')"
mv "$SITE" "$ARCHIVE"
log "Archiviert: ${ARCHIVE#$MODIO_ROOT/}"

set +e
NEW="$("$SCRIPTS_DIR/site-new.sh" "$URL" "$SLUG" "$ARCHIVE/urls.txt")"
rc=$?
set -e
if (( rc != 0 )); then
  log "Neuer Abzug fehlgeschlagen, stelle archivierten Stand wieder her"
  [[ -e "$SITE" ]] || mv "$ARCHIVE" "$SITE"
  die "Neu einlesen fehlgeschlagen: $(jq -r '.error // "unbekannt"' <<<"$NEW" 2>/dev/null || echo unbekannt)"
fi
emit_json "$(jq -c --arg a "${ARCHIVE#$MODIO_ROOT/}" '. + {archive:$a}' <<<"$NEW")"
