/**
 * Публічний API: підготувати український текст до озвучки одним викликом.
 */

import { createHash } from 'node:crypto';
import type { ContextSource } from './context.js';
import { StressDictionary } from './dict.js';
import type { StressSource } from './lexicon.js';
import { chunkSpeech, planSpeech, renderPlan, type ChunkSpeechOptions, type PlanOptions, type SpeechChunk, type SpeechPlan, type SpeechProtectedRange } from './plan.js';
import {
  normalize,
  normalizeWithAlignment,
  type NormalizationAlignmentSegment,
  type NormalizationCorrectionSet,
  type NormalizeAlignmentResult,
  type NormalizeOptions,
} from './normalize.js';
import { ENGINES, render, type EngineId, type RenderResult } from './render.js';
import { homographs, lint, type Homograph, type Issue } from './review.js';
import { resolveOccurrences, resolveUnknown, type Asker, type ResolveOptions } from './resolve.js';
import type { Decisions } from './agent.js';
import { convertStressMarks, type StressEvidence, type StressOptions } from './stress.js';
import type { Resources } from './resources.js';
import { scanSemanticSpans, type SemanticKind } from './semantic.js';
import {
  applyNormalizationReview,
  createNormalizationReview,
  type ApplyNormalizationReviewResult,
  type NormalizationReview,
} from './normalization-review.js';

export * from './context.js';
export * from './dict.js';
export * from './lexicon.js';
export * from './numbers.js';
export * from './normalize.js';
export * from './normalization-review.js';
export * from './normalization-rules.js';
export * from './render.js';
export * from './review.js';
export * from './agent.js';
export * from './resolve.js';
export * from './plan.js';
export * from './stress.js';
export * from './resources.js';
export * from './tokenize.js';
export * from './semantic.js';
export * from './pronunciation-dictionary.js';

export interface PrepareOptions {
  /** Рушій, під який готуємо. Без нього текст лише нормалізується. */
  engine?: EngineId;
  /** Словник наголосів. Без нього наголоси не розставляються. */
  dictionary?: StressDictionary;
  /** Лексикон власних назв — пріоритетніший за словник. */
  lexicon?: StressSource;
  /** Контекстні правила для омонімів; явний лексикон і рішення мають пріоритет. */
  /** Pass null to explicitly disable the resource context rules. */
  context?: ContextSource | null;
  /** Immutable dictionary, lexicon, context and content fingerprint from `loadResources()`. */
  resources?: Resources;
  normalize?: NormalizeOptions;
  /** Saved per-occurrence readings from createNormalizationCorrectionSet(). */
  normalizationCorrections?: NormalizationCorrectionSet;
  stress?: StressOptions;
}

export interface PrepareResult {
  text: string;
  engine: EngineId | null;
  warnings: string[];
  ambiguous: string[];
  ambiguousOccurrences: Array<{ word: string; offset: number }>;
  unknown: string[];
  /** Кожне невідоме слово окремо; UTF-16 offsets point to normalized text before stress markup. */
  unknownOccurrences: Array<{ word: string; offset: number }>;
  /** Омоніми з двома прочитаннями — те, що має вирішити людина або LLM. */
  homographs: Homograph[];
  marked: number;
  /** Скільки слів наголошено морфологічним фолбеком, а не словником. */
  inferred: number;
  /** Скільки омонімів розв'язано контекстним правилом. */
  contextual: number;
  evidence?: StressEvidence[];
  resourceFingerprint?: string;
  /** Fingerprint for the plain normalized text used to validate saved corrections. */
  normalizationFingerprint?: string;
  /** Number of occurrence-specific normalization corrections applied before stress/render. */
  normalizationCorrectionsApplied?: number;
  /** Numeric/date/time spans that were preserved because the input is invalid or ambiguous. */
  semanticFindings?: Array<{ readonly kind: SemanticKind; readonly raw: string; readonly offset: number; readonly message: string }>;
}

export type PreparedFinding =
  | { readonly kind: 'lint'; readonly issue: Issue }
  | { readonly kind: 'ambiguous'; readonly word: string; readonly offset: number }
  | { readonly kind: 'unknown-word'; readonly word: string }
  | { readonly kind: 'resource'; readonly warning: string }
  | { readonly kind: 'semantic'; readonly spanKind: SemanticKind; readonly raw: string; readonly offset: number; readonly message: string };

export interface PreparedCheckResult {
  readonly passed: boolean;
  readonly findings: ReadonlyArray<PreparedFinding>;
}

export interface PrepareSpeechOptions extends PrepareOptions {
  /** Optional pacing overrides for the handoff plan. */
  plan?: PlanOptions;
  /** Optional hard text budget supplied by the consuming TTS adapter. */
  chunking?: Pick<ChunkSpeechOptions, 'maxChars'>;
}

/** One consistent handoff from Ukrainian text preparation to a TTS adapter. */
export interface PrepareSpeechResult {
  /** The engine-specific normalized and stress-marked text. */
  readonly text: string;
  /** Full preparation result, including unresolved words and warnings. */
  readonly prepared: PrepareResult;
  /** Phrase boundaries and pauses, planned after normalization and stress markup. */
  readonly plan: SpeechPlan;
  /** Generic SSML for the plain profile or when no engine was selected. */
  readonly ssml?: string;
  /** Why the handoff omitted SSML, when the selected engine cannot accept it. */
  readonly ssmlUnavailableReason?: string;
  /** Maps normalized spoken text back to UTF-16 ranges in the original input. */
  readonly normalizationAlignment: ReadonlyArray<NormalizationAlignmentSegment>;
  /** Maps each normalized segment to its actual engine-ready text after stress markup. */
  readonly speechTextAlignment: ReadonlyArray<SpeechTextAlignmentSegment>;
  /** Source and engine-text ranges for readiness findings that identify a precise occurrence. */
  readonly readinessAlignment: ReadonlyArray<SpeechFindingAlignment>;
  /** Readiness findings that should be reviewed before synthesis. */
  readonly readiness: PreparedCheckResult;
  /** Optional provider-sized requests. Present only when `chunking.maxChars` is supplied. */
  readonly chunks?: ReadonlyArray<SpeechChunk>;
}

export interface SpeechTextAlignmentSegment {
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly normalizedStart: number;
  readonly normalizedEnd: number;
  readonly engineStart: number;
  readonly engineEnd: number;
  readonly sourceText: string;
  readonly normalizedText: string;
  readonly engineText: string;
  readonly changed: boolean;
}

export interface SpeechFindingAlignment {
  readonly findingIndex: number;
  readonly kind: PreparedFinding['kind'];
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly engineStart: number;
  readonly engineEnd: number;
  readonly sourceText: string;
  readonly engineText: string;
}

/** Shared readiness gate for CLI, Studio, and other synthesis integrations. */
type PreparedCheckInput = Pick<PrepareResult, 'text' | 'ambiguousOccurrences' | 'unknown' | 'warnings' | 'semanticFindings'> &
  Partial<Pick<PrepareResult, 'engine'>>;

export function checkPrepared(result: PreparedCheckInput): PreparedCheckResult {
  return checkReadiness(result, true);
}

function checkReadiness(result: PreparedCheckInput, checkStress: boolean): PreparedCheckResult {
  const findings: PreparedFinding[] = [
    ...lint(result.text).map((issue) => Object.freeze({ kind: 'lint' as const, issue: Object.freeze(issue) })),
    ...(checkStress ? result.ambiguousOccurrences : []).map(({ word, offset }) =>
      Object.freeze({ kind: 'ambiguous' as const, word, offset }),
    ),
    ...(checkStress ? result.unknown.map((word) => Object.freeze({ kind: 'unknown-word' as const, word })) : []),
    ...(result.semanticFindings ?? []).map(({ kind: spanKind, raw, offset, message }) =>
      Object.freeze({ kind: 'semantic' as const, spanKind, raw, offset, message }),
    ),
    ...(checkStress ? result.warnings : [])
      .filter((warning) => /dictionary missing|malformed entries ignored/iu.test(warning))
      .map((warning) => Object.freeze({ kind: 'resource' as const, warning })),
  ];
  return Object.freeze({ passed: findings.length === 0, findings: Object.freeze(findings) });
}

/**
 * Prepare text and its delivery plan together so every voice receives the same
 * normalization and stress decisions. The plan is a deterministic handoff,
 * not a claim that the package models a voice's natural intonation.
 */
export function prepareSpeech(input: string, options: PrepareSpeechOptions = {}): PrepareSpeechResult {
  const normalization = alignNormalization(input, options);
  return speechHandoff(input, prepareNormalized(input, options, normalization), normalization, options.plan, options.chunking);
}

function speechHandoff(
  input: string,
  prepared: PrepareResult,
  normalization: NormalizeAlignmentResult,
  planOptions: PlanOptions | undefined,
  chunking: PrepareSpeechOptions['chunking'] | undefined,
): PrepareSpeechResult {
  const plan = planSpeech(prepared.text, planOptions);
  const engine = prepared.engine ? ENGINES[prepared.engine] : undefined;
  const ssmlOutput = !prepared.engine || prepared.engine === 'plain'
    ? { ssml: renderPlan(plan, 'ssml') }
    : { ssmlUnavailableReason: engine?.ssmlBreaks === false
        ? `${prepared.engine}: SSML break tags are unsupported; use text and the speech plan`
        : `${prepared.engine}: use the speech plan with your provider adapter to render supported markup` };
  const offsets = engineOffsets(
    normalization.text,
    prepared.text,
    prepared.engine !== null && ENGINES[prepared.engine].symbol === 'plus-after',
  );
  const speechTextAlignment = normalization.alignment.map((segment) => {
    const engineStart = offsets[segment.spokenStart]!;
    const engineEnd = offsets[segment.spokenEnd]!;
    return Object.freeze({
      sourceStart: segment.sourceStart,
      sourceEnd: segment.sourceEnd,
      normalizedStart: segment.spokenStart,
      normalizedEnd: segment.spokenEnd,
      engineStart,
      engineEnd,
      sourceText: segment.sourceText,
      normalizedText: segment.spokenText,
      engineText: prepared.text.slice(engineStart, engineEnd),
      changed: segment.changed || engineStart !== segment.spokenStart || engineEnd - engineStart !== segment.spokenEnd - segment.spokenStart,
    });
  });
  const readiness = checkReadiness(prepared, engine?.supportsStress ?? true);
  const chunks = chunking
    ? chunkSpeech(prepared.text, { ...chunking, protectedRanges: semanticProtectedRanges(input, normalization, offsets) })
    : undefined;
  return Object.freeze({
    text: prepared.text,
    prepared,
    plan,
    ...ssmlOutput,
    normalizationAlignment: normalization.alignment,
    speechTextAlignment: Object.freeze(speechTextAlignment),
    readiness,
    readinessAlignment: Object.freeze(alignReadiness(input, normalization, prepared, offsets, readiness)),
    ...(chunks ? { chunks } : {}),
  });
}

function semanticProtectedRanges(
  input: string,
  normalization: NormalizeAlignmentResult,
  offsets: ReadonlyArray<number>,
): ReadonlyArray<SpeechProtectedRange> {
  return scanSemanticSpans(input).flatMap((span) => {
    const mapped = normalization.alignment.filter((segment) => segment.sourceStart < span.end && segment.sourceEnd > span.start);
    if (mapped.length === 0) return [];
    const normalizedStart = Math.min(...mapped.map((segment) => segment.spokenStart));
    const normalizedEnd = Math.max(...mapped.map((segment) => segment.spokenEnd));
    const start = offsets[normalizedStart];
    const end = offsets[normalizedEnd];
    return start === undefined || end === undefined || end <= start
      ? []
      : [{ start, end, reason: `Нерозривний семантичний фрагмент типу «${span.kind}» перевищує бюджет адаптера.` }];
  });
}

const STRESS_MARKS = new Set(['+', '\u0301']);

/** Translate UTF-16 boundaries through stress marks inserted by the engine renderer. */
function engineOffsets(normalized: string, engineText: string, plusAfter = false): number[] {
  const offsets = new Array<number>(normalized.length + 1);
  let sourceIndex = 0;
  let engineIndex = 0;
  offsets[0] = 0;
  while (sourceIndex < normalized.length) {
    const codePoint = String.fromCodePoint(normalized.codePointAt(sourceIndex)!);
    while (
      engineIndex < engineText.length &&
      (engineText[engineIndex] === '\u0301' || (plusAfter && engineText[engineIndex] === '+')) &&
      engineText[engineIndex] !== codePoint
    )
      engineIndex += 1;
    offsets[sourceIndex] = engineIndex;
    if (STRESS_MARKS.has(codePoint) && engineText.slice(engineIndex, engineIndex + codePoint.length) !== codePoint) {
      sourceIndex += codePoint.length;
      offsets[sourceIndex] = engineIndex;
      continue;
    }
    while (!plusAfter && engineIndex < engineText.length && engineText[engineIndex] === '+' && engineText[engineIndex] !== codePoint)
      engineIndex += 1;
    if (engineText.slice(engineIndex, engineIndex + codePoint.length) !== codePoint)
      throw new Error('prepareSpeech: engine text cannot be aligned to normalized text');
    for (let unit = 1; unit < codePoint.length; unit += 1) offsets[sourceIndex + unit] = engineIndex + unit;
    sourceIndex += codePoint.length;
    engineIndex += codePoint.length;
    offsets[sourceIndex] = engineIndex;
  }
  while (engineIndex < engineText.length && STRESS_MARKS.has(engineText[engineIndex]!)) engineIndex += 1;
  if (engineIndex !== engineText.length)
    throw new Error('prepareSpeech: engine text contains unaligned characters');
  offsets[normalized.length] = engineText.length;
  return offsets;
}

function sourceRangeForNormalizedRange(
  start: number,
  end: number,
  alignment: ReadonlyArray<NormalizationAlignmentSegment>,
): { start: number; end: number } | undefined {
  const matches = alignment.filter((segment) => segment.spokenStart < end && segment.spokenEnd > start);
  if (matches.length === 0) return undefined;
  return {
    start: Math.min(...matches.map((segment) => segment.sourceStart)),
    end: Math.max(...matches.map((segment) => segment.sourceEnd)),
  };
}

function alignReadiness(
  input: string,
  normalization: NormalizeAlignmentResult,
  prepared: PrepareResult,
  offsets: ReadonlyArray<number>,
  readiness: PreparedCheckResult,
): SpeechFindingAlignment[] {
  const engineText = prepared.text;
  const spans = scanSemanticSpans(input);
  const aligned: SpeechFindingAlignment[] = [];
  readiness.findings.forEach((finding, findingIndex) => {
    const ranges: Array<{ source: { start: number; end: number }; normalizedStart: number; normalizedEnd: number }> = [];
    if (finding.kind === 'semantic') {
      const source = { start: finding.offset, end: finding.offset + finding.raw.length };
      const span = spans.find((item) => item.start === source.start && item.end === source.end);
      if (span) {
        const segment = normalization.alignment.find((item) => item.sourceStart <= span.start && item.sourceEnd >= span.end);
        if (segment) ranges.push({ source, normalizedStart: segment.spokenStart, normalizedEnd: segment.spokenEnd });
      }
    } else if (finding.kind === 'ambiguous') {
      const normalizedStart = finding.offset;
      const normalizedEnd = normalizedStart + finding.word.length;
      const source = sourceRangeForNormalizedRange(normalizedStart, normalizedEnd, normalization.alignment);
      if (source) ranges.push({ source, normalizedStart, normalizedEnd });
    } else if (finding.kind === 'unknown-word') {
      for (const occurrence of prepared.unknownOccurrences.filter(({ word }) => word === finding.word)) {
        const normalizedStart = occurrence.offset;
        const normalizedEnd = normalizedStart + occurrence.word.length;
        const source = sourceRangeForNormalizedRange(normalizedStart, normalizedEnd, normalization.alignment);
        if (source) ranges.push({ source, normalizedStart, normalizedEnd });
      }
    }
    for (const range of ranges) {
      const engineStart = offsets[range.normalizedStart];
      const engineEnd = offsets[range.normalizedEnd];
      if (engineStart === undefined || engineEnd === undefined) continue;
      aligned.push(Object.freeze({
        findingIndex,
        kind: finding.kind,
        sourceStart: range.source.start,
        sourceEnd: range.source.end,
        engineStart,
        engineEnd,
        sourceText: input.slice(range.source.start, range.source.end),
        engineText: engineText.slice(engineStart, engineEnd),
      }));
    }
  });
  return aligned;
}

export interface PrepareManyOptions extends PrepareOptions {
  /** Якщо задано — омоніми розв'язуються одним запитом до LLM. */
  ask?: Asker;
  /** Unknown-word guesses require a separate explicit opt-in. */
  resolveUnknown?: boolean;
  /** Manual choices keyed by paragraph:UTF16Offset. */
  occurrenceDecisions?: Readonly<Record<string, 0 | 1>>;
  /** Manual stress positions keyed by paragraph:UTF16Offset; positions index Unicode code points in the word. */
  occurrenceOverrides?: Readonly<Record<string, number>>;
  /** Bound resolver request size and choose how provider failures are handled. */
  maxPromptChars?: number;
  resolutionFailurePolicy?: ResolveOptions['onError'];
  /** Reject saved occurrence offsets when normalized text or the resource snapshot changed. */
  expectedDecisionFingerprint?: string;
}

export interface PrepareManyResult {
  results: PrepareResult[];
  /** Occurrence IDs paragraph:offset; never a global word map. */
  decisions: Decisions;
  /** Наголоси, які LLM дав для слів поза словником. */
  overrides: Record<string, number>;
  missing: string[];
  warnings: string[];
  /** Довжина запитів до LLM — щоб оцінити витрати. */
  promptLength: number;
  /** SHA-256 of normalized inputs, engine and, when supplied, the resource snapshot. */
  decisionFingerprint: string;
}

export interface PrepareSpeechManyOptions extends PrepareManyOptions {
  /** Optional pacing overrides shared by all paragraphs. */
  plan?: PlanOptions;
  /** Optional hard text budget shared by all paragraphs. */
  chunking?: Pick<ChunkSpeechOptions, 'maxChars'>;
}

export interface PrepareSpeechManyResult extends Omit<PrepareManyResult, 'results'> {
  /** Engine-ready text, source alignment, optional SSML and readiness findings per paragraph. */
  paragraphs: PrepareSpeechResult[];
}

function normalizeOptions(options: Pick<PrepareOptions, 'normalize' | 'resources'>): NormalizeOptions | undefined {
  const rules = options.normalize && Object.hasOwn(options.normalize, 'rules')
    ? options.normalize.rules
    : options.resources?.normalization;
  if (rules === undefined) return options.normalize;
  return { ...options.normalize, rules };
}

function alignNormalization(input: string, options: PrepareOptions): NormalizeAlignmentResult {
  return normalizeWithAlignment(input, {
    ...normalizeOptions(options),
    ...(options.normalizationCorrections ? { corrections: options.normalizationCorrections } : {}),
  });
}

function normalizeInput(input: string, options: PrepareOptions): string | NormalizeAlignmentResult {
  return options.normalizationCorrections ? alignNormalization(input, options) : normalize(input, normalizeOptions(options));
}

function effectiveResourceFingerprint(options: Pick<PrepareOptions, 'normalize' | 'resources' | 'stress'>): string | undefined {
  const base = options.resources?.manifest.fingerprint ?? options.stress?.resourceFingerprint;
  if (!options.normalize || !Object.hasOwn(options.normalize, 'rules')) return base;
  const rules = options.normalize.rules;
  return createHash('sha256')
    .update(JSON.stringify({ base: base ?? null, normalizationRules: rules?.fingerprint ?? (rules === null ? 'disabled' : 'undefined') }))
    .digest('hex');
}

function assertEngine(engine: string): asserts engine is EngineId {
  if (!Object.hasOwn(ENGINES, engine)) throw new Error(`prepare: unknown engine "${engine}"`);
}

/**
 * Пакетна підготовка: омоніми збираються з усіх фрагментів і розв'язуються
 * одним LLM-запитом. Без `ask` поводиться як звичайний `prepare`.
 */
export async function prepareMany(inputs: readonly string[], options: PrepareManyOptions = {}): Promise<PrepareManyResult> {
  return prepareBatch([...inputs], options);
}

async function prepareBatch(
  inputs: readonly string[],
  options: PrepareManyOptions,
  alignments?: readonly NormalizeAlignmentResult[],
): Promise<PrepareManyResult> {
  if (options.normalizationCorrections && inputs.length !== 1)
    throw new Error('prepareMany: normalizationCorrections are scoped to one exact input; prepare each corrected paragraph separately');
  if (inputs.length > 1 && Object.keys(options.stress?.occurrenceDecisions ?? {}).length > 0)
    throw new Error('prepareMany: use paragraph:offset keys in occurrenceDecisions for multiple inputs');
  if (inputs.length > 1 && Object.keys(options.stress?.occurrenceOverrides ?? {}).length > 0)
    throw new Error('prepareMany: use paragraph:offset keys in occurrenceOverrides for multiple inputs');
  const normalized = alignments ?? inputs.map((input) => normalizeInput(input, options));
  const decisionFingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        normalizedInputs: normalized.map((item) => typeof item === 'string' ? item : item.text),
        engine: options.engine ?? null,
        resourceFingerprint: effectiveResourceFingerprint(options) ?? null,
      }),
    )
    .digest('hex');
  if (options.expectedDecisionFingerprint !== undefined && options.expectedDecisionFingerprint !== decisionFingerprint)
    throw new Error('prepareMany: occurrence decisions belong to a different input or resource snapshot');
  const dictionary = options.dictionary ?? options.resources?.dictionary;
  const lexicon = options.lexicon ?? options.stress?.lexicon ?? options.resources?.lexicon;
  const context = options.context !== undefined ? options.context ?? undefined : options.stress?.context ?? options.resources?.context;
  const effectiveOptions: PrepareOptions = {
    ...options,
    ...(dictionary ? { dictionary } : {}),
    ...(lexicon ? { lexicon } : {}),
    ...(context ? { context } : {}),
  };
  const forParagraph = (paragraph: number): PrepareOptions => {
    const occurrenceDecisions: Record<number, 0 | 1> = { ...options.stress?.occurrenceDecisions };
    const occurrenceOverrides: Record<number, number> = { ...options.stress?.occurrenceOverrides };
    for (const [key, choice] of Object.entries(options.occurrenceDecisions ?? {})) {
      const [owner, offset] = key.split(':');
      if (Number(owner) === paragraph && /^\d+$/u.test(offset ?? '')) occurrenceDecisions[Number(offset)] = choice;
    }
    for (const [key, position] of Object.entries(options.occurrenceOverrides ?? {})) {
      const [owner, offset] = key.split(':');
      if (Number(owner) === paragraph && /^\d+$/u.test(offset ?? '')) occurrenceOverrides[Number(offset)] = position;
    }
    return { ...effectiveOptions, stress: { ...options.stress, occurrenceDecisions, occurrenceOverrides } };
  };
  const paragraphOptions = inputs.map((_, paragraph) => forParagraph(paragraph));
  const first = inputs.map((input, paragraph) => prepareNormalized(input, paragraphOptions[paragraph]!, normalized[paragraph]!));
  if (!options.ask)
    return { results: first, decisions: {}, overrides: {}, missing: [], warnings: [], promptLength: 0, decisionFingerprint };
  if (!dictionary && !lexicon) {
    return {
      results: first,
      decisions: {},
      overrides: {},
      missing: [],
      warnings: ['LLM resolution skipped: configure a base dictionary or project lexicon first'],
      promptLength: 0,
      decisionFingerprint,
    };
  }

  const occurrences = first.flatMap((result, paragraph) =>
    result.homographs
      .filter(
        (item) =>
    options.stress?.decisions?.[item.key] === undefined &&
          options.stress?.occurrenceDecisions?.[item.offset!] === undefined &&
          options.occurrenceDecisions?.[`${paragraph}:${item.offset}`] === undefined,
      )
      .map((item) => ({ ...item, id: `${paragraph}:${item.offset}` })),
  );
  const unknownWords = new Set(first.flatMap((result) => result.unknown.map((word) => word.toLowerCase())));

  let decisions: Decisions = {};
  let overrides: Record<string, number> = {};
  let missing: string[] = [];
  let warnings: string[] = [];
  let promptLength = 0;
  const resolverOptions: ResolveOptions = {
    ...(options.maxPromptChars !== undefined ? { maxPromptChars: options.maxPromptChars } : {}),
    ...(options.resolutionFailurePolicy ? { onError: options.resolutionFailurePolicy } : {}),
  };

  if (occurrences.length > 0) {
    const homographsResolved = await resolveOccurrences(occurrences, options.ask, resolverOptions);
    decisions = homographsResolved.decisions;
    missing = homographsResolved.missing;
    warnings = [...warnings, ...homographsResolved.warnings];
    promptLength += homographsResolved.promptLength;
  }
  if (options.resolveUnknown && unknownWords.size > 0) {
    const unknownResolved = await resolveUnknown([...unknownWords], options.ask, resolverOptions);
    overrides = unknownResolved.overrides;
    missing = [...missing, ...unknownResolved.missing];
    warnings = [...warnings, ...unknownResolved.warnings];
    promptLength += unknownResolved.promptLength;
  }
  if (Object.keys(decisions).length === 0 && Object.keys(overrides).length === 0) {
    return { results: first, decisions, overrides, missing, warnings, promptLength, decisionFingerprint };
  }

  const results = inputs.map((input, paragraph) => {
    const paragraphOption = paragraphOptions[paragraph]!;
    const occurrenceDecisions: Record<number, 0 | 1> = { ...paragraphOption.stress?.occurrenceDecisions };
    for (const item of occurrences) {
      const choice = decisions[item.id];
      if (item.id.startsWith(`${paragraph}:`) && choice !== undefined) occurrenceDecisions[item.offset!] = choice;
    }
    return prepareNormalized(input, {
      ...paragraphOption,
      stress: {
        ...paragraphOption.stress,
        occurrenceDecisions,
        overrides: { ...overrides, ...paragraphOption.stress?.overrides },
      },
    }, normalized[paragraph]!, first[paragraph]);
  });
  return { results, decisions, overrides, missing, warnings, promptLength, decisionFingerprint };
}

/** Batch preparation plus one speech plan per paragraph, preserving one shared LLM resolution. */
export async function prepareSpeechMany(
  inputs: readonly string[],
  options: PrepareSpeechManyOptions = {},
): Promise<PrepareSpeechManyResult> {
  const paragraphs = [...inputs];
  if (options.normalizationCorrections && paragraphs.length !== 1)
    throw new Error('prepareMany: normalizationCorrections are scoped to one exact input; prepare each corrected paragraph separately');
  const plan = options.plan && { ...options.plan };
  const alignments = paragraphs.map((input) => alignNormalization(input, options));
  const batch = await prepareBatch(paragraphs, options, alignments);
  const { results, ...metadata } = batch;
  return {
    ...metadata,
    paragraphs: results.map((prepared, index) => speechHandoff(paragraphs[index]!, prepared, alignments[index]!, plan, options.chunking)),
  };
}

/** Правила, що мовчать для слів із явним рішенням — так само, як у `stressify`. */
function withoutDecided(context: ContextSource, decided: Readonly<Record<string, 0 | 1>>): ContextSource {
  return { resolve: (word, view) => (decided[word] === undefined ? context.resolve(word, view) : null) };
}

/** Нормалізація + наголоси під рушій. */
export function prepare(input: string, options: PrepareOptions = {}): PrepareResult {
  return prepareNormalized(input, options, normalizeInput(input, options));
}

function prepareNormalized(
  input: string,
  options: PrepareOptions,
  normalization: string | NormalizeAlignmentResult,
  previous?: PrepareResult,
): PrepareResult {
  if (options.engine !== undefined) assertEngine(options.engine);
  const normalized = typeof normalization === 'string' ? normalization : normalization.text;
  const correctionMetadata = options.normalizationCorrections && typeof normalization !== 'string'
    ? {
        normalizationFingerprint: normalization.fingerprint,
        normalizationCorrectionsApplied: normalization.correctionsApplied,
      }
    : {};
  const activeRules = normalizeOptions(options)?.rules;
  const manuallyCorrectedSpans = new Set(
    options.normalizationCorrections?.corrections.map((correction) =>
      [correction.sourceStart, correction.sourceEnd].join(':'),
    ) ?? [],
  );
  const semanticFindings = previous?.semanticFindings ?? scanSemanticSpans(input)
    .filter((span) =>
      span.kind === 'ambiguous' &&
      activeRules?.explain(span.raw)?.status !== 'verified' &&
      !manuallyCorrectedSpans.has([span.start, span.end].join(':')),
    )
    .map((span) => Object.freeze({ kind: span.kind, raw: span.raw, offset: span.start, message: span.reason ?? 'Потрібна перевірка значення фрагмента.' }));

  const dictionary = options.dictionary ?? options.resources?.dictionary;
  const lexicon = options.lexicon ?? options.stress?.lexicon ?? options.resources?.lexicon;
  const context = options.context !== undefined ? options.context ?? undefined : options.stress?.context ?? options.resources?.context;
  const resourceFingerprint = previous ? previous.resourceFingerprint : effectiveResourceFingerprint(options);
  if (!dictionary && !lexicon) {
    const engine = options.engine ?? null;
    const symbol = engine ? ENGINES[engine].symbol : 'acute';
    return {
      text: convertStressMarks(normalized, symbol),
      engine,
      warnings:
        engine && !ENGINES[engine].supportsStress
          ? [`${engine}: stress dictionary missing; markup was stripped`]
          : ['stress dictionary missing'],
      ambiguous: [],
      ambiguousOccurrences: [],
      unknown: [],
      unknownOccurrences: [],
      homographs: [],
      marked: 0,
      inferred: 0,
      contextual: 0,
      semanticFindings,
      ...(resourceFingerprint ? { resourceFingerprint } : {}),
      ...correctionMetadata,
    };
  }

  const engine = options.engine ?? 'plain';
  const decided = options.stress?.decisions ?? {};
  const stressOptionsBase = { ...options.stress };
  if (options.context === null) delete stressOptionsBase.context;
  const stressOptions: StressOptions = {
    ...stressOptionsBase,
    ...(lexicon ? { lexicon } : {}),
    ...(context ? { context } : {}),
    ...(resourceFingerprint ? { resourceFingerprint } : {}),
  };
  const result: RenderResult = render(normalized, engine, dictionary ?? StressDictionary.empty(), stressOptions);

  return {
    text: result.text,
    engine: result.engine,
    warnings: [
      ...result.warnings,
      ...(!dictionary ? ['base stress dictionary missing; only configured lexicon entries are available'] : []),
      ...(dictionary?.invalidEntryCount
        ? [`base stress dictionary: ${dictionary.invalidEntryCount} malformed entries ignored`]
        : []),
    ],
    ambiguous: result.ambiguous,
    ambiguousOccurrences: result.ambiguousOccurrences,
    unknown: result.unknown,
    unknownOccurrences: result.unknownOccurrences,
    // Явне рішення сильніше за правило, тож слово з рішенням лишається у списку для звіту.
    homographs: homographs(
      normalized,
      dictionary ?? StressDictionary.empty(),
      'acute',
      lexicon,
      context && withoutDecided(context, decided),
    ).filter((item) => result.ambiguousOccurrences.some((occurrence) => occurrence.offset === item.offset)),
    marked: result.marked,
    inferred: result.inferred,
    contextual: result.contextual,
    semanticFindings,
    ...(result.evidence ? { evidence: result.evidence } : {}),
    ...(resourceFingerprint ? { resourceFingerprint } : {}),
    ...correctionMetadata,
  };
}

export type SpeechReviewOccurrence =
  | {
      readonly kind: 'homograph';
      readonly id: string;
      readonly word: string;
      readonly key: string;
      readonly context: string;
      readonly variants: ReadonlyArray<string>;
      readonly choice: 0 | 1 | null;
      readonly sourceStart: number;
      readonly sourceEnd: number;
      readonly sourceText: string;
      readonly normalizedStart: number;
      readonly normalizedEnd: number;
      readonly engineStart: number;
      readonly engineEnd: number;
      readonly engineText: string;
    }
  | {
      readonly kind: 'unknown';
      readonly id: string;
      readonly word: string;
      readonly key: string;
      readonly context: string;
      readonly vowels: ReadonlyArray<{ readonly position: number; readonly letter: string }>;
      readonly stressPosition: number | null;
      readonly sourceStart: number;
      readonly sourceEnd: number;
      readonly sourceText: string;
      readonly normalizedStart: number;
      readonly normalizedEnd: number;
      readonly engineStart: number;
      readonly engineEnd: number;
      readonly engineText: string;
    };

export interface SpeechReview {
  readonly format: 'ua-tts-text-speech-review';
  readonly version: 1;
  /** Binds both review sections to the exact source, engine, and resources. */
  readonly fingerprint: string;
  readonly engine: EngineId | null;
  readonly resourceFingerprint: string | null;
  readonly normalization: NormalizationReview;
  readonly occurrences: ReadonlyArray<SpeechReviewOccurrence>;
}

export interface ApplySpeechReviewResult {
  readonly speech: PrepareSpeechResult;
  readonly normalization: ApplyNormalizationReviewResult;
  readonly appliedReadings: number;
  readonly unresolvedReadings: number;
  readonly fingerprint: string;
}

function reviewSentenceAt(text: string, index: number): string {
  let start = 0;
  let end = text.length;
  for (const match of text.matchAll(/[.!?\n]/gu)) {
    const boundary = match.index! + match[0].length;
    if (match[0] === '.' && /\d/u.test(text[match.index! - 1] ?? '') && /\d/u.test(text[boundary] ?? '')) continue;
    if (match.index! < index) start = boundary;
    else {
      end = boundary;
      break;
    }
  }
  return text.slice(start, end).trim();
}

function speechReviewFingerprint(
  input: string,
  normalizationFingerprint: string,
  options: PrepareSpeechOptions,
): string {
  return createHash('sha256').update(JSON.stringify({
    format: 'ua-tts-text-speech-review',
    version: 1,
    input,
    normalizationFingerprint,
    engine: options.engine ?? null,
    resourceFingerprint: effectiveResourceFingerprint(options) ?? null,
  })).digest('hex');
}

function speechReviewOccurrences(input: string, speech: PrepareSpeechResult): SpeechReviewOccurrence[] {
  const normalized = speech.normalizationAlignment.map((item) => item.spokenText).join('');
  const offsets = engineOffsets(
    normalized,
    speech.text,
    speech.prepared.engine !== null && ENGINES[speech.prepared.engine].symbol === 'plus-after',
  );
  const output: SpeechReviewOccurrence[] = [];
  const add = (kind: 'homograph' | 'unknown', word: string, start: number, extra: Record<string, unknown>) => {
    const end = start + word.length;
    const source = sourceRangeForNormalizedRange(start, end, speech.normalizationAlignment);
    const engineStart = offsets[start];
    const engineEnd = offsets[end];
    if (!source || engineStart === undefined || engineEnd === undefined) return;
    const mappedSegments = speech.normalizationAlignment.filter((segment) => segment.spokenStart < end && segment.spokenEnd > start);
    const sourceRelativeOffset = start - Math.min(...mappedSegments.map((segment) => segment.spokenStart));
    const common = {
      kind,
      id: `${kind}:${source.start}:${source.end}:${sourceRelativeOffset}`,
      word,
      key: word.toLocaleLowerCase('uk-UA'),
      context: reviewSentenceAt(input, source.start),
      sourceStart: source.start,
      sourceEnd: source.end,
      sourceText: input.slice(source.start, source.end),
      normalizedStart: start,
      normalizedEnd: end,
      engineStart,
      engineEnd,
      engineText: speech.text.slice(engineStart, engineEnd),
      ...extra,
    };
    output.push(Object.freeze(common) as SpeechReviewOccurrence);
  };
  for (const occurrence of speech.prepared.homographs) {
    if (Number.isInteger(occurrence.offset))
      add('homograph', occurrence.word, occurrence.offset!, { variants: Object.freeze([...occurrence.variants]), choice: null });
  }
  for (const occurrence of speech.prepared.unknownOccurrences) {
    const vowels = [...occurrence.word].flatMap((letter, position) => /[аеєиіїоуяю]/iu.test(letter) ? [{ position, letter }] : []);
    if (vowels.length < 2) continue;
    add('unknown', occurrence.word, occurrence.offset, { vowels: Object.freeze(vowels), stressPosition: null });
  }
  return output.sort((left, right) => left.normalizedStart - right.normalizedStart || left.kind.localeCompare(right.kind));
}

/** Create one editable JSON review for normalization, homographs, and unknown words. */
export function createSpeechReview(input: string, options: PrepareSpeechOptions = {}): SpeechReview {
  if (options.normalizationCorrections)
    throw new Error('createSpeechReview: export from the original text without pre-applied normalization corrections');
  const normalizationOptions = normalizeOptions(options) ?? {};
  const normalization = createNormalizationReview(input, normalizationOptions);
  const speech = prepareSpeech(input, { ...options, stress: { ...options.stress, trace: true } });
  return Object.freeze({
    format: 'ua-tts-text-speech-review',
    version: 1,
    fingerprint: speechReviewFingerprint(input, normalization.fingerprint, options),
    engine: options.engine ?? null,
    resourceFingerprint: effectiveResourceFingerprint(options) ?? null,
    normalization,
    occurrences: Object.freeze(speechReviewOccurrences(input, speech)),
  });
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/** Validate a unified review and apply selected normalization and stress readings. */
export function applySpeechReview(
  input: string,
  review: unknown,
  options: PrepareSpeechOptions = {},
): ApplySpeechReviewResult {
  if (options.normalizationCorrections)
    throw new Error('applySpeechReview: pass the review against original text without pre-applied corrections');
  if (!isObjectRecord(review) || review.format !== 'ua-tts-text-speech-review' || review.version !== 1 ||
      !Array.isArray(review.occurrences) || !isObjectRecord(review.normalization))
    throw new Error('speech review: unsupported or malformed file (expected ua-tts-text-speech-review v1)');

  const normalizationOptions = normalizeOptions(options) ?? {};
  const appliedNormalization = applyNormalizationReview(input, review.normalization, normalizationOptions);
  const fingerprint = speechReviewFingerprint(input, appliedNormalization.fingerprint, options);
  if (review.fingerprint !== fingerprint || review.engine !== (options.engine ?? null) ||
      review.resourceFingerprint !== (effectiveResourceFingerprint(options) ?? null))
    throw new Error('speech review: file is stale for this text, engine, or resource snapshot; export a new review file');

  const previewOptions: PrepareSpeechOptions = {
    ...options,
    ...(appliedNormalization.corrections ? { normalizationCorrections: appliedNormalization.corrections } : {}),
    stress: { ...options.stress, trace: true },
  };
  const preview = prepareSpeech(input, previewOptions);
  const current = new Map(speechReviewOccurrences(input, preview).map((item) => [item.id, item]));
  const seen = new Set<string>();
  const decisions: Record<number, 0 | 1> = { ...options.stress?.occurrenceDecisions };
  const overrides: Record<number, number> = { ...options.stress?.occurrenceOverrides };
  let appliedReadings = 0;
  for (const item of review.occurrences) {
    if (!isObjectRecord(item) || typeof item.id !== 'string')
      throw new Error('speech review: each occurrence must be an object with an id');
    if (seen.has(item.id)) throw new Error(`speech review: duplicate occurrence ${item.id}`);
    seen.add(item.id);
    const expected = current.get(item.id);
    if (!expected || item.kind !== expected.kind || item.word !== expected.word || item.key !== expected.key ||
        item.context !== expected.context || item.sourceStart !== expected.sourceStart || item.sourceEnd !== expected.sourceEnd ||
        item.sourceText !== expected.sourceText || !sameJsonValue(item.variants, 'variants' in expected ? expected.variants : undefined) ||
        !sameJsonValue(item.vowels, 'vowels' in expected ? expected.vowels : undefined))
      throw new Error(`speech review: occurrence ${item.id} no longer matches the source; export a new review file`);

    if (expected.kind === 'homograph') {
      if (item.choice !== null && item.choice !== 0 && item.choice !== 1)
        throw new Error(`speech review: choice for ${item.id} must be 0, 1, or null`);
      if (item.choice !== null) {
        decisions[expected.normalizedStart] = item.choice;
        appliedReadings += 1;
      }
    } else {
      if (item.stressPosition !== null && (typeof item.stressPosition !== 'number' || !expected.vowels.some(({ position }) => position === item.stressPosition)))
        throw new Error(`speech review: stressPosition for ${item.id} must select a listed vowel or be null`);
      if (item.stressPosition !== null) {
        overrides[expected.normalizedStart] = item.stressPosition as number;
        appliedReadings += 1;
      }
    }
  }
  for (const [id, occurrence] of current) {
    if (seen.has(id)) continue;
    const belongsToSelectedNormalization = appliedNormalization.corrections?.corrections.some((correction) =>
      correction.sourceStart <= occurrence.sourceStart && correction.sourceEnd >= occurrence.sourceEnd,
    ) ?? false;
    if (!belongsToSelectedNormalization)
      throw new Error('speech review: file is missing occurrences; export a new review file');
  }

  const speech = prepareSpeech(input, {
    ...previewOptions,
    stress: { ...previewOptions.stress, occurrenceDecisions: decisions, occurrenceOverrides: overrides },
  });
  return Object.freeze({
    speech,
    normalization: appliedNormalization,
    appliedReadings,
    unresolvedReadings: current.size - appliedReadings,
    fingerprint,
  });
}
