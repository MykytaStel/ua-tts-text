import { expect, it } from 'vitest';
import { parseStressed, Lexicon } from '../src/lexicon.js';
import { ContextRules } from '../src/context.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
it('accepts only acute marks attached to vowels', () => {
  expect(parseStressed('Кропивни́цький').positions).toEqual([7]);
  expect(() => parseStressed('Кропивн́ицький')).toThrow(/must follow a vowel/);
  expect(() => parseStressed('сло́́во')).toThrow(/duplicate stress mark/);
  expect(() => parseStressed('а́е́і́')).not.toThrow();
});
it('validates every checked-in lexicon and context rule without the large dictionary', () => {
  const file = (name: string) => fileURLToPath(new URL(`../lexicon/${name}`, import.meta.url));
  expect(Lexicon.loadTsv(file('common.tsv')).size).toBeGreaterThan(0);
  expect(Lexicon.loadTsv(file('names.tsv')).size).toBeGreaterThan(0);
  expect(ContextRules.loadTsv(file('context.tsv')).size).toBeGreaterThan(25);
});

it('keeps project drafts and rejected names visible without applying their stresses', () => {
  const lexicon = Lexicon.parseTsv(
    [
      'Степ\tСте́п\tперсонаж\tредактор\tfilm-a\tСтеп\tverified',
      'Лис\tЛи́с\tперсонаж\tавтоматична пропозиція\tfilm-a\tЛис\tdraft',
      'Марс\tМа́рс\tбренд\tвідхилено редактором\tfilm-a\tМарс\trejected',
    ].join('\n'),
  );
  expect(lexicon.lookup('степ')?.position).toBe(2);
  expect(lexicon.explain('степ')).toMatchObject({ project: 'film-a', canonicalName: 'Степ', status: 'verified' });
  expect(lexicon.lookup('лис')).toBeNull();
  expect(lexicon.lookup('марс')).toBeNull();
  expect(lexicon.inactiveEntries.map(({ status }) => status)).toEqual(['draft', 'rejected']);
  expect(() => Lexicon.parseTsv('Лис\tЛи́с\t\t\t\tЛис\tpending')).toThrow(/invalid status/);
});

it('rejects malformed, mismatched, and duplicate TSV entries', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ua-lexicon-'));
  const file = path.join(dir, 'names.tsv');
  try {
    writeFileSync(file, 'слово\tсло́во\nслово\tслово́\n');
    expect(() => Lexicon.loadTsv(file)).toThrow(/names.tsv:2: duplicate word/);
    writeFileSync(file, 'слово\tрука́\n');
    expect(() => Lexicon.loadTsv(file)).toThrow(/does not match/);
    writeFileSync(file, 'слово\tсл́ово\n');
    expect(() => Lexicon.loadTsv(file)).toThrow(/names.tsv:1: parseStressed: mark must follow a vowel/);
    writeFileSync(file, 'слово\t\n');
    expect(() => Lexicon.loadTsv(file)).toThrow(/need word and stressed form/);
    writeFileSync(file, 'слово\tсло́во́\n');
    expect(Lexicon.loadTsv(file).lookup('слово')?.dual).toBe(true);
    expect(() => new Lexicon().add('аеі', [0, 1, 2])).toThrow(/at most two positions/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
