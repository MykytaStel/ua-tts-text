/**
 * Нормалізація українського тексту для TTS: числа, роки, дати, відсотки,
 * одиниці, скорочення, пунктуація. Наголоси — окремий модуль (stress.ts).
 */

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

export interface NormalizeOptions {
  /** Розгортати «ст.», «тис.», «т.д.» тощо. */
  abbreviations?: boolean;
  /** Читати абревіатури по літерах (ЗСУ → зе-се-у). */
  acronyms?: boolean;
  /** Прибирати дужки, лапки, тире й двокрапки — TTS їх не читає, але спотикається. */
  punctuation?: boolean;
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

/** Protect strings whose spelling carries identity rather than a quantity. */
function protectSpeechAtoms(input: string): { text: string; restore: (text: string) => string } {
  const atoms: string[] = [];
  const token = (value: string) => {
    const id = atoms.push(value) - 1;
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
  for (const pattern of patterns) {
    text = text.replace(pattern, (match) => {
      const trail = /[.,!?;:…]+$/u.exec(match)?.[0] ?? '';
      const core = trail ? match.slice(0, -trail.length) : match;
      if (validDottedDate(core)) return match;
      if (pattern.source.includes('\\d{1,2}\\.') && !validDottedDate(core)) return token(match);
      return token(core) + trail;
    });
  }
  // Phones need an explicit dial string and at least nine digits; short grouped quantities stay numeric.
  text = text.replace(/(?<![\p{L}\d])\+?\d[\d ().-]{7,}\d(?![\p{L}\d])/gu, (match) => {
    const digits = match.replace(/\D/gu, '');
    const phoneLike = match.startsWith('+') || /[ ().-]/u.test(match) || (/^0/u.test(digits) && digits.length >= 10);
    return digits.length >= 9 && phoneLike ? token(match) : match;
  });
  return { text, restore: (value) => value.replace(/[\uE100-\uF9FF]/gu, (mark) => atoms[mark.codePointAt(0)! - 0xe100] ?? mark) };
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
function joinDigitGroups(text: string): string {
  return text.replace(/(\d)[\s\u00a0](?=\d{3}\b)/gu, '$1');
}

/** «2,8 млн» → 2800000: масштабні слова читаються повним числом, а не «дві цілих». */
function parseNumeric(raw: string): number | null {
  const normalized = raw.replace(/,/g, '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function readNumber(raw: string, gender: Gender = 'm'): string {
  if (raw.includes(',') || raw.includes('.')) {
    const [intPart = '0', fracPart = ''] = raw.split(/[.,]/u);
    return decimalWords(Number(intPart), fracPart);
  }
  return cardinal(Number(raw), gender);
}

const CURRENCIES: ReadonlyArray<readonly [string, { forms: readonly [string, string, string]; gender: Gender } | null]> = [
  ['грн', { forms: ['гривня', 'гривні', 'гривень'], gender: 'f' }],
  ['доларів', { forms: ['долар', 'долари', 'доларів'], gender: 'm' }],
  ['дол', { forms: ['долар', 'долари', 'доларів'], gender: 'm' }],
  ['євро', null],
];

/** «250 тис. грн.» → «двісті п'ятдесят тисяч гривень»: масштаб і валюта розгортаються разом. */
function expandScaledCurrency(text: string): string {
  const currencies = CURRENCIES.map(([c]) => escapeRe(c)).join('|');
  const re = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(тис\\.|млн\\.?|млрд\\.?)\\s*(${currencies})(?![\\p{L}\\d])`, 'giu');
  return text.replace(re, (match, rawNumber: string, scale: string, currencyRaw: string) => {
    const value = parseNumeric(rawNumber);
    if (value === null) return match;
    const unitScale = scale.replace(/\.$/u, '');
    const factor = unitScale === 'млрд' ? 1_000_000_000 : unitScale === 'млн' ? 1_000_000 : 1_000;
    const total = value * factor;
    if (Math.abs(total - Math.round(total)) > 1e-6) return match;
    const currency = CURRENCIES.find(([c]) => c === currencyRaw.replace(/\.$/u, ''));
    if (!currency) return match;
    const words = cardinal(Math.round(total), currency[1]?.gender ?? 'm');
    if (!currency[1]) return `${words} євро`;
    return `${words} ${pluralForm(Math.round(total), currency[1].forms)}`;
  });
}

function expandUnits(text: string): string {
  const names = [...UNITS].map(([u]) => escapeRe(u)).sort((a, b) => b.length - a.length);
  const re = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${names.join('|')})(?![\\p{L}\\d])`, 'giu');

  return text.replace(re, (match, rawNumber: string, unitRaw: string, offset: number, whole: string) => {
    const unit = UNITS.find(([u]) => u.toLowerCase() === unitRaw.toLowerCase());
    if (!unit) return match;
    const [, def] = unit;
    const value = parseNumeric(rawNumber);
    if (value === null) return match;
    const prefix = whole.slice(Math.max(0, offset - 24), offset);
    const trailingAbbreviationPeriod = unitRaw.endsWith('.') && whole.slice(offset + match.length).trim().length === 0 ? '.' : '';
    const genitiveContext = /(?:до|від)\s*$/iu.test(prefix);
    const genitive = def.genitiveSingular ?? def.forms[2];
    if (genitiveContext && Number.isInteger(value)) {
      return `${genitiveCardinal(value, def.gender)} ${value === 1 ? genitive : def.forms[2]}${trailingAbbreviationPeriod}`;
    }

    const base = unit[0].replace(/\.$/u, '');
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
  });
}

function expandPercent(text: string): string {
  return text.replace(/(\d+(?:[.,]\d+)?)\s*%/gu, (_m, raw: string) => {
    const value = parseNumeric(raw);
    if (value === null) return _m;
    const words = readNumber(raw, 'm');
    return `${words} ${pluralForm(value, ['відсоток', 'відсотки', 'відсотків'])}`;
  });
}

function expandYears(text: string): string {
  const re = /(\d{1,4})(?:-[а-яіїєґ]+)?\s*(року|році|рік|роках|роки|років|рр\.|р\.)/giu;
  return text.replace(re, (match, rawYear: string, noun: string, offset: number, whole: string) => {
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
  });
}

function expandYearRanges(text: string): string {
  return text.replace(
    /(\d{4})\s*[–—-]\s*(\d{4})\s*(роках|роками|роки|років|року|рр\.)/giu,
    (match, from: string, to: string, noun: string) => {
      return yearRangeWords(Number(from), Number(to), noun) ?? match;
    },
  );
}

/** «15–20 м/с» → «від п'ятнадцяти до двадцяти метрів за секунду». */
function expandRanges(text: string): string {
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

  return text.replace(re, (match, fromRaw: string, toRaw: string, unitRaw: string | undefined, offset: number, whole: string) => {
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
  });
}

function expandRomanCenturies(text: string): string {
  const values: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  const forms: Record<string, 'gen' | 'loc' | 'plurLoc'> = {
    століття: 'gen',
    столітті: 'loc',
    століть: 'plurLoc',
    'ст.': 'gen',
  };
  // \b не працює для кирилиці, тому межу перевіряємо lookbehind-ом.
  const re = /(?<![\p{L}])([IVXLC]{1,5})\s+(століття|столітті|століть|ст\.)/giu;
  return text.replace(re, (match, romanRaw: string, noun: string) => {
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
  });
}

const DIGITS_WORDS = ['нуль', 'один', 'два', 'три', 'чотири', "п'ять", 'шість', 'сім', 'вісім', "дев'ять"];

/** «1-го січня» → «першого січня». */
function expandOrdinalDates(text: string): string {
  return text.replace(/(\d{1,2})-го(?![\p{L}\d])/giu, (match, day: string) => {
    const value = Number(day);
    if (!Number.isFinite(value) || value < 1 || value > 31) return match;
    return inflectOrdinal(ordinal(value), 'gen');
  });
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
function expandOrdinalSuffixes(text: string): string {
  return text.replace(/(\d{1,3})-([а-яіїєґ]{1,3})(?![\p{L}\d])/giu, (match, raw: string, suffixRaw: string) => {
    const form = ORDINAL_SUFFIXES[suffixRaw.toLowerCase()];
    const value = Number(raw);
    if (!form || !Number.isFinite(value) || value < 1 || value > 999) return match;
    return inflectOrdinal(ordinal(value), form);
  });
}

/** «50/50» → «п'ятдесят на п'ятдесят». */
function expandRatios(text: string): string {
  return text.replace(/(?<![\d.,/])(\d{1,3})\s*\/\s*(\d{1,3})(?![\d.,/])/gu, (match, a: string, b: string) => {
    const left = Number(a);
    const right = Number(b);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return match;
    return `${cardinal(left)} на ${cardinal(right)}`;
  });
}

function expandDates(text: string): string {
  const dotted = /(\d{1,2})\.(\d{1,2})\.(\d{4})/gu;
  const withMonthName = new RegExp(
    `(\\d{1,2})\\s+(${Object.keys(MONTHS_GENITIVE).join('|')})(?:\\s+(\\d{4})(?:\\s+(?:року|р\\.))?)?`,
    'giu',
  );
  const dayWord = (day: number) => inflectOrdinal(ordinal(day), 'gen');

  const afterDotted = text.replace(dotted, (match, day: string, month: string, year: string) => {
    const monthIndex = Number(month) - 1;
    const monthWord = MONTHS_BY_NUMBER[monthIndex];
    if (monthWord === undefined || Number(day) < 1 || Number(day) > new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate())
      return match;
    const yearWord = yearWords(Number(year), 'року');
    return `${dayWord(Number(day))} ${monthWord}${yearWord ? ` ${yearWord}` : ''}`;
  });

  return afterDotted.replace(withMonthName, (match, day: string, month: string, year?: string) => {
    if (!year && (Number(day) < 1 || Number(day) > 31)) return match;
    if (
      year &&
      (Number(day) < 1 ||
        Number(day) > new Date(Date.UTC(Number(year), Object.keys(MONTHS_GENITIVE).indexOf(month.toLowerCase()) + 1, 0)).getUTCDate())
    )
      return match;
    const yearWord = year ? yearWords(Number(year), 'року') : null;
    return `${dayWord(Number(day))} ${month.toLowerCase()}${yearWord ? ` ${yearWord}` : ''}`;
  });
}

function expandAcronyms(text: string): string {
  const keys = Object.keys(ACRONYMS).sort((a, b) => b.length - a.length);
  const re = new RegExp(`(?<![\\p{L}])(${keys.join('|')})(?![\\p{L}])`, 'gu');
  return text.replace(re, (word) => ACRONYMS[word] ?? word);
}

function expandAbbreviations(text: string): string {
  let out = text;
  for (const [pattern, replacement] of ABBREVIATIONS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function cleanPunctuation(text: string): string {
  let out = text;
  out = out.replace(/[—–]/gu, ', ');
  out = out.replace(/\s*[:;]\s*/gu, ', ');
  out = out.replace(/…|\.{3,}/gu, '.');
  out = out.replace(/[«»"„“”()[\]]/gu, '');
  out = out.replace(/,\s*,+/gu, ', ');
  out = out.replace(/\s+([,.!?])/gu, '$1');
  out = out.replace(/([,.!?])(?=[^\s,.!?])/gu, '$1 ');
  out = out.replace(/\s+/gu, ' ');
  out = out.replace(/^[\s,]+/u, '');
  out = out.replace(/,\s*([.!?])/gu, '$1');
  return out.trim();
}

/**
 * Головна функція: готує текст до синтезу.
 * Порядок важливий — від найдовших конструкцій до окремих чисел.
 */
export function normalize(input: string, options: NormalizeOptions = {}): string {
  const { abbreviations = true, acronyms = true, punctuation = true } = options;

  const protectedInput = protectSpeechAtoms(input.normalize('NFC'));
  let text = protectedInput.text;
  text = text.replace(/[\u00a0\u202f]/gu, ' ');
  text = text.replace(/[’ʼ`´]/gu, "'");
  text = joinDigitGroups(text);

  text = expandOrdinalDates(text);
  text = expandOrdinalSuffixes(text);
  text = expandDates(text);
  text = expandRatios(text);
  text = expandYearRanges(text);
  text = expandRanges(text);
  text = expandYears(text);
  text = expandRomanCenturies(text);
  text = expandPercent(text);
  text = expandScaledCurrency(text);
  text = expandUnits(text);

  if (abbreviations) text = expandAbbreviations(text);
  if (acronyms) text = expandAcronyms(text);

  text = text.replace(/(\d+)\s*№|№\s*(\d+)/gu, (_m, a?: string, b?: string) => `номер ${a ?? b}`);
  text = text.replace(/(\d+(?:[.,]\d+)?)/gu, (match, ...rest: unknown[]) => {
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
  });

  if (punctuation) text = cleanPunctuation(text);
  return protectedInput.restore(text);
}
