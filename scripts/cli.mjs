#!/usr/bin/env node
/**
 * CLI: готує текст під рушій і друкує звіт.
 *
 *   node scripts/cli.mjs --engine tts-uk --dict data/dict.bin < script.txt
 *   node scripts/cli.mjs --engine piper-high --json < script.txt
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { Lexicon, StressDictionary, lint, prepare } from '../dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const engine = arg('engine', 'plain');
const dictPath = path.resolve(here, '..', arg('dict', 'data/dict.bin'));
const asJson = process.argv.includes('--json');
const decisionsArg = arg('decisions', '');
const decisions = decisionsArg ? JSON.parse(readFileSync(path.resolve(here, '..', decisionsArg), 'utf8')) : {};

let input = '';
if (process.stdin.isTTY) {
  input = process.argv.slice(2).find((a) => !a.startsWith('--') && !a.endsWith('.bin')) ?? '';
} else {
  input = readFileSync(0, 'utf8');
}

if (!input.trim()) {
  console.error('usage: cli.mjs --engine <id> [--dict data/dict.bin] [--json] < script.txt');
  process.exit(2);
}

if (!existsSync(dictPath)) {
  console.error(`немає словника: ${dictPath}\nспочатку виконай: node scripts/fetch-dict.mjs`);
  process.exit(2);
}
const dictionary = StressDictionary.load(dictPath);
const lexiconPath = path.resolve(here, '..', arg('lexicon', 'lexicon/names.tsv'));
const lexicon = existsSync(lexiconPath) ? Lexicon.loadTsv(lexiconPath) : undefined;
const result = prepare(input.trim(), {
  dictionary,
  engine,
  ...(lexicon ? { lexicon } : {}),
  stress: { decisions },
});
const issues = lint(result.text);

if (asJson) {
  console.log(JSON.stringify({ ...result, issues }, null, 2));
} else {
  console.log(result.text);
  console.error('');
  console.error(`рушій: ${result.engine} · слів з наголосом: ${result.marked}`);
  console.error(`омоніми (${result.ambiguous.length}): ${result.ambiguous.join(', ') || '—'}`);
  console.error(`немає у словнику (${result.unknown.length}): ${result.unknown.join(', ') || '—'}`);
  console.error(`проблеми (${issues.length}): ${issues.map((i) => `${i.kind}:${i.match}`).join(', ') || '—'}`);
  for (const warning of result.warnings) console.error(`увага: ${warning}`);
}
