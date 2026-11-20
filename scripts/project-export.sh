#!/usr/bin/env bash
# Exportiert alle Komponenten eines Projekts (oder Abzugs) zum Einbauen ins echte Projekt:
# $EXPORT_DIR/<slug>-komponenten-<zeitpunkt>/komponenten/<name>/component.html + component.css, tokens.css, komponenten.css, vorschau.html, README.md.
# Neue Projekte: var(--dps-…) werden auf die Variablen aus design/tokens-quelle.css zurückgeschrieben.
# Aufruf: project-export.sh <slug>
source "$(dirname "$0")/lib/common.sh"
require_cmd jq node
require_site "${1:-}"
# Gemeinsamer Export-Ordner (Standard export/ im Tool-Ordner, nie Teil eines Verlaufs)
TARGET="$EXPORT_DIR/$SLUG-komponenten-$(date '+%Y%m%d-%H%M%S')"
mkdir -p "$TARGET"
set +e; OUT="$(node "$LIB_DIR/export.mjs" "$SITE" "$TARGET")"; rc=$?; set -e
if (( rc != 0 )); then rm -rf "$TARGET"; die "Export fehlgeschlagen: $(jq -r '.error // "unbekannt"' <<<"$OUT" 2>/dev/null)"; fi
log "$SLUG: $(jq -r '.components | length' <<<"$OUT") Komponente(n) exportiert nach ${TARGET#$DPS_ROOT/}"
emit_json "$(jq -c --arg slug "$SLUG" '. + {slug:$slug}' <<<"$OUT")"
