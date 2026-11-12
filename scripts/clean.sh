#!/usr/bin/env bash
# Entfernt Scripts, iframes und Embeds fremder Domains aus dem Abzug.
# Aufruf: clean.sh <slug>
source "$(dirname "$0")/lib/common.sh"
require_cmd node jq

SLUG="${1:-}"
[[ -n "$SLUG" ]] || usage "clean.sh <slug>"
valid_slug "$SLUG" || die "Ungültiger Slug: $SLUG" 2
SITE="$SITES_DIR/$SLUG"
[[ -d "$SITE/www" ]] || die "Abzug fehlt: $SITE/www"

HOST="$(jq -r '.host // empty' "$SITE/site.json")"
RESULT="$(node "$LIB_DIR/clean.mjs" "$SITE/www" "$LIB_DIR/allowed-domains.txt" "$HOST")" || die "Bereinigung fehlgeschlagen"
log "Bereinigt: $(jq -r '"\(.files) Datei(en), \(.removed) Element(e) entfernt"' <<<"$RESULT")"
emit_json "$(jq -c --arg slug "$SLUG" '{status:"ok", slug:$slug} + .' <<<"$RESULT")"
