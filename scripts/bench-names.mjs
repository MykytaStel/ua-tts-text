#!/usr/bin/env node
/** Покриття власних назв: зі словником і з лексиконом. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lexicon, StressDictionary, prepare } from '../dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const dict = StressDictionary.load(path.join(root, 'data', 'dict.bin'));
const lexicon = Lexicon.loadTsv(path.join(root, 'lexicon', 'names.tsv'));

const names = readFileSync(path.join(root, 'lexicon', 'names.tsv'), 'utf8')
  .split('\n')
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => line.split('\t')[0]);

const run = (withLexicon) => {
  let ambiguous = 0;
  let unknown = 0;
  for (const name of names) {
    const result = prepare(name, { dictionary: dict, engine: 'tts-uk', ...(withLexicon ? { lexicon } : {}) });
    ambiguous += result.ambiguous.length;
    unknown += result.unknown.length;
  }
  return { ambiguous, unknown };
};

const before = run(false);
const after = run(true);
console.log(`назв: ${names.length}`);
console.log(`лише словник:   омоніми ${before.ambiguous}, невідомі ${before.unknown}`);
console.log(`+ лексикон:     омоніми ${after.ambiguous}, невідомі ${after.unknown}`);
