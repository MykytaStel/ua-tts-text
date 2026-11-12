import { describe, expect, it } from 'vitest';
import { cardinal, decimalWords, inflectOrdinal, ordinal, pluralForm, yearWords } from '../src/numbers.js';
import { normalize } from '../src/normalize.js';

describe('cardinal', () => {
  it.each([
    [0, 'нуль'],
    [1, 'один'],
    [5, "п'ять"],
    [21, 'двадцять один'],
    [100, 'сто'],
    [1675, "тисяча шістсот сімдесят п'ять"],
    [2000, 'дві тисячі'],
    [2026, 'дві тисячі двадцять шість'],
    [1_000_000, 'один мільйон'],
    [2_500_000, "два мільйони п'ятсот тисяч"],
  ])('%i → %s', (n, expected) => {
    expect(cardinal(n as number)).toBe(expected);
  });

  it('узгоджує рід для жіночих одиниць', () => {
    expect(cardinal(1, 'f')).toBe('одна');
    expect(cardinal(2, 'f')).toBe('дві');
    expect(cardinal(21, 'f')).toBe('двадцять одна');
  });
});

describe('pluralForm', () => {
  const forms = ['рік', 'роки', 'років'] as const;
  it.each([
    [1, 'рік'],
    [2, 'роки'],
    [4, 'роки'],
    [5, 'років'],
    [11, 'років'],
    [21, 'рік'],
    [22, 'роки'],
    [25, 'років'],
  ])('%i → %s', (n, expected) => {
    expect(pluralForm(n as number, forms)).toBe(expected);
  });
});

describe('ordinal', () => {
  it.each([
    [1, 'перший'],
    [3, 'третій'],
    [20, 'двадцятий'],
    [21, 'двадцять перший'],
    [1000, 'тисячний'],
    [1991, "тисяча дев'ятсот дев'яносто перший"],
    [2000, 'двохтисячний'],
    [2026, 'дві тисячі двадцять шостий'],
  ])('%i → %s', (n, expected) => {
    expect(ordinal(n as number)).toBe(expected);
  });

  it('відмінює порядкові', () => {
    expect(inflectOrdinal('двадцять шостий', 'gen')).toBe('двадцять шостого');
    expect(inflectOrdinal('двадцять шостий', 'loc')).toBe('двадцять шостому');
    expect(inflectOrdinal('третій', 'gen')).toBe('третього');
    expect(inflectOrdinal('третій', 'plurLoc')).toBe('третіх');
  });

  it('роки з відмінком за словом-носієм', () => {
    expect(yearWords(1675, 'році')).toBe("тисяча шістсот сімдесят п'ятому році");
    expect(yearWords(1991, 'року')).toBe("тисяча дев'ятсот дев'яносто першого року");
    expect(yearWords(1990, 'роках')).toBe("тисяча дев'ятсот дев'яностих роках");
  });
});

describe('decimalWords', () => {
  it('читає десяткові', () => {
    expect(decimalWords(2, '8')).toBe('дві цілі вісім десятих');
    expect(decimalWords(1, '5')).toBe("одна ціла п'ять десятих");
    expect(decimalWords(0, '5')).toBe("нуль цілих п'ять десятих");
  });
});

describe('normalize', () => {
  it('роки з прийменником', () => {
    expect(normalize('у 1675 році')).toBe("у тисяча шістсот сімдесят п'ятому році");
    expect(normalize('1991 року')).toBe("тисяча дев'ятсот дев'яносто першого року");
  });

  it('відсотки', () => {
    expect(normalize('5%')).toBe("п'ять відсотків");
    expect(normalize('1%')).toBe('один відсоток');
    expect(normalize('22%')).toBe('двадцять два відсотки');
  });

  it('одиниці узгоджуються з числом', () => {
    expect(normalize('5 км')).toBe("п'ять кілометрів");
    expect(normalize('2 км')).toBe('два кілометри');
    expect(normalize('1 км')).toBe('один кілометр');
  });

  it('масштабні слова читаються повним числом', () => {
    expect(normalize('2,8 млн')).toBe('два мільйони вісімсот тисяч');
    expect(normalize('1,5 тис.')).toBe("тисяча п'ятсот");
  });

  it('дати', () => {
    expect(normalize('12.11.2026')).toBe('дванадцятого листопада дві тисячі двадцять шостого року');
    expect(normalize('12 листопада 2026')).toBe('дванадцятого листопада дві тисячі двадцять шостого року');
  });

  it('римські століття', () => {
    expect(normalize('XX століття')).toBe('двадцятого століття');
  });

  it('скорочення', () => {
    expect(normalize('і т.д.')).toBe('і так далі');
    expect(normalize('напр. Київ')).toBe('наприклад Київ');
  });

  it('абревіатури', () => {
    expect(normalize('ЗСУ')).toBe('зе-се-у');
  });

  it('пунктуація під TTS', () => {
    expect(normalize('Київ (столиця) — місто.')).toBe('Київ столиця, місто.');
    expect(normalize('Раз… два…')).toBe('Раз. два.');
  });

  it('не чіпає пробіли в тисячах', () => {
    expect(normalize('24 251')).toBe("двадцять чотири тисячі двісті п'ятдесят один");
  });
});
