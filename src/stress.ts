/**
 * Розстановка наголосів за словником у форматі конкретного рушія.
 * Модуль не залежить від нормалізації — його можна викликати окремо.
 */

import { normalizeWord, type StressDictionary } from './dict.js';
import type { StressSource } from './lexicon.js';

export type StressSymbol = 'acute' | 'plus-before' | 'plus-after' | 'none';

export type AmbiguityStrategy = 'skip' | 'first' | 'all';

export interface StressOptions {
  /** Як позначати наголос. */
  symbol?: StressSymbol;
  /** Що робити з омонімами: пропустити, взяти перший варіант або позначити обидва. */
  onAmbiguity?: AmbiguityStrategy;
  /** Слова коротші за це не позначаються — у мовленні вони й так ненаголошені. */
  minLength?: number;
  /** З якої довжини скаржитись на відсутність слова у словнику (короткі — шум). */
  minReportLength?: number;
  /**
   * Рішення для омонімів: слово → 0 (перший варіант словника) або 1 (другий).
   * Сюди потрапляє вибір людини або LLM після перегляду списку омонімів.
   */
  decisions?: Readonly<Record<string, 0 | 1>>;
  /** Лексикон власних назв: має пріоритет над словником. */
  lexicon?: StressSource;
}

export interface StressResult {
  text: string;
  /** Омоніми, які словник не зміг розв'язати (за́мок / замо́к). */
  ambiguous: string[];
  /** Слів немає у словнику — їх має перевірити людина або LLM. */
  unknown: string[];
  /** Скільки слів отримали наголос. */
  marked: number;
}

// «+» входить у слово, щоб ручний наголос не розривався на два токени.
/** «зе-се-у», «ес-ша-а» — це абревіатури по літерах, а не слова зі словника. */
const LETTER_SPELL_RE = /^\p{L}{1,2}(?:-\p{L}{1,2})+$/u;

const VOWELS_RE = /[аеєиіїоуяю]/gu;

/** Односкладові слова наголосу не потребують — і не мають сенсу у звіті. */
function needsStress(word: string): boolean {
  return (word.match(VOWELS_RE) ?? []).length > 1;
}

const WORD_RE = /[\p{L}][\p{L}\u2019\u02bc'`+\-]*/gu;

/** Публічна: ставить наголос у слові за індексами голосних. */
export function markWord(word: string, positions: readonly number[], symbol: StressSymbol): string {
  if (symbol === 'none' || positions.length === 0) return word;
  const chars = [...word];
  const sorted = [...positions].sort((a, b) => b - a);
  for (const position of sorted) {
    if (position < 0 || position >= chars.length) continue;
    const insertAt = symbol === 'plus-before' ? position : position + 1;
    const mark = symbol === 'acute' ? '\u0301' : '+';
    chars.splice(insertAt, 0, mark);
  }
  return chars.join('');
}

/** Позначає наголоси у вже нормалізованому тексті. */
export function stressify(text: string, dictionary: StressDictionary, options: StressOptions = {}): StressResult {
  const {
    symbol = 'acute',
    onAmbiguity = 'skip',
    minLength = 3,
    minReportLength = 4,
    decisions = {},
    lexicon,
  } = options;

  const ambiguous = new Set<string>();
  const unknown = new Set<string>();
  let marked = 0;

  const result = text.replace(WORD_RE, (word) => {
    // Уже позначене вручну (словник вимови) не чіпаємо.
    if (word.includes('+')) return word;
    // Прозвучені по літерах абревіатури наголошувати не треба.
    if (LETTER_SPELL_RE.test(word)) return word;

    const normalized = normalizeWord(word).replace(/-+$/u, '');
    if (normalized.length < minLength) return word;

    const hit = lexicon?.lookup(normalized) ?? dictionary.lookup(normalized);
    if (!hit) {
      // Односкладові слова словник часто не маркує — це не проблема, а шум у звіті.
      if (needsStress(normalized) && normalized.length >= minReportLength) unknown.add(word);
      return word;
    }

    // Складне слово з двома наголосами — ставимо обидва, це не омонім.
    if (hit.alternative !== null && hit.dual) {
      marked += 1;
      return markWord(word, [hit.position, hit.alternative], symbol);
    }

    if (hit.alternative !== null) {
      const decision = decisions[normalized] ?? decisions[word];
      if (decision !== undefined) {
        marked += 1;
        return markWord(word, [decision === 0 ? hit.position : hit.alternative], symbol);
      }
      if (onAmbiguity === 'skip') {
        ambiguous.add(word);
        return word;
      }
      if (onAmbiguity === 'first') {
        marked += 1;
        return markWord(word, [hit.position], symbol);
      }
      marked += 1;
      return markWord(word, [hit.position, hit.alternative], symbol);
    }

    marked += 1;
    return markWord(word, [hit.position], symbol);
  });

  if (symbol === 'none') {
    return { text: result, ambiguous: [...ambiguous], unknown: [...unknown], marked: 0 };
  }
  return { text: result, ambiguous: [...ambiguous], unknown: [...unknown], marked };
}
