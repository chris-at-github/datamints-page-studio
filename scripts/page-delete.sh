#!/usr/bin/env bash
# Löscht eine Seite aus einem Abzug oder neuen Projekt als Schritt A-xxx (source "delete").
# Läuft durch commit-step.sh, damit Verlauf, Report und Rücksprung (Seite zurückholen) wie bei jedem Schritt funktionieren.
# Abzüge: die URL der Seite wird auch aus urls.txt entfernt, damit „Neu einlesen“ sie nicht zurückholt;
#         die Startseite (entry in site.json) lässt sich nicht löschen.
# Links anderer Seiten auf die gelöschte Seite bleiben unverändert und werden als Hinweis gemeldet.
# Bilder, CSS usw. der Seite bleiben liegen (andere Seiten können sie nutzen).
# Aufruf: page-delete.sh <slug> <seite>     (<seite>: Pfad unter www/, z. B. /seiten/kontakt.html)
# Ausgabe: Ergebnis von commit-step.sh + {page, removedUrls, links:{count, files}}
source "$(dirname "$0")/lib/common.sh"
require_cmd git jq node
require_site "${1:-}"
PAGE="${2:-}"
[[ -n "$PAGE" ]] || usage "page-delete.sh <slug> <seite>"
[[ "$PAGE" == /* && "$PAGE" != *..* && "$PAGE" != *//* ]] || die "Ungültige Seite: $PAGE" 2
[[ "${PAGE##*/}" =~ \.html?(@.*)?$ ]] || die "Keine HTML-Seite: $PAGE" 2
[[ "$PAGE" != /_modio-assets/* ]] || die "Keine Seite: $PAGE" 2
TARGET="$SITE/www$PAGE"
[[ -f "$TARGET" && ! -L "$TARGET" ]] || die "Seite nicht gefunden: $PAGE" 4
KIND="$(site_kind "$SITE")"
ENTRY="$(jq -r '.entry // ""' "$SITE/site.json")"
[[ "$KIND" == neu || "$PAGE" != "$ENTRY" ]] || die "Die Startseite des Abzugs lässt sich nicht löschen." 2
[[ -z "$(git_site status --porcelain --untracked-files=all -- . ':(exclude)annotations/')" ]] \
  || die "Der Abzug enthält nicht übernommene Änderungen. Erst übernehmen oder verwerfen."

# Vor dem Löschen: Links anderer Seiten auf diese Seite, URLs in urls.txt
LINKS="$(node "$LIB_DIR/page-delete.mjs" links "$SITE/www" "$PAGE")" || die "Links konnten nicht ermittelt werden"
REMOVED='[]'
if [[ "$KIND" != neu && -f "$SITE/urls.txt" ]]; then
  URLS_NEW="$(mktemp)"; trap 'rm -f "$URLS_NEW"' EXIT
  R="$(node "$LIB_DIR/page-delete.mjs" urls "$SITE/www" "$SITE/urls.txt" "$PAGE" "$URLS_NEW")" || die "urls.txt konnte nicht angepasst werden"
  REMOVED="$(jq -c '.removed' <<<"$R")"
fi

COUNTER="$(next_annotation_number)"
state_set counter "$COUNTER"
ID="$(printf 'A-%03d' "$COUNTER")"
mkdir -p "$SITE/annotations"
jq -n --arg id "$ID" --arg page "$PAGE" --arg created "$(now_iso)" --argjson links "$LINKS" --argjson removed "$REMOVED" '{
  id:$id, source:"delete", created:$created, prompt:"Seite \($page) gelöscht",
  page:$page, selector:null, remember:false, allow_token_change:false,
  delete:{removedUrls:$removed, links:$links},
  result:{summary:("Seite \($page) gelöscht."
    + (if ($removed | length) > 0 then " Aus urls.txt entfernt: \($removed | join(", "))." else "" end)
    + (if $links.count > 0 then " \($links.count) Link(s) auf die Seite bleiben bestehen (\($links.files | .[:5] | join(", "))\(if ($links.files | length) > 5 then " …" else "" end))." else "" end))}
}' >"$SITE/annotations/$ID.json"
chmod 644 "$SITE/annotations/$ID.json"
rm -f "$TARGET"
if [[ "$REMOVED" != '[]' ]]; then cat "$URLS_NEW" >"$SITE/urls.txt"; fi
log "$SLUG: $PAGE gelöscht ($ID)"

set +e
OUT="$("$SCRIPTS_DIR/commit-step.sh" "$SLUG" "$ID")"; rc=$?
set -e
if (( rc != 0 && rc != 3 )); then
  git_site checkout -q -- . 2>/dev/null || true
  git_site clean -fdq -- annotations/ 2>/dev/null || true
  die "commit-step.sh fehlgeschlagen: $(jq -r '.error // empty' <<<"$OUT" 2>/dev/null)"
fi
emit_json "$(jq -c --arg page "$PAGE" --argjson removed "$REMOVED" --argjson links "$LINKS" '. + {page:$page, removedUrls:$removed, links:$links}
  | if $links.count > 0 then .warnings = ((.warnings // []) + [{rule:"page-links", file:("www" + $page), line:0,
      text:"\($links.count) Link(s) auf die gelöschte Seite in \($links.files | length) Seite(n): \($links.files | .[:5] | join(", "))\(if ($links.files | length) > 5 then " …" else "" end)"}]) else . end' <<<"$OUT")"
exit "$rc"
