# shellcheck shell=bash
# Wählt eine passende Node.js-Version und stellt sie vorn in den PATH.
# Eingebunden von common.sh und tests/run.sh; erwartet MODIO_ROOT.
# ----- Node.js: immer eine passende Version verwenden -----
# Nicht-Login-Shells (Worker, Claude, Cron) laden nvm nicht und landen sonst bei einem alten System-Node
# (z. B. /usr/bin/node 18). Reihenfolge: MODIO_NODE aus der .env, dann ein passender Node im PATH,
# dann nvm (Version aus .nvmrc bevorzugt, sonst die neueste). Das Verzeichnis kommt vorn in den PATH,
# damit auch Kindprozesse (Claude, npx, Playwright) dieselbe Version nutzen.
MODIO_NODE_MIN="20.6"
node_version_ok() {
  local v ma mi want_ma want_mi
  v="$("$1" -v 2>/dev/null)" || return 1
  v="${v#v}"; IFS=. read -r ma mi _ <<<"$v"
  IFS=. read -r want_ma want_mi <<<"$MODIO_NODE_MIN"
  [[ "$ma" =~ ^[0-9]+$ && "$mi" =~ ^[0-9]+$ ]] || return 1
  (( ma > want_ma || (ma == want_ma && mi >= want_mi) ))
}
_modio_pick_node() {
  local cand want="" d
  if [[ -n "${MODIO_NODE:-}" ]]; then
    [[ -x "$MODIO_NODE" ]] && printf '%s' "$(dirname "$MODIO_NODE")"
    return 0   # ausdrücklich gesetzt: nicht weitersuchen, require_cmd meldet den Fehler
  fi
  cand="$(command -v node 2>/dev/null || true)"
  if [[ -n "$cand" ]] && node_version_ok "$cand"; then return 0; fi
  [[ -f "$MODIO_ROOT/.nvmrc" ]] && want="$(tr -d ' v\n\r' <"$MODIO_ROOT/.nvmrc")"
  local nvm_dir="${NVM_DIR:-$HOME/.nvm}/versions/node"
  [[ -d "$nvm_dir" ]] || return 0
  # passende Hauptversion aus .nvmrc zuerst, danach alle übrigen; jeweils die neueste
  for cand in $( { [[ -n "$want" ]] && ls -d "$nvm_dir/v$want".* 2>/dev/null | sort -V -r; ls -d "$nvm_dir"/v* 2>/dev/null | sort -V -r; } ); do
    d="$cand/bin"
    if [[ -x "$d/node" ]] && node_version_ok "$d/node"; then printf '%s' "$d"; return 0; fi
  done
}
_node_dir="$(_modio_pick_node)"
if [[ -n "$_node_dir" ]]; then PATH="$_node_dir:$PATH"; export PATH; fi
unset _node_dir
