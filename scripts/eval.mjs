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
 *
 * Два акути в одному слові означають «обидва варіанти нормативні» — так
 * записуються слова на кшталт «ро́ки́», де словники дозволяють обидва наголоси.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadResources, normalize, prepare } from '../dist/index.js';
import { compareText, QUALITY_FLOORS, qualityFailures } from './evaluation.mjs';

const ACUTE = '\u0301';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const verbose = process.argv.includes('--verbose');
const strict = process.argv.includes('--strict');

const resources = loadResources({
  home: path.join(root, 'evaluation/resources'),
  dictionaryPath: path.join(root, 'data/dict.bin'),
  lexiconPath: path.join(root, 'lexicon/names.tsv'),
  required: true,
});
const { dictionary: dict, lexicon } = resources;
const context = process.argv.includes('--no-context') ? undefined : resources.context;
const dictionaryValidation = dict.validateAll();

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
  const source = row.text.replace(/[\u0301\u00b4]/gu, '');
  const prepared = prepare(source, { dictionary: dict, lexicon, ...(context ? { context } : {}), engine: 'piper-medium' });
  const comparison = compareText(normalize(row.text), prepared.text);
  const rowTp = comparison.tp;
  const rowFp = comparison.fp;
  const rowFn = comparison.fn;
  if (!comparison.exactText)
    errors.push({ id: row.id, issue: 'token preservation', missingWords: comparison.missingWords, extraWords: comparison.extraWords });
  for (const error of comparison.errors.filter((item) => item.expected || item.actual)) {
    errors.push({
      id: row.id,
      word: error.word,
      expected: (error.expected ?? []).join('|') || 'без наголосу',
      got: (error.actual ?? []).join('|') || 'без наголосу',
    });
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
const exactTextRows = rows.length - errors.filter((e) => e.issue === 'token preservation').length;

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
  resources: {
    ...resources.manifest,
    files: resources.manifest.files.map((file) => ({ path: path.relative(root, file.path), sha256: file.sha256 })),
  },
  measurement: 'regression corpus; not an independent held-out estimate',
  tokenPreservation: { exactRows: exactTextRows, rows: rows.length },
  qualityFloors: QUALITY_FLOORS,
  rows: rows.length,
  dictionaryValidation,
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
if (strict) {
  const failures = qualityFailures({ tp, fp, fn, exactTextRows, rows: rows.length });
  if (failures.length) {
    console.error(`quality gate failed: ${failures.join('; ')}`);
    process.exitCode = 1;
  } else {
    console.log('quality gate passed');
  }
}
