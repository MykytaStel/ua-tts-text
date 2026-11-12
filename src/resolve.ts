/**
 * Розв'язання омонімів через LLM: один запит на весь текст, а не на слово.
 * Модуль не тягне SDK — лише `fetch`, тож працює будь-де, де є Node 20+.
 */

import { parseDecisions, reviewPrompt, type Decisions } from './agent.js';
import type { Homograph } from './review.js';

export type Asker = (prompt: string) => Promise<string>;

export interface OpenAiAskerOptions {
  /** Сумісний з OpenAI endpoint, напр. https://api.deepseek.com */
  baseUrl?: string;
  apiKey: string;
  /** Типова модель — дешева й достатня для вибору з двох варіантів. */
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

/** Мінімальний клієнт для OpenAI-сумісного /chat/completions. */
export function createOpenAiAsker(options: OpenAiAskerOptions): Asker {
  const baseUrl = (options.baseUrl ?? 'https://api.deepseek.com').replace(/\/$/u, '');
  const model = options.model ?? 'deepseek-chat';

  return async (prompt: string) => {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: options.maxTokens ?? 600,
        messages: [
          {
            role: 'system',
            content: 'Ти редактор української озвучки. Відповідай лише JSON-обʼєктом, без пояснень.',
          },
          { role: 'user', content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`asker: HTTP ${response.status} ${body.slice(0, 200)}`);
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('asker: empty completion');
    return content;
  };
}

export interface ResolveResult {
  decisions: Decisions;
  /** Слова, для яких модель не дала рішення. */
  missing: string[];
  promptLength: number;
}

const VOWELS = new Set([...'аеєиіїоуяю']);

/** Запит для слів, яких немає у словнику: індекс наголошеної голосної з 0. */
export function unknownPrompt(words: readonly string[]): string {
  if (words.length === 0) return '';
  return [
    'Ти готуєш український текст до озвучки. Нижче — слова, яких немає у словнику наголосів.',
    'Для кожного вкажи ІНДЕКС наголошеної голосної з нуля (0 — перша літера слова).',
    'Якщо не знаєш напевно — постав null, не вгадуй.',
    '',
    ...words.map((word, index) => `${index + 1}. ${word}`),
    '',
    'Поверни лише JSON-обʼєкт виду {"слово": 2}, де 2 — індекс голосної.',
  ].join('\n');
}

/** Перевіряє відповідь моделі: індекс має вказувати на голосну всередині слова. */
export function parseStressAnswers(raw: string, words: readonly string[]): Record<string, number> {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`parseStressAnswers: not valid JSON (${(error as Error).message})`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('parseStressAnswers: expected a JSON object');
  }

  const known = new Set(words.map((word) => word.toLowerCase()));
  const overrides: Record<string, number> = {};
  for (const [word, value] of Object.entries(parsed as Record<string, unknown>)) {
    const key = word.toLowerCase();
    if (!known.has(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value !== 'number' || !Number.isInteger(value)) continue;
    const chars = [...key];
    if (value < 0 || value >= chars.length || !VOWELS.has(chars[value]!)) continue;
    overrides[key] = value;
  }
  return overrides;
}

export interface UnknownResult {
  overrides: Record<string, number>;
  missing: string[];
  promptLength: number;
}

/** Питає LLM про слова, яких немає у словнику. */
export async function resolveUnknown(words: readonly string[], ask: Asker): Promise<UnknownResult> {
  if (words.length === 0) return { overrides: {}, missing: [], promptLength: 0 };
  const prompt = unknownPrompt(words);
  const overrides = parseStressAnswers(await ask(prompt), words);
  const missing = words.filter((word) => overrides[word.toLowerCase()] === undefined).map((word) => word.toLowerCase());
  return { overrides, missing, promptLength: prompt.length };
}

/** Складає один запит на всі омоніми й повертає рішення. */
export async function resolveHomographs(homographs: readonly Homograph[], ask: Asker): Promise<ResolveResult> {
  if (homographs.length === 0) return { decisions: {}, missing: [], promptLength: 0 };

  const prompt = reviewPrompt(homographs);
  const answer = await ask(prompt);
  const decisions = parseDecisions(answer);
  const missing = homographs.filter((item) => decisions[item.key] === undefined).map((item) => item.word);
  return { decisions, missing, promptLength: prompt.length };
}
