import { expect, it } from 'vitest';
import { StressDictionary } from '../src/dict.js';
import { ContextRules } from '../src/context.js';
import { Lexicon } from '../src/lexicon.js';
import { prepare } from '../src/index.js';

it('explains a project lexicon decision and warns when the base dictionary is absent', () => {
  const lexicon = new Lexicon();
  lexicon.add('Київ', [1], { category: 'place', source: 'editorial review' });
  const result = prepare('Київ.', { lexicon, engine: 'piper-medium', stress: { trace: true } });
  expect(result.text).toBe('Ки́їв.');
  expect(result.evidence).toEqual([
    {
      word: 'Київ',
      offset: 0,
      source: 'lexicon',
      positions: [1],
      sourceId: 'Київ',
      detail: 'place · editorial review',
      verification: 'curated',
    },
  ]);
  expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('base stress dictionary missing')]));
  expect(lexicon.explain('київ')).toMatchObject({ source: 'editorial review', category: 'place' });
});

it('gives explicit lexicon rows priority over broad context rules', () => {
  const lexicon = new Lexicon();
  lexicon.add('мала', [3], { source: 'approved pronunciation' });
  const context = ContextRules.parse('мала\tма́ла\tfirst\ttoo broad');
  const result = prepare('Мала.', {
    dictionary: StressDictionary.empty(),
    lexicon,
    context,
    engine: 'piper-medium',
    stress: { trace: true },
  });
  expect(result.text).toBe('Мала́.');
  expect(result.contextual).toBe(0);
  expect(result.evidence?.[0]).toMatchObject({ source: 'lexicon', positions: [3] });
});

it('accepts a lexicon through stress options without a base dictionary', () => {
  const lexicon = new Lexicon();
  lexicon.add('Київ', [1]);
  const result = prepare('Київ.', { engine: 'piper-medium', stress: { lexicon } });
  expect(result.text).toBe('Ки́їв.');
  expect(result.warnings).toContain('base stress dictionary missing; only configured lexicon entries are available');
});
