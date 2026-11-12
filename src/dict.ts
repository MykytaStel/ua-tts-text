/**
 * Бінарний словник наголосів (формат описаний у scripts/build-dict.mjs).
 * Ключі відсортовані за UTF-8, пошук — двійковий по байтах, без розпакування в Map.
 */

import { readFileSync } from 'node:fs';

const MAGIC = 'UATS3';
const HEADER_BYTES = 16;
const NONE = 255;
/** Мінімальна впевненість суфіксної моделі, щоб їй довіряти. */
const SUFFIX_CONFIDENCE = 70;

export interface StressHit {
  /** Індекс голосної з наголосом у ключі. */
  readonly position: number;
  /** Друга позиція: другий наголос складного слова або варіант прочитання омоніма. */
  readonly alternative: number | null;
  /** true — обидва наголоси чинні (Кам'яне́ць-Поді́льський); false — це різні прочитання. */
  readonly dual: boolean;
}

export class StressDictionary {
  readonly size: number;

  readonly #buffer: Buffer;
  readonly #offsets: number;
  readonly #positions: number;
  readonly #flags: number;
  readonly #suffix: number;
  readonly #suffixBytes: number;
  readonly #keys: number;
  #suffixTable: Map<string, { distance: number; confidence: number }> | null = null;
  readonly #cache = new Map<string, StressHit | null>();

  private constructor(buffer: Buffer) {
    if (buffer.subarray(0, 5).toString('latin1') !== MAGIC) {
      throw new Error('dict: unsupported format (bad magic)');
    }
    this.#buffer = buffer;
    this.size = buffer.readUInt32LE(8);
    this.#offsets = HEADER_BYTES;
    this.#positions = HEADER_BYTES + (this.size + 1) * 4;
    this.#flags = this.#positions + this.size * 2;
    this.#suffix = this.#flags + this.size;
    this.#suffixBytes = buffer.readUInt32LE(12);
    this.#keys = this.#suffix + this.#suffixBytes;
  }

  static load(file: string): StressDictionary {
    return new StressDictionary(readFileSync(file));
  }

  /** Шукає наголос для слова в нижньому регістрі (апострофи — звичайні). */
  lookup(word: string): StressHit | null {
    const cached = this.#cache.get(word);
    if (cached !== undefined) return cached;

    const needle = Buffer.from(word, 'utf8');
    let low = 0;
    let high = this.size - 1;
    let found: StressHit | null = null;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const start = this.#buffer.readUInt32LE(this.#offsets + mid * 4);
      const end = this.#buffer.readUInt32LE(this.#offsets + (mid + 1) * 4);
      const cmp = Buffer.compare(this.#buffer.subarray(this.#keys + start, this.#keys + end), needle);
      if (cmp === 0) {
        const base = this.#positions + mid * 2;
        const first = this.#buffer[base]!;
        const second = this.#buffer[base + 1]!;
        found =
          first === NONE
            ? null
            : {
                position: first,
                alternative: second === NONE ? null : second,
                dual: this.#buffer[this.#flags + mid] === 1,
              };
        break;
      }
      if (cmp < 0) low = mid + 1;
      else high = mid - 1;
    }

    // Кеш обмежений, щоб довгі тексти не тримали весь словник у пам'яті.
    if (this.#cache.size < 200_000) this.#cache.set(word, found);
    return found;
  }

  /**
   * Наголос за спільним стемом: для «молок» знаходить «молоко» і повертає
   * позицію голосної, якщо вона всередині стема. Так відмінювані форми й
   * частини складних слів успадковують наголос від відомого родича.
   */
  stemStress(stem: string): number | null {
    const needle = Buffer.from(stem, 'utf8');
    if (needle.length === 0) return null;
    const stemLength = [...stem].length;

    let low = 0;
    let high = this.size - 1;
    let first = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const start = this.#buffer.readUInt32LE(this.#offsets + mid * 4);
      const end = this.#buffer.readUInt32LE(this.#offsets + (mid + 1) * 4);
      const slice = this.#buffer.subarray(this.#keys + start, this.#keys + end);
      if (Buffer.compare(slice.subarray(0, needle.length), needle) >= 0) {
        first = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    if (first < 0) return null;

    const votes = new Map<number, number>();
    for (let i = first; i < this.size && i < first + 12; i += 1) {
      const start = this.#buffer.readUInt32LE(this.#offsets + i * 4);
      const end = this.#buffer.readUInt32LE(this.#offsets + (i + 1) * 4);
      const slice = this.#buffer.subarray(this.#keys + start, this.#keys + end);
      if (Buffer.compare(slice.subarray(0, needle.length), needle) !== 0) break;
      const base = this.#positions + i * 2;
      const position = this.#buffer[base]!;
      if (position === NONE || position >= stemLength) continue;
      votes.set(position, (votes.get(position) ?? 0) + 1);
    }

    let best: number | null = null;
    let bestCount = 0;
    for (const [position, count] of votes) {
      if (count > bestCount) {
        bestCount = count;
        best = position;
      }
    }
    return best;
  }

  /** Суфіксна модель: розбирається ліниво, лише коли справді потрібна. */
  #suffixes(): Map<string, { distance: number; confidence: number }> {
    if (this.#suffixTable) return this.#suffixTable;
    const table = new Map<string, { distance: number; confidence: number }>();
    const text = this.#buffer.subarray(this.#suffix, this.#suffix + this.#suffixBytes).toString('utf8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      const [suffix, distance, confidence] = line.split('\t');
      if (!suffix || distance === undefined || confidence === undefined) continue;
      table.set(suffix, { distance: Number(distance), confidence: Number(confidence) });
    }
    this.#suffixTable = table;
    return table;
  }

  /**
   * Наголос за суфіксом: останні 5 літер дають найчастішу відстань до кінця.
   * Повертає лише впевнені передбачення — краще пропустити, ніж поставити не туди.
   */
  suffixStress(word: string): number | null {
    const chars = [...word];
    if (chars.length < 5) return null;
    const entry = this.#suffixes().get(chars.slice(-5).join(''));
    if (!entry || entry.confidence < SUFFIX_CONFIDENCE) return null;
    const position = chars.length - entry.distance;
    return position >= 0 && position < chars.length ? position : null;
  }
}

/** Нормалізує слово до вигляду ключів словника. */
export function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[\u2019\u02bc`\u00b4]/g, "'");
}
