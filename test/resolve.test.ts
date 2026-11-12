import { beforeAll, describe, expect, it } from 'vitest';
import { describeDict, loadDictFixture } from './dict-fixture.js';
import type { StressDictionary } from '../src/dict.js';
import { prepare, prepareMany } from '../src/index.js';
import { parseStressAnswers, unknownPrompt } from '../src/resolve.js';

let dict: StressDictionary;

beforeAll(() => {
  dict = loadDictFixture();
});

describeDict('слова поза словником', () => {
  it('будує запит і перевіряє індекси', () => {
    const prompt = unknownPrompt(['краудфандинг', 'стендап']);
    expect(prompt).toContain('краудфандинг');
    expect(
      parseStressAnswers('{"краудфандинг": 6, "стендап": 99, "зайве": 0}', ['краудфандинг', 'стендап']),
    ).toEqual({ краудфандинг: 6 });
  });

  it('відкидає індекс на приголосній', () => {
    expect(parseStressAnswers('{"стендап": 0}', ['стендап'])).toEqual({});
  });

  it('готує текст із наголосами від LLM', async () => {
    const ask = async (prompt: string) =>
      prompt.includes('немає у словнику') ? '{"краудфандинг": 6}' : '{}';
    const result = await prepareMany(['Краудфандинг і замок'], { dictionary: dict, engine: 'tts-uk', ask });
    expect(result.results[0]!.text).toContain('Краудф+андинг');
    expect(result.overrides).toEqual({ краудфандинг: 6 });
  });
});

describeDict('prepareMany з LLM', () => {
  it('розв’язує омоніми одним запитом на всі фрагменти', async () => {
    const prompts: string[] = [];
    const ask = async (prompt: string) => {
      prompts.push(prompt);
      return JSON.stringify({ замок: 0, горі: 1 });
    };

    const result = await prepareMany(['Замок стоїть на горі.', 'Інший замок — унизу.'], {
      dictionary: dict,
      engine: 'tts-uk',
      ask,
    });

    expect(prompts).toHaveLength(1);
    expect(result.results[0]!.text).toBe('З+амок сто+їть на гор+і.');
    expect(result.results[1]!.text).toBe('+Інший з+амок, униз+у.');
    expect(result.results[1]!.ambiguous).toEqual([]);
    expect(result.decisions).toEqual({ замок: 0, горі: 1 });
    expect(result.missing).toEqual([]);
  });

  it('показує слова без рішення', async () => {
    const ask = async () => JSON.stringify({ замок: 0 });
    const result = await prepareMany(['Замок стоїть на горі.'], { dictionary: dict, engine: 'tts-uk', ask });
    expect(result.missing).toEqual(['горі']);
    expect(result.results[0]!.ambiguous).toEqual(['горі']);
  });

  it('без ask поводиться як звичайний prepare', async () => {
    const result = await prepareMany(['Замок стоїть на горі.'], { dictionary: dict, engine: 'tts-uk' });
    expect(result.results[0]!.ambiguous).toEqual(['Замок', 'горі']);
    expect(result.promptLength).toBe(0);
  });

  it('рахує довжину запиту для оцінки витрат', async () => {
    const ask = async () => '{}';
    const result = await prepareMany(['Замок стоїть на горі.'], { dictionary: dict, engine: 'tts-uk', ask });
    expect(result.promptLength).toBeGreaterThan(50);
  });
});
