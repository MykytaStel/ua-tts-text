/** Shared Ukrainian word tokenizer. Offsets are UTF-16 indexes into the input. */
export interface WordToken {
  text: string;
  start: number;
  end: number;
}
const WORD_RE = /\+?[\p{L}][\p{L}\u2019\u02bc'`+\p{M}-]*/gu;
export function tokenizeWords(text: string): WordToken[] {
  return [...text.matchAll(WORD_RE)].map((m) => ({ text: m[0], start: m.index, end: m.index + m[0].length }));
}
export function plainWord(word: string): string {
  return word
    .replace(/^\+/u, '')
    .replace(/\+/gu, '')
    .replace(/\u{0301}/gu, '')
    .replace(/-+$/u, '');
}
export function hasManualStress(word: string): boolean {
  return /\+|\u{0301}/u.test(word);
}
