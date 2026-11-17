#!/usr/bin/env bash
# Benennt eine Bibliotheks-Komponente (neue Projekte) um, als Schritt A-xxx (source "component-rename").
# Dateien components/mx-<name>.css|html|json werden zu mx-<neuer-name>.*; die Klasse mx-<name> (auch Modifier mx-<name>--…
# und @scope) wird in allen Seiten, Vorlagen, Stylesheets unter www/ und overrides.css ersetzt. Byte-genau: nur die Namen
# ändern sich. Läuft durch commit-step.sh (Verlauf, Report, Rücksprung).
# Aufruf: component-rename.sh <slug> <name> <neuer-name>
# Ausgabe: Ergebnis von commit-step.sh + {name, newName, files, replaced}; Exit 4 = nicht in der Bibliothek
source "$(dirname "$0")/lib/common.sh"
require_cmd git jq node
require_site "${1:-}"
NAME="${2:-}"; NEW="${3:-}"
[[ -n "$NAME" && -n "$NEW" ]] || usage "component-rename.sh <slug> <name> <neuer-name>"
[[ "$NAME" =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ ]] || die "Ungültiger Komponentenname: $NAME" 2
[[ "$NEW" =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ ]] || die "Ungültiger neuer Name: $NEW (a-z, 0-9, Bindestrich)" 2
[[ -f "$SITE/components/mx-$NAME.json" ]] || die "Komponente nicht in der Bibliothek: mx-$NAME" 4
[[ -z "$(git_site status --porcelain --untracked-files=all -- . ':(exclude)annotations/')" ]] \
  || die "Der Abzug enthält nicht übernommene Änderungen. Erst übernehmen oder verwerfen."

COUNTER="$(next_annotation_number)"
state_set counter "$COUNTER"
ID="$(printf 'A-%03d' "$COUNTER")"
restore() { git_site checkout -q -- . 2>/dev/null || true; git_site clean -fdq -- annotations/ components/ 2>/dev/null || true; }
set +e
R="$(node "$LIB_DIR/components.mjs" rename "$SITE" "$NAME" "$NEW")"; rc=$?
set -e
if (( rc != 0 )); then restore; die "$(jq -r '.error // "Umbenennen fehlgeschlagen"' <<<"$R" 2>/dev/null || echo "Umbenennen fehlgeschlagen")" 2; fi

mkdir -p "$SITE/annotations"
jq -n --arg id "$ID" --arg created "$(now_iso)" --arg name "$NAME" --arg new "$NEW" --argjson r "$R" '{
  id:$id, source:"component-rename", created:$created,
  prompt:"Komponente mx-\($name) in mx-\($new) umbenannt", page:null, selector:null, remember:false, allow_token_change:false,
  componentRename:$r,
  result:{summary:"mx-\($name) heißt jetzt mx-\($new): \($r.replaced) Stelle(n) in \($r.files | length) Datei(en) (\($r.files | join(", ")))."}
}' >"$SITE/annotations/$ID.json"
chmod 644 "$SITE/annotations/$ID.json"
log "$SLUG: mx-$NAME in mx-$NEW umbenannt ($ID)"

set +e
OUT="$("$SCRIPTS_DIR/commit-step.sh" "$SLUG" "$ID")"; rc=$?
set -e
if (( rc != 0 && rc != 3 )); then restore; die "commit-step.sh fehlgeschlagen: $(jq -r '.error // empty' <<<"$OUT" 2>/dev/null)"; fi
emit_json "$(jq -c --argjson r "$R" '. + $r' <<<"$OUT")"
exit "$rc"
