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
 *   u8[]    — позиція наголосу 2 (для омонімів, 255 — немає)
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

  const chars = [...trimmed];
  const marks = [];
  for (let i = 0; i < chars.length; i += 1) {
    if (chars[i] === ACUTE || chars[i] === ACUTE_ALT) marks.push(i);
  }
  if (marks.length === 0) {
    skippedUnstressed += 1;
    continue;
  }

  const key = trimmed
    .replace(/[\u0301\u00b4]/g, '')
    .toLowerCase()
    .replace(/[\u2019\u02bc`\u00b4]/g, "'");
  if (!key) continue;

  // Позиція наголосу — індекс голосної, після якої стоїть акут.
  const positions = [];
  for (const markIndex of marks) {
    let vowel = markIndex - 1;
    while (vowel >= 0 && /[\u0301\u00b4]/.test(chars[vowel])) vowel -= 1;
    if (vowel >= 0) positions.push(vowel);
  }
  if (positions.length === 0) continue;

  const unique = [...new Set(positions)].sort((a, b) => a - b).slice(0, 2);
  const existing = entries.get(key);
  if (!existing) {
    entries.set(key, [unique[0] ?? 255, unique[1] ?? 255]);
  } else {
    const merged = [...new Set([existing[0], existing[1], ...unique])].filter((p) => p !== 255).sort((a, b) => a - b);
    if (merged.length > 2) conflicts += 1;
    entries.set(key, [merged[0] ?? 255, merged[1] ?? 255]);
  }
}

const keys = [...entries.keys()].sort((a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')));
const count = keys.length;

const positions = Buffer.alloc(count * 2);
const keyBuffers = keys.map((key, index) => {
  const buffer = Buffer.from(key, 'utf8');
  if (buffer.length > 254) throw new Error(`key too long: ${key}`);
  const [p1, p2] = entries.get(key);
  positions[index * 2] = Math.min(p1 ?? 255, 255);
  positions[index * 2 + 1] = Math.min(p2 ?? 255, 255);
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

const out = Buffer.concat([header, offsets, positions, blob]);
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
      apostrophes: keys.filter((k) => k.includes("'")).length,
      hyphenated: keys.filter((k) => k.includes('-')).length,
    },
    null,
    2,
  ),
);
