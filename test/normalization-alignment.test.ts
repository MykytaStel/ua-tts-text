import { describe, expect, it } from 'vitest';
import { prepare, prepareMany } from '../src/index.js';
import {
  createNormalizationCorrectionSet,
  normalizeWithAlignment,
} from '../src/normalize.js';

function expectAlignmentMatchesText(input: string, result: ReturnType<typeof normalizeWithAlignment>): void {
  for (const segment of result.alignment) {
    expect(input.slice(segment.sourceStart, segment.sourceEnd)).toBe(segment.sourceText);
    expect(result.text.slice(segment.spokenStart, segment.spokenEnd)).toBe(segment.spokenText);
  }
}

describe('normalization source alignment', () => {
  it('keeps repeated measures as separate source occurrences and maps one-to-many expansions', () => {
    const input = '5 км і 5 км.';
    const result = normalizeWithAlignment(input);
    const measures = result.alignment.filter((segment) => segment.sourceText === '5 км');

    expect(measures).toHaveLength(2);
    expect(measures.map((segment) => segment.sourceStart)).toEqual([
      input.indexOf('5 км'),
      input.indexOf('5 км', input.indexOf('5 км') + 1),
    ]);
    expect(measures.map((segment) => segment.spokenText)).toEqual([
      "п'ять кілометрів",
      "п'ять кілометрів",
    ]);
    expect(measures.every((segment) => segment.changed)).toBe(true);
    expectAlignmentMatchesText(input, result);
  });

  it('uses JavaScript UTF-16 offsets when the source begins with a supplementary character', () => {
    const input = '😀 5 км';
    const result = normalizeWithAlignment(input);
    const measure = result.alignment.find((segment) => segment.sourceText === '5 км');

    expect(measure?.sourceStart).toBe(input.indexOf('5 км'));
    expect(measure?.sourceStart).toBe(3);
    expect(measure && input.slice(measure.sourceStart, measure.sourceEnd)).toBe('5 км');
    expectAlignmentMatchesText(input, result);
  });
});

describe('saved occurrence-level normalization corrections', () => {
  it('replays only the selected repeated occurrence and updates all spoken offsets', () => {
    const input = '5 км і 5 км.';
    const preview = normalizeWithAlignment(input);
    const secondMeasure = preview.alignment
      .filter((segment) => segment.sourceText === '5 км')[1]!;
    const corrections = createNormalizationCorrectionSet(preview, [{
      sourceStart: secondMeasure.sourceStart,
      sourceEnd: secondMeasure.sourceEnd,
      spokenStart: secondMeasure.spokenStart,
      spokenEnd: secondMeasure.spokenEnd,
      replacement: 'п’ять миль',
      source: 'verified pronunciation',
    }]);

    const corrected = normalizeWithAlignment(input, { corrections });
    const correctedMeasures = corrected.alignment.filter((segment) => segment.sourceText === '5 км');

    expect(corrected.correctionsApplied).toBe(1);
    expect(corrected.text).toBe("п'ять кілометрів і п’ять миль.");
    expect(correctedMeasures.map((segment) => segment.spokenText)).toEqual([
      "п'ять кілометрів",
      'п’ять миль',
    ]);
    expect(correctedMeasures[1]?.stage).toBe('manual-correction');
    expectAlignmentMatchesText(input, corrected);
  });

  it('rejects corrections made for different input or normalization options', () => {
    const input = '5 км; 5 км.';
    const preview = normalizeWithAlignment(input);
    const segment = preview.alignment.find((item) => item.sourceText === '5 км')!;
    const corrections = createNormalizationCorrectionSet(preview, [{
      sourceStart: segment.sourceStart,
      sourceEnd: segment.sourceEnd,
      spokenStart: segment.spokenStart,
      spokenEnd: segment.spokenEnd,
      replacement: 'п’ять миль',
    }]);

    expect(() => normalizeWithAlignment('5 м; 5 км.', { corrections })).toThrow(/stale/);
    expect(() => normalizeWithAlignment(input, { punctuation: false, corrections })).toThrow(/stale/);
  });

  it('applies validated corrections before prepare rendering and resolves the matching semantic finding', () => {
    const input = 'Дата 31.02.2026, далі.';
    const preview = normalizeWithAlignment(input);
    const invalidDate = preview.alignment.find((segment) => segment.sourceText === '31.02.2026')!;
    const corrections = createNormalizationCorrectionSet(preview, [{
      sourceStart: invalidDate.sourceStart,
      sourceEnd: invalidDate.sourceEnd,
      spokenStart: invalidDate.spokenStart,
      spokenEnd: invalidDate.spokenEnd,
      replacement: 'тридцять першого лютого',
    }]);

    const prepared = prepare(input, { engine: 'plain', normalizationCorrections: corrections });

    expect(prepared.text).toBe('Дата тридцять першого лютого, далі.');
    expect(prepared.normalizationFingerprint).toBe(preview.fingerprint);
    expect(prepared.normalizationCorrectionsApplied).toBe(1);
    expect(prepared.semanticFindings).toEqual([]);
  });

  it('limits one saved correction set to one exact input in prepareMany', async () => {
    const input = '5 км';
    const preview = normalizeWithAlignment(input);
    const segment = preview.alignment.find((item) => item.sourceText === input)!;
    const corrections = createNormalizationCorrectionSet(preview, [{
      sourceStart: segment.sourceStart,
      sourceEnd: segment.sourceEnd,
      spokenStart: segment.spokenStart,
      spokenEnd: segment.spokenEnd,
      replacement: 'п’ять миль',
    }]);

    await expect(prepareMany(['5 км', '7 км'], { normalizationCorrections: corrections }))
      .rejects.toThrow(/scoped to one exact input/);
    await expect(prepareMany([input], { normalizationCorrections: corrections }))
      .resolves.toMatchObject({ results: [{ text: 'п’ять миль', normalizationCorrectionsApplied: 1 }] });
  });
});
