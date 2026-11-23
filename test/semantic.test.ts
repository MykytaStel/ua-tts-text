import { describe, expect, it } from 'vitest';
import { prepare, checkPrepared } from '../src/index.js';
import { normalizeWithTrace } from '../src/normalize.js';
import { scanSemanticSpans } from '../src/semantic.js';

describe('semantic spans', () => {
  it('keeps type, parsed value, and UTF-16 source offsets', () => {
    const input = 'Дата 2026-11-15, о 12:30, 1/2 склянки, рахунок 2:1, код 000123';
    const spans = scanSemanticSpans(input);
    expect(spans.map((span) => span.kind)).toEqual(['date', 'time', 'fraction', 'ratio', 'identifier']);
    expect(spans.map((span) => input.slice(span.start, span.end))).toEqual(spans.map((span) => span.raw));
    expect(spans[0]?.value).toEqual({ year: 2026, month: 11, day: 15 });
    expect(spans[1]?.value).toEqual({ hour: 12, minute: 30 });
    expect(spans[2]?.value).toEqual({ numerator: 1, denominator: 2 });
    expect(spans[4]?.value).toMatchObject({ digits: '000123', leadingZeros: true });
  });

  it('keeps grouped thousands out of the leading-zero identifier scanner', () => {
    const spans = scanSemanticSpans('1 000 грн і 12 000 ₴');
    expect(spans.filter((span) => span.kind === 'identifier')).toEqual([]);
  });

  it('offers only value-preserving candidates for ambiguous dates and clocks', () => {
    const spans = scanSemanticSpans('Дата 01/02/2026, запис 12:3, код 000123, 1/2 склянки.');

    expect(spans.map(({ kind }) => kind)).toEqual(['ambiguous', 'ambiguous', 'identifier', 'fraction']);
    expect(spans[0]?.candidates?.map(({ id, value }) => [id, value])).toEqual([
      ['day-first', { year: 2026, month: 2, day: 1, order: 'day-first' }],
      ['month-first', { year: 2026, month: 1, day: 2, order: 'month-first' }],
    ]);
    expect(spans[1]?.candidates?.map(({ id, value }) => [id, value])).toEqual([
      ['time', { hour: 12, minute: 3 }],
      ['ratio', { numerator: 12, denominator: 3 }],
    ]);
    expect(spans[2]?.candidates?.[0]).toMatchObject({
      id: 'digit-by-digit',
      value: { identifier: '000123', digits: '000123', leadingZeros: true },
    });
    expect(spans[3]?.candidates?.[0]).toMatchObject({
      id: 'fraction',
      value: { numerator: 1, denominator: 2 },
    });
  });

  it('maps typed trace steps back to the original string', () => {
    const input = 'é́ дата 2026-11-15';
    const trace = normalizeWithTrace(input);
    const dateStep = trace.steps.find((step) => step.stage === 'date');
    expect(dateStep?.sourceStart).toBe(input.indexOf('2026'));
    expect(dateStep?.sourceEnd).toBe(input.length);
  });

  it('fails the readiness gate for invalid dates and malformed time spans', () => {
    const prepared = prepare('Дата 31.02.2026; зустріч о 25:99.', { engine: 'plain' });
    const gate = checkPrepared(prepared);
    expect(gate.passed).toBe(false);
    expect(gate.findings.filter((finding) => finding.kind === 'semantic')).toHaveLength(2);
  });
});
