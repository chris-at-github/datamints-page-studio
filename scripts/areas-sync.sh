#!/usr/bin/env bash
# Gleicht Bereiche aus design/consistency.json (z. B. Header, Footer) an: überträgt sie von einer Quellseite
# auf alle anderen Seiten des Abzugs (ohne Claude). Optional wird zuvor ein neuer Bereich aufgenommen.
# Aufruf: areas-sync.sh <slug> <quellseite> [--add <name> <selektor>]
#   quellseite: Pfad im Abzug wie in der Annotation, z. B. /www.example.de/index.html
# Ausgabe: {status: committed|nochange, source, areas, added, changed:[{page, areas}], skipped, commit}
source "$(dirname "$0")/lib/common.sh"
require_cmd git jq node
require_site "${1:-}"
PAGE="${2:-}"
[[ -n "$PAGE" ]] || usage "areas-sync.sh <slug> <quellseite> [--add <name> <selektor>]"
ADD=()
if [[ "${3:-}" == "--add" ]]; then
  [[ -n "${4:-}" && -n "${5:-}" ]] || usage "areas-sync.sh <slug> <quellseite> [--add <name> <selektor>]"
  ADD=(--add "$4" "$5")
elif [[ -n "${3:-}" ]]; then
  usage "areas-sync.sh <slug> <quellseite> [--add <name> <selektor>]"
fi
[[ -z "$(git_site status --porcelain)" ]] || die "Der Abzug enthält nicht übernommene Änderungen. Erst übernehmen („Lokale Änderungen übernehmen“ im Verlauf) oder verwerfen."

set +e
OUT="$(node "$LIB_DIR/areas.mjs" sync "$SITE" "$PAGE" "${ADD[@]+"${ADD[@]}"}")"; rc=$?
set -e
if (( rc != 0 )); then
  git_site checkout -q -- . 2>/dev/null || true
  die "$(jq -r '.error // "Angleichen fehlgeschlagen"' <<<"$OUT" 2>/dev/null || echo "Angleichen fehlgeschlagen")"
fi

N="$(jq '.changed | length' <<<"$OUT")"
if [[ -z "$(git_site status --porcelain)" ]]; then
  log "$SLUG: alle Seiten schon gleich"
  emit_json "$(jq -c --arg slug "$SLUG" '{status:"nochange", slug:$slug} + . + {commit:""}' <<<"$OUT")"
  exit 0
fi
MSG="$(mktemp)"; trap 'rm -f "$MSG"' EXIT
{
  printf '[angleichen] %s von %s auf %s Seite(n)\n\n' "$(jq -r '.areas | join(", ")' <<<"$OUT")" "$(jq -r .source <<<"$OUT")" "$N"
  jq -r 'if .added then "Neuer Bereich in consistency.json: \(.areas[0])\n" else empty end' <<<"$OUT"
  jq -r '.changed[] | "\(.page): \(.areas | join(", "))"' <<<"$OUT"
} >"$MSG"
git_site add -A
git_site commit -q -F "$MSG"
COMMIT="$(git_site rev-parse HEAD)"
log "$SLUG: Bereiche angeglichen auf $N Seite(n) (${COMMIT:0:10})"
emit_json "$(jq -c --arg slug "$SLUG" --arg c "$COMMIT" '{status:"committed", slug:$slug} + . + {commit:$c}' <<<"$OUT")"
