/** Occurrence review of normalized TTS output; offsets refer to that output, not source text. */
import { hasManualStress, plainWord, tokenizeWords } from '../dist/tokenize.js';
const keyOf = (word) => word.toLowerCase().replace(/[’ʼ`]/gu, "'");
export function collectOccurrences(result, file) {
  const unresolved = new Set([...result.ambiguous, ...result.unknown].map(keyOf));
  const variants = new Map(result.homographs.map((item) => [keyOf(item.key), item.variants]));
  const sentences = [...new Intl.Segmenter('uk', { granularity: 'sentence' }).segment(result.text)];
  const found = [];
  let sentenceIndex = 0;
  for (const match of tokenizeWords(result.text)) {
    const word = match.text;
    if (hasManualStress(word)) continue;
    const key = keyOf(plainWord(word));
    if (!unresolved.has(key)) continue;
    while (sentenceIndex + 1 < sentences.length && sentences[sentenceIndex + 1].index <= match.start) sentenceIndex++;
    const sentence = sentences[sentenceIndex];
    found.push({
      id: `${file}:${match.start}`,
      file,
      key,
      word,
      offset: match.start,
      sentence: sentence.segment.replace(/[+\u0301]/gu, '').trim(),
      variants: variants.get(key) ?? [],
      choice: null,
    });
  }
  return found;
}
const cell = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '&#124;')
    .replace(/[\r\n]+/g, ' ');
export function reviewMarkdown(report) {
  const lines = [
    '# Наголоси: перегляд входжень',
    '',
    'Контекст — нормалізований текст для TTS. Зсуви UTF-16 стосуються вихідного TTS-тексту, не рядків початкового файлу.',
    'Запишіть повну наголошену форму в «вибір». Порожнє поле означає невирішений випадок.',
    'Покриття наголосами не є точністю. Речення для налаштування правил слід оцінювати окремо від відкладених сценаріїв.',
    '',
    '| ID | слово | контекст | варіанти | вибір |',
    '|---|---|---|---|---|',
  ];
  for (const item of report.occurrences)
    lines.push(`| ${cell(item.id)} | ${cell(item.word)} | ${cell(item.sentence)} | ${cell(item.variants.join(' / '))} | |`);
  return lines.join('\n') + '\n';
}
