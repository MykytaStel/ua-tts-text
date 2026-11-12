/**
 * Перевірка підготовленого тексту: що людина або агент мають побачити
 * перед тим, як віддавати текст у синтез.
 */

export type IssueKind = 'digits' | 'brackets' | 'abbreviation' | 'latin' | 'spacing';

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
    kind: 'spacing',
    pattern: /\s{2,}|\s+[,.;:!?]|[,.;:!?]\s*[,.;:!?]/gu,
    hint: 'Проблема з пробілами або подвійна пунктуація.',
  },
];

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
