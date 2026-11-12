#!/usr/bin/env node
/**
 * Збирає компактний словник наголосів із текстового файлу lang-uk
 * (рядки з комбінованим акутом U+0301) у бінарний формат для швидкого пошуку.
 *
 * Формат dict.bin:
 *   8 байт  — магія "UATS1\0\0\0"
 *   u32     — кількість записів
 *   u32[]   — зсуви в блобі ключів (count + 1)
 *   u8[]    — позиція наголосу 1 (індекс голосної в ключі, 255 — немає)
 *   u8[]    — позиція наголосу 2 (другий наголос складного слова або варіант омоніма, 255 — немає)
 *   u8[]    — прапорці: 1 — обидва наголоси чинні (складне слово), 0 — це варіанти прочитання
 *   ...     — блоб ключів у UTF-8, відсортований за байтами
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = process.argv[2] ?? path.join(here, '..', 'data', 'stress.txt');
const target = process.argv[3] ?? path.join(here, '..', 'data', 'dict.bin');

const ACUTE = '\u0301';
const ACUTE_ALT = '\u00b4';

const raw = readFileSync(source, 'utf8');
const lines = raw.split('\n');

/** @type {Map<string, [number, number]>} */
const entries = new Map();
let skippedPhrases = 0;
let skippedUnstressed = 0;
let conflicts = 0;

for (const line of lines) {
  const trimmed = line.replace(/\r$/, '').trim();
  if (!trimmed) continue;
  if (/\s/.test(trimmed)) {
    skippedPhrases += 1;
    continue;
  }

  // Позиції рахуємо вже в рядку БЕЗ акутів: інакше кожен попередній акут
  // зсуває індекс наступного (і складні слова отримують наголос не на тій голосній).
  const stripped = [];
  const positions = [];
  for (const char of trimmed) {
    if (char === ACUTE || char === ACUTE_ALT) {
      if (stripped.length > 0) positions.push(stripped.length - 1);
      continue;
    }
    stripped.push(char);
  }
  if (positions.length === 0) {
    skippedUnstressed += 1;
    continue;
  }

  const key = stripped
    .join('')
    .toLowerCase()
    .replace(/[\u2019\u02bc`\u00b4]/g, "'");
  if (!key) continue;

  const unique = [...new Set(positions)].sort((a, b) => a - b).slice(0, 2);
  // Два акути в дефісному слові — це складне слово з двома наголосами
  // (Кам'яне́ць-Поді́льський). Два акути в простому слові — варіативний наголос
  // (по́ми́лка), і для TTS це два варіанти, а не два наголоси поспіль.
  const dual = unique.length > 1 && key.includes('-');
  const existing = entries.get(key);
  if (!existing) {
    entries.set(key, { p1: unique[0] ?? 255, p2: unique[1] ?? 255, dual });
  } else if (dual && !existing.dual) {
    entries.set(key, { p1: unique[0] ?? 255, p2: unique[1] ?? 255, dual: true });
  } else if (!dual && !existing.dual) {
    const merged = [...new Set([existing.p1, existing.p2, ...unique])].filter((p) => p !== 255).sort((a, b) => a - b);
    if (merged.length > 2) conflicts += 1;
    entries.set(key, { p1: merged[0] ?? 255, p2: merged[1] ?? 255, dual: false });
  }
}

const keys = [...entries.keys()].sort((a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')));
const count = keys.length;

const positions = Buffer.alloc(count * 2);
const flags = Buffer.alloc(count);
const keyBuffers = keys.map((key, index) => {
  const buffer = Buffer.from(key, 'utf8');
  if (buffer.length > 254) throw new Error(`key too long: ${key}`);
  const entry = entries.get(key);
  positions[index * 2] = Math.min(entry.p1, 255);
  positions[index * 2 + 1] = Math.min(entry.p2, 255);
  flags[index] = entry.dual ? 1 : 0;
  return buffer;
});

const offsets = Buffer.alloc((count + 1) * 4);
const keysLength = keyBuffers.reduce((sum, b) => sum + b.length, 0);
const blob = Buffer.alloc(keysLength);

let cursor = 0;
for (let i = 0; i < count; i += 1) {
  offsets.writeUInt32LE(cursor, i * 4);
  keyBuffers[i].copy(blob, cursor);
  cursor += keyBuffers[i].length;
}
offsets.writeUInt32LE(cursor, count * 4);

const header = Buffer.alloc(12);
header.write('UATS1\u0000\u0000\u0000', 0, 'latin1');
header.writeUInt32LE(count, 8);

const out = Buffer.concat([header, offsets, positions, flags, blob]);
writeFileSync(target, out);

console.log(
  JSON.stringify(
    {
      sourceLines: lines.length,
      keys: count,
      skippedPhrases,
      skippedUnstressed,
      conflicts,
      bytes: out.length,
      dualStress: [...entries.values()].filter((e) => e.dual).length,
      apostrophes: keys.filter((k) => k.includes("'")).length,
      hyphenated: keys.filter((k) => k.includes('-')).length,
    },
    null,
    2,
  ),
);
