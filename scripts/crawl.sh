#!/usr/bin/env bash
# Zieht die Seiten aus urls.txt nach www/, bereinigt und formatiert CSS.
# Aufruf: crawl.sh <slug>
source "$(dirname "$0")/lib/common.sh"
require_cmd wget jq node
source "$LIB_DIR/crawl.sh"

SLUG="${1:-}"
[[ -n "$SLUG" ]] || usage "crawl.sh <slug>"
valid_slug "$SLUG" || die "Ungültiger Slug: $SLUG" 2
SITE="$SITES_DIR/$SLUG"
[[ -f "$SITE/urls.txt" ]] || die "urls.txt fehlt: $SITE"

mkdir -p "$SITE/www"
log "Abzug für $SLUG ($(wc -l <"$SITE/urls.txt") Seite(n))"

crawl_wget "$SITE/urls.txt" "$SITE/www" "$LOG_DIR/crawl-$SLUG.log"

# Einstiegspfad: lokale Datei zur ersten URL
ENTRY="$(node "$LIB_DIR/entry-path.mjs" "$SITE/www" "$(head -n1 "$SITE/urls.txt")")" \
  || die "Einstiegsseite nicht gefunden – liefert die URL HTML?"

"$SCRIPTS_DIR/clean.sh" "$SLUG" >/dev/null

format_css "$SITE/www"

tmp="$(mktemp)"
jq --arg entry "$ENTRY" --arg at "$(now_iso)" '.entry=$entry | .crawledAt=$at' "$SITE/site.json" >"$tmp" && mv "$tmp" "$SITE/site.json"

PAGES="$(find "$SITE/www" -type f \( -name '*.html' -o -name '*.htm' \) | wc -l)"
log "Abzug fertig: $PAGES HTML-Datei(en), Einstieg $ENTRY"
emit status ok slug "$SLUG" entry "$ENTRY" pages "json:$PAGES"
