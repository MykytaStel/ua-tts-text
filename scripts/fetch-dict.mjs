#!/usr/bin/env node
/** Reproducible dictionary install. Never replaces local TSV overrides. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const pin = JSON.parse(readFileSync(path.join(here, 'dictionary-source.json'), 'utf8'));
if (pin.binaryFormat !== 3) throw new Error(`unsupported dictionary binary format: ${pin.binaryFormat}`);
const home = process.env['UA_TTS_HOME'] || path.join(os.homedir(), '.local/share/ua-tts-text');
const targetDir = process.argv.includes('--local') || existsSync(path.join(root, '.git')) ? path.join(root, 'data') : home;
mkdirSync(targetDir, { recursive: true });
const token = randomUUID();
const source = path.join(targetDir, `.stress-${token}.txt`);
const temporary = path.join(targetDir, `.dict-${token}.bin`);
const target = path.join(targetDir, 'dict.bin');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
try {
  const response = await fetch(pin.url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`dictionary HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== pin.sha256) throw new Error('dictionary source SHA-256 mismatch; installed dictionary unchanged');
  writeFileSync(source, bytes);
  const result = spawnSync(process.execPath, [path.join(here, 'build-dict.mjs'), source, temporary], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`dictionary build failed: ${result.status}`);
  const binaryHash = sha256(readFileSync(temporary));
  if (existsSync(target)) {
    const oldHash = sha256(readFileSync(target));
    if (oldHash !== binaryHash) copyFileSync(target, path.join(targetDir, `dict.${oldHash}.bin`));
  }
  renameSync(temporary, target);
  writeFileSync(path.join(targetDir, 'dict.manifest.json'), JSON.stringify({ ...pin, binarySha256: binaryHash }, null, 2));
  console.log(`готово: ${target} (${binaryHash})`);
} finally {
  rmSync(source, { force: true });
  rmSync(temporary, { force: true });
}
