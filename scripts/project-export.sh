#!/usr/bin/env bash
# Exportiert alle Komponenten eines Projekts (oder Abzugs) zum Einbauen ins echte Projekt:
# export/<zeitpunkt>/komponenten/<name>/component.html + component.css, tokens.css, komponenten.css, vorschau.html, README.md.
# Neue Projekte: var(--modio-…) werden auf die Variablen aus design/tokens-quelle.css zurückgeschrieben.
# Aufruf: project-export.sh <slug>
source "$(dirname "$0")/lib/common.sh"
require_cmd jq node
require_site "${1:-}"
# export/ ist nie Teil des Verlaufs (bei Abzügen nur lokal ignoriert)
EXCLUDE="$SITE/.git/info/exclude"
grep -qxF 'export/' "$SITE/.gitignore" 2>/dev/null || grep -qxF 'export/' "$EXCLUDE" 2>/dev/null || { mkdir -p "$(dirname "$EXCLUDE")"; printf 'export/\n' >>"$EXCLUDE"; }
TARGET="$SITE/export/$(date '+%Y%m%d-%H%M%S')"
mkdir -p "$TARGET"
set +e; OUT="$(node "$LIB_DIR/export.mjs" "$SITE" "$TARGET")"; rc=$?; set -e
if (( rc != 0 )); then rm -rf "$TARGET"; die "Export fehlgeschlagen: $(jq -r '.error // "unbekannt"' <<<"$OUT" 2>/dev/null)"; fi
log "$SLUG: $(jq -r '.components | length' <<<"$OUT") Komponente(n) exportiert nach ${TARGET#$MODIO_ROOT/}"
emit_json "$(jq -c --arg slug "$SLUG" '. + {slug:$slug}' <<<"$OUT")"
