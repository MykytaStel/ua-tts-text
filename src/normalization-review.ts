import {
  createNormalizationCorrectionSet,
  normalizeWithAlignment,
  type NormalizationCorrectionSet,
  type NormalizationAlignmentSegment,
  type NormalizationCorrectionDraft,
  type NormalizeOptions,
} from './normalize.js';
import type { NormalizationRules } from './normalization-rules.js';
import { scanSemanticSpans, type SemanticSpan } from './semantic.js';

export interface NormalizationReviewOccurrence {
  readonly id: string;
  readonly kind: 'ambiguous';
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly sourceText: string;
  readonly spokenStart: number;
  readonly spokenEnd: number;
  readonly normalizedText: string;
  readonly reason: string;
  readonly context: string;
  readonly value?: SemanticSpan['value'];
  readonly replacement: string | null;
}

/** Serializable, source-anchored review file for semantic spans without a safe reading. */
export interface NormalizationReview {
  readonly format: 'ua-tts-text-normalization-review';
  readonly version: 1;
  /** Fingerprint of the exact input, baseline output, and normalization options. */
  readonly fingerprint: string;
  readonly occurrences: ReadonlyArray<NormalizationReviewOccurrence>;
}

export interface ApplyNormalizationReviewResult {
  /** Present when the review file contains at least one manual reading. */
  readonly corrections?: NormalizationCorrectionSet;
  readonly applied: number;
  readonly unresolved: number;
  readonly fingerprint: string;
}

const REVIEW_FORMAT = 'ua-tts-text-normalization-review';
const REVIEW_VERSION = 1;
const MAX_REVIEW_OCCURRENCES = 1000;

function sentenceAt(text: string, index: number): string {
  const boundary = /[.!?\n]/gu;
  let start = 0;
  let end = text.length;
  for (const match of text.matchAll(boundary)) {
    const position = match.index!;
    const next = text[match.index! + match[0].length] ?? '';
    const previous = text[position - 1] ?? '';
    if (match[0] === '.' && /\d/u.test(previous) && /\d/u.test(next)) continue;
    if (position < index) start = position + match[0].length;
    else {
      end = position + match[0].length;
      break;
    }
  }
  return text.slice(start, end).trim();
}

function alignedSegment(
  span: SemanticSpan,
  segmentsBySourceRange: ReadonlyMap<string, ReadonlyArray<NormalizationAlignmentSegment>>,
): NormalizationAlignmentSegment {
  const matches = segmentsBySourceRange.get(`${span.start}:${span.end}`) ?? [];
  if (matches.length !== 1)
    throw new Error(`normalization review: cannot align source span ${span.start}:${span.end}`);
  return matches[0]!;
}

function currentOccurrences(
  input: string,
  preview: ReturnType<typeof normalizeWithAlignment>,
  rules: NormalizationRules | null | undefined,
): Omit<NormalizationReviewOccurrence, 'replacement'>[] {
  const segmentsBySourceRange = new Map<string, NormalizationAlignmentSegment[]>();
  for (const segment of preview.alignment) {
    const key = `${segment.sourceStart}:${segment.sourceEnd}`;
    const matches = segmentsBySourceRange.get(key) ?? [];
    matches.push(segment);
    segmentsBySourceRange.set(key, matches);
  }

  return scanSemanticSpans(input)
    .filter((span) => span.kind === 'ambiguous' && rules?.explain(span.raw)?.status !== 'verified')
    .map((span) => {
      const segment = alignedSegment(span, segmentsBySourceRange);
      return Object.freeze({
        id: `${span.start}:${span.end}`,
        kind: 'ambiguous' as const,
        sourceStart: segment.sourceStart,
        sourceEnd: segment.sourceEnd,
        sourceText: segment.sourceText,
        spokenStart: segment.spokenStart,
        spokenEnd: segment.spokenEnd,
        normalizedText: segment.spokenText,
        reason: span.reason ?? 'Фрагмент потребує ручного прочитання.',
        context: sentenceAt(input, span.start),
        ...(span.value ? { value: span.value } : {}),
      });
    });
}

/**
 * Create a serializable review file for ambiguous semantic spans in one exact input.
 * The same normalization options must be supplied when applying the file.
 */
export function createNormalizationReview(input: string, options: NormalizeOptions = {}): NormalizationReview {
  const preview = normalizeWithAlignment(input, options);
  const occurrences = currentOccurrences(input, preview, options.rules);
  if (occurrences.length > MAX_REVIEW_OCCURRENCES)
    throw new RangeError(`normalization review: at most ${MAX_REVIEW_OCCURRENCES} occurrences are supported`);

  return Object.freeze({
    format: REVIEW_FORMAT,
    version: REVIEW_VERSION,
    fingerprint: preview.fingerprint,
    occurrences: Object.freeze(occurrences.map((occurrence) => Object.freeze({
      ...occurrence,
      replacement: null,
    }))),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/** Validate an edited review file and turn its selected readings into a correction set. */
export function applyNormalizationReview(
  input: string,
  review: unknown,
  options: NormalizeOptions = {},
): ApplyNormalizationReviewResult {
  if (!isRecord(review) || review.format !== REVIEW_FORMAT || review.version !== REVIEW_VERSION ||
      !Array.isArray(review.occurrences))
    throw new Error(`normalization review: unsupported format (expected ${REVIEW_FORMAT} v${REVIEW_VERSION})`);
  if (review.occurrences.length > MAX_REVIEW_OCCURRENCES)
    throw new RangeError(`normalization review: at most ${MAX_REVIEW_OCCURRENCES} occurrences are supported`);

  const preview = normalizeWithAlignment(input, options);
  if (review.fingerprint !== preview.fingerprint)
    throw new Error('normalization review: file is stale for this text or normalization options; export a new review file');

  const occurrences = currentOccurrences(input, preview, options.rules);
  const currentById = new Map(occurrences.map((occurrence) => [occurrence.id, occurrence]));
  const seen = new Set<string>();
  const drafts: NormalizationCorrectionDraft[] = [];
  for (const item of review.occurrences) {
    if (!isRecord(item) || typeof item.id !== 'string')
      throw new Error('normalization review: each occurrence must be an object with an id');
    if (seen.has(item.id)) throw new Error(`normalization review: duplicate occurrence ${item.id}`);
    seen.add(item.id);
    const expected = currentById.get(item.id);
    if (!expected || item.kind !== expected.kind ||
        item.sourceStart !== expected.sourceStart || item.sourceEnd !== expected.sourceEnd ||
        item.sourceText !== expected.sourceText ||
        item.spokenStart !== expected.spokenStart || item.spokenEnd !== expected.spokenEnd ||
        item.normalizedText !== expected.normalizedText || item.reason !== expected.reason ||
        item.context !== expected.context || !sameValue(item.value, expected.value))
      throw new Error(`normalization review: occurrence ${item.id} no longer matches the input; export a new review file`);
    if (item.replacement === null) continue;
    if (typeof item.replacement !== 'string' || item.replacement.length === 0 || item.replacement !== item.replacement.trim())
      throw new Error(`normalization review: replacement for ${item.id} must be null or a trimmed phrase`);
    drafts.push({
      sourceStart: expected.sourceStart,
      sourceEnd: expected.sourceEnd,
      spokenStart: expected.spokenStart,
      spokenEnd: expected.spokenEnd,
      replacement: item.replacement,
      source: 'normalization review',
    });
  }
  if (seen.size !== currentById.size)
    throw new Error('normalization review: file is missing occurrences; export a new review file');

  return Object.freeze({
    ...(drafts.length > 0 ? { corrections: createNormalizationCorrectionSet(preview, drafts) } : {}),
    applied: drafts.length,
    unresolved: occurrences.length - drafts.length,
    fingerprint: preview.fingerprint,
  });
}
