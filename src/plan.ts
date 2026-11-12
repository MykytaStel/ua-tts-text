/**
 * План мовлення: як розбити текст на фрази й скільки тримати паузу.
 *
 * Це не модель інтонації — та потребує тренованої акустики. Це детермінований
 * план: межі речень і підрядних частин, паузи під них і оцінка тривалості.
 * Рушії, що розуміють SSML, отримують точні паузи; решта — пунктуацію.
 */

export type SegmentKind = 'statement' | 'question' | 'exclamation';

export interface SpeechSegment {
  text: string;
  kind: SegmentKind;
  /** Пауза після сегмента в мілісекундах (0 — кінець тексту). */
  pauseAfterMs: number;
  /** Скільки слів у сегменті — для оцінки тривалості. */
  words: number;
}

export interface SpeechPlan {
  segments: SpeechSegment[];
  /** Орієнтовна тривалість озвучки, мс. */
  estimatedMs: number;
}

export interface PlanOptions {
  /** Пауза між реченнями. */
  sentencePauseMs?: number;
  /** Пауза на комі, тире, двокрапці. */
  clausePauseMs?: number;
  /** Темп мовлення, слів за хвилину. */
  wordsPerMinute?: number;
}

const SENTENCE_RE = /[^.!?…]+[.!?…]*/gu;
const CLAUSE_RE = /[^,;:—–]+[,;:—–]?/gu;

function kindOf(text: string): SegmentKind {
  const last = text.trim().at(-1);
  if (last === '?') return 'question';
  if (last === '!') return 'exclamation';
  return 'statement';
}

function wordCount(text: string): number {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) ?? []).length;
}

/**
 * Розбиває текст на фрази, додає паузи й оцінює тривалість.
 * Довгі підрядні частини не переписуються — це рішення автора тексту.
 */
export function planSpeech(text: string, options: PlanOptions = {}): SpeechPlan {
  const sentencePauseMs = options.sentencePauseMs ?? 480;
  const clausePauseMs = options.clausePauseMs ?? 220;
  const wordsPerMinute = options.wordsPerMinute ?? 150;

  const segments: SpeechSegment[] = [];
  const sentences = [...text.matchAll(SENTENCE_RE)].map((match) => match[0].trim()).filter(Boolean);

  sentences.forEach((sentence, sentenceIndex) => {
    const clauses = [...sentence.matchAll(CLAUSE_RE)].map((match) => match[0].trim()).filter(Boolean);
    clauses.forEach((clause, clauseIndex) => {
      const isLastClause = clauseIndex === clauses.length - 1;
      const isLastSentence = sentenceIndex === sentences.length - 1;
      segments.push({
        text: clause,
        kind: kindOf(clause),
        pauseAfterMs: isLastClause ? (isLastSentence ? 0 : sentencePauseMs) : clausePauseMs,
        words: wordCount(clause),
      });
    });
  });

  const speechMs = (segments.reduce((sum, segment) => sum + segment.words, 0) / wordsPerMinute) * 60_000;
  const pauseMs = segments.reduce((sum, segment) => sum + segment.pauseAfterMs, 0);
  return { segments, estimatedMs: Math.round(speechMs + pauseMs) };
}

const escapeSsml = (value: string) => value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

/**
 * Рендер плану: `ssml` — з точними паузами, `plain` — той самий текст із
 * пунктуацією (для рушіїв без SSML).
 */
export function renderPlan(plan: SpeechPlan, profile: 'plain' | 'ssml'): string {
  if (profile === 'plain') return plan.segments.map((segment) => segment.text).join(' ').trim();
  const body = plan.segments
    .map((segment, index) => {
      const text = escapeSsml(segment.text);
      const isLast = index === plan.segments.length - 1;
      return isLast || segment.pauseAfterMs === 0 ? text : `${text}<break time="${segment.pauseAfterMs}ms"/>`;
    })
    .join(' ');
  return `<speak>${body}</speak>`;
}
