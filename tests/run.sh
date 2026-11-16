#!/usr/bin/env bash
# Phase-1-Test: kompletter Ablauf per Kommandozeile gegen eine lokale Testseite.
# Startet einen lokalen Webserver für tests/fixture/site, legt die Website "modio-test" an
# und prüft Commit, Prüfung (check-diff), Verwerfen, Rücksprung, Verlauf, Report und Neu einlesen.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# dieselbe Node-Version wie die Skripte (auch ohne geladenes nvm)
MODIO_ROOT="$ROOT"
# shellcheck source=../scripts/lib/node-env.sh
source scripts/lib/node-env.sh
node_version_ok "$(command -v node)" || { echo "Node.js ab $MODIO_NODE_MIN nötig, gefunden: $(node -v 2>/dev/null)" >&2; exit 1; }
SLUG=modio-test
PORT="${TEST_PORT:-8765}"
S="sites/$SLUG"
PASS=0; FAIL=0
ok() { printf '  \e[32m✓\e[0m %s\n' "$1"; PASS=$((PASS + 1)); }
ko() { printf '  \e[31m✗\e[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }
check() { if eval "$2"; then ok "$1"; else ko "$1"; fi; }

SERVER_PID=""
if ! curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then
  python3 -m http.server "$PORT" --bind 127.0.0.1 --directory tests/fixture/site >/dev/null 2>&1 &
  SERVER_PID=$!
  for _ in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.3; done
fi
cleanup() { [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null; [[ -n "${SRV_PID:-}" ]] && kill "$SRV_PID" 2>/dev/null; [[ -n "${TEST_JOBS_DIR:-}" ]] && rm -rf "$TEST_JOBS_DIR"; rm -rf "$S" "sites/modio-test-neu"; rm -rf archive/"$SLUG"-*; ./scripts/site-list.sh >/dev/null 2>&1 || true; }
trap cleanup EXIT
rm -rf "$S"

echo "Neue Website"
OUT="$(./scripts/site-new.sh "http://127.0.0.1:$PORT/" "$SLUG" 2>/dev/null)"
check "site-new.sh meldet ok" '[[ "$(jq -r .status <<<"$OUT")" == ok ]]'
ENTRY="$(jq -r .entry <<<"$OUT")"
P="$S/www$ENTRY"
check "Einstiegsseite vorhanden" '[[ -f "$P" ]]'
check "Tag baseline gesetzt" 'git -C "$S" rev-parse -q --verify baseline >/dev/null'
check "Tracking-Script entfernt" '! grep -q googletagmanager "$P"'
check "Inline-Tracking-Loader entfernt" '! grep -q tracker.example.net "$P"'
check "Fremdes iframe entfernt" '! grep -q "<iframe" "$P"'
check "Eigenes Script bleibt" 'grep -q "js/app.js" "$P"'
check "JSON-LD bleibt" 'grep -q "application/ld+json" "$P"'
check "integrity-Attribut entfernt" '! grep -q integrity "$P"'
check "CSP-Meta entfernt" '! grep -qi content-security-policy "$P"'
check "design/ in der Baseline" 'git -C "$S" cat-file -e baseline:design/tokens.json && git -C "$S" cat-file -e baseline:design/tokens.css && git -C "$S" cat-file -e baseline:design/notes.md'
check "Token-Scan geschrieben" '[[ -f "$S/.scan.json" ]] && jq -e ".colors | length > 0" "$S/.scan.json" >/dev/null'
LT="$(mktemp -d)"; mkdir -p "$LT/design"
printf '%s' '{"ansichten":[{"width":1440,"element":{"x":240,"w":960},"inner":null},{"width":390,"element":{"x":15,"w":360},"inner":null}]}' >"$LT/layout.json"
LT1="$(bash -c 'source scripts/lib/common.sh; source scripts/lib/draft-layout.sh; SITE="$1"; DDIR="$1"; draft_layout_text' _ "$LT")"
printf '%s' '{"tokens":{"container.max-width":{"value":"960px","locked":true},"container.spacing-x":{"value":"15px","locked":true}}}' >"$LT/design/tokens.json"
LT2="$(bash -c 'source scripts/lib/common.sh; source scripts/lib/draft-layout.sh; SITE="$1"; DDIR="$1"; draft_layout_text' _ "$LT")"
printf '%s' '{"ansichten":[{"width":1440,"element":{"x":0,"w":1440},"inner":{"x":240,"w":960}},{"width":390,"element":{"x":0,"w":390},"inner":{"x":0,"w":390}}]}' >"$LT/layout.json"
LT3="$(bash -c 'source scripts/lib/common.sh; source scripts/lib/draft-layout.sh; SITE="$1"; DDIR="$1"; draft_layout_text' _ "$LT")"
rm -rf "$LT"
check "Raster-Satz: Pixel ohne Tokens, Tokens wenn vorhanden, volle Breite ohne Rand" '[[ "$LT1" == "Das Element liegt in der Inhaltsbreite: höchstens 960 px. Auf schmalen Bildschirmen 15 px Rand je Seite." ]] && grep -q "höchstens var(--modio-container-max-width) (960px)" <<<"$LT2" && grep -q "var(--modio-container-spacing-x) (15px)" <<<"$LT2" && grep -q "volle Breite; Texte und Bedienelemente bleiben innerhalb von var(--modio-container-max-width)" <<<"$LT3" && grep -q "ohne Seitenrand" <<<"$LT3"'
check "Token-Kategorie container gültig, Container-Werte aus dem Scan übernehmbar" 'node --input-type=module -e "import { validateTokens } from \"./scripts/lib/design.mjs\"; const r = validateTokens({tokens:{\"container.max-width\":{value:\"960px\"},\"container.spacing-x\":{value:\"15px\"}}}); process.exit(r.errors.length ? 1 : 0)"' 

echo "Manuelle Änderung und Commit"
sed -i 's/Willkommen bei Testfirma/Ihr Partner für gute Dinge/' "$P"
printf '/* A-001: Headline größer */\n.hero__title {\n  font-size: 48px;\n}\n' >>"$S/overrides.css"
jq -n --arg page "$ENTRY" '{id:"A-001", prompt:"Headline \"Nutzen\" & größer", page:$page, selector:"h1.hero__title", result:{summary:"Headline geändert."}}' >"$S/annotations/A-001.json"
OUT="$(./scripts/commit-step.sh "$SLUG" A-001 2>/dev/null)"
check "commit-step.sh committet" '[[ "$(jq -r .status <<<"$OUT")" == committed ]]'
check "Commit-Nachricht mit Sonderzeichen" '[[ "$(git -C "$S" log -1 --format=%s)" == "[A-001] Headline \"Nutzen\" & größer" ]]'

echo "Prüfung durch check-diff.sh"
sed -i 's#</footer>#</footer><script src="https://cdn.unbekannt-test.example/x.js"></script><button onclick="go()">x</button>#' "$P"
set +e; OUT="$(./scripts/commit-step.sh "$SLUG" A-002 2>/dev/null)"; rc=$?; set -e
check "Exit-Code 3 bei Treffern" '(( rc == 3 ))'
check "Treffer script-tag" 'jq -e ".hits | map(.rule) | index(\"script-tag\")" <<<"$OUT" >/dev/null'
check "Treffer event-handler" 'jq -e ".hits | map(.rule) | index(\"event-handler\")" <<<"$OUT" >/dev/null'
check "Treffer unknown-domain" 'jq -e ".hits | map(.rule) | index(\"unknown-domain\")" <<<"$OUT" >/dev/null'
check "Kein Commit bei Treffern" '[[ "$(git -C "$S" log -1 --format=%s)" == \[A-001\]* ]]'
./scripts/discard-step.sh "$SLUG" >/dev/null 2>&1
check "discard-step.sh verwirft alles" '[[ -z "$(git -C "$S" status --porcelain)" ]]'

echo "Pfad außerhalb und --accept"
echo "x" >>"$S/urls.txt"
set +e; OUT="$(./scripts/check-diff.sh "$SLUG" 2>/dev/null)"; rc=$?; set -e
check "Änderung an urls.txt erkannt" '(( rc == 3 )) && jq -e ".hits[0].rule == \"path-outside\"" <<<"$OUT" >/dev/null'
./scripts/discard-step.sh "$SLUG" >/dev/null 2>&1
sed -i 's#</footer>#</footer><a href="https://partner-neu.example/">Partner</a>#' "$P"
OUT="$(./scripts/commit-step.sh "$SLUG" A-002 --accept 2>/dev/null)"
check "--accept committet trotz Treffer" '[[ "$(jq -r .status <<<"$OUT")" == committed ]]'

echo "Zweiter Schritt, Verlauf und Rücksprung"
sed -i 's/Wir machen Dinge./Wir machen sehr gute Dinge./' "$P"
echo '{"id":"A-003","prompt":"Text verbessern"}' >"$S/annotations/A-003.json"
./scripts/commit-step.sh "$SLUG" A-003 >/dev/null 2>&1
OUT="$(./scripts/history.sh "$SLUG" 2>/dev/null)"
check "Verlauf mit 3 Schritten" '[[ "$(jq ".steps | length" <<<"$OUT")" == 3 ]]'
check ".history.json geschrieben" '[[ -f "$S/.history.json" ]]'
OUT="$(./scripts/rollback.sh "$SLUG" A-001 2>/dev/null)"
check "Rücksprung auf A-001" '! grep -q "sehr gute Dinge" "$P" && grep -q "gute Dinge" "$P"'
check "Tag verworfen/* gesetzt" '[[ -n "$(git -C "$S" tag -l "verworfen/*")" ]]'
check "Session-ID gelöscht" '[[ "$(jq -r .sessionId "$S/.state.json")" == null ]]'

echo "Keine Änderung"
echo '{"id":"A-004","prompt":"nichts"}' >"$S/annotations/A-004.json"
OUT="$(./scripts/commit-step.sh "$SLUG" A-004 2>/dev/null)"
check "Status nochange" '[[ "$(jq -r .status <<<"$OUT")" == nochange ]]'
check "Annotation-Datei aufgeräumt" '[[ ! -f "$S/annotations/A-004.json" ]]'

echo "Design-Vorgaben von Hand (design-save.sh)"
DS="$(mktemp)"
jq -n '{tokens:{"color.primary":{value:"#0B5FA5",locked:true,note:"Primärfarbe"},"radius.button":{value:"8px",locked:true}}, notes:"# Regeln\n- Du-Ansprache\n"}' >"$DS"
OUT="$(./scripts/design-save.sh "$SLUG" "$DS" 2>/dev/null)"
check "design-save.sh committet" '[[ "$(jq -r .status <<<"$OUT")" == committed ]] && [[ "$(git -C "$S" log -1 --format=%s)" == "[design] Design-Vorgaben angepasst" ]]'
check "tokens.css erzeugt" 'grep -q -- "--modio-color-primary: #0B5FA5;" "$S/design/tokens.css"'
jq -n '{tokens:{"color.bad":{value:"url(https://evil.example/x)",locked:false}}}' >"$DS"
set +e; OUT="$(./scripts/design-save.sh "$SLUG" "$DS" 2>/dev/null)"; rc=$?; set -e
check "Wert mit url( abgelehnt" '(( rc == 3 )) && grep -q "url(" <<<"$OUT" && [[ -z "$(git -C "$S" status --porcelain)" ]]'
OUT="$(./scripts/history.sh "$SLUG" 2>/dev/null)"
check "Verlauf führt [design]-Commit" 'jq -e ".steps | map(.kind) | index(\"design\")" <<<"$OUT" >/dev/null'

echo "Prüfungen der Design-Vorgaben (check-diff.sh)"
ann() { jq -n --arg id "$1" --argjson extra "${2:-{\}}" '{id:$id, prompt:"Test"} + $extra' >"$S/annotations/$1.json"; }
ann A-010
jq '.tokens["color.primary"].value = "#ff0000"' "$S/design/tokens.json" >"$DS" && cp "$DS" "$S/design/tokens.json"
set +e; OUT="$(./scripts/commit-step.sh "$SLUG" A-010 2>/dev/null)"; rc=$?; set -e
check "Gesperrter Token geändert: Prüfung nötig" '(( rc == 3 )) && jq -e ".hits | map(.rule) | index(\"token-locked\")" <<<"$OUT" >/dev/null'
ann A-010 '{"allow_token_change":true}'
set +e; OUT="$(./scripts/check-diff.sh "$SLUG" A-010 2>/dev/null)"; rc=$?; set -e
check "Mit allow_token_change erlaubt" '(( rc == 0 ))'
./scripts/discard-step.sh "$SLUG" >/dev/null 2>&1
ann A-011
printf -- '- Header auf allen Seiten gleich\n' >>"$S/design/notes.md"
set +e; OUT="$(./scripts/check-diff.sh "$SLUG" A-011 2>/dev/null)"; rc=$?; set -e
check "notes.md ohne remember: Prüfung nötig" '(( rc == 3 )) && jq -e ".hits | map(.rule) | index(\"notes-without-remember\")" <<<"$OUT" >/dev/null'
ann A-011 '{"remember":true}'
set +e; OUT="$(./scripts/check-diff.sh "$SLUG" A-011 2>/dev/null)"; rc=$?; set -e
check "notes.md mit remember erlaubt" '(( rc == 0 ))'
printf -- '- Siehe https://example.org/regeln\n' >>"$S/design/notes.md"
set +e; OUT="$(./scripts/check-diff.sh "$SLUG" A-011 2>/dev/null)"; rc=$?; set -e
check "URL in notes.md: Prüfung nötig" '(( rc == 3 )) && jq -e ".hits | map(.rule) | index(\"notes-content\")" <<<"$OUT" >/dev/null'
./scripts/discard-step.sh "$SLUG" >/dev/null 2>&1
ann A-012
printf '  --modio-x: red;\n' >>"$S/design/tokens.css"
set +e; OUT="$(./scripts/check-diff.sh "$SLUG" A-012 2>/dev/null)"; rc=$?; set -e
check "tokens.css von Hand geändert: Prüfung nötig" '(( rc == 3 )) && jq -e ".hits | map(.rule) | index(\"tokens-css-manual\")" <<<"$OUT" >/dev/null'
./scripts/discard-step.sh "$SLUG" >/dev/null 2>&1

echo "Hinweise (warn) und tokens-build beim Commit"
ann A-013
jq '.tokens["color.accent"] = {value:"#e8590c", locked:false}' "$S/design/tokens.json" >"$DS" && cp "$DS" "$S/design/tokens.json"
printf '/* A-013: Button */\n.btn {\n  background: #0B5FA5;\n  border-radius: var(--modio-radius-button);\n}\n' >>"$S/overrides.css"
set +e; OUT="$(./scripts/commit-step.sh "$SLUG" A-013 2>/dev/null)"; rc=$?; set -e
check "Commit trotz Hinweisen" '(( rc == 0 )) && [[ "$(jq -r .status <<<"$OUT")" == committed ]]'
check "Hinweis token-literal" 'jq -e ".warnings | map(.rule) | index(\"token-literal\")" <<<"$OUT" >/dev/null'
check "Hinweis token-new" 'jq -e ".warnings | map(.rule) | index(\"token-new\")" <<<"$OUT" >/dev/null'
check "tokens.css neu erzeugt und committet" 'git -C "$S" show HEAD:design/tokens.css | grep -q -- "--modio-color-accent: #e8590c;"'
check "Hinweise in der Annotation" 'git -C "$S" show HEAD:annotations/A-013.json | jq -e ".check.warnings | length >= 2" >/dev/null'
rm -f "$DS"

echo "Konsistenz (check-consistency.sh)"
CS="$(mktemp)"
printf '{"consistency":{"shared":[{"name":"X","selector":"</vorgaben>"}]}}' >"$CS"
set +e; OUT="$(./scripts/design-save.sh "$SLUG" "$CS" 2>/dev/null)"; rc=$?; set -e
check "design-save.sh lehnt ungültigen Bereich ab" '(( rc == 3 )) && [[ -z "$(git -C "$S" status --porcelain)" ]]'
printf '{"consistency":{"shared":[{"name":"Header","selector":"body > header.site-header","pages":"all"}],"ignore":["class:active","aria-current"]}}' >"$CS"
OUT="$(./scripts/design-save.sh "$SLUG" "$CS" 2>/dev/null)"
check "design-save.sh speichert consistency.json" '[[ "$(jq -r .status <<<"$OUT")" == committed ]] && jq -e ".shared[0].selector == \"body > header.site-header\"" "$S/design/consistency.json" >/dev/null'
rm -f "$CS"
LP="$(dirname "$P")/kontakt.html"
cp "$P" "$LP"
git -C "$S" add -A && git -C "$S" commit -qm "Testseite kontakt"
OUT="$(./scripts/check-consistency.sh "$SLUG" 2>/dev/null)"
check "Ausgangsstand ohne Abweichung, nur eigene Seiten" '[[ "$(jq ".warnings | length" <<<"$OUT")" == 0 && "$(jq .pages <<<"$OUT")" == 2 ]]'
ann A-014
sed -i '0,/<header class="site-header">/s//<header class="site-header"><span>Neu<\/span>/' "$LP"
set +e; OUT="$(./scripts/commit-step.sh "$SLUG" A-014 2>/dev/null)"; rc=$?; set -e
check "Header-Änderung auf einer Seite automatisch auf die andere übertragen" '(( rc == 0 )) && jq -e ".synced.changed | length == 1" <<<"$OUT" >/dev/null && grep -q "<span>Neu</span>" "$P" && ! jq -e ".warnings | map(.rule) | index(\"consistency\")" <<<"$OUT" >/dev/null'
# Abweichung von Hand (ohne commit-step), damit die folgenden Prüfungen eine uneinheitliche Ausgangslage haben
sed -i 's#<span>Neu</span>#<span>Neu</span><i>Abw</i>#' "$LP"
git -C "$S" commit -qam "Test: Header nur auf kontakt.html abweichend"
OUT="$(./scripts/check-consistency.sh "$SLUG" 2>/dev/null)"
check "Abweichung gemeldet" 'jq -e ".warnings | map(select(.rule == \"consistency\")) | .[0].text | test(\"Header ist nicht auf allen Seiten gleich\")" <<<"$OUT" >/dev/null'
ann A-015
printf '<!-- x -->\n' >>"$LP"
set +e; OUT="$(./scripts/commit-step.sh "$SLUG" A-015 2>/dev/null)"; rc=$?; set -e
check "Bestehende Abweichung nicht erneut gemeldet" '(( rc == 0 )) && ! jq -e ".warnings | map(.rule) | index(\"consistency\")" <<<"$OUT" >/dev/null'
ann A-016
printf '{"shared":[],"ignore":[]}\n' >"$S/design/consistency.json"
set +e; OUT="$(./scripts/check-diff.sh "$SLUG" A-016 2>/dev/null)"; rc=$?; set -e
check "consistency.json ohne remember: Prüfung nötig" '(( rc == 3 )) && jq -e ".hits | map(.rule) | index(\"consistency-changed\")" <<<"$OUT" >/dev/null'
./scripts/discard-step.sh "$SLUG" >/dev/null 2>&1
CTX="$(./scripts/context.sh "$SLUG" A-020 2>/dev/null | jq -r .context)"
check "Gleiche Bereiche im Kontext" 'grep -q "<gleiche-bereiche" <<<"$CTX" && grep -q "Header: body > header.site-header (alle Seiten)" <<<"$CTX"'

echo "Seiten hinzufügen (pages-add.sh)"
PA="$(mktemp)"
printf 'http://127.0.0.1:%s/leistungen/\nhttp://127.0.0.1:%s/\nhttps://example.org/fremd\nhttp://127.0.0.1:%s/fehlt.html\n' "$PORT" "$PORT" "$PORT" >"$PA"
cp "$P" "$S/../pa-before.html"
OUT="$(./scripts/pages-add.sh "$SLUG" "$PA" 2>/dev/null)"
check "Seite hinzugefügt und committet" '[[ "$(jq -r .status <<<"$OUT")" == committed ]] && jq -e ".added | length == 1" <<<"$OUT" >/dev/null && [[ "$(git -C "$S" log -1 --format=%s)" == "[seiten] 1 Seite(n) hinzugefügt" ]]'
check "Fremde Domain abgelehnt, Duplikat und Fehler erkannt" 'jq -e ".rejected == [\"https://example.org/fremd\"] and (.duplicate | length) == 1 and (.failed | length) == 1" <<<"$OUT" >/dev/null'
check "urls.txt ergänzt" 'grep -qx "http://127.0.0.1:$PORT/leistungen/" "$S/urls.txt"'
check "Link auf neue Seite lokal umgeschrieben" 'grep -q "href=\"leistungen/index.html\"" "$P"'
check "Bisherige Änderungen an vorhandenen Seiten erhalten" '[[ "$(sed "s#href=\"leistungen/index.html\"#X#; s#href=\"http://127.0.0.1:$PORT/leistungen/\"#X#" "$P")" == "$(sed "s#href=\"leistungen/index.html\"#X#; s#href=\"http://127.0.0.1:$PORT/leistungen/\"#X#" "$S/../pa-before.html")" ]]'
check "Schritte bleiben im Verlauf" '[[ "$(./scripts/history.sh "$SLUG" 2>/dev/null | jq "[.steps[] | select(.kind == \"annotation\")] | length")" -ge 3 ]] && ./scripts/history.sh "$SLUG" 2>/dev/null | jq -e ".steps[-1].kind == \"pages\"" >/dev/null'
rm -f "$PA" "$S/../pa-before.html"
check "Uneinheitlicher Header nicht automatisch übernommen" 'jq -e ".areas.unclear | index(\"Header\")" <<<"$OUT" >/dev/null'

echo "Bereiche angleichen (areas-sync.sh)"
LS="$(dirname "$P")/leistungen/index.html"
sed -i 's#<a href="../index.html">Start</a>#<a href="../index.html" class="active">Start</a>#' "$LS"
git -C "$S" commit -qam "Test: aktiver Menüpunkt"
OUT="$(./scripts/areas-sync.sh "$SLUG" "/$(basename "$(dirname "$P")")/kontakt.html" 2>/dev/null)"
check "Header von kontakt.html auf alle Seiten übernommen" '[[ "$(jq -r .status <<<"$OUT")" == committed ]] && grep -q "<span>Neu</span>" "$P" && grep -q "<span>Neu</span>" "$LS" && [[ "$(git -C "$S" log -1 --format=%s)" == "[angleichen] Header von "* ]]'
check "Links an Ordnertiefe angepasst" 'grep -q "href=\"../leistungen/index.html\"" "$LS" || grep -q "href=\"index.html\">Leistungen" "$LS"'
check "Aktiver Menüpunkt der Zielseite erhalten" 'grep -q "<a href=\"../index.html\" class=\"active\">Start</a>" "$LS" && ! grep -q "class=\"active\"" "$P"'
check "Danach keine Header-Abweichung" '! ./scripts/check-consistency.sh "$SLUG" 2>/dev/null | jq -e ".warnings | map(select(.text | startswith(\"Header\"))) | length > 0" >/dev/null'
OUT="$(./scripts/areas-sync.sh "$SLUG" "/$(basename "$(dirname "$P")")/index.html" --add Footer footer 2>/dev/null)"
check "Neuer Bereich aufgenommen, fehlender Footer gemeldet" 'jq -e ".added == true and (.skipped | map(.reason) | index(\"fehlt auf der Seite\"))" <<<"$OUT" >/dev/null && jq -e ".shared | map(.name) | index(\"Footer\")" "$S/design/consistency.json" >/dev/null'
set +e; OUT="$(./scripts/areas-sync.sh "$SLUG" "/$(basename "$(dirname "$P")")/index.html" --add X "<b>" 2>/dev/null)"; rc=$?; set -e
check "Ungültiger Selektor abgelehnt, nichts geändert" '(( rc != 0 )) && [[ -z "$(git -C "$S" status --porcelain)" ]]'
printf 'http://127.0.0.1:%s/team.html\n' "$PORT" >"$PA"
OUT="$(./scripts/pages-add.sh "$SLUG" "$PA" 2>/dev/null)"; rm -f "$PA"
TP="$(dirname "$P")/team.html"
check "Neue Seite übernimmt einheitlichen Header automatisch" 'jq -e ".areas.changed[0].areas | index(\"Header\")" <<<"$OUT" >/dev/null && grep -q "<span>Neu</span>" "$TP" && grep -q "© Testfirma" "$TP"'
ann A-017 "{\"page\":\"/$(basename "$(dirname "$P")")/index.html\"}"
sed -i 's#<span>Neu</span>#<span>Neu</span><em>Schritt</em>#' "$P"
OUT="$(./scripts/commit-step.sh "$SLUG" A-017 2>/dev/null)"
check "Schritt am Header wird automatisch auf alle Seiten übertragen" '[[ "$(jq -r .status <<<"$OUT")" == committed ]] && jq -e ".synced.changed | length == 3" <<<"$OUT" >/dev/null && grep -q "<em>Schritt</em>" "$LS" && grep -q "<em>Schritt</em>" "$TP" && grep -q "<a href=\"../index.html\" class=\"active\">Start</a>" "$LS"'
check "Übertragung im selben Commit, keine Konsistenzhinweise" '[[ -z "$(git -C "$S" status --porcelain)" ]] && git -C "$S" show --stat HEAD | grep -q "team.html" && ! jq -e ".warnings | map(.rule) | index(\"consistency\")" <<<"$OUT" >/dev/null'
ann A-018 "{\"page\":\"/$(basename "$(dirname "$P")")/index.html\"}"
sed -i 's#<em>Schritt</em>#<em>Eins</em>#' "$P"
sed -i 's#<em>Schritt</em>#<em>Zwei</em>#' "$LP"
OUT="$(./scripts/commit-step.sh "$SLUG" A-018 2>/dev/null)"
check "Unterschiedlich geändert: nicht übertragen, Hinweis" '[[ "$(jq -r .status <<<"$OUT")" == committed ]] && jq -e ".warnings | map(.rule) | index(\"areas-unclear\")" <<<"$OUT" >/dev/null && grep -q "<em>Schritt</em>" "$TP"'

echo "Lokale Änderungen und Inspektor (local-commit.sh, inspect-apply.sh)"
OUT="$(./scripts/local-commit.sh "$SLUG" 2>/dev/null)"
check "Ohne Änderungen: nochange" '[[ "$(jq -r .status <<<"$OUT")" == nochange ]]'
printf '\n.lokal { color: red; }\n' >>"$S/overrides.css"
OUT="$(./scripts/local-commit.sh "$SLUG" 2>/dev/null)"
LID="$(jq -r .annotationId <<<"$OUT")"
check "Lokale Änderung als Schritt übernommen" '[[ "$(jq -r .status <<<"$OUT")" == committed && "$LID" == A-* ]] && [[ "$(git -C "$S" log -1 --format=%s)" == "[$LID] Lokale Änderung übernommen" ]]'
printf '<script>alert(1)</script>\n' >>"$P"
set +e; OUT="$(./scripts/local-commit.sh "$SLUG" 2>/dev/null)"; rc=$?; set -e
check "Lokales Script: Prüfung nötig" '(( rc == 3 )) && jq -e ".hits | map(.rule) | index(\"script-tag\")" <<<"$OUT" >/dev/null'
./scripts/discard-step.sh "$SLUG" >/dev/null 2>&1
printf '<div class="mini">alt</div><script src="js/app.js"></script>\n' >>"$P"
git -C "$S" commit -qam "Test: minifizierte Zeile mit Script"
sed -i 's#<div class="mini">alt</div>#<div class="mini">neu</div>#' "$P"
set +e; OUT="$(./scripts/check-diff.sh "$SLUG" 2>/dev/null)"; rc=$?; set -e
check "Minifizierte Zeile: vorhandenes Script kein Treffer" '(( rc == 0 ))'
sed -i 's#<div class="mini">neu</div>#<div class="mini">neu</div><script>x()</script>#' "$P"
set +e; OUT="$(./scripts/check-diff.sh "$SLUG" 2>/dev/null)"; rc=$?; set -e
check "Minifizierte Zeile: neues Script erkannt" '(( rc == 3 )) && jq -e ".hits | map(.rule) | index(\"script-tag\")" <<<"$OUT" >/dev/null'
./scripts/discard-step.sh "$SLUG" >/dev/null 2>&1
IP="$(mktemp)"
jq -n --arg page "/$(basename "$(dirname "$P")")/index.html" '{page:$page, selector:"h1.hero__title", html:"<h1 class=\"hero__title\">Aus dem Inspektor</h1>", css:"color: rgb(1, 2, 3); font-size: 20px"}' >"$IP"
OUT="$(./scripts/inspect-apply.sh "$SLUG" "$IP" 2>/dev/null)"
IID="$(jq -r .annotationId <<<"$OUT")"
check "Inspektor-Änderung übernommen" '[[ "$(jq -r .status <<<"$OUT")" == committed ]] && grep -q "<h1 class=\"hero__title\">Aus dem Inspektor</h1>" "$P" && grep -q "Änderung aus dem Inspektor: h1.hero__title" <<<"$(git -C "$S" log -1 --format=%s)"'
check "Inline-Styles als Regel in overrides.css" 'grep -q "/\* $IID: Inline-Styles aus dem Inspektor \*/" "$S/overrides.css" && grep -q "color: rgb(1, 2, 3) !important;" "$S/overrides.css"'
jq '.html = "<p>falsch</p>" | del(.css)' "$IP" >"$IP.2"
set +e; OUT="$(./scripts/inspect-apply.sh "$SLUG" "$IP.2" 2>/dev/null)"; rc=$?; set -e
check "Anderes Tag abgelehnt, nichts geändert" '(( rc != 0 )) && [[ -z "$(git -C "$S" status --porcelain)" ]]'
jq -n --arg page "/$(basename "$(dirname "$P")")/index.html" '{page:$page, items:[{selector:"h1.hero__title", html:"<h1 class=\"hero__title\">Zwei</h1>"}], rules:[{selector:".hero p", decls:"margin-top: 3px"}, {selector:".hero", decls:"padding: 1px", media:"(max-width: 600px)"}]}' >"$IP.3"
OUT="$(./scripts/inspect-apply.sh "$SLUG" "$IP.3" 2>/dev/null)"
check "Mehrere Änderungen und CSS-Regeln übernommen" '[[ "$(jq -r .status <<<"$OUT")" == committed ]] && grep -q ">Zwei</h1>" "$P" && grep -q "margin-top: 3px !important;" "$S/overrides.css" && grep -q "@media (max-width: 600px) {" "$S/overrides.css" && git -C "$S" log -1 --format=%s | grep -q "2 CSS-Regel(n)"'
rm -f "$IP.3"
rm -f "$IP" "$IP.2"

echo "Kontext (context.sh)"
OUT="$(./scripts/context.sh "$SLUG" A-020 2>/dev/null)"
CTX="$(jq -r .context <<<"$OUT")"
check "Vorgaben mit gesperrtem Token" 'grep -q "<vorgaben" <<<"$CTX" && grep -q "color.primary = #0B5FA5 → var(--modio-color-primary) \[gesperrt\]" <<<"$CTX"'
check "Regeln eingebettet" 'grep -q "Du-Ansprache" <<<"$CTX"'
check "Bisherige Schritte" 'grep -q "^A-018 | Prompt:" <<<"$CTX" && grep -q "| Prompt: Änderung aus dem Inspektor" <<<"$CTX"'
HEAD_A013="$(git -C "$S" rev-parse HEAD)"
./scripts/rollback.sh "$SLUG" A-001 >/dev/null 2>&1
CTX="$(./scripts/context.sh "$SLUG" A-020 2>/dev/null | jq -r .context)"
check "Nach Rücksprung nur verbliebene Schritte und Vorgaben" '! grep -q "A-013" <<<"$CTX" && grep -q "(noch keine Tokens)" <<<"$CTX"'
OUT="$(./scripts/rollback.sh "$SLUG" "$HEAD_A013" 2>&1)" || echo "$OUT"

echo "Referenzbild"
node -e "require('sharp')({create:{width:3000,height:1500,channels:3,background:'#c33'}}).jpeg().withMetadata().toFile('$S/../ref-test.jpg')" 2>/dev/null
OUT="$(./scripts/add-reference.sh "$SLUG" A-005 "sites/ref-test.jpg" 2>/dev/null)"
check "Bild übernommen und verkleinert" '[[ "$(jq -r .width <<<"$OUT")" == 2000 ]]'
printf '<svg xmlns="http://www.w3.org/2000/svg"></svg>' >sites/ref-test.svg
set +e; OUT="$(./scripts/add-reference.sh "$SLUG" A-005 sites/ref-test.svg 2>/dev/null)"; rc=$?; set -e
check "SVG abgelehnt" '(( rc != 0 ))'
set +e; OUT="$(./scripts/add-reference.sh "$SLUG" A-005 "http://127.0.0.1:$PORT/index.html" 2>/dev/null)"; rc=$?; set -e
check "HTML statt Bild abgelehnt" '(( rc != 0 )) && grep -q "Seite statt eines Bildes" <<<"$OUT"'
rm -f sites/ref-test.jpg sites/ref-test.svg
./scripts/discard-step.sh "$SLUG" >/dev/null 2>&1

echo "Entwurf und Integration (draft.mjs, draft-apply.sh)"
D="$S/drafts/D-001"
mkdir -p "$D/v1"
printf '<section class="hero"><h1 class="hero__title">Willkommen</h1></section>' >"$D/source.html"
jq -n --arg page "$ENTRY" '{id:"D-001", page:$page, selector:"section.hero", prompt:"Hero neu gestalten", status:"open", appliedAs:null, versions:[{v:1, prompt:"Hero neu gestalten", name:"hero", title:"Hero", summary:"Neu gestaltet."}]}' >"$D/draft.json"
printf '<section class="mx-hero"><h1>Willkommen</h1><a class="hero__cta" data-mx-baustein="button" href="/leistungen/">Mehr</a><button type="button" data-mx-platzhalter="Merkliste anbinden">Merken</button></section>\n' >"$D/v1/component.html"
echo '[{"id":"P1","gruppe":"pflicht","titel":"Ansprache","text":"ihren -> Ihren","umgesetzt":true},{"id":"P2","gruppe":"pflicht","titel":"Kontrast Orange","text":"Gesperrter Token, klären.","umgesetzt":false}]' >"$D/v1/befund.json"
printf '@scope (.mx-hero) {\n  :scope { padding: var(--modio-space-l, 4rem); }\n  h1 { font-size: clamp(2rem, 5vw, 4rem); color: #fff; }\n}\n@media (min-width: 60em) {\n  @scope (.mx-hero) { :scope { display: grid; } }\n}\n' >"$D/v1/component.css"
echo '{"name":"hero","title":"Hero","bausteine":[{"key":"button","label":"Button","source":"neu","klassen":{"neu":"hero__cta","bestand":"btn"}}]}' >"$D/v1/meta.json"
set +e; OUT="$(node scripts/lib/draft.mjs validate "$S" "$D" 1 2>/dev/null)"; rc=$?; set -e
check "Gültige Komponente besteht die Prüfung" '(( rc == 0 )) && [[ "$(jq -r .name <<<"$OUT")" == hero ]]'
check "Befund und Platzhalter erkannt" 'jq -e "(.befund | length == 2) and (.platzhalter[0].text == \"Merkliste anbinden\")" <<<"$OUT" >/dev/null'
mv "$D/v1/befund.json" "$D/befund.bak"
set +e; OUT="$(node scripts/lib/draft.mjs validate "$S" "$D" 1 2>/dev/null)"; rc=$?; set -e
check "Ohne befund.json gültig, mit Hinweis" '(( rc == 0 )) && jq -e "(.errors | length == 0) and ([.warnings[] | select(test(\"befund.json fehlt\"))] | length == 1)" <<<"$OUT" >/dev/null'
mv "$D/befund.bak" "$D/v1/befund.json"
check "drafts/ ist nicht versioniert" '[[ -z "$(git -C "$S" status --porcelain)" ]]'
mkdir -p "$D/v2"; cp "$D/v1/meta.json" "$D/v2/"
printf '<div class="mx-hero" onclick="x()"><script>alert(1)</script><img src="https://evil.example/x.png"></div>' >"$D/v2/component.html"
printf '.hero { color: red; }\n@import url(x.css);\n' >"$D/v2/component.css"
set +e; OUT="$(node scripts/lib/draft.mjs validate "$S" "$D" 2 2>/dev/null)"; rc=$?; set -e
check "Ungültige Komponente: Exit 3" '(( rc == 3 ))'
check "Erkennt Script, Handler, fremde Domain, Regel ohne @scope, @import" 'jq -e ".errors | (map(test(\"script-tag\")) | any) and (map(test(\"event-handler\")) | any) and (map(test(\"evil.example\")) | any) and (map(test(\"außerhalb von @scope\")) | any) and (map(test(\"css-import\")) | any)" <<<"$OUT" >/dev/null'
rm -rf "$D/v2"
# gültige Version 2 für das Live-Umschalten
mkdir -p "$D/v2"; cp "$D/v1/component.css" "$D/v1/meta.json" "$D/v1/befund.json" "$D/v2/"
sed 's#<h1>Willkommen</h1>#<h1>Version zwei</h1>#' "$D/v1/component.html" >"$D/v2/component.html"
jq '.versions += [{v:2, prompt:"Zweite Fassung", name:"hero", title:"Hero 2", summary:"Zwei."}]' "$D/draft.json" >"$D/draft.tmp" && mv "$D/draft.tmp" "$D/draft.json"
# Briefing für claude.ai (für den Server-Test der Briefing-API)
OUT="$(./scripts/draft-brief.sh "$SLUG" D-001 2>/dev/null)" || true
check "Briefing: Text, Element-HTML und Übersicht" 'jq -e ".status == \"ok\"" <<<"$OUT" >/dev/null && [[ -f "$D/brief/briefing.md" && -f "$D/brief/D-001-element.html" && -f "$D/brief/brief.json" ]] && cmp -s "$D/source.html" "$D/brief/D-001-element.html"'
check "Briefing: Auftrag, Token-Block und Ausgabeformat" 'B="$D/brief/briefing.md"; grep -q "^## Auftrag" "$B" && grep -q -- "--modio-color-primary" "$B" && grep -q "Keine React-Komponente" "$B" && grep -q "D-001-element.html" "$B"'
check "Briefing: Token-Block ohne doppelte Klammer, Auswahl aus dem Auftrag erlaubt" 'B="$D/brief/briefing.md"; ! grep -q "^}}" "$B" && grep -q "ausdrücklich eine Auswahl" "$B"'
check "Briefing: Tokens beachten, fehlende Stufen ableiten (ohne „verbindlich“)" 'B="$D/brief/briefing.md"; grep -q "^## Design-Tokens$" "$B" && grep -q "leite sie aus den Tokens ab" "$B" && grep -q "Tokens beachten" "$B"'
check "Briefing: Leitlinien aus templates/leitlinien.md (alle + bestehende Website, ohne Rangfolge)" 'B="$D/brief/briefing.md"; grep -q "Gestalterisch hochwertig" "$B" && grep -q "spürbar moderneres Erscheinungsbild" "$B" && ! grep -q "Rangfolge" "$B" && ! grep -q "nicht im Browser" "$B"'
if node -e 'require("playwright")' 2>/dev/null; then
  check "Briefing: Screenshots Desktop und Mobil" '[[ -s "$D/brief/D-001-desktop.png" && -s "$D/brief/D-001-mobil.png" ]] && jq -e "[.files[] | select(.kind == \"png\")] | length == 2" "$D/brief/brief.json" >/dev/null'
fi
check "Briefing: Originalseite mit Live-URL und Fundstelle" 'sed -n "/^## Originalseite/,/^## Raster/p" "$D/brief/briefing.md" | grep -qx "http://127.0.0.1:$PORT/" && grep -q "CSS-Selektor:" "$D/brief/briefing.md"'
check "Briefing nicht im Abzug versioniert" '[[ -z "$(git -C "$S" status --porcelain)" ]]'
SPORT="${TEST_SERVER_PORT:-3998}"; STOKEN="test-token-0123456789abcdef"
# Eigener Job-Ordner: ein laufender Worker darf die Test-Jobs nicht aufgreifen
TEST_JOBS_DIR="$(mktemp -d)"; export TEST_JOBS_DIR
JOBS_DIR="$TEST_JOBS_DIR" MODIO_API_TOKEN="$STOKEN" BRIDGE_PORT="$SPORT" node tools/server/index.js >/dev/null 2>&1 &
SRV_PID=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null "http://127.0.0.1:$SPORT/" && break; sleep 0.3; done
check "Server: Vorschau und Entwurfs-API" 'node tests/draft-server-test.mjs "http://127.0.0.1:$SPORT" "$SLUG" "$ENTRY" "$STOKEN" before'
if [[ "${SKIP_BROWSER:-}" != "1" ]]; then
  check "Overlay: Vorschau, Ebenen und Entwurf erstellen (Browser)" 'node tests/draft-overlay-test.mjs "http://127.0.0.1:$SPORT" "$SLUG" "$ENTRY"'
fi
PREV="$(git -C "$S" rev-parse HEAD)"
set +e; OUT="$(./scripts/draft-apply.sh "$SLUG" D-001 2>/dev/null)"; rc=$?; set -e
check "draft-apply.sh committet" '(( rc == 0 )) && [[ "$(jq -r .status <<<"$OUT")" == committed ]]'
check "Element ersetzt, Rest der Seite unverändert" 'grep -q "<section class=\"mx-hero\">" "$P" && ! grep -q "hero__title" "$P" && grep -q "<footer" "$P"'
check "components/mx-hero.css versioniert" 'git -C "$S" cat-file -e HEAD:components/mx-hero.css && grep -q "@scope (.mx-hero)" "$S/components/mx-hero.css"'
A="$(jq -r .annotationId <<<"$OUT")"
check "Platzhalter und offene Befundpunkte in der Zusammenfassung" 'jq -r .result.summary "$S/annotations/$A.json" | grep -q "Merkliste anbinden" && jq -r .result.summary "$S/annotations/$A.json" | grep -q "P2 Kontrast Orange"'
check "Annotation mit Entwurfsbezug" 'jq -e ".source == \"draft\" and .draft.id == \"D-001\"" "$S/annotations/$A.json" >/dev/null'
set +e; OUT="$(./scripts/draft-apply.sh "$SLUG" D-001 2>/dev/null)"; rc=$?; set -e
check "Übernommener Entwurf nicht noch einmal übernehmbar" '(( rc != 0 )) && grep -q "nicht mehr offen" <<<"$OUT"'
check "Server: CSS-Ebenen nach Übernahme" 'node tests/draft-server-test.mjs "http://127.0.0.1:$SPORT" "$SLUG" "$ENTRY" "$STOKEN" after'
kill "$SRV_PID" 2>/dev/null || true

# Überarbeitung einer übernommenen Komponente: Name bleibt, CSS-Datei wird ersetzt
JOBR="$(mktemp)"
jq -n --arg page "$ENTRY" '{id:"job-test-rev", params:{page:$page, selector:"section.mx-hero", html:"<section class=\"mx-hero\"><h1>Willkommen</h1></section>", text:"Willkommen", prompt:"Hero ruhiger"}}' >"$JOBR"
OUT="$(PATH="$ROOT/tests/fake-claude:$PATH" ./scripts/draft-create.sh "$SLUG" "$JOBR" 2>/dev/null)" || true
RD="$(jq -r .draft <<<"$OUT")"
check "Überarbeitung erkannt (Name bleibt, bisheriges CSS als Material)" '[[ "$(jq -r .name <<<"$OUT")" == hero ]] && [[ "$(jq -r .revises "$S/drafts/$RD/draft.json")" == hero ]] && [[ -f "$S/drafts/$RD/bestand-komponente.css" ]]'
set +e; OUT="$(./scripts/draft-apply.sh "$SLUG" "$RD" 2>/dev/null)"; rc=$?; set -e
check "Überarbeitung ersetzt components/mx-hero.css" '(( rc == 0 )) && grep -q "padding: 2rem" "$S/components/mx-hero.css" && [[ "$(ls "$S/components" | wc -l)" == 1 ]]'
rm -f "$JOBR" logs/claude-job-test-rev*.json logs/claude-job-test-rev*.stderr.log
OUT="$(node --input-type=module -e "
import { layerLegacyCss } from './scripts/lib/draft.mjs';
const h = '<link rel=\"stylesheet\" href=\"/css/a.css?x=1&amp;y=2\" media=\"screen\"><link rel=\"icon\" href=\"/f.ico\"><style>@import url(b.css);h1{color:red}</style><style data-modio>x{}</style>';
process.stdout.write(layerLegacyCss(h));")"
check "Alt-CSS in @layer legacy (link, style, @import)" 'grep -qF "@import url(\"/css/a.css?x=1&y=2\") layer(legacy) screen;" <<<"$OUT" && grep -qF "@import url(b.css) layer(legacy);@layer legacy{" <<<"$OUT" && grep -qF "<link rel=\"icon\"" <<<"$OUT" && grep -qF "<style data-modio>x{}</style>" <<<"$OUT"'
./scripts/rollback.sh "$SLUG" "$PREV" >/dev/null 2>&1
set +e; OUT="$(./scripts/draft-discard.sh "$SLUG" D-001 2>/dev/null)"; rc=$?; set -e
check "Nach Rücksprung ist der Entwurf wieder offen (verwerfbar)" '(( rc == 0 )) && [[ ! -f "$S/components/mx-hero.css" ]] && [[ ! -f "$S/annotations/$A.json" ]]'
check "draft-discard.sh verwirft" '[[ "$(jq -r .status "$D/draft.json")" == discarded ]]'

echo "Entwurf anlegen (draft-create.sh mit simuliertem Claude)"
JOBF="$(mktemp)"
jq -n --arg page "$ENTRY" '{id:"job-test-draft", params:{page:$page, selector:"footer", html:"<footer>Browser-Stand</footer>", text:"© Testfirma", prompt:"Footer modern", bausteine:[{key:"button",classes:"btn"}], viewport:{width:1440,height:900}, rect:{width:1200}}}' >"$JOBF"
SKILLF="$(mktemp)"; printf -- '---\nname: frontend-design\ndescription: x\n---\n\n# Frontend Design\nTEST-SKILL-INHALT\n' >"$SKILLF"
printf '# Sortiment\nWir verkaufen Testdinge.\n' >"$S/design/sortiment.md"
git -C "$S" add design/sortiment.md && git -C "$S" commit -q -m "[design] Sortiment" -- design/sortiment.md
OUT="$(DESIGN_SKILL_FILE="$SKILLF" PATH="$ROOT/tests/fake-claude:$PATH" ./scripts/draft-create.sh "$SLUG" "$JOBF" 2>/dev/null)" || true
DN="$(jq -r .draft <<<"$OUT")"
check "Systemprompt mit Entwurfsregeln, Leitlinien und Skill (ohne Frontmatter)" 'F="$S/drafts/$DN/SYSTEM.md"; grep -q "Regeln für Entwürfe" "$F" && grep -q "Gestaltungsleitlinien" "$F" && grep -q "Kein Template-Look" "$F" && grep -q "TEST-SKILL-INHALT" "$F" && ! grep -q "^name: frontend-design" "$F"'
check "Abzug: CLAUDE.md mit Leitlinien für bestehende Websites und Rangfolge" 'grep -q "spürbar moderneres Erscheinungsbild" "$S/CLAUDE.md" && grep -q "^### Rangfolge" "$S/CLAUDE.md" && ! grep -q "GESTALTUNGSLEITLINIEN" "$S/CLAUDE.md" && grep -q "spürbar moderneres Erscheinungsbild" "$S/drafts/$DN/SYSTEM.md"'
check "Entwurfsregeln: erst gestalten, Befund zum Schluss, höchstens 12 Punkte" 'F="$S/drafts/$DN/SYSTEM.md"; grep -q "^## Vorgehen$" "$F" && grep -q "Schreibe zum Schluss \`befund.json\`, höchstens 12 Punkte" "$F" && ! grep -q "erst prüfen, dann gestalten" "$F"'
check "Leitlinien: keine Emojis, Rundungen und Schatten per Projektregel abschaltbar, Option in den Vorlagen" 'F="$S/drafts/$DN/SYSTEM.md"; grep -q "Keine Emojis." "$F" && grep -q "Rundungen und Schatten: keine" "$F" && ! grep -q "sparsam" "$F" && grep -q "^- Rundungen und Schatten: erlaubt$" templates/design/notes.md && grep -q "^- Rundungen und Schatten: erlaubt$" templates/projekt/notes.md'
check "Bausteine: nur mit Gegenstück im Bestand umschaltbar, Rest frei" 'F="$S/drafts/$DN/SYSTEM.md"; grep -q "Alle anderen Teile der Komponente gestaltest du frei" "$F" && grep -q "nur die Bausteine mit Gegenstück in \`bausteine.json\`" "$F"'
check "Weitere design/*.md als Hintergrund im Kontext" 'node scripts/lib/design.mjs context "$S" A-000 0 | jq -r .context | grep -q "<datei name=\"design/sortiment.md\">"'
echo "Neu: alles" >>"$S/design/sortiment.md"
set +e; OUT2="$(./scripts/check-diff.sh "$SLUG" 2>/dev/null)"; rc=$?; set -e
check "Änderung an design/sortiment.md ohne „merken“ blockiert" '(( rc == 3 )) && jq -e ".hits | map(.rule) | index(\"docs-changed\")" <<<"$OUT2" >/dev/null'
./scripts/discard-step.sh "$SLUG" >/dev/null 2>&1
rm -f "$SKILLF"
OUT2="$(DESIGN_SKILL_FILE="" bash -c 'source scripts/lib/common.sh; build_system_prompt /dev/stdout "" --leitlinien' 2>/dev/null)"
check "Ohne Skill nur Leitlinien" 'grep -q "Gestaltungsleitlinien" <<<"$OUT2" && ! grep -q "Skill „frontend-design“ (nachrangig" <<<"$OUT2"'
check "Neuer Entwurf mit Version 1" '[[ "$(jq -r .status <<<"$OUT")" == ok && "$(jq -r .version <<<"$OUT")" == 1 && -f "$S/drafts/$DN/v1/component.html" ]]'
check "Ausgangsmaterial und Regeln im Entwurf" '[[ -f "$S/drafts/$DN/source.html" && -f "$S/drafts/$DN/CLAUDE.md" ]] && jq -e ".[0].classes == \"btn\"" "$S/drafts/$DN/bausteine.json" >/dev/null'
check "Abzug unverändert" '[[ -z "$(git -C "$S" status --porcelain)" ]]'
check "Material ungekürzt aus der Seitendatei (nicht aus dem Browser)" 'jq -e ".material.source == \"abzug\" and .material.truncated == false" "$S/drafts/$DN/draft.json" >/dev/null && grep -q "<footer>© Testfirma</footer>" "$S/drafts/$DN/source.html" && ! grep -q "Browser-Stand" "$S/drafts/$DN/source.html"'
if node -e 'require("playwright")' 2>/dev/null && [[ -f "$S/drafts/$DN/layout.json" ]]; then
  check "Hauptraster gemessen (layout.json je Ansicht)" 'jq -e "(.ansichten | length) >= 3 and all(.ansichten[]; .element.w > 0)" "$S/drafts/$DN/layout.json" >/dev/null'
else
  echo "  (Hauptraster übersprungen: Playwright/Browser nicht verfügbar)"
fi
JOBT="$(mktemp)"
jq -n --arg page "$ENTRY" '{id:"job-test-draft-trunc", params:{page:$page, selector:"#gibt-es-nicht", html:"<div id=\"gibt-es-nicht\"><p>Anfang …", text:"Anfang", prompt:"Neu"}}' >"$JOBT"
OUT="$(PATH="$ROOT/tests/fake-claude:$PATH" ./scripts/draft-create.sh "$SLUG" "$JOBT" 2>/dev/null)" || true
TD="$(jq -r .draft <<<"$OUT")"
check "Element nicht im Abzug: Browser-Material mit sichtbarer Warnung" 'jq -e ".material.source == \"browser\" and .material.truncated == true" "$S/drafts/$TD/draft.json" >/dev/null && jq -e "[.warnings[] | select(test(\"Material unvollständig\"))] | length == 1" <<<"$OUT" >/dev/null'
./scripts/draft-discard.sh "$SLUG" "$TD" >/dev/null 2>&1; rm -f "$JOBT" logs/claude-job-test-draft-trunc*.json logs/claude-job-test-draft-trunc*.stderr.log
CSSRULES="$(node --input-type=module -e '
  import { validateComponent } from "./scripts/lib/draft.mjs"; import { loadCheerio } from "./scripts/lib/consistency.mjs";
  const c = await loadCheerio(); const html = "<section class=\"mx-test\"><p>x</p></section>";
  const v = (css) => validateComponent(c, { html, css, name: "test" }).errors.filter((e) => e.includes("css-expression")).length;
  console.log(v("@scope (.mx-test) { :scope { overscroll-behavior: contain; scroll-behavior: smooth; } }"), v("@scope (.mx-test) { :scope { behavior: url(x.htc); } }"), v("@scope (.mx-test) { :scope { width: expression(1); } }"));' 2>&1)"
check "CSS-Prüfung: overscroll-behavior erlaubt, behavior und expression() abgewiesen" '[[ "$CSSRULES" == "0 1 1" ]]'
BIGD="$(mktemp -d)"; mkdir -p "$BIGD/www"
node -e 'require("fs").writeFileSync(process.argv[1], "<html><body><div id=\"gross\">" + "<p>Produktkachel mit viel Text</p>\n".repeat(8000) + "</div></body></html>")' "$BIGD/www/gross.html"
BIGOUT="$(node scripts/lib/draft.mjs extract "$BIGD" /gross.html "#gross" 2>/dev/null | (sleep 0.3; cat))"
check "Großes Element (> 64 KB) kommt über die Pipe vollständig an" 'jq -e ".count == 1 and (.html | length) > 200000" <<<"$BIGOUT" >/dev/null'
rm -rf "$BIGD"
jq -n --arg d "$DN" '{id:"job-test-draft2", params:{draft:$d, prompt:"Etwas ruhiger"}}' >"$JOBF"
OUT="$(PATH="$ROOT/tests/fake-claude:$PATH" ./scripts/draft-create.sh "$SLUG" "$JOBF" 2>/dev/null)" || true
check "Neue Version 2 mit Session" '[[ "$(jq -r .version <<<"$OUT")" == 2 ]] && jq -e ".versions | length == 2" "$S/drafts/$DN/draft.json" >/dev/null && [[ "$(jq -r .sessionId "$S/drafts/$DN/draft.json")" == fake-session ]]'
check "Kosten je Version, nicht kumuliert (Session fortgesetzt)" 'jq -e "[.versions[].costUsd] == [0.01, 0.01] and .sessionCostUsd == 0.02" "$S/drafts/$DN/draft.json" >/dev/null'
# Gestaltung in claude.ai: Entwurf nur mit Briefing anlegen, dann HTML importieren
JOBX="$(mktemp)"
jq -n --arg page "$ENTRY" '{id:"job-test-ext", params:{page:$page, selector:"footer", html:"<footer>x</footer>", text:"x", prompt:"Footer extern gestalten", viewport:{width:1440,height:900}, mode:"brief"}}' >"$JOBX"
OUT="$(PATH="$ROOT/tests/fake-claude:$PATH" ./scripts/draft-create.sh "$SLUG" "$JOBX" 2>/dev/null)" || true
XD="$(jq -r .draft <<<"$OUT")"
check "Briefing-Entwurf ohne Claude-Lauf und ohne Version" 'jq -e ".brief == true" <<<"$OUT" >/dev/null && jq -e ".external == true and (.versions | length) == 0" "$S/drafts/$XD/draft.json" >/dev/null && [[ -f "$S/drafts/$XD/brief/briefing.md" ]] && [[ ! -f logs/claude-job-test-ext.json ]]'
IMPF="jobs/assets/job-test-ext-import.html"
printf '%s\n' '<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet"><style>@import url(https://fonts.googleapis.com/x);:root{--modio-color-primary:#0B5FA5}body{margin:0}.f{padding:2rem}</style></head><body><footer class="f" onclick="x()">© Testfirma<script>alert(1)</script></footer></body></html>' >"$IMPF"
ARGF2="$(mktemp)"
jq -n --arg d "$XD" --arg f "$IMPF" '{id:"job-test-ext-imp", params:{draft:$d, importFile:$f}}' >"$JOBX"
OUT="$(FAKE_CLAUDE_ARGS="$ARGF2" PATH="$ROOT/tests/fake-claude:$PATH" ./scripts/draft-create.sh "$SLUG" "$JOBX" 2>/dev/null)" || true
check "Import als v1: bereinigt, Quelle import, Warnungen im Panel" '[[ "$(jq -r .version <<<"$OUT")" == 1 ]] && jq -e ".versions[0].source == \"import\"" "$S/drafts/$XD/draft.json" >/dev/null && ! grep -qiE "<script|onclick|fonts.googleapis" "$S/drafts/$XD/import-v1.html" && jq -e "[.warnings[] | select(test(\"^Import:\"))] | length >= 2" <<<"$OUT" >/dev/null'
check "Import: frische Session, Effort medium" '! grep -qx -- "--resume" "$ARGF2" && grep -A1 -x -- "--effort" "$ARGF2" | grep -qx medium'
check "Import: Inhaltsumfang wie im Import, Fehlendes nur im Befund" 'grep -q "Umfang und Auswahl wie im Import" "$ARGF2" && grep -q "ergänzt du NICHT" "$ARGF2"'
check "Import: Größen und Abstände des Imports bleiben, Farben auf Tokens" 'grep -q "Größen und Abstände des Imports bleiben" "$ARGF2" && grep -q "abweichende Farben auf den nächstliegenden passenden Token" "$ARGF2"'
check "Import: Bausteine nur mit Gegenstück aus bausteine.json" 'grep -q "Nur Teile des Imports, die einem Baustein aus bausteine.json entsprechen" "$ARGF2"'
printf '%s\n' '<html><body><div id="root"></div><script type="text/babel">ReactDOM.createRoot(root).render(<App/>)</script></body></html>' >"$IMPF"
set +e; OUT="$(PATH="$ROOT/tests/fake-claude:$PATH" ./scripts/draft-create.sh "$SLUG" "$JOBX" 2>/dev/null)"; rc=$?; set -e
check "React-Artefakt abgewiesen, keine Version 2" '(( rc != 0 )) && grep -q "React" <<<"$OUT" && [[ ! -d "$S/drafts/$XD/v2" ]]'
./scripts/draft-discard.sh "$SLUG" "$XD" >/dev/null 2>&1
rm -f "$JOBX" "$ARGF2" "$IMPF" logs/claude-job-test-ext*.json logs/claude-job-test-ext*.stderr.log
set +e; OUT="$(FAKE_CLAUDE_BAD=1 PATH="$ROOT/tests/fake-claude:$PATH" ./scripts/draft-create.sh "$SLUG" "$JOBF" 2>/dev/null)"; rc=$?; set -e
check "Ungültiger Entwurf: Fehler, keine Version 3" '(( rc != 0 )) && grep -q "Entwurf ungültig" <<<"$OUT" && [[ ! -d "$S/drafts/$DN/v3" ]]'
ARGF="$(mktemp)"
jq -n --arg d "$DN" '{id:"job-test-draft3", params:{draft:$d, prompt:"Noch einmal"}}' >"$JOBF"
OUT="$(FAKE_CLAUDE_ARGS="$ARGF" ANTHROPIC_API_KEY=sk-test CLAUDE_AUTH=konto CLAUDE_MODEL= CLAUDE_EFFORT= DRAFT_MODEL= DRAFT_EFFORT= PATH="$ROOT/tests/fake-claude:$PATH" ./scripts/draft-create.sh "$SLUG" "$JOBF" 2>/dev/null)" || true
check "Konto: Opus, Effort high, ohne --bare, API-Schlüssel entzogen" 'grep -qx -- "--effort" "$ARGF" && grep -A1 -x -- "--effort" "$ARGF" | grep -qx high && grep -A1 -x -- "--model" "$ARGF" | grep -qx claude-opus-5-5 && ! grep -qx -- "--bare" "$ARGF" && grep -qx "KEY=" "$ARGF"'
OUT="$(FAKE_CLAUDE_ARGS="$ARGF" ANTHROPIC_API_KEY=sk-test CLAUDE_AUTH=api CLAUDE_MODEL= DRAFT_MODEL= DRAFT_EFFORT=max PATH="$ROOT/tests/fake-claude:$PATH" ./scripts/draft-create.sh "$SLUG" "$JOBF" 2>/dev/null)" || true
check "API: --bare, Schlüssel vorhanden, Effort einstellbar" 'grep -qx -- "--bare" "$ARGF" && grep -qx "KEY=sk-test" "$ARGF" && grep -A1 -x -- "--effort" "$ARGF" | grep -qx max'
set +e; OUT="$(env -u ANTHROPIC_API_KEY CLAUDE_AUTH=api CLAUDE_SETTINGS_FILE="$ROOT/tools/worker/claude-settings.json" PATH="$ROOT/tests/fake-claude:$PATH" bash -c 'source scripts/lib/common.sh; ANTHROPIC_API_KEY=; claude_auth_setup tools/worker/claude-settings.json; echo ok' 2>/dev/null)"; rc=$?; set -e
check "API ohne Schlüssel: klare Fehlermeldung" '(( rc != 0 )) && grep -q "CLAUDE_AUTH=api braucht ANTHROPIC_API_KEY" <<<"$OUT"'
set +e; OUT="$(CLAUDE_EFFORT=riesig bash -c 'source scripts/lib/common.sh; claude_effort' 2>/dev/null)"; rc=$?; set -e
check "Ungültiger Effort abgewiesen" '(( rc != 0 )) && grep -q "Ungültiger Effort" <<<"$OUT"'
OUT="$(CLAUDE_BARE=true bash -c 'unset CLAUDE_AUTH; source scripts/lib/common.sh; claude_auth_mode' 2>/dev/null)"
check "Alte Schreibweise CLAUDE_BARE=true gilt als api" '[[ "$OUT" == api* ]]'
rm -f "$ARGF"
./scripts/draft-discard.sh "$SLUG" "$DN" >/dev/null 2>&1
rm -f "$JOBF" logs/claude-job-test-draft*.json logs/claude-job-test-draft*.stderr.log

echo "Report und Liste"
OUT="$(./scripts/report.sh "$SLUG" 2>/dev/null)"
check "CHANGES.md erzeugt" '[[ -f "$S/CHANGES.md" ]] && grep -q "## A-001" "$S/CHANGES.md" && ! grep -q "## A-003" "$S/CHANGES.md"'
check "Override-Block im Report" 'grep -q "font-size: 48px" "$S/CHANGES.md"'
check "Hinzugefügte Seiten im Report" 'grep -q "^## Seiten: 1 Seite(n) hinzugefügt" "$S/CHANGES.md" && grep -q "leistungen/>" "$S/CHANGES.md"'
check "Report beginnt mit Design-Vorgaben" 'grep -q "^## Design-Vorgaben" "$S/CHANGES.md" && grep -q "| \`color.primary\` | \`#0B5FA5\`" "$S/CHANGES.md"'
OUT="$(./scripts/site-list.sh 2>/dev/null)"
check "site-list.sh enthält Website" 'jq -e --arg s "$SLUG" ".sites | map(.slug) | index(\$s)" <<<"$OUT" >/dev/null'

echo "Sichtprüfung im Browser (render-check.sh, run-annotation.sh)"
jq -n --arg page "$ENTRY" '{id:"A-090", prompt:"Headline", page:$page, selector:"h1.hero__title", viewport:{width:1280,height:800}}' >"$S/annotations/A-090.json"
printf '/* A-090: kaputt */\nhtml body h1.hero__title { width: 3000px !important; font-size: 40px !important; }\n' >>"$S/overrides.css"
set +e; OUT="$(./scripts/render-check.sh "$SLUG" A-090 2>/dev/null)"; rc=$?; set -e
if (( rc == 4 )); then
  echo "  (übersprungen: $(jq -r .error <<<"$OUT" | cut -c1-120))"
else
  check "Fehler-Befund: Exit 3" '(( rc == 3 ))'
  check "Überlauf erkannt" 'jq -e "[.issues[] | select(.level == \"fehler\" and (.rule == \"page-overflow-x\" or .rule == \"element-overflow\"))] | length > 0" <<<"$OUT" >/dev/null'
  check "Stiländerung gemessen" 'jq -e "[.results[] | .styleChanges[\"font-size\"]] | map(select(. != null)) | length > 0" <<<"$OUT" >/dev/null'
  check "Bilder vorher/nachher je Ansicht" 'jq -e "[.results[].images | .vorher, .nachher] | all(. != null)" <<<"$OUT" >/dev/null && [[ -f "$S/$(jq -r ".results[0].images.nachher" <<<"$OUT")" ]]'
  check "Ansicht der Auswahl ergänzt" 'jq -e "[.results[].viewport.name] | index(\"auswahl\")" <<<"$OUT" >/dev/null'
  check ".render/ nicht in git status" '! git -C "$S" status --porcelain | grep -q "\.render"'
  rm -f "$S/annotations/A-090.json"; ./scripts/discard-step.sh "$SLUG" >/dev/null 2>&1
  OUT="$(./scripts/render-check.sh "$SLUG" A-001 2>/dev/null)" || true
  check "Ohne offene Änderung: nur letzter Schritt prüfbar" '[[ "$(jq -r .status <<<"$OUT")" == error ]]'

  JOBR="$ROOT/jobs/test-render.json"; PROMPTF="$(mktemp)"
  jq -n --arg page "$ENTRY" '{id:"job-test-render", params:{page:$page, selector:"h1.hero__title", prompt:"Headline betonen", viewport:{width:1280,height:800}}}' >"$JOBR"
  set +e; OUT="$(FAKE_RENDER_PROMPT="$PROMPTF" RENDER_REVIEW=always PATH="$ROOT/tests/fake-claude-render:$PATH" ./scripts/run-annotation.sh "$SLUG" "$JOBR" 2>/dev/null)"; rc=$?; set -e
  RID="$(jq -r .annotationId <<<"$OUT")"
  check "Annotation mit Sichtprüfung committet" '(( rc == 0 )) && [[ "$(jq -r .status <<<"$OUT")" == committed ]]'
  check "Claude bekam Bilder und Befunde" 'grep -q "nachher: .render/$RID/desktop-1-nachher.png" "$PROMPTF" && grep -q "fehler:" "$PROMPTF"'
  check "Fehler korrigiert, Nachmessung ohne Fehler" '! grep -q TESTFEHLER "$S/overrides.css" && jq -e ".render.status == \"ok\" and .render.errors == 0" "$S/annotations/$RID.json" >/dev/null'
  check "Korrekturrunde und Kosten in der Annotation" 'jq -e "(.result.review | length) == 1 and .result.review[0].costUsd == 0.02 and .result.costUsd == 0.07 and (.result.summary | test(\"Sichtprüfung: korrigiert\"))" "$S/annotations/$RID.json" >/dev/null'
  check "Keine Bilder im Commit" '! git -C "$S" show --name-only --format= HEAD | grep -q "\.render"'
  OUT="$(RENDER_REVIEW=off PATH="$ROOT/tests/fake-claude-render:$PATH" ./scripts/run-annotation.sh "$SLUG" "$JOBR" 2>/dev/null)" || true
  RID="$(jq -r .annotationId <<<"$OUT")"
  check "RENDER_REVIEW=off: keine Sichtprüfung" 'jq -e ".render == null and .result.review == null" "$S/annotations/$RID.json" >/dev/null'
  rm -f "$JOBR" "$PROMPTF" logs/claude-job-test-render.json logs/claude-job-test-render.stderr.log
fi

echo "Neues Projekt ohne Website (project-new, project-package, Import, project-export)"
NS="sites/modio-test-neu"; rm -rf "$NS"
OUT="$(./scripts/project-new.sh modio-test-neu "Test <Neu>" 2 2>/dev/null)" || true
check "Projekt angelegt: Leinwand mit Plätzen, Vorlagen, Baseline" '[[ "$(jq -r .kind <<<"$OUT")" == neu ]] && grep -q "id=\"platz-2\"" "$NS/www/leinwand/index.html" && grep -q "Test &lt;Neu&gt;" "$NS/www/leinwand/index.html" && [[ -f "$NS/design/tokens-quelle.css" && -f "$NS/design/projekt.md" ]] && git -C "$NS" rev-parse -q --verify baseline >/dev/null'
check "Neues Projekt: CLAUDE.md mit Leitlinien für alle Projekte, ohne „bestehende Websites“" 'grep -q "Gestalterisch hochwertig" "$NS/CLAUDE.md" && ! grep -q "spürbar moderneres" "$NS/CLAUDE.md" && grep -q "^### Rangfolge" "$NS/CLAUDE.md"'
set +e; OUT="$(./scripts/project-new.sh modio-test-neu 2>/dev/null)"; rc=$?; set -e
check "Projekt doppelt: abgewiesen" '(( rc != 0 ))'
cat >"$NS/design/tokens-quelle.css" <<'TQ'
:root {
  --color-primary: #0b5fa5;
  --color-link: var(--color-primary);
  --font-body: "Inter", system-ui, sans-serif;
  --text-h1: clamp(2rem, 1rem + 3vw, 3rem);
  --space-m: 1.5rem;
  --space-l: calc(var(--space-m) * 2);
  --container-max-width: 1100px;
  --font-weight-bold: 700;
  --color-bad: url(x.png);
}
TQ
printf '# Gestaltungsregeln\n- Ruhig und klar.\n' >"$NS/design/notes.md"
OUT="$(./scripts/project-package.sh modio-test-neu 2>/dev/null)" || true
check "Paket: Tokens aus CSS-Variablen (gesperrt, Verweise, clamp)" 'jq -e ".tokens == 7" <<<"$OUT" >/dev/null && jq -e ".tokens[\"color.link\"].value == \"var(--modio-color-primary)\" and .tokens[\"space.l\"].value == \"calc(var(--modio-space-m) * 2)\" and .tokens[\"size.h1\"].locked == true" "$NS/design/tokens.json" >/dev/null'
check "Paket: --container-max-width als container.max-width, Inhaltsbreite im Paket" 'jq -e ".tokens[\"container.max-width\"].value == \"1100px\"" "$NS/design/tokens.json" >/dev/null && grep -q "var(--modio-container-max-width)" "$NS/paket/CLAUDE.md"'
check "Paket: ungültige Variable gemeldet, Werte ohne Token im Paket" 'jq -e "[.warnings[] | select(test(\"--color-bad\"))] | length == 1" <<<"$OUT" >/dev/null && grep -q -- "--font-weight-bold: 700" "$NS/paket/CLAUDE.md"'
check "Paket: CLAUDE.md, tokens.css, regeln.md, Hintergrund, README, entwuerfe/" 'P="$NS/paket"; [[ -f "$P/CLAUDE.md" && -f "$P/regeln.md" && -f "$P/projekt.md" && -f "$P/README.md" && -d "$P/entwuerfe" ]] && grep -q -- "--modio-color-primary: #0b5fa5" "$P/tokens.css" && grep -q "entwuerfe/<kurzer-name>.html" "$P/CLAUDE.md"'
check "Paket: Leitlinien für alle Projekte aus templates/leitlinien.md" 'grep -q "Gestalterisch hochwertig" "$NS/paket/CLAUDE.md" && ! grep -q "spürbar moderneres" "$NS/paket/CLAUDE.md" && ! grep -q "Rangfolge" "$NS/paket/CLAUDE.md"'
check "Paket: Angaben committet, Paket nicht versioniert" '[[ "$(git -C "$NS" log -1 --format=%s)" == "[design] Projektangaben übernommen"* ]] && [[ -z "$(git -C "$NS" status --porcelain)" ]]'
touch "$NS/paket/entwuerfe/a.html"; ./scripts/project-package.sh modio-test-neu >/dev/null 2>&1 || true
check "Paket neu erzeugen: entwuerfe/ bleibt" '[[ -f "$NS/paket/entwuerfe/a.html" ]]'
JOBN="$(mktemp)"; IMPN="jobs/assets/job-test-neu-import.html"
printf '%s\n' '<!doctype html><html><head><style>.t{padding:var(--modio-space-m)}</style></head><body><section class="t"><h2>Neu</h2></section></body></html>' >"$IMPN"
jq -n --arg f "$IMPN" '{id:"job-test-neu", params:{page:"/leinwand/index.html", selector:"#platz-1", html:"", text:"", prompt:"Teaser", viewport:{width:1440,height:900}, importFile:$f}}' >"$JOBN"
OUT="$(PATH="$ROOT/tests/fake-claude:$PATH" FAKE_CLAUDE_ARGS=/dev/null ./scripts/draft-create.sh modio-test-neu "$JOBN" 2>/dev/null)" || true
ND="$(jq -r .draft <<<"$OUT")"
check "Import auf einen Platz der Leinwand" '[[ "$(jq -r .version <<<"$OUT")" == 1 ]]'
check "Neues Projekt: Systemprompt ohne „bestehende Websites“" 'grep -q "Gestalterisch hochwertig" "$NS/drafts/$ND/SYSTEM.md" && ! grep -q "spürbar moderneres" "$NS/drafts/$ND/SYSTEM.md"'
check "Tokens: neue Projekte als Palette, bestehende Websites Tokens beachten" 'grep -q "Die Tokens sind die Palette" "$NS/drafts/$ND/SYSTEM.md" && ! grep -q "Tokens beachten" "$NS/drafts/$ND/SYSTEM.md" && grep -q "Tokens beachten" "$S/CLAUDE.md" && ! grep -q "Die Tokens sind die Palette" "$S/CLAUDE.md" && grep -q "Die Tokens sind die Palette" "$NS/paket/CLAUDE.md"'
OUT="$(./scripts/draft-apply.sh modio-test-neu "$ND" 2>/dev/null)" || true
check "Übernahme ersetzt den Platz" '[[ "$(jq -r .status <<<"$OUT")" == committed ]] && ! grep -q "id=\"platz-1\"" "$NS/www/leinwand/index.html" && grep -q "class=\"mx-test\"" "$NS/www/leinwand/index.html"'
printf '/* mx-test: Teaser */\n@scope (.mx-test) {\n  :scope { padding: var(--modio-space-l); color: var(--modio-color-link); }\n}\n' >"$NS/components/mx-test.css"
OUT="$(./scripts/project-export.sh modio-test-neu 2>/dev/null)" || true
EX="$(jq -r .dir <<<"$OUT")"
check "Export: Komponente mit den Variablen des Projekts" '[[ -f "$EX/komponenten/test/component.html" ]] && grep -q "var(--space-l)" "$EX/komponenten/test/component.css" && grep -q "var(--color-link)" "$EX/komponenten/test/component.css" && ! grep -q -- "--modio-" "$EX/komponenten/test/component.css"'
check "Export: tokens.css aus tokens-quelle.css, Vorschau, README" 'cmp -s "$NS/design/tokens-quelle.css" "$EX/tokens.css" && grep -q "komponenten.css" "$EX/vorschau.html" && grep -q "mx-test" "$EX/README.md"'
git -C "$NS" checkout -q -- components
# Letzter freier Platz übernommen: ein neuer Platz kommt dazu
jq -n --arg f "$IMPN" '{id:"job-test-neu2", params:{page:"/leinwand/index.html", selector:"#platz-2", html:"", text:"", prompt:"Zweiter", viewport:{width:1440,height:900}, importFile:$f}}' >"$JOBN"
OUT="$(FAKE_CLAUDE_NAME=zwei PATH="$ROOT/tests/fake-claude:$PATH" ./scripts/draft-create.sh modio-test-neu "$JOBN" 2>/dev/null)" || true
OUT="$(./scripts/draft-apply.sh modio-test-neu "$(jq -r .draft <<<"$OUT")" 2>/dev/null)" || true
check "Kein freier Platz mehr: neuer Platz angefügt" 'grep -q "id=\"platz-3\"" "$NS/www/leinwand/index.html" && [[ -z "$(git -C "$NS" status --porcelain)" ]]'
jq -n '{id:"job-test-neu3", params:{page:"/leinwand/index.html", selector:"#platz-3", html:"", text:"", prompt:"Hero für die Startseite", viewport:{width:1440,height:900}, mode:"brief"}}' >"$JOBN"
OUT="$(PATH="$ROOT/tests/fake-claude:$PATH" ./scripts/draft-create.sh modio-test-neu "$JOBN" 2>/dev/null)" || true
check "Briefing im neuen Projekt: nur Auftrag, verweist auf das Paket" 'B="$NS/drafts/$(jq -r .draft <<<"$OUT")/brief/briefing.md"; grep -q "Hero für die Startseite" "$B" && grep -q "Projektwissen" "$B" && ! grep -q "## Originalseite" "$B"'
set +e; OUT="$(./scripts/site-recrawl.sh modio-test-neu 2>/dev/null)"; rc=$?; set -e
check "Neu einlesen bei neuem Projekt abgewiesen" '(( rc != 0 )) && grep -q "Neues Projekt" <<<"$OUT"'
rm -f "$JOBN" "$IMPN" logs/claude-job-test-neu*.json logs/claude-job-test-neu*.stderr.log
rm -rf "$NS"

echo "Neu einlesen"
OUT="$(./scripts/site-recrawl.sh "$SLUG" 2>/dev/null)"
check "Neuer Abzug angelegt" '[[ "$(jq -r .status <<<"$OUT")" == ok ]]'
check "Alter Stand archiviert mit Report" 'ls archive/"$SLUG"-*/CHANGES.md >/dev/null 2>&1'
check "Neue Baseline ohne Schritte" '[[ "$(git -C "$S" rev-list --count baseline..HEAD)" == 0 ]]'
check "Design-Vorgaben behalten (--keep-design)" 'git -C "$S" show baseline:design/tokens.json | jq -e ".tokens[\"color.primary\"].locked == true" >/dev/null'

echo
echo "Ergebnis: $PASS bestanden, $FAIL fehlgeschlagen"
(( FAIL == 0 ))
