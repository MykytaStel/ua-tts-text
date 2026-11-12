import { beforeAll, describe, expect, it } from 'vitest';
import { describeDict, loadDictFixture } from './dict-fixture.js';
import { applyDecisions, parseDecisions, reviewPrompt } from '../src/agent.js';
import { StressDictionary } from '../src/dict.js';
import { prepare } from '../src/index.js';

let dict: StressDictionary;

beforeAll(() => {
  dict = loadDictFixture();
});

describeDict('reviewPrompt', () => {
  it('містить контекст і обидва варіанти', () => {
    const result = prepare('Замок стоїть на горі.', { dictionary: dict });
    const prompt = reviewPrompt(result.homographs);
    expect(prompt).toContain('«Замок стоїть на горі»');
    expect(prompt).toContain('За́мок');
    expect(prompt).toContain('Замо́к');
  });

  it('порожній список — порожній запит', () => {
    expect(reviewPrompt([])).toBe('');
  });
});

describeDict('parseDecisions', () => {
  it('приймає чистий JSON', () => {
    expect(parseDecisions('{"замок": 0, "горі": 1}')).toEqual({ замок: 0, горі: 1 });
  });

  it('знімає markdown-обгортку', () => {
    expect(parseDecisions('```json\n{"замок": 1}\n```')).toEqual({ замок: 1 });
  });

  it('відкидає значення не 0/1', () => {
    expect(() => parseDecisions('{"замок": 2}')).toThrow(/must be 0 or 1/u);
  });

  it('відкидає не-обʼєкт', () => {
    expect(() => parseDecisions('[1, 2]')).toThrow(/expected a JSON object/u);
  });
});

describeDict('applyDecisions', () => {
  it('застосовує рішення і показує пропущені', () => {
    const result = prepare('Замок стоїть на горі.', { dictionary: dict });
    const report = applyDecisions(result.homographs, { замок: 0 });
    expect(report.decisions).toEqual({ замок: 0 });
    expect(report.missing).toContain('горі');
    expect(report.extra).toEqual([]);
  });

  it('показує зайві ключі', () => {
    const result = prepare('Замок стоїть на горі.', { dictionary: dict });
    const report = applyDecisions(result.homographs, { замок: 0, горі: 1, кіт: 1 });
    expect(report.extra).toEqual(['кіт']);
  });
});
