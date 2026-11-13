/**
 * Лексикон власних назв — шар поверх словника: виправляє помилкові варіанти,
 * додає назви, яких у словнику немає, і задає складні слова з двома наголосами.
 *
 * Формат TSV: слово <TAB> наголошене <TAB> категорія <TAB> джерело
 */

import { existsSync, readFileSync } from 'node:fs';
import type { StressHit } from './dict.js';

const ACUTE = '\u0301';
const VOWELS = new Set([...'аеєиіїоуяю']);

export interface StressSource {
  lookup(word: string): StressHit | null;
  explain?(word: string): LexiconEntry | null;
}

/** Розбирає слово з акутами у позиції голосних. */
export function parseStressed(stressed: string): { positions: number[]; dual: boolean } {
  const chars: string[] = [];
  const positions: number[] = [];
  for (const char of stressed.normalize('NFC')) {
    if (char === ACUTE || char === '\u00b4') {
      const previous = chars.at(-1);
      if (!previous || !VOWELS.has(previous.toLowerCase())) throw new Error(`parseStressed: mark must follow a vowel in "${stressed}"`);
      const position = chars.length - 1;
      if (positions.includes(position)) throw new Error(`parseStressed: duplicate stress mark in "${stressed}"`);
      positions.push(position);
      continue;
    }
    chars.push(char);
  }
  if (positions.length === 0) throw new Error(`parseStressed: no stress mark in "${stressed}"`);
  return { positions, dual: positions.length > 1 };
}

export interface LexiconEntry {
  readonly word: string;
  readonly stressed: string;
  readonly category: string;
  readonly source: string;
  readonly project?: string;
  readonly canonicalName?: string;
  readonly status: 'draft' | 'verified' | 'rejected';
  readonly positions: readonly number[];
  readonly dual: boolean;
}

export class Lexicon implements StressSource {
  readonly #entries = new Map<string, LexiconEntry>();
  readonly #inactiveEntries: LexiconEntry[] = [];
  #sealed = false;

  /** Завантажує кілька файлів; пізніші перекривають ранні. */
  static loadAll(files: readonly string[]): Lexicon {
    const result = new Lexicon();
    for (const file of files) {
      if (!existsSync(file)) continue;
      const part = Lexicon.loadTsv(file);
      for (const [key, entry] of part.#entries) result.#entries.set(key, { ...entry, positions: [...entry.positions] });
      result.#inactiveEntries.push(...part.#inactiveEntries.map((entry) => ({ ...entry, positions: [...entry.positions] })));
    }
    return result;
  }

  static loadTsv(file: string): Lexicon {
    return Lexicon.parseTsv(readFileSync(file, 'utf8'), file);
  }

  static parseTsv(tsv: string, origin = 'inline'): Lexicon {
    const lexicon = new Lexicon();
    const seen = new Set<string>();
    for (const [lineIndex, line] of tsv.split('\n').entries()) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const where = `${origin}:${lineIndex + 1}`;
      try {
        const cells = trimmed.split('\t');
        if (cells.length > 7) throw new Error('expected at most seven TSV columns');
        const [word, stressed, category = '', source = '', project, canonicalName, rawStatus] = cells;
        if (!word || !stressed) throw new Error('need word and stressed form');
        const { positions } = parseStressed(stressed);
        if (normalizeKey(stressed.replace(/[\u0301\u00b4]/gu, '')) !== normalizeKey(word))
          throw new Error(`"${stressed}" does not match "${word}"`);
        const key = normalizeKey(word);
        if (seen.has(key)) throw new Error(`duplicate word "${word}"`);
        seen.add(key);
        const status = rawStatus || 'verified';
        if (status !== 'draft' && status !== 'verified' && status !== 'rejected')
          throw new Error(`invalid status "${status}"`);
        lexicon.add(word, positions, {
          category,
          source,
          ...(project ? { project } : {}),
          ...(canonicalName ? { canonicalName } : {}),
          status,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`lexicon: ${where}: ${detail}`);
      }
    }
    return lexicon;
  }

  /** Add a later source, preserving the documented last-file-wins override order. */
  merge(other: Lexicon): void {
    this.#assertMutable();
    for (const [key, entry] of other.#entries) this.#entries.set(key, { ...entry, positions: [...entry.positions] });
    this.#inactiveEntries.push(...other.#inactiveEntries.map((entry) => ({ ...entry, positions: [...entry.positions] })));
  }

  /** Prevent callers of a shared resource snapshot from changing its decisions. */
  seal(): this {
    this.#sealed = true;
    return this;
  }

  add(
    word: string,
    positions: readonly number[],
    meta: {
      category?: string;
      source?: string;
      project?: string;
      canonicalName?: string;
      status?: LexiconEntry['status'];
    } = {},
  ): void {
    this.#assertMutable();
    const status = meta.status ?? 'verified';
    if (status !== 'draft' && status !== 'verified' && status !== 'rejected')
      throw new Error(`lexicon: invalid status "${String(status)}" for "${word}"`);
    if (positions.length === 0) throw new Error(`lexicon: no position for "${word}"`);
    if (positions.length > 2) throw new Error(`lexicon: at most two positions are supported for "${word}"`);
    if (new Set(positions).size !== positions.length) throw new Error(`lexicon: duplicate position for "${word}"`);
    const normalizedWord = word.normalize('NFC');
    const chars = [...normalizedWord];
    if (
      positions.some(
        (position) =>
          !Number.isInteger(position) || position < 0 || position >= chars.length || !VOWELS.has(chars[position]!.toLowerCase()),
      )
    )
      throw new Error(`lexicon: invalid vowel position for "${word}"`);
    for (const position of [...positions].sort((a, b) => b - a)) chars.splice(position + 1, 0, ACUTE);
    const entry: LexiconEntry = {
      word: normalizedWord,
      stressed: chars.join(''),
      category: meta.category ?? '',
      source: meta.source ?? '',
      ...(meta.project ? { project: meta.project } : {}),
      ...(meta.canonicalName ? { canonicalName: meta.canonicalName } : {}),
      status,
      positions: [...positions],
      dual: positions.length > 1,
    };
    if (entry.status === 'verified') this.#entries.set(normalizeKey(word), entry);
    else this.#inactiveEntries.push(entry);
  }

  get size(): number {
    return this.#entries.size;
  }

  /** Draft and rejected forms are retained for review but never applied to speech. */
  get inactiveEntries(): ReadonlyArray<LexiconEntry> {
    return Object.freeze(
      this.#inactiveEntries.map((entry) => Object.freeze({ ...entry, positions: Object.freeze([...entry.positions]) })),
    );
  }

  lookup(word: string): StressHit | null {
    const entry = this.#entries.get(normalizeKey(word));
    return entry ? { position: entry.positions[0]!, alternative: entry.positions[1] ?? null, dual: entry.dual } : null;
  }

  /** Returns the winning lexicon row, including its editorial provenance. */
  explain(word: string): LexiconEntry | null {
    const entry = this.#entries.get(normalizeKey(word));
    return entry ? Object.freeze({ ...entry, positions: Object.freeze([...entry.positions]) }) : null;
  }

  #assertMutable(): void {
    if (this.#sealed) throw new Error('lexicon: resource snapshot is immutable');
  }
}

export function normalizeKey(word: string): string {
  return word
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\u2019\u02bc`\u00b4]/gu, "'");
}
