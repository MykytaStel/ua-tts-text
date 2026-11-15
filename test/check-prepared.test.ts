import { expect, it } from 'vitest';
import { checkPrepared, prepare } from '../src/index.js';
import { StressDictionary } from '../src/dict.js';

it('passes clean prepared speech while ignoring intentional unsupported-stress warnings', () => {
  const prepared = prepare('Так.', { dictionary: StressDictionary.empty(), engine: 'edge-tts' });

  expect(checkPrepared(prepared)).toEqual({ passed: true, findings: [] });
});

it('reports unresolved words, lint issues, and missing dictionary resources', () => {
  const dictionary = StressDictionary.empty();
  const prepared = prepare('Краудфандинг S24', {
    dictionary,
    engine: 'tts-uk',
    stress: { minReportLength: 1 },
  });
  const check = checkPrepared(prepared);

  expect(check.passed).toBe(false);
  expect(check.findings.map((finding) => finding.kind)).toEqual(expect.arrayContaining(['unknown-word', 'lint']));

  const missingDictionary = checkPrepared(prepare('Так', { engine: 'tts-uk' }));
  expect(missingDictionary.findings).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'resource' })]));
});
