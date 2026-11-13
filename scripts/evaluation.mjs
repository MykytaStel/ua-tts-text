import { hasManualStress, plainWord, tokenizeWords } from '../dist/tokenize.js';
export const QUALITY_FLOORS = Object.freeze({ precision: 1, recall: 0.969 });

/** Release gate: no false positives, at most the current known recall misses, and exact token preservation. */
export function qualityFailures(metrics, floors = QUALITY_FLOORS) {
  const precision = metrics.tp / (metrics.tp + metrics.fp) || 0;
  const recall = metrics.tp / (metrics.tp + metrics.fn) || 0;
  const failures = [];
  if (precision < floors.precision) failures.push(`precision ${(precision * 100).toFixed(1)}% is below ${(floors.precision * 100).toFixed(1)}%`);
  if (recall < floors.recall) failures.push(`recall ${(recall * 100).toFixed(1)}% is below ${(floors.recall * 100).toFixed(1)}%`);
  if (metrics.exactTextRows !== metrics.rows) failures.push(`token preservation ${metrics.exactTextRows}/${metrics.rows} rows`);
  return failures;
}

function stressPositions(word) {
  const positions = [];
  let plainIndex = 0;
  const chars = [...word];
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (char === '+' && /[аеєиіїоуяю]/iu.test(chars[i + 1] ?? '')) {
      positions.push(plainIndex);
      continue;
    }
    if (char === '\u0301' || char === '\u00b4') {
      if (plainIndex > 0) positions.push(plainIndex - 1);
      continue;
    }
    if (char === '+') continue;
    plainIndex++;
  }
  return positions;
}
function words(text) {
  const counts = new Map();
  return tokenizeWords(text).map(({ text: token }) => {
    const key = plainWord(token).normalize('NFC').toLowerCase().replace(/[’ʼ`]/gu, "'");
    const occurrence = counts.get(key) ?? 0;
    counts.set(key, occurrence + 1);
    const marks = stressPositions(token).sort((a, b) => a - b);
    if (hasManualStress(token) && marks.length === 0) throw new Error(`evaluation: malformed stress mark in "${token}"`);
    return {
      id: `${key}#${occurrence}`,
      key,
      marks,
      marked: hasManualStress(token),
    };
  });
}
/** Compare every token occurrence and all stress marks; token fidelity is reported separately. */
export function compareText(expectedText, actualText) {
  const expected = words(expectedText);
  const actual = words(actualText);
  const wanted = new Map(expected.map((item) => [item.id, item]));
  const got = new Map(actual.map((item) => [item.id, item]));
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let missingWords = 0;
  let extraWords = 0;
  const errors = [];
  for (const item of expected) {
    const result = got.get(item.id);
    if (!result) {
      missingWords++;
      if (item.marked) fn++;
      errors.push({ word: item.key, issue: 'missing word' });
      continue;
    }
    if (!item.marked && !result.marked) continue;
    const expectedMarks = item.marks;
    const actualMarks = result.marks;
    const exactMarks =
      expectedMarks.length === actualMarks.length && expectedMarks.every((mark, index) => mark === actualMarks[index]);
    const correct = item.marked && result.marked && exactMarks;
    if (correct) tp++;
    else {
      const counts = (marks) => {
        const result = new Map();
        for (const mark of marks) result.set(mark, (result.get(mark) ?? 0) + 1);
        return result;
      };
      const expectedCounts = counts(expectedMarks);
      const actualCounts = counts(actualMarks);
      const hasWrongMark =
        (result.marked && actualMarks.length === 0) ||
        [...actualCounts].some(([mark, count]) => count > (expectedCounts.get(mark) ?? 0));
      const missedExpectedMark = [...expectedCounts].some(([mark, count]) => count > (actualCounts.get(mark) ?? 0));
      if (!item.marked || hasWrongMark) fp++;
      if (item.marked && missedExpectedMark) fn++;
      errors.push({ word: item.key, expected: expectedMarks, actual: actualMarks });
    }
  }
  for (const item of actual)
    if (!wanted.has(item.id)) {
      extraWords++;
      if (item.marked) fp++;
      errors.push({ word: item.key, issue: 'extra word' });
    }
  const expectedIds = new Set(expected.map((item) => item.id));
  const actualIds = new Set(actual.map((item) => item.id));
  const matchedWords = [...expectedIds].filter((id) => actualIds.has(id)).length;
  return {
    tp,
    fp,
    fn,
    missingWords,
    extraWords,
    expectedWords: expected.length,
    actualWords: actual.length,
    matchedWords,
    errors,
    exactText: missingWords === 0 && extraWords === 0,
  };
}
