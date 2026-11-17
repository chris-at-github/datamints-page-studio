#!/usr/bin/env bash
# Gleicht die Kopien einer Bibliotheks-Komponente (neue Projekte) an ihre Vorlage an, als Schritt A-xxx (source "component-sync").
# Jede abweichende Kopie wird aus der Vorlage ihrer Variante neu aufgebaut; Slot-Inhalte, eingebettete Komponenten,
# Kontextklassen und id bleiben. Nicht eindeutig zuzuordnende Kopien bleiben unverändert und werden gemeldet.
# Byte-genau: ersetzt wird nur die Quelltext-Spanne der betroffenen Kopie. Läuft durch commit-step.sh (Verlauf, Report, Rücksprung).
# Aufruf: component-sync.sh <slug> <name>
# Ausgabe: Ergebnis von commit-step.sh + {name, synced, pages, skipped, placeholders}; Exit 4 = nicht in der Bibliothek
source "$(dirname "$0")/lib/common.sh"
require_cmd git jq node
require_site "${1:-}"
NAME="${2:-}"
[[ -n "$NAME" ]] || usage "component-sync.sh <slug> <name>"
[[ "$NAME" =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ ]] || die "Ungültiger Komponentenname: $NAME" 2
[[ -f "$SITE/components/mx-$NAME.json" ]] || die "Komponente nicht in der Bibliothek: mx-$NAME" 4
[[ -z "$(git_site status --porcelain --untracked-files=all -- . ':(exclude)annotations/')" ]] \
  || die "Der Abzug enthält nicht übernommene Änderungen. Erst übernehmen oder verwerfen."

COUNTER="$(next_annotation_number)"
state_set counter "$COUNTER"
ID="$(printf 'A-%03d' "$COUNTER")"
restore() { git_site checkout -q -- . 2>/dev/null || true; git_site clean -fdq -- annotations/ 2>/dev/null || true; }
set +e
R="$(node "$LIB_DIR/components.mjs" sync "$SITE" "$NAME")"; rc=$?
set -e
if (( rc != 0 )); then restore; die "$(jq -r '.error // "Angleichen fehlgeschlagen"' <<<"$R" 2>/dev/null || echo "Angleichen fehlgeschlagen")" 2; fi

mkdir -p "$SITE/annotations"
jq -n --arg id "$ID" --arg created "$(now_iso)" --arg name "$NAME" --argjson r "$R" '{
  id:$id, source:"component-sync", created:$created,
  prompt:"Kopien von mx-\($name) angeglichen", page:null, selector:null, remember:false, allow_token_change:false,
  componentSync:$r,
  result:{summary:("\($r.synced) Kopie(n) von mx-\($name) nach der Vorlage neu aufgebaut" + (if ($r.pages | length) > 0 then " (\($r.pages | join(", ")))" else "" end) + "."
    + (if ($r.placeholders | length) > 0 then "\n\nNeue Pflicht-Inhalte mit Beispielinhalt der Vorlage:\n" + ([$r.placeholders[] | "- \(.page): \(.slot)"] | join("\n")) else "" end)
    + (if ($r.skipped | length) > 0 then "\n\nNicht angeglichen:\n" + ([$r.skipped[] | "- \(.page): \(.reason)"] | join("\n")) else "" end))}
}' >"$SITE/annotations/$ID.json"
chmod 644 "$SITE/annotations/$ID.json"
log "$SLUG: Kopien von mx-$NAME angeglichen: $(jq -r .synced <<<"$R") ($ID)"

set +e
OUT="$("$SCRIPTS_DIR/commit-step.sh" "$SLUG" "$ID")"; rc=$?
set -e
if (( rc != 0 && rc != 3 )); then restore; die "commit-step.sh fehlgeschlagen: $(jq -r '.error // empty' <<<"$OUT" 2>/dev/null)"; fi
emit_json "$(jq -c --argjson r "$R" '. + $r' <<<"$OUT")"
exit "$rc"
