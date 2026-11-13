#!/usr/bin/env node
/**
 * CLI: готує текст під рушій і друкує звіт.
 *
 *   node scripts/cli.mjs --engine tts-uk --dict data/dict.bin < script.txt
 *   node scripts/cli.mjs --engine piper-high --json < script.txt
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadResources, createOpenAiAsker, lint, normalize, prepare, prepareMany } from '../dist/index.js';

const REVIEW_FORMAT = 'ua-tts-text-review';
const REVIEW_VERSION = 2;

function sentenceAt(text, index) {
  const boundary = /[.!?\n]/gu;
  let start = 0;
  for (const match of text.matchAll(boundary)) {
    const end = match.index + match[0].length;
    if (end <= index) start = end;
    else break;
  }
  const rest = text.slice(index);
  const tail = rest.search(/[.!?\n]/u);
  const end = tail === -1 ? text.length : index + tail;
  return text.slice(start, end).trim();
}

function reviewOccurrences(result, text) {
  const homographs = result.homographs.map(({ word, offset, key, variants, context }) => {
    if (!Number.isInteger(offset)) throw new Error(`homograph "${word}" has no usable occurrence offset`);
    return { kind: 'homograph', id: `0:${offset}`, key, word, context, variants };
  });
  const unknownWords = (result.evidence ?? [])
    .filter((item) => item.source === 'unknown')
    .map(({ word, offset }) => ({
      kind: 'unknown',
      id: `0:${offset}`,
      key: word.toLocaleLowerCase('uk-UA'),
      word,
      context: sentenceAt(text, offset),
      vowels: [...word].flatMap((letter, position) => (/[аеєиіїоуяю]/iu.test(letter) ? [{ position, letter }] : [])),
    }));
  return [...homographs, ...unknownWords].sort((left, right) => Number(left.id.split(':')[1]) - Number(right.id.split(':')[1]));
}

function readReview(file, { engine, resources, batch, text }) {
  const review = JSON.parse(readFileSync(path.resolve(file), 'utf8'));
  if (!review || typeof review !== 'object' || Array.isArray(review)) throw new Error('review file must contain a JSON object');
  if (review.format !== REVIEW_FORMAT || review.version !== REVIEW_VERSION)
    throw new Error(`unsupported review file format (expected ${REVIEW_FORMAT} v${REVIEW_VERSION})`);
  if (review.engine !== engine) throw new Error(`review file is for engine "${review.engine}", not "${engine}"`);
  if (review.resourceFingerprint !== resources.manifest.fingerprint)
    throw new Error('review file belongs to a different resource snapshot; export a new review file');
  if (review.decisionFingerprint !== batch.decisionFingerprint)
    throw new Error('review file belongs to different text or resources; export a new review file');
  if (!Array.isArray(review.occurrences)) throw new Error('review file is missing its occurrences array');

  const current = new Map(reviewOccurrences(batch.results[0], text).map((item) => [item.id, item]));
  const seen = new Set();
  const occurrenceDecisions = {};
  const occurrenceOverrides = {};
  for (const item of review.occurrences) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.id !== 'string')
      throw new Error('each review occurrence must be an object with an id');
    if (seen.has(item.id)) throw new Error(`duplicate review occurrence: ${item.id}`);
    seen.add(item.id);
    const expected = current.get(item.id);
    if (!expected || item.kind !== expected.kind || item.key !== expected.key || item.word !== expected.word || item.context !== expected.context)
      throw new Error(`review occurrence ${item.id} no longer matches the current text; export a new review file`);
    if (expected.kind === 'homograph') {
      if (
        !Array.isArray(item.variants) ||
        item.variants.length !== expected.variants.length ||
        item.variants.some((variant, index) => variant !== expected.variants[index])
      )
        throw new Error(`review occurrence ${item.id} no longer matches the current text; export a new review file`);
      if (item.choice !== null && item.choice !== 0 && item.choice !== 1)
        throw new Error(`choice for ${item.id} must be 0, 1, or null`);
      if (item.choice !== null) occurrenceDecisions[item.id] = item.choice;
    } else {
      if (
        !Array.isArray(item.vowels) ||
        item.vowels.length !== expected.vowels.length ||
        item.vowels.some((vowel, index) => vowel?.position !== expected.vowels[index].position || vowel?.letter !== expected.vowels[index].letter)
      )
        throw new Error(`review occurrence ${item.id} no longer matches the current text; export a new review file`);
      if (item.stressPosition !== null && !expected.vowels.some((vowel) => vowel.position === item.stressPosition))
        throw new Error(`stressPosition for ${item.id} must match one of the listed vowels, or be null`);
      if (item.stressPosition !== null) occurrenceOverrides[item.id] = item.stressPosition;
    }
  }
  if (seen.size !== current.size) throw new Error('review file is missing occurrences; export a new review file');
  return { occurrenceDecisions, occurrenceOverrides };
}

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const engine = arg('engine', 'plain');
const asJson = process.argv.includes('--json');
const decisionsArg = arg('decisions', '');
const decisions = decisionsArg ? JSON.parse(readFileSync(path.resolve(decisionsArg), 'utf8')) : {};
const reviewOutArg = arg('review-out', '');
const applyReviewArg = arg('apply-review', '');
if (process.argv.includes('--review-out') && (!reviewOutArg || reviewOutArg.startsWith('--')))
  throw new Error('--review-out requires a file path');
if (process.argv.includes('--apply-review') && (!applyReviewArg || applyReviewArg.startsWith('--')))
  throw new Error('--apply-review requires a file path');
if (reviewOutArg && applyReviewArg) throw new Error('use only one of --review-out or --apply-review');
if ((reviewOutArg || applyReviewArg) && decisionsArg)
  throw new Error('--decisions cannot be combined with occurrence review; use choices in the review file');

let input = '';
if (process.stdin.isTTY) {
  input = process.argv.slice(2).find((a) => !a.startsWith('--') && !a.endsWith('.bin')) ?? '';
} else {
  input = readFileSync(0, 'utf8');
}

if (!input.trim()) {
  console.error(
    'usage: ua-tts-text --engine <id> [--dict path] [--lexicon path] [--decisions file | --review-out file | --apply-review file] [--resolve] [--explain] [--json] < script.txt',
  );
  process.exit(2);
}

const resources = loadResources({
  ...(arg('dict', '') ? { dictionaryPath: arg('dict') } : {}),
  ...(arg('lexicon', '') ? { lexiconPath: arg('lexicon') } : {}),
});
const disableContext = process.argv.includes('--no-context');
const useResolve = process.argv.includes('--resolve') || process.env['UA_TTS_RESOLVE'] === '1';
if ((reviewOutArg || applyReviewArg) && useResolve) throw new Error('occurrence review cannot be combined with --resolve');
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
  stress: { decisions, trace: process.argv.includes('--explain') || Boolean(reviewOutArg || applyReviewArg) },
};

let batch;
let reviewSummary;
let result;
if (applyReviewArg) {
  const preview = await prepareMany([input.trim()], base);
  const reviewChoices = readReview(applyReviewArg, {
    engine,
    resources,
    batch: preview,
    text: normalize(input.trim()),
  });
  batch = await prepareMany([input.trim()], {
    ...base,
    ...reviewChoices,
    expectedDecisionFingerprint: preview.decisionFingerprint,
  });
  result = batch.results[0];
  reviewSummary = {
    mode: 'applied',
    file: path.resolve(applyReviewArg),
    appliedHomographs: Object.keys(reviewChoices.occurrenceDecisions).length,
    appliedUnknownWords: Object.keys(reviewChoices.occurrenceOverrides).length,
    unresolvedHomographs: result.homographs.length,
    unresolvedUnknownWords: result.evidence?.filter((item) => item.source === 'unknown').length ?? 0,
    decisionFingerprint: batch.decisionFingerprint,
  };
} else if (reviewOutArg || ask) {
  batch = await prepareMany(
    [input.trim()],
    ask
      ? {
          ...base,
          ask,
          ...(arg('max-prompt-chars', '') ? { maxPromptChars: Number(arg('max-prompt-chars')) } : {}),
          ...(arg('resolution-failure', '') ? { resolutionFailurePolicy: arg('resolution-failure') } : {}),
        }
      : base,
  );
  result = batch.results[0];
  if (reviewOutArg) {
    const artifact = {
      format: REVIEW_FORMAT,
      version: REVIEW_VERSION,
      engine,
      decisionFingerprint: batch.decisionFingerprint,
      resourceFingerprint: resources.manifest.fingerprint,
      occurrences: reviewOccurrences(result, normalize(input.trim())).map((item) =>
        item.kind === 'homograph' ? { ...item, choice: null } : { ...item, stressPosition: null },
      ),
    };
    const file = path.resolve(reviewOutArg);
    writeFileSync(file, `${JSON.stringify(artifact, null, 2)}\n`);
    reviewSummary = {
      mode: 'exported',
      file,
      occurrences: artifact.occurrences.length,
      decisionFingerprint: artifact.decisionFingerprint,
    };
  }
} else {
  result = prepare(input.trim(), base);
}

if (ask && batch) console.error(`резолвер: ${result.homographs.length} омонімів у запиті`);
if (reviewSummary?.mode === 'exported')
  console.error(`файл перегляду: ${reviewSummary.file} · входжень: ${reviewSummary.occurrences}`);
if (reviewSummary?.mode === 'applied')
  console.error(
    `застосовано рішень: омонімів ${reviewSummary.appliedHomographs}, невідомих слів ${reviewSummary.appliedUnknownWords} · лишилось нерозв'язаними: омонімів ${reviewSummary.unresolvedHomographs}, невідомих слів ${reviewSummary.unresolvedUnknownWords}`,
  );
const issues = lint(result.text);

if (asJson) {
  console.log(
    JSON.stringify(
      {
        ...result,
        issues,
        resources: resources.manifest,
        ...(ask && batch ? { resolution: { decisions: batch.decisions, missing: batch.missing, warnings: batch.warnings, promptLength: batch.promptLength } } : {}),
        ...(reviewSummary ? { review: reviewSummary } : {}),
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
