/**
 * Розстановка наголосів за словником у форматі конкретного рушія.
 * Модуль не залежить від нормалізації — його можна викликати окремо.
 */

import { normalizeWord, type StressDictionary } from './dict.js';
import { hasManualStress, tokenizeWords } from './tokenize.js';
import { contextViews, type ContextSource, type ContextView } from './context.js';
import { stemOf } from './fallback.js';
import type { StressSource } from './lexicon.js';

export type StressSymbol = 'acute' | 'plus-before' | 'plus-after' | 'none';

export type AmbiguityStrategy = 'skip' | 'first' | 'all';

export interface StressOptions {
  /** Collect per-occurrence source and position explanations (adds output size). */
  trace?: boolean;
  /** Resource snapshot ID to attach to every trace row. */
  resourceFingerprint?: string;
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
  /** Choices scoped to UTF-16 offsets in the normalized input. */
  occurrenceDecisions?: Readonly<Record<number, 0 | 1>>;
  /** Explicit stress positions scoped to UTF-16 offsets in the normalized input. */
  occurrenceOverrides?: Readonly<Record<number, number>>;
  decisions?: Readonly<Record<string, 0 | 1>>;
  /** Лексикон власних назв: має пріоритет над словником. */
  lexicon?: StressSource;
  /**
   * Явні наголоси: слово → індекс наголошеної голосної. Сюди потрапляють
   * відповіді LLM для слів, яких немає у словнику.
   */
  overrides?: Readonly<Record<string, number>>;
  /** Переносити наголос зі спільного стема (увімкнено типово). */
  inferFromStem?: boolean;
  /**
   * Контекстні правила для омонімів («три ро́ки», «на горі́»). Явні рішення мають
   * найвищий пріоритет; лексикон власних назв захищений від загальних правил.
   */
  context?: ContextSource;
}

export type StressEvidenceSource =
  | 'manual'
  | 'lexicon'
  | 'dictionary'
  | 'context'
  | 'override'
  | 'decision'
  | 'strategy'
  | 'stem'
  | 'suffix'
  | 'compound'
  | 'ambiguous'
  | 'unknown'
  | 'acronym';
export interface StressEvidence {
  word: string;
  offset: number;
  source: StressEvidenceSource;
  positions: number[];
  sourceId?: string;
  detail?: string;
  verification: 'manual' | 'curated' | 'explicit' | 'inferred' | 'unverified' | 'unresolved';
  resourceFingerprint?: string;
}

export interface StressResult {
  text: string;
  /** Омоніми, які словник не зміг розв'язати (за́мок / замо́к). */
  ambiguous: string[];
  /** Окремі нерозв'язані входження: offsets are UTF-16 indexes in output text. */
  ambiguousOccurrences: Array<{ word: string; offset: number }>;
  /** Слів немає у словнику — їх має перевірити людина або LLM. */
  unknown: string[];
  /** Скільки слів отримали наголос. */
  marked: number;
  /** Скільки з них — за морфологічним фолбеком, а не зі словника. */
  inferred: number;
  /** Скільки омонімів розв'язано контекстним правилом. */
  contextual: number;
  /** Per-occurrence explanation, only when `trace: true` was requested. */
  evidence?: StressEvidence[];
}

// «+» входить у слово, щоб ручний наголос не розривався на два токени.
/** «зе-се-у», «ес-ша-а» — це абревіатури по літерах, а не слова зі словника. */
const LETTER_SPELL_RE = /^\p{L}{1,2}(?:-\p{L}{1,2})+$/u;

const VOWELS_RE = /[аеєиіїоуяю]/gu;

/** Односкладові слова наголосу не потребують — і не мають сенсу у звіті. */
function needsStress(word: string): boolean {
  return (word.match(VOWELS_RE) ?? []).length > 1;
}

/** Публічна: ставить наголос у слові за індексами голосних. */
export function markWord(word: string, positions: readonly number[], symbol: StressSymbol): string {
  if (positions.length === 0) return word;
  const chars = [...word];
  if (
    new Set(positions).size !== positions.length ||
    positions.some((position) => !Number.isInteger(position) || position < 0 || position >= chars.length || !/[аеєиіїоуяю]/iu.test(chars[position]!))
  )
    throw new RangeError(`markWord: stress positions must identify distinct vowels in "${word}"`);
  if (symbol === 'none') return word;
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
    occurrenceDecisions = {},
    occurrenceOverrides = {},
    lexicon,
    overrides = {},
    inferFromStem = true,
    context,
  } = options;

  const ambiguous = new Set<string>();
  const ambiguousOccurrences: Array<{ word: string; offset: number }> = [];
  const unknown = new Set<string>();
  let marked = 0;
  let inferred = 0;
  let contextual = 0;
  const evidence: StressEvidence[] | undefined = options.trace ? [] : undefined;
  const record = (
    word: string,
    offset: number,
    source: StressEvidenceSource,
    positions: number[] = [],
    metadata: { sourceId?: string; detail?: string } = {},
  ) => {
    const verification: StressEvidence['verification'] =
      source === 'manual'
        ? 'manual'
        : source === 'lexicon' || source === 'dictionary'
          ? 'curated'
          : source === 'override' || source === 'decision'
            ? 'explicit'
            : source === 'unknown' || source === 'ambiguous'
              ? 'unresolved'
              : source === 'strategy'
                ? 'unverified'
                : 'inferred';
    evidence?.push({
      word,
      offset,
      source,
      positions: [...positions],
      verification,
      ...(options.resourceFingerprint ? { resourceFingerprint: options.resourceFingerprint } : {}),
      ...metadata,
    });
  };
  const manualPositions = (word: string): number[] => {
    const chars = [...word];
    const found: number[] = [];
    let plainIndex = 0;
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] === '+' && /[аеєиіїоуяю]/iu.test(chars[i + 1] ?? '')) {
        found.push(plainIndex);
        continue;
      }
      if (chars[i] === '\u0301' || chars[i] === '\u00b4') {
        if (plainIndex > 0) found.push(plainIndex - 1);
        continue;
      }
      if (chars[i] === '+') continue;
      plainIndex++;
    }
    return found;
  };
  const views = new Map<number, ContextView>();
  if (context) for (const item of contextViews(text)) views.set(item.index, item.view);

  /** Наголос однієї частини складного слова (для дефісних слів). */
  const resolvePart = (key: string): number[] | null => {
    const override = overrides[key];
    if (override !== undefined) return [override];
    if (!needsStress(key)) return [];
    const hit = lexicon?.lookup(key) ?? dictionary.lookup(key);
    if (!hit) return null;
    if (hit.alternative !== null) return hit.dual ? [hit.position, hit.alternative] : null;
    return [hit.position];
  };

  /** «Кам'янець-Подільський» → наголосити кожну частину окремо. */
  const markCompound = (word: string): string | null => {
    if (!word.includes('-')) return null;
    const parts = word.split('-');
    const out: string[] = [];
    for (const part of parts) {
      if (!part) {
        out.push(part);
        continue;
      }
      const positions = resolvePart(normalizeWord(part));
      if (!positions) return null;
      out.push(symbol === 'none' ? part : markWord(part, positions, symbol));
    }
    return out.join('-');
  };

  const processWord = (word: string, offset: number): string => {
    // Уже позначене вручну (словник вимови) не чіпаємо.
    if (hasManualStress(word)) {
      record(word, offset, 'manual', manualPositions(word));
      return convertStressMarks(word, symbol);
    }
    // Прозвучені по літерах абревіатури наголошувати не треба.
    if (LETTER_SPELL_RE.test(word)) {
      record(word, offset, 'acronym');
      return word;
    }

    const normalized = normalizeWord(word).replace(/-+$/u, '');
    if (normalized.length < minLength) return word;

    const occurrenceOverride = occurrenceOverrides[offset];
    if (occurrenceOverride !== undefined) {
      marked += 1;
      record(word, offset, 'override', [occurrenceOverride]);
      return markWord(word, [occurrenceOverride], symbol);
    }

    const override = overrides[normalized] ?? overrides[word];
    if (override !== undefined && override >= 0) {
      marked += 1;
      record(word, offset, 'override', [override]);
      return markWord(word, [override], symbol);
    }

    // Сусіднє слово розв'язує омонім раніше, ніж словник оголосить його неоднозначним.
    if (
      context &&
      !lexicon?.lookup(normalized) &&
      occurrenceDecisions[offset] === undefined &&
      decisions[normalized] === undefined &&
      decisions[word] === undefined
    ) {
      const view = views.get(offset);
      const explanation = view ? context.explain?.(normalized, view) : null;
      const positions = explanation?.positions ?? (view ? context.resolve(normalized, view) : null);
      if (positions) {
        marked += 1;
        contextual += 1;
        record(word, offset, 'context', positions, {
          ...(explanation?.condition ? { sourceId: explanation.condition } : {}),
          ...(explanation?.source ? { detail: explanation.source } : {}),
        });
        return markWord(word, positions, symbol);
      }
    }

    const hit = lexicon?.lookup(normalized) ?? dictionary.lookup(normalized);
    if (!hit) {
      const compound = markCompound(word);
      if (compound !== null) {
        marked += 1;
        inferred += 1;
        record(word, offset, 'compound');
        return compound;
      }

      if (inferFromStem) {
        const stem = stemOf(normalized);
        if (stem !== normalized && stem.length >= 4) {
          const position = dictionary.stemStress(stem);
          if (position !== null) {
            marked += 1;
            inferred += 1;
            record(word, offset, 'stem', [position]);
            return markWord(word, [position], symbol);
          }
        }
        const bySuffix = dictionary.suffixStress(normalized);
        if (bySuffix !== null) {
          marked += 1;
          inferred += 1;
          record(word, offset, 'suffix', [bySuffix]);
          return markWord(word, [bySuffix], symbol);
        }
      }

      // Односкладові слова словник часто не маркує — це не проблема, а шум у звіті.
      if (needsStress(normalized) && normalized.length >= minReportLength) {
        unknown.add(word);
        record(word, offset, 'unknown');
      }
      return word;
    }

    // Складне слово з двома наголосами — ставимо обидва, це не омонім.
    const lexiconEntry = lexicon?.explain?.(normalized) ?? null;
    const hitSource: StressEvidenceSource = lexiconEntry || lexicon?.lookup(normalized) ? 'lexicon' : 'dictionary';
    const hitMetadata = lexiconEntry
      ? {
          sourceId: lexiconEntry.word,
          detail: [lexiconEntry.category, lexiconEntry.source].filter(Boolean).join(' · '),
        }
      : {};
    if (hit.alternative !== null && hit.dual) {
      marked += 1;
      record(word, offset, hitSource, [hit.position, hit.alternative], hitMetadata);
      return markWord(word, [hit.position, hit.alternative], symbol);
    }

    if (hit.alternative !== null) {
      const decision = occurrenceDecisions[offset] ?? decisions[normalized] ?? decisions[word];
      if (decision !== undefined) {
        if (decision !== 0 && decision !== 1) throw new RangeError(`stressify: invalid ambiguity decision for "${word}"`);
        marked += 1;
        record(word, offset, 'decision', [decision === 0 ? hit.position : hit.alternative]);
        return markWord(word, [decision === 0 ? hit.position : hit.alternative], symbol);
      }
      if (onAmbiguity === 'skip') {
        ambiguous.add(word);
        ambiguousOccurrences.push({ word, offset });
        record(word, offset, 'ambiguous', [hit.position, hit.alternative]);
        return word;
      }
      if (onAmbiguity === 'first') {
        marked += 1;
        record(word, offset, 'strategy', [hit.position]);
        return markWord(word, [hit.position], symbol);
      }
      marked += 1;
      record(word, offset, 'strategy', [hit.position, hit.alternative]);
      return markWord(word, [hit.position, hit.alternative], symbol);
    }

    marked += 1;
    record(word, offset, hitSource, [hit.position], hitMetadata);
    return markWord(word, [hit.position], symbol);
  };

  const output: string[] = [];
  let cursor = 0;
  for (const token of tokenizeWords(text)) {
    output.push(text.slice(cursor, token.start), processWord(token.text, token.start));
    cursor = token.end;
  }
  output.push(text.slice(cursor));
  const result = output.join('');

  if (symbol === 'none') {
    return {
      text: result,
      ambiguous: [...ambiguous],
      ambiguousOccurrences,
      unknown: [...unknown],
      marked: 0,
      inferred: 0,
      contextual: 0,
      ...(evidence ? { evidence } : {}),
    };
  }
  return {
    text: result,
    ambiguous: [...ambiguous],
    ambiguousOccurrences,
    unknown: [...unknown],
    marked,
    inferred,
    contextual,
    ...(evidence ? { evidence } : {}),
  };
}

/** Input convention: + before a vowel, or acute after it. Output follows engine. */
export function convertStressMarks(text: string, symbol: StressSymbol): string {
  const acute = text.replace(/\+([аеєиіїоуяюАЕЄИІЇОУЯЮ])/gu, '$1\u0301');
  if (symbol === 'acute') return acute;
  if (symbol === 'none') return acute.replace(/\u0301/gu, '');
  return acute.replace(/([аеєиіїоуяюАЕЄИІЇОУЯЮ])\u0301/gu, symbol === 'plus-before' ? '+$1' : '$1+');
}
