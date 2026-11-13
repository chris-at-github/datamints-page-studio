#!/usr/bin/env bash
# Legt eine neue Website an: Ordner, site.json, urls.txt, design/, Abzug, Git-Repo mit Baseline.
# Aufruf: site-new.sh <url> [slug] [urls.txt]
# Intern (site-recrawl.sh --keep-design): DESIGN_FROM=<ordner> übernimmt design/tokens.json,
# notes.md und consistency.json aus einem archivierten Abzug in die neue Baseline.
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
.scan.json
drafts/
GI

# Design-Gedächtnis: übernommene Vorgaben (Neu einlesen) oder leere Vorlagen
if [[ -n "${DESIGN_FROM:-}" && -d "$DESIGN_FROM/design" ]]; then
  mkdir -p "$SITE/design"
  for f in tokens.json notes.md consistency.json; do
    [[ -f "$DESIGN_FROM/design/$f" ]] && cp "$DESIGN_FROM/design/$f" "$SITE/design/$f"
  done
  log "Design-Vorgaben übernommen aus ${DESIGN_FROM#$MODIO_ROOT/}"
fi
"$SCRIPTS_DIR/design-init.sh" "$SLUG" --no-commit >/dev/null || die "design/ konnte nicht angelegt werden"

"$SCRIPTS_DIR/crawl.sh" "$SLUG" >/dev/null

git -C "$SITE" init -q -b main
git -C "$SITE" add -A
git -C "$SITE" commit -q -m "Baseline: Abzug von $URL"
git -C "$SITE" tag baseline
jq -n '{counter:0, sessionId:null}' >"$SITE/.state.json"
"$SCRIPTS_DIR/tokens-scan.sh" "$SLUG" >/dev/null || log "Token-Scan fehlgeschlagen (wird ignoriert)"

trap - EXIT
log "Website $SLUG angelegt"
emit status ok slug "$SLUG" url "$URL" entry "$(jq -r .entry "$SITE/site.json")" commit "$(git -C "$SITE" rev-parse HEAD)"
