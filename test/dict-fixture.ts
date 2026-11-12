import { existsSync } from 'node:fs';
import { describe } from 'vitest';
import { fileURLToPath } from 'node:url';
import { StressDictionary } from '../src/dict.js';

export const dictFile = fileURLToPath(new URL('../data/dict.bin', import.meta.url));

/** Публічний клон не містить 75 МБ словника — тести, що його потребують, скіпаються. */
export const hasDict = existsSync(dictFile);

export const describeDict = hasDict ? describe : describe.skip;

export function loadDictFixture(): StressDictionary {
  return StressDictionary.load(dictFile);
}
