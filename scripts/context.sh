#!/usr/bin/env bash
# Setzt den Kontextblock für einen Claude-Aufruf zusammen: verbindliche Vorgaben (Tokens, Regeln)
# und die letzten Schritte aus annotations/ im aktuellen Stand.
# Aufruf: context.sh <slug> <annotation-id>
# Ausgabe: {status, slug, context, steps, tokens, vorgabenBytes}
source "$(dirname "$0")/lib/common.sh"
require_cmd node jq git
require_site "${1:-}"
ID="${2:-}"
valid_annotation_id "$ID" || usage "context.sh <slug> <annotation-id>"

OUT="$(node "$LIB_DIR/design.mjs" context "$SITE" "$ID" "${CONTEXT_HISTORY_COUNT:-5}")" || die "Kontext konnte nicht erzeugt werden"
BYTES="$(jq -r .vorgabenBytes <<<"$OUT")"
if (( BYTES > 8192 )); then log "WARNUNG: Tokens und Regeln für $SLUG umfassen $BYTES Bytes (> 8 KB). notes.md kürzen."; fi
log "$ID: Kontext mit $(jq -r .tokens <<<"$OUT") Token(s) und $(jq -r .steps <<<"$OUT") früheren Schritt(en)"
emit_json "$(jq -c --arg slug "$SLUG" '. + {slug:$slug}' <<<"$OUT")"
