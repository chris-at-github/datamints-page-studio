# Pfadleiste im Annotationsdialog

## Ziel
Nach der Auswahl eines Elements soll man im Annotationsdialog ein übergeordnetes Element wählen können, mit Vorschau auf der Seite beim Hover.

## Verhalten
- Die Selektorzeile im Dialog wird zur Pfadleiste: `body › main › section.hero › h2`. Jedes Glied ist ein Button mit Tag plus ID oder erster sprechender Klasse; der Tooltip zeigt die längere Beschreibung.
- Die Leiste reicht immer vom `body` bis zum ursprünglich angeklickten Element. Nach dem Wechsel auf ein Elternelement kann man also wieder hinunterspringen.
- Die aktuelle Auswahl ist markiert (`aria-current="true"`, orange).
- Hover oder Tastaturfokus auf einem Glied zeigt einen gestrichelten lila Rahmen mit Label und Größe auf der Seite. Der feste Auswahlrahmen bleibt sichtbar. Verlässt die Maus das Glied oder geht der Fokus weg, verschwindet die Vorschau. Beim Scrollen und bei Größenänderungen wandert sie mit.
- Ein Klick macht das Glied zur Auswahl. Selektor, Auswahlrahmen und die gesendeten Daten (`selector`, `html`, `text`) beziehen sich danach auf dieses Element. Prompt und Referenzbilder bleiben erhalten.
- Unter der Leiste steht klein der vollständige Selektor, der an Claude geht.

## Umsetzung
Nur `tools/overlay/overlay.js`:
- `placeBox()` positioniert einen Rahmen; `placeHighlight()` (Auswahl) und `showPreview()`/`hidePreview()` (Vorschau) nutzen es.
- Ein zweites Rahmenelement `.hl.pv` für die Vorschau.
- `renderMeta()` baut Seite, Pfadleiste und Selektor; `openPrompt()` und `selectCrumb()` rufen es auf.
- Zustand: `pathLeaf` (ursprüngliches Element) und `previewed` (Element in der Vorschau).

## Test
`tests/overlay-test.mjs`: Pfadleiste vorhanden, Hover zeigt Vorschau, Klick wählt Elternelement, Rückweg zum ursprünglichen Element.
