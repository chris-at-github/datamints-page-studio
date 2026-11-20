#!/usr/bin/env bash
# Kunden-Export: Stand eines Projekts oder Abzugs zum Weitergeben an Kunden ohne Webserver, als ZIP im gemeinsamen
# Export-Ordner: $EXPORT_DIR/<slug>-<zeitpunkt>.zip (Standard export/ im Tool-Ordner, nie Teil eines Verlaufs).
#   html:   Seiten als eigenständige HTML-Dateien (CSS von Page Studio eingebettet, ohne Overlay), per Doppelklick
#           zu öffnen; Bilder und Links auf fremde Server bleiben, wie sie sind (laden aus dem Netz).
#   bilder: ganzseitige Screenshots je Seite, Desktop (1440 px) und Mobil (390 px).
#   beides: beides (Standard). Dazu immer index.html als Übersicht.
# Stand: Arbeitsverzeichnis des Abzugs (wie in Page Studio zu sehen), ohne offene Entwürfe.
# Aufruf: site-share.sh <slug> [beides|bilder|html]
# Exit 0: ZIP erstellt, 4: Screenshots verlangt, aber Playwright/Browser nicht verfügbar
source "$(dirname "$0")/lib/common.sh"
require_cmd node jq python3
require_site "${1:-}"
WHAT="${2:-beides}"
case "$WHAT" in beides|bilder|html) ;; *) usage "site-share.sh <slug> [beides|bilder|html]" ;; esac

NAME="$SLUG-$(date '+%Y%m%d-%H%M')"
mkdir -p "$EXPORT_DIR"
WORK="$(mktemp -d "$EXPORT_DIR/.share-XXXXXX")"
trap 'rc=$?; rm -rf "$WORK"; if (( rc != 0 && rc != 3 )); then log "Abbruch mit Exit-Code $rc"; fi' EXIT
mkdir -p "$WORK/$NAME"

log "$SLUG: Kunden-Export ($WHAT) …"
set +e; OUT="$(timeout "${SHARE_TIMEOUT:-600}" node "$LIB_DIR/share.mjs" "$SITE" "$SLUG" "$WORK/$NAME" "$WHAT" 2>>"$LOG_FILE")"; rc=$?; set -e
(( rc == 124 )) && die "Kunden-Export: Zeitüberschreitung nach ${SHARE_TIMEOUT:-600} s"
jq -e . >/dev/null 2>&1 <<<"$OUT" || die "Kunden-Export fehlgeschlagen (Exit $rc)"
if (( rc == 4 )); then emit status unavailable slug "$SLUG" error "$(jq -r .error <<<"$OUT")"; exit 4; fi
(( rc == 0 )) || die "Kunden-Export fehlgeschlagen: $(jq -r '.error // "unbekannt"' <<<"$OUT")"

ZIP="$EXPORT_DIR/$NAME.zip"
rm -f "$ZIP"
python3 - "$WORK" "$NAME" "$ZIP" <<'PY'
import os, sys, zipfile
base, name, target = sys.argv[1], sys.argv[2], sys.argv[3]
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(os.path.join(base, name)):
        for f in sorted(files):
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, base))
PY
chmod 644 "$ZIP"

ZIP_HOST="$(host_path "$ZIP")"
N_PAGES="$(jq '.pages | length' <<<"$OUT")"
N_SHOTS="$(jq '[.pages[].screenshots | to_entries[]] | length' <<<"$OUT")"
ZIP_REL="${ZIP#$DPS_ROOT/}"
log "$SLUG: Kunden-Export $ZIP_REL ($N_PAGES Seite(n), $N_SHOTS Screenshot(s), $(du -h "$ZIP" | cut -f1))"
emit_json "$(jq -c --arg slug "$SLUG" --arg what "$WHAT" --arg zip "$ZIP_REL" --arg host "$ZIP_HOST" --argjson bytes "$(stat -c %s "$ZIP")" \
  '{status:"ok", slug:$slug, what:$what, zip:$zip, zipHost:$host, bytes:$bytes, pages:(.pages | map({page, title, html, screenshots})), warnings:(.warnings // [])}' <<<"$OUT")"
