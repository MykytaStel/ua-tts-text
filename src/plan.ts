/**
 * План мовлення: як розбити текст на фрази й скільки тримати паузу.
 *
 * Це не модель інтонації — та потребує тренованої акустики. Це детермінований
 * план: межі речень і підрядних частин, паузи під них і оцінка тривалості.
 * Рушії, що розуміють SSML, отримують точні паузи; решта — пунктуацію.
 */

export type SegmentKind = 'statement' | 'question' | 'exclamation';

export interface SpeechSegment {
  text: string;
  /** UTF-16 range inside the exact text passed to planSpeech(). */
  start: number;
  end: number;
  kind: SegmentKind;
  /** Пауза після сегмента в мілісекундах (0 — кінець тексту). */
  pauseAfterMs: number;
  /** Скільки слів у сегменті — для оцінки тривалості. */
  words: number;
  /** Чи варто підсилити фразу: заперечення, контраст, оклик. */
  emphasis: boolean;
}

export interface SpeechPlan {
  segments: SpeechSegment[];
  /** Орієнтовна тривалість озвучки, мс. */
  estimatedMs: number;
}

export interface PlanOptions {
  /** Пауза між реченнями. */
  sentencePauseMs?: number;
  /** Пауза на комі, тире, двокрапці. */
  clausePauseMs?: number;
  /**
   * Темп мовлення, слів за хвилину. Типове 125 — виміряно на реальному
   * аудіо tts-uk (62 слова за 30,3 с), а не взято з голови.
   */
  wordsPerMinute?: number;
}

/**
 * Маркери, після яких фразу варто підсилити: заперечення й контраст
 * тримають на собі увагу, а оклик підсилює сам себе.
 */
const EMPHASIS_RE = /(?:^|[\s,(])(?:не|ні|але|проте|однак|саме|лише|тільки|навіть)(?:[\s,.)]|$)/iu;

import { tokenizeWords } from './tokenize.js';
import { scanSemanticSpans } from './semantic.js';
import { normalize } from './normalize.js';

interface TextRange {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

function trimRange(text: string, start: number, end: number): TextRange | undefined {
  while (start < end && /\s/u.test(text[start]!)) start += 1;
  while (end > start && /\s/u.test(text[end - 1]!)) end -= 1;
  return start < end ? { text: text.slice(start, end), start, end } : undefined;
}

function splitOutsideSemanticSpans(text: string, separators: RegExp, baseOffset = 0): TextRange[] {
  const spans = scanSemanticSpans(text);
  const parts: TextRange[] = [];
  let start = 0;
  let spanIndex = 0;
  for (const match of text.matchAll(separators)) {
    const from = match.index;
    const to = from + match[0].length;
    while (spans[spanIndex] && spans[spanIndex]!.end <= from) spanIndex += 1;
    const span = spans[spanIndex];
    if (span && from < span.end && to > span.start) continue;
    const part = trimRange(text, start, to);
    if (part) parts.push({ ...part, start: part.start + baseOffset, end: part.end + baseOffset });
    start = to;
  }
  const tail = trimRange(text, start, text.length);
  if (tail) parts.push({ ...tail, start: tail.start + baseOffset, end: tail.end + baseOffset });
  return parts;
}

function kindOf(text: string): SegmentKind {
  const last = text.trim().at(-1);
  if (last === '?') return 'question';
  if (last === '!') return 'exclamation';
  return 'statement';
}

function wordCount(text: string): number {
  return tokenizeWords(normalize(text)).length;
}

/**
 * Розбиває текст на фрази, додає паузи й оцінює тривалість.
 * Довгі підрядні частини не переписуються — це рішення автора тексту.
 */
export function planSpeech(text: string, options: PlanOptions = {}): SpeechPlan {
  const sentencePauseMs = options.sentencePauseMs ?? 480;
  const clausePauseMs = options.clausePauseMs ?? 220;
  const wordsPerMinute = options.wordsPerMinute ?? 125;
  if (!Number.isFinite(wordsPerMinute) || wordsPerMinute <= 0)
    throw new RangeError('planSpeech: wordsPerMinute must be a finite positive number');
  if (!Number.isFinite(sentencePauseMs) || sentencePauseMs < 0)
    throw new RangeError('planSpeech: sentencePauseMs must be a finite non-negative number');
  if (!Number.isFinite(clausePauseMs) || clausePauseMs < 0)
    throw new RangeError('planSpeech: clausePauseMs must be a finite non-negative number');

  const segments: SpeechSegment[] = [];
  const sentences = splitOutsideSemanticSpans(text, /[.!?…]+/gu);

  sentences.forEach((sentence, sentenceIndex) => {
    const clauses = splitOutsideSemanticSpans(sentence.text, /[,;:—–]+/gu, sentence.start);
    clauses.forEach((clause, clauseIndex) => {
      const isLastClause = clauseIndex === clauses.length - 1;
      const isLastSentence = sentenceIndex === sentences.length - 1;
      segments.push({
        text: clause.text,
        start: clause.start,
        end: clause.end,
        kind: kindOf(clause.text),
        pauseAfterMs: isLastClause ? (isLastSentence ? 0 : sentencePauseMs) : clausePauseMs,
        words: wordCount(clause.text),
        emphasis: EMPHASIS_RE.test(clause.text) || kindOf(clause.text) === 'exclamation',
      });
    });
  });

  // wpm виміряно на живому аудіо разом із паузами на пунктуації, тому додавати
  // pauseAfterMs ще раз не можна — буде подвійний облік.
  const speechMs = (segments.reduce((sum, segment) => sum + segment.words, 0) / wordsPerMinute) * 60_000;
  if (!Number.isFinite(speechMs)) throw new RangeError('planSpeech: estimated duration is out of range');
  return { segments, estimatedMs: Math.round(speechMs) };
}

export interface SpeechProtectedRange {
  /** UTF-16 range in the text passed to chunkSpeech(). */
  readonly start: number;
  readonly end: number;
  readonly reason?: string;
}

export interface ChunkSpeechOptions {
  /** Hard adapter budget in UTF-16 code units, excluding provider-specific wrappers. */
  readonly maxChars: number;
  readonly plan?: PlanOptions;
  /** Ranges that must remain in one request, such as a number expanded from one source token. */
  readonly protectedRanges?: ReadonlyArray<SpeechProtectedRange>;
}

export interface SpeechChunk extends SpeechPlan {
  readonly index: number;
  readonly text: string;
  /** UTF-16 range in the full input. */
  readonly start: number;
  readonly end: number;
  readonly oversized: boolean;
  readonly warning?: string;
}

interface ChunkBoundary {
  readonly end: number;
  readonly priority: number;
}

function firstGreaterThan<T>(items: ReadonlyArray<T>, value: number, read: (item: T) => number): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (read(items[middle]!) <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function crossesProtectedBoundary(position: number, ranges: ReadonlyArray<SpeechProtectedRange>): boolean {
  const index = firstGreaterThan(ranges, position, ({ end }) => end);
  const range = ranges[index];
  return range !== undefined && range.start < position && position < range.end;
}

function chunkBoundaries(text: string, protectedRanges: ReadonlyArray<SpeechProtectedRange>): ChunkBoundary[] {
  const semantic = scanSemanticSpans(text);
  const boundaries: ChunkBoundary[] = [];
  let semanticIndex = 0;
  for (const match of text.matchAll(/\n{2,}|[.!?…]+|[,;:—–]+|\s+/gu)) {
    const start = match.index!;
    const end = start + match[0].length;
    while (semanticIndex < semantic.length && semantic[semanticIndex]!.end <= start) semanticIndex += 1;
    const span = semantic[semanticIndex];
    if ((span && span.start < end && span.end > start) || crossesProtectedBoundary(end, protectedRanges)) continue;
    const priority = /^\n{2,}$/u.test(match[0]) ? 4
      : /^[.!?…]+$/u.test(match[0]) ? 3
        : /^[,;:—–]+$/u.test(match[0]) ? 2 : 1;
    boundaries.push({ end, priority });
  }
  return boundaries;
}

function graphemeBoundaries(text: string): number[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return [...segmenter.segment(text)]
    .map(({ index, segment }) => index + segment.length)
    .filter((end) => end > 0 && !splitsStressMark(text, end));
}

function splitsStressMark(text: string, boundary: number): boolean {
  const before = text[boundary - 1];
  const after = text[boundary];
  // `+` is a separate code point in both engine formats. Keep it attached to
  // the vowel it marks even when a long unbroken word needs a fallback split.
  return before === '+' && after !== undefined && /[АЕЄИІЇОУЮЯаеєиіїоуюя]/u.test(after);
}

/** Split a long engine-ready text into deterministic provider-sized requests. */
export function chunkSpeech(text: string, options: ChunkSpeechOptions): ReadonlyArray<SpeechChunk> {
  const { maxChars } = options;
  if (!Number.isSafeInteger(maxChars) || maxChars < 1)
    throw new RangeError('chunkSpeech: maxChars must be a positive safe integer');
  const protectedRanges = [...(options.protectedRanges ?? [])].sort((a, b) => a.start - b.start || a.end - b.end);
  for (const range of protectedRanges) {
    if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end <= range.start || range.end > text.length)
      throw new RangeError('chunkSpeech: protected ranges must be non-empty UTF-16 ranges inside the input');
  }
  for (let index = 1; index < protectedRanges.length; index += 1)
    if (protectedRanges[index]!.start < protectedRanges[index - 1]!.end)
      throw new RangeError('chunkSpeech: protected ranges may not overlap');

  const boundaries = chunkBoundaries(text, protectedRanges);
  const graphemes = graphemeBoundaries(text);
  const rawRanges: Array<{ start: number; end: number; warning?: string }> = [];
  let start = 0;
  while (start < text.length) {
    while (start < text.length && /\s/u.test(text[start]!)) start += 1;
    if (start >= text.length) break;
    const budgetEnd = Math.min(text.length, start + maxChars);
    if (budgetEnd === text.length) {
      rawRanges.push({ start, end: text.length });
      break;
    }

    const boundaryStart = firstGreaterThan(boundaries, start, ({ end }) => end);
    let selected: ChunkBoundary | undefined;
    for (let index = boundaryStart; index < boundaries.length && boundaries[index]!.end <= budgetEnd; index += 1) {
      const boundary = boundaries[index]!;
      if (!selected || boundary.priority > selected.priority || (boundary.priority === selected.priority && boundary.end > selected.end))
        selected = boundary;
    }
    if (selected) {
      rawRanges.push({ start, end: selected.end });
      start = selected.end;
      continue;
    }

    const protectedIndex = firstGreaterThan(protectedRanges, budgetEnd, ({ end }) => end);
    const range = protectedRanges[protectedIndex];
    const enclosing = range && range.start <= budgetEnd && range.end > start ? range : undefined;
    if (enclosing) {
      if (enclosing.start > start) {
        rawRanges.push({ start, end: enclosing.start });
        start = enclosing.start;
        continue;
      }
      rawRanges.push({ start, end: enclosing.end, warning: enclosing.reason ?? 'Protected semantic span exceeds the adapter character budget.' });
      start = enclosing.end;
      continue;
    }

    let graphemeIndex = firstGreaterThan(graphemes, start, (end) => end);
    let fallbackEnd: number | undefined;
    while (graphemeIndex < graphemes.length && graphemes[graphemeIndex]! <= budgetEnd) {
      const end = graphemes[graphemeIndex]!;
      if (!crossesProtectedBoundary(end, protectedRanges)) fallbackEnd = end;
      graphemeIndex += 1;
    }
    if (fallbackEnd !== undefined) {
      rawRanges.push({ start, end: fallbackEnd });
      start = fallbackEnd;
      continue;
    }

    const nextGrapheme = graphemes[graphemeIndex];
    if (nextGrapheme === undefined) {
      rawRanges.push({ start, end: text.length });
      break;
    }
    rawRanges.push({ start, end: nextGrapheme, warning: 'One grapheme exceeds the adapter character budget.' });
    start = nextGrapheme;
  }

  return Object.freeze(rawRanges.map((range, index) => {
    const chunkText = text.slice(range.start, range.end).trim();
    const leadingTrim = text.slice(range.start, range.end).length - text.slice(range.start, range.end).trimStart().length;
    const chunkStart = range.start + leadingTrim;
    const chunkEnd = chunkStart + chunkText.length;
    const plan = planSpeech(chunkText, options.plan);
    const oversized = chunkText.length > maxChars;
    return Object.freeze({
      index,
      text: chunkText,
      start: chunkStart,
      end: chunkEnd,
      ...plan,
      oversized,
      ...(range.warning ? { warning: range.warning } : {}),
    });
  }));
}

const escapeSsml = (value: string) => value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

/**
 * Рендер плану: `ssml` — з точними паузами, `plain` — той самий текст із
 * пунктуацією (для рушіїв без SSML).
 */
export function renderPlan(plan: SpeechPlan, profile: 'plain' | 'ssml'): string {
  if (profile === 'plain')
    return plan.segments
      .map((segment) => segment.text)
      .join(' ')
      .trim();
  const body = plan.segments
    .map((segment, index) => {
      const raw = escapeSsml(segment.text);
      const text = segment.emphasis ? `<emphasis level="moderate">${raw}</emphasis>` : raw;
      const isLast = index === plan.segments.length - 1;
      return isLast || segment.pauseAfterMs === 0 ? text : `${text}<break time="${segment.pauseAfterMs}ms"/>`;
    })
    .join(' ');
  return `<speak>${body}</speak>`;
}
