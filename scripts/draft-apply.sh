#!/usr/bin/env bash
# Übernimmt eine Version eines Entwurfs als Schritt A-xxx – ohne Claude:
# ersetzt das Element in der Seite byte-genau durch das Markup der Komponente, schreibt components/mx-<name>.css
# und läuft dann durch commit-step.sh (Prüfung, gleiche Bereiche übertragen, Commit).
# Ziel Bibliothek (draft.json .target == "library", Entwurf auf der Komponentenseite): nur components/mx-<name>.css|.html|.json,
# kein Element auf einer Seite; herkunft der Beschreibung bleibt. Ausgabe nennt abweichende Kopien (deviating).
# Aufruf: draft-apply.sh <slug> <entwurf-id> [version]
# Exit 0: committed, Exit 3: Prüfung nötig
source "$(dirname "$0")/lib/common.sh"
require_cmd git jq node
require_site "${1:-}"
DID="${2:-}"; VERSION="${3:-}"
valid_draft_id "$DID" || usage "draft-apply.sh <slug> <entwurf-id> [version]"
DDIR="$SITE/drafts/$DID"
[[ -f "$DDIR/draft.json" ]] || die "Entwurf nicht gefunden: $DID"
[[ "$(draft_status "$DID")" == "open" ]] || die "$DID ist nicht mehr offen (übernommen oder verworfen)"
[[ -n "$VERSION" ]] || VERSION="$(jq -r '[.versions[].v] | max // 0' "$DDIR/draft.json")"
[[ "$VERSION" =~ ^[0-9]+$ ]] && jq -e --argjson v "$VERSION" 'any(.versions[]; .v == $v)' "$DDIR/draft.json" >/dev/null \
  || die "$DID hat keine Version $VERSION"
ensure_drafts_ignored
[[ -z "$(git_site status --porcelain)" ]] || die "Der Abzug enthält nicht übernommene Änderungen. Erst übernehmen oder verwerfen."

PAGE="$(jq -r .page "$DDIR/draft.json")"; SELECTOR="$(jq -r .selector "$DDIR/draft.json")"
NAME="$(jq -r '.name // ""' "$DDIR/v$VERSION/meta.json" 2>/dev/null || true)"
REVISES="$(jq -r '.revises // ""' "$DDIR/draft.json")"
[[ -n "$NAME" ]] || die "Version $VERSION ohne Namen"
if [[ -f "$SITE/components/mx-$NAME.css" && "$NAME" != "$REVISES" ]]; then
  die "Die Komponente mx-$NAME gibt es im Abzug schon. Entwurf mit anderem Namen nachbessern."
fi

COUNTER="$(next_annotation_number)"
state_set counter "$COUNTER"
ID="$(printf 'A-%03d' "$COUNTER")"
mkdir -p "$SITE/annotations"
jq --arg id "$ID" --arg created "$(now_iso)" --argjson v "$VERSION" '
  (.versions[] | select(.v == $v)) as $ver
  | {id:$id, source:"draft", created:$created,
     prompt:("Entwurf \(.id) v\($v) übernommen (mx-\($ver.name)\(if .target == "library" then ", Bibliothek" elif .renames then ", umbenannt aus mx-\(.renames)" elif .revises then ", Überarbeitung" else "" end)): \(.prompt)"),
     page:(if .target == "library" then null else .page end), selector:(if .target == "library" then null else .selector end), remember:false, allow_token_change:false,
     draft:{id, version:$v, name:$ver.name, title:$ver.title, prompts:[.versions[] | select(.v <= $v) | .prompt]},
     result:{summary:((if .target == "library" then "Komponente mx-\($ver.name) in der Bibliothek geändert (Vorlage, CSS, Beschreibung)." else "Element durch die Komponente mx-\($ver.name) ersetzt (components/mx-\($ver.name).css)." end) + "\n\n" + ($ver.summary // ""))}}' \
  "$DDIR/draft.json" >"$SITE/annotations/$ID.json"
chmod 644 "$SITE/annotations/$ID.json"

# Neues Projekt mit Leinwand (Altprojekte): nur dort bleibt nach dem Übernehmen ein freier Platz
PLATZ_SEITE=false
[[ "$(site_kind "$SITE")" == neu ]] && grep -q 'data-modio-platz' "$SITE/www/${PAGE#/}" 2>/dev/null && PLATZ_SEITE=true

restore() { git_site checkout -q -- . 2>/dev/null || true; git_site clean -fdq 2>/dev/null || true; }
set +e
OUT="$(node "$LIB_DIR/draft.mjs" apply "$SITE" "$DDIR" "$VERSION" "$PAGE" "$SELECTOR")"; rc=$?
set -e
if (( rc != 0 )); then
  restore
  die "$(jq -r '.error // "Übernahme fehlgeschlagen"' <<<"$OUT" 2>/dev/null || echo "Übernahme fehlgeschlagen")"
fi
# Umbenannte Komponente: das alte CSS fällt weg, sobald keine Seite die alte Klasse mehr verwendet
RENAMES="$(jq -r '.renames // ""' "$DDIR/draft.json")"
if [[ -n "$RENAMES" && "$RENAMES" != "$NAME" && -f "$SITE/components/mx-$RENAMES.css" && ! -f "$SITE/components/mx-$RENAMES.json" ]]; then
  if grep -rqE --include='*.htm' --include='*.html' "mx-$RENAMES(--|[^a-z0-9-]|\$)" "$SITE/www" 2>/dev/null; then
    log "$DID: mx-$RENAMES wird auf anderen Seiten noch verwendet, das CSS bleibt"
  else
    rm -f "$SITE/components/mx-$RENAMES.css"
    log "$DID: mx-$RENAMES in mx-$NAME umbenannt, altes CSS entfernt"
  fi
fi
# Leinwand: es bleibt immer ein freier Platz für das nächste Design (importierte Seiten bekommen keinen)
if [[ "$PLATZ_SEITE" == true ]]; then
  node "$LIB_DIR/draft.mjs" ensure-platz "$SITE" "$PAGE" >/dev/null || log "$DID: freier Platz konnte nicht ergänzt werden"
fi
# Platzhalter und offene Befundpunkte in der Zusammenfassung des Schritts (Report, Verlauf)
tmp="$(mktemp)"
jq --argjson o "$OUT" '.result.summary += (
    (if ($o.platzhalter | length) > 0 then "\n\nPlatzhalter (im echten Projekt anbinden, Attribut data-mx-platzhalter):\n" + ([$o.platzhalter[] | "- " + .text] | join("\n")) else "" end)
    + (if ($o.offen | length) > 0 then "\n\nOffene Punkte aus dem Befund (Entscheidung nötig):\n" + ([$o.offen[] | "- " + .] | join("\n")) else "" end))' \
  "$SITE/annotations/$ID.json" >"$tmp" && mv "$tmp" "$SITE/annotations/$ID.json" && chmod 644 "$SITE/annotations/$ID.json"
tmp="$(mktemp)"
jq --arg a "$ID" --argjson v "$VERSION" '.appliedAs = $a | .appliedVersion = $v' "$DDIR/draft.json" >"$tmp" && mv "$tmp" "$DDIR/draft.json"
chmod 644 "$DDIR/draft.json"
log "$DID v$VERSION als $ID übernommen (mx-$NAME auf $PAGE)"

set +e
COMMIT_OUT="$("$SCRIPTS_DIR/commit-step.sh" "$SLUG" "$ID")"; rc=$?
set -e
if (( rc != 0 && rc != 3 )); then restore; die "commit-step.sh fehlgeschlagen: $(jq -r '.error // empty' <<<"$COMMIT_OUT" 2>/dev/null)"; fi
# Abweichende Kopien der Komponente auf den Seiten (Hinweis „N Kopien weichen ab“, Angleichen über component-sync.sh)
OFF="$(node "$LIB_DIR/components.mjs" deviations "$SITE" 2>/dev/null | jq -r --arg n "$NAME" '.[$n] // 0' 2>/dev/null || true)"
[[ "$OFF" =~ ^[0-9]+$ ]] || OFF=0
emit_json "$(jq -c --arg d "$DID" --argjson v "$VERSION" --arg n "$NAME" --argjson off "$OFF" '. + {draft:$d, version:$v, name:$n, deviating:$off}' <<<"$COMMIT_OUT")"
exit "$rc"
