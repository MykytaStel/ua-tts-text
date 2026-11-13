import { describe, expect, it } from 'vitest';
import { describeDict, loadDictFixture } from './dict-fixture.js';
import { StressDictionary } from '../src/dict.js';
import { Lexicon } from '../src/lexicon.js';
import { prepare } from '../src/index.js';
import { ENGINES, render } from '../src/render.js';
import { stressify } from '../src/stress.js';

let dict: StressDictionary | undefined;
const getDict = () => (dict ??= loadDictFixture());

describeDict('словник', () => {
  it('завантажується і містить понад 2,5 млн слів', () => {
    expect(getDict().size).toBeGreaterThan(2_500_000);
  });

  it('знаходить наголос', () => {
    expect(getDict().lookup('молоко')?.position).toBe(5);
    expect(getDict().lookup('україна')?.position).toBe(4);
  });

  it('позначає омоніми альтернативою', () => {
    const hit = getDict().lookup('замок');
    expect(hit?.position).not.toBeNull();
    expect(hit?.alternative).not.toBeNull();
  });

  it('повертає null для невідомого слова', () => {
    expect(getDict().lookup('квазіпсевдонауковість')).toBeNull();
  });
});

describeDict('stressify', () => {
  it('ставить «+» перед голосною', () => {
    expect(stressify('молоко', getDict(), { symbol: 'plus-before' }).text).toBe('молок+о');
  });

  it('ставить «+» після голосної', () => {
    expect(stressify('молоко', getDict(), { symbol: 'plus-after' }).text).toBe('молоко+');
  });

  it('ставить акут', () => {
    expect(stressify('молоко', getDict(), { symbol: 'acute' }).text).toBe('молоко\u0301');
  });

  it('не чіпає слова з ручним наголосом', () => {
    expect(stressify('Сагайд+ачний', getDict(), { symbol: 'plus-before' }).text).toBe('Сагайд+ачний');
  });

  it('омоніми за замовчуванням пропускає і показує у звіті', () => {
    const result = stressify('замок', getDict());
    expect(result.marked).toBe(0);
    expect(result.ambiguous).toEqual(['замок']);
    expect(result.text).toBe('замок');
  });

  it('омоніми можна позначити обома варіантами', () => {
    const result = stressify('замок', getDict(), { symbol: 'plus-before', onAmbiguity: 'all' });
    expect(result.text).toBe('з+ам+ок');
    expect(result.ambiguous).toEqual([]);
  });

  it('односкладові слова не потрапляють у невідомі', () => {
    expect(stressify('тут три', getDict()).unknown).toEqual([]);
    expect(stressify("п'ять", getDict()).unknown).toEqual([]);
  });

  it('невідоме слово потрапляє у звіт', () => {
    const result = stressify('квазіпсевдонауковість', getDict());
    expect(result.unknown).toEqual(['квазіпсевдонауковість']);
  });
});

describeDict('лексикон', () => {
  it('перекриває омонімію словника', () => {
    const lexicon = Lexicon.loadTsv(new URL('../lexicon/names.tsv', import.meta.url).pathname);
    const chosen = lexicon.lookup('київ');
    expect(chosen?.position).toBe(1);
    expect(chosen?.alternative).toBeNull();

    const result = prepare('Київ і Харків', { dictionary: getDict(), engine: 'tts-uk', lexicon });
    expect(result.text).toBe('К+иїв і Х+арків');
    expect(result.ambiguous).toEqual([]);
  });

  it('loadAll зливає загальні слова й назви', () => {
    const merged = Lexicon.loadAll([
      new URL('../lexicon/common.tsv', import.meta.url).pathname,
      new URL('../lexicon/names.tsv', import.meta.url).pathname,
    ]);
    expect(merged.lookup('повість')?.position).toBe(1);
    expect(merged.lookup('київ')?.position).toBe(1);
  });

  it('ставить два наголоси у складній назві', () => {
    const lexicon = Lexicon.loadTsv(new URL('../lexicon/names.tsv', import.meta.url).pathname);
    const result = stressify('Кам’янець-Подільський', getDict(), { symbol: 'plus-before', lexicon });
    expect(result.text).toBe('Кам’ян+ець-Под+ільський');
  });
});

describeDict('контекст омонімів', () => {
  it('повертає речення, у якому стоїть слово', () => {
    const result = prepare('Замок стоїть на горі. Далі — поле.', { dictionary: getDict() });
    const castle = result.homographs.find((h) => h.key === 'замок');
    expect(castle?.context).toBe('Замок стоїть на горі');
  });
});

describeDict('фолбек для невідомих слів', () => {
  it('наголошує частини дефісного слова', () => {
    const result = stressify('пів-України', getDict(), { symbol: 'plus-before' });
    expect(result.text).toBe('пів-Укра+їни');
    expect(result.inferred).toBe(1);
    expect(result.unknown).toEqual([]);
  });

  it('переносить наголос зі спільного стема', () => {
    expect(stressify('ковбасити', getDict(), { symbol: 'plus-before' }).text).toBe('ковб+асити');
  });

  it('приймає явний наголос (відповідь LLM)', () => {
    const result = stressify('Ґуґл', getDict(), { symbol: 'plus-before', overrides: { 'ґуґл': 1 } });
    expect(result.text).toBe('Ґ+уґл');
  });

  it('омонім без рішення лишається без наголосу, а не вгадується', () => {
    expect(stressify('замок', getDict(), { symbol: 'plus-before' }).text).toBe('замок');
  });
});

describeDict('render', () => {
  it('підбирає символ під рушій', () => {
    expect(render('молоко', 'tts-uk', getDict()).text).toBe('молок+о');
    expect(render('молоко', 'styletts2', getDict()).text).toBe('молоко+');
    expect(render('молоко', 'piper-medium', getDict()).text).toBe('молоко\u0301');
  });

  it('попереджає, що piper-high не приймає наголоси', () => {
    const result = render('молоко', 'piper-high', getDict());
    expect(result.text).toBe('молоко');
    expect(result.warnings[0]).toMatch(/espeak/u);
    expect(ENGINES['piper-high'].supportsStress).toBe(false);
  });
});

describeDict('prepare', () => {
  it('нормалізує і позначає наголос під рушій', () => {
    const result = prepare('у 1675 році тут було молоко', { dictionary: getDict(), engine: 'tts-uk' });
    expect(result.text).toBe("у т+исяча шістс+от сімдес+ят п'+ятому р+оці тут бул+о молок+о");
    expect(result.warnings).toEqual(
      getDict().invalidEntryCount ? [`base stress dictionary: ${getDict().invalidEntryCount} malformed entries ignored`] : [],
    );
  });

  it('без словника лише нормалізує', () => {
    const result = prepare('5 км');
    expect(result.text).toBe("п'ять кілометрів");
    expect(result.marked).toBe(0);
  });
});
