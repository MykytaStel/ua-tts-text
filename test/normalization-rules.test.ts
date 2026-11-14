import { expect, it } from 'vitest';
import { normalize } from '../src/normalize.js';
import { NormalizationRules } from '../src/normalization-rules.js';

it('applies verified literal readings once, longest phrase first, without touching neighboring words', () => {
  const rules = NormalizationRules.parseTsv(
    [
      'АТБ\tа-те-бе\tредактор проєкту\tverified',
      'Київ\tстолиця\tглосарій\tverified',
      'Київська область\tКиївщина\tглосарій\tverified',
      'чернетка\tне застосовувати\tчернетка\tdraft',
      'застаріле\tне застосовувати\tвідхилено редактором\trejected',
      'старт\tфініш\tперевірка відсутності каскаду\tverified',
      'фініш\tкінець\tперевірка відсутності каскаду\tverified',
      'C++\tсі плюс плюс\tглосарій коду\tverified',
    ].join('\n'),
    'normalization.tsv',
  );

  expect(rules.apply('АТБ; ПАТБ; АТБ123; АТБ-компанія')).toBe('а-те-бе; ПАТБ; АТБ123; АТБ-компанія');
  expect(rules.apply('КИЇВСЬКА   ОБЛАСТЬ і Київ')).toBe('Київщина і столиця');
  expect(rules.apply('чернетка, застаріле; старт')).toBe('чернетка, застаріле; фініш');
  expect(rules.apply('C++ та C---')).toBe('сі плюс плюс та C---');
  expect(rules.explain('київська область')).toMatchObject({ replacement: 'Київщина', source: 'глосарій', status: 'verified' });
  expect(rules.inactiveEntries.map(({ match, status }) => [match, status])).toEqual([
    ['чернетка', 'draft'],
    ['застаріле', 'rejected'],
  ]);
});

it('protects replacement text from normalizer passes while still normalizing surrounding quantities', () => {
  const rules = NormalizationRules.parseTsv('АТБ\tбренд 15\tузгоджена назва\tverified\n', 'normalization.tsv');
  expect(normalize('АТБ 15', { rules })).toBe("бренд 15 п'ятнадцять");
  const apostropheRule = NormalizationRules.parseTsv("п’ять\tп'ять\tглосарій\tverified");
  expect(normalize('пʼять', { rules: apostropheRule })).toBe("п'ять");
});

it('validates TSV provenance, duplicate keys, statuses, and immutable snapshots', () => {
  expect(() => NormalizationRules.parseTsv('АТБ\tа-те-бе', 'normalization.tsv')).toThrow(/need match, replacement, and source/);
  expect(() => NormalizationRules.parseTsv('АТБ\ta\tджерело\tverified\nатб\tb\tінше джерело\tverified', 'normalization.tsv')).toThrow(/duplicate match/);
  expect(() => NormalizationRules.parseTsv('АТБ\tа\tджерело\tunknown', 'normalization.tsv')).toThrow(/invalid status/);
  expect(() => NormalizationRules.parseTsv(`АТБ\ta\tdжерело\u0001\tverified`, 'normalization.tsv')).toThrow(/control characters/);
  expect(() => NormalizationRules.parseTsv(`АТБ\t\uE100а\tредактор\tverified`, 'normalization.tsv')).toThrow(/reserved token characters/);
  const rules = NormalizationRules.parseTsv('АТБ\tа-те-бе\tредактор\tverified', 'normalization.tsv').seal();
  expect(() => rules.add('СБУ', 'ес-бе-у', { source: 'редактор' })).toThrow(/immutable/);
  expect(rules.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
  expect(rules.fingerprint).not.toBe(NormalizationRules.parseTsv('АТБ\tа-те-бе\tінше джерело\tverified').fingerprint);
});
