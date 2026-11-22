import { describe, expect, it } from 'vitest';
import { NormalizationRules, prepareSpeech, prepareSpeechMany, StressDictionary } from '../src/index.js';

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
    expect(prepared.ssml).toBeUndefined();
    expect(prepareSpeech(input, { engine: 'plain' }).ssml).toContain('<break time="480ms"/>');
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

  it('requires adapter markup for Azure and ignores irrelevant stress findings in speech readiness', () => {
    const azure = prepareSpeech('Так. Так.', { engine: 'azure' });
    expect(azure.ssml).toBeUndefined();
    expect(azure.ssmlUnavailableReason).toContain('adapter');
    expect(azure.plan.segments[0]?.pauseAfterMs).toBe(480);

    const v4 = prepareSpeech('Краудфандинг.', { engine: 'elevenlabs-v4', dictionary: StressDictionary.empty() });
    expect(v4.prepared.unknown).toContain('Краудфандинг');
    expect(v4.readiness).toEqual({ passed: true, findings: [] });
  });

  it('uses the original batch inputs after the caller edits its array', async () => {
    const inputs = ['Було 5.'];
    const pending = prepareSpeechMany(inputs);
    inputs[0] = 'Було 7.';
    const [result] = (await pending).paragraphs;
    expect(result?.text).toBe("Було п'ять.");
    expect(result?.normalizationAlignment.map(({ spokenText }) => spokenText).join('')).toBe(result?.text);
  });

  it.each(['{}', '{"краудфандинг": 3}'])('keeps normalization stable during resolution (%s)', async (response) => {
    const rules = new NormalizationRules();
    const input = 'Краудфандинг АТБ.';
    let calls = 0;
    const batch = await prepareSpeechMany([input], {
      engine: 'tts-uk',
      dictionary: StressDictionary.empty(),
      normalize: { rules },
      resolveUnknown: true,
      ask: async () => {
        calls++;
        rules.add('АТБ', 'а-те-бе', { source: 'fixture' });
        return response;
      },
    });
    const [result] = batch.paragraphs;
    expect(calls).toBe(1);
    expect(result?.text).toContain('АТБ');
    expect(result?.normalizationAlignment.map(({ spokenText }) => spokenText).join('')).toBe(input);
    if (response !== '{}') expect(result?.prepared.unknown).not.toContain('Краудфандинг');
  });

  it.each([
    { wordsPerMinute: 0 },
    { wordsPerMinute: Infinity },
    { wordsPerMinute: Number.MIN_VALUE },
    { sentencePauseMs: -100 },
    { clausePauseMs: NaN },
  ])('rejects invalid pacing %o', (plan) => {
    expect(() => prepareSpeech('Так. Так.', { engine: 'plain', plan })).toThrow(RangeError);
  });
});
