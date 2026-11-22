import { expect, it } from 'vitest';
import { createIpaPls } from '../src/pronunciation-dictionary.js';

it('creates an escaped, case-sensitive Ukrainian IPA PLS lexicon', () => {
  const xml = createIpaPls([
    { grapheme: 'Київ & друзі', phoneme: '/ˈkɪjiu̯/' },
    { grapheme: 'Київ', phoneme: '/ˈkɪjiu̯/' },
    { grapheme: 'київ', phoneme: '/kɪˈjiu̯/' },
  ]);

  expect(xml).toContain('alphabet="ipa" xml:lang="uk-UA"');
  expect(xml).toContain('<grapheme>Київ &amp; друзі</grapheme>');
  expect(xml.match(/<lexeme>/gu)).toHaveLength(3);
  expect(xml).toContain('<phoneme>/ˈkɪjiu̯/</phoneme>');
  expect(xml.endsWith('</lexicon>\n')).toBe(true);
});

it('rejects empty, duplicate, multiline, and invalid-language lexicons', () => {
  expect(() => createIpaPls([])).toThrow(/at least one/u);
  expect(() => createIpaPls([
    { grapheme: 'Київ', phoneme: '/ˈkɪjiu̯/' },
    { grapheme: 'Київ', phoneme: '/kɪˈjiu̯/' },
  ])).toThrow(/duplicate grapheme/u);
  expect(() => createIpaPls([{ grapheme: 'Київ\nТернопіль', phoneme: '/ˈkɪjiu̯/' }])).toThrow(/single line/u);
  expect(() => createIpaPls([{ grapheme: 'Київ', phoneme: '/ˈkɪjiu̯/' }], { language: 'uk-UA>' })).toThrow(/BCP 47/u);
});
