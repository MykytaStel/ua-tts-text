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
