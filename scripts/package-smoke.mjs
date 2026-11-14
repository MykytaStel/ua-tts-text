#!/usr/bin/env node
/** Verify the packed npm archive through a clean local install. */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(path.join(os.tmpdir(), 'ua-tts-package-smoke-'));
const npmEnv = {
  ...process.env,
  npm_config_cache: path.join(temp, 'npm-cache'),
  // The smoke test must create an archive even when called by `npm publish --dry-run`.
  npm_config_dry_run: 'false',
};

function writeDictionaryFixture(file, entries) {
  const sorted = [...entries].sort((left, right) => Buffer.compare(Buffer.from(left.word), Buffer.from(right.word)));
  const keys = sorted.map(({ word }) => Buffer.from(word, 'utf8'));
  const header = Buffer.alloc(16);
  header.write('UATS3', 0, 'latin1');
  header.writeUInt32LE(sorted.length, 8);
  header.writeUInt32LE(0, 12);
  const offsets = Buffer.alloc((sorted.length + 1) * 4);
  const positions = Buffer.alloc(sorted.length * 2, 255);
  const flags = Buffer.alloc(sorted.length);
  let offset = 0;
  for (const [index, entry] of sorted.entries()) {
    offsets.writeUInt32LE(offset, index * 4);
    offset += keys[index].length;
    positions[index * 2] = entry.position;
    positions[index * 2 + 1] = entry.alternative;
  }
  offsets.writeUInt32LE(offset, sorted.length * 4);
  writeFileSync(file, Buffer.concat([header, offsets, positions, flags, ...keys]));
}

try {
  execFileSync('pnpm', ['build'], { cwd: root, stdio: 'inherit' });
  const packed = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp], {
      cwd: root,
      encoding: 'utf8',
      env: npmEnv,
    }),
  )[0];
  if (!packed?.filename) throw new Error('npm pack did not report its output file');
  const archive = path.join(temp, packed.filename);
  const consumer = path.join(temp, 'consumer');
  mkdirSync(consumer);
  execFileSync(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', consumer, archive],
    { cwd: temp, stdio: 'inherit', env: npmEnv },
  );

  const installed = path.join(consumer, 'node_modules', 'ua-tts-text');
  const binSuffix = process.platform === 'win32' ? '.cmd' : '';
  for (const name of ['ua-tts-text', 'ua-tts-text-fetch-dict', 'ua-tts-text-blind-audio']) {
    const executable = path.join(consumer, 'node_modules', '.bin', `${name}${binSuffix}`);
    if (!existsSync(executable)) throw new Error(`installed executable is missing: ${name}`);
  }
  const blindAudioScript = path.join(installed, 'scripts/blind-audio.mjs');
  const blindAudioHelp = execFileSync(process.execPath, [blindAudioScript, '--help'], {
    cwd: temp,
    encoding: 'utf8',
  });
  if (!blindAudioHelp.includes('prepare --manifest')) throw new Error(`installed blind-audio CLI smoke failed: ${JSON.stringify({ blindAudioScript, blindAudioHelp })}`);
  const names = path.join(temp, 'project-names.tsv');
  const normalization = path.join(temp, 'project-normalization.tsv');
  writeFileSync(names, 'Кодове\tКо́дове\tперсонаж\tmanual smoke check\tfixture\tКодове\tverified\n');
  writeFileSync(normalization, 'АТБ\tа-те-бе\tpackage smoke glossary\tverified\n');
  const nodeResult = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { loadResources, prepare } from ${JSON.stringify(path.join(installed, 'dist/index.js'))};` +
        `const resources = loadResources({ packageRoot: ${JSON.stringify(installed)}, home: ${JSON.stringify(path.join(temp, 'home'))}, dictionaryPath: ${JSON.stringify(path.join(temp, 'missing-dict.bin'))}, lexiconPath: ${JSON.stringify(names)}, normalizationPath: ${JSON.stringify(normalization)} });` +
        `const result = prepare('Кодове АТБ 15', { resources, engine: 'piper-medium' });` +
        `if (result.text !== "Ко́дове а-те-бе п'ятнадцять" || result.resourceFingerprint !== resources.manifest.fingerprint || resources.normalization.explain('АТБ')?.source !== 'package smoke glossary') throw new Error('installed API smoke failed: ' + JSON.stringify(result));`,
    ],
    { cwd: temp, encoding: 'utf8' },
  );
  if (nodeResult.status !== 0) throw new Error(nodeResult.stderr || 'installed API smoke failed');

  const cli = spawnSync(
    process.execPath,
    [path.join(installed, 'scripts/cli.mjs'), '--engine', 'piper-medium', '--json'],
    {
      cwd: temp,
      encoding: 'utf8',
      input: 'Кодове',
      env: {
        ...process.env,
        UA_TTS_HOME: path.join(temp, 'home'),
        UA_TTS_DICT: path.join(temp, 'missing-dict.bin'),
        UA_TTS_LEXICON: names,
      },
    },
  );
  if (cli.status !== 0) throw new Error(cli.stderr || 'installed CLI smoke failed');
  const result = JSON.parse(cli.stdout);
  if (result.text !== 'Ко́дове' || !result.resourceFingerprint || !result.resources?.fingerprint)
    throw new Error(`installed CLI smoke returned unexpected output: ${cli.stdout}`);

  const reviewDictionary = path.join(temp, 'review-dict.bin');
  const changedReviewDictionary = path.join(temp, 'changed-review-dict.bin');
  writeDictionaryFixture(reviewDictionary, [{ word: 'замок', position: 1, alternative: 3 }]);
  writeDictionaryFixture(changedReviewDictionary, [{ word: 'замок', position: 3, alternative: 1 }]);
  const reviewFile = path.join(temp, 'review.json');
  const reviewInput = 'Замок. Замок. Краудфандинг. Краудфандинг.';
  const runReviewCli = (args, input, dictionary = reviewDictionary) =>
    spawnSync(process.execPath, [path.join(installed, 'scripts/cli.mjs'), '--engine', 'tts-uk', '--no-context', ...args], {
      cwd: temp,
      encoding: 'utf8',
      input,
      env: {
        ...process.env,
        UA_TTS_HOME: path.join(temp, 'home'),
        UA_TTS_DICT: dictionary,
        UA_TTS_LEXICON: names,
      },
    });
  const exported = runReviewCli(['--review-out', reviewFile], reviewInput);
  if (exported.status !== 0) throw new Error(exported.stderr || 'CLI review export failed');
  const review = JSON.parse(readFileSync(reviewFile, 'utf8'));
  if (
    review.format !== 'ua-tts-text-review' ||
    review.version !== 2 ||
    review.occurrences.length !== 4 ||
    review.occurrences[0].id !== '0:0' ||
    review.occurrences[1].id !== '0:7' ||
    review.occurrences[2].id !== '0:14' ||
    review.occurrences[3].id !== '0:28' ||
    review.occurrences.slice(0, 2).some((item) => item.kind !== 'homograph' || item.choice !== null || item.context !== 'Замок') ||
    review.occurrences.slice(2).some((item) => item.kind !== 'unknown' || item.stressPosition !== null || item.context !== 'Краудфандинг') ||
    review.occurrences[2].vowels.map((vowel) => vowel.position).join(',') !== '2,3,6,9'
  )
    throw new Error(`CLI review export returned unexpected data: ${JSON.stringify(review)}`);
  review.occurrences[0].choice = 0;
  review.occurrences[2].stressPosition = 2;
  writeFileSync(reviewFile, `${JSON.stringify(review, null, 2)}\n`);
  const partial = runReviewCli(['--apply-review', reviewFile], reviewInput);
  if (
    partial.status !== 0 ||
    partial.stdout.trim() !== 'З+амок. Замок. Кр+аудфандинг. Краудфандинг.' ||
    !partial.stderr.includes("нерозв'язаними: омонімів 1, невідомих слів 1")
  )
    throw new Error(partial.stderr || `CLI partial review returned unexpected text: ${partial.stdout}`);
  review.occurrences[1].choice = 1;
  review.occurrences[3].stressPosition = 9;
  writeFileSync(reviewFile, `${JSON.stringify(review, null, 2)}\n`);
  const applied = runReviewCli(['--apply-review', reviewFile], reviewInput);
  if (applied.status !== 0 || applied.stdout.trim() !== 'З+амок. Зам+ок. Кр+аудфандинг. Краудфанд+инг.')
    throw new Error(applied.stderr || `CLI review apply returned unexpected text: ${applied.stdout}`);
  const staleText = runReviewCli(['--apply-review', reviewFile], 'Замок. Інший текст.');
  if (staleText.status === 0 || !staleText.stderr.includes('different text or resources'))
    throw new Error(`CLI accepted a review file for changed text: ${staleText.stdout}${staleText.stderr}`);
  const staleResources = runReviewCli(['--apply-review', reviewFile], reviewInput, changedReviewDictionary);
  if (staleResources.status === 0 || !staleResources.stderr.includes('different resource snapshot'))
    throw new Error(`CLI accepted a review file for changed resources: ${staleResources.stdout}${staleResources.stderr}`);
  review.occurrences[2].stressPosition = 1;
  writeFileSync(reviewFile, `${JSON.stringify(review, null, 2)}\n`);
  const invalidStressPosition = runReviewCli(['--apply-review', reviewFile], reviewInput);
  if (invalidStressPosition.status === 0 || !invalidStressPosition.stderr.includes('must match one of the listed vowels'))
    throw new Error(`CLI accepted a consonant stress position: ${invalidStressPosition.stdout}${invalidStressPosition.stderr}`);
  review.occurrences[0].choice = 2;
  review.occurrences[2].stressPosition = null;
  writeFileSync(reviewFile, `${JSON.stringify(review, null, 2)}\n`);
  const invalidChoice = runReviewCli(['--apply-review', reviewFile], reviewInput);
  if (invalidChoice.status === 0 || !invalidChoice.stderr.includes('must be 0, 1, or null'))
    throw new Error(`CLI accepted an invalid review choice: ${invalidChoice.stdout}${invalidChoice.stderr}`);
  console.log(`packed install smoke passed (${packed.filename}, ${packed.size} bytes)`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
