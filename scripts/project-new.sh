#!/usr/bin/env bash
# Legt ein neues Projekt ohne bestehende Website an (Gestaltung neuer Designs).
# Das Projekt startet ohne Seiten. Seiten kommen mit page-import.sh dazu (z. B. HTML-Export aus Claude Chat),
# landen unter www/seiten/ und werden dort nachbearbeitet. Die Angaben pflegt der Nutzer in design/:
#   notes.md (Regeln), projekt.md und weitere .md (Hintergrund), tokens-quelle.css (Design-Tokens als CSS-Variablen).
# Danach erzeugt project-package.sh daraus das Paket für Claude (claude.ai oder Claude Code).
# Aufruf: project-new.sh <slug> [titel]
source "$(dirname "$0")/lib/common.sh"
require_cmd git jq node

SLUG="${1:-}"; TITLE="${2:-}"
[[ -n "$SLUG" ]] || usage "project-new.sh <slug> [titel]"
valid_slug "$SLUG" || die "Ungültiger Slug: $SLUG" 2
[[ -n "$TITLE" ]] || TITLE="$SLUG"
(( ${#TITLE} <= 80 )) || die "Titel zu lang (höchstens 80 Zeichen)" 2
SITE="$SITES_DIR/$SLUG"
[[ ! -e "$SITE" ]] || die "Projekt oder Website existiert bereits: $SLUG"

log "Neues Projekt $SLUG ($TITLE)"
mkdir -p "$SITE/www/seiten" "$SITE/annotations/assets" "$SITE/design"
cleanup_on_fail() { local rc=$?; if (( rc != 0 )); then log "Aufräumen nach Fehler: $SITE"; rm -rf "$SITE"; fi; }
trap cleanup_on_fail EXIT

jq -n --arg slug "$SLUG" --arg title "$TITLE" --arg created "$(now_iso)" \
  '{url:null, slug:$slug, host:null, kind:"neu", title:$title, entry:null, crawledAt:null, created:$created}' >"$SITE/site.json"
: >"$SITE/urls.txt"
site_claude_md "$SITE" >"$SITE/CLAUDE.md"
: >"$SITE/overrides.css"
touch "$SITE/annotations/assets/.keep"
cat >"$SITE/.gitignore" <<'GI'
.state.json
.state.*
.history.json
CHANGES.md
.scan.json
drafts/
paket/
export/
GI

# Angaben zum Pflegen
for f in notes.md projekt.md tokens-quelle.css; do cp "$DPS_ROOT/templates/projekt/$f" "$SITE/design/$f"; done
cp "$DPS_ROOT/templates/design/tokens.json" "$DPS_ROOT/templates/design/consistency.json" "$SITE/design/"
"$SCRIPTS_DIR/design-init.sh" "$SLUG" --no-commit >/dev/null || die "design/ konnte nicht angelegt werden"

git -C "$SITE" init -q -b main
git -C "$SITE" add -A
git -C "$SITE" commit -q -m "Baseline: neues Projekt $TITLE"
git -C "$SITE" tag baseline
jq -n '{counter:0, sessionId:null}' >"$SITE/.state.json"

trap - EXIT
log "Projekt $SLUG angelegt (noch ohne Seiten)"
emit status ok slug "$SLUG" kind neu title "$TITLE" entry "json:null" design "$SITE/design" commit "$(git -C "$SITE" rev-parse HEAD)"
