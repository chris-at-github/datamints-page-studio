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

# .env füllt nur, was nicht schon gesetzt ist: ausdrücklich übergebene Werte (z. B. CLAUDE_EFFORT=max ./scripts/…) gewinnen
if [[ -f "$MODIO_ROOT/.env" ]]; then
  _modio_preset="$(export -p)"
  set -a
  # shellcheck disable=SC1091
  source "$MODIO_ROOT/.env"
  set +a
  eval "$_modio_preset" 2>/dev/null || true
  unset _modio_preset
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

valid_draft_id() { [[ "$1" =~ ^D-[0-9]{3,}$ ]]; }

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

# Nächste freie Entwurfsnummer: höher als Zähler und als jeder vorhandene drafts/D-xxx
next_draft_number() {
  local c max
  c="$(state_get draftCounter)"; c="${c:-0}"
  max="$( (ls "$SITE/drafts" 2>/dev/null || true) | sed -nE 's/^D-0*([0-9]+)$/\1/p' | sort -n | tail -1)"; max="${max:-0}"
  echo $(( c > max ? c + 1 : max + 1 ))
}

# drafts/ ist nicht versioniert; ältere Abzüge einmalig nachrüsten (eigener Commit nur für .gitignore)
ensure_drafts_ignored() {
  grep -qxF 'drafts/' "$SITE/.gitignore" 2>/dev/null && return 0
  printf 'drafts/\n' >>"$SITE/.gitignore"
  git_site add -- .gitignore
  git_site commit -q -m "[design] Entwürfe (drafts/) nicht versionieren" -- .gitignore
  log "$SLUG: drafts/ in .gitignore aufgenommen"
}

# Status eines Entwurfs: discarded, applied (Schritt liegt im aktuellen Stand) oder open.
# "applied" ergibt sich aus dem Abzug: nach Verwerfen der Prüfung oder einem Rücksprung ist er wieder offen.
draft_status() {
  local f="$SITE/drafts/$1/draft.json" a
  [[ -f "$f" ]] || { echo missing; return; }
  [[ "$(jq -r .status "$f")" == "discarded" ]] && { echo discarded; return; }
  a="$(jq -r '.appliedAs // ""' "$f")"
  if [[ -n "$a" && -f "$SITE/annotations/$a.json" ]]; then echo applied; else echo open; fi
}

# ----- Claude-Aufrufe: Anmeldung, Modell, Effort -----
# CLAUDE_AUTH=konto (Standard): Anmeldung per Claude-Konto (Abo); ANTHROPIC_API_KEY wird dem Aufruf entzogen,
#   damit sicher über das Konto abgerechnet wird.
# CLAUDE_AUTH=api: Anmeldung per API-Schlüssel (ANTHROPIC_API_KEY oder apiKeyHelper in den Claude-Einstellungen),
#   Aufruf mit --bare. Alte Schreibweise CLAUDE_BARE=true wird als api verstanden.
# CLAUDE_MODEL (Standard Opus) und CLAUDE_EFFORT (Standard high: low|medium|high|xhigh|max) gelten für alle Läufe;
# DRAFT_MODEL und DRAFT_EFFORT können Entwürfe abweichend einstellen.
DEFAULT_CLAUDE_MODEL="claude-opus-5-5"
claude_auth_mode() {
  local m="${CLAUDE_AUTH:-}"
  if [[ -z "$m" ]]; then [[ "${CLAUDE_BARE:-false}" == "true" ]] && m=api || m=konto; fi
  printf '%s' "$m"
}
claude_effort() {
  local e="${1:-${CLAUDE_EFFORT:-high}}"
  case "$e" in low|medium|high|xhigh|max) printf '%s' "$e" ;; *) die "Ungültiger Effort: $e (erlaubt: low, medium, high, xhigh, max)" ;; esac
}
# Prüft die Anmeldung und füllt CLAUDE_AUTH_ARGS (Optionen für claude) und CLAUDE_ENV_UNSET (Optionen für env).
# Aufruf: claude_auth_setup <claude-settings.json>
claude_auth_setup() {
  local settings="$1" mode
  mode="$(claude_auth_mode)"
  CLAUDE_ENV_UNSET=(-u MODIO_API_TOKEN -u CRAWL_HTTP_PASSWORD -u CRAWL_HTTP_USER)
  case "$mode" in
    api)
      if [[ -z "${ANTHROPIC_API_KEY:-}" ]] && ! jq -e '.apiKeyHelper' "$settings" >/dev/null 2>&1; then
        die "CLAUDE_AUTH=api braucht ANTHROPIC_API_KEY in der .env oder einen apiKeyHelper in $settings (Anmeldung per Claude-Konto: CLAUDE_AUTH=konto)"
      fi
      CLAUDE_AUTH_ARGS=(--bare) ;;
    konto)
      CLAUDE_ENV_UNSET+=(-u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN)
      # globale Einstellungen, MCP-Server und Skills nicht mitladen
      CLAUDE_AUTH_ARGS=(--setting-sources project,local --disable-slash-commands) ;;
    *) die "Ungültiger Wert CLAUDE_AUTH=$mode (konto oder api)" ;;
  esac
}
claude_is_api() { [[ "$(claude_auth_mode)" == "api" ]]; }

# Systemprompt für Claude-Läufe zusammensetzen: Grundregeln (z. B. DRAFT.md oder CLAUDE.md bei --bare),
# optional die Gestaltungsleitlinien aus templates/CLAUDE.md (für Entwürfe; bei Annotationen stehen sie schon
# in der CLAUDE.md des Abzugs) und – falls vorhanden – der Skill „frontend-design“.
# DESIGN_SKILL_FILE in der .env überschreibt den Pfad; leer gesetzt schaltet den Skill ab.
# Aufruf: build_system_prompt <ziel> [grundregeln-datei] [--leitlinien]
DEFAULT_DESIGN_SKILL="$HOME/.claude/plugins/marketplaces/claude-plugins-official/plugins/frontend-design/skills/frontend-design/SKILL.md"
build_system_prompt() {
  local out="$1" base="${2:-}" guide="${3:-}" skill="${DESIGN_SKILL_FILE-$DEFAULT_DESIGN_SKILL}"
  {
    if [[ -n "$base" && -f "$base" ]]; then cat "$base"; printf '\n\n'; fi
    if [[ "$guide" == "--leitlinien" ]]; then
      # Abschnitt „## Gestaltungsleitlinien …“ bis zur nächsten Überschrift der Ebene 2
      awk '/^## Gestaltungsleitlinien/ {on=1} on && /^## / && !/^## Gestaltungsleitlinien/ {exit} on' "$MODIO_ROOT/templates/CLAUDE.md"
    fi
    if [[ -n "$skill" && -f "$skill" ]]; then
      printf '\n\n# Skill „frontend-design“ (nachrangig, siehe Rangfolge in den Gestaltungsleitlinien)\n\n'
      # Frontmatter weglassen
      awk 'NR==1 && /^---$/ {fm=1; next} fm && /^---$/ {fm=0; next} !fm' "$skill"
    fi
  } >"$out"
  if [[ -n "$skill" && ! -f "$skill" ]]; then log "Hinweis: Skill-Datei nicht gefunden ($skill), Lauf ohne Skill"; fi
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
