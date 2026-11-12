import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { describeDict, loadDictFixture } from './dict-fixture.js';
import { ContextRules, contextViews } from '../src/context.js';
import { StressDictionary } from '../src/dict.js';
import { Lexicon } from '../src/lexicon.js';
import { prepare } from '../src/index.js';
import { stressify } from '../src/stress.js';

const file = (name: string) => fileURLToPath(new URL(`../lexicon/${name}`, import.meta.url));

describe('contextViews', () => {
  it('бачить сусідів лише в межах частини речення', () => {
    const views = contextViews('Замок на горі, а дорога веде — до села.');
    const of = (word: string) => views.find((item) => item.word === word)!.view;
    expect(of('горі')).toEqual({ prev: 'на', next: null });
    expect(of('дорога')).toEqual({ prev: 'а', next: 'веде' });
    expect(of('до')).toEqual({ prev: null, next: 'села' });
    expect(of('Замок').prev).toBeNull();
  });

  it('знімає наголоси й регістр із сусідів', () => {
    const [, second] = contextViews('Тр+и роки');
    expect(second!.view.prev).toBe('три');
  });
});

describe('ContextRules', () => {
  const rules = ContextRules.parse(
    [
      '@few = два|три|чотири',
      'роки\tро́ки\tprev:@few\tтест',
      'роки\tроки́\t*\tтест',
      'нічого\tні́чого\tnext~ти|тися\tтест',
      'тому\tтому́\tfirst\tтест',
      'дорогу\tдоро́гу\tprev:на|через & last\tтест',
    ].join('\n'),
  );

  it('перше правило, що спрацювало, перемагає; «*» — типове', () => {
    expect(rules.resolve('роки', { prev: 'три', next: null })).toEqual([1]);
    expect(rules.resolve('роки', { prev: 'ці', next: null })).toEqual([3]);
  });

  it('розуміє суфікси, початок і кінець частини, поєднання умов', () => {
    expect(rules.resolve('нічого', { prev: null, next: 'робити' })).toEqual([1]);
    expect(rules.resolve('нічого', { prev: null, next: 'не' })).toBeNull();
    expect(rules.resolve('тому', { prev: null, next: 'вона' })).toEqual([3]);
    expect(rules.resolve('тому', { prev: 'першому', next: null })).toBeNull();
    expect(rules.resolve('дорогу', { prev: 'на', next: null })).toEqual([3]);
    expect(rules.resolve('дорогу', { prev: 'на', next: 'машину' })).toBeNull();
  });

  it('пояснює, яке правило спрацювало', () => {
    expect(rules.explain('роки', { prev: 'два', next: null })).toMatchObject({ condition: 'prev:@few', source: 'тест' });
    expect(rules.has('роки')).toBe(true);
    expect(rules.has('замок')).toBe(false);
    expect(rules.size).toBe(5);
  });

  it('не мовчить про помилки у файлі', () => {
    expect(() => ContextRules.parse('роки\tро́ки\tprev:@nope\tx')).toThrow(/unknown set/);
    expect(() => ContextRules.parse('роки\tро́ки\tколись\tx')).toThrow(/cannot read condition/);
    expect(() => ContextRules.parse('роки\tрука́\t*\tx')).toThrow(/not a stressed form/);
    expect(() => ContextRules.parse('роки\tроки\t*\tx')).toThrow(/no stress mark/);
    expect(() => ContextRules.parse('роки\tро́ки')).toThrow(/need word/);
  });

  it('файл правил із пакета читається без помилок', () => {
    expect(ContextRules.loadTsv(file('context.tsv')).size).toBeGreaterThan(25);
  });
});

describeDict('контекст у stressify і prepare', () => {
  let dict: StressDictionary;
  let context: ContextRules;
  let lexicon: Lexicon;

  beforeAll(() => {
    dict = loadDictFixture();
    context = ContextRules.loadTsv(file('context.tsv'));
    lexicon = Lexicon.loadAll([file('common.tsv'), file('names.tsv')]);
  });

  const say = (text: string) => prepare(text, { dictionary: dict, lexicon, context, engine: 'piper-medium' });

  it('розрізняє прочитання за сусіднім словом', () => {
    expect(say('Минуло три роки.').text).toContain('ро́ки');
    expect(say('Ці роки минули швидко.').text).toContain('роки́');
    expect(say('Замок стоїть на горі.').text).toContain('горі́');
    expect(say('Дорога веде до села.').text).toBe('Доро́га веде́ до села́.');
    expect(say('Тут нічого робити.').text).toContain('ні́чого');
    expect(say('Чашка нічого не підозрює.').text).toContain('нічо́го');
    expect(say('Чотириста років тому тут був степ.').text).toContain('ро́ків тому́');
  });

  it('розв’язане правилом зникає зі списку омонімів, решта лишається', () => {
    const result = say('Замок стоїть на горі.');
    expect(result.homographs.map((item) => item.key)).toEqual(['замок']);
    expect(result.contextual).toBe(1);
  });

  it('без правила слово лишається омонімом, а не вгадується', () => {
    const result = say('У першому тому є карта.');
    expect(result.text).toContain('тому є');
    expect(result.ambiguous).toContain('тому');
  });

  it('явне рішення сильніше за правило', () => {
    const hit = dict.lookup('роки')!;
    const second = stressify('три роки', dict, { symbol: 'acute', context, decisions: { роки: 1 } });
    const expected = [...'роки'];
    expected.splice(hit.alternative! + 1, 0, '́');
    expect(second.text).toBe(`три ${expected.join('')}`);
    expect(second.contextual).toBe(0);
  });

  it('без контексту поведінка не змінюється', () => {
    const result = prepare('Замок стоїть на горі.', { dictionary: dict, engine: 'piper-medium' });
    expect(result.ambiguous).toEqual(expect.arrayContaining(['Замок', 'горі']));
    expect(result.contextual).toBe(0);
  });
});
