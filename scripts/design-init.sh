#!/usr/bin/env bash
# Legt design/ (tokens.json, tokens.css, notes.md, consistency.json) an, falls Dateien fehlen,
# und aktualisiert CLAUDE.md aus der Vorlage. Bestehende Dateien bleiben unverändert.
# Aufruf: design-init.sh <slug> [--no-commit]
#   --no-commit  nur Dateien anlegen (für site-new.sh vor dem Baseline-Commit)
#   sonst        Änderungen als "[design] Design-Vorgaben angelegt" committen
source "$(dirname "$0")/lib/common.sh"
require_cmd node jq
SLUG="${1:-}"; MODE="${2:-}"
[[ -n "$SLUG" ]] || usage "design-init.sh <slug> [--no-commit]"
valid_slug "$SLUG" || die "Ungültiger Slug: $SLUG" 2
[[ -z "$MODE" || "$MODE" == "--no-commit" ]] || usage "design-init.sh <slug> [--no-commit]"
SITE="$SITES_DIR/$SLUG"
[[ -f "$SITE/site.json" ]] || die "Website nicht gefunden: $SLUG"

if [[ "$MODE" != "--no-commit" ]]; then
  [[ -d "$SITE/.git" ]] || die "Website hat kein Git-Repo: $SLUG"
  [[ -z "$(git -C "$SITE" status --porcelain)" ]] || die "Der Abzug enthält nicht übernommene Änderungen. Erst übernehmen („Änderungen übernehmen“ im Overlay) oder verwerfen."
fi

CREATED=()
mkdir -p "$SITE/design"
for f in tokens.json notes.md consistency.json; do
  if [[ ! -f "$SITE/design/$f" ]]; then
    cp "$DPS_ROOT/templates/design/$f" "$SITE/design/$f"
    CREATED+=("design/$f")
  fi
done
if [[ ! -f "$SITE/design/tokens.css" ]]; then CREATED+=("design/tokens.css"); fi
set +e
BUILD="$(node "$LIB_DIR/design.mjs" build "$SITE")"; rc=$?
set -e
(( rc == 0 )) || die "tokens.json ist ungültig: $(jq -r '.error // empty' <<<"$BUILD")"
if ! cmp -s <(site_claude_md "$SITE") "$SITE/CLAUDE.md"; then
  site_claude_md "$SITE" >"$SITE/CLAUDE.md"
  CREATED+=("CLAUDE.md")
fi
grep -qxF '.scan.json' "$SITE/.gitignore" 2>/dev/null || { printf '.scan.json\n' >>"$SITE/.gitignore"; CREATED+=(".gitignore"); }

COMMIT=""
if [[ "$MODE" != "--no-commit" && -n "$(git -C "$SITE" status --porcelain)" ]]; then
  git -C "$SITE" add -A
  MSG="[design] Design-Vorgaben angelegt"
  [[ " ${CREATED[*]} " == *" design/tokens.json "* ]] || MSG="[design] Vorlagen aktualisiert"
  git -C "$SITE" commit -q -m "$MSG"
  COMMIT="$(git -C "$SITE" rev-parse HEAD)"
  log "$SLUG: Design-Vorgaben angelegt (${COMMIT:0:10})"
fi
emit status ok slug "$SLUG" created "json:$(printf '%s\n' "${CREATED[@]+"${CREATED[@]}"}" | jq -R . | jq -sc 'map(select(. != ""))')" commit "$COMMIT"
