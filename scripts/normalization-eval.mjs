#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize } from '../dist/normalize.js';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rows = readFileSync(path.join(root, 'evaluation/normalization.tsv'), 'utf8')
  .split(/\r?\n/u)
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => {
    const [id, input, expected, tag] = line.split('\t');
    if (!id || input === undefined || expected === undefined) throw new Error(`malformed normalization fixture: ${line}`);
    return { id, input, expected, tag: tag ?? '' };
  });
let failed = 0;
for (const row of rows) {
  const actual = normalize(row.input);
  if (actual !== row.expected) {
    failed++;
    console.error(`FAIL ${row.id} [${row.tag}]\n  expected: ${row.expected}\n  actual:   ${actual}`);
  }
}
console.log(`normalization fixtures: ${rows.length - failed}/${rows.length} passed`);
if (failed) process.exitCode = 1;
