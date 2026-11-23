import { describe, expect, it } from 'vitest';
import {
  applySpeechReview,
  createSpeechReview,
  StressDictionary,
  type StressSource,
} from '../src/index.js';

describe('unified speech review', () => {
  const input = 'Дата 01/02/2026, замок і Краудфандинг.';
  const lexicon: StressSource = {
    lookup: (word) => word.toLocaleLowerCase('uk-UA') === 'замок'
      ? { position: 1, alternative: 3, dual: false }
      : null,
  };
  const options = {
    engine: 'tts-uk' as const,
    dictionary: StressDictionary.empty(),
    lexicon,
    stress: { inferFromStem: false },
  };

  it('exports one versioned file and applies date, homograph, and unknown-word choices', () => {
    const review = createSpeechReview(input, options);
    expect(review.format).toBe('ua-tts-text-speech-review');
    expect(review.version).toBe(1);
    expect(review.normalization.occurrences[0]?.candidates?.map(({ id }) => id)).toEqual(['day-first', 'month-first']);
    expect(review.occurrences.map(({ kind }) => kind)).toEqual(['unknown', 'homograph', 'unknown']);

    const edited = {
      ...review,
      normalization: {
        ...review.normalization,
        occurrences: review.normalization.occurrences.map((item) => ({ ...item, candidateId: 'day-first' })),
      },
      occurrences: review.occurrences.map((item) => item.kind === 'homograph'
        ? { ...item, choice: 1 as const }
        : { ...item, stressPosition: item.vowels.at(-1)!.position }),
    };
    const applied = applySpeechReview(input, edited, options);

    expect(applied.appliedReadings).toBe(3);
    expect(applied.unresolvedReadings).toBeGreaterThan(0);
    expect(applied.normalization.applied).toBe(1);
    expect(applied.speech.text).toContain('першого лютого');
    expect(applied.speech.text).toContain('зам+ок');
    expect(applied.speech.prepared.semanticFindings).toEqual([]);
  });

  it('rejects stale source and edited occurrence anchors', () => {
    const review = createSpeechReview(input, options);
    expect(() => applySpeechReview(`${input} `, review, options)).toThrow(/stale/u);
    const changed = {
      ...review,
      occurrences: review.occurrences.map((item, index) => index === 0 ? { ...item, sourceStart: item.sourceStart + 1 } : item),
    };
    expect(() => applySpeechReview(input, changed, options)).toThrow(/no longer matches/u);
  });
});
