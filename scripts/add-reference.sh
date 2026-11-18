#!/usr/bin/env bash
# Übernimmt ein Referenzbild (URL oder Datei) geprüft und normalisiert in annotations/assets/
# (bei einem Entwurf D-xxx in drafts/D-xxx/refs/).
# Aufruf: add-reference.sh <slug> <annotation-id|entwurf-id> <url|datei>
source "$(dirname "$0")/lib/common.sh"
require_cmd file node curl jq
require_site "${1:-}"
ID="${2:-}"; SRC="${3:-}"
valid_annotation_id "$ID" || valid_draft_id "$ID" || usage "add-reference.sh <slug> <annotation-id|entwurf-id> <url|datei>"
[[ -n "$SRC" ]] || usage "add-reference.sh <slug> <annotation-id|entwurf-id> <url|datei>"

MAX_MB="${IMAGE_MAX_MB:-10}"; MAX_PX="${IMAGE_MAX_PX:-2000}"
MAX_BYTES=$((MAX_MB * 1024 * 1024))
ASSETS="$SITE/annotations/assets"; REL_DIR="annotations/assets"
if valid_draft_id "$ID"; then ASSETS="$SITE/drafts/$ID/refs"; REL_DIR="drafts/$ID/refs"; fi
mkdir -p "$ASSETS"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
SOURCE_URL=""

if [[ "$SRC" =~ ^[a-zA-Z][a-zA-Z0-9+.-]*:// ]]; then
  valid_http_url "$SRC" || die "Nur http- und https-URLs sind erlaubt: $SRC"
  SOURCE_URL="$SRC"
  log "Lade Referenzbild $SRC"
  curl --fail --silent --show-error --location --max-redirs 3 --proto '=http,https' --proto-redir '=http,https' \
    --connect-timeout 10 --max-time 30 --max-filesize "$MAX_BYTES" \
    --user-agent "${CRAWL_USER_AGENT:-Mozilla/5.0 (datamints Page Studio)}" \
    --output "$TMP/download" "$SRC" 2>"$TMP/curl.err" \
    || die "Bild konnte nicht geladen werden ($(tr '\n' ' ' <"$TMP/curl.err")). Tipp: Screenshot per Strg+V einfügen."
  INPUT="$TMP/download"
else
  [[ -f "$SRC" ]] || die "Datei nicht gefunden: $SRC"
  INPUT="$SRC"
fi

SIZE="$(stat -c %s "$INPUT")"
(( SIZE <= MAX_BYTES )) || die "Bild ist größer als $MAX_MB MB"
MIME="$(file --brief --mime-type "$INPUT")"
case "$MIME" in
  image/png|image/jpeg|image/gif|image/webp) ;;
  image/svg+xml) die "SVG ist als Referenzbild nicht erlaubt (kann Scripts und Text enthalten)" ;;
  text/html|text/*) die "Die URL liefert eine Seite statt eines Bildes ($MIME). Tipp: Screenshot per Strg+V einfügen." ;;
  *) die "Nicht erlaubter Dateityp: $MIME (erlaubt: PNG, JPEG, GIF, WebP)" ;;
esac

N=1; while compgen -G "$ASSETS/$ID-ref-$N.*" >/dev/null; do N=$((N + 1)); done
OUT_JSON="$(node "$LIB_DIR/image.mjs" "$INPUT" "$ASSETS/$ID-ref-$N" "$MAX_PX")" || die "Bild konnte nicht verarbeitet werden"
FILE="$(jq -r .file <<<"$OUT_JSON")"
log "Referenzbild gespeichert: ${FILE#$DPS_ROOT/}"
emit_json "$(jq -c --arg src "$SOURCE_URL" --arg rel "$REL_DIR/$(basename "$FILE")" \
  '{status:"ok", path:.file, relPath:$rel, sourceUrl:(if $src=="" then null else $src end), width, height, format}' <<<"$OUT_JSON")"
