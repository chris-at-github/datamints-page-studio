#!/usr/bin/env bash
# Erzeugt den Übergabe-Report CHANGES.md im Site-Ordner.
# Aufruf: report.sh <slug>
source "$(dirname "$0")/lib/common.sh"
require_cmd git node
require_site "${1:-}"

RESULT="$(node "$LIB_DIR/report.mjs" "$SITE")" || die "Report konnte nicht erzeugt werden"
log "Report erzeugt: ${SITE#$MODIO_ROOT/}/CHANGES.md"
emit_json "$(jq -c --arg slug "$SLUG" '{status:"ok", slug:$slug} + .' <<<"$RESULT")"
