/**
 * Публічний API: підготувати український текст до озвучки одним викликом.
 */

import type { StressDictionary } from './dict.js';
import type { StressSource } from './lexicon.js';
import { normalize, type NormalizeOptions } from './normalize.js';
import { render, type EngineId, type RenderResult } from './render.js';
import { homographs, type Homograph } from './review.js';
import { resolveHomographs, resolveUnknown, type Asker } from './resolve.js';
import type { Decisions } from './agent.js';
import type { StressOptions } from './stress.js';

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

export interface PrepareOptions {
  /** Рушій, під який готуємо. Без нього текст лише нормалізується. */
  engine?: EngineId;
  /** Словник наголосів. Без нього наголоси не розставляються. */
  dictionary?: StressDictionary;
  /** Лексикон власних назв — пріоритетніший за словник. */
  lexicon?: StressSource;
  normalize?: NormalizeOptions;
  stress?: StressOptions;
}

export interface PrepareResult {
  text: string;
  engine: EngineId | null;
  warnings: string[];
  ambiguous: string[];
  unknown: string[];
  /** Омоніми з двома прочитаннями — те, що має вирішити людина або LLM. */
  homographs: Homograph[];
  marked: number;
  /** Скільки слів наголошено морфологічним фолбеком, а не словником. */
  inferred: number;
}

export interface PrepareManyOptions extends PrepareOptions {
  /** Якщо задано — омоніми розв'язуються одним запитом до LLM. */
  ask?: Asker;
}

export interface PrepareManyResult {
  results: PrepareResult[];
  decisions: Decisions;
  /** Наголоси, які LLM дав для слів поза словником. */
  overrides: Record<string, number>;
  missing: string[];
  /** Довжина запитів до LLM — щоб оцінити витрати. */
  promptLength: number;
}

/**
 * Пакетна підготовка: омоніми збираються з усіх фрагментів і розв'язуються
 * одним LLM-запитом. Без `ask` поводиться як звичайний `prepare`.
 */
export async function prepareMany(
  inputs: readonly string[],
  options: PrepareManyOptions = {},
): Promise<PrepareManyResult> {
  const first = inputs.map((input) => prepare(input, options));
  if (!options.ask || !options.dictionary) {
    return { results: first, decisions: {}, overrides: {}, missing: [], promptLength: 0 };
  }

  const unique = new Map<string, Homograph>();
  const unknownWords = new Set<string>();
  for (const result of first) {
    for (const item of result.homographs) {
      if (!unique.has(item.key)) unique.set(item.key, item);
    }
    for (const word of result.unknown) unknownWords.add(word.toLowerCase());
  }

  let decisions: Decisions = {};
  let overrides: Record<string, number> = {};
  let missing: string[] = [];
  let promptLength = 0;

  if (unique.size > 0) {
    const homographsResolved = await resolveHomographs([...unique.values()], options.ask);
    decisions = homographsResolved.decisions;
    missing = homographsResolved.missing;
    promptLength += homographsResolved.promptLength;
  }
  if (unknownWords.size > 0) {
    const unknownResolved = await resolveUnknown([...unknownWords], options.ask);
    overrides = unknownResolved.overrides;
    missing = [...missing, ...unknownResolved.missing];
    promptLength += unknownResolved.promptLength;
  }
  if (Object.keys(decisions).length === 0 && Object.keys(overrides).length === 0) {
    return { results: first, decisions, overrides, missing, promptLength };
  }

  const results = inputs.map((input) =>
    prepare(input, { ...options, stress: { ...options.stress, decisions, overrides } }),
  );
  return { results, decisions, overrides, missing, promptLength };
}

/** Нормалізація + наголоси під рушій. */
export function prepare(input: string, options: PrepareOptions = {}): PrepareResult {
  const normalized = normalize(input, options.normalize);

  if (!options.dictionary) {
    return { text: normalized, engine: null, warnings: [], ambiguous: [], unknown: [], homographs: [], marked: 0, inferred: 0 };
  }

  const engine = options.engine ?? 'plain';
  const stressOptions: StressOptions = { ...options.stress, ...(options.lexicon ? { lexicon: options.lexicon } : {}) };
  const result: RenderResult = render(normalized, engine, options.dictionary, stressOptions);

  return {
    text: result.text,
    engine: result.engine,
    warnings: result.warnings,
    ambiguous: result.ambiguous,
    unknown: result.unknown,
    homographs: homographs(normalized, options.dictionary, 'acute', options.lexicon),
    marked: result.marked,
    inferred: result.inferred,
  };
}
