/**
 * Нормалізація українського тексту для TTS: числа, роки, дати, відсотки,
 * одиниці, скорочення, пунктуація. Наголоси — окремий модуль (stress.ts).
 */

import { createHash } from 'node:crypto';
import {
  cardinal,
  decimalWords,
  genitiveCardinal,
  inflectOrdinal,
  ordinal,
  pluralForm,
  type OrdinalForm,
  yearRangeWords,
  yearWords,
  type Gender,
} from './numbers.js';
import type { NormalizationRuleApplication, NormalizationRules } from './normalization-rules.js';
import { scanSemanticSpans, type SemanticKind } from './semantic.js';

export interface NormalizeOptions {
  /** Розгортати «ст.», «тис.», «т.д.» тощо. */
  abbreviations?: boolean;
  /** Читати абревіатури по літерах (ЗСУ → зе-се-у). */
  acronyms?: boolean;
  /** Прибирати дужки, лапки, тире й двокрапки — TTS їх не читає, але спотикається. */
  punctuation?: boolean;
  /** Verified project-specific literal readings; null disables resource-provided rules. */
  rules?: NormalizationRules | null;
}

export type NormalizationTraceStage =
  | 'unicode'
  | 'project-rule'
  | 'time'
  | 'fraction'
  | 'digit-groups'
  | 'ordinal-date'
  | 'ordinal'
  | 'date'
  | 'ratio'
  | 'year-range'
  | 'range'
  | 'year'
  | 'century'
  | 'percent'
  | 'currency'
  | 'unit'
  | 'abbreviation'
  | 'acronym'
  | 'identifier'
  | 'number'
  | 'ambiguous'
  | 'manual-correction'
  | 'punctuation';

export interface NormalizationTraceStep {
  readonly stage: NormalizationTraceStage;
  /** The matched fragment before this pass. */
  readonly before: string;
  readonly after: string;
  readonly explanation: string;
  readonly source?: string;
  /** UTF-16 range in the original input that produced this change. */
  readonly sourceStart?: number;
  readonly sourceEnd?: number;
}

export interface NormalizeTraceResult {
  readonly text: string;
  /** Verified custom-rule occurrences in application order. Kept for compatibility with 0.18 consumers. */
  readonly ruleApplications: ReadonlyArray<NormalizationRuleApplication>;
  /** Every changed matched fragment in normalization order, including custom rules and built-in passes. */
  readonly steps: ReadonlyArray<NormalizationTraceStep>;
}

export interface NormalizationAlignmentSegment {
  /** UTF-16 range in the original input. */
  readonly sourceStart: number;
  readonly sourceEnd: number;
  /** UTF-16 range in NormalizeAlignmentResult.text. */
  readonly spokenStart: number;
  readonly spokenEnd: number;
  readonly sourceText: string;
  readonly spokenText: string;
  readonly changed: boolean;
  readonly stage?: NormalizationTraceStage;
}

export interface NormalizeAlignmentResult extends NormalizeTraceResult {
  /** Fingerprint of the exact source, normalized output, and rule options. */
  readonly fingerprint: string;
  /** Output segments mapped back to the exact source occurrence that produced them. */
  readonly alignment: ReadonlyArray<NormalizationAlignmentSegment>;
  /** Number of saved occurrence corrections applied to this result. */
  readonly correctionsApplied: number;
}

export interface NormalizeAlignmentOptions extends NormalizeOptions {
  /** Saved corrections made against a matching uncorrected normalization fingerprint. */
  readonly corrections?: NormalizationCorrectionSet;
}

export interface NormalizationCorrectionDraft {
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly spokenStart: number;
  readonly spokenEnd: number;
  readonly replacement: string;
  readonly source?: string;
}

export interface NormalizationCorrection {
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly sourceText: string;
  readonly spokenStart: number;
  readonly spokenEnd: number;
  readonly expectedSpokenText: string;
  readonly replacement: string;
  readonly source?: string;
}

export interface NormalizationCorrectionSet {
  readonly format: 'ua-tts-text-normalization-corrections';
  readonly version: 1;
  readonly fingerprint: string;
  readonly corrections: ReadonlyArray<NormalizationCorrection>;
}

interface SourceOrigin {
  readonly start: number;
  readonly end: number;
  readonly stage?: NormalizationTraceStage;
}

interface SourceReplacement {
  readonly start: number;
  readonly length: number;
  readonly outputLength: number;
  readonly stage?: NormalizationTraceStage;
  readonly sourceStart: number;
  readonly sourceEnd: number;
}

/**
 * Tracks source provenance while the existing normalization passes replace text.
 * The map is only allocated by trace/alignment APIs, leaving normalize() unchanged.
 */
class NormalizationSourceMap {
  readonly #original: string;
  #origins: SourceOrigin[];

  constructor(original: string, normalized: string) {
    this.#original = original;
    this.#origins = [];
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    for (const { segment, index } of segmenter.segment(original)) {
      const normalizedSegment = segment.normalize('NFC');
      const stage = normalizedSegment === segment ? undefined : 'unicode';
      for (let i = 0; i < normalizedSegment.length; i += 1) {
        this.#origins.push({
          start: index,
          end: index + segment.length,
          ...(stage ? { stage } : {}),
        });
      }
    }
    if (this.#origins.length !== normalized.length)
      throw new Error('normalize: source map could not align NFC text');
  }

  range(start: number, length: number): { start: number; end: number } {
    let sourceStart = Number.POSITIVE_INFINITY;
    let sourceEnd = Number.NEGATIVE_INFINITY;
    const end = Math.min(start + length, this.#origins.length);
    for (let i = Math.max(0, start); i < end; i += 1) {
      const origin = this.#origins[i]!;
      sourceStart = Math.min(sourceStart, origin.start);
      sourceEnd = Math.max(sourceEnd, origin.end);
    }
    if (sourceStart === Number.POSITIVE_INFINITY) {
      const boundary = this.#origins[start]?.start ?? this.#origins[start - 1]?.end ?? 0;
      return { start: boundary, end: boundary };
    }
    return { start: sourceStart, end: sourceEnd };
  }

  stage(start: number, length: number): NormalizationTraceStage | undefined {
    const first = this.#origins[start]?.stage;
    if (first === undefined) return undefined;
    for (let i = start + 1; i < start + length; i += 1)
      if (this.#origins[i]?.stage !== first) return undefined;
    return first;
  }

  replace(start: number, length: number, outputLength: number, stage?: NormalizationTraceStage): void {
    const range = this.range(start, length);
    const resolvedStage = stage ?? this.stage(start, length);
    this.apply([{
      start,
      length,
      outputLength,
      ...(resolvedStage ? { stage: resolvedStage } : {}),
      sourceStart: range.start,
      sourceEnd: range.end,
    }]);
  }

  apply(replacements: readonly SourceReplacement[]): void {
    if (replacements.length === 0) return;
    const previous = this.#origins;
    const next: SourceOrigin[] = [];
    let cursor = 0;
    for (const replacement of [...replacements].sort((a, b) => a.start - b.start)) {
      if (replacement.start < cursor) throw new Error('normalize: overlapping source map replacements');
      for (let i = cursor; i < replacement.start; i += 1) next.push(previous[i]!);
      const stage = replacement.stage ?? this.stage(replacement.start, replacement.length);
      for (let i = 0; i < replacement.outputLength; i += 1) {
        next.push({
          start: replacement.sourceStart,
          end: replacement.sourceEnd,
          ...(stage ? { stage } : {}),
        });
      }
      cursor = replacement.start + replacement.length;
    }
    for (let i = cursor; i < previous.length; i += 1) next.push(previous[i]!);
    this.#origins = next;
  }

  get origins(): ReadonlyArray<SourceOrigin> {
    return this.#origins;
  }

  sourceText(start: number, end: number): string {
    return this.#original.slice(start, end);
  }
}

const SOURCE_MAPS = new WeakMap<NormalizationTraceStep[], NormalizationSourceMap>();

function replaceOffset(args: readonly unknown[]): number {
  const offset = args.find((arg): arg is number => typeof arg === 'number');
  return offset ?? 0;
}

const STAGE_EXPLANATIONS: Record<NormalizationTraceStage, string> = {
  unicode: 'Уніфіковано Unicode, пробіл або апостроф.',
  'project-rule': 'Застосовано перевірене проєктне правило читання.',
  time: 'Час розпізнано як окремий часовий запис.',
  fraction: 'Дріб прочитано за чисельником і контекстом.',
  'digit-groups': 'Об’єднано групи цифр у числі.',
  'ordinal-date': 'Порядковий номер дати розгорнуто словами.',
  ordinal: 'Порядкове число розгорнуто словами.',
  date: 'Календарну дату розгорнуто словами.',
  ratio: 'Числове співвідношення розгорнуто словами.',
  'year-range': 'Діапазон років розгорнуто словами.',
  range: 'Числовий діапазон розгорнуто словами.',
  year: 'Рік або тривалість розгорнуто словами.',
  century: 'Римський номер століття розгорнуто словами.',
  percent: 'Відсоток узгоджено з числом.',
  currency: 'Суму з масштабом і валютою розгорнуто словами.',
  unit: 'Число узгоджено з назвою одиниці.',
  abbreviation: 'Скорочення розгорнуто словами.',
  acronym: 'Абревіатуру розгорнуто для читання.',
  identifier: 'Позначення номера розгорнуто словами.',
  number: 'Число розгорнуто словами.',
  ambiguous: 'Фрагмент лишився без однозначного прочитання.',
  'manual-correction': 'Застосовано збережене виправлення конкретного входження.',
  punctuation: 'Пунктуацію пристосовано до синтезу.',
};

function addTraceStep(
  steps: NormalizationTraceStep[] | undefined,
  stage: NormalizationTraceStage,
  before: string,
  after: string,
  source?: string,
  sourceRange?: { start: number; end: number },
): void {
  if (!steps || before === after) return;
  steps.push(Object.freeze({
    stage,
    before,
    after,
    explanation: STAGE_EXPLANATIONS[stage],
    ...(source ? { source } : {}),
    ...(sourceRange ? { sourceStart: sourceRange.start, sourceEnd: sourceRange.end } : {}),
  }));
}

function replaceWithTrace<Args extends unknown[]>(
  text: string,
  pattern: RegExp,
  replacer: (match: string, ...args: Args) => string,
  steps: NormalizationTraceStep[] | undefined,
  stage: NormalizationTraceStage,
): string {
  if (!steps) return text.replace(pattern, replacer);
  const sourceMap = SOURCE_MAPS.get(steps);
  const replacements: SourceReplacement[] = [];
  const output = text.replace(pattern, (match, ...args) => {
    const after = replacer(match, ...(args as Args));
    const offset = replaceOffset(args);
    const sourceRange = sourceMap?.range(offset, match.length);
    addTraceStep(steps, stage, match, after, undefined, sourceRange);
    if (sourceMap && after !== match)
      replacements.push({
        start: offset,
        length: match.length,
        outputLength: after.length,
        stage,
        sourceStart: sourceRange?.start ?? offset,
        sourceEnd: sourceRange?.end ?? offset + match.length,
      });
    return after;
  });
  if (sourceMap) {
    sourceMap.apply(replacements);
  }
  return output;
}

const MONTHS_GENITIVE: Record<string, string> = {
  січня: 'січня',
  лютого: 'лютого',
  березня: 'березня',
  квітня: 'квітня',
  травня: 'травня',
  червня: 'червня',
  липня: 'липня',
  серпня: 'серпня',
  вересня: 'вересня',
  жовтня: 'жовтня',
  листопада: 'листопада',
  грудня: 'грудня',
};

const MONTHS_BY_NUMBER = [
  'січня',
  'лютого',
  'березня',
  'квітня',
  'травня',
  'червня',
  'липня',
  'серпня',
  'вересня',
  'жовтня',
  'листопада',
  'грудня',
];

interface UnitDef {
  forms: readonly [string, string, string];
  gender: Gender;
  genitiveSingular?: string;
}

/** Одиниці, після яких слово узгоджується з числом. */
const UNITS: ReadonlyArray<readonly [string, UnitDef]> = [
  ['км/год', { forms: ['кілометр за годину', 'кілометри за годину', 'кілометрів за годину'], gender: 'm', genitiveSingular: 'кілометра за годину' }],
  ['мг/кг', { forms: ['міліграм на кілограм', 'міліграми на кілограм', 'міліграмів на кілограм'], gender: 'm', genitiveSingular: 'міліграма на кілограм' }],
  ['м²', { forms: ['метр квадратний', 'метри квадратні', 'метрів квадратних'], gender: 'm', genitiveSingular: 'метра квадратного' }],
  ['км²', { forms: ['кілометр квадратний', 'кілометри квадратні', 'кілометрів квадратних'], gender: 'm', genitiveSingular: 'кілометра квадратного' }],
  ['см²', { forms: ['сантиметр квадратний', 'сантиметри квадратні', 'сантиметрів квадратних'], gender: 'm', genitiveSingular: 'сантиметра квадратного' }],
  ['км', { forms: ['кілометр', 'кілометри', 'кілометрів'], gender: 'm', genitiveSingular: 'кілометра' }],
  ['см', { forms: ['сантиметр', 'сантиметри', 'сантиметрів'], gender: 'm', genitiveSingular: 'сантиметра' }],
  ['мм', { forms: ['міліметр', 'міліметри', 'міліметрів'], gender: 'm', genitiveSingular: 'міліметра' }],
  ['кг', { forms: ['кілограм', 'кілограми', 'кілограмів'], gender: 'm', genitiveSingular: 'кілограма' }],
  ['мг', { forms: ['міліграм', 'міліграми', 'міліграмів'], gender: 'm', genitiveSingular: 'міліграма' }],
  ['га', { forms: ['гектар', 'гектари', 'гектарів'], gender: 'm', genitiveSingular: 'гектара' }],
  ['грн.', { forms: ['гривня', 'гривні', 'гривень'], gender: 'f', genitiveSingular: 'гривні' }],
  ['грн', { forms: ['гривня', 'гривні', 'гривень'], gender: 'f' }],
  ['°C', { forms: ['градус', 'градуси', 'градусів'], gender: 'm', genitiveSingular: 'градуса' }],
  ['°', { forms: ['градус', 'градуси', 'градусів'], gender: 'm', genitiveSingular: 'градуса' }],
  ['шт.', { forms: ['штука', 'штуки', 'штук'], gender: 'f', genitiveSingular: 'штуки' }],
  ['млрд.', { forms: ['мільярд', 'мільярди', 'мільярдів'], gender: 'm', genitiveSingular: 'мільярда' }],
  ['млрд', { forms: ['мільярд', 'мільярди', 'мільярдів'], gender: 'm', genitiveSingular: 'мільярда' }],
  ['млн.', { forms: ['мільйон', 'мільйони', 'мільйонів'], gender: 'm', genitiveSingular: 'мільйона' }],
  ['млн', { forms: ['мільйон', 'мільйони', 'мільйонів'], gender: 'm', genitiveSingular: 'мільйона' }],
  ['тис.', { forms: ['тисяча', 'тисячі', 'тисяч'], gender: 'f', genitiveSingular: 'тисячі' }],
  ['т', { forms: ['тонна', 'тонни', 'тонн'], gender: 'f', genitiveSingular: 'тонни' }],
  ['м/с', { forms: ['метр за секунду', 'метри за секунду', 'метрів за секунду'], gender: 'm', genitiveSingular: 'метра за секунду' }],
  ['м', { forms: ['метр', 'метри', 'метрів'], gender: 'm', genitiveSingular: 'метра' }],
  ['г', { forms: ['грам', 'грами', 'грамів'], gender: 'm', genitiveSingular: 'грама' }],
  ['л', { forms: ['літр', 'літри', 'літрів'], gender: 'm', genitiveSingular: 'літра' }],
];

// Ключі без крапки: база обчислюється як unit[0].replace(/\.$/, '').
const SCALE_UNITS = new Set(['млн', 'млрд', 'тис']);

const ABBREVIATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  // \b не працює для кирилиці: у JS він спирається на ASCII-межі слів.
  [/(?<![\p{L}])і\s+т\.\s*д\./giu, 'і так далі'],
  [/(?<![\p{L}])і\s+т\.\s*п\./giu, 'і тому подібне'],
  [/(?<![\p{L}])т\.\s*д\./giu, 'так далі'],
  [/(?<![\p{L}])т\.\s*п\./giu, 'тощо'],
  [/(?<![\p{L}])т\.\s*зв\./giu, 'так званий'],
  [/(?<![\p{L}])напр\./giu, 'наприклад'],
  [/(?<![\p{L}])до\s+н\.\s*е\./giu, 'до нашої ери'],
  [/(?<![\p{L}])н\.\s*е\./giu, 'нашої ери'],
  [/(?<![\p{L}])ст\.\s*н\.\s*е\./giu, 'століття нашої ери'],
];

const ACRONYMS: Readonly<Record<string, string>> = {
  ЗСУ: 'зе-се-у',
  СБУ: 'ес-бе-у',
  ООН: 'о-он',
  НАТО: 'нато',
  НАН: 'ен-а-ен',
  США: 'ес-ша-а',
  ЄС: 'є-ес',
  ВРУ: 'ве-ер-у',
  МВФ: 'ем-ве-еф',
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function semanticStage(kind: SemanticKind): NormalizationTraceStage | undefined {
  if (kind === 'date') return 'date';
  if (kind === 'time') return 'time';
  if (kind === 'fraction') return 'fraction';
  if (kind === 'ratio') return 'ratio';
  if (kind === 'identifier') return 'identifier';
  if (kind === 'decimal') return 'number';
  return undefined;
}

function addSemanticTrace(
  steps: NormalizationTraceStep[] | undefined,
  stage: NormalizationTraceStage | undefined,
  span: { raw: string; spoken?: string; start: number; end: number },
): void {
  if (!steps || !stage || !span.spoken || span.raw === span.spoken) return;
  const sourceRange = SOURCE_MAPS.get(steps)?.range(span.start, span.end - span.start);
  steps.push(Object.freeze({
    stage,
    before: span.raw,
    after: span.spoken,
    explanation: STAGE_EXPLANATIONS[stage],
    ...(sourceRange ? { sourceStart: sourceRange.start, sourceEnd: sourceRange.end } : {}),
  }));
}

function replaceWithMappedTokens(
  text: string,
  pattern: RegExp,
  replacer: (match: string, ...args: unknown[]) => string,
  traceSteps: NormalizationTraceStep[] | undefined,
  stage?: NormalizationTraceStage,
): string {
  const sourceMap = traceSteps ? SOURCE_MAPS.get(traceSteps) : undefined;
  const replacements: SourceReplacement[] = [];
  const output = text.replace(pattern, (match, ...args) => {
    const after = replacer(match, ...args);
    if (sourceMap && after !== match) {
      const offset = replaceOffset(args);
      const sourceRange = sourceMap.range(offset, match.length);
      replacements.push({
        start: offset,
        length: match.length,
        outputLength: after.length,
        ...(stage ? { stage } : {}),
        sourceStart: sourceRange.start,
        sourceEnd: sourceRange.end,
      });
    }
    return after;
  });
  sourceMap?.apply(replacements);
  return output;
}

/** Protect strings whose spelling carries identity rather than a quantity. */
function protectSpeechAtoms(
  input: string,
  rules?: NormalizationRules | null,
  traceSteps?: NormalizationTraceStep[],
): {
  text: string;
  restore: (text: string) => string;
  ruleApplications?: ReadonlyArray<NormalizationRuleApplication>;
} {
  const sourceMap = traceSteps ? SOURCE_MAPS.get(traceSteps) : undefined;
  const atoms: string[] = [];
  const token = (value: string, spoken = value) => {
    const id = atoms.push(spoken) - 1;
    if (id >= 0x1900) throw new RangeError('normalize: too many protected strings');
    // A private-use scalar cannot be mistaken for a number by later passes.
    return String.fromCodePoint(0xe100 + id);
  };
  const patterns = [
    /(?<![\p{L}\d])v?\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?(?![\p{L}\d])/giu,
    /(?<![\p{L}\d])[\p{L}\d.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\d](?:[\p{L}\d-]*[\p{L}\d])?(?:\.[\p{L}\d](?:[\p{L}\d-]*[\p{L}\d])?)+(?![\p{L}\d])/giu,
    /(?<![\p{L}\d])(?:https?:\/\/|www\.)[^\s<>]+/giu,
    /(?<![\p{L}\d])\d{1,2}\.\d{1,2}\.\d{4}(?![\p{L}\d])/gu,
  ];
  let text = input;
  const semanticSpans = scanSemanticSpans(input);
  const customSpanTokens = new Map<number, string>();
  const earlyRuleApplications: NormalizationRuleApplication[] = [];
  for (const span of semanticSpans) {
    const exactRule = rules?.explain(span.raw);
    if (exactRule?.status === 'verified' && rules) {
      const applied = rules.applyWithTrace(span.raw, token);
      if (applied.applications.length > 0) {
        customSpanTokens.set(span.start, applied.text);
        earlyRuleApplications.push(...applied.applications);
        for (const application of applied.applications) {
          const sourceRange = sourceMap?.range(span.start, span.end - span.start);
          addTraceStep(traceSteps, 'project-rule', application.matched, application.replacement, application.source, sourceRange);
        }
        continue;
      }
    }
    if (span.kind === 'decimal' || span.kind === 'measure') continue;
    addSemanticTrace(traceSteps, semanticStage(span.kind), span);
  }
  for (const span of [...semanticSpans].reverse()) {
    const customToken = customSpanTokens.get(span.start);
    if (!customToken && (span.kind === 'decimal' || span.kind === 'measure')) continue;
    const replacement = customToken ?? token(span.raw, span.spoken ?? span.raw);
    const stage = customToken
      ? 'project-rule'
      : semanticStage(span.kind) ?? (span.kind === 'ambiguous' ? 'ambiguous' : undefined);
    text = text.slice(0, span.start) + replacement + text.slice(span.end);
    sourceMap?.replace(span.start, span.end - span.start, replacement.length, stage);
  }
  for (const [index, pattern] of patterns.entries()) {
    text = replaceWithMappedTokens(text, pattern, (match) => {
      const trail = /[.,!?;:…]+$/u.exec(match)?.[0] ?? '';
      const core = trail ? match.slice(0, -trail.length) : match;
      if (validDottedDate(core)) return match;
      if (pattern.source.includes('\\d{1,2}\\.') && !validDottedDate(core)) return token(match);
      return token(core) + trail;
    }, traceSteps, index < 3 ? 'identifier' : 'date');
  }
  // Phones need an explicit dial string and at least nine digits; short grouped quantities stay numeric.
  text = replaceWithMappedTokens(text, /(?<![\p{L}\d])\+?\d[\d ().-]{7,}\d(?![\p{L}\d])/gu, (match) => {
    const digits = match.replace(/\D/gu, '');
    const phoneLike = match.startsWith('+') || /[ ().-]/u.test(match) || (/^0/u.test(digits) && digits.length >= 10);
    return digits.length >= 9 && phoneLike ? token(match) : match;
  }, traceSteps, 'identifier');
  let ruleApplications: ReadonlyArray<NormalizationRuleApplication> | undefined;
  if (rules && traceSteps) {
    const positions: Array<{ start: number; end: number }> = [];
    const result = rules.applyWithTrace(text, token, (_application, start, end) => {
      positions.push({ start, end });
    });
    text = result.text;
    ruleApplications = Object.freeze([...earlyRuleApplications, ...result.applications]);
    for (const [index, application] of result.applications.entries()) {
      const position = positions[index];
      const start = position?.start ?? 0;
      const end = position?.end ?? start + application.matched.length;
      const sourceRange = sourceMap?.range(start, end - start);
      addTraceStep(traceSteps, 'project-rule', application.matched, application.replacement, application.source, sourceRange);
    }
    if (sourceMap) {
      for (const position of [...positions].reverse()) {
        const { start, end } = position;
        sourceMap.replace(start, end - start, 1, 'project-rule');
      }
    }
  } else if (rules) {
    text = rules.apply(text, token);
  }
  return {
    text,
    restore: (value) => replaceWithMappedTokens(
      value,
      /[\uE100-\uF9FF]/gu,
      (mark) => atoms[mark.codePointAt(0)! - 0xe100] ?? mark,
      traceSteps,
    ),
    ...(traceSteps ? { ruleApplications: ruleApplications ?? Object.freeze([]) } : {}),
  };
}

function validDottedDate(value: string): boolean {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/u.exec(value);
  if (!match) return false;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1]!;
}

/** «24 251» → «24251»: пробіл усередині числа ламає читання. */
function joinDigitGroups(text: string, steps?: NormalizationTraceStep[]): string {
  return replaceWithTrace(text, /(\d)[\s\u00a0](?=\d{3}\b)/gu, (match, digit: string) => digit, steps, 'digit-groups');
}

/** «2,8 млн» → 2800000: масштабні слова читаються повним числом, а не «дві цілих». */
function parseNumeric(raw: string): number | null {
  const normalized = raw.replace(/[−]/gu, '-').replace(/,/g, '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function readNumber(raw: string, gender: Gender = 'm'): string {
  raw = raw.replace(/−/gu, '-');
  if (raw.includes(',') || raw.includes('.')) {
    const [intPart = '0', fracPart = ''] = raw.split(/[.,]/u);
    return decimalWords(Number(intPart), fracPart);
  }
  return cardinal(Number(raw), gender);
}

/** Genitive numerals ending in one take a singular noun, except for 11–19. */
function genitiveNounForm(value: number, singular: string, plural: string): string {
  return value % 10 === 1 && value % 100 !== 11 ? singular : plural;
}

/** Speak a fractional UAH amount as hryvnias and kopecks, matching its two-decimal currency scale. */
function hryvniaAmountWords(raw: string, genitive = false): string | null {
  const match = /^([−-]?)(\d+)[.,](\d{1,2})$/u.exec(raw);
  if (!match) return null;
  const [, sign, majorRaw, minorRaw] = match;
  const major = Number(majorRaw);
  if (!Number.isSafeInteger(major) || major > 999_999_999_999 || (genitive && major > 999_999)) return null;

  const minor = Number(minorRaw!.padEnd(2, '0'));
  const majorWords = genitive ? genitiveCardinal(major, 'f') : cardinal(major, 'f');
  const majorNoun = genitive
    ? genitiveNounForm(major, 'гривні', 'гривень')
    : pluralForm(major, ['гривня', 'гривні', 'гривень']);
  const minorWords = genitive ? genitiveCardinal(minor, 'f') : cardinal(minor, 'f');
  const minorNoun = genitive
    ? genitiveNounForm(minor, 'копійки', 'копійок')
    : pluralForm(minor, ['копійка', 'копійки', 'копійок']);
  const amount = `${majorWords} ${majorNoun}${minor > 0 ? ` ${minorWords} ${minorNoun}` : ''}`;
  return `${sign ? 'мінус ' : ''}${amount}`;
}

/** Speak fractional USD/EUR values as major currency plus cents. */
function foreignCurrencyAmountWords(raw: string, symbol: '$' | '€', genitive = false): string | null {
  const match = /^([−-]?)(\d+)[.,](\d{1,2})$/u.exec(raw);
  if (!match) return null;
  const [, sign, majorRaw, minorRaw] = match;
  const major = Number(majorRaw);
  if (!Number.isSafeInteger(major) || major > 999_999_999_999 || (genitive && major > 999_999)) return null;

  const minor = Number(minorRaw!.padEnd(2, '0'));
  const majorGender: Gender = symbol === '€' ? 'n' : 'm';
  const majorWords = genitive ? genitiveCardinal(major, majorGender) : cardinal(major, majorGender);
  const majorNoun = symbol === '€'
    ? 'євро'
    : genitive
      ? genitiveNounForm(major, 'долара', 'доларів')
      : pluralForm(major, ['долар', 'долари', 'доларів']);
  const minorWords = genitive ? genitiveCardinal(minor, 'm') : cardinal(minor, 'm');
  const minorNoun = genitive
    ? genitiveNounForm(minor, 'цента', 'центів')
    : pluralForm(minor, ['цент', 'центи', 'центів']);
  const amount = `${majorWords} ${majorNoun}${minor > 0 ? ` ${minorWords} ${minorNoun}` : ''}`;
  return `${sign ? 'мінус ' : ''}${amount}`;
}

const CURRENCIES: ReadonlyArray<readonly [string, { forms: readonly [string, string, string]; gender: Gender } | null]> = [
  ['грн', { forms: ['гривня', 'гривні', 'гривень'], gender: 'f' }],
  ['доларів', { forms: ['долар', 'долари', 'доларів'], gender: 'm' }],
  ['дол', { forms: ['долар', 'долари', 'доларів'], gender: 'm' }],
  ['євро', null],
];

function expandSymbolCurrency(text: string, steps?: NormalizationTraceStep[]): string {
  return replaceWithTrace(text, /(\$|€|₴)\s*(\d+(?:[.,]\d+)?)(?![\p{L}\d])|(?<![\p{L}\d])(\d+(?:[.,]\d+)?)\s*(\$|€|₴)/gu,
    (match, leading: string | undefined, leadingNumber: string | undefined, trailingNumber: string | undefined, trailing: string | undefined, offset: number, whole: string) => {
      const symbol = leading ?? trailing;
      const raw = leadingNumber ?? trailingNumber;
      if (!symbol || !raw) return match;
      const value = parseNumeric(raw);
      if (value === null) return match;
      if (symbol === '₴') {
        const before = whole.slice(Math.max(0, offset - 24), offset);
        const amount = hryvniaAmountWords(raw, /(?:до|від)\s*$/iu.test(before));
        if (amount) return amount;
      } else if (symbol === '$' || symbol === '€') {
        const before = whole.slice(Math.max(0, offset - 24), offset);
        const amount = foreignCurrencyAmountWords(raw, symbol, /(?:до|від)\s*$/iu.test(before));
        if (amount) return amount;
      }
      const gender: Gender = symbol === '₴' ? 'f' : symbol === '€' ? 'n' : 'm';
      const words = readNumber(raw, gender);
      const unit = symbol === '$'
        ? pluralForm(value, ['долар', 'долари', 'доларів'])
        : symbol === '₴'
          ? pluralForm(value, ['гривня', 'гривні', 'гривень'])
          : 'євро';
      return `${words} ${unit}`;
    }, steps, 'currency');
}

/** «250 тис. грн.» → «двісті п'ятдесят тисяч гривень»: масштаб і валюта розгортаються разом. */
function expandScaledCurrency(text: string, steps?: NormalizationTraceStep[]): string {
  const currencies = CURRENCIES.map(([c]) => escapeRe(c)).join('|');
  const re = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(тис\\.|млн\\.?|млрд\\.?)\\s*(${currencies})(?![\\p{L}\\d])`, 'giu');
  return replaceWithTrace(text, re, (match, rawNumber: string, scale: string, currencyRaw: string) => {
    const value = parseNumeric(rawNumber);
    if (value === null) return match;
    const unitScale = scale.replace(/\.$/u, '');
    const factor = unitScale === 'млрд' ? 1_000_000_000 : unitScale === 'млн' ? 1_000_000 : 1_000;
    const total = value * factor;
    if (Math.abs(total - Math.round(total)) > 1e-6) return match;
    const currency = CURRENCIES.find(([c]) => c === currencyRaw.replace(/\.$/u, ''));
    if (!currency) return match;
    const words = cardinal(Math.round(total), currency[1]?.gender ?? 'n');
    if (!currency[1]) return `${words} євро`;
    return `${words} ${pluralForm(Math.round(total), currency[1].forms)}`;
  }, steps, 'currency');
}

function expandUnits(text: string, steps?: NormalizationTraceStep[]): string {
  const names = [...UNITS].map(([u]) => escapeRe(u)).sort((a, b) => b.length - a.length);
  const re = new RegExp(`([−-]?\\d+(?:[.,]\\d+)?)\\s*(${names.join('|')})(?![\\p{L}\\d])`, 'giu');

  return replaceWithTrace(text, re, (match, rawNumber: string, unitRaw: string, offset: number, whole: string) => {
    const unit = UNITS.find(([u]) => u.toLowerCase() === unitRaw.toLowerCase());
    if (!unit) return match;
    const [, def] = unit;
    const value = parseNumeric(rawNumber);
    if (value === null) return match;
    const prefix = whole.slice(Math.max(0, offset - 24), offset);
    const trailingAbbreviationPeriod = unitRaw.endsWith('.') && whole.slice(offset + match.length).trim().length === 0 ? '.' : '';
    const genitiveContext = /(?:до|від)\s*$/iu.test(prefix);
    const base = unit[0].replace(/\.$/u, '');
    if (base === 'грн' && /[.,]/u.test(rawNumber)) {
      const amount = hryvniaAmountWords(rawNumber, genitiveContext);
      if (amount) return `${amount}${trailingAbbreviationPeriod}`;
    }
    const genitive = def.genitiveSingular ?? def.forms[2];
    if (genitiveContext && Number.isInteger(value)) {
      return `${genitiveCardinal(value, def.gender)} ${value === 1 ? genitive : def.forms[2]}${trailingAbbreviationPeriod}`;
    }

    if (SCALE_UNITS.has(base)) {
      const factor = base === 'млрд' ? 1_000_000_000 : base === 'млн' ? 1_000_000 : 1_000;
      const scaled = value * factor;
      if (value < 1000 && Math.abs(scaled - Math.round(scaled)) < 1e-6) {
        return `${cardinal(Math.round(scaled), def.gender)}${trailingAbbreviationPeriod}`;
      }
    }

    if (!Number.isInteger(value)) {
      return `${readNumber(rawNumber, def.gender)} ${genitive}${trailingAbbreviationPeriod}`;
    }
    return `${cardinal(value, def.gender)} ${pluralForm(value, def.forms)}${trailingAbbreviationPeriod}`;
  }, steps, 'unit');
}

function expandPercent(text: string, steps?: NormalizationTraceStep[]): string {
  return replaceWithTrace(text, /(\d+(?:[.,]\d+)?)\s*%/gu, (_m, raw: string) => {
    const value = parseNumeric(raw);
    if (value === null) return _m;
    const forms = ['відсоток', 'відсотки', 'відсотків'] as const;
    const decimal = /^(\d+)[.,](\d+)$/u.exec(raw);
    if (decimal) {
      const integer = Number(decimal[1]);
      const fraction = decimal[2] ?? '';
      if (Number(fraction) === 0) return `${cardinal(integer)} ${pluralForm(integer, forms)}`;
      return `${readNumber(raw, 'm')} відсотка`;
    }
    return `${cardinal(value)} ${pluralForm(value, forms)}`;
  }, steps, 'percent');
}

function expandNegativeNumbers(text: string, steps?: NormalizationTraceStep[]): string {
  return replaceWithTrace(text, /(?<![\p{L}\d])[−-]\d+(?:[.,]\d+)?(?![\p{L}\d])/gu, (match) => readNumber(match.replace(/−/gu, '-')), steps, 'number');
}

function expandYears(text: string, steps?: NormalizationTraceStep[]): string {
  const re = /(\d{1,4})(?:-[а-яіїєґ]+)?\s*(року|році|рік|роках|роки|років|рр\.|р\.)/giu;
  return replaceWithTrace(text, re, (match, rawYear: string, noun: string, offset: number, whole: string) => {
    const year = Number(rawYear);
    if (!Number.isFinite(year) || year > 2999) return match;
    // «5 р.», «за 4 роки» — це тривалість, а не «п'ятий рік» чи «четверті роки».
    const quantityNouns = new Set(['р.', 'рр.', 'років', 'роки', 'року', 'рік']);
    const prefix = whole.slice(Math.max(0, offset - 36), offset);
    const durationContext = /(?:за|через|протягом|минуло|тривалістю)\s*$/iu.test(prefix);
    const calendarContext = noun.toLowerCase() === 'року' && (year >= 100 || /(?:у|в|на|з)\s*$/iu.test(prefix));
    if (!calendarContext && (year < 1000 || durationContext) && quantityNouns.has(noun.toLowerCase())) {
      return `${cardinal(year)} ${pluralForm(year, ['рік', 'роки', 'років'])}`;
    }
    const nounForm = noun === 'р.' ? 'року' : noun === 'рр.' ? 'роках' : noun;
    return yearWords(year, nounForm) ?? match;
  }, steps, 'year');
}

function expandYearRanges(text: string, steps?: NormalizationTraceStep[]): string {
  return replaceWithTrace(
    text,
    /(\d{4})\s*[–—-]\s*(\d{4})\s*(роках|роками|роки|років|року|рр\.)/giu,
    (match, from: string, to: string, noun: string) => {
      return yearRangeWords(Number(from), Number(to), noun) ?? match;
    },
    steps,
    'year-range',
  );
}

/** «15–20 м/с» → «від п'ятнадцяти до двадцяти метрів за секунду». */
function expandRanges(text: string, steps?: NormalizationTraceStep[]): string {
  const units = [...UNITS]
    .map(([u]) => escapeRe(u))
    .sort((a, b) => b.length - a.length)
    .join('|');
  const months = Object.keys(MONTHS_GENITIVE).join('|');
  const re = new RegExp(
    `(?<![\\d.,])(\\d{1,4})\\s*[–—-]\\s*(\\d{1,4})(?:\\s*(${units}))?(?![\\p{L}\\d])` +
      `(?!\\s*(?:${months}|року|році|роках|років|роки|р\\.|ст\\.))`,
    'gu',
  );

  return replaceWithTrace(text, re, (match, fromRaw: string, toRaw: string, unitRaw: string | undefined, offset: number, whole: string) => {
    const from = Number(fromRaw);
    const to = Number(toRaw);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return match;
    const unit = unitRaw ? UNITS.find(([u]) => u.toLowerCase() === unitRaw.toLowerCase()) : undefined;
    const gender = unit?.[1].gender ?? 'm';
    const trailingAbbreviationPeriod =
      !!unitRaw && unitRaw.endsWith('.') && whole.slice(offset + match.length).trim().length === 0 ? '.' : '';
    const head = `від ${genitiveCardinal(from, gender)} до ${genitiveCardinal(to, gender)}`;
    if (!unitRaw) return head;
    if (!unit) return `${head} ${unitRaw}`;
    // Після «від … до …» іменник стоїть у родовому множини: «до семи кілометрів».
    return `${head} ${to === 1 ? (unit[1].genitiveSingular ?? unit[1].forms[2]) : unit[1].forms[2]}${trailingAbbreviationPeriod}`;
  }, steps, 'range');
}

function expandRomanCenturies(text: string, steps?: NormalizationTraceStep[]): string {
  const values: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  const forms: Record<string, 'gen' | 'loc' | 'plurLoc'> = {
    століття: 'gen',
    столітті: 'loc',
    століть: 'plurLoc',
    'ст.': 'gen',
  };
  // \b не працює для кирилиці, тому межу перевіряємо lookbehind-ом.
  const re = /(?<![\p{L}])([IVXLC]{1,5})\s+(століття|столітті|століть|ст\.)/giu;
  return replaceWithTrace(text, re, (match, romanRaw: string, noun: string) => {
    const roman = romanRaw.toUpperCase();
    let total = 0;
    for (let i = 0; i < roman.length; i += 1) {
      const current = values[roman[i]!];
      const next = values[roman[i + 1] ?? ''];
      if (current === undefined) return match;
      total += next !== undefined && next > current ? -current : current;
    }
    const form = forms[noun.toLowerCase()];
    if (!form) return match;
    return `${inflectOrdinal(ordinal(total), form)} ${noun}`;
  }, steps, 'century');
}

const DIGITS_WORDS = ['нуль', 'один', 'два', 'три', 'чотири', "п'ять", 'шість', 'сім', 'вісім', "дев'ять"];

/** «1-го січня» → «першого січня». */
function expandOrdinalDates(text: string, steps?: NormalizationTraceStep[]): string {
  return replaceWithTrace(text, /(\d{1,2})-го(?![\p{L}\d])/giu, (match, day: string) => {
    const value = Number(day);
    if (!Number.isFinite(value) || value < 1 || value > 31) return match;
    return inflectOrdinal(ordinal(value), 'gen');
  }, steps, 'ordinal-date');
}

const ORDINAL_SUFFIXES: Readonly<Record<string, OrdinalForm>> = {
  й: 'nom',
  го: 'gen',
  ого: 'gen',
  му: 'loc',
  ому: 'loc',
  га: 'fem',
  а: 'fem',
  я: 'fem',
  ге: 'neut',
  е: 'neut',
  є: 'neut',
  гі: 'plurNom',
  і: 'plurNom',
  их: 'plurLoc',
  // «3-тє», «3-ті», «3-тя» — це «третє», «треті», «третя»: «т» належить основі.
  тє: 'neut',
  те: 'neut',
  ті: 'plurNom',
  тя: 'fem',
};

/** «5-й поверх» → «п'ятий поверх», «2-га черга» → «друга черга». */
function expandOrdinalSuffixes(text: string, steps?: NormalizationTraceStep[]): string {
  return replaceWithTrace(text, /(\d{1,3})-([а-яіїєґ]{1,3})(?![\p{L}\d])/giu, (match, raw: string, suffixRaw: string) => {
    const form = ORDINAL_SUFFIXES[suffixRaw.toLowerCase()];
    const value = Number(raw);
    if (!form || !Number.isFinite(value) || value < 1 || value > 999) return match;
    return inflectOrdinal(ordinal(value), form);
  }, steps, 'ordinal');
}

/** «50/50» → «п'ятдесят на п'ятдесят». */
function expandRatios(text: string, steps?: NormalizationTraceStep[]): string {
  return replaceWithTrace(text, /(?<![\d.,/])(\d{1,3})\s*\/\s*(\d{1,3})(?![\d.,/])/gu, (match, a: string, b: string) => {
    const left = Number(a);
    const right = Number(b);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return match;
    return `${cardinal(left)} на ${cardinal(right)}`;
  }, steps, 'ratio');
}

function expandDates(text: string, steps?: NormalizationTraceStep[]): string {
  const dotted = /(\d{1,2})\.(\d{1,2})\.(\d{4})/gu;
  const withMonthName = new RegExp(
    `(\\d{1,2})\\s+(${Object.keys(MONTHS_GENITIVE).join('|')})(?:\\s+(\\d{4})(?:\\s+(?:року|р\\.))?)?`,
    'giu',
  );
  const dayWord = (day: number) => inflectOrdinal(ordinal(day), 'gen');

  const afterDotted = replaceWithTrace(text, dotted, (match, day: string, month: string, year: string) => {
    const monthIndex = Number(month) - 1;
    const monthWord = MONTHS_BY_NUMBER[monthIndex];
    if (monthWord === undefined || Number(day) < 1 || Number(day) > new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate())
      return match;
    const yearWord = yearWords(Number(year), 'року');
    return `${dayWord(Number(day))} ${monthWord}${yearWord ? ` ${yearWord}` : ''}`;
  }, steps, 'date');

  return replaceWithTrace(afterDotted, withMonthName, (match, day: string, month: string, year?: string) => {
    if (!year && (Number(day) < 1 || Number(day) > 31)) return match;
    if (
      year &&
      (Number(day) < 1 ||
        Number(day) > new Date(Date.UTC(Number(year), Object.keys(MONTHS_GENITIVE).indexOf(month.toLowerCase()) + 1, 0)).getUTCDate())
    )
      return match;
    const yearWord = year ? yearWords(Number(year), 'року') : null;
    return `${dayWord(Number(day))} ${month.toLowerCase()}${yearWord ? ` ${yearWord}` : ''}`;
  }, steps, 'date');
}

function expandAcronyms(text: string, steps?: NormalizationTraceStep[]): string {
  const keys = Object.keys(ACRONYMS).sort((a, b) => b.length - a.length);
  const re = new RegExp(`(?<![\\p{L}])(${keys.join('|')})(?![\\p{L}])`, 'gu');
  return replaceWithTrace(text, re, (word) => ACRONYMS[word] ?? word, steps, 'acronym');
}

function expandAbbreviations(text: string, steps?: NormalizationTraceStep[]): string {
  let out = text;
  for (const [pattern, replacement] of ABBREVIATIONS) {
    out = replaceWithTrace(out, pattern, () => replacement, steps, 'abbreviation');
  }
  return out;
}

function cleanPunctuation(text: string, steps?: NormalizationTraceStep[]): string {
  let out = text;
  out = replaceWithTrace(out, /[—–]/gu, () => ', ', steps, 'punctuation');
  out = replaceWithTrace(out, /\s*[:;]\s*/gu, () => ', ', steps, 'punctuation');
  out = replaceWithTrace(out, /…|\.{3,}/gu, () => '.', steps, 'punctuation');
  out = replaceWithTrace(out, /[«»"„“”()[\]]/gu, () => '', steps, 'punctuation');
  out = replaceWithTrace(out, /,\s*,+/gu, () => ', ', steps, 'punctuation');
  out = replaceWithTrace(out, /\s+([,.!?])/gu, (_match, punctuation: string) => punctuation, steps, 'punctuation');
  out = replaceWithTrace(out, /([,.!?])(?=[^\s,.!?])/gu, (match) => `${match} `, steps, 'punctuation');
  out = replaceWithTrace(out, /\s+/gu, () => ' ', steps, 'punctuation');
  out = replaceWithTrace(out, /^[\s,]+/u, () => '', steps, 'punctuation');
  out = replaceWithTrace(out, /,\s*([.!?])/gu, (_match, punctuation: string) => punctuation, steps, 'punctuation');
  out = replaceWithTrace(out, /^\s+|\s+$/gu, () => '', steps, 'punctuation');
  return out;
}

/**
 * Головна функція: готує текст до синтезу.
 * Порядок важливий — від найдовших конструкцій до окремих чисел.
 */
function normalizeInternal(input: string, options: NormalizeOptions, steps: NormalizationTraceStep[]): NormalizeTraceResult;
function normalizeInternal(input: string, options: NormalizeOptions, steps?: undefined): string;
function normalizeInternal(
  input: string,
  options: NormalizeOptions,
  steps?: NormalizationTraceStep[],
): string | NormalizeTraceResult {
  const { abbreviations = true, acronyms = true, punctuation = true } = options;

  let source = input.normalize('NFC');
  if (steps) SOURCE_MAPS.set(steps, new NormalizationSourceMap(input, source));
  addTraceStep(steps, 'unicode', input, source, undefined, { start: 0, end: input.length });
  source = replaceWithTrace(source, /[\u00a0\u202f]/gu, () => ' ', steps, 'unicode');
  source = replaceWithTrace(source, /[’ʼ`´]/gu, () => "'", steps, 'unicode');
  const protectedInput = protectSpeechAtoms(source, options.rules, steps);
  let text = protectedInput.text;
  text = joinDigitGroups(text, steps);

  text = expandOrdinalDates(text, steps);
  text = expandOrdinalSuffixes(text, steps);
  text = expandDates(text, steps);
  text = expandRatios(text, steps);
  text = expandYearRanges(text, steps);
  text = expandRanges(text, steps);
  text = expandYears(text, steps);
  text = expandRomanCenturies(text, steps);
  text = expandPercent(text, steps);
  text = expandSymbolCurrency(text, steps);
  text = expandScaledCurrency(text, steps);
  text = expandUnits(text, steps);
  text = expandNegativeNumbers(text, steps);

  if (abbreviations) text = expandAbbreviations(text, steps);
  if (acronyms) text = expandAcronyms(text, steps);

  text = replaceWithTrace(text, /(\d+)\s*№|№\s*(\d+)/gu, (_m, a?: string, b?: string) => `номер ${a ?? b}`, steps, 'identifier');
  text = replaceWithTrace(text, /(\d+(?:[.,]\d+)?)/gu, (match, ...rest: unknown[]) => {
    const offset = rest[rest.length - 2] as number;
    const whole = rest[rest.length - 1] as string;
    const before = whole[offset - 1] ?? '';
    const after = whole[offset + match.length] ?? '';
    // «iPhone 15» і «S24»: цифри, приклеєні до латинки, не чіпаємо — їх має побачити звіт.
    if (/[A-Za-z]/u.test(before) || /[A-Za-z]/u.test(after)) return match;
    // Довгі послідовності (телефони, коди) читаємо по цифрах, а не як мільйони.
    if (match.replace(/\D/gu, '').length >= 9) {
      return [...match.replace(/\D/gu, '')].map((digit) => DIGITS_WORDS[Number(digit)]!).join(' ');
    }
    return readNumber(match);
  }, steps, 'number');

  if (punctuation) text = cleanPunctuation(text, steps);
  const normalized = protectedInput.restore(text);
  if (!steps) return normalized;
  return Object.freeze({ text: normalized, ruleApplications: protectedInput.ruleApplications!, steps: Object.freeze(steps) });
}

export function normalize(input: string, options: NormalizeOptions = {}): string {
  return normalizeInternal(input, options);
}

/** Normalize text and report each changed fragment, stage, and configured rule source. */
export function normalizeWithTrace(input: string, options: NormalizeOptions = {}): NormalizeTraceResult {
  return normalizeInternal(input, options, []);
}

function alignmentSegments(
  text: string,
  sourceMap: NormalizationSourceMap,
): ReadonlyArray<NormalizationAlignmentSegment> {
  const origins = sourceMap.origins;
  if (origins.length !== text.length) throw new Error('normalizeWithAlignment: source map length mismatch');
  const segments: NormalizationAlignmentSegment[] = [];
  let spokenStart = 0;
  while (spokenStart < text.length) {
    const first = origins[spokenStart]!;
    let sourceStart = first.start;
    let sourceEnd = first.end;
    const stage = first.stage;
    const textClass = stage === undefined ? alignmentTextClass(text[spokenStart]!) : undefined;
    let spokenEnd = spokenStart + 1;
    while (spokenEnd < text.length) {
      const previous = origins[spokenEnd - 1]!;
      const current = origins[spokenEnd]!;
      const sameSourceSpan = current.start === previous.start && current.end === previous.end;
      const adjacentSourceSpans = current.start === previous.end;
      if (current.stage !== stage || (!sameSourceSpan && !adjacentSourceSpans)) break;
      if (textClass !== undefined && alignmentTextClass(text[spokenEnd]!) !== textClass) break;
      sourceStart = Math.min(sourceStart, current.start);
      sourceEnd = Math.max(sourceEnd, current.end);
      spokenEnd += 1;
    }
    const sourceText = sourceMap.sourceText(sourceStart, sourceEnd);
    const spokenText = text.slice(spokenStart, spokenEnd);
    segments.push(Object.freeze({
      sourceStart,
      sourceEnd,
      spokenStart,
      spokenEnd,
      sourceText,
      spokenText,
      changed: sourceText !== spokenText,
      ...(stage ? { stage } : {}),
    }));
    spokenStart = spokenEnd;
  }
  return Object.freeze(segments);
}

function alignmentTextClass(character: string): 'word' | 'space' | 'punctuation' {
  if (/\s/u.test(character)) return 'space';
  if (/[\p{L}\p{M}\p{N}'’ʼ+\-]/u.test(character)) return 'word';
  return 'punctuation';
}

const CORRECTION_FORMAT = 'ua-tts-text-normalization-corrections';

function normalizationFingerprint(input: string, normalizedText: string, options: NormalizeOptions): string {
  return createHash('sha256')
    .update(JSON.stringify({
      format: 'ua-tts-text-normalization-fingerprint',
      version: 1,
      input,
      normalizedText,
      options: {
        abbreviations: options.abbreviations ?? true,
        acronyms: options.acronyms ?? true,
        punctuation: options.punctuation ?? true,
        rules: options.rules?.fingerprint ?? null,
      },
    }))
    .digest('hex');
}

function correctionKey(correction: Pick<NormalizationCorrection, 'sourceStart' | 'sourceEnd' | 'spokenStart' | 'spokenEnd'>): string {
  return [correction.sourceStart, correction.sourceEnd, correction.spokenStart, correction.spokenEnd].join(':');
}

function validateCorrectionText(text: string): void {
  if (typeof text !== 'string' || text.length === 0 || text.length > 512 || text !== text.trim())
    throw new Error('normalizeWithAlignment: correction must be a non-empty, trimmed phrase of at most 512 UTF-16 units');
  if (/[\u0000-\u001f\u007f-\u009f\ue100-\uf9ff]/u.test(text))
    throw new Error('normalizeWithAlignment: correction contains a control or reserved character');
}

function assertNonOverlappingCorrections(corrections: readonly NormalizationCorrection[]): void {
  const bySource = [...corrections].sort((a, b) => a.sourceStart - b.sourceStart);
  const bySpoken = [...corrections].sort((a, b) => a.spokenStart - b.spokenStart);
  for (let i = 1; i < bySource.length; i += 1) {
    if (bySource[i]!.sourceStart < bySource[i - 1]!.sourceEnd)
      throw new Error('normalizeWithAlignment: corrections overlap in the source text');
  }
  for (let i = 1; i < bySpoken.length; i += 1) {
    if (bySpoken[i]!.spokenStart < bySpoken[i - 1]!.spokenEnd)
      throw new Error('normalizeWithAlignment: corrections overlap in the normalized text');
  }
}

/** Create a serializable, occurrence-specific correction set from selected alignment segments. */
export function createNormalizationCorrectionSet(
  result: NormalizeAlignmentResult,
  drafts: ReadonlyArray<NormalizationCorrectionDraft>,
): NormalizationCorrectionSet {
  if (result.correctionsApplied !== 0)
    throw new Error('createNormalizationCorrectionSet: start from an uncorrected alignment result');
  if (!Array.isArray(drafts))
    throw new TypeError('createNormalizationCorrectionSet: corrections must be an array');
  if (drafts.length > 1000) throw new RangeError('createNormalizationCorrectionSet: at most 1000 corrections are supported');
  const corrections = drafts.map((draft) => {
    if (!draft || !Number.isInteger(draft.sourceStart) || !Number.isInteger(draft.sourceEnd) ||
        !Number.isInteger(draft.spokenStart) || !Number.isInteger(draft.spokenEnd))
      throw new Error('createNormalizationCorrectionSet: malformed correction range');
    const matches = result.alignment.filter((segment) =>
      segment.sourceStart === draft.sourceStart &&
      segment.sourceEnd === draft.sourceEnd &&
      segment.spokenStart === draft.spokenStart &&
      segment.spokenEnd === draft.spokenEnd,
    );
    if (matches.length !== 1)
      throw new Error('createNormalizationCorrectionSet: source/spoken range does not identify one segment at ' + draft.sourceStart);
    const segment = matches[0]!;
    validateCorrectionText(draft.replacement);
    if (draft.replacement === segment.spokenText)
      throw new Error('createNormalizationCorrectionSet: replacement is unchanged at source offset ' + draft.sourceStart);
    if (draft.source !== undefined &&
        (typeof draft.source !== 'string' || draft.source.length > 256 || draft.source.trim() !== draft.source))
      throw new Error('createNormalizationCorrectionSet: source label must be trimmed and at most 256 UTF-16 units');
    return Object.freeze({
      sourceStart: segment.sourceStart,
      sourceEnd: segment.sourceEnd,
      sourceText: segment.sourceText,
      spokenStart: segment.spokenStart,
      spokenEnd: segment.spokenEnd,
      expectedSpokenText: segment.spokenText,
      replacement: draft.replacement,
      ...(draft.source ? { source: draft.source } : {}),
    });
  });
  assertNonOverlappingCorrections(corrections);
  return Object.freeze({
    format: CORRECTION_FORMAT,
    version: 1,
    fingerprint: result.fingerprint,
    corrections: Object.freeze(corrections),
  });
}

function validateCorrectionSet(
  result: NormalizeAlignmentResult,
  set: NormalizationCorrectionSet,
): ReadonlyArray<NormalizationCorrection> {
  if (!set || set.format !== CORRECTION_FORMAT || set.version !== 1 || !Array.isArray(set.corrections))
    throw new Error('normalizeWithAlignment: unsupported correction set format');
  if (set.fingerprint !== result.fingerprint)
    throw new Error('normalizeWithAlignment: saved corrections are stale for this text or rule set');
  if (set.corrections.length > 1000)
    throw new RangeError('normalizeWithAlignment: at most 1000 corrections are supported');
  for (const correction of set.corrections) {
    if (!correction || !Number.isInteger(correction.sourceStart) || !Number.isInteger(correction.sourceEnd) ||
        !Number.isInteger(correction.spokenStart) || !Number.isInteger(correction.spokenEnd) ||
        correction.sourceStart < 0 || correction.sourceEnd <= correction.sourceStart ||
        correction.spokenStart < 0 || correction.spokenEnd <= correction.spokenStart ||
        typeof correction.sourceText !== 'string' || typeof correction.expectedSpokenText !== 'string')
      throw new Error('normalizeWithAlignment: malformed saved correction');
    validateCorrectionText(correction.replacement);
    if (correction.source !== undefined &&
        (typeof correction.source !== 'string' || correction.source.length > 256 || correction.source.trim() !== correction.source))
      throw new Error('normalizeWithAlignment: saved correction has an invalid source label');
    const matches = result.alignment.filter((segment) =>
      segment.sourceStart === correction.sourceStart &&
      segment.sourceEnd === correction.sourceEnd &&
      segment.spokenStart === correction.spokenStart &&
      segment.spokenEnd === correction.spokenEnd &&
      segment.sourceText === correction.sourceText &&
      segment.spokenText === correction.expectedSpokenText,
    );
    if (matches.length !== 1)
      throw new Error('normalizeWithAlignment: saved correction is stale at source offset ' + correction.sourceStart);
    if (correction.replacement === correction.expectedSpokenText)
      throw new Error('normalizeWithAlignment: saved correction has no effect at source offset ' + correction.sourceStart);
  }
  assertNonOverlappingCorrections(set.corrections);
  return set.corrections;
}

function applyNormalizationCorrections(
  result: NormalizeAlignmentResult,
  set: NormalizationCorrectionSet,
): NormalizeAlignmentResult {
  const corrections = validateCorrectionSet(result, set);
  if (corrections.length === 0) return result;
  let text = result.text;
  for (const correction of [...corrections].sort((a, b) => b.spokenStart - a.spokenStart))
    text = text.slice(0, correction.spokenStart) + correction.replacement + text.slice(correction.spokenEnd);

  const bySegment = new Map(corrections.map((correction) => [correctionKey(correction), correction]));
  const alignment = result.alignment.map((segment) => {
    const correction = bySegment.get(correctionKey(segment));
    const shift = corrections.reduce((total, item) =>
      item.spokenEnd <= segment.spokenStart
        ? total + item.replacement.length - (item.spokenEnd - item.spokenStart)
        : total,
    0);
    const spokenStart = segment.spokenStart + shift;
    if (correction) {
      return Object.freeze({
        ...segment,
        spokenStart,
        spokenEnd: spokenStart + correction.replacement.length,
        spokenText: correction.replacement,
        changed: segment.sourceText !== correction.replacement,
        stage: 'manual-correction' as const,
      });
    }
    return Object.freeze({
      ...segment,
      spokenStart,
      spokenEnd: segment.spokenEnd + shift,
    });
  });
  const correctionSteps = corrections.map((correction) => Object.freeze({
    stage: 'manual-correction' as const,
    before: correction.expectedSpokenText,
    after: correction.replacement,
    explanation: STAGE_EXPLANATIONS['manual-correction'],
    ...(correction.source ? { source: correction.source } : {}),
    sourceStart: correction.sourceStart,
    sourceEnd: correction.sourceEnd,
  }));
  return Object.freeze({
    ...result,
    text,
    alignment: Object.freeze(alignment),
    correctionsApplied: corrections.length,
    steps: Object.freeze([...result.steps, ...correctionSteps]),
  });
}

/**
 * Normalize text and map each output segment to the exact source occurrence
 * that produced it. Offsets in both strings are UTF-16, like JavaScript slicing.
 */
export function normalizeWithAlignment(input: string, options: NormalizeAlignmentOptions = {}): NormalizeAlignmentResult {
  const { corrections, ...normalizeOptions } = options;
  const steps: NormalizationTraceStep[] = [];
  const result = normalizeInternal(input, normalizeOptions, steps);
  const sourceMap = SOURCE_MAPS.get(steps);
  if (!sourceMap) throw new Error('normalizeWithAlignment: source map unavailable');
  const aligned = Object.freeze({
    ...result,
    fingerprint: normalizationFingerprint(input, result.text, normalizeOptions),
    alignment: alignmentSegments(result.text, sourceMap),
    correctionsApplied: 0,
  });
  return corrections ? applyNormalizationCorrections(aligned, corrections) : aligned;
}
