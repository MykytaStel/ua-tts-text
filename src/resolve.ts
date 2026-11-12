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

/** Складає один запит на всі омоніми й повертає рішення. */
export async function resolveHomographs(homographs: readonly Homograph[], ask: Asker): Promise<ResolveResult> {
  if (homographs.length === 0) return { decisions: {}, missing: [], promptLength: 0 };

  const prompt = reviewPrompt(homographs);
  const answer = await ask(prompt);
  const decisions = parseDecisions(answer);
  const missing = homographs.filter((item) => decisions[item.key] === undefined).map((item) => item.word);
  return { decisions, missing, promptLength: prompt.length };
}
