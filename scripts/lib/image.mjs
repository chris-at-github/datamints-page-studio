// Prüft und normalisiert ein Referenzbild: skaliert auf max. Kantenlänge, entfernt Metadaten.
// Aufruf: node image.mjs <eingabe> <ausgabe-ohne-endung> <max-px>
// Ausgabe: JSON {file, format, width, height}
import sharp from 'sharp';

const [input, outBase, maxPx] = process.argv.slice(2);
const max = Number(maxPx) || 2000;
const meta = await sharp(input, { animated: true }).metadata();
const allowed = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp' };
const ext = allowed[meta.format];
if (!ext) {
  console.error(`Nicht erlaubtes Bildformat: ${meta.format}`);
  process.exit(1);
}
const out = `${outBase}.${ext}`;
// sharp schreibt ohne withMetadata() keine EXIF/XMP/IPTC-Daten -> Metadaten entfernt
const info = await sharp(input, { animated: meta.format === 'gif' || meta.format === 'webp' })
  .rotate()
  .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
  .toFormat(meta.format)
  .toFile(out);
process.stdout.write(JSON.stringify({ file: out, format: meta.format, width: info.width, height: info.height }));
