/**
 * Перевірка підготовленого тексту: що людина або агент мають побачити
 * перед тим, як віддавати текст у синтез.
 */

import { normalizeWord, type StressDictionary } from './dict.js';
import { markWord, type StressSymbol } from './stress.js';
import type { StressSource } from './lexicon.js';
import { contextViews, type ContextSource } from './context.js';
import { hasManualStress, tokenizeWords } from './tokenize.js';

export type IssueKind = 'digits' | 'brackets' | 'abbreviation' | 'latin' | 'spacing' | 'foreign';

export interface Issue {
  kind: IssueKind;
  match: string;
  hint: string;
}

const CHECKS: ReadonlyArray<{ kind: IssueKind; pattern: RegExp; hint: string }> = [
  {
    kind: 'digits',
    pattern: /\d+/gu,
    hint: 'У тексті лишились цифри — TTS прочитає їх непередбачувано.',
  },
  {
    kind: 'brackets',
    pattern: /[()[\]{}«»„“”"]/gu,
    hint: 'Дужки й лапки зайві для синтезу: прибери або перепиши речення.',
  },
  {
    kind: 'abbreviation',
    pattern: /(?<![\p{L}])(?:ст|р|рр|тис|грн|напр|т\.д|т\.п)\./gu,
    hint: 'Скорочення не розгорнулось — додай його в таблицю або напиши повністю.',
  },
  {
    kind: 'latin',
    pattern: /(?<![\p{L}])[A-Za-z][A-Za-z'-]{1,}(?![\p{L}])/gu,
    hint: 'Латинка: перевір, чи рушій вимовить її правильно (бренд, назва, термін).',
  },
  {
    kind: 'foreign',
    pattern: /[ыэъёЫЭЪЁ]/gu,
    hint: 'Літери, яких немає в українській: схоже на російське слово або кальку з нього.',
  },
  {
    kind: 'spacing',
    pattern: /\s{2,}|\s+[,.;:!?]|[,.;:!?]\s*[,.;:!?]/gu,
    hint: 'Проблема з пробілами або подвійна пунктуація.',
  },
];

export interface Homograph {
  /** Слово, як воно стоїть у тексті. */
  word: string;
  /** UTF-16 offset in the normalized input. */
  offset?: number;
  /** Ключ для рішень (нижній регістр, звичайний апостроф). */
  key: string;
  /** Два прочитання з наголосом — людина або LLM обирає потрібне. */
  variants: [string, string];
  /** Речення, у якому стоїть слово: без нього вибір робить навмання. */
  context: string;
}

/** Речення навколо позиції — контекст для вибору прочитання. */
function sentenceAt(text: string, index: number): string {
  const boundary = /[.!?\n]/gu;
  let start = 0;
  for (const match of text.matchAll(boundary)) {
    const end = match.index + match[0].length;
    if (end <= index) start = end;
    else break;
  }
  const rest = text.slice(index);
  const tail = rest.search(/[.!?\n]/u);
  const end = tail === -1 ? text.length : index + tail;
  return text.slice(start, end).trim();
}

/** Омоніми в тексті: обидва варіанти наголосу, щоб було з чого вибирати. */
export function homographs(
  text: string,
  dictionary: StressDictionary,
  symbol: StressSymbol = 'acute',
  lexicon?: StressSource,
  /** Омоніми, які розв'язало контекстне правило, у список не потрапляють. */
  context?: ContextSource,
): Homograph[] {
  const result: Homograph[] = [];
  const views = new Map<number, ReturnType<typeof contextViews>[number]['view']>();
  if (context) for (const item of contextViews(text)) views.set(item.index, item.view);
  for (const match of tokenizeWords(text)) {
    const word = match.text;
    if (hasManualStress(word)) continue;
    const key = normalizeWord(word).replace(/-+$/u, '');
    if (key.length < 3) continue;
    const view = views.get(match.start);
    if (context && view && context.resolve(key, view)) continue;
    const hit = lexicon?.lookup(key) ?? dictionary.lookup(key);
    if (!hit || hit.alternative === null || hit.dual) continue;
    result.push({
      word,
      offset: match.start,
      key,
      variants: [markWord(word, [hit.position], symbol), markWord(word, [hit.alternative], symbol)],
      context: sentenceAt(text, match.start),
    });
  }
  return result;
}

/** Знаходить усе, що може зіпсувати озвучку. */
export function lint(text: string): Issue[] {
  const issues: Issue[] = [];
  for (const { kind, pattern, hint } of CHECKS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      issues.push({ kind, match: match[0], hint });
    }
  }
  return issues;
}

/** Короткий людський підсумок для звіту. */
export function summarize(issues: readonly Issue[]): string {
  if (issues.length === 0) return 'Проблем не знайдено.';
  const byKind = new Map<IssueKind, number>();
  for (const issue of issues) byKind.set(issue.kind, (byKind.get(issue.kind) ?? 0) + 1);
  const parts = [...byKind].map(([kind, count]) => `${kind}: ${count}`);
  return parts.join(', ');
}
