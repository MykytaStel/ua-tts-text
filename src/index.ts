/**
 * Публічний API: підготувати український текст до озвучки одним викликом.
 */

import { createHash } from 'node:crypto';
import type { ContextSource } from './context.js';
import { StressDictionary } from './dict.js';
import type { StressSource } from './lexicon.js';
import { normalize, type NormalizeOptions } from './normalize.js';
import { ENGINES, render, type EngineId, type RenderResult } from './render.js';
import { homographs, type Homograph } from './review.js';
import { resolveOccurrences, resolveUnknown, type Asker, type ResolveOptions } from './resolve.js';
import type { Decisions } from './agent.js';
import { convertStressMarks, type StressEvidence, type StressOptions } from './stress.js';
import type { Resources } from './resources.js';

export * from './context.js';
export * from './dict.js';
export * from './lexicon.js';
export * from './numbers.js';
export * from './normalize.js';
export * from './render.js';
export * from './review.js';
export * from './agent.js';
export * from './resolve.js';
export * from './plan.js';
export * from './stress.js';
export * from './resources.js';
export * from './tokenize.js';

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
  stress?: StressOptions;
}

export interface PrepareResult {
  text: string;
  engine: EngineId | null;
  warnings: string[];
  ambiguous: string[];
  ambiguousOccurrences: Array<{ word: string; offset: number }>;
  unknown: string[];
  /** Омоніми з двома прочитаннями — те, що має вирішити людина або LLM. */
  homographs: Homograph[];
  marked: number;
  /** Скільки слів наголошено морфологічним фолбеком, а не словником. */
  inferred: number;
  /** Скільки омонімів розв'язано контекстним правилом. */
  contextual: number;
  evidence?: StressEvidence[];
  resourceFingerprint?: string;
}

export interface PrepareManyOptions extends PrepareOptions {
  /** Якщо задано — омоніми розв'язуються одним запитом до LLM. */
  ask?: Asker;
  /** Unknown-word guesses require a separate explicit opt-in. */
  resolveUnknown?: boolean;
  /** Manual choices keyed by paragraph:UTF16Offset. */
  occurrenceDecisions?: Readonly<Record<string, 0 | 1>>;
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

function assertEngine(engine: string): asserts engine is EngineId {
  if (!Object.hasOwn(ENGINES, engine)) throw new Error(`prepare: unknown engine "${engine}"`);
}

/**
 * Пакетна підготовка: омоніми збираються з усіх фрагментів і розв'язуються
 * одним LLM-запитом. Без `ask` поводиться як звичайний `prepare`.
 */
export async function prepareMany(inputs: readonly string[], options: PrepareManyOptions = {}): Promise<PrepareManyResult> {
  if (inputs.length > 1 && Object.keys(options.stress?.occurrenceDecisions ?? {}).length > 0)
    throw new Error('prepareMany: use paragraph:offset keys in occurrenceDecisions for multiple inputs');
  const decisionFingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        normalizedInputs: inputs.map((input) => normalize(input, options.normalize)),
        engine: options.engine ?? null,
        resourceFingerprint: options.resources?.manifest.fingerprint ?? options.stress?.resourceFingerprint ?? null,
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
    for (const [key, choice] of Object.entries(options.occurrenceDecisions ?? {})) {
      const [owner, offset] = key.split(':');
      if (Number(owner) === paragraph && /^\d+$/u.test(offset ?? '')) occurrenceDecisions[Number(offset)] = choice;
    }
    return { ...effectiveOptions, stress: { ...options.stress, occurrenceDecisions } };
  };
  const first = inputs.map((input, paragraph) => prepare(input, forParagraph(paragraph)));
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
    const occurrenceDecisions: Record<number, 0 | 1> = { ...forParagraph(paragraph).stress?.occurrenceDecisions };
    for (const item of occurrences) {
      const choice = decisions[item.id];
      if (item.id.startsWith(`${paragraph}:`) && choice !== undefined) occurrenceDecisions[item.offset!] = choice;
    }
    return prepare(input, {
      ...forParagraph(paragraph),
      stress: { ...options.stress, occurrenceDecisions, overrides: { ...overrides, ...options.stress?.overrides } },
    });
  });
  return { results, decisions, overrides, missing, warnings, promptLength, decisionFingerprint };
}

/** Правила, що мовчать для слів із явним рішенням — так само, як у `stressify`. */
function withoutDecided(context: ContextSource, decided: Readonly<Record<string, 0 | 1>>): ContextSource {
  return { resolve: (word, view) => (decided[word] === undefined ? context.resolve(word, view) : null) };
}

/** Нормалізація + наголоси під рушій. */
export function prepare(input: string, options: PrepareOptions = {}): PrepareResult {
  if (options.engine !== undefined) assertEngine(options.engine);
  const normalized = normalize(input, options.normalize);

  const dictionary = options.dictionary ?? options.resources?.dictionary;
  const lexicon = options.lexicon ?? options.stress?.lexicon ?? options.resources?.lexicon;
  const context = options.context !== undefined ? options.context ?? undefined : options.stress?.context ?? options.resources?.context;
  const resourceFingerprint = options.resources?.manifest.fingerprint ?? options.stress?.resourceFingerprint;
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
      homographs: [],
      marked: 0,
      inferred: 0,
      contextual: 0,
      ...(resourceFingerprint ? { resourceFingerprint } : {}),
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
    ...(result.evidence ? { evidence: result.evidence } : {}),
    ...(resourceFingerprint ? { resourceFingerprint } : {}),
  };
}
