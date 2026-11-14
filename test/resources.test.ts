import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { loadResources, NormalizationRules, prepare, prepareMany, resetResourceCache } from '../src/index.js';
import { ContextRules } from '../src/context.js';
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  resetResourceCache();
});
it('merges bundled defaults and local overrides, and refreshes changed files', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ua-resources-'));
  dirs.push(root);
  const home = path.join(root, 'home');
  mkdirSync(home);
  mkdirSync(path.join(root, 'lexicon'));
  writeFileSync(path.join(root, 'package.json'), '{"version":"test"}');
  writeFileSync(path.join(root, 'lexicon/names.tsv'), 'замок\tза́мок\n');
  writeFileSync(path.join(root, 'lexicon/normalization.tsv'), 'АТБ\tа-те-бе\tbundled glossary\tverified\n');
  writeFileSync(path.join(home, 'names.tsv'), 'замок\tзамо́к\n');
  writeFileSync(path.join(home, 'normalization.tsv'), 'АТБ\tбренд\tproject glossary\tverified\n');
  const options = { home, packageRoot: root, dictionaryPath: path.join(root, 'missing'), normalizationPath: path.join(home, 'normalization.tsv') };
  const first = loadResources(options);
  expect(first.lexicon.lookup('замок')?.position).toBe(3);
  expect(first.lexicon.explain('замок')).toMatchObject({ word: 'замок', stressed: 'замо́к', source: '' });
  expect(first.normalization.explain('АТБ')).toMatchObject({ replacement: 'бренд', source: 'project glossary' });
  expect(first.manifest.files.some((file) => file.path.endsWith('/src/resources.ts'))).toBe(true);
  expect(first.manifest.files.some((file) => file.path.endsWith('/normalization.tsv'))).toBe(true);
  expect(prepare('АТБ 15', { resources: first }).text).toBe("бренд п'ятнадцять");
  const disabledRules = prepare('АТБ', { resources: first, normalize: { rules: null } });
  expect(disabledRules.text).toBe('АТБ');
  expect(disabledRules.resourceFingerprint).not.toBe(first.manifest.fingerprint);
  const explicitRules = NormalizationRules.parseTsv('АТБ\tназва\tручний override\tverified');
  expect(prepare('АТБ', { resources: first, normalize: { rules: explicitRules } }).resourceFingerprint)
    .not.toBe(first.manifest.fingerprint);
  const prepared = prepare('Замок', { resources: first, engine: 'piper-medium', stress: { trace: true } });
  expect(prepared.resourceFingerprint).toBe(first.manifest.fingerprint);
  expect(prepared.evidence?.[0]?.resourceFingerprint).toBe(first.manifest.fingerprint);
  expect(
    prepare('Слово', {
      resources: first,
      context: null,
      engine: 'piper-medium',
      stress: { context: ContextRules.parse('слово\tсло́во\t*\tmanual') },
    }).text,
  ).toBe('Слово');
  expect(Object.isFrozen(first.manifest)).toBe(true);
  expect(Object.isFrozen(first.manifest.files)).toBe(true);
  expect(() => first.lexicon.add('слово', [2])).toThrow(/immutable/);
  expect(() => first.context.add('слово', [2], '*')).toThrow(/immutable/);
  writeFileSync(path.join(home, 'names.tsv'), 'замок\tза́мок\nмолоко\tмолоко́\n');
  writeFileSync(path.join(home, 'normalization.tsv'), 'АТБ\tназва\tоновлений глосарій\tverified\n');
  const second = loadResources(options);
  expect(second.lexicon.lookup('замок')?.position).toBe(1);
  expect(second.normalization.explain('АТБ')?.replacement).toBe('назва');
  expect(second.manifest.fingerprint).not.toBe(first.manifest.fingerprint);
  const saved = await prepareMany(['Кодове'], { resources: first, engine: 'piper-medium' });
  await expect(
    prepareMany(['Кодове'], {
      resources: second,
      engine: 'piper-medium',
      expectedDecisionFingerprint: saved.decisionFingerprint,
    }),
  ).rejects.toThrow(/different input or resource snapshot/);
  expect(() => loadResources({ ...options, required: true })).toThrow('dictionary missing');
  expect(() => loadResources({ ...options, lexiconPath: path.join(root, 'typo') })).toThrow('lexicon missing');
  expect(() => loadResources({ ...options, normalizationPath: path.join(root, 'typo') })).toThrow('normalization rules missing');
});
