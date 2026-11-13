/**
 * Контекстні правила для омонімів: «три ро́ки», але «ці роки́»; «на горі́»; «років тому́».
 *
 * Словник знає, що слово має два прочитання, але не знає, яке з них стоїть у реченні.
 * Частину випадків розв'язує сусіднє слово — прийменник, числівник, сполучник. Правила
 * детерміновані й лежать у TSV, щоб носій мови міг їх читати й доповнювати без коду.
 * Чого правило не покриває — лишається омонімом для людини або LLM, як і раніше.
 *
 * Формат TSV: слово <TAB> наголошене <TAB> умова <TAB> джерело
 *
 * Умова — одна або кілька частин через « & »:
 *   prev:до|від      попереднє слово — одне зі списку
 *   next:що          наступне слово — одне зі списку
 *   prev~ий|ій       попереднє слово закінчується на один із суфіксів
 *   next~ти|тися     наступне слово закінчується на один із суфіксів
 *   first            слово перше у своїй частині речення (після розділового знака)
 *   last             слово останнє у своїй частині речення
 *   *                завжди (типове прочитання; ставиться останнім серед правил слова)
 *
 * Сусіднім вважається лише слово в тій самій частині речення: кома, тире чи крапка
 * між словами розривають зв'язок. Списки можна назвати: рядок «@gen = до|від|без»
 * оголошує набір, а «prev:@gen» його використовує. Правила одного слова перевіряються
 * згори вниз, спрацьовує перше.
 */

import { existsSync, readFileSync } from 'node:fs';
import { normalizeKey, parseStressed } from './lexicon.js';
import { tokenizeWords, plainWord } from './tokenize.js';

/** Що видно навколо слова в його частині речення. */
export interface ContextView {
  /** Попереднє слово (нижній регістр, без наголосів) або null на початку частини. */
  prev: string | null;
  /** Наступне слово або null у кінці частини. */
  next: string | null;
  /** Слово перед попереднім («два великі міста»: для «міста» — «два»). */
  prev2: string | null;
  /** Слово після наступного. */
  next2: string | null;
}

/** Джерело контекстних рішень для `stressify`. */
export interface ContextSource {
  resolve(word: string, view: ContextView): number[] | null;
  explain?(word: string, view: ContextView): { positions: number[]; condition: string; source: string } | null;
}

type Test = (view: ContextView) => boolean;

interface Rule {
  positions: number[];
  tests: Test[];
  condition: string;
  source: string;
}

/** Наступне за позицією слово: у тій самій частині речення чи вже за розділовим знаком. */
const BREAK_RE = /[.,;:!?…()«»"„“”\n—–]|\s-\s/u;

const plain = (word: string): string => normalizeKey(plainWord(word));

/** Сусіди кожного слова тексту — у порядку появи слів. */
export function contextViews(text: string): Array<{ index: number; word: string; view: ContextView }> {
  const words = tokenizeWords(text).map(({ start: index, text: word }) => ({ index, word }));
  return words.map((current, i) => {
    const before = words[i - 1];
    const after = words[i + 1];
    const before2 = words[i - 2];
    const after2 = words[i + 2];
    const linked = (from: number, to: number) => !BREAK_RE.test(text.slice(from, to));
    const prevLinked = before && linked(before.index + before.word.length, current.index);
    const nextLinked = after && linked(current.index + current.word.length, after.index);
    return {
      index: current.index,
      word: current.word,
      view: {
        prev: prevLinked ? plain(before.word) : null,
        next: nextLinked ? plain(after.word) : null,
        prev2: prevLinked && before2 && linked(before2.index + before2.word.length, current.index) ? plain(before2.word) : null,
        next2: nextLinked && after2 && linked(current.index + current.word.length, after2.index) ? plain(after2.word) : null,
      },
    };
  });
}

export class ContextRules implements ContextSource {
  readonly #rules = new Map<string, Rule[]>();
  readonly #sets = new Map<string, string[]>();
  #count = 0;
  #sealed = false;

  /** Завантажує кілька файлів; правила пізніших файлів додаються після ранніх. */
  static loadAll(files: readonly string[]): ContextRules {
    const rules = new ContextRules();
    for (const file of files) {
      if (existsSync(file)) rules.addTsv(readFileSync(file, 'utf8'), file);
    }
    return rules;
  }

  static loadTsv(file: string): ContextRules {
    return ContextRules.loadAll([file]);
  }

  static parse(tsv: string): ContextRules {
    const rules = new ContextRules();
    rules.addTsv(tsv, 'inline');
    return rules;
  }

  /** Додає правила з тексту TSV. Помилка у рядку — виняток із номером рядка, а не тихий пропуск. */
  addTsv(tsv: string, origin = 'tsv'): void {
    if (this.#sealed) throw new Error('context: resource snapshot is immutable');
    tsv.split('\n').forEach((line, i) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const where = `${origin}:${i + 1}`;
      const set = /^@([\p{L}\d_-]+)\s*=\s*(.+)$/u.exec(trimmed);
      if (set) {
        this.#sets.set(set[1]!, this.#list(set[2]!, where));
        return;
      }
      const [word, stressed, condition, source = ''] = trimmed.split('\t').map((cell) => cell.trim());
      if (!word || !stressed || !condition) throw new Error(`context: ${where}: need word, stressed form and condition`);
      let positions: number[];
      try {
        positions = parseStressed(stressed).positions;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`context: ${where}: ${detail}`);
      }
      if (plain(stressed) !== plain(word)) throw new Error(`context: ${where}: "${stressed}" is not a stressed form of "${word}"`);
      this.add(word, positions, condition, source, where);
    });
  }

  add(word: string, positions: readonly number[], condition: string, source = '', where = 'add'): void {
    if (this.#sealed) throw new Error('context: resource snapshot is immutable');
    if (positions.length === 0) throw new Error(`context: ${where}: no stress position for "${word}"`);
    if (positions.length > 2 || new Set(positions).size !== positions.length)
      throw new Error(`context: ${where}: invalid stress positions for "${word}"`);
    const chars = [...word.normalize('NFC')];
    if (positions.some((position) => !Number.isInteger(position) || position < 0 || position >= chars.length || !/[аеєиіїоуяю]/iu.test(chars[position]!)))
      throw new Error(`context: ${where}: stress positions must identify vowels in "${word}"`);
    const tests = condition.split('&').map((part) => this.#test(part.trim(), where));
    const key = normalizeKey(word);
    const list = this.#rules.get(key) ?? [];
    list.push({ positions: [...positions], tests, condition, source });
    this.#rules.set(key, list);
    this.#count += 1;
  }

  /** Скільки правил завантажено. */
  get size(): number {
    return this.#count;
  }

  /** Prevent callers of a shared resource snapshot from changing its decisions. */
  seal(): this {
    this.#sealed = true;
    return this;
  }

  /** Чи є для слова хоч одне правило. */
  has(word: string): boolean {
    return this.#rules.has(normalizeKey(word));
  }

  /** Позиції наголосу, якщо якесь правило слова спрацювало; інакше null. */
  resolve(word: string, view: ContextView): number[] | null {
    return this.explain(word, view)?.positions ?? null;
  }

  /** Те саме, але з умовою й джерелом правила — для звітів і налагодження. */
  explain(word: string, view: ContextView): { positions: number[]; condition: string; source: string } | null {
    const rules = this.#rules.get(normalizeKey(word));
    if (!rules) return null;
    const hit = rules.find((rule) => rule.tests.every((test) => test(view)));
    return hit ? { positions: [...hit.positions], condition: hit.condition, source: hit.source } : null;
  }

  #list(raw: string, where: string): string[] {
    return raw.split('|').flatMap((item) => {
      const value = item.trim();
      if (!value) return [];
      if (!value.startsWith('@')) return [normalizeKey(value)];
      const named = this.#sets.get(value.slice(1));
      if (!named) throw new Error(`context: ${where}: unknown set "${value}"`);
      return named;
    });
  }

  #test(part: string, where: string): Test {
    if (part === '*') return () => true;
    if (part === 'first') return (view) => view.prev === null;
    if (part === 'last') return (view) => view.next === null;
    const match = /^(prev2|next2|prev|next)([:~])(.+)$/u.exec(part);
    if (!match) throw new Error(`context: ${where}: cannot read condition "${part}"`);
    const side = match[1] as 'prev' | 'next' | 'prev2' | 'next2';
    const values = this.#list(match[3]!, where);
    if (values.length === 0) throw new Error(`context: ${where}: empty list in "${part}"`);
    if (match[2] === ':') {
      const set = new Set(values);
      return (view) => view[side] !== null && set.has(view[side]);
    }
    return (view) => {
      const neighbour = view[side];
      return neighbour !== null && values.some((suffix) => neighbour.length > suffix.length && neighbour.endsWith(suffix));
    };
  }
}
