/**
 * Лексикон власних назв — шар поверх словника: виправляє помилкові варіанти,
 * додає назви, яких у словнику немає, і задає складні слова з двома наголосами.
 *
 * Формат TSV: слово <TAB> наголошене <TAB> категорія <TAB> джерело
 */

import { existsSync, readFileSync } from 'node:fs';
import type { StressHit } from './dict.js';

const ACUTE = '\u0301';

export interface StressSource {
  lookup(word: string): StressHit | null;
}

/** Розбирає слово з акутами у позиції голосних. */
export function parseStressed(stressed: string): { positions: number[]; dual: boolean } {
  const chars = [];
  const positions: number[] = [];
  for (const char of stressed) {
    if (char === ACUTE || char === '\u00b4') {
      if (chars.length > 0) positions.push(chars.length - 1);
      continue;
    }
    chars.push(char);
  }
  if (positions.length === 0) throw new Error(`parseStressed: no stress mark in "${stressed}"`);
  return { positions, dual: positions.length > 1 };
}

export interface LexiconEntry {
  word: string;
  stressed: string;
  category: string;
  source: string;
  positions: number[];
  dual: boolean;
}

export class Lexicon implements StressSource {
  readonly #entries = new Map<string, StressHit>();
  #count = 0;

  /** Завантажує кілька файлів; пізніші перекривають ранні. */
  static loadAll(files: readonly string[]): Lexicon {
    const result = new Lexicon();
    for (const file of files) {
      if (!existsSync(file)) continue;
      const part = Lexicon.loadTsv(file);
      for (const [key, hit] of part.#entries) result.#entries.set(key, hit);
      result.#count += part.#count;
    }
    return result;
  }

  static loadTsv(file: string): Lexicon {
    const lexicon = new Lexicon();
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [word, stressed, category = '', source = ''] = trimmed.split('\t');
      if (!word || !stressed) continue;
      const { positions, dual } = parseStressed(stressed);
      lexicon.add(word, positions, { category, source });
    }
    return lexicon;
  }

  add(word: string, positions: readonly number[], meta: { category?: string; source?: string } = {}): void {
    if (positions.length === 0) throw new Error(`lexicon: no position for "${word}"`);
    this.#count += 1;
    this.#entries.set(normalizeKey(word), {
      position: positions[0]!,
      alternative: positions[1] ?? null,
      dual: positions.length > 1,
    });
    void meta;
  }

  get size(): number {
    return this.#count;
  }

  lookup(word: string): StressHit | null {
    return this.#entries.get(normalizeKey(word)) ?? null;
  }
}

export function normalizeKey(word: string): string {
  return word.toLowerCase().replace(/[\u2019\u02bc`\u00b4]/gu, "'");
}
