#!/usr/bin/env node
/**
 * CLI: готує текст під рушій і друкує звіт.
 *
 *   node scripts/cli.mjs --engine tts-uk --dict data/dict.bin < script.txt
 *   node scripts/cli.mjs --engine piper-high --json < script.txt
 */
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lexicon, StressDictionary, createOpenAiAsker, lint, prepare, prepareMany } from '../dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const engine = arg('engine', 'plain');
const asJson = process.argv.includes('--json');
const pkgRoot = path.resolve(here, '..');
const home = process.env['UA_TTS_HOME'] || path.join(os.homedir(), '.local/share/ua-tts-text');

/** Порядок: явний прапорець → змінна середовища → домашня тека → тека пакета. */
function pickPath(explicit, envName, candidates) {
  if (explicit) return path.resolve(explicit);
  const fromEnv = process.env[envName];
  if (fromEnv) return path.resolve(fromEnv);
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

const dictPath = pickPath(arg('dict', ''), 'UA_TTS_DICT', [
  path.join(home, 'dict.bin'),
  path.join(pkgRoot, 'data', 'dict.bin'),
]);
const lexiconPath = pickPath(arg('lexicon', ''), 'UA_TTS_LEXICON', [
  path.join(home, 'names.tsv'),
  path.join(pkgRoot, 'lexicon', 'names.tsv'),
]);

const decisionsArg = arg('decisions', '');
const decisions = decisionsArg
  ? JSON.parse(readFileSync(path.resolve(decisionsArg), 'utf8'))
  : {};

let input = '';
if (process.stdin.isTTY) {
  input = process.argv.slice(2).find((a) => !a.startsWith('--') && !a.endsWith('.bin')) ?? '';
} else {
  input = readFileSync(0, 'utf8');
}

if (!input.trim()) {
  console.error('usage: ua-tts-text --engine <id> [--dict path] [--lexicon path] [--decisions file] [--resolve] [--json] < script.txt');
  process.exit(2);
}

if (!existsSync(dictPath)) {
  console.error(
    [
      'немає словника наголосів.',
      'виконай: npx ua-tts-text-fetch-dict',
      'або вкажи шлях: --dict /шлях/до/dict.bin',
      `(шукав у ${dictPath})`,
    ].join('\n'),
  );
  process.exit(2);
}
const dictionary = StressDictionary.load(dictPath);
const lexicon = existsSync(lexiconPath) ? Lexicon.loadTsv(lexiconPath) : undefined;
const useResolve = process.argv.includes('--resolve') || process.env['UA_TTS_RESOLVE'] === '1';
const apiKey = process.env['UA_TTS_LLM_KEY'] ?? '';
if (useResolve && !apiKey) {
  console.error('--resolve потребує UA_TTS_LLM_KEY (OpenAI-сумісний ключ)');
  process.exit(2);
}

const ask = useResolve
  ? createOpenAiAsker({
      apiKey,
      ...(process.env['UA_TTS_LLM_BASE_URL'] ? { baseUrl: process.env['UA_TTS_LLM_BASE_URL'] } : {}),
      ...(process.env['UA_TTS_LLM_MODEL'] ? { model: process.env['UA_TTS_LLM_MODEL'] } : {}),
    })
  : undefined;

const base = {
  dictionary,
  engine,
  ...(lexicon ? { lexicon } : {}),
  stress: { decisions },
};

const result = ask
  ? (await prepareMany([input.trim()], { ...base, ask })).results[0]
  : prepare(input.trim(), base);

if (ask) console.error(`резолвер: ${result.homographs.length} омонімів у запиті`);
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
