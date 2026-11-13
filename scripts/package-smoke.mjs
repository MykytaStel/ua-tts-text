#!/usr/bin/env node
/** Verify the packed npm archive through a clean local install. */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
  for (const name of ['ua-tts-text', 'ua-tts-text-fetch-dict']) {
    const executable = path.join(consumer, 'node_modules', '.bin', `${name}${binSuffix}`);
    if (!existsSync(executable)) throw new Error(`installed executable is missing: ${name}`);
  }
  const names = path.join(temp, 'project-names.tsv');
  writeFileSync(names, 'Кодове\tКо́дове\tперсонаж\tmanual smoke check\tfixture\tКодове\tverified\n');
  const nodeResult = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { loadResources, prepare } from ${JSON.stringify(path.join(installed, 'dist/index.js'))};` +
        `const resources = loadResources({ packageRoot: ${JSON.stringify(installed)}, home: ${JSON.stringify(path.join(temp, 'home'))}, dictionaryPath: ${JSON.stringify(path.join(temp, 'missing-dict.bin'))}, lexiconPath: ${JSON.stringify(names)} });` +
        `const result = prepare('Кодове', { resources, engine: 'piper-medium' });` +
        `if (result.text !== 'Ко́дове' || result.resourceFingerprint !== resources.manifest.fingerprint) throw new Error('installed API smoke failed: ' + JSON.stringify(result));`,
    ],
    { cwd: temp, encoding: 'utf8' },
  );
  if (nodeResult.status !== 0) throw new Error(nodeResult.stderr || 'installed API smoke failed');

  const cli = spawnSync(
    process.execPath,
    [path.join(installed, 'scripts/cli.mjs'), '--engine', 'piper-medium', '--json'],
    { cwd: temp, encoding: 'utf8', input: 'Кодове', env: { ...process.env, UA_TTS_LEXICON: names } },
  );
  if (cli.status !== 0) throw new Error(cli.stderr || 'installed CLI smoke failed');
  const result = JSON.parse(cli.stdout);
  if (result.text !== 'Ко́дове' || !result.resourceFingerprint || !result.resources?.fingerprint)
    throw new Error(`installed CLI smoke returned unexpected output: ${cli.stdout}`);
  console.log(`packed install smoke passed (${packed.filename}, ${packed.size} bytes)`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
