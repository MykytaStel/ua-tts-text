#!/usr/bin/env node
/**
 * Аудит реальних текстів: скільки слів отримало наголос і що лишилось без нього.
 *
 *   node scripts/audit.mjs --dir ~/Documents/scripts
 *   node scripts/audit.mjs --dir ./corpus --engine tts-uk
 *
 * Друкує таблицю по файлах і список слів, які варто додати в лексикон або правила.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContextRules, Lexicon, StressDictionary, prepare } from '../dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const dir = path.resolve(arg('dir', path.join(root, 'corpus')));
const engine = arg('engine', 'tts-uk');
const top = Number(arg('top', '40'));

const dict = StressDictionary.load(path.join(root, 'data', 'dict.bin'));
const lexicon = Lexicon.loadAll([path.join(root, 'lexicon', 'common.tsv'), path.join(root, 'lexicon', 'names.tsv')]);
const context = ContextRules.loadTsv(path.join(root, 'lexicon', 'context.tsv'));

const files = [];
const walk = (directory) => {
  for (const entry of readdirSync(directory)) {
    if (entry.startsWith('.') || entry === 'node_modules') continue;
    const full = path.join(directory, entry);
    const info = statSync(full);
    if (info.isDirectory()) walk(full);
    else if (/\.(txt|md)$/iu.test(entry)) files.push(full);
  }
};
walk(dir);
if (files.length === 0) {
  console.error(`немає .txt або .md у ${dir}`);
  process.exit(2);
}

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu;
const VOWELS = /[аеєиіїоуяю]/gu;
const unmarked = new Map();
let totalWords = 0;
let totalMarked = 0;
let totalPolysyllabic = 0;

const rows = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const result = prepare(text, { dictionary: dict, lexicon, context, engine });
  const words = [...result.text.matchAll(/[\p{L}][\p{L}'’+\-]*/gu)].map((match) => match[0]);
  const poly = words.filter((word) => (word.match(VOWELS) ?? []).length > 1);
  const marked = poly.filter((word) => word.includes('+') || word.includes('\u0301')).length;
  totalWords += words.length;
  totalPolysyllabic += poly.length;
  totalMarked += marked;
  for (const word of [...result.ambiguous, ...result.unknown]) {
    const key = word.toLowerCase();
    unmarked.set(key, (unmarked.get(key) ?? 0) + 1);
  }
  rows.push({ file: path.relative(dir, file), words: words.length, poly: poly.length, marked, share: poly.length ? marked / poly.length : 1 });
}

const pct = (value) => `${(value * 100).toFixed(1)}%`;
console.log('| файл | слів | багатоскладових | з наголосом | частка |');
console.log('|---|---|---|---|---|');
for (const row of rows) {
  console.log(`| ${row.file} | ${row.words} | ${row.poly} | ${row.marked} | ${pct(row.share)} |`);
}
console.log(
  `\nразом: ${files.length} файлів, ${totalWords} слів, ${totalPolysyllabic} багатоскладових, ` +
    `наголошено ${pct(totalPolysyllabic ? totalMarked / totalPolysyllabic : 1)}`,
);

const worst = [...unmarked].sort((a, b) => b[1] - a[1]).slice(0, top);
if (worst.length) {
  console.log(`\nбез наголосу (${unmarked.size} унікальних), найчастіші:`);
  console.log(worst.map(([word, count]) => `${word} ×${count}`).join(', '));
}
