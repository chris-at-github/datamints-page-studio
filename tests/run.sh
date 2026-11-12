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
check "design/ in der Baseline" 'git -C "$S" cat-file -e baseline:design/tokens.json && git -C "$S" cat-file -e baseline:design/tokens.css && git -C "$S" cat-file -e baseline:design/notes.md'
check "Token-Scan geschrieben" '[[ -f "$S/.scan.json" ]] && jq -e ".colors | length > 0" "$S/.scan.json" >/dev/null'

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
check "Abweichender Header als Hinweis, Commit trotzdem" '(( rc == 0 )) && jq -e ".warnings | map(select(.rule == \"consistency\")) | .[0].text | test(\"Header ist nicht auf allen Seiten gleich.*kontakt\")" <<<"$OUT" >/dev/null'
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

echo "Kontext (context.sh)"
OUT="$(./scripts/context.sh "$SLUG" A-020 2>/dev/null)"
CTX="$(jq -r .context <<<"$OUT")"
check "Vorgaben mit gesperrtem Token" 'grep -q "<vorgaben" <<<"$CTX" && grep -q "color.primary = #0B5FA5 → var(--modio-color-primary) \[gesperrt\]" <<<"$CTX"'
check "Regeln eingebettet" 'grep -q "Du-Ansprache" <<<"$CTX"'
check "Bisherige Schritte" 'grep -q "^A-001 | Prompt:" <<<"$CTX" && grep -q "^A-015 | Prompt:" <<<"$CTX"'
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

echo "Report und Liste"
OUT="$(./scripts/report.sh "$SLUG" 2>/dev/null)"
check "CHANGES.md erzeugt" '[[ -f "$S/CHANGES.md" ]] && grep -q "## A-001" "$S/CHANGES.md" && ! grep -q "## A-003" "$S/CHANGES.md"'
check "Override-Block im Report" 'grep -q "font-size: 48px" "$S/CHANGES.md"'
check "Hinzugefügte Seiten im Report" 'grep -q "^## Seiten: 1 Seite(n) hinzugefügt" "$S/CHANGES.md" && grep -q "leistungen/>" "$S/CHANGES.md"'
check "Report beginnt mit Design-Vorgaben" 'grep -q "^## Design-Vorgaben" "$S/CHANGES.md" && grep -q "| \`color.primary\` | \`#0B5FA5\`" "$S/CHANGES.md"'
OUT="$(./scripts/site-list.sh 2>/dev/null)"
check "site-list.sh enthält Website" 'jq -e --arg s "$SLUG" ".sites | map(.slug) | index(\$s)" <<<"$OUT" >/dev/null'

echo "Neu einlesen"
OUT="$(./scripts/site-recrawl.sh "$SLUG" 2>/dev/null)"
check "Neuer Abzug angelegt" '[[ "$(jq -r .status <<<"$OUT")" == ok ]]'
check "Alter Stand archiviert mit Report" 'ls archive/"$SLUG"-*/CHANGES.md >/dev/null 2>&1'
check "Neue Baseline ohne Schritte" '[[ "$(git -C "$S" rev-list --count baseline..HEAD)" == 0 ]]'
check "Design-Vorgaben behalten (--keep-design)" 'git -C "$S" show baseline:design/tokens.json | jq -e ".tokens[\"color.primary\"].locked == true" >/dev/null'

echo
echo "Ergebnis: $PASS bestanden, $FAIL fehlgeschlagen"
(( FAIL == 0 ))
