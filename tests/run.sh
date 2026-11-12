#!/usr/bin/env bash
# Phase-1-Test: kompletter Ablauf per Kommandozeile gegen eine lokale Testseite.
# Startet einen lokalen Webserver für tests/fixture/site, legt die Website "modio-test" an
# und prüft Commit, Prüfung (check-diff), Verwerfen, Rücksprung, Verlauf, Report und Neu einlesen.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
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
cleanup() { [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null; rm -rf "$S"; rm -rf archive/"$SLUG"-*; ./scripts/site-list.sh >/dev/null 2>&1 || true; }
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

echo "Report und Liste"
OUT="$(./scripts/report.sh "$SLUG" 2>/dev/null)"
check "CHANGES.md erzeugt" '[[ -f "$S/CHANGES.md" ]] && grep -q "## A-001" "$S/CHANGES.md" && ! grep -q "## A-003" "$S/CHANGES.md"'
check "Override-Block im Report" 'grep -q "font-size: 48px" "$S/CHANGES.md"'
OUT="$(./scripts/site-list.sh 2>/dev/null)"
check "site-list.sh enthält Website" 'jq -e --arg s "$SLUG" ".sites | map(.slug) | index(\$s)" <<<"$OUT" >/dev/null'

echo "Neu einlesen"
OUT="$(./scripts/site-recrawl.sh "$SLUG" 2>/dev/null)"
check "Neuer Abzug angelegt" '[[ "$(jq -r .status <<<"$OUT")" == ok ]]'
check "Alter Stand archiviert mit Report" 'ls archive/"$SLUG"-*/CHANGES.md >/dev/null 2>&1'
check "Neue Baseline ohne Schritte" '[[ "$(git -C "$S" rev-list --count baseline..HEAD)" == 0 ]]'

echo
echo "Ergebnis: $PASS bestanden, $FAIL fehlgeschlagen"
(( FAIL == 0 ))
