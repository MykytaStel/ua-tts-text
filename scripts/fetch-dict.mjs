#!/usr/bin/env node
/**
 * Завантажує словник lang-uk і збирає з нього бінарний data/dict.bin.
 *   node scripts/fetch-dict.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const dataDir = path.join(root, 'data');
const source = path.join(dataDir, 'stress.txt');

const URL_STRESS =
  'https://raw.githubusercontent.com/lang-uk/ukrainian-word-stress-dictionary/master/stress.txt';

mkdirSync(dataDir, { recursive: true });

console.log('завантажую словник (~70 МБ)…');
const response = await fetch(URL_STRESS);
if (!response.ok) throw new Error(`HTTP ${response.status} для ${URL_STRESS}`);
const bytes = Buffer.from(await response.arrayBuffer());
writeFileSync(source, bytes);
console.log(`записано ${source} (${(bytes.length / 1024 / 1024).toFixed(1)} МБ)`);

const result = spawnSync(process.execPath, [path.join(here, 'build-dict.mjs')], { stdio: 'inherit' });
process.exit(result.status ?? 1);
