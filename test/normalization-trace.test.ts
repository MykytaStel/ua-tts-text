import { describe, expect, it } from 'vitest';
import { normalize, normalizeWithTrace } from '../src/normalize.js';
import { NormalizationRules } from '../src/normalization-rules.js';

it('traces built-in unit, acronym, and punctuation transformations in order', () => {
  const input = 'На 5 км; США.';
  const result = normalizeWithTrace(input);

  expect(result.text).toBe("На п'ять кілометрів, ес-ша-а.");
  expect(result.text).toBe(normalize(input));
  expect(result.steps.map(({ stage, before, after }) => [stage, before, after])).toEqual([
    ['unit', '5 км', "п'ять кілометрів"],
    ['acronym', 'США', 'ес-ша-а'],
    ['punctuation', '; ', ', '],
  ]);
  expect(result.steps.every(({ explanation }) => explanation.length > 0)).toBe(true);
});

it('traces Unicode cleanup and project-rule provenance while preserving the 0.18 rule list', () => {
  const rules = NormalizationRules.parseTsv('АТБ\tа-те-бе\tглосарій Studio\tverified');
  const result = normalizeWithTrace('зʼїзд АТБ 50%', { rules });

  expect(result.text).toBe("з'їзд а-те-бе п'ятдесят відсотків");
  expect(result.steps.map(({ stage, before, after, source }) => [stage, before, after, source])).toEqual([
    ['unicode', 'ʼ', "'", undefined],
    ['project-rule', 'АТБ', 'а-те-бе', 'глосарій Studio'],
    ['percent', '50%', "п'ятдесят відсотків", undefined],
  ]);
  expect(result.ruleApplications).toEqual([
    { matched: 'АТБ', match: 'АТБ', replacement: 'а-те-бе', source: 'глосарій Studio' },
  ]);
});

describe('normalizeWithTrace covers every built-in normalization stage', () => {
  it.each([
    ['24 251', 'digit-groups'],
    ['1-го січня', 'ordinal-date'],
    ['5-й', 'ordinal'],
    ['01.02.2024', 'date'],
    ['50/50', 'ratio'],
    ['2020–2021 роки', 'year-range'],
    ['15–20 км', 'range'],
    ['2020 рік', 'year'],
    ['IV столітті', 'century'],
    ['50%', 'percent'],
    ['250 тис. грн', 'currency'],
    ['т.д.', 'abbreviation'],
    ['№ 5', 'identifier'],
    ['42', 'number'],
  ] as const)('%s reports the %s stage', (input, stage) => {
    const result = normalizeWithTrace(input);

    expect(result.text).toBe(normalize(input));
    expect(result.steps.some((step) => step.stage === stage && step.before !== step.after)).toBe(true);
  });
});
