// Komponenten-Bibliothek (neue Projekte): Komponenten mit Beschreibung, Varianten und austauschbaren Inhalten (Slots).
// Eine Bibliotheks-Komponente besteht aus drei Dateien in components/:
//   mx-<name>.css   CSS in @scope (.mx-<name>) (wie jede übernommene Komponente)
//   mx-<name>.html  Vorlage: genau ein Wurzelelement mit Klasse mx-<name> und data-mx-variant="<Standardvariante>",
//                   austauschbare Stellen mit data-mx-slot="<key>" (alle Slots aller Varianten)
//   mx-<name>.json  Beschreibung: { name, title, beschreibung, herkunft, slots: [{ key, label, typ, pflicht }],
//                   varianten: [{ key, label, klassen, slots? }] }  (erste Variante = Standard)
// Varianten sind feste, benannte Klassenkombinationen (Modifier mx-<name>--…) auf dem Wurzelelement; "slots" einer
// Variante nennt die Slots, die es in ihr gibt (ohne Angabe: alle).
// Eingesetzte Komponenten (Instanzen) sind Kopien der Vorlage mit Klasse mx-<name> und data-mx-variant. Die Wurzel einer
// Instanz darf zusätzliche Klassen tragen (Kontextklassen, z. B. produktkarte__aktion), gestaltet von der Umgebung.
// Elemente mit Klasse mx-<name>, aber ohne data-mx-variant, sind keine Instanzen mehr (gelöschte Komponente/Variante).
//
// Aufruf: node components.mjs list <site-dir>                  -> { components: [...] }
//         node components.mjs render <site-dir> <name> [variante] -> HTML der Variante auf stdout
//         node components.mjs delete <site-dir> <name> [variante]  -> Komponente bzw. Variante löschen (siehe deleteFromLibrary)
//         node components.mjs sync <site-dir> <name>           -> abweichende Kopien angleichen (siehe syncLibrary)
//         node components.mjs rename <site-dir> <name> <neu>   -> Komponente umbenennen (siehe renameLibrary)
//         node components.mjs merge <site-dir> <quelle> <ziel> <variante> -> zusammenführen (siehe mergeLibrary)
//         node components.mjs uses <site-dir> <name>           -> { total, refs, variants }
//         node components.mjs deviations <site-dir>            -> { <name>: abweichende Kopien }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCheerio, sitePages } from './consistency.mjs';
import { exitJson, writeStdout } from './stdout.mjs';

export const SLOT_TYPES = ['text', 'richtext', 'bild', 'icon', 'link', 'liste'];
const KEY_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MAX_SLOTS = 30;
const MAX_VARIANTS = 12;

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const readFile = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function rootOf($) {
  const top = $.root().contents().toArray().filter((n) => n.type !== 'comment' && !(n.type === 'text' && !n.data.trim()));
  return top.length === 1 && top[0].type === 'tag' ? top[0] : null;
}
// Seite byte-treu lesen: UTF-8, sonst latin1 (alte Abzüge)
function readPage(file) {
  const buf = fs.readFileSync(file);
  const utf8 = buf.toString('utf8');
  const enc = Buffer.from(utf8, 'utf8').equals(buf) ? 'utf8' : 'latin1';
  return { text: enc === 'utf8' ? utf8 : buf.toString('latin1'), enc };
}
const classesOf = (node) => String(node.attribs?.class || '').split(/\s+/).filter(Boolean);

// Prüft Beschreibung und Vorlage einer Bibliotheks-Komponente. Gibt { spec, errors, warnings } zurück (spec bereinigt).
export function validateLibrary(cheerio, { name, html, json, css = '' }) {
  const errors = [];
  const warnings = [];
  const where = 'component.json';
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { spec: null, errors: [`${where} fehlt oder ist kein Objekt`], warnings };
  if (json.name !== name) errors.push(`${where}: name muss "${name}" sein`);
  const title = str(json.title, 80);
  if (!title) errors.push(`${where}: title fehlt`);
  const beschreibung = str(json.beschreibung, 400);
  if (!beschreibung) warnings.push(`${where}: beschreibung fehlt (wofür die Komponente gedacht ist)`);

  const slots = [];
  const slotKeys = new Set();
  const rawSlots = Array.isArray(json.slots) ? json.slots : (json.slots === undefined ? [] : null);
  if (!rawSlots) errors.push(`${where}: slots muss eine Liste sein`);
  else {
    if (rawSlots.length > MAX_SLOTS) errors.push(`${where}: höchstens ${MAX_SLOTS} Slots`);
    rawSlots.slice(0, MAX_SLOTS).forEach((s, i) => {
      const w = `${where} slots[${i}]`;
      const key = s && typeof s.key === 'string' ? s.key : '';
      if (!KEY_RE.test(key) || key.length > 40) { errors.push(`${w}: key "${key}" ungültig (a-z, 0-9, Bindestrich)`); return; }
      if (slotKeys.has(key)) errors.push(`${w}: key "${key}" doppelt`);
      slotKeys.add(key);
      if (!SLOT_TYPES.includes(s.typ)) errors.push(`${w}: typ muss ${SLOT_TYPES.join(', ')} sein`);
      slots.push({ key, label: str(s.label, 60) || key, typ: s.typ, pflicht: s.pflicht !== false });
    });
  }

  const varianten = [];
  const varKeys = new Set();
  const modRe = new RegExp(`^mx-${name}--[a-z0-9]+(?:-[a-z0-9]+)*$`);
  if (!Array.isArray(json.varianten) || !json.varianten.length) errors.push(`${where}: varianten fehlt (mindestens eine, die erste ist der Standard)`);
  else {
    if (json.varianten.length > MAX_VARIANTS) errors.push(`${where}: höchstens ${MAX_VARIANTS} Varianten`);
    json.varianten.slice(0, MAX_VARIANTS).forEach((v, i) => {
      const w = `${where} varianten[${i}]`;
      const key = v && typeof v.key === 'string' ? v.key : '';
      if (!KEY_RE.test(key) || key.length > 40) { errors.push(`${w}: key "${key}" ungültig (a-z, 0-9, Bindestrich)`); return; }
      if (varKeys.has(key)) errors.push(`${w}: key "${key}" doppelt`);
      varKeys.add(key);
      const klassen = typeof v.klassen === 'string' ? v.klassen.split(/\s+/).filter(Boolean) : [];
      if (v.klassen !== undefined && typeof v.klassen !== 'string') errors.push(`${w}: klassen muss ein Text sein`);
      for (const k of klassen) if (!modRe.test(k)) errors.push(`${w}: Klasse "${k}" muss mx-${name}--… heißen`);
      let vslots = null;
      if (v.slots !== undefined) {
        if (!Array.isArray(v.slots)) errors.push(`${w}: slots muss eine Liste sein`);
        else {
          vslots = v.slots.filter((k) => typeof k === 'string');
          for (const k of vslots) if (!slotKeys.has(k)) errors.push(`${w}: Slot "${k}" ist nicht beschrieben`);
        }
      }
      for (const k of klassen) if (css && !css.includes(`.${k}`)) warnings.push(`${w}: Klasse ${k} kommt im CSS nicht vor`);
      varianten.push({ key, label: str(v.label, 60) || key, klassen: klassen.join(' '), ...(vslots ? { slots: vslots } : {}) });
    });
  }

  // Vorlage: Wurzel mit Standardvariante, Slots wie beschrieben
  if (html) {
    const $ = cheerio.load(html, null, false);
    const root = rootOf($);
    if (root) {
      const vk = root.attribs['data-mx-variant'];
      const v = varianten.find((x) => x.key === vk);
      if (!vk) errors.push(`component.html: Wurzelelement braucht data-mx-variant (z. B. "${varianten[0]?.key || 'standard'}")`);
      else if (!v) errors.push(`component.html: data-mx-variant="${vk}" ist keine beschriebene Variante`);
      else {
        const cls = classesOf(root);
        const mods = cls.filter((c) => c.startsWith(`mx-${name}--`));
        const want = v.klassen ? v.klassen.split(' ') : [];
        if (want.some((k) => !cls.includes(k)) || mods.some((k) => !want.includes(k))) errors.push(`component.html: Klassen der Wurzel passen nicht zur Variante "${vk}" (${want.join(' ') || 'keine Modifier'})`);
      }
      const used = new Set($('[data-mx-slot]').map((_, n) => $(n).attr('data-mx-slot')).get());
      // Slots eingebetteter Komponenten (Element mit data-mx-variant unterhalb der Wurzel) gehören zu diesen; beschreiben
      // darf die äußere sie (bisher üblich), muss es aber nicht
      const inNested = (n) => { for (let x = n; x && x !== root; x = x.parent) if (x.attribs?.['data-mx-variant'] !== undefined) return true; return false; };
      const own = new Set($('[data-mx-slot]').toArray().filter((n) => !inNested(n)).map((n) => n.attribs['data-mx-slot']));
      for (const k of own) if (!slotKeys.has(k)) errors.push(`component.html: data-mx-slot="${k}" ist in component.json nicht beschrieben`);
      for (const k of slotKeys) if (!used.has(k)) errors.push(`component.html: Slot "${k}" fehlt in der Vorlage (data-mx-slot="${k}"; die Vorlage enthält alle Slots aller Varianten)`);
    }
  }
  const spec = errors.length ? null : { name, title, beschreibung, slots, varianten };
  return { spec, errors, warnings };
}

// HTML einer Variante aus der Vorlage: Modifier der Wurzel tauschen, Slots, die es in der Variante nicht gibt, entfernen
export function renderVariant(cheerio, template, spec, variantKey) {
  const v = spec.varianten.find((x) => x.key === variantKey) || spec.varianten[0];
  const $ = cheerio.load(template, null, false);
  const root = rootOf($);
  if (!root) return template;
  const r = $(root);
  for (const c of classesOf(root)) if (c.startsWith(`mx-${spec.name}--`)) r.removeClass(c);
  if (v.klassen) r.addClass(v.klassen);
  r.attr('data-mx-variant', v.key);
  if (v.slots) $('[data-mx-slot]').each((_, n) => { if (!v.slots.includes($(n).attr('data-mx-slot'))) $(n).remove(); });
  return $.html(root);
}

// Darstellung auf der Komponentenseite (beeinflusst die Komponente nicht): { breite?, spalten? } oder null.
// breite: px, die die Komponente an ihrem Einsatzort hatte (beim Anlegen gemessen); spalten: Varianten je Zeile
// (z. B. 3 bei Gestaltung × Form: eine Zeile je Gestaltung)
export function previewOf(json) {
  const b = Number(json?.vorschau?.breite), n = Number(json?.vorschau?.spalten);
  const out = {
    ...(Number.isFinite(b) && b >= 24 && b <= 4000 ? { breite: Math.round(b) } : {}),
    ...(Number.isInteger(n) && n >= 1 && n <= MAX_VARIANTS ? { spalten: n } : {}),
  };
  return Object.keys(out).length ? out : null;
}

// Bibliothek eines Projekts: alle Komponenten mit gültiger Beschreibung und Vorlage
export async function listLibrary(siteDir, { withTemplate = false } = {}) {
  const dir = path.join(siteDir, 'components');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /^mx-[a-z0-9-]+\.json$/.test(f)).sort(); } catch { return []; }
  const cheerio = await loadCheerio();
  const out = [];
  for (const f of files) {
    const name = f.slice(3, -5);
    const json = readJson(path.join(dir, f));
    const html = readFile(path.join(dir, `mx-${name}.html`));
    if (!html || !fs.existsSync(path.join(dir, `mx-${name}.css`))) continue;
    const { spec } = validateLibrary(cheerio, { name, html, json });
    if (!spec) continue;
    out.push({ ...spec, herkunft: typeof json.herkunft === 'string' ? json.herkunft : null, vorschau: previewOf(json), ...(withTemplate ? { template: html } : {}) });
  }
  return out;
}

// Ohne Prüfung der Vorlage (synchron, für den Kontext): Beschreibungen, die apply geschrieben hat
export function readLibrarySync(siteDir) {
  const dir = path.join(siteDir, 'components');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /^mx-[a-z0-9-]+\.json$/.test(f)).sort(); } catch { return []; }
  return files.map((f) => {
    const name = f.slice(3, -5);
    const j = readJson(path.join(dir, f));
    if (!j || j.name !== name || !Array.isArray(j.varianten) || !j.varianten.length || !fs.existsSync(path.join(dir, `mx-${name}.html`))) return null;
    return {
      name, title: str(j.title, 80) || name, beschreibung: str(j.beschreibung, 400), herkunft: typeof j.herkunft === 'string' ? j.herkunft : null,
      slots: (Array.isArray(j.slots) ? j.slots : []).filter((x) => x && KEY_RE.test(x.key || '')).map((x) => ({ key: x.key, label: str(x.label, 60) || x.key, typ: SLOT_TYPES.includes(x.typ) ? x.typ : 'text', pflicht: x.pflicht !== false })),
      varianten: j.varianten.filter((x) => x && KEY_RE.test(x.key || '')).map((x) => ({ key: x.key, label: str(x.label, 60) || x.key, klassen: typeof x.klassen === 'string' ? x.klassen.trim() : '', ...(Array.isArray(x.slots) ? { slots: x.slots } : {}) })),
    };
  }).filter(Boolean);
}

// ---------- Instanzen: Aufbau außerhalb der Slots mit der Vorlage vergleichen ----------

// Aufbau eines Elements: Tags und Klassen, Slots und eingebettete Komponenten nur als Platzhalter, Text egal.
// Optionale Slots zählen nicht (eine Kopie darf sie weglassen).
function structure($, node, name, libNames, optional, isRoot = true) {
  if (node.type !== 'tag') return '';
  if (!isRoot && optional.has(node.attribs['data-mx-slot'])) return '';
  const cls = classesOf(node);
  if (!isRoot) {
    const nested = cls.find((c) => c.startsWith('mx-') && libNames.has(c.slice(3)));
    if (nested) return `[${nested}]`;
  }
  if (node.attribs['data-mx-slot'] !== undefined) return `${node.name}{${node.attribs['data-mx-slot']}}`;
  const own = isRoot ? [] : cls.slice().sort(); // Wurzel: Klassen werden getrennt verglichen (Kontextklassen erlaubt)
  const kids = (node.children || []).map((c) => structure($, c, name, libNames, optional, false)).filter(Boolean);
  return `${node.name}${own.length ? '.' + own.join('.') : ''}(${kids.join(',')})`;
}

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
  // Klassen der Vorlage müssen bleiben, zusätzliche Kontextklassen auf der Wurzel sind erlaubt
  if (exp.rootClasses.some((k) => !cls.includes(k)) || structure($, node, c.name, libNames, optional) !== exp.sig) return 'Aufbau außerhalb der austauschbaren Inhalte geändert';
  return null;
}

// Abweichende Instanzen in einem HTML-Text: [{ name, variant, reason }]
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

// ---------- Verwendungen, Kennzeichnung entfernen, Löschen ----------

// Verwendungen je Komponente: { <name>: { total, refs, variants: { <key>: n } } } (refs: auch nicht gekennzeichnete Elemente)
export function countInstances(cheerio, siteDir, names) {
  const out = Object.fromEntries(names.map((n) => [n, { total: 0, refs: 0, variants: {} }]));
  for (const p of sitePages(siteDir)) {
    const text = readFile(path.join(siteDir, 'www', p));
    if (!text || !/\bmx-/.test(text)) continue;
    const $ = cheerio.load(text);
    for (const n of names) {
      for (const node of $(`.mx-${n}`).toArray()) {
        out[n].refs++;
        const vk = node.attribs['data-mx-variant'];
        if (vk === undefined) continue;
        out[n].total++;
        out[n].variants[vk] = (out[n].variants[vk] || 0) + 1;
      }
    }
  }
  return out;
}

// ---------- Angleichen: Kopie aus der Vorlage ihrer Variante neu aufbauen ----------

const SLOT_ATTRS = ['src', 'srcset', 'sizes', 'alt', 'width', 'height', 'href', 'target', 'rel', 'title', 'aria-label', 'datetime', 'loading'];
const nestedComp = (node, name, libNames) => classesOf(node).find((k) => k.startsWith('mx-') && k !== `mx-${name}` && !k.startsWith(`mx-${name}--`) && libNames.has(k.slice(3)));

// Slots und eingebettete Komponenten (Schlüssel "@mx-<name>") einer Kopie in Dokumentreihenfolge; nicht in eingebettete hinein
// Ist die Wurzel selbst ein Slot (z. B. ein Button, dessen Text der Slot ist), zählt sie als dieser Slot.
function partsOf(root, name, libNames) {
  const map = new Map();
  const add = (k, n) => { if (!map.has(k)) map.set(k, []); map.get(k).push(n); };
  if (root.attribs?.['data-mx-slot'] !== undefined) { add(root.attribs['data-mx-slot'], root); return map; }
  const walk = (n) => {
    for (const c of n.children || []) {
      if (c.type !== 'tag') continue;
      const nested = nestedComp(c, name, libNames);
      if (nested) { add('@' + nested, c); continue; }
      if (c.attribs['data-mx-slot'] !== undefined) { add(c.attribs['data-mx-slot'], c); continue; }
      walk(c);
    }
  };
  walk(root);
  return map;
}

// Neues HTML für eine Kopie ({ html, placeholders }) oder { skip: Grund }.
// placeholders: Pflicht-Slots, die die Kopie nicht hatte (bleiben mit dem Beispielinhalt der Vorlage)
// Zusammenführen (from): die Kopie ist eine Instanz der Komponente mx-<from> und wird als Variante <variant> von comp
// neu aufgebaut; Klassen der alten Vorlage (fromClasses) entfallen.
export function syncInstance(cheerio, $, node, comp, libNames, { from = comp.name, variant = null, fromClasses = [] } = {}) {
  const vk = variant || node.attribs['data-mx-variant'];
  if (!comp.varianten.some((v) => v.key === vk)) return { skip: `unbekannte Variante „${vk}“` };
  const f = cheerio.load(renderVariant(cheerio, comp.template, comp, vk), null, false);
  const froot = rootOf(f);
  if (!froot) return { skip: 'Vorlage ohne eindeutiges Wurzelelement' };
  const oldParts = partsOf(node, from, libNames);
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
  const drop = new Set(fromClasses);
  const ctx = classesOf(node).filter((k) => k !== `mx-${comp.name}` && !k.startsWith(`mx-${comp.name}--`) && k !== `mx-${from}` && !k.startsWith(`mx-${from}--`) && !own.has(k) && !drop.has(k));
  if (ctx.length) f(froot).addClass(ctx.join(' '));
  if (node.attribs.id) froot.attribs.id = node.attribs.id;
  // Übrige Attribute der Wurzel gehören zur Kopie (z. B. type="submit", data-…, aria-…), die Vorlage zeigt nur Beispiele
  for (const [a, val] of Object.entries(node.attribs)) {
    if (a === 'class' || a === 'id' || a.startsWith('data-mx-')) continue;
    froot.attribs[a] = val;
  }
  return { html: f.html(froot), placeholders };
}

// Alle abweichenden Kopien einer Komponente auf allen Seiten angleichen (schreibt die Seiten). Byte-genau: nur die
// Quelltext-Spanne der betroffenen Kopie wird ersetzt.
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
      const loc = node.sourceCodeLocation;
      if (!loc || loc.endOffset === undefined) { out.skipped.push({ page: '/' + p, reason: 'Stelle im Quelltext nicht eindeutig' }); continue; }
      // in einer bereits ersetzten Kopie: kommt mit ihr neu
      if (edits.some((e) => loc.startOffset >= e.a && loc.endOffset <= e.b)) continue;
      if (!nodeIssue(cheerio, $, node, comp, libNames, cache)) continue;
      const r = syncInstance(cheerio, $, node, comp, libNames);
      if (r.skip) { out.skipped.push({ page: '/' + p, reason: r.skip }); continue; }
      edits.push({ a: loc.startOffset, b: loc.endOffset, html: r.html });
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

// Abweichende Kopien je Komponente (für die Komponentenseite): { <name>: n }
export function deviations(cheerio, siteDir, library) {
  const out = Object.fromEntries(library.map((c) => [c.name, 0]));
  for (const p of sitePages(siteDir)) {
    const text = readFile(path.join(siteDir, 'www', p));
    if (!text || !/\bmx-/.test(text)) continue;
    for (const i of instanceIssues(cheerio, text, library)) out[i.name]++;
  }
  return out;
}

// Entfernt die Kennzeichnung (data-mx-variant der Wurzel, data-mx-slot darin) von Instanzen der Komponente, optional nur
// einer Variante. Markup und Klassen bleiben (das CSS gestaltet sie weiter). Byte-genau: nur die Attribute fallen weg.
export function unmarkInstances(cheerio, text, name, variantKey, libNames) {
  const $ = cheerio.load(text, { sourceCodeLocationInfo: true });
  const cuts = [];
  let count = 0;
  const cutAttr = (node, attr) => {
    const loc = node.sourceCodeLocation?.attrs?.[attr];
    if (!loc) return;
    let start = loc.startOffset;
    while (start > 0 && /\s/.test(text[start - 1])) start--;
    cuts.push([start, loc.endOffset]);
  };
  const walk = (node) => {
    for (const c of node.children || []) {
      if (c.type !== 'tag') continue;
      // eingebettete andere Komponenten behalten ihre Kennzeichnung
      if (classesOf(c).some((k) => k.startsWith('mx-') && k !== `mx-${name}` && libNames.has(k.slice(3)) )) continue;
      if (c.attribs['data-mx-slot'] !== undefined) cutAttr(c, 'data-mx-slot');
      walk(c);
    }
  };
  for (const node of $(`.mx-${name}`).toArray()) {
    const vk = node.attribs['data-mx-variant'];
    if (vk === undefined || (variantKey && vk !== variantKey)) continue;
    count++;
    cutAttr(node, 'data-mx-variant');
    walk(node);
  }
  if (!cuts.length) return { text, count };
  cuts.sort((a, b) => b[0] - a[0]);
  let out = text;
  for (const [a, b] of cuts) out = out.slice(0, a) + out.slice(b);
  return { text: out, count };
}

// Löscht eine Komponente aus der Bibliothek oder eine ihrer Varianten.
// Komponente: Beschreibung und Vorlage entfallen, Verwendungen verlieren die Kennzeichnung; das CSS bleibt, solange noch
//   Elemente mit Klasse mx-<name> auf den Seiten stehen (sonst wird es mitgelöscht).
// Variante: Eintrag entfällt, Verwendungen dieser Variante verlieren die Kennzeichnung (Klassen und CSS bleiben). Slots, die
//   keine verbliebene Variante mehr hat, entfallen; zeigt die Vorlage die Variante, zeigt sie danach die erste verbliebene.
// Ausgabe: { name, variant, unmarked, pages, removedFiles, keptCss, removedSlots }
export async function deleteFromLibrary(siteDir, name, variantKey) {
  const dir = path.join(siteDir, 'components');
  const cheerio = await loadCheerio();
  const library = await listLibrary(siteDir, { withTemplate: true });
  const comp = library.find((c) => c.name === name);
  if (!comp) throw new Error(`Komponente nicht in der Bibliothek: mx-${name}`);
  const libNames = new Set(library.map((c) => c.name));
  if (variantKey) {
    if (!comp.varianten.some((v) => v.key === variantKey)) throw new Error(`mx-${name} hat keine Variante „${variantKey}“`);
    if (comp.varianten.length === 1) throw new Error('Das ist die einzige Variante: stattdessen die Komponente löschen');
  }
  // Seiten: Kennzeichnung entfernen
  let unmarked = 0;
  const pages = [];
  for (const p of sitePages(siteDir)) {
    const file = path.join(siteDir, 'www', p);
    const { text, enc } = readPage(file);
    if (!text.includes(`mx-${name}`)) continue;
    const r = unmarkInstances(cheerio, text, name, variantKey, libNames);
    if (r.count) { fs.writeFileSync(file, r.text, enc); unmarked += r.count; pages.push('/' + p); }
  }
  const removedFiles = [];
  let keptCss = true;
  let removedSlots = [];
  if (!variantKey) {
    for (const ext of ['json', 'html']) { fs.rmSync(path.join(dir, `mx-${name}.${ext}`), { force: true }); removedFiles.push(`components/mx-${name}.${ext}`); }
    const refs = countInstances(cheerio, siteDir, [name])[name].refs;
    if (!refs) { fs.rmSync(path.join(dir, `mx-${name}.css`), { force: true }); removedFiles.push(`components/mx-${name}.css`); keptCss = false; }
  } else {
    const jsonFile = path.join(dir, `mx-${name}.json`);
    const json = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    json.varianten = json.varianten.filter((v) => v.key !== variantKey);
    const used = new Set();
    for (const v of json.varianten) for (const k of Array.isArray(v.slots) ? v.slots : (json.slots || []).map((x) => x.key)) used.add(k);
    removedSlots = (json.slots || []).map((x) => x.key).filter((k) => !used.has(k));
    json.slots = (json.slots || []).filter((x) => used.has(x.key));
    // Vorlage: Slots ohne Variante entfernen, Wurzel ggf. auf die erste verbliebene Variante umstellen
    const $ = cheerio.load(comp.template, null, false);
    const root = rootOf($);
    for (const k of removedSlots) $(`[data-mx-slot="${k}"]`).remove();
    if (root && root.attribs['data-mx-variant'] === variantKey) {
      const first = json.varianten[0];
      const r = $(root);
      for (const c of classesOf(root)) if (c.startsWith(`mx-${name}--`)) r.removeClass(c);
      if (first.klassen) r.addClass(first.klassen);
      r.attr('data-mx-variant', first.key);
    }
    fs.writeFileSync(path.join(dir, `mx-${name}.html`), $.html(root).trim() + '\n');
    fs.writeFileSync(jsonFile, JSON.stringify(json, null, 2) + '\n');
  }
  return { name, variant: variantKey || null, unmarked, pages, removedFiles, keptCss, removedSlots };
}

// ---------- Umbenennen und Zusammenführen ----------

// Klasse mx-<name> (auch als Modifier mx-<name>--…) als ganzes Wort, nicht mx-<name>-weiter
const nameRe = (name) => new RegExp(`(?<![\\w-])mx-${name}(?=--|[^\\w-]|$)`, 'g');

// Dateien, in denen Klassen von Komponenten stehen: Seiten und Stylesheets unter www, components/*.css|html, overrides.css
function classFiles(siteDir) {
  const out = [];
  const walk = (dir) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(html?|css)$/i.test(e.name)) out.push(f);
    }
  };
  walk(path.join(siteDir, 'www'));
  walk(path.join(siteDir, 'components'));
  if (fs.existsSync(path.join(siteDir, 'overrides.css'))) out.push(path.join(siteDir, 'overrides.css'));
  return out;
}
const rel = (siteDir, f) => path.relative(siteDir, f).split(path.sep).join('/');

// Benennt eine Bibliotheks-Komponente um: Dateien, @scope, Klassen und Modifier in allen Seiten, Vorlagen und Stylesheets.
// Byte-genau: nur die Namen werden ersetzt. Ausgabe: { name, newName, files, replaced }
export async function renameLibrary(siteDir, name, newName) {
  const dir = path.join(siteDir, 'components');
  if (!KEY_RE.test(newName) || newName.length > 60) throw new Error(`Ungültiger Name: ${newName} (a-z, 0-9, Bindestrich)`);
  if (name === newName) throw new Error('Der neue Name ist der bisherige');
  const library = await listLibrary(siteDir);
  const comp = library.find((c) => c.name === name);
  if (!comp) throw new Error(`Komponente nicht in der Bibliothek: mx-${name}`);
  if (['css', 'html', 'json'].some((x) => fs.existsSync(path.join(dir, `mx-${newName}.${x}`)))) throw new Error(`mx-${newName} gibt es schon`);
  const re = nameRe(name);
  const files = [];
  let replaced = 0;
  for (const f of classFiles(siteDir)) {
    const src = readPage(f);
    let n = 0;
    const text = src.text.replace(re, () => { n++; return `mx-${newName}`; });
    if (!n) continue;
    fs.writeFileSync(f, text, src.enc);
    files.push(rel(siteDir, f));
    replaced += n;
  }
  for (const x of ['css', 'html']) fs.renameSync(path.join(dir, `mx-${name}.${x}`), path.join(dir, `mx-${newName}.${x}`));
  // Beschreibung: Name und Modifier; die Vorschaubreite aus dem Entwurf bleibt erhalten (der Entwurf kennt den alten Namen)
  const jsonFile = path.join(dir, `mx-${name}.json`);
  const json = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  json.name = newName;
  for (const v of json.varianten || []) if (typeof v.klassen === 'string') v.klassen = v.klassen.replace(re, `mx-${newName}`);
  const measured = draftWidths(siteDir)[name];
  const w = { ...(measured ? { breite: measured } : {}), ...(previewOf(json) || {}) };
  if (Object.keys(w).length) json.vorschau = w;
  fs.writeFileSync(path.join(dir, `mx-${newName}.json`), JSON.stringify(json, null, 2) + '\n');
  fs.rmSync(jsonFile);
  return { name, newName, files, replaced };
}

// Führt die Komponente <source> in <target> zusammen: Jede Kopie von mx-<source> (auf den Seiten und in den Vorlagen
// anderer Komponenten) wird als Variante <variant> von mx-<target> neu aufgebaut. Slot-Inhalte nach Schlüssel, Kontextklassen,
// id und übrige Attribute der Wurzel bleiben. Danach entfallen Beschreibung und Vorlage von mx-<source>; ihr CSS, sobald
// kein Element die Klasse mehr trägt. Alle Slots von <source> muss es in <target> geben.
// Ausgabe: { name, into, variant, merged, pages, templates, skipped, placeholders, removedFiles, keptCss, cssRefs }
export async function mergeLibrary(siteDir, source, target, variant) {
  const dir = path.join(siteDir, 'components');
  if (source === target) throw new Error('Quelle und Ziel sind dieselbe Komponente');
  const cheerio = await loadCheerio();
  const library = await listLibrary(siteDir, { withTemplate: true });
  const src = library.find((c) => c.name === source);
  const tgt = library.find((c) => c.name === target);
  if (!src) throw new Error(`Komponente nicht in der Bibliothek: mx-${source}`);
  if (!tgt) throw new Error(`Komponente nicht in der Bibliothek: mx-${target}`);
  if (!tgt.varianten.some((v) => v.key === variant)) throw new Error(`mx-${target} hat keine Variante „${variant}“`);
  const missing = src.slots.filter((s) => !tgt.slots.some((t) => t.key === s.key)).map((s) => s.key);
  if (missing.length) throw new Error(`mx-${target} hat diese Slots von mx-${source} nicht: ${missing.join(', ')}. Erst in mx-${target} ergänzen (Ändern …)`);
  const libNames = new Set(library.map((c) => c.name));
  const st = cheerio.load(src.template, null, false);
  const fromClasses = classesOf(rootOf(st)).filter((k) => k !== `mx-${source}` && !k.startsWith(`mx-${source}--`));
  const out = { name: source, into: target, variant, merged: 0, pages: [], templates: [], skipped: [], placeholders: [], removedFiles: [], keptCss: false, cssRefs: [] };

  const migrate = (file, where) => {
    const doc = readPage(file);
    if (!nameRe(source).test(doc.text)) return 0;
    const $ = cheerio.load(doc.text, { sourceCodeLocationInfo: true });
    const edits = [];
    for (const node of $(`.mx-${source}`).toArray()) {
      if (node.attribs['data-mx-variant'] === undefined) continue;
      const loc = node.sourceCodeLocation;
      if (!loc || loc.endOffset === undefined) { out.skipped.push({ page: where, reason: 'Stelle im Quelltext nicht eindeutig' }); continue; }
      if (edits.some((e) => loc.startOffset >= e.a && loc.endOffset <= e.b)) continue;
      const r = syncInstance(cheerio, $, node, tgt, libNames, { from: source, variant, fromClasses });
      if (r.skip) { out.skipped.push({ page: where, reason: r.skip }); continue; }
      edits.push({ a: loc.startOffset, b: loc.endOffset, html: r.html });
      r.placeholders.forEach((s) => out.placeholders.push({ page: where, slot: s }));
    }
    if (!edits.length) return 0;
    let text = doc.text;
    for (const e of edits.sort((x, y) => y.a - x.a)) text = text.slice(0, e.a) + e.html + text.slice(e.b);
    fs.writeFileSync(file, text, doc.enc);
    return edits.length;
  };
  for (const p of sitePages(siteDir)) {
    const n = migrate(path.join(siteDir, 'www', p), '/' + p);
    if (n) { out.merged += n; out.pages.push('/' + p); }
  }
  for (const c of library) {
    if (c.name === source) continue;
    const n = migrate(path.join(dir, `mx-${c.name}.html`), `components/mx-${c.name}.html`);
    if (n) { out.merged += n; out.templates.push(`components/mx-${c.name}.html`); }
  }
  for (const x of ['json', 'html']) { fs.rmSync(path.join(dir, `mx-${source}.${x}`), { force: true }); out.removedFiles.push(`components/mx-${source}.${x}`); }
  // CSS bleibt, solange ein Element die Klasse trägt (z. B. übersprungene Kopien); Verweise in anderen Stylesheets melden
  const re = nameRe(source);
  for (const f of classFiles(siteDir)) {
    if (f === path.join(dir, `mx-${source}.css`)) continue;
    re.lastIndex = 0;
    if (!re.test(readPage(f).text)) continue;
    if (/\.html?$/i.test(f)) out.keptCss = true; else out.cssRefs.push(rel(siteDir, f));
  }
  if (!out.keptCss) { fs.rmSync(path.join(dir, `mx-${source}.css`), { force: true }); out.removedFiles.push(`components/mx-${source}.css`); }
  return out;
}

// ---------- Kontext für Claude ----------

export function libraryContext(library) {
  if (!library.length) return '';
  const lines = library.map((c) => {
    const vars = c.varianten.map((v) => `${v.key} („${v.label}“${v.klassen ? ': ' + v.klassen : ''}${v.slots ? '; Slots: ' + v.slots.join(', ') : ''})`).join(', ');
    const slots = c.slots.length ? c.slots.map((s) => `${s.key} (${s.typ}${s.pflicht ? '' : ', optional'})`).join(', ') : 'keine';
    return `mx-${c.name} „${c.title}“${c.beschreibung ? ' – ' + c.beschreibung : ''}\n  Varianten: ${vars}\n  Austauschbar: ${slots}\n  Vorlage: components/mx-${c.name}.html${c.herkunft ? ` (Pfade relativ zu www${path.posix.dirname(c.herkunft)}/)` : ''}`;
  });
  return [
    '<komponenten hinweis="Bibliothek dieses Projekts; vor dem Einsetzen die Vorlage mit Read lesen">',
    lines.join('\n').replace(/</g, '‹'),
    'Regeln: Verlangt der Auftrag eine dieser Komponenten (Name oder Titel) oder passt eine eindeutig, setze sie als Kopie der Vorlage ein: Wurzel mit Klasse mx-<name>, data-mx-variant und genau den Klassen der Variante; Slots, die es in der Variante nicht gibt, weglassen. Ändere nur die Inhalte der data-mx-slot-Elemente (Text, Bild mit src und alt, Icon, Link mit href und Text, Listeneinträge). Aufbau, Klassen und data-Attribute bleiben. Braucht eine Komponente an einem Einsatzort eine Anpassung (z. B. Button in einer Produktkarte), bekommt ihre Wurzel eine zusätzliche Kontextklasse (z. B. produktkarte__aktion), gestaltet im CSS der umgebenden Komponente bzw. in overrides.css; dafür keine neue Variante und kein CSS in der Komponente. Kein neues CSS für Komponenten; die Anordnung mehrerer Komponenten (z. B. ein Raster) gestaltest du in overrides.css bzw. im umgebenden Element. Relative Pfade an die Ordnertiefe der Zielseite anpassen.',
    '</komponenten>',
  ].join('\n');
}

// ---------- Bibliotheksseite ----------

// Stylesheets einer Seite (<style>-Blöcke, <link rel="stylesheet">) als Text, z. B. Schriften und Icon-Fonts der Herkunftsseite
function pageStyles(siteDir, page) {
  if (!page || page.includes('..')) return '';
  const text = readFile(path.join(siteDir, 'www', page));
  if (!text) return '';
  return [...text.matchAll(/<style\b[^>]*>[\s\S]*?<\/style\s*>|<link\b[^>]*>/gi)].map((m) => m[0])
    .filter((t) => (/^<style/i.test(t) || /\brel\s*=\s*["']?[^"'>]*stylesheet/i.test(t)) && !/\sdata-modio/i.test(t)).join('\n');
}

// Ab dieser Breite (px am Einsatzort) gilt eine Komponente als breit: volle Breite, Varianten untereinander
const WIDE_FROM = 640;

// Breite beim Anlegen aus den Entwürfen (Komponenten ohne vorschau in der Beschreibung): { <name>: px }, neuester Entwurf gewinnt
function draftWidths(siteDir) {
  const out = {};
  let ids = [];
  try { ids = fs.readdirSync(path.join(siteDir, 'drafts')).filter((d) => /^D-\d+$/.test(d)).sort((a, b) => Number(a.slice(2)) - Number(b.slice(2))); } catch { return out; }
  for (const id of ids) {
    const d = readJson(path.join(siteDir, 'drafts', id, 'draft.json'));
    const w = Number(d?.rect?.width);
    if (!d || d.target === 'library' || !d.component?.name || !Number.isFinite(w) || w < 24) continue;
    out[d.component.name] = Math.round(w);
  }
  return out;
}

// Komponentenseite. Die Stylesheets der Herkunftsseite stehen davor (Schriften, Icon-Fonts usw.); der Server legt sie wie
// auf jeder Seite in @layer legacy und bindet Tokens, overrides.css und das Komponenten-CSS darüber ein (injectHtml).
// override = { name, template, spec }: Entwurfsvorschau, die Komponente erscheint mit Vorlage und Beschreibung des Entwurfs.
// Jeder Abschnitt trägt data-kb-off: Kopien auf den Seiten, die von der (gezeigten) Vorlage abweichen.
export async function libraryPage(siteDir, { slug, title, override = null }) {
  const library = await listLibrary(siteDir, { withTemplate: true });
  if (override) {
    const i = library.findIndex((c) => c.name === override.name);
    const entry = { ...override.spec, herkunft: (library[i] || {}).herkunft || null, template: override.template };
    if (i >= 0) library[i] = entry; else library.push(entry);
  }
  const cheerio = await loadCheerio();
  const off = deviations(cheerio, siteDir, library);
  const b = `/s/${slug}`;
  // Pfade der Vorlagen sind relativ zur Seite, aus der die Komponente stammt
  const herkunft = library.find((c) => c.herkunft)?.herkunft || '/seiten/x.html';
  const baseDir = path.posix.dirname(herkunft).split('/').map(encodeURIComponent).join('/');
  const uses = countInstances(cheerio, siteDir, library.map((c) => c.name));
  const usesText = (n) => (n ? `${n}× verwendet` : 'nicht verwendet');
  const measured = draftWidths(siteDir);
  // Schmale Komponenten (Karten, Buttons …) in der Breite ihres Einsatzorts, Varianten nebeneinander; breite und solche
  // ohne bekannte Breite über die volle Breite, Varianten untereinander. Nur die Darstellung, die Komponente bleibt unverändert.
  const widthOf = (c) => c.vorschau?.breite || measured[c.name] || null;
  const sections = library.map((c) => ({ c, u: uses[c.name] || { total: 0, variants: {} }, n: off[c.name] || 0, w: widthOf(c) })).map(({ c, u, n, w }) => {
    const narrow = w && w < WIDE_FROM;
    const cols = c.vorschau?.spalten && c.varianten.length > 1 ? Math.min(c.vorschau.spalten, c.varianten.length) : 0;
    const style = [narrow ? `--kb-w:${w}px` : '', cols ? `--kb-cols:${cols}` : ''].filter(Boolean).join(';');
    return `<section class="kb-comp${narrow ? ' kb-schmal' : ''}${cols ? ' kb-spalten' : ''}" id="mx-${esc(c.name)}" data-kb-name="${esc(c.name)}" data-kb-uses="${u.total}" data-kb-off="${n}"${w ? ` data-kb-breite="${w}"` : ''}${style ? ` style="${style}"` : ''}>
<h2>${esc(c.title)} <code>mx-${esc(c.name)}</code></h2>
${c.beschreibung ? `<p class="kb-desc">${esc(c.beschreibung)}</p>` : ''}
<p class="kb-meta">Austauschbar: ${c.slots.length ? c.slots.map((s) => `<code>${esc(s.key)}</code> ${esc(s.label)} (${esc(s.typ)}${s.pflicht ? '' : ', optional'})`).join(' · ') : 'nichts'}${c.herkunft ? ` · aus ${esc(c.herkunft)}` : ''} · ${usesText(u.total)}${n ? ` · <strong>${n} Kopie(n) weichen ab</strong>` : ''}${narrow ? ` · Vorschau ${w} px breit wie am Einsatzort (Ecke unten rechts ziehen)` : ''}</p>
<div class="kb-vars">
${c.varianten.map((v) => `<div class="kb-var" data-kb-variant="${esc(v.key)}" data-kb-uses="${u.variants[v.key] || 0}"><p class="kb-vlabel"><span class="kb-vname" title="${esc(v.label)} (${esc(v.key)})">${esc(v.label)} <code>${esc(v.key)}</code></span> <span class="kb-uses">${usesText(u.variants[v.key] || 0)}</span></p>
<div class="kb-stage">${renderVariant(cheerio, c.template, c, v.key)}</div></div>`).join('\n')}
</div>
</section>`;
  }).join('\n');
  const t = esc(title || slug);
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t} – Komponenten</title>
<base href="${b}${baseDir}/">
${pageStyles(siteDir, herkunft)}
<style>
.kb-head,.kb-desc,.kb-meta,.kb-vlabel,.kb-comp>h2{font-family:system-ui,sans-serif}
body{margin:0;background:#f6f7f9;color:#1d2330}
.kb-head{padding:24px 32px;background:#fff;border-bottom:1px solid #e5e7eb}
.kb-head h1{margin:0 0 4px;font-size:22px}
.kb-head p{margin:0;color:#667085;font-size:14px}
.kb-comp{margin:24px 32px;padding:20px 24px;background:#fff;border:1px solid #e5e7eb;border-radius:10px}
.kb-comp>h2{margin:0 0 6px;font-size:18px}
.kb-comp>h2 code,.kb-meta code,.kb-vlabel code{font-size:12px;color:#5b21b6;background:#f3f0ff;padding:1px 5px;border-radius:4px}
.kb-desc{margin:0 0 6px;font-size:14px}
.kb-meta{margin:0 0 14px;font-size:13px;color:#667085}
.kb-vars{display:flex;flex-wrap:wrap;align-items:flex-start;gap:12px 24px}
.kb-var{flex:1 1 100%;min-width:0;border-top:1px dashed #e5e7eb;padding-top:12px}
.kb-schmal .kb-vars{border-top:1px dashed #e5e7eb;padding-top:12px}
.kb-schmal .kb-var{flex:none;width:min-content;min-width:280px;max-width:100%;border-top:0;padding-top:0}
.kb-schmal .kb-vname{flex:1 0 100%;width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.kb-schmal .kb-vlabel{row-gap:2px}
.kb-schmal .kb-uses{margin-right:auto}
.kb-vlabel{margin:0 0 8px;font-size:13px;font-weight:600;display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px}
.kb-uses{font-weight:400;color:#667085}
.kb-spalten .kb-vars{display:grid;grid-template-columns:repeat(var(--kb-cols),minmax(0,1fr))}
.kb-schmal.kb-spalten .kb-vars{grid-template-columns:repeat(var(--kb-cols),max-content)}
.kb-spalten .kb-var{width:auto}
.kb-stage{box-sizing:border-box}
.kb-stage:hover,.kb-stage.kb-drag{outline:1px dashed #98a2b3;outline-offset:3px}
.kb-schmal .kb-stage{width:calc(var(--kb-w) + 16px);padding-right:16px;min-width:40px;max-width:calc(100vw - 112px);overflow:auto;resize:horizontal}
</style>
</head>
<body>
<header class="kb-head"><h1>${t} – Komponenten</h1><p>${library.length ? `${library.length} Komponente(n) mit allen Varianten und Beispielinhalten. Mit dem CSS der Herkunftsseite als Grundlage (Schriften, Icons) wie auf den Seiten.` : 'Noch keine Komponenten. Element auswählen und im Dialog „Als Komponente …“ wählen.'}</p></header>
${sections}
<script>
// Vorschau ziehen: Rahmen bleibt sichtbar, solange gezogen wird (auch wenn der Zeiger die Vorschau verlässt)
document.addEventListener('pointerdown', (e) => {
  const st = e.target.closest && e.target.closest('.kb-stage');
  if (!st) return;
  st.classList.add('kb-drag');
  addEventListener('pointerup', () => st.classList.remove('kb-drag'), { once: true });
});
</script>
</body>
</html>
`;
}

// ---------- Kommandozeile ----------

async function main() {
  const [cmd, siteDir, name, variant] = process.argv.slice(2);
  if (cmd === 'list' && siteDir) exitJson({ components: await listLibrary(siteDir) });
  if (cmd === 'render' && siteDir && name) {
    const c = (await listLibrary(siteDir, { withTemplate: true })).find((x) => x.name === name);
    if (!c) exitJson({ error: `Komponente nicht in der Bibliothek: ${name}` }, 1);
    writeStdout(renderVariant(await loadCheerio(), c.template, c, variant) + '\n');
    process.exit(0);
  }
  if (cmd === 'delete' && siteDir && name) exitJson(await deleteFromLibrary(siteDir, name, variant || null));
  if (cmd === 'sync' && siteDir && name) exitJson(await syncLibrary(siteDir, name));
  if (cmd === 'rename' && siteDir && name && variant) exitJson(await renameLibrary(siteDir, name, variant));
  if (cmd === 'merge' && siteDir && name && variant && process.argv[6]) exitJson(await mergeLibrary(siteDir, name, variant, process.argv[6]));
  if (cmd === 'uses' && siteDir && name) exitJson(countInstances(await loadCheerio(), siteDir, [name])[name]);
  if (cmd === 'deviations' && siteDir) exitJson(deviations(await loadCheerio(), siteDir, await listLibrary(siteDir, { withTemplate: true })));
  exitJson({ error: 'Aufruf: node components.mjs list <site-dir> | render <site-dir> <name> [variante] | delete <site-dir> <name> [variante] | sync <site-dir> <name> | rename <site-dir> <name> <neuer-name> | merge <site-dir> <quelle> <ziel> <variante> | uses <site-dir> <name> | deviations <site-dir>' }, 2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => exitJson({ error: e.message }, 1));
}
