# shellcheck shell=bash
# Gemeinsame Funktionen für alle Modio-Skripte.
# Einbinden mit: source "$(dirname "$0")/lib/common.sh"
#
# Konventionen:
#   - Aufruf aus dem Tool-Ordner, erstes Argument ist der Slug.
#   - Ergebnis: genau eine JSON-Zeile auf stdout (emit / emit_json).
#   - Log-Ausgaben: stderr und logs/<skript>.log.
#   - Exit-Codes: 0 Erfolg, 1 Fehler, 2 falscher Aufruf, 3 Prüfung nötig.

set -euo pipefail

MODIO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPTS_DIR="$MODIO_ROOT/scripts"
LIB_DIR="$SCRIPTS_DIR/lib"
SCRIPT_NAME="$(basename "$0" .sh)"

cd "$MODIO_ROOT"

if [[ -f "$MODIO_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$MODIO_ROOT/.env"
  set +a
fi

# Übliche Installationsorte (z. B. Claude Code in ~/.local/bin) auch in Nicht-Login-Shells finden
for _dir in "$HOME/.local/bin" "$HOME/.claude/local" "$HOME/bin"; do
  [[ -d "$_dir" && ":$PATH:" != *":$_dir:"* ]] && PATH="$_dir:$PATH"
done
# Optional expliziter Pfad: CLAUDE_BIN=/pfad/zu/claude in der .env
if [[ -n "${CLAUDE_BIN:-}" ]]; then PATH="$(dirname "$CLAUDE_BIN"):$PATH"; fi
export PATH
unset _dir

abspath() { case "$1" in /*) printf '%s' "$1" ;; *) printf '%s/%s' "$MODIO_ROOT" "${1#./}" ;; esac; }

SITES_DIR="$(abspath "${SITES_DIR:-./sites}")"
ARCHIVE_DIR="$(abspath "${ARCHIVE_DIR:-./archive}")"
JOBS_DIR="$(abspath "${JOBS_DIR:-./jobs}")"
STATE_DIR="$(abspath "${STATE_DIR:-./state}")"
LOG_DIR="$MODIO_ROOT/logs"
mkdir -p "$SITES_DIR" "$ARCHIVE_DIR" "$JOBS_DIR" "$STATE_DIR" "$LOG_DIR"

# Git-Identität nur für diesen Prozess (kommt aus .env).
export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-Modio}"
export GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-modio@localhost}"
export GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-$GIT_AUTHOR_NAME}"
export GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-$GIT_AUTHOR_EMAIL}"
export GIT_TERMINAL_PROMPT=0

LOG_FILE="$LOG_DIR/$SCRIPT_NAME.log"

log() {
  local msg
  msg="$(date '+%Y-%m-%d %H:%M:%S') [$SCRIPT_NAME] $*"
  printf '%s\n' "$msg" >&2
  printf '%s\n' "$msg" >>"$LOG_FILE"
}

# Gibt eine JSON-Zeile auf stdout aus. Argumente: key value [key value …]
# Werte werden als String übernommen; mit Präfix "json:" als rohes JSON.
emit() {
  local args=() key val
  while (($#)); do
    key="$1"; val="${2-}"; shift 2 || shift $#
    if [[ "$val" == json:* ]]; then
      args+=(--argjson "$key" "${val#json:}")
    else
      args+=(--arg "$key" "$val")
    fi
  done
  jq -cn "${args[@]}" '$ARGS.named'
}

# Gibt rohes JSON kompakt als eine Zeile aus.
emit_json() { jq -c . <<<"$1"; }

die() {
  local code="${2:-1}"
  log "FEHLER: $1"
  emit status error error "$1" >&1
  exit "$code"
}

usage() { die "Aufruf: $*" 2; }

require_cmd() {
  local c
  for c in "$@"; do command -v "$c" >/dev/null 2>&1 || die "Benötigtes Programm fehlt: $c"; done
}

valid_slug() { [[ "$1" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]]; }

valid_annotation_id() { [[ "$1" =~ ^A-[0-9]{3,}$ ]]; }

# Setzt SLUG und SITE und prüft, ob die Website existiert.
require_site() {
  SLUG="${1:-}"
  [[ -n "$SLUG" ]] || usage "$SCRIPT_NAME.sh <slug> …"
  valid_slug "$SLUG" || die "Ungültiger Slug: $SLUG" 2
  SITE="$SITES_DIR/$SLUG"
  [[ -d "$SITE/.git" ]] || die "Website nicht gefunden: $SLUG"
}

# Erzeugt aus einer URL einen Slug (Host ohne www., Punkte zu Bindestrichen).
slug_from_url() {
  local host
  host="$(url_host "$1")"
  host="${host#www.}"
  printf '%s' "$host" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g' | cut -c1-63
}

url_host() { printf '%s' "$1" | sed -E 's#^[a-zA-Z][a-zA-Z0-9+.-]*://##; s#^[^@/]*@##; s#[:/?\#].*$##' | tr '[:upper:]' '[:lower:]'; }

valid_http_url() { [[ "$1" =~ ^https?://[^[:space:]]+$ ]]; }

git_site() { git -C "$SITE" "$@"; }

# ----- .state.json (Laufzeitzustand, nicht versioniert) -----

state_file() { printf '%s/.state.json' "$SITE"; }

# Nächste freie Annotationsnummer: höher als Zähler und als jede vorhandene annotations/A-xxx.json
next_annotation_number() {
  local c max
  c="$(state_get counter)"; c="${c:-0}"
  max="$(ls "$SITE/annotations" 2>/dev/null | sed -nE 's/^A-0*([0-9]+)\.json$/\1/p' | sort -n | tail -1)"; max="${max:-0}"
  echo $(( c > max ? c + 1 : max + 1 ))
}

state_get() {
  local f; f="$(state_file)"
  [[ -f "$f" ]] || { printf ''; return; }
  jq -r --arg k "$1" '.[$k] // empty' "$f"
}

# state_set key value  (value als JSON, z. B. '"abc"', 5, null)
state_set() {
  local f tmp; f="$(state_file)"
  [[ -f "$f" ]] || printf '{}' >"$f"
  tmp="$(mktemp "$SITE/.state.XXXXXX")"
  jq --arg k "$1" --argjson v "$2" '.[$k] = $v' "$f" >"$tmp" && mv "$tmp" "$f"
}

now_iso() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

trap 'rc=$?; if (( rc != 0 && rc != 3 )); then log "Abbruch mit Exit-Code $rc (Zeile $LINENO)"; fi' EXIT
