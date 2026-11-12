#!/usr/bin/env bash
# Übernimmt von Hand geänderte Design-Vorgaben (Tokens, notes.md und/oder consistency.json), prüft sie,
# erzeugt tokens.css und committet "[design] Design-Vorgaben angepasst".
# Aufruf: design-save.sh <slug> <datei>     Datei: {"tokens": {...}, "notes": "...", "consistency": {...}} (alle optional)
# Exit 0: gespeichert/unverändert, Exit 3: abgelehnt
source "$(dirname "$0")/lib/common.sh"
require_cmd node jq git
require_site "${1:-}"
FILE="${2:-}"
[[ -f "$FILE" ]] || usage "design-save.sh <slug> <datei>"
[[ -z "$(git_site status --porcelain)" ]] || die "Der Abzug enthält nicht übernommene Änderungen. Erst übernehmen („Lokale Änderungen übernehmen“ im Verlauf) oder verwerfen."
[[ -f "$SITE/design/tokens.json" ]] || "$SCRIPTS_DIR/design-init.sh" "$SLUG" >/dev/null

set +e
OUT="$(node "$LIB_DIR/design.mjs" save "$SITE" "$FILE")"; rc=$?
set -e
if (( rc != 0 )); then
  git_site checkout -q -- design 2>/dev/null || true
  MSG="$(jq -r '.error // "unbekannter Fehler"' <<<"$OUT" 2>/dev/null || echo "unbekannter Fehler")"
  log "$SLUG: Design-Vorgaben abgelehnt: $MSG"
  emit status review slug "$SLUG" error "Design-Vorgaben abgelehnt: $MSG"
  exit 3
fi
if [[ -z "$(git_site status --porcelain -- design)" ]]; then
  log "$SLUG: Design-Vorgaben unverändert"
  emit status nochange slug "$SLUG"
  exit 0
fi
git_site add -A -- design
git_site commit -q -m "[design] Design-Vorgaben angepasst"
COMMIT="$(git_site rev-parse HEAD)"
log "$SLUG: Design-Vorgaben angepasst (${COMMIT:0:10})"
emit status committed slug "$SLUG" commit "$COMMIT" tokens "json:$(jq -r .tokens <<<"$OUT")"
