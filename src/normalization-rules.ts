/** Project-specific, literal reading rules for abbreviations and terms. */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export type NormalizationRuleStatus = 'draft' | 'verified' | 'rejected';

export interface NormalizationRule {
  readonly match: string;
  readonly replacement: string;
  readonly source: string;
  readonly status: NormalizationRuleStatus;
}

export interface NormalizationRuleOptions {
  source: string;
  status?: NormalizationRuleStatus;
}

const RESERVED_TOKEN = /[\uE100-\uF9FF]/u;
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/u;
const WORD_CHARACTER = '[\\p{L}\\p{N}\\p{M}_\\p{Pd}\'’ʼ]';

function keyOf(value: string): string {
  return value.normalize('NFC').replace(/[’ʼ`´]/gu, "'").trim().replace(/\s+/gu, ' ').toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function parseStatus(value: string | undefined): NormalizationRuleStatus {
  const status = value || 'verified';
  if (status !== 'draft' && status !== 'verified' && status !== 'rejected')
    throw new Error(`invalid status "${status}"`);
  return status;
}

/**
 * Validated literal substitutions. Matching is Unicode case-insensitive, ignores
 * repeated whitespace inside a phrase, prefers the longest phrase, and never
 * runs replacement text through another rule.
 */
export class NormalizationRules {
  readonly #entries = new Map<string, NormalizationRule>();
  #sealed = false;
  #matcher: RegExp | null = null;

  static parseTsv(tsv: string, origin = 'inline'): NormalizationRules {
    const rules = new NormalizationRules();
    const seen = new Set<string>();
    for (const [lineIndex, line] of tsv.split('\n').entries()) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const where = `${origin}:${lineIndex + 1}`;
      try {
        const cells = trimmed.split('\t');
        if (cells.length > 4) throw new Error('expected at most four TSV columns');
        const [match, replacement, source, rawStatus] = cells;
        if (!match || !replacement || !source) throw new Error('need match, replacement, and source');
        if (match !== match.trim() || replacement !== replacement.trim())
          throw new Error('match and replacement must not have leading or trailing spaces');
        if (match.length > 128) throw new Error('match must be at most 128 UTF-16 code units');
        if (replacement.length > 256) throw new Error('replacement must be at most 256 UTF-16 code units');
        if (CONTROL_CHARACTER.test(match) || CONTROL_CHARACTER.test(replacement) || CONTROL_CHARACTER.test(source))
          throw new Error('control characters are not allowed');
        if (RESERVED_TOKEN.test(match) || RESERVED_TOKEN.test(replacement)) throw new Error('reserved token characters are not allowed');
        const key = keyOf(match);
        if (seen.has(key)) throw new Error(`duplicate match "${match}"`);
        seen.add(key);
        rules.add(match, replacement, { source, status: parseStatus(rawStatus) });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`normalization rules: ${where}: ${detail}`);
      }
    }
    return rules;
  }

  static loadTsv(file: string): NormalizationRules {
    return NormalizationRules.parseTsv(readFileSync(file, 'utf8'), file);
  }

  get entries(): readonly NormalizationRule[] {
    return Object.freeze([...this.#entries.values()].map((entry) => Object.freeze({ ...entry })));
  }

  get inactiveEntries(): readonly NormalizationRule[] {
    return Object.freeze(this.entries.filter((entry) => entry.status !== 'verified'));
  }

  get fingerprint(): string {
    const rows = [...this.#entries.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }

  add(match: string, replacement: string, options: NormalizationRuleOptions): void {
    this.#assertMutable();
    const normalizedMatch = match.normalize('NFC').replace(/[’ʼ`´]/gu, "'").replace(/\s+/gu, ' ');
    const normalizedReplacement = replacement.normalize('NFC');
    if (!normalizedMatch || !normalizedReplacement || !options.source.trim())
      throw new Error('normalization rules: match, replacement, and source are required');
    if (normalizedMatch !== normalizedMatch.trim() || normalizedReplacement !== normalizedReplacement.trim())
      throw new Error('normalization rules: match and replacement must not have leading or trailing spaces');
    if (normalizedMatch.length > 128 || normalizedReplacement.length > 256)
      throw new Error('normalization rules: match/replacement exceeds the supported length');
    if (CONTROL_CHARACTER.test(normalizedMatch) || CONTROL_CHARACTER.test(normalizedReplacement) || CONTROL_CHARACTER.test(options.source))
      throw new Error('normalization rules: control characters are not allowed');
    if (RESERVED_TOKEN.test(normalizedMatch) || RESERVED_TOKEN.test(normalizedReplacement))
      throw new Error('normalization rules: reserved token characters are not allowed');
    const status = options.status ?? 'verified';
    if (status !== 'draft' && status !== 'verified' && status !== 'rejected')
      throw new Error(`normalization rules: invalid status "${String(status)}"`);
    const key = keyOf(normalizedMatch);
    if (!this.#entries.has(key) && this.#entries.size >= 4096)
      throw new Error('normalization rules: at most 4096 entries are supported');
    this.#entries.set(key, {
      match: normalizedMatch,
      replacement: normalizedReplacement,
      source: options.source.trim(),
      status,
    });
    this.#matcher = null;
  }

  /** Later sources override an identical normalized phrase. */
  merge(other: NormalizationRules): void {
    this.#assertMutable();
    for (const entry of other.#entries.values()) this.#entries.set(keyOf(entry.match), { ...entry });
    this.#matcher = null;
  }

  seal(): this {
    this.#sealed = true;
    return this;
  }

  explain(match: string): NormalizationRule | null {
    const entry = this.#entries.get(keyOf(match));
    return entry ? Object.freeze({ ...entry }) : null;
  }

  /** Apply active rules once; `protect` can keep replacements out of later passes. */
  apply(input: string, protect: (replacement: string) => string = (replacement) => replacement): string {
    this.#compile();
    if (!this.#matcher) return input;
    return input.replace(this.#matcher, (matched) => {
      const entry = this.#entries.get(keyOf(matched));
      return entry?.status === 'verified' ? protect(entry.replacement) : matched;
    });
  }

  #compile(): void {
    if (this.#matcher) return;
    const active = [...this.#entries.entries()]
      .filter(([, entry]) => entry.status === 'verified')
      .sort(([keyA, a], [keyB, b]) => b.match.length - a.match.length || (keyA < keyB ? -1 : keyA > keyB ? 1 : 0));
    if (active.length === 0) {
      this.#matcher = null;
      return;
    }
    const alternatives = active.map(([, entry]) => entry.match.split(/\s+/u).map(escapeRegExp).join('\\s+'));
    this.#matcher = new RegExp(`(?<!${WORD_CHARACTER})(${alternatives.join('|')})(?!${WORD_CHARACTER})`, 'giu');
  }

  #assertMutable(): void {
    if (this.#sealed) throw new Error('normalization rules: immutable resource snapshot');
  }
}
