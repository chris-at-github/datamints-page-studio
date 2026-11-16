// Synchrone Ausgabe auf stdout. process.stdout.write gefolgt von process.exit schneidet bei Pipes nach 64 KB ab,
// weil Node den Rest asynchron schreibt. Diese Variante schreibt vollständig, bevor das Skript endet.
import fs from 'node:fs';

const pause = new Int32Array(new SharedArrayBuffer(4));

export function writeStdout(text) {
  const buf = Buffer.from(text, 'utf8');
  let off = 0;
  while (off < buf.length) {
    try {
      off += fs.writeSync(1, buf, off);
    } catch (e) {
      if (e.code !== 'EAGAIN') throw e;
      Atomics.wait(pause, 0, 0, 5); // Leser ist noch nicht bereit
    }
  }
}

// Eine JSON-Zeile ausgeben und mit Exit-Code beenden
export function exitJson(obj, code = 0) {
  writeStdout(JSON.stringify(obj) + '\n');
  process.exit(code);
}
