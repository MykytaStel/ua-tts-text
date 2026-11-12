/**
 * Допоміжне для агентів: скласти запит на розв'язання омонімів і перевірити відповідь.
 * Сам виклик LLM лишається за агентом — тут лише детермінована частина.
 */

import type { Homograph } from './review.js';

export interface Decisions {
  [word: string]: 0 | 1;
}

/** Текст запиту для LLM: контекст, два варіанти й формат відповіді. */
export function reviewPrompt(homographs: readonly Homograph[]): string {
  if (homographs.length === 0) return '';

  const lines = homographs.map(
    (item, index) =>
      `${index + 1}. «${item.word}» у реченні: «${item.context}»\n   варіант 0: ${item.variants[0]}\n   варіант 1: ${item.variants[1]}`,
  );

  return [
    'Ти готуєш український текст до озвучки. Нижче — слова, які мають два наголоси.',
    'Для кожного обери варіант 0 або 1 за змістом речення. Не вигадуй нових слів і не змінюй текст.',
    '',
    ...lines,
    '',
    'Поверни лише JSON-обʼєкт виду {"слово": 0}, де ключ — поле word без змін, значення — 0 або 1.',
  ].join('\n');
}

/** Розбирає відповідь моделі. Кидає помилку, якщо це не JSON-об'єкт потрібної форми. */
export function parseDecisions(raw: string): Decisions {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`parseDecisions: not valid JSON (${(error as Error).message})`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('parseDecisions: expected a JSON object');
  }

  const decisions: Decisions = {};
  for (const [word, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value !== 0 && value !== 1) {
      throw new Error(`parseDecisions: value for "${word}" must be 0 or 1`);
    }
    decisions[word] = value;
  }
  return decisions;
}

/** Застосовує рішення агента, повертаючи зрозумілий звіт про те, що не збіглося. */
export function applyDecisions(
  homographs: readonly Homograph[],
  decisions: Decisions,
): { decisions: Decisions; missing: string[]; extra: string[] } {
  const known = new Set(homographs.map((item) => item.key));
  const applied: Decisions = {};
  const missing: string[] = [];

  for (const item of homographs) {
    const choice = decisions[item.key] ?? decisions[item.word];
    if (choice === 0 || choice === 1) applied[item.key] = choice;
    else missing.push(item.word);
  }

  const extra = Object.keys(decisions).filter((word) => !known.has(word));
  return { decisions: applied, missing, extra };
}
