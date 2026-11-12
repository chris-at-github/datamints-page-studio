#!/usr/bin/env bash
# Prüft design/tokens.json und erzeugt daraus design/tokens.css.
# Aufruf: tokens-build.sh <slug>     Exit 0: erzeugt, Exit 3: Wert abgelehnt (Prüfung nötig)
source "$(dirname "$0")/lib/common.sh"
require_cmd node jq
require_site "${1:-}"

set +e
OUT="$(node "$LIB_DIR/design.mjs" build "$SITE")"
rc=$?
set -e
if (( rc == 3 )); then log "$SLUG: $(jq -r .error <<<"$OUT")"; emit_json "$(jq -c --arg slug "$SLUG" '. + {slug:$slug}' <<<"$OUT")"; exit 3; fi
(( rc == 0 )) || die "tokens-build fehlgeschlagen: $(jq -r '.error // empty' <<<"$OUT" 2>/dev/null)"
log "$SLUG: tokens.css erzeugt ($(jq -r .tokens <<<"$OUT") Token)"
emit_json "$(jq -c --arg slug "$SLUG" '. + {slug:$slug, file:"design/tokens.css"}' <<<"$OUT")"
