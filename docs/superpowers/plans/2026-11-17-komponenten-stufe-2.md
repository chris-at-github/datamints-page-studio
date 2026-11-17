# Komponenten-Bibliothek Stufe 2 – Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Komponentenseite (`/s/<slug>/__komponenten`) wird zum Pflegeort der Bibliothek: Komponente ändern (Entwurf ohne Seiten-Kopie), Variante hinzufügen, abweichende Kopien auf den Seiten nach der Vorlage angleichen.

**Architecture:** Ein neuer Entwurfsmodus `library` in `draft-create.sh` nimmt die Vorlage `components/mx-<name>.html` als Material; `draft.mjs apply` schreibt bei diesem Ziel nur CSS, Vorlage und Beschreibung (kein Element auf einer Seite). Die Vorschau rendert die Komponentenseite mit der Entwurfsversion. Angleichen ist ein neues Skript `component-sync.sh` (Schritt A-xxx, Rücksprung) über `syncLibrary()` in `components.mjs`: jede abweichende Kopie wird aus der Vorlage ihrer Variante neu aufgebaut, Slot-Inhalte, eingebettete Komponenten, Kontextklassen und `id` bleiben.

**Tech Stack:** Bash-Skripte (`scripts/`, Konventionen aus CLAUDE.md), Node ESM mit cheerio (`scripts/lib/*.mjs`), Node-HTTP-Server (`tools/server/index.js`), Worker (`tools/worker/index.js`), Overlay als Vanilla-JS (`tools/overlay/overlay.js`), Tests in `tests/run.sh` (Bash-`check`) und `tests/page-import-server-test.mjs`.

## Global Constraints

- Nur neue Projekte (`site.json .kind == "neu"`); Abzüge weisen alle neuen Endpunkte mit 400 ab.
- Regelbasiertes nur über Skripte unter `scripts/`; neues Skript nach Konvention: `source "$(dirname "$0")/lib/common.sh"`, erstes Argument Slug, eine JSON-Zeile auf stdout, Exit 0 = Erfolg, 3 = Prüfung nötig.
- Jede Änderung am Abzug ist ein Schritt A-xxx über `commit-step.sh` (Verlauf, Report, Rücksprung).
- Byte-genau: Angleichen ersetzt nur die Quelltext-Spanne der betroffenen Kopie (`sourceCodeLocation.startOffset/endOffset`), der Rest der Datei bleibt unverändert.
- Kopien, die nicht eindeutig zuzuordnen sind, bleiben unverändert und werden gemeldet.
- Varianten, die auf Seiten verwendet werden, darf eine Überarbeitung nicht entfernen (Fehler in der Prüfung; Löschen geht nur über `component-delete.sh`).
- UI-Texte deutsch, Sie-/Du-Form wie im Overlay bisher (Du).
- Vor dem Bearbeiten von Skripten: `ls jobs/running` muss leer sein.
- Volle Suite: `bash tests/run.sh` muss am Ende jedes Tasks `0 fehlgeschlagen` melden.

## Entscheidung gegenüber dem Gespräch

„Auswählen freigeben“ wird als Knöpfe an jeder Komponente umgesetzt („Ändern …“, „Variante hinzufügen …“), nicht über den Auswahlmodus. Grund: Auf der Komponentenseite ist das Ziel immer eine ganze Komponente; die Auswahl-Maschinerie (Selektor, Dialog mit Direkt/Queue/Import) passt nicht und müsste stark eingeschränkt werden. Im Ergebnis gleich: Klick an der Komponente → Prompt → Entwurf → Vorschau → Übernehmen.

## Dateien

| Datei | Änderung |
|---|---|
| `scripts/lib/components.mjs` | `nodeIssue()` herausgelöst, `syncInstance()`, `syncLibrary()`, `deviations()`, CLI `sync`, `uses`; `libraryPage()` mit `override` und Abweichungszahl |
| `scripts/component-sync.sh` | neu: Kopien einer Komponente angleichen als Schritt |
| `scripts/commit-step.sh` | Bereichs-Übertragung auch für Quelle `component-sync` überspringen |
| `scripts/draft-create.sh` | Modus `library` (Komponente ändern, Variante hinzufügen) |
| `scripts/lib/draft.mjs` | `apply` mit Ziel Bibliothek, Prüfung `DRAFT_REQUIRED_VARIANTS` |
| `scripts/draft-apply.sh` | Ziel Bibliothek: kein Element, Herkunft bleibt |
| `tools/server/index.js` | `POST components/draft`, `POST components/sync`, Vorschau auf `/__komponenten`, `readDraft.target` |
| `tools/worker/index.js` | Job `component-sync` |
| `tools/server/startpage.js` | Label `component-sync` |
| `tools/overlay/overlay.js` | Knöpfe und Formulare auf der Komponentenseite, Texte für Bibliotheks-Entwürfe, Job `component-sync` |
| `tests/fake-claude/claude` | neue Variante aus dem Auftrag, `FAKE_CLAUDE_LIB_WRAP` (geänderter Aufbau) |
| `tests/run.sh`, `tests/page-import-server-test.mjs` | Tests |
| `CLAUDE.md`, `README.md`, `docs/api.md` | Doku |

---

### Task 1: Angleichen in `components.mjs`

**Files:**
- Modify: `scripts/lib/components.mjs` (Funktionen `instanceIssues` ab Zeile ~189, CLI `main` ab ~423)
- Modify: `tests/fake-claude/claude`
- Test: `tests/run.sh` (Abschnitt „Komponenten-Bibliothek“, vor `# Bibliotheks-Komponente neu gestalten`)

**Interfaces:**
- Produces:
  - `nodeIssue(cheerio, $, node, comp, libNames, cache) -> string|null` (intern; Grund wie bisher in `instanceIssues`)
  - `syncInstance(cheerio, $, node, comp, libNames) -> { html } | { skip: string }`, plus `placeholders: string[]` im Erfolgsfall
  - `syncLibrary(siteDir, name) -> Promise<{ name, synced, pages: string[], skipped: [{page, reason}], placeholders: [{page, slot}] }>` (schreibt die Seiten)
  - `deviations(cheerio, siteDir, library) -> { [name]: number }`
  - `readPage(file) -> { text, enc }` (intern; Kodierung wie in `deleteFromLibrary`, das dafür umgestellt wird)
  - CLI: `node components.mjs sync <site-dir> <name>` → JSON wie `syncLibrary`; `uses <site-dir> <name>` → `{ total, refs, variants }`; `deviations <site-dir>` → `{ <name>: n }`

- [ ] **Step 1: Fake-Claude um geänderten Aufbau erweitern**

In `tests/fake-claude/claude` die Zeile mit dem gültigen Bibliotheks-Template (`printf '<article class="mx-%s" data-mx-variant="standard">…`) ersetzen durch:

```bash
    elif [[ "${FAKE_CLAUDE_LIB_WRAP:-}" == "1" ]]; then
      # geänderter Aufbau: Titel in einem Kopf, für Tests des Angleichens
      printf '<article class="mx-%s" data-mx-variant="standard"><header class="kopf"><h3 data-mx-slot="titel">Beispiel</h3></header><p data-mx-slot="text">Text</p><span class="icon" data-mx-slot="icon">★</span><a class="mehr" href="#" data-mx-slot="link">Mehr</a></article>\n' "$NAME" >"$V/component.html"
    else
      printf '<article class="mx-%s" data-mx-variant="standard"><h3 data-mx-slot="titel">Beispiel</h3><p data-mx-slot="text">Text</p><span class="icon" data-mx-slot="icon">★</span><a class="mehr" href="#" data-mx-slot="link">Mehr</a></article>\n' "$NAME" >"$V/component.html"
```

(das vorhandene `if [[ "${FAKE_CLAUDE_LIB_BAD:-}" == "1" ]]; then … else … fi` wird zu `if … elif … else … fi`).

- [ ] **Step 2: Failing Tests in `tests/run.sh` schreiben**

Vor der Zeile `# Bibliotheks-Komponente neu gestalten: Beschreibung bleibt Pflicht` einfügen. Ausgangslage dort: `mx-held` mit Varianten standard/hervorgehoben, auf `$P_NS` (`www/seiten/startseite.html`) mehrere Kopien (Standard aus der Übernahme, „Zweite Kachel“ in Variante hervorgehoben mit `<div class="extra">`-Umbau, eine Kopie mit `kachel__ctx`).

```bash
# Angleichen: Vorlage mit geändertem Aufbau, Kopien werden neu aufgebaut, Inhalte und Kontextklassen bleiben
SYNC_BEFORE="$(git -C "$NS" rev-parse HEAD)"
node -e 'const fs=require("fs");const f=process.argv[1];fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace("<h3 data-mx-slot=\"titel\">Beispiel</h3>","<header class=\"kopf\"><h3 data-mx-slot=\"titel\">Beispiel</h3></header>"))' "$NS/components/mx-held.html"
git -C "$NS" add -A && git -C "$NS" commit -qm "Test: Vorlage mit Kopf"
check "uses: Verwendungen je Variante" 'jq -e ".total >= 3 and .variants.standard >= 2" <<<"$(node scripts/lib/components.mjs uses "$NS" held)" >/dev/null'
R="$(node scripts/lib/components.mjs sync "$NS" held)"
check "syncLibrary: Kopien neu aufgebaut, Inhalte und Kontextklasse bleiben" '[[ "$(jq -r .synced <<<"$R")" -ge 3 ]] && [[ "$(grep -c "<header class=\"kopf\">" "$P_NS")" -ge 3 ]] && grep -q "Zweite Kachel" "$P_NS" && grep -q "class=\"mx-held kachel__ctx\"" "$P_NS" && ! grep -q "class=\"extra\"" "$P_NS"'
check "syncLibrary: danach keine Abweichung" 'jq -e ".held == 0" <<<"$(node scripts/lib/components.mjs deviations "$NS")" >/dev/null'
git -C "$NS" checkout -q -- . && git -C "$NS" reset -q --hard "$SYNC_BEFORE"
```

Hinweis: `git -C "$NS"` direkt ist hier Test-Hilfe am Testprojekt, wie bereits in `tests/run.sh` üblich (`git -C "$NS" checkout -q -- components`).

- [ ] **Step 3: Test laufen lassen, Fehlschlag prüfen**

Run: `bash tests/run.sh 2>&1 | grep -E "uses:|syncLibrary|Ergebnis"`
Expected: `uses:` und beide `syncLibrary`-Checks ✗ (CLI-Befehle `uses`/`sync` unbekannt).

- [ ] **Step 4: `nodeIssue` aus `instanceIssues` herauslösen**

In `scripts/lib/components.mjs` den Schleifenkörper von `instanceIssues` in eine Funktion verschieben:

```js
// Abweichung einer gekennzeichneten Kopie von ihrer Variante (Grund) oder null. cache: Map variantKey -> erwarteter Aufbau
function nodeIssue(cheerio, $, node, c, libNames, cache) {
  const vk = node.attribs['data-mx-variant'];
  const v = c.varianten.find((x) => x.key === vk);
  if (!v) return `unbekannte Variante „${vk}“`;
  const optional = new Set(c.slots.filter((x) => !x.pflicht).map((x) => x.key));
  if (!cache.has(v.key)) {
    const t = cheerio.load(renderVariant(cheerio, c.template, c, v.key), null, false);
    const tr = rootOf(t);
    cache.set(v.key, { sig: structure(t, tr, c.name, libNames, optional), rootClasses: classesOf(tr).filter((k) => k !== `mx-${c.name}` && !k.startsWith(`mx-${c.name}--`)) });
  }
  const exp = cache.get(v.key);
  const cls = classesOf(node);
  const want = v.klassen ? v.klassen.split(' ') : [];
  const mods = cls.filter((k) => k.startsWith(`mx-${c.name}--`));
  if (want.some((k) => !cls.includes(k)) || mods.some((k) => !want.includes(k))) return 'Klassen passen nicht zur Variante';
  if (exp.rootClasses.some((k) => !cls.includes(k)) || structure($, node, c.name, libNames, optional) !== exp.sig) return 'Aufbau außerhalb der austauschbaren Inhalte geändert';
  return null;
}

export function instanceIssues(cheerio, text, library) {
  const issues = [];
  if (!library.length || !/\bmx-/.test(text)) return issues;
  const $ = cheerio.load(text);
  const libNames = new Set(library.map((c) => c.name));
  for (const c of library) {
    const cache = new Map();
    for (const node of $(`.mx-${c.name}`).toArray()) {
      if (node.attribs['data-mx-variant'] === undefined) continue; // nicht (mehr) als Komponente gekennzeichnet
      const reason = nodeIssue(cheerio, $, node, c, libNames, cache);
      if (reason) issues.push({ name: c.name, variant: node.attribs['data-mx-variant'], reason });
    }
  }
  return issues;
}
```

- [ ] **Step 5: `syncInstance`, `syncLibrary`, `deviations` ergänzen**

Nach `countInstances` einfügen:

```js
// ---------- Angleichen: Kopie aus der Vorlage ihrer Variante neu aufbauen ----------

const SLOT_ATTRS = ['src', 'srcset', 'sizes', 'alt', 'width', 'height', 'href', 'target', 'rel', 'title', 'aria-label', 'datetime', 'loading'];
const isOtherComp = (node, name, libNames) => classesOf(node).some((k) => k.startsWith('mx-') && k !== `mx-${name}` && !k.startsWith(`mx-${name}--`) && libNames.has(k.slice(3)));

// Slots und eingebettete Komponenten (Schlüssel "@mx-<name>") einer Kopie in Dokumentreihenfolge; nicht in eingebettete hinein
function partsOf(root, name, libNames) {
  const map = new Map();
  const add = (k, n) => { if (!map.has(k)) map.set(k, []); map.get(k).push(n); };
  const walk = (n) => {
    for (const c of n.children || []) {
      if (c.type !== 'tag') continue;
      if (isOtherComp(c, name, libNames)) { add('@' + classesOf(c).find((k) => k.startsWith('mx-') && libNames.has(k.slice(3))), c); continue; }
      if (c.attribs['data-mx-slot'] !== undefined) { add(c.attribs['data-mx-slot'], c); continue; }
      walk(c);
    }
  };
  walk(root);
  return map;
}

// Neues HTML für eine Kopie oder { skip: Grund }. placeholders: Pflicht-Slots, die die Kopie nicht hatte (Beispielinhalt der Vorlage)
export function syncInstance(cheerio, $, node, comp, libNames) {
  const vk = node.attribs['data-mx-variant'];
  if (!comp.varianten.some((v) => v.key === vk)) return { skip: `unbekannte Variante „${vk}“` };
  const f = cheerio.load(renderVariant(cheerio, comp.template, comp, vk), null, false);
  const froot = rootOf(f);
  const oldParts = partsOf(node, comp.name, libNames);
  const newParts = partsOf(froot, comp.name, libNames);
  for (const [k, srcs] of oldParts) {
    const tgts = newParts.get(k) || [];
    if (srcs.length > 1 && tgts.length !== srcs.length) return { skip: `„${k.replace(/^@/, '')}“ kommt ${srcs.length}× vor, in der Vorlage ${tgts.length}×` };
  }
  const placeholders = [];
  for (const [k, tgts] of newParts) {
    const srcs = oldParts.get(k) || [];
    if (!srcs.length) {
      if (k.startsWith('@')) continue; // eingebettete Komponente aus der Vorlage bleibt
      const slot = comp.slots.find((s) => s.key === k);
      if (slot && !slot.pflicht) tgts.forEach((t) => f(t).remove());
      else placeholders.push(k);
      continue;
    }
    tgts.forEach((t, i) => {
      const s = srcs[Math.min(i, srcs.length - 1)];
      if (k.startsWith('@')) { f(t).replaceWith($.html(s)); return; }
      for (const a of SLOT_ATTRS) {
        if (s.attribs[a] !== undefined) t.attribs[a] = s.attribs[a];
        else delete t.attribs[a];
      }
      if (comp.slots.find((x) => x.key === k)?.typ === 'icon' && s.attribs.class !== undefined) t.attribs.class = s.attribs.class;
      f(t).html($(s).html());
    });
  }
  // Wurzel: Kontextklassen und id der Kopie bleiben
  const own = new Set(classesOf(froot));
  const ctx = classesOf(node).filter((k) => k !== `mx-${comp.name}` && !k.startsWith(`mx-${comp.name}--`) && !own.has(k));
  if (ctx.length) f(froot).addClass(ctx.join(' '));
  if (node.attribs.id) froot.attribs.id = node.attribs.id;
  return { html: f.html(froot), placeholders };
}

// Alle abweichenden Kopien einer Komponente auf allen Seiten angleichen (schreibt die Seiten)
export async function syncLibrary(siteDir, name) {
  const cheerio = await loadCheerio();
  const library = await listLibrary(siteDir, { withTemplate: true });
  const comp = library.find((c) => c.name === name);
  if (!comp) throw new Error(`Komponente nicht in der Bibliothek: mx-${name}`);
  const libNames = new Set(library.map((c) => c.name));
  const out = { name, synced: 0, pages: [], skipped: [], placeholders: [] };
  for (const p of sitePages(siteDir)) {
    const file = path.join(siteDir, 'www', p);
    const src = readPage(file);
    if (!src.text.includes(`mx-${name}`)) continue;
    const $ = cheerio.load(src.text, { sourceCodeLocationInfo: true });
    const cache = new Map();
    const edits = [];
    for (const node of $(`.mx-${name}`).toArray()) {
      if (node.attribs['data-mx-variant'] === undefined) continue;
      // in einer bereits ersetzten Kopie: kommt mit ihr neu
      if (edits.some((e) => node.sourceCodeLocation.startOffset > e.a && node.sourceCodeLocation.endOffset <= e.b)) continue;
      if (!nodeIssue(cheerio, $, node, comp, libNames, cache)) continue;
      const r = syncInstance(cheerio, $, node, comp, libNames);
      if (r.skip) { out.skipped.push({ page: '/' + p, reason: r.skip }); continue; }
      edits.push({ a: node.sourceCodeLocation.startOffset, b: node.sourceCodeLocation.endOffset, html: r.html });
      r.placeholders.forEach((s) => out.placeholders.push({ page: '/' + p, slot: s }));
    }
    if (!edits.length) continue;
    let text = src.text;
    for (const e of edits.sort((x, y) => y.a - x.a)) text = text.slice(0, e.a) + e.html + text.slice(e.b);
    fs.writeFileSync(file, text, src.enc);
    out.synced += edits.length;
    out.pages.push('/' + p);
  }
  return out;
}

// Abweichende Kopien je Komponente (für die Komponentenseite)
export function deviations(cheerio, siteDir, library) {
  const out = Object.fromEntries(library.map((c) => [c.name, 0]));
  for (const p of sitePages(siteDir)) {
    const text = readFile(path.join(siteDir, 'www', p));
    if (!text || !/\bmx-/.test(text)) continue;
    for (const i of instanceIssues(cheerio, text, library)) out[i.name]++;
  }
  return out;
}
```

Helfer für Seiten mit Kodierung (aus `deleteFromLibrary` herausgelöst; dort die vier Zeilen `buf`/`utf8`/`enc`/`text` durch `const { text, enc } = readPage(file);` ersetzen):

```js
// Seite byte-treu lesen: UTF-8, sonst latin1 (alte Abzüge)
function readPage(file) {
  const buf = fs.readFileSync(file);
  const utf8 = buf.toString('utf8');
  const enc = Buffer.from(utf8, 'utf8').equals(buf) ? 'utf8' : 'latin1';
  return { text: enc === 'utf8' ? utf8 : buf.toString('latin1'), enc };
}
```

- [ ] **Step 6: CLI-Befehle `sync` und `uses`**

In `main()` vor der Aufruf-Fehlerzeile:

```js
  if (cmd === 'sync' && siteDir && name) exitJson(await syncLibrary(siteDir, name));
  if (cmd === 'uses' && siteDir && name) exitJson(countInstances(await loadCheerio(), siteDir, [name])[name]);
  if (cmd === 'deviations' && siteDir) exitJson(deviations(await loadCheerio(), siteDir, await listLibrary(siteDir, { withTemplate: true })));
```

und die Fehlermeldung ergänzen: `| sync <site-dir> <name> | uses <site-dir> <name> | deviations <site-dir>`.

- [ ] **Step 7: Tests laufen lassen**

Run: `bash tests/run.sh 2>&1 | grep -E "✗|Ergebnis"`
Expected: `Ergebnis: N bestanden, 0 fehlgeschlagen`

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/components.mjs tests/fake-claude/claude tests/run.sh
git commit -m "Komponenten: Kopien nach der Vorlage angleichen (syncLibrary), Abweichungen zählen"
```

---

### Task 2: Skript `component-sync.sh`, Job, Endpunkt

**Files:**
- Create: `scripts/component-sync.sh`
- Modify: `scripts/commit-step.sh:61`, `tools/worker/index.js:133-138,237`, `tools/server/index.js` (nach dem Block `components/delete`, ~Zeile 822), `tools/server/startpage.js:172,332`, `CLAUDE.md` (Skripttabelle)
- Test: `tests/run.sh`, `tests/page-import-server-test.mjs`

**Interfaces:**
- Consumes: CLI `node components.mjs sync <site-dir> <name>` (Task 1)
- Produces: `component-sync.sh <slug> <name>` → commit-step-Ausgabe + `{name, synced, pages, skipped, placeholders}`; Exit 4 = nicht in der Bibliothek; Job-Typ `component-sync` mit `params {name}`; `POST /api/sites/<slug>/components/sync` `{name}` → 202 `{job}` | 404 | 409

- [ ] **Step 1: Failing Tests**

In `tests/run.sh` direkt nach den Checks aus Task 1 (vor dem `reset --hard "$SYNC_BEFORE"` die Zeilen des Task-1-Blocks so umbauen, dass zuerst das Skript getestet wird) – neuer Block nach Task-1-Block:

```bash
node -e 'const fs=require("fs");const f=process.argv[1];fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace("<h3 data-mx-slot=\"titel\">Beispiel</h3>","<header class=\"kopf\"><h3 data-mx-slot=\"titel\">Beispiel</h3></header>"))' "$NS/components/mx-held.html"
OUT="$(./scripts/local-commit.sh modio-test-neu "Vorlage mit Kopf" 2>/dev/null)" || true
OUT="$(./scripts/component-sync.sh modio-test-neu held 2>/dev/null)" || true
check "component-sync.sh: Schritt mit angeglichenen Kopien" '[[ "$(jq -r .status <<<"$OUT")" == committed ]] && (( $(jq -r .synced <<<"$OUT") >= 3 )) && [[ "$(git -C "$NS" log -1 --format=%s)" == *"Kopien von mx-held angeglichen"* ]] && ! jq -e ".warnings | map(.rule) | index(\"component-structure\")" <<<"$OUT" >/dev/null'
OUT="$(./scripts/component-sync.sh modio-test-neu held 2>/dev/null)" || true
check "component-sync.sh: nichts abweichend -> nochange" '[[ "$(jq -r .status <<<"$OUT")" == nochange ]]'
set +e; OUT="$(./scripts/component-sync.sh modio-test-neu gibt-es-nicht 2>/dev/null)"; rc=$?; set -e
check "component-sync.sh: unbekannte Komponente Exit 4" '(( rc == 4 ))'
./scripts/rollback.sh modio-test-neu "$SYNC_BEFORE" >/dev/null 2>&1 || true
```

In `tests/page-import-server-test.mjs` vor `process.exit(...)`:

```js
const compSync = (body) => fetch(`${BASE}/api/sites/${NEU}/components/sync`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
r = await compSync({ name: 'gibt-es-nicht' });
check('Angleichen: unbekannt 404', r.status === 404);
r = await compSync({ name: 'held' });
d = await r.json();
check('Angleichen: Job component-sync', r.status === 202 && d.job?.type === 'component-sync' && d.job.params.name === 'held', JSON.stringify(d));
if (d.job) fs.rmSync(path.join(JOBS, 'pending', `${d.job.id}.json`), { force: true });
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `bash tests/run.sh 2>&1 | grep -E "component-sync|Angleichen|Ergebnis"`
Expected: ✗ (Skript fehlt, Endpunkt 404 für `held`).

- [ ] **Step 3: Skript anlegen** (`chmod +x`)

```bash
#!/usr/bin/env bash
# Gleicht die Kopien einer Bibliotheks-Komponente (neue Projekte) an ihre Vorlage an, als Schritt A-xxx (source "component-sync").
# Jede abweichende Kopie wird aus der Vorlage ihrer Variante neu aufgebaut; Slot-Inhalte, eingebettete Komponenten,
# Kontextklassen und id bleiben. Nicht eindeutig zuzuordnende Kopien bleiben unverändert und werden gemeldet.
# Aufruf: component-sync.sh <slug> <name>
# Ausgabe: Ergebnis von commit-step.sh + {name, synced, pages, skipped, placeholders}
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
```

- [ ] **Step 4: commit-step, Worker, Server, Startseite, CLAUDE.md**

`scripts/commit-step.sh:61` – Bedingung erweitern um `&& "$SOURCE" != "component-sync"`; Kommentar Zeile 58: „… gelöschte Komponenten (component-delete.sh) und angeglichene Kopien (component-sync.sh) haben nichts zu übertragen“.

`tools/worker/index.js` nach dem Case `component-delete`:

```js
    case 'component-sync': {
      const name = String(job.params?.name || '');
      if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) throw new Error('Ungültige Komponente');
      return runScript('component-sync.sh', [slug, name], logFile);
    }
```

und in der Review-Liste (Zeile ~237) `'component-sync'` ergänzen.

`tools/server/index.js` nach dem Block `components/delete`:

```js
  if ((m = p.match(/^\/api\/sites\/([^/]+)\/components\/sync$/)) && req.method === 'POST') {
    // Kopien einer Komponente nach der Vorlage angleichen
    const slug = m[1];
    if (!validSlug(slug)) return sendError(res, 400, 'Ungültiger Slug');
    if (!siteExists(slug)) return sendError(res, 404, 'Website nicht gefunden');
    const body = await readBody(req);
    const name = String(body.name || '');
    if (!(await listLibrary(siteDir(slug))).some((c) => c.name === name)) return sendError(res, 404, 'Komponente nicht in der Bibliothek');
    if (await busyCheck(res, slug, 'Das Angleichen')) return;
    return send(res, 202, { job: await createJob('component-sync', slug, { name }) });
  }
```

`tools/server/startpage.js:172` LABEL: `'component-sync': 'Kopien angleichen'`; Zeile ~332:

```js
      if (j.type === 'component-sync' && j.params?.name) details.append('mx-' + j.params.name + (j.result?.synced !== undefined ? ': ' + j.result.synced + ' Kopie(n)' : ''));
```

`CLAUDE.md` Skripttabelle nach `component-delete.sh`: `| \`component-sync.sh\` | \`component-sync.sh <slug> <name>\` |`

- [ ] **Step 5: Tests laufen lassen**

Run: `bash tests/run.sh 2>&1 | grep -E "✗|Ergebnis"`
Expected: `0 fehlgeschlagen`

- [ ] **Step 6: Commit**

```bash
git add scripts/component-sync.sh scripts/commit-step.sh tools/worker/index.js tools/server/index.js tools/server/startpage.js CLAUDE.md tests/run.sh tests/page-import-server-test.mjs
git commit -m "Komponenten: Kopien angleichen als Schritt (component-sync.sh, Job, Endpunkt)"
```

---

### Task 3: Entwurfsmodus `library` (Komponente ändern, Variante hinzufügen)

**Files:**
- Modify: `scripts/draft-create.sh` (Kopf ~Zeile 30-40, Neuer-Entwurf-Zweig ~93-160, Layout ~200, TASK ~276-306, Validate ~401/415)
- Modify: `scripts/lib/draft.mjs` (`validate`/`apply` ~Zeile 420-455)
- Modify: `scripts/draft-apply.sh` (~Zeile 21-27, 44-46)
- Modify: `tests/fake-claude/claude`
- Test: `tests/run.sh`

**Interfaces:**
- Consumes: `countInstances` über CLI `uses` (Task 1)
- Produces:
  - Job-Parameter `draft` mit `{ mode:"library", component:<name>, variant:<key>|"", newVariant:{key,label}|null, prompt }`
  - `draft.json`: `page:"/__komponenten"`, `selector:".mx-<name>"`, `target:"library"`, `component:{name}`, `revises:<name>`, `newVariant` (optional)
  - Ausgabe von `draft-create.sh` wie bisher, `page:"/__komponenten"`
  - `draft.mjs apply` mit Seite `__komponenten`: schreibt nur `components/mx-<name>.css|.html|.json`, `herkunft` aus der bisherigen Beschreibung
  - Prüfung: `DRAFT_REQUIRED_VARIANTS="a,b"` → Fehler „Variante „a“ fehlt …“ wenn component.json sie nicht enthält

- [ ] **Step 1: Fake-Claude: neue Variante aus dem Auftrag**

In `tests/fake-claude/claude` nach dem `printf '{"name":"%s","title":"Kachel",…' >"$V/component.json"` ergänzen:

```bash
    NV="$(grep -oE 'Neue Variante "[a-z0-9-]+"' <<<"$PROMPT" | head -1 | sed -E 's/.*"([a-z0-9-]+)"/\1/')"
    if [[ -n "$NV" ]]; then
      jq --arg k "$NV" --arg n "$NAME" '.varianten += [{key:$k, label:"Neu", klassen:("mx-" + $n + "--" + $k)}]' "$V/component.json" >"$V/component.json.tmp" && mv "$V/component.json.tmp" "$V/component.json"
      printf '  :scope.mx-%s--%s { border: 1px solid; }\n}\n' "$NAME" "$NV" | { sed '$d' "$V/component.css"; cat; } >"$V/component.css.tmp" && mv "$V/component.css.tmp" "$V/component.css"
    fi
    [[ "${FAKE_CLAUDE_DROP_VARIANT:-}" == "1" ]] && jq '.varianten |= .[:1]' "$V/component.json" >"$V/component.json.tmp" && mv "$V/component.json.tmp" "$V/component.json"
```

- [ ] **Step 2: Failing Tests**

In `tests/run.sh` nach dem Task-2-Block:

```bash
# Komponente auf der Komponentenseite ändern bzw. Variante hinzufügen (Entwurf ohne Kopie auf einer Seite)
LIBD_BEFORE="$(git -C "$NS" rev-parse HEAD)"
jq -n '{id:"job-test-neu-lib1", params:{mode:"library", component:"held", variant:"", newVariant:null, prompt:"Ruhiger", viewport:{width:1440,height:900}}}' >"$JOBN.2"
OUT="$(PATH="$ROOT/tests/fake-claude:$PATH" FAKE_CLAUDE_LIB_WRAP=1 FAKE_CLAUDE_ARGS="$JOBN.args" ./scripts/draft-create.sh modio-test-neu "$JOBN.2" 2>/dev/null)" || true
LD="$(jq -r .draft <<<"$OUT")"
check "Bibliothek ändern: Entwurf mit Vorlage als Material" '[[ "$(jq -r .page <<<"$OUT")" == /__komponenten ]] && jq -e ".target == \"library\" and .component.name == \"held\" and .revises == \"held\"" "$NS/drafts/$LD/draft.json" >/dev/null && cmp -s "$NS/components/mx-held.html" "$NS/drafts/$LD/source.html" && [[ -f "$NS/drafts/$LD/bestand-komponente.json" ]] && grep -q "Vorlage der Komponente" "$JOBN.args"'
OUT="$(./scripts/draft-apply.sh modio-test-neu "$LD" 2>/dev/null)" || true
check "Bibliothek ändern: Übernahme ändert nur components/, Herkunft bleibt" '[[ "$(jq -r .status <<<"$OUT")" == committed ]] && grep -q "class=\"kopf\"" "$NS/components/mx-held.html" && jq -e ".herkunft == \"/seiten/startseite.html\"" "$NS/components/mx-held.json" >/dev/null && [[ -z "$(git -C "$NS" diff --name-only HEAD~1 -- www)" ]]'
jq -n '{id:"job-test-neu-lib2", params:{mode:"library", component:"held", variant:"", newVariant:{key:"kompakt", label:"Kompakt"}, prompt:"Weniger Abstand", viewport:{width:1440,height:900}}}' >"$JOBN.2"
OUT="$(PATH="$ROOT/tests/fake-claude:$PATH" FAKE_CLAUDE_ARGS="$JOBN.args" ./scripts/draft-create.sh modio-test-neu "$JOBN.2" 2>/dev/null)" || true
check "Variante hinzufügen: Auftrag nennt die Variante, Entwurf enthält sie" 'grep -q "Neue Variante \"kompakt\"" "$JOBN.args" && jq -e "[.varianten[].key] | index(\"kompakt\")" "$NS/drafts/$(jq -r .draft <<<"$OUT")/v1/component.json" >/dev/null'
./scripts/draft-discard.sh modio-test-neu "$(jq -r .draft <<<"$OUT")" >/dev/null 2>&1 || true
set +e; OUT="$(PATH="$ROOT/tests/fake-claude:$PATH" FAKE_CLAUDE_DROP_VARIANT=1 ./scripts/draft-create.sh modio-test-neu "$JOBN.2" 2>/dev/null)"; rc=$?; set -e
check "Verwendete Variante darf nicht wegfallen" '(( rc != 0 )) && grep -q "Variante „hervorgehoben“" <<<"$OUT"'
jq '.id = "job-test-neu-lib3" | .params.component = "gibt-es-nicht"' "$JOBN.2" >"$JOBN.3"
set +e; OUT="$(PATH="$ROOT/tests/fake-claude:$PATH" ./scripts/draft-create.sh modio-test-neu "$JOBN.3" 2>/dev/null)"; rc=$?; set -e
check "Bibliothek ändern: unbekannte Komponente abgewiesen" '(( rc != 0 ))'
./scripts/rollback.sh modio-test-neu "$LIBD_BEFORE" >/dev/null 2>&1 || true
rm -f "$JOBN.3"
```

Hinweis zum vorletzten Check: Die erneute Ausführung mit `job-test-neu-lib2` legt einen neuen Entwurf an (gleiche Job-Datei, neuer Entwurf D-xxx) – gewollt.

- [ ] **Step 3: Fehlschlag prüfen**

Run: `bash tests/run.sh 2>&1 | grep -E "Bibliothek ändern|Variante hinzufügen|Verwendete Variante|Ergebnis"`
Expected: ✗ („Ungültiger Modus: library“).

- [ ] **Step 4: `draft-create.sh` – Modus `library`**

Kopf: `case "$MODE" in create|brief|import|component|library) ;;` und nach dem `component`-Block:

```bash
LIB_COMP=""; LIB_VARIANT=""; NEW_VARIANT="null"
if [[ "$MODE" == library ]]; then
  # Komponente auf der Komponentenseite ändern oder Variante hinzufügen: Material ist die Vorlage, kein Element einer Seite
  [[ -z "$DID" ]] || die "Bibliothek ändern nur für neue Entwürfe"
  [[ "$(site_kind "$SITE")" == neu ]] || die "Komponenten-Bibliothek gibt es nur bei neuen Projekten"
  LIB_COMP="$(jq -r '.component // ""' <<<"$P")"; LIB_VARIANT="$(jq -r '.variant // ""' <<<"$P")"
  NEW_VARIANT="$(jq -c '.newVariant // null' <<<"$P")"
  [[ "$LIB_COMP" =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ && -f "$SITE/components/mx-$LIB_COMP.json" && -f "$SITE/components/mx-$LIB_COMP.html" ]] \
    || die "Komponente nicht in der Bibliothek: mx-$LIB_COMP"
  if [[ "$NEW_VARIANT" != null ]]; then
    NV_KEY="$(jq -r '.key // ""' <<<"$NEW_VARIANT")"
    [[ "$NV_KEY" =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ ]] || die "Ungültiger Variantenname: $NV_KEY"
    jq -e --arg k "$NV_KEY" 'any(.varianten[]; .key == $k)' "$SITE/components/mx-$LIB_COMP.json" >/dev/null && die "Variante $NV_KEY gibt es schon"
  fi
fi
```

Im Zweig „neuer Entwurf“ (`if [[ -z "$DID" ]]`): Seite und Material für `library` setzen, statt Seite zu prüfen und `write_source` aufzurufen. Die Zeilen

```bash
  PAGE="/$(jq -r '.page // ""' <<<"$P" | sed 's#^/##')"
  SELECTOR="$(jq -r '.selector // ""' <<<"$P")"
  [[ "$PAGE" != *".."* && -f "$SITE/www$PAGE" ]] || die "Seite nicht im Abzug gefunden: $PAGE"
  [[ -n "$SELECTOR" ]] || die "Selektor fehlt"
```

ersetzen durch:

```bash
  if [[ "$MODE" == library ]]; then
    PAGE="/__komponenten"; SELECTOR=".mx-$LIB_COMP"
  else
    PAGE="/$(jq -r '.page // ""' <<<"$P" | sed 's#^/##')"
    SELECTOR="$(jq -r '.selector // ""' <<<"$P")"
    [[ "$PAGE" != *".."* && -f "$SITE/www$PAGE" ]] || die "Seite nicht im Abzug gefunden: $PAGE"
    [[ -n "$SELECTOR" ]] || die "Selektor fehlt"
  fi
```

und `write_source "$DDIR/source.html" …` ersetzen durch:

```bash
  if [[ "$MODE" == library ]]; then
    cp "$SITE/components/mx-$LIB_COMP.html" "$DDIR/source.html"
    MATERIAL="$(jq -cn --argjson bytes "$(wc -c <"$DDIR/source.html")" '{source:"bibliothek", bytes:$bytes, truncated:false, note:null}')"
  else
    write_source "$DDIR/source.html" "$(jq -r '.html // ""' <<<"$P")"
  fi
```

Die bestehende `REVISES`-Erkennung greift danach von selbst (Wurzel der Vorlage hat `mx-<name>`), ebenso das Kopieren von `bestand-komponente.css|.json` und `LIB_NAME="$REVISES"` (weil `bestand-komponente.json` existiert). Nach dem Schreiben von `draft.json` (bei `.revises`) ergänzen:

```bash
  if [[ "$MODE" == library ]]; then
    tmp="$(mktemp)"; jq --argjson nv "$NEW_VARIANT" --arg v "$LIB_VARIANT" '.target = "library" | .newVariant = $nv | .variant = (if $v == "" then null else $v end)' "$DDIR/draft.json" >"$tmp" && mv "$tmp" "$DDIR/draft.json"
  fi
```

Layout: `draft_measure_layout` nur, wenn nicht Bibliothek:

```bash
TARGET="$(jq -r '.target // ""' "$DDIR/draft.json")"
[[ "$TARGET" == library ]] || draft_measure_layout
```

TASK: vor `elif (( VERSION == 1 )); then` einen Zweig für Version 1 im Modus library einfügen (bei Folgeversionen greift der bisherige „Überarbeite den Entwurf“-Zweig):

```bash
elif [[ "$TARGET" == library ]] && (( VERSION == 1 )); then
  NV_TEXT=""
  [[ "$(jq -r '.newVariant // null' "$DDIR/draft.json")" != null ]] && NV_TEXT="
Neue Variante \"$(jq -r .newVariant.key "$DDIR/draft.json")\" („$(jq -r .newVariant.label "$DDIR/draft.json")“): Ergänze sie in component.json (key und label wie angegeben, klassen mx-$LIB_NAME--$(jq -r .newVariant.key "$DDIR/draft.json"), slots nur, wenn sie andere Slots zeigt) und ihr CSS als Modifier :scope.mx-$LIB_NAME--… in component.css. Die übrigen Varianten bleiben unverändert."
  VAR_TEXT=""
  [[ "$(jq -r '.variant // ""' "$DDIR/draft.json")" != "" ]] && VAR_TEXT=" Der Auftrag bezieht sich auf die Variante \"$(jq -r .variant "$DDIR/draft.json")\"; die anderen Varianten bleiben, wie sie sind."
  TASK="Ändere die Bibliotheks-Komponente \"$LIB_NAME\" (Entwurf $DID, Version 1). Der Name bleibt \"$LIB_NAME\". Schreibe nach v1/: component.html, component.css, meta.json, component.json und befund.json.
Material: source.html ist die Vorlage der Komponente (alle Slots, data-mx-variant der dargestellten Variante), bestand-komponente.css ihr CSS, bestand-komponente.json ihre Beschreibung.$VAR_TEXT$NV_TEXT
Ändere nur, was der Auftrag verlangt. Varianten- und Slot-Namen bleiben (Kopien auf den Seiten hängen daran); Varianten, die auf Seiten verwendet werden, dürfen nicht wegfallen. Ein neuer Slot nur, wenn der Auftrag ihn verlangt.
befund.json enthält nur Punkte zur Änderung, jeweils \"umgesetzt\": true; Entscheidungen mit \"umgesetzt\": false.
Die Zusammenfassung nennt die Änderung und ob sich der Aufbau geändert hat (dann müssen die Kopien angeglichen werden)."
```

Validate: verwendete Varianten (und die neue) verlangen. Vor der ersten `CHECK=…validate`-Zeile:

```bash
REQUIRED_VARIANTS=""
if [[ -n "$LIB_NAME" && -f "$SITE/components/mx-$LIB_NAME.json" ]]; then
  REQUIRED_VARIANTS="$(node "$LIB_DIR/components.mjs" uses "$SITE" "$LIB_NAME" 2>/dev/null | jq -r '.variants // {} | to_entries | map(select(.value > 0) | .key) | join(",")' || true)"
fi
NV_KEY="$(jq -r '.newVariant.key // ""' "$DDIR/draft.json")"
[[ -n "$NV_KEY" ]] && REQUIRED_VARIANTS="${REQUIRED_VARIANTS:+$REQUIRED_VARIANTS,}$NV_KEY"
```

und beiden `validate`-Aufrufen `DRAFT_REQUIRED_VARIANTS="$REQUIRED_VARIANTS"` voranstellen.

- [ ] **Step 5: `draft.mjs` – Prüfung und Übernahme**

In `main` nach der `DRAFT_EXPECT_NAME`-Prüfung:

```js
  const required = (process.env.DRAFT_REQUIRED_VARIANTS || '').split(',').filter(Boolean);
  if (cmd === 'validate' && v.library) {
    for (const k of required) if (!v.library.varianten.some((x) => x.key === k)) v.errors.push(`Variante „${k}“ fehlt in component.json (sie wird auf Seiten verwendet oder wurde verlangt; nicht entfernen)`);
  }
```

In `apply` die Seiten-Prüfung und das Ersetzen für das Ziel Bibliothek überspringen:

```js
  const page = String(pageArg || '').replace(/^\/+/, '');
  const toLibrary = page === '__komponenten';
  if (toLibrary && !v.library) out({ error: 'Ziel Bibliothek: Die Version braucht eine component.json' }, 3);
  let herkunft = '/' + page;
  if (toLibrary) {
    try { herkunft = JSON.parse(fs.readFileSync(path.join(siteDir, 'components', `mx-${v.name}.json`), 'utf8')).herkunft || null; } catch { herkunft = null; }
  } else {
    if (!sitePages(siteDir).includes(page)) out({ error: `Seite nicht im Abzug: /${page}` }, 1);
    const cheerio = await loadCheerio();
    const file = path.join(siteDir, 'www', page);
    const src = readText(file);
    const r = replaceElement(cheerio, src.text, selector, instanceHtml(cheerio, v));
    if (r.error) out({ error: r.error }, 1);
    fs.writeFileSync(file, r.text, src.enc);
  }
```

(die bisherigen Zeilen von `if (!sitePages…` bis `fs.writeFileSync(file, r.text, src.enc);` entfallen dafür) und beim Schreiben der JSON `herkunft` verwenden:

```js
    fs.writeFileSync(path.join(compDir, `mx-${v.name}.json`), JSON.stringify({ ...v.library, ...(herkunft ? { herkunft } : {}) }, null, 2) + '\n');
```

Ausgabe: `page: toLibrary ? '/__komponenten' : '/' + page`.

- [ ] **Step 6: `draft-apply.sh`**

Leinwand-Prüfung (`PLATZ_SEITE`) bleibt unschädlich (grep auf nicht existierende Datei); `ensure-platz` läuft nur bei `PLATZ_SEITE=true`. Annotation: bei `.target == "library"` `page:null, selector:null` und Zusammenfassung „Komponente mx-<name> in der Bibliothek geändert“:

```bash
  | {id:$id, source:"draft", created:$created,
     prompt:("Entwurf \(.id) v\($v) übernommen (mx-\($ver.name)\(if .target == "library" then ", Bibliothek" elif .renames then ", umbenannt aus mx-\(.renames)" elif .revises then ", Überarbeitung" else "" end)): \(.prompt)"),
     page:(if .target == "library" then null else .page end), selector:(if .target == "library" then null else .selector end), remember:false, allow_token_change:false,
     draft:{id, version:$v, name:$ver.name, title:$ver.title, prompts:[.versions[] | select(.v <= $v) | .prompt]},
     result:{summary:((if .target == "library" then "Komponente mx-\($ver.name) in der Bibliothek geändert (Vorlage, CSS, Beschreibung)." else "Element durch die Komponente mx-\($ver.name) ersetzt (components/mx-\($ver.name).css)." end) + "\n\n" + ($ver.summary // ""))}}' \
```

Ausgabe von `draft-apply.sh` zusätzlich mit Abweichungen, damit das Overlay „N Kopien weichen ab“ melden kann – vor `emit_json`:

```bash
OFF="$(node "$LIB_DIR/components.mjs" deviations "$SITE" 2>/dev/null | jq -r --arg n "$NAME" '.[$n] // 0' 2>/dev/null || echo 0)"
emit_json "$(jq -c --arg d "$DID" --argjson v "$VERSION" --arg n "$NAME" --argjson off "${OFF:-0}" '. + {draft:$d, version:$v, name:$n, deviating:$off}' <<<"$COMMIT_OUT")"
```

(statt der bisherigen `emit_json`-Zeile; `deviations`-CLI aus Task 1).

- [ ] **Step 7: Tests laufen lassen**

Run: `bash tests/run.sh 2>&1 | grep -E "✗|Ergebnis"`
Expected: `0 fehlgeschlagen`

- [ ] **Step 8: Commit**

```bash
git add scripts/draft-create.sh scripts/lib/draft.mjs scripts/draft-apply.sh scripts/lib/components.mjs tests/fake-claude/claude tests/run.sh
git commit -m "Komponenten: Entwurf auf der Komponentenseite (ändern, Variante hinzufügen), verwendete Varianten bleiben Pflicht"
```

---

### Task 4: Server – Endpunkt, Vorschau, Abweichungen auf der Komponentenseite

**Files:**
- Modify: `tools/server/index.js` (Route `/__komponenten` ~Zeile 284, `readDraft` ~222, neuer Block nach `components/sync`)
- Modify: `scripts/lib/components.mjs` (`libraryPage`)
- Test: `tests/page-import-server-test.mjs`

**Interfaces:**
- Consumes: Job-Parameter aus Task 3, `deviations` aus Task 1, `loadVersion`/`instanceHtml` aus `draft.mjs`
- Produces:
  - `POST /api/sites/<slug>/components/draft` `{ name, prompt, variant?, newVariant?: {key,label} }` → 202 `{job}` (Typ `draft`, `params.mode:"library"`) | 400 | 404 | 409
  - `GET /s/<slug>/__komponenten?__modio_draft=D-xxx&__modio_v=n` → Komponentenseite mit Entwurfsversion statt der gespeicherten Komponente; Overlay-Config `preview`
  - `readDraft(...).target`
  - `libraryPage(siteDir, { slug, title, override })`, `override = { name, template, spec }`; Abschnitt trägt `data-kb-off="<n>"`

- [ ] **Step 1: Failing Tests** (`tests/page-import-server-test.mjs`, vor `process.exit`)

```js
const compDraft = (body) => fetch(`${BASE}/api/sites/${NEU}/components/draft`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
r = await compDraft({ name: 'gibt-es-nicht', prompt: 'x' });
check('Bibliothek ändern: unbekannt 404', r.status === 404);
r = await compDraft({ name: 'held', prompt: '' });
check('Bibliothek ändern: ohne Prompt 400', r.status === 400);
r = await compDraft({ name: 'held', prompt: 'x', newVariant: { key: 'standard', label: 'S' } });
check('Variante hinzufügen: vorhandener Name 400', r.status === 400);
r = await compDraft({ name: 'held', prompt: 'Kompakter', newVariant: { key: 'kompakt', label: 'Kompakt' } });
d = await r.json();
check('Variante hinzufügen: Job draft mode library', r.status === 202 && d.job?.type === 'draft' && d.job.params.mode === 'library' && d.job.params.component === 'held' && d.job.params.newVariant?.key === 'kompakt', JSON.stringify(d));
if (d.job) fs.rmSync(path.join(JOBS, 'pending', `${d.job.id}.json`), { force: true });
r = await fetch(`${BASE}/s/${NEU}/__komponenten`);
text = await r.text();
check('Komponentenseite: Abweichungen je Komponente', /data-kb-name="held"[^>]*data-kb-off="\d+"/.test(text));
r = await fetch(`${BASE}/s/${NEU}/__komponenten?__modio_draft=D-999&__modio_v=1`, { redirect: 'manual' });
check('Komponentenseite: Vorschau eines fehlenden Entwurfs leitet zurück', r.status === 302);
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `bash tests/run.sh 2>&1 | grep -E "Server: Seiten importieren|Ergebnis"` (der Server-Test meldet Einzelheiten auf stderr: `node tests/page-import-server-test.mjs …` bei laufendem Testserver direkt aufrufen, wenn nötig)
Expected: ✗

- [ ] **Step 3: `libraryPage` mit `override` und `data-kb-off`**

Signatur `libraryPage(siteDir, { slug, title, override = null })`. Nach `const library = …`:

```js
  if (override) {
    const i = library.findIndex((c) => c.name === override.name);
    const entry = { ...override.spec, herkunft: (library[i] || {}).herkunft || null, template: override.template };
    if (i >= 0) library[i] = entry; else library.push(entry);
  }
  const off = deviations(cheerio, siteDir, library);
```

Im Abschnitt-Tag: `data-kb-uses="${uses[c.name].total}" data-kb-off="${off[c.name] || 0}"`; in `kb-meta` nach der Verwendungszahl: `${off[c.name] ? ` · <strong>${off[c.name]} Kopie(n) weichen ab</strong>` : ''}`. `uses[c.name]` für eine neue Komponente ohne Eintrag absichern: `const u = uses[c.name] || { total: 0, variants: {} };`.

- [ ] **Step 4: Server**

Route `/__komponenten` ersetzen:

```js
  if (rest === '/__komponenten' || rest === '/__komponenten/') {
    // Komponenten-Bibliothek: alle Komponenten mit ihren Varianten (nicht Teil des Abzugs); ?__modio_draft: Entwurfsvorschau
    const site = await readJson(path.join(dir, 'site.json'), {});
    let override = null, preview = null;
    const did = sp.get('__modio_draft');
    if (did !== null) {
      const d = validDraftId(did) ? await readDraft(slug, did) : null;
      if (!d || d.status !== 'open' || d.target !== 'library') {
        res.writeHead(302, { Location: `/s/${slug}/__komponenten`, 'Cache-Control': 'no-store' });
        return res.end();
      }
      const version = Number(sp.get('__modio_v')) || Math.max(0, ...d.versions.map((v) => v.v));
      const v = await loadVersion(dir, path.join(dir, 'drafts', did), version).catch(() => null);
      if (!v || v.errors.length || !v.library) return sendError(res, 409, 'Vorschau nicht möglich: Entwurf ungültig');
      override = { name: v.name, template: v.html, spec: v.library };
      preview = { draft: did, version, name: v.name };
    }
    const buf = injectHtml(Buffer.from(await libraryPage(dir, { slug, title: site.title || slug, override }), 'utf8'), slug,
      { layered: true, kind: site.kind === 'neu' ? 'neu' : 'abzug', library: true, preview });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': SITE_CSP, 'Content-Length': buf.length });
    return res.end(req.method === 'HEAD' ? undefined : buf);
  }
```

`sp` ist an dieser Stelle schon definiert (`const sp = new URLSearchParams(search || '')` steht vor der Route `__components.css`).

`readDraft` Rückgabe ergänzen: `target: d.target || null, newVariant: d.newVariant || null,`.

Neuer Endpunkt nach `components/sync`:

```js
  if ((m = p.match(/^\/api\/sites\/([^/]+)\/components\/draft$/)) && req.method === 'POST') {
    // Komponente auf der Komponentenseite ändern oder Variante hinzufügen (Entwurf, Ziel Bibliothek)
    const slug = m[1];
    if (!validSlug(slug)) return sendError(res, 400, 'Ungültiger Slug');
    if (!siteExists(slug)) return sendError(res, 404, 'Website nicht gefunden');
    const body = await readBody(req);
    const name = String(body.name || ''), prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const variant = body.variant ? String(body.variant) : '';
    const comp = (await listLibrary(siteDir(slug))).find((c) => c.name === name);
    if (!comp) return sendError(res, 404, 'Komponente nicht in der Bibliothek');
    if (!prompt || prompt.length > 10000) return sendError(res, 400, 'Bitte beschreiben, was sich ändern soll');
    if (variant && !comp.varianten.some((v) => v.key === variant)) return sendError(res, 404, 'Variante nicht gefunden');
    let newVariant = null;
    if (body.newVariant) {
      const key = String(body.newVariant.key || ''), label = String(body.newVariant.label || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(key) || key.length > 40) return sendError(res, 400, 'Ungültiger Variantenname (a-z, 0-9, Bindestrich)');
      if (comp.varianten.some((v) => v.key === key)) return sendError(res, 400, `Variante ${key} gibt es schon`);
      newVariant = { key, label: label || key };
    }
    if (await draftBusyCheck(res, slug)) return;
    return send(res, 202, { job: await createJob('draft', slug, { site: slug, mode: 'library', component: name, variant, newVariant, prompt, viewport: null, references: [] }) });
  }
```

- [ ] **Step 5: Tests laufen lassen**

Run: `bash tests/run.sh 2>&1 | grep -E "✗|Ergebnis"`
Expected: `0 fehlgeschlagen`

- [ ] **Step 6: Commit**

```bash
git add tools/server/index.js scripts/lib/components.mjs tests/page-import-server-test.mjs
git commit -m "Server: Entwurf für Bibliotheks-Komponenten, Vorschau auf der Komponentenseite, Abweichungen"
```

---

### Task 5: Overlay – Pflege auf der Komponentenseite

**Files:**
- Modify: `tools/overlay/overlay.js` (`libraryControls` ~Zeile 1972, `RELOAD_TYPES`/`STATE_TYPES` Zeile 26/28, `TYPE_LABEL` ~874, `onFinished` ~2238, Entwürfe-Panel ~3645 und ~3871, Abschluss eines `draft`-Jobs ~2197)
- Test: Browser (Playwright-Skript im Scratchpad), `tests/run.sh` (Syntax: `node --check tools/overlay/overlay.js`)

**Interfaces:**
- Consumes: `POST components/draft`, `POST components/sync` (Task 2, 4); `data-kb-off` (Task 4); `draft-apply`-Ausgabe `deviating` (Task 3)
- Produces: keine

- [ ] **Step 1: Knöpfe und Formulare in `libraryControls`**

`delButton` bleibt. Neue Helfer im selben Stil (Inline-Styles, `data-modio`-Attribute, weil sie im DOM der Seite liegen):

```js
    var BTN = 'cursor:pointer;background:#fff;border:1px solid #d0d5dd;border-radius:6px;padding:3px 8px;margin-left:6px;font:12px system-ui,sans-serif;color:#344054;vertical-align:middle';
    function textBtn(label, title) { var b = el('button', { type: 'button', title: title || label, 'data-modio': 'kb-btn', text: label }); b.style.cssText = BTN; return b; }
    // Formular unter der Überschrift: Prompt (und für neue Varianten Name und Bezeichnung)
    function openForm(sec, opts) {
      var old = sec.querySelector('[data-modio="kb-form"]'); if (old) old.remove();
      var f = el('div', { 'data-modio': 'kb-form' });
      f.style.cssText = 'margin:8px 0 12px;padding:10px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa;font:13px system-ui,sans-serif;display:grid;gap:6px';
      var key = null, lab = null;
      if (opts.newVariant) {
        key = el('input', { type: 'text', placeholder: 'name, z. B. kompakt', maxlength: '40', spellcheck: 'false', 'aria-label': 'Name der Variante' });
        lab = el('input', { type: 'text', placeholder: 'Bezeichnung, z. B. Kompakt', maxlength: '60', 'aria-label': 'Bezeichnung der Variante' });
        f.appendChild(key); f.appendChild(lab);
      }
      var ta = el('textarea', { rows: '3', placeholder: opts.newVariant ? 'Worin unterscheidet sich die Variante?' : 'Was soll sich ändern?', 'aria-label': 'Auftrag' });
      var err = el('div'); err.style.color = '#b42318';
      var go = textBtn('Entwurf erstellen'), cancel = textBtn('Abbrechen');
      go.style.marginLeft = '0';
      f.appendChild(ta); f.appendChild(el('div', {}, [go, cancel])); f.appendChild(err);
      [key, lab, ta].forEach(function (i) { if (i) i.style.cssText = 'font:13px system-ui,sans-serif;padding:5px 7px;border:1px solid #d0d5dd;border-radius:6px'; });
      cancel.addEventListener('click', function () { f.remove(); });
      go.addEventListener('click', function () {
        var body = { name: opts.name, prompt: ta.value.trim() };
        if (opts.variant) body.variant = opts.variant;
        if (opts.newVariant) {
          var k = key.value.trim();
          if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(k)) { err.textContent = 'Name: Kleinbuchstaben, Ziffern und Bindestrich, mit einem Buchstaben beginnen.'; key.focus(); return; }
          body.newVariant = { key: k, label: lab.value.trim() || k };
          if (!body.prompt) body.prompt = 'Neue Variante ' + k;
        }
        if (!body.prompt) { err.textContent = 'Bitte beschreiben, was sich ändern soll.'; ta.focus(); return; }
        go.disabled = true; err.textContent = '';
        api('POST', '/api/sites/' + encodeURIComponent(SLUG) + '/components/draft', body)
          .then(function (d) { if (d && d.job) trackJob(d.job); f.remove(); showToast('Claude entwirft die Änderung an mx-' + opts.name + ' … Die Vorschau öffnet sich danach.', false); })
          .catch(function (e) { go.disabled = false; err.textContent = e.status === 409 ? 'Es läuft noch ein Auftrag.' : e.message; });
      });
      (opts.after || sec.querySelector('.kb-meta') || sec.firstChild).after(f);
      (key || ta).focus();
    }
```

In der Schleife über `.kb-comp` nach dem Lösch-Knopf an der Überschrift:

```js
      var off = Number(sec.getAttribute('data-kb-off')) || 0;
      var bEdit = textBtn('Ändern …', 'Komponente mit Claude ändern (Entwurf mit Vorschau)');
      bEdit.addEventListener('click', function () { openForm(sec, { name: name }); });
      var bVar = textBtn('Variante hinzufügen …');
      bVar.addEventListener('click', function () { openForm(sec, { name: name, newVariant: true }); });
      if (h) { h.appendChild(bEdit); h.appendChild(bVar); }
      if (off && !PREVIEW) {
        var bSync = textBtn(off + ' Kopie(n) angleichen', 'Abweichende Kopien auf den Seiten nach der Vorlage neu aufbauen; Inhalte und Kontextklassen bleiben');
        bSync.style.borderColor = '#7c3aed'; bSync.style.color = '#5b21b6';
        bSync.addEventListener('click', function () {
          if (isBusy()) { showToast('Es läuft noch ein Schritt. Bitte warten.', true); return; }
          if (!confirm(off + ' Kopie(n) von mx-' + name + ' nach der Vorlage neu aufbauen?\n\nTexte, Bilder, Links und Kontextklassen bleiben. Nicht eindeutig zuzuordnende Kopien bleiben unverändert.\n\nZurückholen über den Verlauf.')) return;
          bSync.disabled = true;
          api('POST', '/api/sites/' + encodeURIComponent(SLUG) + '/components/sync', { name: name })
            .then(function (d) { if (d && d.job) trackJob(d.job); showToast('Kopien werden angeglichen …', false); })
            .catch(function (e) { bSync.disabled = false; showToast('Angleichen fehlgeschlagen: ' + e.message, true, true); });
        });
        if (h) h.appendChild(bSync);
      }
```

Pro Variante (in der inneren Schleife, auch bei nur einer Variante – die `return`-Zeile `if (vars.length < 2) return;` gilt nur noch für die Lösch-Knöpfe):

```js
        var bv = textBtn('Ändern …', 'Nur diese Variante ändern');
        bv.addEventListener('click', function () { openForm(sec, { name: name, variant: key, after: lab }); });
        if (lab) lab.appendChild(bv);
```

Die Schleife dafür so umbauen, dass `vars.length < 2` nur den `delButton` der Variante auslässt. In der Vorschau (`PREVIEW` gesetzt) keine Knöpfe außer bei der Entwurfs-Komponente ausblenden: am Anfang von `libraryControls` `if (PREVIEW) return;` – die Pflege geschieht auf der normalen Komponentenseite, in der Vorschau steuert das Entwürfe-Panel.

- [ ] **Step 2: Job-Typ `component-sync` und Texte**

- Zeile 26/28: `'component-sync': 1` in `RELOAD_TYPES` und `STATE_TYPES`.
- `TYPE_LABEL` (~874): `'component-sync': 'Kopien angleichen',`
- `onFinished` nach dem `component-delete`-Zweig:

```js
    } else if (job.type === 'component-sync') {
      msg = r.status === 'nochange' ? 'Keine Kopie weicht ab.' : (r.synced || 0) + ' Kopie(n) von mx-' + (r.name || '') + ' angeglichen (' + (r.annotationId || '') + ').'
        + (r.placeholders && r.placeholders.length ? '\nMit Beispielinhalt (neue Pflicht-Inhalte): ' + r.placeholders.slice(0, 5).map(function (x) { return x.page + ' ' + x.slot; }).join(', ') : '')
        + (r.skipped && r.skipped.length ? '\nNicht angeglichen: ' + r.skipped.slice(0, 5).map(function (x) { return x.page + ' (' + x.reason + ')'; }).join(', ') : '');
```

- `draft-apply` im Zweig `annotate|local-commit|inspect-apply|draft-apply`: nach den Hinweisen

```js
      if (job.type === 'draft-apply' && r.deviating) msg += '\n\n' + r.deviating + ' Kopie(n) weichen jetzt von der Vorlage ab. Auf der Komponentenseite „angleichen“.';
```

- Entwürfe-Panel (~3645): für `d.target === 'library'` statt Seite/Selektor den Text `'Komponentenseite · mx-' + d.component + (d.newVariant ? ' · neue Variante ' + d.newVariant.key : d.variant ? ' · Variante ' + d.variant : '')`; gleiche Behandlung in der Liste (~3629).
- Übernehmen-Bestätigung (~3871): bei `d.target === 'library'`: `'Version ' + v.v + ' von ' + d.id + ' übernehmen? Vorlage, CSS und Beschreibung von mx-' + d.component + ' werden ersetzt; das CSS wirkt sofort auf allen Seiten. Kopien mit geändertem Aufbau gleichst du danach auf der Komponentenseite an.'`

- [ ] **Step 3: Syntax und Suite**

Run: `node --check tools/overlay/overlay.js && bash tests/run.sh 2>&1 | grep -E "✗|Ergebnis"`
Expected: keine Ausgabe von `node --check`, `0 fehlgeschlagen`

- [ ] **Step 4: Browser-Prüfung**

Testprojekt wie in Stufe 1 (`modio-ui-test`, neues Projekt mit Seite und Komponente über Fake-Claude), Server mit `MODIO_API_TOKEN="$(openssl rand -hex 32)"`, Worker mit `PATH=tests/fake-claude:$PATH`. Playwright-Skript im Scratchpad (`p.on('dialog', d => d.accept())`):
1. `/s/modio-ui-test/__komponenten` öffnen → Knöpfe „Ändern …“, „Variante hinzufügen …“ sichtbar.
2. „Variante hinzufügen …“ → Name `kompakt`, Text → „Entwurf erstellen“ → nach Jobende Vorschau-URL `__komponenten?__modio_draft=…` mit Variante `kompakt` im Seiteninhalt.
3. Im Entwürfe-Panel übernehmen → Seite lädt neu, Variante `kompakt` sichtbar, Verlauf A-xxx.
4. Mit `FAKE_CLAUDE_LIB_WRAP=1` im Worker „Ändern …“ → übernehmen → Toast „N Kopie(n) weichen jetzt ab“, Knopf „N Kopie(n) angleichen“ → bestätigen → Toast mit Anzahl, Knopf verschwindet nach Reload.
Testprojekt danach löschen (`rm -rf sites/modio-ui-test`), nur `schreiner-de-shop` und `schreiner-de-shop-relaunch` bleiben.

- [ ] **Step 5: Commit**

```bash
git add tools/overlay/overlay.js
git commit -m "Overlay: Komponenten auf der Komponentenseite ändern, Varianten hinzufügen, Kopien angleichen"
```

---

### Task 6: Doku und Abschluss

**Files:**
- Modify: `README.md` (Abschnitt Komponenten-Bibliothek), `docs/api.md` (Jobtabelle, Endpunkte, Abschnitt „Komponenten-Bibliothek (neue Projekte)“), Memory `components-library-plan.md`

- [ ] **Step 1: `docs/api.md`**

- Jobtabelle: `component-sync` | `component-sync.sh <slug> <name>` | Review bei Exit 3.
- Endpunkte: `POST /api/sites/<slug>/components/draft` `{ name, prompt, variant?, newVariant?: {key,label} }` → 202 `{ job }` (Typ `draft`, `mode: "library"`), 400/404/409; `POST /api/sites/<slug>/components/sync` `{ name }` → 202 `{ job }`, 404, 409.
- `GET …/drafts`: Felder `target`, `newVariant`.
- Abschnitt Bibliothek: Absätze „Ändern auf der Komponentenseite“ (Material = Vorlage, Ziel `__komponenten`, Übernahme schreibt nur `components/`, Herkunft bleibt, verwendete Varianten Pflicht über `DRAFT_REQUIRED_VARIANTS`), „Vorschau“ (`/__komponenten?__modio_draft=…`), „Angleichen“ (Regeln aus `syncInstance`: Slots nach Schlüssel und Reihenfolge, Attribute `src srcset sizes alt width height href target rel title aria-label datetime loading`, Icon-Klasse, eingebettete Komponenten, Kontextklassen und `id`; optionale fehlende Slots entfallen, fehlende Pflicht-Slots behalten den Beispielinhalt; Mehrdeutiges und unbekannte Varianten bleiben unverändert).

- [ ] **Step 2: `README.md`**

Im Abschnitt zur Bibliothek: „Auf der Komponentenseite: Ändern …, Variante hinzufügen …, N Kopien angleichen.“ – zwei, drei Sätze.

- [ ] **Step 3: Volle Suite**

Run: `bash tests/run.sh 2>&1 | tail -1`
Expected: `Ergebnis: N bestanden, 0 fehlgeschlagen`

- [ ] **Step 4: Commit**

```bash
git add README.md docs/api.md
git commit -m "Doku: Komponenten-Bibliothek Stufe 2"
```

- [ ] **Step 5: Memory aktualisieren**

In `components-library-plan.md`: Stufe 2 umgesetzt (Commits), offen nur noch Stufe 3 (Verschachtelung) und ggf. Formular-Einsetzen auf Seiten.

---

## Nicht in diesem Plan (bewusst)

- **Komponente per Formular auf einer Seite einsetzen** (Stufe 2 im ersten Konzept): Claude setzt Komponenten aus der Bibliothek bereits per Annotation ein. Ein Formular (Komponente, Variante, Slots ausfüllen, Position) ist ein eigener Plan, wenn gewünscht.
- **Automatisches Angleichen nach dem Übernehmen:** Bewusst ein eigener Schritt mit Bestätigung, damit Änderung und Angleichen getrennt im Verlauf stehen und einzeln zurückgenommen werden können.
