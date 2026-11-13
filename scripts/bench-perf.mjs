#!/usr/bin/env node
/** Швидкість: завантаження словника, нормалізація й розстановка наголосів. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lexicon, StressDictionary, normalize, stressify, tokenizeWords } from '../dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const start = performance.now();
const dict = StressDictionary.load(path.join(here, '..', 'data', 'dict.bin'));
const loadMs = performance.now() - start;
const lexicon = Lexicon.loadTsv(path.join(here, '..', 'lexicon', 'names.tsv'));

const sentence =
  'У 1675 році козацька рада зібралася в Чигирині, а через три роки почалася нова кампанія. ' +
  'Замок стоїть на горі, дорога веде до села, де народився Іван Франко. ';
const text = sentence.repeat(200); // ~7000 слів

const t0 = performance.now();
const normalized = normalize(text);
const normalizeMs = performance.now() - t0;

const t1 = performance.now();
const result = stressify(normalized, dict, { symbol: 'plus-before', lexicon });
const stressMs = performance.now() - t1;

const words = tokenizeWords(text).length;
console.log(JSON.stringify({
  dictWords: dict.size,
  loadMs: Math.round(loadMs),
  normalizeMs: Math.round(normalizeMs),
  stressMs: Math.round(stressMs),
  words,
  wordsPerSecond: Math.round(words / (stressMs / 1000)),
  marked: result.marked,
  inferred: result.inferred,
  ambiguous: result.ambiguous.length,
  unknown: result.unknown.length,
}, null, 2));
