/**
 * Профілі рушіїв: у кожного свій формат наголосу або його відсутність.
 * Дані перевірені на реальних моделях — див. README.
 */

import type { StressDictionary } from './dict.js';
import { stressify, type StressOptions, type StressResult, type StressSymbol } from './stress.js';

export type EngineId =
  | 'tts-uk'
  | 'holos-voice'
  | 'silero'
  | 'rhvoice'
  | 'styletts2'
  | 'piper-medium'
  | 'piper-high'
  | 'elevenlabs-v4'
  | 'edge-tts'
  | 'gemini-tts'
  | 'cartesia'
  | 'vosk-tts'
  | 'azure'
  | 'plain';

export interface EngineProfile {
  readonly symbol: StressSymbol;
  readonly supportsStress: boolean;
  readonly note: string;
}

export const ENGINES: Readonly<Record<EngineId, EngineProfile>> = {
  'tts-uk': {
    symbol: 'plus-before',
    supportsStress: true,
    note: '«+» перед наголошеною голосною; модель навчена саме на такому записі.',
  },
  'holos-voice': {
    symbol: 'plus-before',
    supportsStress: true,
    note: '«+» перед наголошеною голосною.',
  },
  silero: { symbol: 'plus-before', supportsStress: true, note: '«+» перед наголошеною голосною.' },
  rhvoice: { symbol: 'plus-before', supportsStress: true, note: '«+» перед наголошеною голосною.' },
  styletts2: {
    symbol: 'plus-after',
    supportsStress: true,
    note: '«+» після наголошеного складу.',
  },
  'piper-medium': {
    symbol: 'acute',
    supportsStress: true,
    note: 'Символьна модель uk_UA-ukrainian_tts-medium: U+0301 є окремим токеном.',
  },
  'piper-high': {
    symbol: 'none',
    supportsStress: false,
    note:
      'Голоси *-high фонемізуються espeak-ng, який ставить наголос сам: U+0301 відкидається, ' +
      'а «+» озвучується як «плюс». Виправити наголос текстом неможливо — потрібен інший рушій.',
  },
  'elevenlabs-v4': {
    symbol: 'none',
    supportsStress: false,
    note: 'Для неанглійської приймає IPA лише на eleven_v4 / v4_turbo; IPA-профіль ще не реалізовано.',
  },
  'edge-tts': { symbol: 'none', supportsStress: false, note: 'Наголоси не приймає.' },
  'gemini-tts': { symbol: 'none', supportsStress: false, note: 'Наголоси не приймає; текст лише нормалізується.' },
  cartesia: { symbol: 'none', supportsStress: false, note: 'Наголоси не приймає; текст лише нормалізується.' },
  'vosk-tts': { symbol: 'none', supportsStress: false, note: 'Наголоси не приймає; текст лише нормалізується.' },
  azure: {
    symbol: 'none',
    supportsStress: false,
    note: 'SSML IPA для uk-UA не заявлено; лишається переписування орфографії.',
  },
  plain: { symbol: 'none', supportsStress: true, note: 'Без позначок.' },
};

export interface RenderResult extends StressResult {
  warnings: string[];
  engine: EngineId;
}

/** Готує текст під конкретний рушій і повертає попередження про його межі. */
export function render(
  text: string,
  engine: EngineId,
  dictionary: StressDictionary,
  options: StressOptions = {},
): RenderResult {
  const profile = ENGINES[engine];
  if (!profile) throw new Error(`render: unknown engine "${String(engine)}"`);

  const warnings: string[] = [];
  if (!profile.supportsStress) warnings.push(`${engine}: ${profile.note}`);

  const result = stressify(text, dictionary, { ...options, symbol: profile.symbol });
  return { ...result, warnings, engine };
}
