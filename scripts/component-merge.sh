#!/usr/bin/env bash
# Führt eine Bibliotheks-Komponente (neue Projekte) in eine andere zusammen, als Schritt A-xxx (source "component-merge").
# Jede Kopie von mx-<quelle> auf den Seiten und in den Vorlagen anderer Komponenten wird als Variante <variante> von
# mx-<ziel> neu aufgebaut (Slot-Inhalte nach Schlüssel, Kontextklassen, id und Attribute der Wurzel bleiben). Danach
# entfallen Beschreibung und Vorlage von mx-<quelle>, ihr CSS, sobald kein Element die Klasse mehr trägt. mx-<ziel> muss
# alle Slots von mx-<quelle> haben (sonst Exit 2). Läuft durch commit-step.sh (Verlauf, Report, Rücksprung).
# Aufruf: component-merge.sh <slug> <quelle> <ziel> <variante>
# Ausgabe: Ergebnis von commit-step.sh + {name, into, variant, merged, pages, templates, skipped, placeholders,
#          removedFiles, keptCss, cssRefs}; Exit 4 = Komponente nicht in der Bibliothek
source "$(dirname "$0")/lib/common.sh"
require_cmd git jq node
require_site "${1:-}"
NAME="${2:-}"; INTO="${3:-}"; VARIANT="${4:-}"
[[ -n "$NAME" && -n "$INTO" && -n "$VARIANT" ]] || usage "component-merge.sh <slug> <quelle> <ziel> <variante>"
for x in "$NAME" "$INTO" "$VARIANT"; do [[ "$x" =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ ]] || die "Ungültiger Name: $x" 2; done
[[ -f "$SITE/components/mx-$NAME.json" ]] || die "Komponente nicht in der Bibliothek: mx-$NAME" 4
[[ -f "$SITE/components/mx-$INTO.json" ]] || die "Komponente nicht in der Bibliothek: mx-$INTO" 4
[[ -z "$(git_site status --porcelain --untracked-files=all -- . ':(exclude)annotations/')" ]] \
  || die "Der Abzug enthält nicht übernommene Änderungen. Erst übernehmen oder verwerfen."

COUNTER="$(next_annotation_number)"
state_set counter "$COUNTER"
ID="$(printf 'A-%03d' "$COUNTER")"
restore() { git_site checkout -q -- . 2>/dev/null || true; git_site clean -fdq -- annotations/ 2>/dev/null || true; }
set +e
R="$(node "$LIB_DIR/components.mjs" merge "$SITE" "$NAME" "$INTO" "$VARIANT")"; rc=$?
set -e
if (( rc != 0 )); then restore; die "$(jq -r '.error // "Zusammenführen fehlgeschlagen"' <<<"$R" 2>/dev/null || echo "Zusammenführen fehlgeschlagen")" 2; fi

mkdir -p "$SITE/annotations"
jq -n --arg id "$ID" --arg created "$(now_iso)" --argjson r "$R" '{
  id:$id, source:"component-merge", created:$created,
  prompt:"Komponente mx-\($r.name) in mx-\($r.into) (Variante \($r.variant)) zusammengeführt", page:null, selector:null, remember:false, allow_token_change:false,
  componentMerge:$r,
  result:{summary:("\($r.merged) Kopie(n) von mx-\($r.name) sind jetzt mx-\($r.into), Variante \($r.variant)"
    + (if (($r.pages + $r.templates) | length) > 0 then " (\(($r.pages + $r.templates) | join(", ")))" else "" end) + ". mx-\($r.name) ist nicht mehr in der Bibliothek."
    + (if $r.keptCss then " components/mx-\($r.name).css bleibt, weil Elemente mit der Klasse es noch brauchen." else "" end)
    + (if ($r.cssRefs | length) > 0 then "\n\nDiese Stylesheets nennen mx-\($r.name) noch: \($r.cssRefs | join(", "))." else "" end)
    + (if ($r.placeholders | length) > 0 then "\n\nPflicht-Inhalte mit Beispielinhalt der Vorlage:\n" + ([$r.placeholders[] | "- \(.page): \(.slot)"] | join("\n")) else "" end)
    + (if ($r.skipped | length) > 0 then "\n\nNicht umgestellt:\n" + ([$r.skipped[] | "- \(.page): \(.reason)"] | join("\n")) else "" end))}
}' >"$SITE/annotations/$ID.json"
chmod 644 "$SITE/annotations/$ID.json"
log "$SLUG: mx-$NAME in mx-$INTO zusammengeführt: $(jq -r .merged <<<"$R") ($ID)"

set +e
OUT="$("$SCRIPTS_DIR/commit-step.sh" "$SLUG" "$ID")"; rc=$?
set -e
if (( rc != 0 && rc != 3 )); then restore; die "commit-step.sh fehlgeschlagen: $(jq -r '.error // empty' <<<"$OUT" 2>/dev/null)"; fi
emit_json "$(jq -c --argjson r "$R" '. + $r' <<<"$OUT")"
exit "$rc"
