/** Build a W3C Pronunciation Lexicon Specification file with explicit IPA entries. */

export interface IpaPronunciationEntry {
  /** Exact spelling that the TTS provider matches. Matching is case-sensitive. */
  readonly grapheme: string;
  /** IPA transcription accepted by the target provider. */
  readonly phoneme: string;
}

export interface IpaPlsOptions {
  /** Unicode locale identifier for the lexicon. Defaults to uk-UA. */
  readonly language?: string;
}

const PLS_NAMESPACE = 'http://www.w3.org/2005/01/pronunciation-lexicon';
const PLS_SCHEMA = 'http://www.w3.org/TR/2007/CR-pronunciation-lexicon-20071212/pls.xsd';

function assertXmlCharacters(value: string, label: string): void {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    const valid = codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff);
    if (!valid) throw new TypeError(`createIpaPls: ${label} contains an invalid XML character`);
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');
}

/**
 * Create a case-sensitive IPA PLS lexicon for providers such as ElevenLabs v4.
 * Pronunciations are explicit input; this function does not guess IPA.
 */
export function createIpaPls(
  entries: readonly IpaPronunciationEntry[],
  options: IpaPlsOptions = {},
): string {
  if (!Array.isArray(entries) || entries.length === 0)
    throw new RangeError('createIpaPls: provide at least one pronunciation entry');

  let language: string;
  try {
    language = new Intl.Locale(options.language ?? 'uk-UA').toString();
  } catch {
    throw new TypeError('createIpaPls: language must be a valid Unicode locale identifier');
  }

  const seen = new Set<string>();
  const lexemes = Array.from(entries, (entry, index) => {
    if (!entry || typeof entry.grapheme !== 'string' || typeof entry.phoneme !== 'string')
      throw new TypeError(`createIpaPls: entry ${index + 1} must contain grapheme and phoneme strings`);
    const { grapheme, phoneme } = entry;
    if (!grapheme || !phoneme)
      throw new TypeError(`createIpaPls: entry ${index + 1} must not be empty`);
    if (/[\r\n\t]/u.test(grapheme) || /[\r\n\t]/u.test(phoneme))
      throw new TypeError(`createIpaPls: entry ${index + 1} must be a single line`);
    assertXmlCharacters(grapheme, `entry ${index + 1} grapheme`);
    assertXmlCharacters(phoneme, `entry ${index + 1} phoneme`);
    if (grapheme !== grapheme.trim() || phoneme !== phoneme.trim())
      throw new TypeError(`createIpaPls: entry ${index + 1} must not have surrounding whitespace`);
    if (seen.has(grapheme)) throw new Error(`createIpaPls: duplicate grapheme "${grapheme}"`);
    seen.add(grapheme);
    return `  <lexeme>\n    <grapheme>${escapeXml(grapheme)}</grapheme>\n    <phoneme>${escapeXml(phoneme)}</phoneme>\n  </lexeme>`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<lexicon version="1.0" xmlns="${PLS_NAMESPACE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${PLS_NAMESPACE} ${PLS_SCHEMA}" alphabet="ipa" xml:lang="${escapeXml(language)}">`,
    ...lexemes,
    '</lexicon>',
    '',
  ].join('\n');
}
