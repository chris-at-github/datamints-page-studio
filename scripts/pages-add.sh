#!/usr/bin/env bash
# Fügt einem bestehenden Abzug weitere Seiten hinzu, ohne bisherige Schritte zu verlieren.
# Ablauf: neue URLs in einen leeren Ordner laden und bereinigen -> nur Dateien übernehmen, die im Abzug
# noch fehlen (vorhandene, evtl. schon geänderte Dateien bleiben unangetastet) -> urls.txt ergänzen ->
# Links auf nun lokal vorhandene Seiten umschreiben -> Commit "[seiten] …".
# Aufruf: pages-add.sh <slug> <urls.txt>    (eine URL pro Zeile, nur Seiten derselben Website)
# Gleiche Bereiche aus design/consistency.json übernehmen die neuen Seiten, wenn die übrigen Seiten sich einig sind.
# Ausgabe: {status: committed|nochange, added, present, failed, rejected, duplicate, relinked, areas, commit}
source "$(dirname "$0")/lib/common.sh"
require_cmd git jq wget node
source "$LIB_DIR/crawl.sh"
require_site "${1:-}"
URLS_FILE="${2:-}"
[[ -f "$URLS_FILE" ]] || usage "pages-add.sh <slug> <urls.txt>"
[[ -z "$(git_site status --porcelain)" ]] || die "Der Abzug enthält nicht übernommene Änderungen. Erst übernehmen oder verwerfen."

HOST="$(jq -r '.host // empty' "$SITE/site.json")"
ENTRY="$(jq -r '.entry // empty' "$SITE/site.json")"
HOSTDIR="$(cut -d/ -f2 <<<"$ENTRY")"
[[ -n "$HOST" && -n "$HOSTDIR" && -d "$SITE/www/$HOSTDIR" ]] || die "site.json unvollständig (host/entry)"
bare() { local h="${1,,}"; printf '%s' "${h#www.}"; }

ACCEPT=(); REJECTED=(); DUPLICATE=()
while IFS= read -r u; do
  u="${u%$'\r'}"; u="$(sed -E 's/^[[:space:]]+|[[:space:]]+$//g' <<<"$u")"
  [[ -n "$u" ]] || continue
  if ! valid_http_url "$u" || [[ "$(bare "$(url_host "$u")")" != "$(bare "$HOST")" ]]; then REJECTED+=("$u"); continue; fi
  # gleiche Website mit/ohne www: auf den Host des Abzugs vereinheitlichen (sonst landet sie in einem anderen Ordner)
  [[ "$(url_host "$u")" == "${HOST,,}" ]] || u="$(sed -E "s#^(https?://)[^/:?\#]+#\1${HOST}#" <<<"$u")"
  if grep -qxF -- "$u" "$SITE/urls.txt" || printf '%s\n' "${ACCEPT[@]+"${ACCEPT[@]}"}" | grep -qxF -- "$u"; then DUPLICATE+=("$u"); continue; fi
  ACCEPT+=("$u")
done <"$URLS_FILE"

json_list() { printf '%s\n' "$@" | jq -R . | jq -sc 'map(select(. != ""))'; }
J_REJ="$(json_list "${REJECTED[@]+"${REJECTED[@]}"}")"
J_DUP="$(json_list "${DUPLICATE[@]+"${DUPLICATE[@]}"}")"
(( ${#REJECTED[@]} )) && log "Abgelehnt (nicht $HOST oder ungültig): ${REJECTED[*]}"
if (( ${#ACCEPT[@]} == 0 )); then
  log "$SLUG: keine neuen Seiten"
  emit status nochange slug "$SLUG" added "json:[]" present "json:[]" failed "json:[]" rejected "json:$J_REJ" duplicate "json:$J_DUP" relinked "json:0" commit ""
  exit 0
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
printf '%s\n' "${ACCEPT[@]}" >"$TMP/urls.txt"
log "$SLUG: lade ${#ACCEPT[@]} Seite(n)"
crawl_wget "$TMP/urls.txt" "$TMP/www" "$LOG_DIR/crawl-$SLUG.log"

# Lokale Pfade der neuen Seiten ermitteln
ADDED=(); PRESENT=(); FAILED=(); OK_URLS=()
for u in "${ACCEPT[@]}"; do
  if ! p="$(ENTRY_STRICT=1 node "$LIB_DIR/entry-path.mjs" "$TMP/www" "$u")" || [[ "$(cut -d/ -f2 <<<"$p")" != "$HOSTDIR" ]]; then
    FAILED+=("$u"); continue
  fi
  OK_URLS+=("$u")
  if [[ -f "$SITE/www$p" ]]; then PRESENT+=("$p"); else ADDED+=("$p"); fi
done
J_FAIL="$(json_list "${FAILED[@]+"${FAILED[@]}"}")"
(( ${#FAILED[@]} )) && log "Nicht geladen oder kein HTML: ${FAILED[*]}"
(( ${#OK_URLS[@]} )) || die "Keine der Seiten konnte geladen werden (siehe logs/crawl-$SLUG.log)"

# Bereinigen und formatieren wie beim Abzug
node "$LIB_DIR/clean.mjs" "$TMP/www" "$LIB_DIR/allowed-domains.txt" "$HOST" >/dev/null || die "Bereinigung fehlgeschlagen"
format_css "$TMP/www"

# Nur fehlende Dateien übernehmen
COPIED=0
while IFS= read -r -d '' f; do
  rel="${f#$TMP/www/}"
  [[ -e "$SITE/www/$rel" ]] && continue
  mkdir -p "$(dirname "$SITE/www/$rel")"
  cp -p "$f" "$SITE/www/$rel"
  COPIED=$((COPIED + 1))
done < <(find "$TMP/www" -type f -print0)
log "$COPIED neue Datei(en) übernommen"

printf '%s\n' "${OK_URLS[@]}" >>"$SITE/urls.txt"

RELINK="$(node "$LIB_DIR/relink.mjs" "$SITE/www" "$HOSTDIR" "$HOST")" || die "Umschreiben der Links fehlgeschlagen"
RELINKED="$(jq .links <<<"$RELINK")"
log "Links auf lokale Seiten umgeschrieben: $RELINKED in $(jq .files <<<"$RELINK") Datei(en)"

# Gleiche Bereiche (consistency.json): neue Seiten übernehmen Header/Footer usw., wenn die übrigen Seiten sich einig sind
AREAS='{"changed":[],"skipped":[],"unclear":[]}'
if (( ${#ADDED[@]} )); then
  rel_pages=(); for p in "${ADDED[@]}"; do rel_pages+=("${p#/}"); done
  if A="$(node "$LIB_DIR/areas.mjs" after-add "$SITE" "${rel_pages[@]}" 2>>"$LOG_DIR/pages-add.log")" && jq -e '.changed' >/dev/null 2>&1 <<<"$A"; then
    AREAS="$A"
    (( $(jq '.changed | length' <<<"$AREAS") )) && log "Bereiche übernommen: $(jq -r '[.changed[] | "\(.page): \(.areas | join(", "))"] | join("; ")' <<<"$AREAS")"
    (( $(jq '.unclear | length' <<<"$AREAS") )) && log "Nicht übernommen, Seiten uneinheitlich: $(jq -r '.unclear | join(", ")' <<<"$AREAS")"
  else
    log "Bereiche konnten nicht übernommen werden (wird ignoriert)"
  fi
fi

MSG="$(mktemp)"; trap 'rm -rf "$TMP" "$MSG"' EXIT
{
  printf '[seiten] %s Seite(n) hinzugefügt\n\n' "${#OK_URLS[@]}"
  printf '%s\n' "${OK_URLS[@]}"
  jq -r 'if (.changed | length) > 0 then "\nBereiche übernommen:\n" + ([.changed[] | "\(.page): \(.areas | join(", "))"] | join("\n")) else empty end' <<<"$AREAS"
} >"$MSG"
git_site add -A
git_site commit -q -F "$MSG"
COMMIT="$(git_site rev-parse HEAD)"
log "$SLUG: Seiten hinzugefügt (${COMMIT:0:10})"
"$SCRIPTS_DIR/tokens-scan.sh" "$SLUG" >/dev/null 2>&1 || log "Token-Scan fehlgeschlagen (wird ignoriert)"

emit status committed slug "$SLUG" added "json:$(json_list "${ADDED[@]+"${ADDED[@]}"}")" present "json:$(json_list "${PRESENT[@]+"${PRESENT[@]}"}")" \
  failed "json:$J_FAIL" rejected "json:$J_REJ" duplicate "json:$J_DUP" relinked "json:$RELINKED" areas "json:$AREAS" commit "$COMMIT"
