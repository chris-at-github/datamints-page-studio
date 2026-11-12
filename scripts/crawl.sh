#!/usr/bin/env bash
# Zieht die Seiten aus urls.txt nach www/, bereinigt und formatiert CSS.
# Aufruf: crawl.sh <slug>
source "$(dirname "$0")/lib/common.sh"
require_cmd wget jq node

SLUG="${1:-}"
[[ -n "$SLUG" ]] || usage "crawl.sh <slug>"
valid_slug "$SLUG" || die "Ungültiger Slug: $SLUG" 2
SITE="$SITES_DIR/$SLUG"
[[ -f "$SITE/urls.txt" ]] || die "urls.txt fehlt: $SITE"

mkdir -p "$SITE/www"
log "Abzug für $SLUG ($(wc -l <"$SITE/urls.txt") Seite(n))"

WGET_ARGS=(
  --page-requisites --convert-links --adjust-extension --span-hosts
  --no-parent --timestamping --restrict-file-names=windows,nocontrol
  --tries=2 --timeout=20 --wait=0.2 --no-verbose
  --directory-prefix="$SITE/www"
  --user-agent="${CRAWL_USER_AGENT:-Mozilla/5.0 (Modio)}"
  --input-file="$SITE/urls.txt"
)
# Domains, deren Inhalte sicher nicht gebraucht werden (Tracking, Werbung)
WGET_ARGS+=(--exclude-domains="googletagmanager.com,www.googletagmanager.com,google-analytics.com,www.google-analytics.com,doubleclick.net,connect.facebook.net,static.hotjar.com,script.hotjar.com")

if [[ -n "${CRAWL_HTTP_USER:-}" ]]; then
  WGET_ARGS+=(--auth-no-challenge --http-user="$CRAWL_HTTP_USER" --http-password="${CRAWL_HTTP_PASSWORD:-}")
fi

set +e
wget "${WGET_ARGS[@]}" 2>>"$LOG_DIR/crawl-$SLUG.log"
rc=$?
set -e
# Exit 8 = Server-Fehler bei einzelnen Ressourcen (z. B. 404) – kein Abbruch
if (( rc != 0 && rc != 8 )); then die "wget fehlgeschlagen (Exit $rc), siehe logs/crawl-$SLUG.log"; fi
(( rc == 8 )) && log "Einige Ressourcen konnten nicht geladen werden (siehe logs/crawl-$SLUG.log)"

# Einstiegspfad: lokale Datei zur ersten URL
ENTRY="$(node "$LIB_DIR/entry-path.mjs" "$SITE/www" "$(head -n1 "$SITE/urls.txt")")" \
  || die "Einstiegsseite nicht gefunden – liefert die URL HTML?"

"$SCRIPTS_DIR/clean.sh" "$SLUG" >/dev/null

mapfile -t CSS_FILES < <(find "$SITE/www" -type f -name '*.css' ! -path '*/_modio-assets/*')
if ((${#CSS_FILES[@]})); then
  log "Formatiere ${#CSS_FILES[@]} CSS-Datei(en) mit Prettier"
  npx --no-install prettier --log-level error --parser css --write "${CSS_FILES[@]}" >&2 \
    || log "Prettier konnte nicht alle CSS-Dateien formatieren (wird ignoriert)"
fi

tmp="$(mktemp)"
jq --arg entry "$ENTRY" --arg at "$(now_iso)" '.entry=$entry | .crawledAt=$at' "$SITE/site.json" >"$tmp" && mv "$tmp" "$SITE/site.json"

PAGES="$(find "$SITE/www" -type f \( -name '*.html' -o -name '*.htm' \) | wc -l)"
log "Abzug fertig: $PAGES HTML-Datei(en), Einstieg $ENTRY"
emit status ok slug "$SLUG" entry "$ENTRY" pages "json:$PAGES"
