/**
 * Публічний API: підготувати український текст до озвучки одним викликом.
 */

import type { StressDictionary } from './dict.js';
import type { StressSource } from './lexicon.js';
import { normalize, type NormalizeOptions } from './normalize.js';
import { render, type EngineId, type RenderResult } from './render.js';
import { homographs, type Homograph } from './review.js';
import { resolveHomographs, type Asker } from './resolve.js';
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
}

export interface PrepareManyOptions extends PrepareOptions {
  /** Якщо задано — омоніми розв'язуються одним запитом до LLM. */
  ask?: Asker;
}

export interface PrepareManyResult {
  results: PrepareResult[];
  decisions: Decisions;
  missing: string[];
  /** Довжина запиту до LLM — щоб оцінити витрати. */
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
    return { results: first, decisions: {}, missing: [], promptLength: 0 };
  }

  const unique = new Map<string, Homograph>();
  for (const result of first) {
    for (const item of result.homographs) {
      if (!unique.has(item.key)) unique.set(item.key, item);
    }
  }
  if (unique.size === 0) return { results: first, decisions: {}, missing: [], promptLength: 0 };

  const resolved = await resolveHomographs([...unique.values()], options.ask);
  const results = inputs.map((input) =>
    prepare(input, { ...options, stress: { ...options.stress, decisions: resolved.decisions } }),
  );
  return { results, decisions: resolved.decisions, missing: resolved.missing, promptLength: resolved.promptLength };
}

/** Нормалізація + наголоси під рушій. */
export function prepare(input: string, options: PrepareOptions = {}): PrepareResult {
  const normalized = normalize(input, options.normalize);

  if (!options.dictionary) {
    return { text: normalized, engine: null, warnings: [], ambiguous: [], unknown: [], homographs: [], marked: 0 };
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
  };
}
