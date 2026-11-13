import { expect, it } from 'vitest';
import { StressDictionary } from '../src/dict.js';

function oneEntryDictionary(key: string, primary: number, alternative = 255, flags = 0): Buffer {
  const keyBytes = Buffer.from(key, 'utf8');
  const result = Buffer.alloc(16 + 8 + 3 + keyBytes.length);
  result.write('UATS3\u0000\u0000\u0000', 0, 'latin1');
  result.writeUInt32LE(1, 8);
  result.writeUInt32LE(0, 12);
  result.writeUInt32LE(0, 16);
  result.writeUInt32LE(keyBytes.length, 20);
  result[24] = primary;
  result[25] = alternative;
  result[26] = flags;
  keyBytes.copy(result, 27);
  return result;
}

it('ignores malformed stress rows while retaining the rest of the binary index', () => {
  const dictionary = StressDictionary.loadBuffer(oneEntryDictionary('слово', 2, 1));
  expect(dictionary.lookup('слово')).toBeNull();
  expect(dictionary.invalidEntryCount).toBe(1);
});

it('rejects malformed binary offsets before lookup', () => {
  const broken = oneEntryDictionary('слово', 1);
  broken.writeUInt32LE(99, 20);
  expect(() => StressDictionary.loadBuffer(broken)).toThrow(/invalid key table bounds/);
});
