import { cardinal, decimalWords, inflectOrdinal, ordinal, pluralForm, yearWords } from './numbers.js';

export type SemanticKind = 'date' | 'time' | 'fraction' | 'ratio' | 'identifier' | 'decimal' | 'measure' | 'ambiguous';

/** A typed fragment in the source text. Offsets are UTF-16 indexes into the original input. */
export interface SemanticSpan {
  readonly kind: SemanticKind;
  readonly start: number;
  readonly end: number;
  readonly raw: string;
  readonly value?: Readonly<Record<string, string | number | boolean>>;
  /** Spoken form when the reading is safe and unambiguous. */
  readonly spoken?: string;
  readonly reason?: string;
}

interface Candidate extends SemanticSpan {
  readonly priority: number;
}

function validIsoDate(year: number, month: number, day: number): boolean {
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1]!;
}

function spokenDate(year: number, month: number, day: number): string | undefined {
  const months = [
    'січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
    'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня',
  ];
  const yearText = yearWords(year, 'року');
  const monthText = months[month - 1];
  if (!yearText || !monthText) return undefined;
  return `${inflectOrdinal(ordinal(day), 'gen')} ${monthText} ${yearText}`;
}

function spokenTime(hour: number, minute: number, afterPreposition: boolean): string {
  const hourOrdinal = ordinal(hour);
  const locativeFeminine = hourOrdinal.endsWith('ий') ? `${hourOrdinal.slice(0, -2)}ій` : hourOrdinal;
  const hourPhrase = hour === 0
    ? 'нуль годин'
    : `${afterPreposition ? locativeFeminine : inflectOrdinal(hourOrdinal, 'fem')} ${afterPreposition ? 'годині' : 'година'}`;
  const minuteWord = minute === 0 ? '' : `${cardinal(minute, 'f')} ${pluralForm(minute, ['хвилина', 'хвилини', 'хвилин'])}`;
  return `${hourPhrase}${minuteWord ? ` ${minuteWord}` : ''}`;
}

const FRACTION_CONTEXT = /^(?:склянк|стакан|чаш|ложк|част|порц|кілог|грам|метр|літр|відсот|доб|годин)/iu;

function candidate(
  _input: string,
  match: RegExpExecArray,
  kind: SemanticKind,
  priority: number,
  spoken?: string,
  reason?: string,
  value?: Readonly<Record<string, string | number | boolean>>,
  rawOverride?: string,
): Candidate {
  const raw = rawOverride ?? match[0];
  return {
    kind,
    start: match.index,
    end: match.index + raw.length,
    raw,
    priority,
    ...(spoken === undefined ? {} : { spoken }),
    ...(reason === undefined ? {} : { reason }),
    ...(value === undefined ? {} : { value: Object.freeze(value) }),
  };
}

function allMatches(input: string, pattern: RegExp, map: (match: RegExpExecArray) => Candidate): Candidate[] {
  const found: Candidate[] = [];
  for (const match of input.matchAll(pattern)) found.push(map(match as RegExpExecArray));
  return found;
}

/**
 * Recognizes spans whose punctuation or digits carry semantic structure. The
 * result is a conservative lexical analysis, not a full Ukrainian parser.
 */
export function scanSemanticSpans(input: string): ReadonlyArray<SemanticSpan> {
  const candidates: Candidate[] = [
    ...allMatches(input, /(?<![\p{L}\d])(?:v?\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?|\d{1,3}(?:\.\d{1,3}){3})(?![\p{L}\d])/giu, (match) =>
      candidate(input, match, 'identifier', 95, undefined, undefined, { identifier: match[0] }),
    ),
    ...allMatches(input, /(?<![\p{L}\d])(?:https?:\/\/|www\.)[^\s<>]+/giu, (match) => {
      const raw = match[0].replace(/[.,!?;:]+$/u, '');
      return candidate(input, match, 'identifier', 120, undefined, undefined, { identifier: raw, url: true }, raw);
    },
    ),
    ...allMatches(input, /(?<![\p{L}\d])[\p{L}\d.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\d](?:[\p{L}\d-]*[\p{L}\d])?(?:\.[\p{L}\d](?:[\p{L}\d-]*[\p{L}\d])?)+(?![\p{L}\d])/giu, (match) =>
      candidate(input, match, 'identifier', 120, undefined, undefined, { identifier: match[0], email: true }),
    ),
    ...allMatches(input, /(?<![\p{L}\d])\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?(?![\p{L}\d])/gu, (match) =>
      candidate(input, match, 'ambiguous', 110, undefined, 'ISO timestamp потребує окремої політики читання часового поясу.'),
    ),
    ...allMatches(input, /(?<![\p{L}\d])(\d{1,2})\.(\d{1,2})\.(\d{4})(?![\p{L}\d])/gu, (match) => {
      const [, dayRaw = '', monthRaw = '', yearRaw = ''] = match;
      const day = Number(dayRaw), month = Number(monthRaw), year = Number(yearRaw);
      const valid = validIsoDate(year, month, day);
      return candidate(
        input,
        match,
        valid ? 'date' : 'ambiguous',
        100,
        valid ? spokenDate(year, month, day) : undefined,
        valid ? undefined : 'Некоректна дата у форматі ДД.ММ.РРРР.',
        { year, month, day },
      );
    }),
    ...allMatches(input, /(?<![\p{L}\d])\d{4}-\d{2}-\d{2}(?![\p{L}\d])/gu, (match) => {
      const [, yearRaw = '', monthRaw = '', dayRaw = ''] = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(match[0]) ?? [];
      const year = Number(yearRaw), month = Number(monthRaw), day = Number(dayRaw);
      const valid = validIsoDate(year, month, day);
      return candidate(
        input,
        match,
        valid ? 'date' : 'ambiguous',
        100,
        valid ? spokenDate(year, month, day) : undefined,
        valid ? undefined : 'Некоректна дата у форматі РРРР-ММ-ДД.',
        { year, month, day },
      );
    }),
    ...allMatches(input, /(?<![\p{L}\d])\d{1,2}:\d{1,2}(?![\p{L}\d])/gu, (match) => {
      const [hourRaw = '', minuteRaw = ''] = match[0].split(':');
      const hour = Number(hourRaw), minute = Number(minuteRaw);
      const valid = hour <= 23 && minute <= 59;
      const before = input.slice(Math.max(0, match.index - 18), match.index);
      const timeContext = /(?:о|об|годин|час(?:у|і)?)\s*$/iu.test(before);
      const ratioContext = /(?:рахунок|матч(?:у|і)?|результат|перемог(?:а|и|у))\s*$/iu.test(before);
      const asTime = valid && !ratioContext && (minuteRaw.length === 2 || timeContext);
      const asRatio = ratioContext || (!asTime && !timeContext);
      const kind: SemanticKind = asRatio ? 'ratio' : valid ? 'time' : 'ambiguous';
      return candidate(
        input,
        match,
        kind,
        90,
        kind === 'ambiguous' ? undefined : asRatio ? `${cardinal(hour)} на ${cardinal(minute)}` : spokenTime(hour, minute, timeContext),
        kind === 'ambiguous' ? 'Некоректний час у форматі ГГ:ХХ.' : undefined,
        { hour, minute },
      );
    }),
    // A zero-prefixed group after a digit and whitespace may be part of a grouped quantity (1 000), not an identifier.
    ...allMatches(input, /(?<![\p{L}\d])(?:[A-Za-zА-ЯІЇЄҐ]{1,8}-\d+[A-Za-zА-ЯІЇЄҐа-яіїєґ\d]*|(?<!\d\s)0\d{2,})(?![\p{L}\d])/gu, (match) =>
      candidate(
        input,
        match,
        'identifier',
        80,
        /^0\d/u.test(match[0])
          ? [...match[0]].map((digit) => ['нуль', 'один', 'два', 'три', 'чотири', "п'ять", 'шість', 'сім', 'вісім', "дев'ять"][Number(digit)]).join(' ')
          : undefined,
        undefined,
        { identifier: match[0], digits: match[0].replace(/\D/gu, ''), leadingZeros: /^0\d/u.test(match[0]) },
      ),
    ),
    ...allMatches(input, /(?<![\d.,/])(\d{1,9})\s*\/\s*(\d{1,9})(?![\d.,/])/gu, (match) => {
      const [, numeratorRaw = '', denominatorRaw = ''] = match;
      const numerator = Number(numeratorRaw), denominator = Number(denominatorRaw);
      const following = input.slice(match.index + match[0].length).trimStart();
      const isFraction = FRACTION_CONTEXT.test(following);
      if (isFraction && (denominator < 2 || numerator === 0))
        return candidate(input, match, 'ambiguous', 70, undefined, 'Дріб потребує редакторського прочитання.');
      if (numerator > 999_999_999 || denominator > 999_999_999)
        return candidate(input, match, 'ambiguous', 70, undefined, 'Чисельник або знаменник перевищує підтриманий діапазон.');
      const spoken = isFraction
        ? numerator === 1 && denominator === 2
          ? 'пів'
          : `${cardinal(numerator, 'f')} ${inflectOrdinal(ordinal(denominator), numerator === 1 ? 'fem' : 'plurLoc')}`
        : `${cardinal(numerator)} на ${cardinal(denominator)}`;
      return candidate(input, match, isFraction ? 'fraction' : 'ratio', 85, spoken, undefined, { numerator, denominator });
    }),
    ...allMatches(input, /(?<![\p{L}\d])\d+[.,]\d+(?![\p{L}\d])/gu, (match) => {
      const [whole = '0', fraction = ''] = match[0].split(/[.,]/u);
      const value = Number(whole);
      if (value > 999_999_999_999 || fraction.length > 6)
        return candidate(input, match, 'ambiguous', 40, undefined, 'Десятковий запис перевищує підтриманий діапазон точності.', { whole: value, fractionDigits: fraction });
      return candidate(input, match, 'decimal', 40, decimalWords(value, fraction), undefined, { whole: value, fractionDigits: fraction, separator: match[0].includes(',') ? ',' : '.' });
    },
    ),
    ...allMatches(input, /(?<![\p{L}\d])\d+(?:[.,]\d+)?\s*(?:км\/год|м\/с|мг\/кг|м²|км²|см²)(?![\p{L}\d])/giu, (match) =>
      (() => {
        const parsed = /^(\d+(?:[.,]\d+)?)\s*(.+)$/u.exec(match[0]);
        const amount = parsed?.[1];
        return candidate(
          input,
          match,
          'measure',
          50,
          undefined,
          undefined,
          amount ? { amount: Number(amount.replace(',', '.')), unit: parsed?.[2] ?? '' } : undefined,
        );
      })(),
    ),
  ];

  candidates.sort((a, b) => a.start - b.start || b.priority - a.priority || b.end - a.end);
  const accepted: SemanticSpan[] = [];
  let end = -1;
  for (const item of candidates) {
    if (item.start < end) continue;
    const span: SemanticSpan = {
      kind: item.kind,
      start: item.start,
      end: item.end,
      raw: item.raw,
      ...(item.value ? { value: item.value } : {}),
      ...(item.spoken === undefined ? {} : { spoken: item.spoken }),
      ...(item.reason === undefined ? {} : { reason: item.reason }),
    };
    accepted.push(Object.freeze(span));
    end = item.end;
  }
  return Object.freeze(accepted);
}
