#!/usr/bin/env node
/**
 * CLI: готує текст під рушій і друкує звіт.
 *
 *   node scripts/cli.mjs --engine tts-uk --dict data/dict.bin < script.txt
 *   node scripts/cli.mjs --engine piper-high --json < script.txt
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadResources, createOpenAiAsker, lint, prepare, prepareMany } from '../dist/index.js';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const engine = arg('engine', 'plain');
const asJson = process.argv.includes('--json');
const decisionsArg = arg('decisions', '');
const decisions = decisionsArg ? JSON.parse(readFileSync(path.resolve(decisionsArg), 'utf8')) : {};

let input = '';
if (process.stdin.isTTY) {
  input = process.argv.slice(2).find((a) => !a.startsWith('--') && !a.endsWith('.bin')) ?? '';
} else {
  input = readFileSync(0, 'utf8');
}

if (!input.trim()) {
  console.error(
    'usage: ua-tts-text --engine <id> [--dict path] [--lexicon path] [--decisions file] [--resolve] [--explain] [--json] < script.txt',
  );
  process.exit(2);
}

const resources = loadResources({
  ...(arg('dict', '') ? { dictionaryPath: arg('dict') } : {}),
  ...(arg('lexicon', '') ? { lexiconPath: arg('lexicon') } : {}),
});
const disableContext = process.argv.includes('--no-context');
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
  resources,
  engine,
  ...(disableContext ? { context: null } : {}),
  stress: { decisions, trace: process.argv.includes('--explain') },
};

const batch = ask
  ? await prepareMany([input.trim()], {
      ...base,
      ask,
      ...(arg('max-prompt-chars', '') ? { maxPromptChars: Number(arg('max-prompt-chars')) } : {}),
      ...(arg('resolution-failure', '')
        ? { resolutionFailurePolicy: arg('resolution-failure') }
        : {}),
    })
  : undefined;
const result = batch?.results[0] ?? prepare(input.trim(), base);

if (batch) console.error(`резолвер: ${result.homographs.length} омонімів у запиті`);
const issues = lint(result.text);

if (asJson) {
  console.log(
    JSON.stringify(
      {
        ...result,
        issues,
        resources: resources.manifest,
        ...(batch ? { resolution: { decisions: batch.decisions, missing: batch.missing, warnings: batch.warnings, promptLength: batch.promptLength } } : {}),
      },
      null,
      2,
    ),
  );
} else {
  console.log(result.text);
  console.error('');
  console.error(`рушій: ${result.engine} · слів з наголосом: ${result.marked}`);
  console.error(`омоніми (${result.ambiguous.length}): ${result.ambiguous.join(', ') || '—'}`);
  console.error(`немає у словнику (${result.unknown.length}): ${result.unknown.join(', ') || '—'}`);
  console.error(`проблеми (${issues.length}): ${issues.map((i) => `${i.kind}:${i.match}`).join(', ') || '—'}`);
  for (const warning of result.warnings) console.error(`увага: ${warning}`);
  for (const warning of batch?.warnings ?? []) console.error(`увага: ${warning}`);
  if (batch?.missing.length) console.error(`нерозв’язані входження (${batch.missing.length}): ${batch.missing.join(', ')}`);
}
