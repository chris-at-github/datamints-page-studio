#!/usr/bin/env bash
# Benennt eine Website um: Ordner sites/<slug>, Slug in site.json, Queue-Ordner und state/sites.json.
# Nicht übernommene Änderungen im Arbeitsbaum bleiben unverändert liegen.
# Abgeschlossene Jobs (jobs/done, jobs/failed) und Logs behalten den alten Slug als Verlauf.
# Aufruf: site-rename.sh <slug> <neuer-slug>     Exit 0: umbenannt
source "$(dirname "$0")/lib/common.sh"
require_cmd jq git
require_site "${1:-}"

NEW="${2:-}"
[[ -n "$NEW" ]] || usage "site-rename.sh <slug> <neuer-slug>"
valid_slug "$NEW" || die "Ungültiger neuer Slug: $NEW" 2
[[ "$NEW" != "$SLUG" ]] || die "Neuer Slug ist gleich dem alten: $NEW" 2
[[ ! -e "$SITES_DIR/$NEW" ]] || die "Website existiert bereits: $NEW"

# Keine laufenden oder offenen Jobs für die Website
for d in pending running review; do
  [[ -d "$JOBS_DIR/$d" ]] || continue
  for f in "$JOBS_DIR/$d"/*.json; do
    [[ -f "$f" ]] || continue
    if [[ "$(jq -r '.slug // empty' "$f" 2>/dev/null)" == "$SLUG" ]]; then
      die "Offener Job für $SLUG in jobs/$d: $(basename "$f")"
    fi
  done
done
QUEUE_OLD="$JOBS_DIR/queue/$SLUG"
QUEUE_NEW="$JOBS_DIR/queue/$NEW"
[[ ! -e "$QUEUE_NEW" ]] || die "Queue-Ordner existiert bereits: jobs/queue/$NEW"

# Ordner verschieben
mv "$SITE" "$SITES_DIR/$NEW"
OLD="$SLUG"
SLUG="$NEW"
SITE="$SITES_DIR/$NEW"
log "$OLD: Ordner nach sites/$NEW verschoben"

# Slug in site.json setzen und nur diese Datei committen
if [[ -f "$SITE/site.json" ]]; then
  tmp="$(mktemp "$SITE/.site.XXXXXX")"
  jq --arg s "$NEW" '.slug = $s' "$SITE/site.json" >"$tmp" && mv "$tmp" "$SITE/site.json"
  chmod 644 "$SITE/site.json"
  if ! git_site diff --quiet -- site.json; then
    git_site commit -q -m "Website umbenannt: $OLD -> $NEW" -- site.json
  fi
fi

# Queue gesammelter Annotationen mitnehmen
if [[ -d "$QUEUE_OLD" ]]; then
  mv "$QUEUE_OLD" "$QUEUE_NEW"
  log "$OLD: Queue nach jobs/queue/$NEW verschoben"
fi

# Website-Liste neu schreiben
"$SCRIPTS_DIR/site-list.sh" >/dev/null

log "$OLD: umbenannt in $NEW"
emit status ok slug "$NEW" from "$OLD" site "${SITE#$MODIO_ROOT/}" commit "$(git_site rev-parse --short HEAD)"
