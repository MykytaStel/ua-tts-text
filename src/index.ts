/**
 * Публічний API: підготувати український текст до озвучки одним викликом.
 */

import { createHash } from 'node:crypto';
import type { ContextSource } from './context.js';
import { StressDictionary } from './dict.js';
import type { StressSource } from './lexicon.js';
import { planSpeech, renderPlan, type PlanOptions, type SpeechPlan } from './plan.js';
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
  /** Readiness findings that should be reviewed before synthesis. */
  readonly readiness: PreparedCheckResult;
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
    ...(checkStress ? result.unknown : []).map((word) => Object.freeze({ kind: 'unknown-word' as const, word })),
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
  return speechHandoff(prepareNormalized(input, options, normalization), normalization, options.plan);
}

function speechHandoff(
  prepared: PrepareResult,
  normalization: NormalizeAlignmentResult,
  planOptions: PlanOptions | undefined,
): PrepareSpeechResult {
  const plan = planSpeech(prepared.text, planOptions);
  const engine = prepared.engine ? ENGINES[prepared.engine] : undefined;
  const ssmlOutput = !prepared.engine || prepared.engine === 'plain'
    ? { ssml: renderPlan(plan, 'ssml') }
    : { ssmlUnavailableReason: engine?.ssmlBreaks === false
        ? `${prepared.engine}: SSML break tags are unsupported; use text and the speech plan`
        : `${prepared.engine}: use the speech plan with your provider adapter to render supported markup` };
  return Object.freeze({
    text: prepared.text,
    prepared,
    plan,
    ...ssmlOutput,
    normalizationAlignment: normalization.alignment,
    readiness: checkReadiness(prepared, engine?.supportsStress ?? true),
  });
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
    paragraphs: results.map((prepared, index) => speechHandoff(prepared, alignments[index]!, plan)),
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
