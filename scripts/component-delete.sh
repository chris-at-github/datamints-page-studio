#!/usr/bin/env bash
# Löscht eine Komponente aus der Bibliothek (neue Projekte) oder eine ihrer Varianten als Schritt A-xxx (source "component-delete").
# Verwendungen auf den Seiten bleiben als normales Markup mit ihren Klassen stehen, verlieren aber die Kennzeichnung als
# Komponente (data-mx-variant, data-mx-slot). Das CSS einer gelöschten Komponente bleibt, solange Elemente mit ihrer Klasse
# auf den Seiten stehen. Läuft durch commit-step.sh (Verlauf, Report, Rücksprung).
# Aufruf: component-delete.sh <slug> <name> [variante]
# Ausgabe: Ergebnis von commit-step.sh + {name, variant, unmarked, pages, removedFiles, keptCss, removedSlots}
source "$(dirname "$0")/lib/common.sh"
require_cmd git jq node
require_site "${1:-}"
NAME="${2:-}"; VARIANT="${3:-}"
[[ -n "$NAME" ]] || usage "component-delete.sh <slug> <name> [variante]"
[[ "$NAME" =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ ]] || die "Ungültiger Komponentenname: $NAME" 2
[[ -z "$VARIANT" || "$VARIANT" =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ ]] || die "Ungültige Variante: $VARIANT" 2
[[ -f "$SITE/components/mx-$NAME.json" ]] || die "Komponente nicht in der Bibliothek: mx-$NAME" 4
[[ -z "$(git_site status --porcelain --untracked-files=all -- . ':(exclude)annotations/')" ]] \
  || die "Der Abzug enthält nicht übernommene Änderungen. Erst übernehmen oder verwerfen."

COUNTER="$(next_annotation_number)"
state_set counter "$COUNTER"
ID="$(printf 'A-%03d' "$COUNTER")"
restore() { git_site checkout -q -- . 2>/dev/null || true; git_site clean -fdq -- annotations/ 2>/dev/null || true; }
set +e
R="$(node "$LIB_DIR/components.mjs" delete "$SITE" "$NAME" ${VARIANT:+"$VARIANT"})"; rc=$?
set -e
if (( rc != 0 )); then restore; die "$(jq -r '.error // "Löschen fehlgeschlagen"' <<<"$R" 2>/dev/null || echo "Löschen fehlgeschlagen")" 2; fi

mkdir -p "$SITE/annotations"
jq -n --arg id "$ID" --arg created "$(now_iso)" --arg name "$NAME" --arg variant "$VARIANT" --argjson r "$R" '{
  id:$id, source:"component-delete", created:$created,
  prompt:(if $variant == "" then "Komponente mx-\($name) gelöscht" else "Variante \($variant) der Komponente mx-\($name) gelöscht" end),
  page:null, selector:null, remember:false, allow_token_change:false,
  componentDelete:$r,
  result:{summary:((if $variant == "" then "Komponente mx-\($name) aus der Bibliothek gelöscht." else "Variante \($variant) aus mx-\($name) gelöscht." end)
    + (if $r.unmarked > 0 then " \($r.unmarked) Verwendung(en) bleiben als normales Markup (\($r.pages | join(", ")))." else "" end)
    + (if $variant == "" and $r.keptCss then " components/mx-\($name).css bleibt, weil Elemente mit der Klasse mx-\($name) es noch brauchen." else "" end)
    + (if ($r.removedSlots | length) > 0 then " Entfallene Slots: \($r.removedSlots | join(", "))." else "" end))}
}' >"$SITE/annotations/$ID.json"
chmod 644 "$SITE/annotations/$ID.json"
log "$SLUG: $(jq -r .prompt "$SITE/annotations/$ID.json") ($ID)"

set +e
OUT="$("$SCRIPTS_DIR/commit-step.sh" "$SLUG" "$ID")"; rc=$?
set -e
if (( rc != 0 && rc != 3 )); then restore; die "commit-step.sh fehlgeschlagen: $(jq -r '.error // empty' <<<"$OUT" 2>/dev/null)"; fi
emit_json "$(jq -c --argjson r "$R" '. + $r' <<<"$OUT")"
exit "$rc"
