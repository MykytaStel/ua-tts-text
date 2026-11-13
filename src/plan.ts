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
  /** Чи варто підсилити фразу: заперечення, контраст, оклик. */
  emphasis: boolean;
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
  /**
   * Темп мовлення, слів за хвилину. Типове 125 — виміряно на реальному
   * аудіо tts-uk (62 слова за 30,3 с), а не взято з голови.
   */
  wordsPerMinute?: number;
}

/**
 * Маркери, після яких фразу варто підсилити: заперечення й контраст
 * тримають на собі увагу, а оклик підсилює сам себе.
 */
const EMPHASIS_RE = /(?:^|[\s,(])(?:не|ні|але|проте|однак|саме|лише|тільки|навіть)(?:[\s,.)]|$)/iu;

import { tokenizeWords } from './tokenize.js';

const SENTENCE_RE = /[^.!?…]+[.!?…]*/gu;
const CLAUSE_RE = /[^,;:—–]+[,;:—–]?/gu;

function kindOf(text: string): SegmentKind {
  const last = text.trim().at(-1);
  if (last === '?') return 'question';
  if (last === '!') return 'exclamation';
  return 'statement';
}

function wordCount(text: string): number {
  return tokenizeWords(text).length;
}

/**
 * Розбиває текст на фрази, додає паузи й оцінює тривалість.
 * Довгі підрядні частини не переписуються — це рішення автора тексту.
 */
export function planSpeech(text: string, options: PlanOptions = {}): SpeechPlan {
  const sentencePauseMs = options.sentencePauseMs ?? 480;
  const clausePauseMs = options.clausePauseMs ?? 220;
  const wordsPerMinute = options.wordsPerMinute ?? 125;

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
        emphasis: EMPHASIS_RE.test(clause) || kindOf(clause) === 'exclamation',
      });
    });
  });

  // wpm виміряно на живому аудіо разом із паузами на пунктуації, тому додавати
  // pauseAfterMs ще раз не можна — буде подвійний облік.
  const speechMs = (segments.reduce((sum, segment) => sum + segment.words, 0) / wordsPerMinute) * 60_000;
  return { segments, estimatedMs: Math.round(speechMs) };
}

const escapeSsml = (value: string) => value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

/**
 * Рендер плану: `ssml` — з точними паузами, `plain` — той самий текст із
 * пунктуацією (для рушіїв без SSML).
 */
export function renderPlan(plan: SpeechPlan, profile: 'plain' | 'ssml'): string {
  if (profile === 'plain')
    return plan.segments
      .map((segment) => segment.text)
      .join(' ')
      .trim();
  const body = plan.segments
    .map((segment, index) => {
      const raw = escapeSsml(segment.text);
      const text = segment.emphasis ? `<emphasis level="moderate">${raw}</emphasis>` : raw;
      const isLast = index === plan.segments.length - 1;
      return isLast || segment.pauseAfterMs === 0 ? text : `${text}<break time="${segment.pauseAfterMs}ms"/>`;
    })
    .join(' ');
  return `<speak>${body}</speak>`;
}
