#!/usr/bin/env node
/**
 * Baseline-вимірювання на golden corpus: скільки слів отримало наголос,
 * скільки лишилось омонімами/невідомими і що ще не розгорнулось.
 *
 *   node scripts/bench.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCRIPTS } from '../corpus/scripts.mjs';
import { StressDictionary, lint, prepare } from '../dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dict = StressDictionary.load(path.join(here, '..', 'data', 'dict.bin'));

const decisionsPath = path.join(here, '..', 'corpus', 'decisions.json');
const decisions = existsSync(decisionsPath) ? JSON.parse(readFileSync(decisionsPath, 'utf8')) : {};

/** @type {{key: string, engine: string, stress?: object}[]} */
const VARIANTS = [
  { key: 'plain', engine: 'plain' },
  { key: 'tts-uk', engine: 'tts-uk' },
  { key: 'tts-uk + рішення', engine: 'tts-uk', stress: { decisions } },
  { key: 'styletts2', engine: 'styletts2' },
  { key: 'piper-medium', engine: 'piper-medium' },
  { key: 'piper-high', engine: 'piper-high' },
];

const WORD_RE = /[\p{L}][\p{L}\u2019\u02bc'`\-]*/gu;
const VOWELS_RE = /[аеєиіїоуяю]/gu;

const stats = Object.fromEntries(
  VARIANTS.map((variant) => [
    variant.key,
    { marked: 0, ambiguous: 0, unknown: 0, issues: 0, warnings: new Set(), words: 0, polysyllabic: 0 },
  ]),
);

const perScript = [];

for (const script of SCRIPTS) {
  const rawWords = [...script.text.matchAll(WORD_RE)].map((m) => m[0]);
  const polysyllabic = rawWords.filter((w) => (w.match(VOWELS_RE) ?? []).length > 1).length;
  const digitsBefore = (script.text.match(/\d+/gu) ?? []).length;

  const row = { id: script.id, tags: script.tags, digitsBefore, polysyllabic, variants: {} };

  for (const variant of VARIANTS) {
    const result = prepare(script.text, {
      dictionary: dict,
      engine: variant.engine,
      ...(variant.stress ? { stress: variant.stress } : {}),
    });
    const issues = lint(result.text);
    const bucket = stats[variant.key];
    bucket.marked += result.marked;
    bucket.ambiguous += result.ambiguous.length;
    bucket.unknown += result.unknown.length;
    bucket.issues += issues.length;
    bucket.words += rawWords.length;
    bucket.polysyllabic += polysyllabic;
    for (const warning of result.warnings) bucket.warnings.add(warning);
    row.variants[variant.key] = {
      marked: result.marked,
      ambiguous: result.ambiguous.length,
      unknown: result.unknown.length,
      issues: issues.length,
      text: result.text,
    };
  }
  perScript.push(row);
}

const lines = ['| варіант | наголошено | омоніми | невідомі | покриття | проблеми |', '|---|---|---|---|---|---|'];
for (const variant of VARIANTS) {
  const s = stats[variant.key];
  const target = s.marked + s.ambiguous + s.unknown;
  const coverage = target === 0 ? '—' : `${((s.marked / target) * 100).toFixed(1)}%`;
  lines.push(`| ${variant.key} | ${s.marked} | ${s.ambiguous} | ${s.unknown} | ${coverage} | ${s.issues} |`);
}

const out = {
  generatedAt: new Date().toISOString(),
  scripts: SCRIPTS.length,
  words: stats.plain.words,
  polysyllabic: stats.plain.polysyllabic,
  decisions: Object.keys(decisions).length,
  table: lines.join('\n'),
  stats: Object.fromEntries(
    VARIANTS.map((variant) => [
      variant.key,
      {
        marked: stats[variant.key].marked,
        ambiguous: stats[variant.key].ambiguous,
        unknown: stats[variant.key].unknown,
        issues: stats[variant.key].issues,
        warnings: [...stats[variant.key].warnings],
      },
    ]),
  ),
  perScript,
};

writeFileSync(path.join(here, '..', 'corpus', 'baseline.json'), JSON.stringify(out, null, 2));

console.log(lines.join('\n'));
console.log('');
console.log(
  `сценаріїв: ${SCRIPTS.length}, слів: ${stats.plain.words}, багатоскладових: ${stats.plain.polysyllabic}, рішень для омонімів: ${Object.keys(decisions).length}`,
);
for (const variant of VARIANTS) {
  for (const warning of stats[variant.key].warnings) console.log(`увага · ${variant.key}: ${warning.slice(0, 100)}…`);
}
