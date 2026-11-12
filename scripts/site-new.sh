#!/usr/bin/env bash
# Legt eine neue Website an: Ordner, site.json, urls.txt, Abzug, Git-Repo mit Baseline.
# Aufruf: site-new.sh <url> [slug] [urls.txt]
source "$(dirname "$0")/lib/common.sh"
require_cmd git jq wget node

URL="${1:-}"; SLUG="${2:-}"; URLS_FILE="${3:-}"
[[ -n "$URL" ]] || usage "site-new.sh <url> [slug] [urls.txt]"
valid_http_url "$URL" || die "Ungültige URL (nur http/https): $URL" 2
[[ -n "$SLUG" ]] || SLUG="$(slug_from_url "$URL")"
valid_slug "$SLUG" || die "Ungültiger Slug: $SLUG" 2
SITE="$SITES_DIR/$SLUG"
[[ ! -e "$SITE" ]] || die "Website existiert bereits: $SLUG"
if [[ -n "$URLS_FILE" ]]; then [[ -f "$URLS_FILE" ]] || die "Seitenliste nicht gefunden: $URLS_FILE"; fi

log "Neue Website $SLUG ($URL)"
mkdir -p "$SITE/www" "$SITE/annotations/assets"
cleanup_on_fail() { local rc=$?; if (( rc != 0 )); then log "Aufräumen nach Fehler: $SITE"; rm -rf "$SITE"; fi; }
trap cleanup_on_fail EXIT

# Seitenliste: Start-URL plus optionale weitere Seiten (nur http/https, ohne Duplikate)
{
  printf '%s\n' "$URL"
  if [[ -n "$URLS_FILE" ]]; then grep -E '^https?://[^[:space:]]+$' "$URLS_FILE" || true; fi
} | awk '!seen[$0]++' >"$SITE/urls.txt"

jq -n --arg url "$URL" --arg slug "$SLUG" --arg host "$(url_host "$URL")" \
  '{url:$url, slug:$slug, host:$host, entry:null, crawledAt:null}' >"$SITE/site.json"

cp "$MODIO_ROOT/templates/CLAUDE.md" "$SITE/CLAUDE.md"
: >"$SITE/overrides.css"
touch "$SITE/annotations/assets/.keep"
cat >"$SITE/.gitignore" <<'GI'
.state.json
.state.*
.history.json
CHANGES.md
GI

"$SCRIPTS_DIR/crawl.sh" "$SLUG" >/dev/null

git -C "$SITE" init -q -b main
git -C "$SITE" add -A
git -C "$SITE" commit -q -m "Baseline: Abzug von $URL"
git -C "$SITE" tag baseline
jq -n '{counter:0, sessionId:null}' >"$SITE/.state.json"

trap - EXIT
log "Website $SLUG angelegt"
emit status ok slug "$SLUG" url "$URL" entry "$(jq -r .entry "$SITE/site.json")" commit "$(git -C "$SITE" rev-parse HEAD)"
