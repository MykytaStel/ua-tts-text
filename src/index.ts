/**
 * Публічний API: підготувати український текст до озвучки одним викликом.
 */

import type { StressDictionary } from './dict.js';
import type { StressSource } from './lexicon.js';
import { normalize, type NormalizeOptions } from './normalize.js';
import { render, type EngineId, type RenderResult } from './render.js';
import { homographs, type Homograph } from './review.js';
import type { StressOptions } from './stress.js';

export * from './dict.js';
export * from './lexicon.js';
export * from './numbers.js';
export * from './normalize.js';
export * from './render.js';
export * from './review.js';
export * from './agent.js';
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
