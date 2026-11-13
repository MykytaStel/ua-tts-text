import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { StressDictionary } from '../dist/dict.js';

test('dictionary builder drops stress marks that are not attached to vowels', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'ua-dict-check-'));
  try {
    const source = path.join(temp, 'source.txt');
    const output = path.join(temp, 'dict.bin');
    writeFileSync(source, 'сло́во\nслв́о\nсло́́во\n');
    const script = fileURLToPath(new URL('./build-dict.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, source, output], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.keys, 1);
    assert.equal(summary.skippedInvalidStress, 2);
    const dictionary = StressDictionary.load(output);
    assert.equal(dictionary.invalidEntryCount, 0);
    assert.equal(dictionary.lookup('слово')?.position, 2);
    assert.equal(readFileSync(output).length, summary.bytes);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('source pin records its source revision, digest, and binary format', () => {
  const file = fileURLToPath(new URL('./dictionary-source.json', import.meta.url));
  const pin = JSON.parse(readFileSync(file, 'utf8'));
  assert.match(pin.commit, /^[0-9a-f]{40}$/u);
  assert.match(pin.sha256, /^[0-9a-f]{64}$/u);
  assert.equal(pin.binaryFormat, 3);
  assert.ok(pin.url.includes(pin.commit));
});
