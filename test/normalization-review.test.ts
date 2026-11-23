import { describe, expect, it } from 'vitest';
import {
  applyNormalizationReview,
  createNormalizationReview,
  NormalizationRules,
  prepare,
} from '../src/index.js';

describe('normalization review API', () => {
  const input = 'Дата 31.02.2026, час 25:99.';

  it('exports unresolved semantic spans with exact UTF-16 anchors and sentence context', () => {
    const review = createNormalizationReview(input);

    expect(review.format).toBe('ua-tts-text-normalization-review');
    expect(review.version).toBe(1);
    expect(review.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(review.occurrences.map(({ sourceText }) => sourceText)).toEqual(['31.02.2026', '25:99']);
    expect(review.occurrences[0]).toMatchObject({
      id: `${input.indexOf('31.02.2026')}:${input.indexOf('31.02.2026') + '31.02.2026'.length}`,
      sourceText: '31.02.2026',
      normalizedText: '31.02.2026',
      context: input,
      reason: 'Некоректна дата у форматі ДД.ММ.РРРР.',
      value: { year: 2026, month: 2, day: 31 },
      replacement: null,
    });
  });

  it('applies selected readings and leaves unanswered spans as semantic findings', () => {
    const review = createNormalizationReview(input);
    const edited = {
      ...review,
      occurrences: review.occurrences.map((occurrence) => ({
        ...occurrence,
        replacement: occurrence.sourceText === '31.02.2026' ? 'тридцять першого лютого' : null,
      })),
    };
    const applied = applyNormalizationReview(input, edited);

    expect(applied.applied).toBe(1);
    expect(applied.unresolved).toBe(1);
    expect(applied.corrections).toBeDefined();
    const prepared = prepare(input, {
      engine: 'plain',
      ...(applied.corrections ? { normalizationCorrections: applied.corrections } : {}),
    });
    expect(prepared.text).toBe('Дата тридцять першого лютого, час 25:99.');
    expect(prepared.normalizationCorrectionsApplied).toBe(1);
    expect(prepared.semanticFindings?.map(({ raw }) => raw)).toEqual(['25:99']);
  });

  it('rejects reviews for changed text, normalization options, or edited anchors', () => {
    const review = createNormalizationReview(input);
    const changedAnchor = {
      ...review,
      occurrences: review.occurrences.map((item, index) =>
        index === 0 ? { ...item, sourceStart: item.sourceStart + 1 } : item,
      ),
    };

    expect(() => applyNormalizationReview('Дата 30.02.2026, час 25:99.', review)).toThrow(/stale/);
    expect(() => applyNormalizationReview(input, review, { punctuation: false })).toThrow(/stale/);
    expect(() => applyNormalizationReview(input, changedAnchor)).toThrow(/no longer matches/);
  });

  it('rejects incomplete or duplicated occurrence lists and malformed replacement text', () => {
    const review = createNormalizationReview(input);
    expect(() => applyNormalizationReview(input, { ...review, occurrences: review.occurrences.slice(1) }))
      .toThrow(/missing occurrences/);
    expect(() => applyNormalizationReview(input, {
      ...review,
      occurrences: [...review.occurrences, review.occurrences[0]],
    })).toThrow(/duplicate occurrence/);
    const untrimmed = {
      ...review,
      occurrences: review.occurrences.map((item, index) =>
        index === 0 ? { ...item, replacement: ' неправильно ' } : item,
      ),
    };
    expect(() => applyNormalizationReview(input, untrimmed)).toThrow(/trimmed phrase/);
  });

  it('omits spans resolved by a verified project rule and rejects that review under a different rule set', () => {
    const review = createNormalizationReview(input);
    const rules = NormalizationRules.parseTsv('31.02.2026\tдата з глосарію\tредактор\tverified');

    expect(createNormalizationReview(input, { rules }).occurrences.map(({ sourceText }) => sourceText)).toEqual(['25:99']);
    expect(() => applyNormalizationReview(input, review, { rules })).toThrow(/stale/);
  });

  it('returns no correction set when every occurrence remains unresolved', () => {
    const review = createNormalizationReview(input);
    const applied = applyNormalizationReview(input, review);

    expect(applied).toMatchObject({ applied: 0, unresolved: 2, fingerprint: review.fingerprint });
    expect(applied.corrections).toBeUndefined();
  });

  it('applies a selected bounded date candidate and rejects an unavailable candidate', () => {
    const date = 'Дата 01/02/2026.';
    const review = createNormalizationReview(date);
    const occurrence = review.occurrences[0]!;

    expect(occurrence.candidates?.map(({ id }) => id)).toEqual(['day-first', 'month-first']);
    const selected = {
      ...review,
      occurrences: review.occurrences.map((item) => ({ ...item, candidateId: 'day-first' })),
    };
    const applied = applyNormalizationReview(date, selected);
    expect(applied.applied).toBe(1);
    const prepared = prepare(date, {
      engine: 'plain',
      ...(applied.corrections ? { normalizationCorrections: applied.corrections } : {}),
    });
    expect(prepared.text).toContain('першого лютого');
    expect(prepared.semanticFindings).toEqual([]);

    expect(() => applyNormalizationReview(date, {
      ...review,
      occurrences: review.occurrences.map((item) => ({ ...item, candidateId: 'invented' })),
    })).toThrow(/candidate .*not available/u);
  });
});
