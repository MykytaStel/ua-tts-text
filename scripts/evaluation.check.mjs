import test from 'node:test';
import assert from 'node:assert/strict';
import { compareText, qualityFailures } from './evaluation.mjs';
test('strict release gate rejects worse stress scores and changed token sequences', () => {
  const baseline = { tp: 128, fp: 0, fn: 4, exactTextRows: 28, rows: 28 };
  assert.deepEqual(qualityFailures(baseline), []);
  assert.equal(qualityFailures({ ...baseline, fp: 1 })[0]?.startsWith('precision'), true);
  assert.equal(qualityFailures({ ...baseline, fn: 5 })[0]?.startsWith('recall'), true);
  assert.equal(qualityFailures({ ...baseline, exactTextRows: 27 })[0]?.startsWith('token preservation'), true);
});
test('scores every occurrence and requires all predicted marks to be licensed', () => {
  const result = compareText('ро́ки́ роки', 'ро́ки́ ро́ки');
  assert.equal(result.tp, 1);
  assert.equal(result.fp, 1);
  assert.equal(result.fn, 0);
});
test('requires every expected mark and penalizes duplicate marks', () => {
  const missingOne = compareText('ро́ки́', 'ро́ки');
  assert.equal(missingOne.tp, 0);
  assert.equal(missingOne.fn, 1);
  const duplicate = compareText('сло́во', 'сло́́во');
  assert.equal(duplicate.tp, 0);
  assert.equal(duplicate.fp, 1);
});
test('penalizes a correct mark plus an extra wrong mark', () => {
  const result = compareText('сло́во', 'сло́во́');
  assert.equal(result.tp, 0);
  assert.equal(result.fp, 1);
  assert.equal(result.fn, 0);
});
test('penalizes missing and extra words independently from stress scores', () => {
  const result = compareText('сло́во', 'зайве сло́во');
  assert.equal(result.extraWords, 1);
  assert.equal(result.exactText, false);
});
test('counts a missing expected stress as a false negative', () => {
  assert.equal(compareText('сло́во', '').fn, 1);
});
test('understands plus-before and acute-after stress positions', () => {
  assert.equal(compareText('сло́во', 'сл+ово').tp, 1);
});
