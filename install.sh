#!/usr/bin/env bash
# Einrichtung von datamints Page Studio auf einem neuen Rechner (WSL2/Linux).
# Prüft die Voraussetzungen, installiert die Node-Pakete und den Playwright-Browser
# und legt die .env mit einem zufälligen API-Token an. Mehrfach ausführbar.
# Aufruf: ./install.sh
set -euo pipefail

DPS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DPS_ROOT"
# shellcheck source=scripts/lib/node-env.sh
source scripts/lib/node-env.sh

ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; MISSING=$((MISSING + 1)); }
MISSING=0

echo "Voraussetzungen"
if command -v node >/dev/null && node_version_ok "$(command -v node)"; then ok "Node.js $(node -v)"
else bad "Node.js ≥ $DPS_NODE_MIN fehlt (z. B. über nvm: nvm install $(tr -d ' \n\r' <.nvmrc))"; fi
command -v npm >/dev/null && ok "npm $(npm -v)" || bad "npm fehlt"
for c in git wget curl jq file openssl; do
  command -v "$c" >/dev/null && ok "$c" || bad "$c fehlt (sudo apt install $c)"
done
if command -v ddev >/dev/null; then
  v="$(ddev --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
  if [[ -n "$v" ]] && [[ "$(printf '%s\n1.24.3\n' "$v" | sort -V | head -1)" != 1.24.3 ]]; then warn "DDEV $v ist älter als 1.24.3 – bitte aktualisieren"
  else ok "DDEV ${v:-?}"; fi
else bad "DDEV fehlt (https://ddev.readthedocs.io/en/stable/users/install/)"; fi
if command -v "${CLAUDE_BIN:-claude}" >/dev/null; then ok "Claude Code ($("${CLAUDE_BIN:-claude}" --version 2>/dev/null | head -1))"
else bad "Claude Code fehlt (https://docs.claude.com/claude-code) – danach einmal 'claude' starten und anmelden"; fi
if (( MISSING > 0 )); then
  echo; echo "$MISSING Voraussetzung(en) fehlen. Bitte nachinstallieren und ./install.sh erneut ausführen." >&2
  exit 1
fi

echo; echo "Node-Pakete"
npm install --no-fund --no-audit
ok "npm install"

echo; echo "Browser für Sichtprüfung und Tests (Playwright Chromium)"
if ./node_modules/.bin/playwright install chromium; then ok "Chromium installiert"
else warn "Chromium nicht installiert – Sichtprüfung wird übersprungen. Fehlen Systembibliotheken: sudo ./node_modules/.bin/playwright install-deps chromium"; fi

echo; echo "Einstellungen"
if [[ -f .env ]]; then
  ok ".env vorhanden (unverändert)"
else
  cp .env.example .env
  sed -i "s|<zufälliger Wert[^>]*>|$(openssl rand -hex 32)|" .env
  ok ".env aus .env.example angelegt"
fi
if grep -q '<zufälliger Wert' .env; then bad "DPS_API_TOKEN in .env noch nicht gesetzt"; exit 1; fi
grep -q '^DPS_API_TOKEN=..' .env && ok "DPS_API_TOKEN gesetzt" || { bad "DPS_API_TOKEN fehlt in .env"; exit 1; }
mkdir -p sites archive jobs/assets state logs
ok "Arbeitsordner angelegt"

name="$(sed -n 's/^name: *//p' .ddev/config.yaml)"
cat <<EOF

Fertig. Nächste Schritte:
  1. ddev start                 # Bridge-Server im Container
  2. npm run worker             # Worker in der WSL, eigenes Terminal, läuft dauerhaft
  3. https://$name.ddev.site:3443 im Browser öffnen

Optional: npm test (Skripttests, ca. 2–3 Minuten).
EOF
