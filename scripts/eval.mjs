#!/usr/bin/env node
/**
 * Оцінка якості на золотому наборі: точність і повнота наголосів.
 *
 *   node scripts/eval.mjs            # таблиця + evaluation/report.json
 *   node scripts/eval.mjs --verbose  # ще й список помилок
 *
 * Золото лежить у evaluation/gold.tsv: текст із акутами на тих складах,
 * де наголос має стояти. Слова без акута вважаються такими, що не потребують
 * позначки (односкладові або нерозв'язані омоніми).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContextRules, Lexicon, StressDictionary, normalize, prepare } from '../dist/index.js';

const ACUTE = '\u0301';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const verbose = process.argv.includes('--verbose');

const dict = StressDictionary.load(path.join(root, 'data', 'dict.bin'));
const lexicon = Lexicon.loadAll([
  path.join(root, 'lexicon', 'common.tsv'),
  path.join(root, 'lexicon', 'names.tsv'),
]);

// --no-context показує базу без контекстних правил.
const context = process.argv.includes('--no-context') ? undefined : ContextRules.loadTsv(path.join(root, 'lexicon', 'context.tsv'));

const WORD_RE = /[\p{L}][\p{L}\u2019\u02bc'\u0301+\-]*/gu;

function indexWords(text) {
  const map = new Map();
  for (const match of text.matchAll(WORD_RE)) {
    const chars = [...match[0]];
    const stripped = [];
    let position = null;
    for (const char of chars) {
      if (char === ACUTE || char === '\u00b4') {
        if (stripped.length > 0) position = stripped.length - 1;
        continue;
      }
      stripped.push(char);
    }
    const key = stripped.join('').toLowerCase().replace(/[\u2019\u02bc`]/gu, "'");
    if (key) map.set(key, position);
  }
  return map;
}

const rows = readFileSync(path.join(root, 'evaluation', 'gold.tsv'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => {
    const [id, text, tags = ''] = line.split('\t');
    return { id, text, tags: tags.split(',').filter(Boolean) };
  });

const byTag = new Map();
const errors = [];
let tp = 0;
let fp = 0;
let fn = 0;

for (const row of rows) {
  const golden = indexWords(row.text);
  const source = row.text.replace(/[\u0301\u00b4]/gu, '');
  const prepared = prepare(source, { dictionary: dict, lexicon, ...(context ? { context } : {}), engine: 'piper-medium' });
  const produced = indexWords(prepared.text);

  let rowTp = 0;
  let rowFp = 0;
  let rowFn = 0;

  for (const [word, expected] of golden) {
    const actual = produced.has(word) ? produced.get(word) : null;
    if (expected !== null) {
      if (actual === expected) rowTp += 1;
      else if (actual === null || actual === undefined) {
        rowFn += 1;
        errors.push({ id: row.id, word, expected: 'наголос', got: 'без наголосу' });
      } else {
        rowFn += 1;
        rowFp += 1;
        errors.push({ id: row.id, word, expected: `позиція ${expected}`, got: `позиція ${actual}` });
      }
    } else if (actual !== null && actual !== undefined) {
      rowFp += 1;
      errors.push({ id: row.id, word, expected: 'без наголосу', got: `позиція ${actual}` });
    }
  }

  tp += rowTp;
  fp += rowFp;
  fn += rowFn;

  for (const tag of row.tags.length ? row.tags : ['інше']) {
    const bucket = byTag.get(tag) ?? { tp: 0, fp: 0, fn: 0, rows: 0 };
    bucket.tp += rowTp;
    bucket.fp += rowFp;
    bucket.fn += rowFn;
    bucket.rows += 1;
    byTag.set(tag, bucket);
  }
}

const precision = tp / (tp + fp) || 0;
const recall = tp / (tp + fn) || 0;
const f1 = (2 * precision * recall) / (precision + recall) || 0;

const lines = [];
lines.push('| набір | речень | точність | повнота | F1 |');
lines.push('|---|---|---|---|---|');
const fmt = (value) => `${(value * 100).toFixed(1)}%`;
lines.push(`| усі | ${rows.length} | ${fmt(precision)} | ${fmt(recall)} | ${fmt(f1)} |`);
for (const [tag, bucket] of [...byTag].sort((a, b) => a[0].localeCompare(b[0]))) {
  const p = bucket.tp / (bucket.tp + bucket.fp) || 0;
  const r = bucket.tp / (bucket.tp + bucket.fn) || 0;
  const f = (2 * p * r) / (p + r) || 0;
  lines.push(`| ${tag} | ${bucket.rows} | ${fmt(p)} | ${fmt(r)} | ${fmt(f)} |`);
}

const report = {
  generatedAt: new Date().toISOString(),
  rows: rows.length,
  tp,
  fp,
  fn,
  precision,
  recall,
  f1,
  byTag: Object.fromEntries(byTag),
  errors,
};
writeFileSync(path.join(root, 'evaluation', 'report.json'), JSON.stringify(report, null, 2));

console.log(lines.join('\n'));
if (verbose) {
  console.log('\nпомилки:');
  for (const error of errors) console.log(`  ${error.id}  ${error.word}: очікували ${error.expected}, отримали ${error.got}`);
}
console.log(`\nTP ${tp}, FP ${fp}, FN ${fn} → evaluation/report.json`);
