#!/usr/bin/env bash
# Verwirft einen offenen Entwurf (bleibt unter drafts/ liegen, wird nicht mehr angeboten).
# Aufruf: draft-discard.sh <slug> <entwurf-id>
source "$(dirname "$0")/lib/common.sh"
require_cmd jq
require_site "${1:-}"
DID="${2:-}"
valid_draft_id "$DID" || usage "draft-discard.sh <slug> <entwurf-id>"
F="$SITE/drafts/$DID/draft.json"
[[ -f "$F" ]] || die "Entwurf nicht gefunden: $DID"
[[ "$(draft_status "$DID")" == "open" ]] || die "$DID ist nicht offen"
tmp="$(mktemp)"
jq --arg t "$(now_iso)" '.status = "discarded" | .discarded = $t' "$F" >"$tmp" && mv "$tmp" "$F"
chmod 644 "$F"
log "$DID verworfen"
emit status ok slug "$SLUG" draft "$DID"
