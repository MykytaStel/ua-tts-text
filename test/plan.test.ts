import { describe, expect, it } from 'vitest';
import { planSpeech, renderPlan } from '../src/plan.js';

describe('план мовлення', () => {
  it('ділить на речення й підрядні частини', () => {
    const plan = planSpeech('Раз, два. Три!');
    expect(plan.segments.map((s) => s.text)).toEqual(['Раз,', 'два.', 'Три!']);
    expect(plan.segments.map((s) => s.pauseAfterMs)).toEqual([220, 480, 0]);
  });

  it('визначає тип речення', () => {
    const plan = planSpeech('Хто це? Це він! Гаразд.');
    expect(plan.segments.map((s) => s.kind)).toEqual(['question', 'exclamation', 'statement']);
  });

  it('оцінює тривалість', () => {
    const plan = planSpeech('Один два три чотири пʼять шість сім вісім девʼять десять.');
    expect(plan.estimatedMs).toBeGreaterThan(3000);
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
});
