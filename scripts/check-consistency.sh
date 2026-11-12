#!/usr/bin/env bash
# Prüft seitenübergreifend gleiche Bereiche (design/consistency.json, z. B. Header und Footer).
# Abweichungen sind Hinweise (warn) und blockieren keinen Commit.
# Aufruf: check-consistency.sh <slug> [--changed-only]
#   --changed-only: nur Abweichungen melden, die durch die ungespeicherten Änderungen entstanden sind
#                   (so ruft commit-step.sh das Skript auf)
# Ausgabe: {status, slug, pages, entries, warnings}
source "$(dirname "$0")/lib/common.sh"
require_cmd git node jq
require_site "${1:-}"
MODE="${2:-}"
[[ -z "$MODE" || "$MODE" == "--changed-only" ]] || usage "check-consistency.sh <slug> [--changed-only]"

OUT="$(node "$LIB_DIR/consistency.mjs" "$SITE" ${MODE:+"$MODE"})" || die "Konsistenzprüfung fehlgeschlagen"
N="$(jq '.warnings | length' <<<"$OUT")"
log "$SLUG: Konsistenz geprüft ($(jq -r '"\(.entries) Bereich(e), \(.pages) Seite(n)"' <<<"$OUT")), $N Hinweis(e)"
emit_json "$(jq -c --arg slug "$SLUG" '{status:"ok", slug:$slug} + .' <<<"$OUT")"
