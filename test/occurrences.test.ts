import { expect, it } from 'vitest';
import { describeDict, loadDictFixture } from './dict-fixture.js';
import { prepareMany, prepare, convertStressMarks } from '../src/index.js';
import { Lexicon } from '../src/lexicon.js';
let dictionary: ReturnType<typeof loadDictFixture> | undefined;
const getDictionary = () => (dictionary ??= loadDictFixture());

describeDict('occurrence isolation', () => {
  it('keeps opposite choices within one paragraph and across paragraphs', async () => {
    const result = await prepareMany(['Замок. Замок.', 'Замок.'], {
      dictionary: getDictionary(),
      engine: 'tts-uk',
      ask: async () => JSON.stringify({ '0:0': 0, '0:7': 1, '1:0': 1, '99:0': 0, замок: 0 }),
    });
    expect(result.results.map((r) => r.text)).toEqual(['З+амок. Зам+ок.', 'Зам+ок.']);
    expect(Object.keys(result.decisions)).toEqual(['0:0', '0:7', '1:0']);
  });
  it('applies explicit occurrence decisions without requiring an LLM', async () => {
    const result = await prepareMany(['Замок. Замок.'], { dictionary: getDictionary(), engine: 'tts-uk', occurrenceDecisions: { '0:0': 1 } });
    expect(result.results[0]!.text).toBe('Зам+ок. Замок.');
    expect(result.results[0]!.ambiguousOccurrences).toEqual([{ word: 'Замок', offset: 7 }]);
    expect(result.results[0]!.homographs.map((item) => item.offset)).toEqual([7]);
    expect(result.decisionFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    await expect(
      prepareMany(['Замок. Інший текст.'], {
        dictionary: getDictionary(),
        engine: 'tts-uk',
        occurrenceDecisions: { '0:0': 1 },
        expectedDecisionFingerprint: result.decisionFingerprint,
      }),
    ).rejects.toThrow(/different input or resource snapshot/);
  });
  it('rejects paragraph-ambiguous legacy occurrence offsets', async () => {
    await expect(
      prepareMany(['Замок.', 'Замок.'], {
        dictionary: getDictionary(),
        stress: { occurrenceDecisions: { 0: 1 } },
      }),
    ).rejects.toThrow(/paragraph:offset keys/);
  });
  it('keeps abstentions unresolved and does not guess unknown names by default', async () => {
    const result = await prepareMany(['Замок. Краудфандинг.'], {
      dictionary: getDictionary(),
      engine: 'tts-uk',
      ask: async () => '{"0:0":null}',
    });
    expect(result.results[0]!.ambiguous).toEqual(['Замок']);
    expect(result.overrides).toEqual({});
    expect(result.missing).toEqual(['0:0']);
  });
  it('preserves explicit choices and overrides during resolution', async () => {
    const result = await prepareMany(['Замок. Горі. Краудфандинг.'], {
      dictionary: getDictionary(),
      engine: 'tts-uk',
      stress: { decisions: { замок: 1 }, overrides: { краудфандинг: 6 } },
      ask: async () => '{"0:7":1,"0:0":0}',
    });
    expect(result.results[0]!.text).toContain('Зам+ок. Гор+і. Краудф+андинг.');
  });
  it('converts manual marks without splitting words or adding another stress', () => {
    expect(prepare('Замо́к. +Інший.', { dictionary: getDictionary(), engine: 'tts-uk' }).text).toBe('Зам+ок. +Інший.');
    expect(prepare('Зам+ок. +Інший.', { dictionary: getDictionary(), engine: 'edge-tts' }).text).toBe('Замок. Інший.');
    expect(convertStressMarks('2 + 2, молок+о', 'none')).toBe('2 + 2, молоко');
  });
});

it('can resolve an explicitly requested unknown word with only a project lexicon', async () => {
  const lexicon = new Lexicon();
  lexicon.add('Київ', [1]);
  const result = await prepareMany(['Невідоме. Київ.'], {
    lexicon,
    engine: 'piper-medium',
    resolveUnknown: true,
    ask: async () => '{"невідоме":7}',
  });
  expect(result.overrides).toEqual({ невідоме: 7 });
  expect(result.results[0]!.text).toBe('Невідоме́. Ки́їв.');
});
