import { beforeAll, describe, expect, it } from 'vitest';
import { describeDict, loadDictFixture } from './dict-fixture.js';
import { StressDictionary } from '../src/dict.js';
import { Lexicon } from '../src/lexicon.js';
import { prepare } from '../src/index.js';
import { ENGINES, render } from '../src/render.js';
import { stressify } from '../src/stress.js';

let dict: StressDictionary;

beforeAll(() => {
  dict = loadDictFixture();
});

describeDict('словник', () => {
  it('завантажується і містить понад 2,5 млн слів', () => {
    expect(dict.size).toBeGreaterThan(2_500_000);
  });

  it('знаходить наголос', () => {
    expect(dict.lookup('молоко')?.position).toBe(5);
    expect(dict.lookup('україна')?.position).toBe(4);
  });

  it('позначає омоніми альтернативою', () => {
    const hit = dict.lookup('замок');
    expect(hit?.position).not.toBeNull();
    expect(hit?.alternative).not.toBeNull();
  });

  it('повертає null для невідомого слова', () => {
    expect(dict.lookup('квазіпсевдонауковість')).toBeNull();
  });
});

describeDict('stressify', () => {
  it('ставить «+» перед голосною', () => {
    expect(stressify('молоко', dict, { symbol: 'plus-before' }).text).toBe('молок+о');
  });

  it('ставить «+» після голосної', () => {
    expect(stressify('молоко', dict, { symbol: 'plus-after' }).text).toBe('молоко+');
  });

  it('ставить акут', () => {
    expect(stressify('молоко', dict, { symbol: 'acute' }).text).toBe('молоко\u0301');
  });

  it('не чіпає слова з ручним наголосом', () => {
    expect(stressify('Сагайд+ачний', dict, { symbol: 'plus-before' }).text).toBe('Сагайд+ачний');
  });

  it('омоніми за замовчуванням пропускає і показує у звіті', () => {
    const result = stressify('замок', dict);
    expect(result.marked).toBe(0);
    expect(result.ambiguous).toEqual(['замок']);
    expect(result.text).toBe('замок');
  });

  it('омоніми можна позначити обома варіантами', () => {
    const result = stressify('замок', dict, { symbol: 'plus-before', onAmbiguity: 'all' });
    expect(result.text).toBe('з+ам+ок');
    expect(result.ambiguous).toEqual([]);
  });

  it('односкладові слова не потрапляють у невідомі', () => {
    expect(stressify('тут три', dict).unknown).toEqual([]);
    expect(stressify("п'ять", dict).unknown).toEqual([]);
  });

  it('невідоме слово потрапляє у звіт', () => {
    const result = stressify('квазіпсевдонауковість', dict);
    expect(result.unknown).toEqual(['квазіпсевдонауковість']);
  });
});

describeDict('лексикон', () => {
  it('перекриває омонімію словника', () => {
    const lexicon = Lexicon.loadTsv(new URL('../lexicon/names.tsv', import.meta.url).pathname);
    const chosen = lexicon.lookup('київ');
    expect(chosen?.position).toBe(1);
    expect(chosen?.alternative).toBeNull();

    const result = prepare('Київ і Харків', { dictionary: dict, engine: 'tts-uk', lexicon });
    expect(result.text).toBe('К+иїв і Х+арків');
    expect(result.ambiguous).toEqual([]);
  });

  it('ставить два наголоси у складній назві', () => {
    const lexicon = Lexicon.loadTsv(new URL('../lexicon/names.tsv', import.meta.url).pathname);
    const result = stressify('Кам’янець-Подільський', dict, { symbol: 'plus-before', lexicon });
    expect(result.text).toBe('Кам’ян+ець-Под+ільський');
  });
});

describeDict('контекст омонімів', () => {
  it('повертає речення, у якому стоїть слово', () => {
    const result = prepare('Замок стоїть на горі. Далі — поле.', { dictionary: dict });
    const castle = result.homographs.find((h) => h.key === 'замок');
    expect(castle?.context).toBe('Замок стоїть на горі');
  });
});

describeDict('render', () => {
  it('підбирає символ під рушій', () => {
    expect(render('молоко', 'tts-uk', dict).text).toBe('молок+о');
    expect(render('молоко', 'styletts2', dict).text).toBe('молоко+');
    expect(render('молоко', 'piper-medium', dict).text).toBe('молоко\u0301');
  });

  it('попереджає, що piper-high не приймає наголоси', () => {
    const result = render('молоко', 'piper-high', dict);
    expect(result.text).toBe('молоко');
    expect(result.warnings[0]).toMatch(/espeak/u);
    expect(ENGINES['piper-high'].supportsStress).toBe(false);
  });
});

describeDict('prepare', () => {
  it('нормалізує і позначає наголос під рушій', () => {
    const result = prepare('у 1675 році тут було молоко', { dictionary: dict, engine: 'tts-uk' });
    expect(result.text).toBe("у т+исяча шістс+от сімдес+ят п'+ятому р+оці тут бул+о молок+о");
    expect(result.warnings).toEqual([]);
  });

  it('без словника лише нормалізує', () => {
    const result = prepare('5 км');
    expect(result.text).toBe("п'ять кілометрів");
    expect(result.marked).toBe(0);
  });
});
