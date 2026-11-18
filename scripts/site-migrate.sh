#!/usr/bin/env bash
# Übernimmt einen Abzug aus einer alten Modio-Installation und stellt die alten Namen um
# (--modio-* -> --dps-*, _modio-assets -> _dps-assets, data-modio-* -> data-dps-*, Modio -> Page Studio).
# Umgeschrieben werden Arbeitsbaum, ignorierte Dateien (Entwürfe, Zustand) und der ganze Verlauf
# samt Tags, damit Rücksprünge auf ältere Schritte weiter zu den neuen Namen passen.
# Die alte Installation bleibt unverändert; gearbeitet wird auf einer Kopie.
# Archivierte Stände (archive/<slug>-*) werden mitgenommen.
# Die Claude-Sitzung des letzten Schritts entfällt („Nachbessern“ startet neu), Entwürfe setzen mit
# einer frischen Sitzung fort.
# Aufruf: site-migrate.sh <slug> <alte-installation> [--dry-run]
#   --dry-run: nur zeigen, welche Dateien betroffen wären (nichts wird kopiert oder geändert)
# Exit 0: übernommen (bzw. Übersicht bei --dry-run)
source "$(dirname "$0")/lib/common.sh"
require_cmd git jq node

SLUG="${1:-}"
OLD_ROOT="${2:-}"
DRY=false
[[ "${3:-}" == --dry-run ]] && DRY=true
[[ -n "$SLUG" && -n "$OLD_ROOT" ]] || usage "site-migrate.sh <slug> <alte-installation> [--dry-run]"
valid_slug "$SLUG" || die "Ungültiger Slug: $SLUG" 2
OLD_ROOT="$(cd "$OLD_ROOT" 2>/dev/null && pwd)" || die "Alte Installation nicht gefunden: $2" 2
[[ "$OLD_ROOT" != "$DPS_ROOT" ]] || die "Alte Installation ist diese Installation" 2
OLD_SITE="$OLD_ROOT/sites/$SLUG"
[[ -d "$OLD_SITE/.git" ]] || die "Website nicht gefunden: $OLD_SITE" 2
SITE="$SITES_DIR/$SLUG"
[[ ! -e "$SITE" ]] || die "Website existiert hier bereits: sites/$SLUG"

# Die alte Website muss ruhen: keine offenen Jobs, keine gesammelten Annotationen, keine offenen Änderungen
for d in pending running review; do
  for f in "$OLD_ROOT/jobs/$d"/*.json; do
    [[ -f "$f" ]] || continue
    if [[ "$(jq -r '.slug // empty' "$f" 2>/dev/null)" == "$SLUG" ]]; then die "Offener Job für $SLUG in der alten Installation: jobs/$d/$(basename "$f")"; fi
  done
done
if compgen -G "$OLD_ROOT/jobs/queue/$SLUG/*.json" >/dev/null; then
  die "Gesammelte Annotationen für $SLUG in der alten Installation – erst umsetzen oder aus der Queue entfernen"
fi
[[ -z "$(git -C "$OLD_SITE" status --porcelain)" ]] || die "Nicht übernommene Änderungen in $OLD_SITE – erst übernehmen oder verwerfen"

LIB="$LIB_DIR/rename-names.mjs"
# Übersicht über den aktuellen Stand (auch für die Ausgabe nach der Übernahme)
R="$(node "$LIB" "$OLD_SITE" --dry-run)"
if [[ "$DRY" == true ]]; then
  N_COMMITS="$(git -C "$OLD_SITE" rev-list --all --count)"
  emit_json "$(jq -c --arg slug "$SLUG" --argjson commits "$N_COMMITS" \
    '{status:"dry-run", slug:$slug, commits:$commits, replacements, renamed, files:(.files | sort_by(-.count))}' <<<"$R")"
  exit 0
fi

TMP="$SITES_DIR/.migrate-$SLUG-$$"
REWRITE="$(mktemp -d)"
cleanup() { rm -rf "$TMP" "$REWRITE"; }
trap cleanup EXIT

log "$SLUG: kopiere aus $OLD_SITE"
cp -a "$OLD_SITE" "$TMP"

# Verlauf: jeder Stand und jede Commit-Nachricht, Tags (baseline, verworfen/…) werden mit umgeschrieben
N_COMMITS="$(git -C "$TMP" rev-list --all --count)"
log "$SLUG: schreibe $N_COMMITS Commits um"
(
  cd "$TMP"
  FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f -d "$REWRITE/t" \
    --tree-filter "node '$LIB' . --quiet" \
    --msg-filter "node '$LIB' --stdin" \
    --env-filter '
      [ "$GIT_AUTHOR_NAME" = Modio ] && GIT_AUTHOR_NAME="datamints Page Studio"
      [ "$GIT_COMMITTER_NAME" = Modio ] && GIT_COMMITTER_NAME="datamints Page Studio"
      [ "$GIT_AUTHOR_EMAIL" = modio@localhost ] && GIT_AUTHOR_EMAIL=page-studio@localhost
      [ "$GIT_COMMITTER_EMAIL" = modio@localhost ] && GIT_COMMITTER_EMAIL=page-studio@localhost
      true' \
    --tag-name-filter cat \
    -- --all
) >>"$LOG_FILE" 2>&1 || die "Umschreiben des Verlaufs fehlgeschlagen (Details in logs/$SCRIPT_NAME.log)"
# Alte Stände endgültig entfernen
git -C "$TMP" for-each-ref --format='%(refname)' refs/original/ | while read -r ref; do git -C "$TMP" update-ref -d "$ref"; done
git -C "$TMP" reflog expire --expire=now --all
git -C "$TMP" gc -q --prune=now
git -C "$TMP" reset -q --hard HEAD

# Ignorierte und nicht versionierte Dateien (Entwürfe, CHANGES.md, .scan.json, …)
node "$LIB" "$TMP" --quiet
rm -rf "$TMP/.render" "$TMP/.history.json"
if [[ -f "$TMP/.state.json" ]]; then
  jq '.sessionId = null | .sessionAnnotation = null | .sessionHead = null | .sessionCostUsd = null' "$TMP/.state.json" >"$TMP/.state.json.tmp"
  mv "$TMP/.state.json.tmp" "$TMP/.state.json"
fi

# Kontrolle: nirgends mehr alte Namen (Dateien, Pfade, Verlauf)
PAT="$(node "$LIB" --leftover)"
LEFT="$(grep -rIlP "$PAT" --exclude-dir=.git "$TMP" | head -5 || true)"
[[ -z "$LEFT" ]] || die "Alte Namen übrig in: ${LEFT//$TMP\//}"
[[ -z "$(find "$TMP" -path "$TMP/.git" -prune -o -print | sed "s|^$TMP||" | grep -P "$PAT" | head -1)" ]] || die "Alte Namen übrig in Pfaden"
if git -C "$TMP" log --all --format='%B%n%an %ae %cn %ce' | grep -qP "$PAT"; then die "Alte Namen übrig in Commit-Nachrichten oder Autoren"; fi
if git -C "$TMP" grep -IqP "$PAT" $(git -C "$TMP" rev-list --all) -- 2>/dev/null; then die "Alte Namen übrig im Verlauf"; fi

mv "$TMP" "$SITE"
log "$SLUG: nach sites/$SLUG übernommen"

# Archivierte Stände dieser Website mitnehmen
ARCHIVES=()
for a in "$OLD_ROOT/archive/$SLUG"-*; do
  [[ -d "$a" ]] || continue
  name="$(basename "$a")"
  [[ "$name" =~ ^$SLUG-[0-9]{8}-[0-9]{6}$ ]] || continue
  if [[ -e "$ARCHIVE_DIR/$name" ]]; then continue; fi
  cp -a "$a" "$ARCHIVE_DIR/$name"
  node "$LIB" "$ARCHIVE_DIR/$name" --quiet
  ARCHIVES+=("$name")
done

"$SCRIPTS_DIR/site-list.sh" >/dev/null

emit_json "$(jq -c --arg slug "$SLUG" --arg from "$OLD_SITE" --argjson commits "$N_COMMITS" \
  --arg head "$(git_site rev-parse --short HEAD)" --argjson archives "$(printf '%s\n' "${ARCHIVES[@]+"${ARCHIVES[@]}"}" | jq -R 'select(length > 0)' | jq -sc .)" \
  '{status:"ok", slug:$slug, from:$from, commits:$commits, head:$head, archives:$archives, replacements, renamed}' <<<"$R")"
