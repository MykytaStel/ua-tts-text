#!/usr/bin/env node
/**
 * Завантажує словник lang-uk і збирає з нього бінарний dict.bin.
 *
 *   npx ua-tts-text-fetch-dict          # → ~/.local/share/ua-tts-text/dict.bin
 *   node scripts/fetch-dict.mjs --local # → ./data/dict.bin (для репозиторію)
 *
 * UA_TTS_HOME перекриває типову теку.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const URL_STRESS =
  'https://raw.githubusercontent.com/lang-uk/ukrainian-word-stress-dictionary/master/stress.txt';

// У репозиторії (є .git) словник живе в data/; у встановленому пакеті — у дома.
const isRepo = existsSync(path.join(root, '.git'));
const home = process.env['UA_TTS_HOME'] || path.join(os.homedir(), '.local/share/ua-tts-text');
const targetDir = process.argv.includes('--local') || isRepo ? path.join(root, 'data') : home;

mkdirSync(targetDir, { recursive: true });
const source = path.join(targetDir, 'stress.txt');
const target = path.join(targetDir, 'dict.bin');

console.log(`завантажую словник (~70 МБ) → ${target}`);
const response = await fetch(URL_STRESS);
if (!response.ok) throw new Error(`HTTP ${response.status} для ${URL_STRESS}`);
const bytes = Buffer.from(await response.arrayBuffer());
writeFileSync(source, bytes);

const result = spawnSync(process.execPath, [path.join(here, 'build-dict.mjs'), source, target], {
  stdio: 'inherit',
});

// Сирий текст (70 МБ) після збірки не потрібен.
if (result.status === 0) rmSync(source, { force: true });

if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`готово: ${target}`);
