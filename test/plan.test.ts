import { describe, expect, it } from 'vitest';
import { chunkSpeech, planSpeech, renderPlan } from '../src/plan.js';

describe('план мовлення', () => {
  it('ділить на речення й підрядні частини', () => {
    const plan = planSpeech('Раз, два. Три!');
    expect(plan.segments.map((s) => s.text)).toEqual(['Раз,', 'два.', 'Три!']);
    expect(plan.segments.map((s) => s.pauseAfterMs)).toEqual([220, 480, 0]);
  });

  it('не ставить паузу всередині часу й десяткового числа', () => {
    const plan = planSpeech('Зустріч о 12:30. Ціна 1,5 грн.');
    expect(plan.segments.map((segment) => segment.text)).toEqual(['Зустріч о 12:30.', 'Ціна 1,5 грн.']);
    expect(plan.segments.every((segment) => segment.words > 0)).toBe(true);
  });

  it('визначає тип речення', () => {
    const plan = planSpeech('Хто це? Це він! Гаразд.');
    expect(plan.segments.map((s) => s.kind)).toEqual(['question', 'exclamation', 'statement']);
  });

  it('оцінює тривалість', () => {
    const plan = planSpeech('Один два три чотири пʼять шість сім вісім девʼять десять.');
    expect(plan.estimatedMs).toBeGreaterThan(3000);
  });

  it('не рахує маркер наголосу як окреме слово', () => {
    expect(planSpeech('Молоко.').estimatedMs).toBe(planSpeech('Молок+о.').estimatedMs);
    expect(planSpeech('Атлас.').estimatedMs).toBe(planSpeech('+Атлас.').estimatedMs);
  });

  it('рендерить SSML із паузами', () => {
    const plan = planSpeech('Раз, два. Три.');
    const ssml = renderPlan(plan, 'ssml');
    expect(ssml.startsWith('<speak>')).toBe(true);
    expect(ssml).toContain('<break time="220ms"/>');
    expect(ssml).toContain('<break time="480ms"/>');
  });

  it('plain-рендер зберігає текст', () => {
    const plan = planSpeech('Раз, два. Три.');
    expect(renderPlan(plan, 'plain')).toBe('Раз, два. Три.');
  });

  it('позначає акцент на запереченні й контрасті', () => {
    const plan = planSpeech('Це не так. Але ми знаємо.');
    expect(plan.segments[0]!.emphasis).toBe(true);
    expect(plan.segments[1]!.emphasis).toBe(true);
    expect(planSpeech('Поле і ліс.').segments[0]!.emphasis).toBe(false);
  });

  it('додає emphasis у SSML', () => {
    const ssml = renderPlan(planSpeech('Це не так.'), 'ssml');
    expect(ssml).toContain('<emphasis level="moderate">');
  });

  it('екранує XML-символи', () => {
    const plan = planSpeech('A & B < C.');
    expect(renderPlan(plan, 'ssml')).toContain('&amp;');
    expect(renderPlan(plan, 'ssml')).toContain('&lt;');
  });

  it('exposes source ranges for each planned phrase', () => {
    const input = '  Раз, два. Три.';
    const plan = planSpeech(input);

    expect(plan.segments.map(({ text, start, end }) => [text, input.slice(start, end)])).toEqual([
      ['Раз,', 'Раз,'],
      ['два.', 'два.'],
      ['Три.', 'Три.'],
    ]);
  });

  it('splits at preferred boundaries and reports an indivisible range over budget', () => {
    const text = 'Коротко. Значно довше речення.';
    const chunks = chunkSpeech(text, { maxChars: 12, protectedRanges: [{ start: 9, end: text.length, reason: 'semantic value' }] });

    expect(chunks.map(({ text: value }) => value)).toEqual(['Коротко.', 'Значно довше речення.']);
    expect(chunks[1]).toMatchObject({ oversized: true, warning: 'semantic value' });
    expect(chunks[1]!.text.length).toBeGreaterThan(12);
  });

  it('uses grapheme-safe fallback for long unbroken text', () => {
    const text = 'А😀БВГД';
    const chunks = chunkSpeech(text, { maxChars: 3 });
    expect(chunks.map(({ text: value }) => value).join('')).toBe(text);
    expect(chunks.every(({ text: value }) => value.length <= 3 || [...value].length === 1)).toBe(true);
  });

  it('keeps plus stress marks attached to their vowels during fallback chunking', () => {
    const text = 'АБВ+ОГД';
    const chunks = chunkSpeech(text, { maxChars: 4 });

    expect(chunks.map(({ text: value }) => value).join('')).toBe(text);
    expect(chunks.every(({ text: value }) => !value.endsWith('+'))).toBe(true);
  });
});
