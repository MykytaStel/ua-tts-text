import { expect, it } from 'vitest';
import { prepare } from '../src/index.js';
import type { EngineId } from '../src/render.js';
import { Lexicon } from '../src/lexicon.js';
import { markWord } from '../src/stress.js';

it('rejects an unknown engine with a stable API error', () => {
  expect(() => prepare('Молоко', { engine: 'not-an-engine' as EngineId })).toThrow('prepare: unknown engine');
});

it('applies a user lexicon without the base dictionary', () => {
  const lexicon = new Lexicon();
  lexicon.add('Київ', [1]);
  const result = prepare('Київ', { engine: 'piper-medium', lexicon });
  expect(result.text).toBe('Ки́їв');
  expect(result.warnings).toContain('base stress dictionary missing; only configured lexicon entries are available');
});

it('rejects runtime stress positions that do not identify a vowel', () => {
  expect(() => markWord('слово', [1], 'acute')).toThrow(/distinct vowels/);
});
