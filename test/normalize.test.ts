import { describe, expect, it } from 'vitest';
import { cardinal, decimalWords, genitiveCardinal, inflectOrdinal, ordinal, pluralForm, yearWords } from '../src/numbers.js';
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

describe('genitiveCardinal', () => {
  it('узгоджує форму одного з родом іменника', () => {
    expect(genitiveCardinal(1)).toBe('одного');
    expect(genitiveCardinal(1, 'f')).toBe('однієї');
    expect(genitiveCardinal(21, 'f')).toBe('двадцяти однієї');
    expect(genitiveCardinal(1001, 'f')).toBe('тисячі однієї');
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
    expect(normalize('1,5 тис.')).toBe("тисяча п'ятсот.");
  });

  it('узгоджує числівник з прийменником і одиницею', () => {
    expect(normalize('До 5 км.')).toBe("До п'яти кілометрів.");
    expect(normalize('До 1 грн.')).toBe('До однієї гривні.');
    expect(normalize('До 1 шт.')).toBe('До однієї штуки.');
    expect(normalize('1,5 кг.')).toBe("одна ціла п'ять десятих кілограма.");
    expect(normalize('0–1 м.')).toBe('від нуля до одного метра.');
    expect(normalize('0–1 грн.')).toBe('від нуля до однієї гривні.');
  });

  it('зберігає ідентифікатори, контакти й невалідні дати', () => {
    expect(normalize('Версія 0.13.0.')).toBe('Версія 0.13.0.');
    expect(normalize('Телефон +380671234567.')).toBe('Телефон +380671234567.');
    expect(normalize('31.02.2026')).toBe('31.02.2026');
    expect(normalize('Лист test@example.org, https://example.org/a.')).toBe('Лист test@example.org, https://example.org/a.');
  });

  it('дати', () => {
    expect(normalize('12.11.2026')).toBe('дванадцятого листопада дві тисячі двадцять шостого року');
    expect(normalize('12 листопада 2026')).toBe('дванадцятого листопада дві тисячі двадцять шостого року');
  });

  it('не дублює «року» в даті', () => {
    expect(normalize('19 червня 2024 року')).toBe("дев'ятнадцятого червня дві тисячі двадцять четвертого року");
  });

  it('розрізняє тривалість і номер року', () => {
    expect(normalize('за 4 роки')).toBe('за чотири роки');
    expect(normalize('5 р.')).toBe("п'ять років");
    expect(normalize('у 375 році')).toBe("у триста сімдесят п'ятому році");
  });

  it('масштаб і валюта разом', () => {
    expect(normalize('250 тис. грн.')).toBe("двісті п'ятдесят тисяч гривень.");
  });

  it('діапазони чисел', () => {
    expect(normalize('15-20 м/с')).toBe("від п'ятнадцяти до двадцяти метрів за секунду");
    expect(normalize('5–7 км')).toBe("від п'яти до семи кілометрів");
    expect(normalize('3-4')).toBe('від трьох до чотирьох');
  });

  it('діапазон років не дублює слово-носій', () => {
    expect(normalize('у 1990-1991 роках')).toBe("у тисяча дев'ятсот дев'яностих, тисяча дев'ятсот дев'яносто перших роках");
  });

  it('порядкові дати з -го', () => {
    expect(normalize('1-го січня 2025 року')).toBe("першого січня дві тисячі двадцять п'ятого року");
  });

  it('порядкові з суфіксом', () => {
    expect(normalize('5-й поверх')).toBe("п'ятий поверх");
    expect(normalize('2-га черга')).toBe('друга черга');
    expect(normalize('3-тє місце')).toBe('третє місце');
    expect(normalize('10-ті роковини')).toBe('десяті роковини');
  });

  it('співвідношення', () => {
    expect(normalize('50/50')).toBe("п'ятдесят на п'ятдесят");
  });

  it('довгі числа читаються по цифрах', () => {
    expect(normalize('0 800 123 456')).toBe('0 800 123 456');
    expect(normalize('123456789')).toBe("один два три чотири п'ять шість сім вісім дев'ять");
  });

  it('не чіпає цифри, приклеєні до латинки', () => {
    expect(normalize('S24')).toBe('S24');
    expect(normalize('iPhone 15')).toBe("iPhone п'ятнадцять");
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
