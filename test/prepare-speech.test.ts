import { describe, expect, it } from 'vitest';
import { prepareSpeech, prepareSpeechMany, StressDictionary } from '../src/index.js';

describe('TTS handoff', () => {
  it('plans normalized text and reports every unknown-word occurrence', () => {
    const input = 'Краудфандинг. Краудфандинг?';
    const prepared = prepareSpeech(input, {
      engine: 'holos-voice',
      dictionary: StressDictionary.empty(),
    });

    expect(prepared.text).toBe(input);
    expect(prepared.plan.segments.map(({ kind }) => kind)).toEqual(['statement', 'question']);
    expect(prepared.prepared.unknown).toEqual(['Краудфандинг']);
    expect(prepared.prepared.unknownOccurrences).toEqual([
      { word: 'Краудфандинг', offset: 0 },
      { word: 'Краудфандинг', offset: input.lastIndexOf('Краудфандинг') },
    ]);
    expect(prepared.readiness.findings.map(({ kind }) => kind)).toContain('unknown-word');
    expect(prepared.ssml).toContain('<break time="480ms"/>');
  });

  it('keeps batch resolution metadata while returning a plan for each paragraph', async () => {
    const batch = await prepareSpeechMany(['У 2025 році.', 'Хто це?'], { engine: 'plain' });

    expect(batch.paragraphs.map(({ text }) => text)).toEqual(["У дві тисячі двадцять п'ятому році.", 'Хто це?']);
    expect(batch.paragraphs.map(({ plan }) => plan.segments[0]?.kind)).toEqual(['statement', 'question']);
    expect(batch.paragraphs[0]?.normalizationAlignment.some(({ sourceText, spokenText, changed }) =>
      sourceText.includes('2025') && spokenText.length > sourceText.length && changed,
    )).toBe(true);
    expect(batch.decisionFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(batch.promptLength).toBe(0);
  });

  it('withholds unsupported SSML for ElevenLabs v4 and reports the limitation', () => {
    const prepared = prepareSpeech('Привіт. Як справи?', { engine: 'elevenlabs-v4' });

    expect(prepared.ssml).toBeUndefined();
    expect(prepared.ssmlUnavailableReason).toMatch(/break tags are unsupported/u);
    expect(prepared.readiness.passed).toBe(true);
    expect(prepared.plan.segments).toHaveLength(2);
  });
});
