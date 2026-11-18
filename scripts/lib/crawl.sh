# Gemeinsamer wget-Aufruf für crawl.sh und pages-add.sh (wird per source eingebunden, setzt common.sh voraus).
# crawl_wget <urls-datei> <zielordner> <logdatei>
# Bricht bei schweren Fehlern ab; Exit 8 (einzelne Ressourcen nicht ladbar) wird nur protokolliert.
crawl_wget() {
  local urls="$1" dest="$2" logfile="$3" rc
  local args=(
    --page-requisites --convert-links --adjust-extension --span-hosts
    --no-parent --timestamping --restrict-file-names=windows,nocontrol
    --tries=2 --timeout=20 --wait=0.2 --no-verbose
    --directory-prefix="$dest"
    --user-agent="${CRAWL_USER_AGENT:-Mozilla/5.0 (datamints Page Studio)}"
    --input-file="$urls"
  )
  # Domains, deren Inhalte sicher nicht gebraucht werden (Tracking, Werbung)
  args+=(--exclude-domains="googletagmanager.com,www.googletagmanager.com,google-analytics.com,www.google-analytics.com,doubleclick.net,connect.facebook.net,static.hotjar.com,script.hotjar.com")
  if [[ -n "${CRAWL_HTTP_USER:-}" ]]; then
    args+=(--auth-no-challenge --http-user="$CRAWL_HTTP_USER" --http-password="${CRAWL_HTTP_PASSWORD:-}")
  fi
  set +e
  wget "${args[@]}" 2>>"$logfile"
  rc=$?
  set -e
  if (( rc != 0 && rc != 8 )); then die "wget fehlgeschlagen (Exit $rc), siehe ${logfile#$DPS_ROOT/}"; fi
  (( rc == 8 )) && log "Einige Ressourcen konnten nicht geladen werden (siehe ${logfile#$DPS_ROOT/})"
  crawl_srcset "$dest" "$urls" "$logfile"
  return 0
}

# Bilder aus srcset (<picture><source>, <img srcset>) nachladen; wget übernimmt nur <img src>.
crawl_srcset() {
  local dest="$1" urls="$2" logfile="$3" out
  if out="$(node "$LIB_DIR/srcset.mjs" "$dest" "$urls" "$LIB_DIR/allowed-domains.txt" 2>>"$logfile")"; then
    log "srcset: $(jq -r '"\(.downloaded) Bild(er) nachgeladen, \(.failed | length) nicht ladbar, \(.files) Datei(en) umgeschrieben"' <<<"$out")"
    (( $(jq '.failed | length' <<<"$out") )) && log "srcset nicht ladbar (bleibt Live-URL): $(jq -r '.failed | join(" ")' <<<"$out")"
  else
    log "srcset-Bilder konnten nicht nachgeladen werden (siehe ${logfile#$DPS_ROOT/})"
  fi
  return 0
}

# CSS-Dateien unter <ordner> mit Prettier formatieren (Fehler werden ignoriert)
format_css() {
  local files=()
  mapfile -t files < <(find "$1" -type f -name '*.css' ! -path '*/_dps-assets/*')
  if ((${#files[@]})); then
    log "Formatiere ${#files[@]} CSS-Datei(en) mit Prettier"
    (cd "$DPS_ROOT" && npx --no-install prettier --log-level error --parser css --write "${files[@]}" >&2) \
      || log "Prettier konnte nicht alle CSS-Dateien formatieren (wird ignoriert)"
  fi
  return 0
}
