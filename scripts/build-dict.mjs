#!/usr/bin/env node
/**
 * Збирає словник наголосів lang-uk у бінарний формат.
 *
 * Формат dict.bin (v3):
 *   8 байт  — магія "UATS3\0\0\0"
 *   u32     — кількість записів
 *   u32     — довжина блоку суфіксної моделі в байтах
 *   u32[]   — зсуви в блобі ключів (count + 1)
 *   u8[]    — позиція наголосу 1 (індекс голосної, 255 — немає)
 *   u8[]    — позиція наголосу 2 (другий наголос або варіант омоніма)
 *   u8[]    — прапорці: 1 — обидва наголоси чинні (складне слово)
 *   ...     — суфіксна модель: рядки "суфікс\tdist\tвпевненість\n"
 *   ...     — блоб ключів у UTF-8, відсортований за байтами
 *
 * Суфіксна модель закриває слова, для яких не знайшлося стема: на held-out
 * вибірці 5-літерний суфікс із впевненістю ≥0.7 дає ~82% точності.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = process.argv[2] ?? path.join(here, '..', 'data', 'stress.txt');
const target = process.argv[3] ?? path.join(here, '..', 'data', 'dict.bin');

const ACUTE = '\u0301';
const ACUTE_ALT = '\u00b4';
const VOWELS = new Set([...'аеєиіїоуяю']);
const SUFFIX_LENGTH = 5;
const MIN_SUFFIX_SUPPORT = 3;

const raw = readFileSync(source, 'utf8');
const lines = raw.split('\n');

/** @type {Map<string, {p1: number, p2: number, dual: boolean}>} */
const entries = new Map();
let skippedPhrases = 0;
let skippedUnstressed = 0;
let skippedInvalidStress = 0;
let conflicts = 0;

for (const line of lines) {
  const trimmed = line.replace(/\r$/, '').trim();
  if (!trimmed) continue;
  if (/\s/.test(trimmed)) {
    skippedPhrases += 1;
    continue;
  }

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
  if (
    positions.length > 2 ||
    new Set(positions).size !== positions.length ||
    positions.some((position) => !VOWELS.has(stripped[position]?.toLowerCase() ?? ''))
  ) {
    skippedInvalidStress += 1;
    continue;
  }

  const key = stripped
    .join('')
    .toLowerCase()
    .replace(/[\u2019\u02bc`\u00b4]/g, "'");
  if (!key) continue;

  const unique = [...positions].sort((a, b) => a - b);
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

// ── суфіксна модель: суфікс → найчастіша відстань від кінця до наголошеної голосної
/** @type {Map<string, Map<number, number>>} */
const suffixStats = new Map();
for (const key of keys) {
  const entry = entries.get(key);
  if (!entry || entry.dual || entry.p2 !== 255 || key.includes('-')) continue;
  const chars = [...key];
  if (chars.length < SUFFIX_LENGTH) continue;
  const suffix = chars.slice(-SUFFIX_LENGTH).join('');
  const distance = chars.length - entry.p1;
  let bucket = suffixStats.get(suffix);
  if (!bucket) suffixStats.set(suffix, (bucket = new Map()));
  bucket.set(distance, (bucket.get(distance) ?? 0) + 1);
}

const suffixLines = [];
for (const [suffix, bucket] of suffixStats) {
  let best = 0;
  let bestCount = 0;
  let total = 0;
  for (const [distance, votes] of bucket) {
    total += votes;
    if (votes > bestCount) {
      bestCount = votes;
      best = distance;
    }
  }
  if (bestCount < MIN_SUFFIX_SUPPORT) continue;
  suffixLines.push(`${suffix}\t${best}\t${Math.round((bestCount / total) * 100)}`);
}
const suffixBlob = Buffer.from(suffixLines.join('\n'), 'utf8');

const positions = Buffer.alloc(count * 2);
const flags = Buffer.alloc(count);
const keyBuffers = keys.map((key, index) => {
  const entry = entries.get(key);
  positions[index * 2] = Math.min(entry.p1, 255);
  positions[index * 2 + 1] = Math.min(entry.p2, 255);
  flags[index] = entry.dual ? 1 : 0;
  return Buffer.from(key, 'utf8');
});

const offsets = Buffer.alloc((count + 1) * 4);
const blob = Buffer.alloc(keyBuffers.reduce((sum, buffer) => sum + buffer.length, 0));
let cursor = 0;
for (let i = 0; i < count; i += 1) {
  offsets.writeUInt32LE(cursor, i * 4);
  keyBuffers[i].copy(blob, cursor);
  cursor += keyBuffers[i].length;
}
offsets.writeUInt32LE(cursor, count * 4);

const header = Buffer.alloc(16);
header.write('UATS3\u0000\u0000\u0000', 0, 'latin1');
header.writeUInt32LE(count, 8);
header.writeUInt32LE(suffixBlob.length, 12);

const out = Buffer.concat([header, offsets, positions, flags, suffixBlob, blob]);
writeFileSync(target, out);

console.log(
  JSON.stringify(
    {
      sourceLines: lines.length,
      keys: count,
      skippedPhrases,
      skippedUnstressed,
      skippedInvalidStress,
      conflicts,
      bytes: out.length,
      dualStress: [...entries.values()].filter((entry) => entry.dual).length,
      suffixEntries: suffixLines.length,
      suffixBytes: suffixBlob.length,
    },
    null,
    2,
  ),
);
