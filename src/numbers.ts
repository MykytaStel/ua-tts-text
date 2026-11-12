/**
 * Числа словами українською: кількісні, порядкові (з відмінками) і десяткові.
 * Без залежностей — усе, що потрібно TTS-фронтенду.
 */

export type Gender = 'm' | 'f' | 'n';
export type OrdinalForm = 'nom' | 'gen' | 'loc' | 'plurNom' | 'plurLoc';

const ONES_M = ['', 'один', 'два', 'три', 'чотири', "п'ять", 'шість', 'сім', 'вісім', "дев'ять"];
const ONES_F = ['', 'одна', 'дві', 'три', 'чотири', "п'ять", 'шість', 'сім', 'вісім', "дев'ять"];
const ONES_N = ['', 'одне', 'два', 'три', 'чотири', "п'ять", 'шість', 'сім', 'вісім', "дев'ять"];
const ONES: Record<Gender, string[]> = { m: ONES_M, f: ONES_F, n: ONES_N };

const TEENS = [
  'десять',
  'одинадцять',
  'дванадцять',
  'тринадцять',
  'чотирнадцять',
  "п'ятнадцять",
  'шістнадцять',
  'сімнадцять',
  'вісімнадцять',
  "дев'ятнадцять",
];

const TENS = [
  '',
  '',
  'двадцять',
  'тридцять',
  'сорок',
  "п'ятдесят",
  'шістдесят',
  'сімдесят',
  'вісімдесят',
  "дев'яносто",
];

const HUNDREDS = [
  '',
  'сто',
  'двісті',
  'триста',
  'чотириста',
  "п'ятсот",
  'шістсот',
  'сімсот',
  'вісімсот',
  "дев'ятсот",
];

interface Scale {
  one: string;
  few: string;
  many: string;
  gender: Gender;
  value: number;
}

const SCALES: Scale[] = [
  { one: 'мільярд', few: 'мільярди', many: 'мільярдів', gender: 'm', value: 1_000_000_000 },
  { one: 'мільйон', few: 'мільйони', many: 'мільйонів', gender: 'm', value: 1_000_000 },
  { one: 'тисяча', few: 'тисячі', many: 'тисяч', gender: 'f', value: 1_000 },
];

/** Українське узгодження: 1 → one, 2–4 → few, 11–14 і 5+ → many. */
export function pluralForm(n: number, forms: readonly [string, string, string]): string {
  const abs = Math.abs(Math.trunc(n));
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

function under1000(n: number, gender: Gender): string {
  const out: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) out.push(HUNDREDS[hundreds]!);
  if (rest >= 10 && rest < 20) {
    out.push(TEENS[rest - 10]!);
  } else {
    const tens = Math.floor(rest / 10);
    const ones = rest % 10;
    if (tens > 0) out.push(TENS[tens]!);
    if (ones > 0) out.push(ONES[gender][ones]!);
  }
  return out.join(' ');
}

/** Кількісне число словами: 1675 → «тисяча шістсот сімдесят п'ять». */
export function cardinal(value: number, gender: Gender = 'm'): string {
  if (!Number.isFinite(value)) throw new RangeError('cardinal: not a finite number');
  const n = Math.trunc(value);
  if (n === 0) return 'нуль';
  if (n < 0) return `мінус ${cardinal(-n, gender)}`;
  if (n > 999_999_999_999) throw new RangeError('cardinal: number is too large');

  const out: string[] = [];
  let rest = n;

  for (const scale of SCALES) {
    const count = Math.floor(rest / scale.value);
    if (count === 0) continue;
    rest %= scale.value;
    if (scale.value === 1_000 && count === 1) {
      out.push('тисяча');
      continue;
    }
    out.push(`${under1000(count, scale.gender)} ${pluralForm(count, [scale.one, scale.few, scale.many])}`);
  }

  if (rest > 0) out.push(under1000(rest, gender));
  return out.join(' ');
}

const ORD_ONES = ['', 'перший', 'другий', 'третій', 'четвертий', "п'ятий", 'шостий', 'сьомий', 'восьмий', "дев'ятий"];
const ORD_TEENS = [
  'десятий',
  'одинадцятий',
  'дванадцятий',
  'тринадцятий',
  'чотирнадцятий',
  "п'ятнадцятий",
  'шістнадцятий',
  'сімнадцятий',
  'вісімнадцятий',
  "дев'ятнадцятий",
];
const ORD_TENS = [
  '',
  '',
  'двадцятий',
  'тридцятий',
  'сороковий',
  "п'ятдесятий",
  'шістдесятий',
  'сімдесятий',
  'вісімдесятий',
  "дев'яностий",
];
const ORD_HUNDREDS = [
  '',
  'сотий',
  'двохсотий',
  'трьохсотий',
  'чотирьохсотий',
  "п'ятисотий",
  'шестисотий',
  'семисотий',
  'восьмисотий',
  "дев'ятисотий",
];

const THOUSAND_ORD: Record<number, string> = {
  1: 'тисячний',
  2: 'двохтисячний',
  3: 'трьохтисячний',
  4: 'чотирьохтисячний',
  5: "п'ятитисячний",
  6: 'шеститисячний',
  7: 'семисотисячний',
  8: 'восьмитисячний',
  9: "дев'ятитисячний",
  10: 'десятитисячний',
};

function ordUnder1000(n: number): string {
  if (n === 0) return 'нульовий';
  if (n < 10) return ORD_ONES[n]!;
  if (n < 20) return ORD_TEENS[n - 10]!;
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    // 21 → «двадцять перший», а не «двадцятий перший».
    return ones === 0 ? ORD_TENS[tens]! : `${TENS[tens]} ${ORD_ONES[ones]}`;
  }
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (rest === 0) return ORD_HUNDREDS[hundreds]!;
  return `${cardinal(hundreds * 100)} ${ordUnder1000(rest)}`;
}

/** Порядкове число, чоловічий рід, називний: 2026 → «дві тисячі двадцять шостий». */
export function ordinal(value: number): string {
  const n = Math.trunc(value);
  if (n < 0) throw new RangeError('ordinal: negative numbers are not supported');
  if (n < 1000) return ordUnder1000(n);

  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;

  if (rest === 0) {
    const fixed = THOUSAND_ORD[thousands];
    if (fixed) return fixed;
    return `${cardinal(thousands, 'f').replace(/ одна$/, '')}тисячний`;
  }

  const prefix =
    thousands === 1 ? 'тисяча' : `${cardinal(thousands, 'f')} ${pluralForm(thousands, ['тисяча', 'тисячі', 'тисяч'])}`;
  return `${prefix} ${ordUnder1000(rest)}`;
}

/** Відмінювання порядкового чоловічого роду: «двадцять шостий» → «двадцять шостого». */
export function inflectOrdinal(masculine: string, form: OrdinalForm): string {
  if (form === 'nom') return masculine;
  if (masculine.endsWith('ій')) {
    const base = masculine.slice(0, -2);
    const endings = { gen: 'ього', loc: 'ьому', plurNom: 'і', plurLoc: 'іх' } as const;
    return base + endings[form];
  }
  if (masculine.endsWith('ий')) {
    const base = masculine.slice(0, -2);
    const endings = { gen: 'ого', loc: 'ому', plurNom: 'і', plurLoc: 'их' } as const;
    return base + endings[form];
  }
  return masculine;
}

const YEAR_FORMS: Record<string, OrdinalForm> = {
  року: 'gen',
  рік: 'nom',
  році: 'loc',
  роках: 'plurLoc',
  роки: 'plurNom',
  років: 'plurLoc',
  'р.': 'gen',
  'рр.': 'plurLoc',
};

/** «у 1675 році» → «у тисяча шістсот сімдесят п'ятому році». */
export function yearWords(year: number, noun: string): string | null {
  const form = YEAR_FORMS[noun.toLowerCase()];
  if (!form) return null;
  return `${inflectOrdinal(ordinal(year), form)} ${noun}`;
}

const FRACTION_SCALES: Record<number, readonly [string, string, string]> = {
  1: ['десята', 'десяті', 'десятих'],
  2: ['сота', 'соті', 'сотих'],
  3: ['тисячна', 'тисячні', 'тисячних'],
  4: ['десятитисячна', 'десятитисячні', 'десятитисячних'],
  5: ['стотисячна', 'стотисячні', 'стотисячних'],
  6: ['мільйонна', 'мільйонні', 'мільйонних'],
};

/** «2,8» → «дві цілі вісім десятих». */
export function decimalWords(intPart: number, fractionDigits: string): string {
  const digits = fractionDigits.replace(/\D/g, '');
  if (!digits) return cardinal(intPart, 'f');
  const denominator = FRACTION_SCALES[digits.length];
  if (!denominator) return cardinal(intPart, 'f');
  const fraction = Number(digits);
  const whole = `${cardinal(intPart, 'f')} ${pluralForm(intPart, ['ціла', 'цілі', 'цілих'])}`;
  if (fraction === 0) return whole;
  return `${whole} ${cardinal(fraction, 'f')} ${pluralForm(fraction, denominator)}`;
}
