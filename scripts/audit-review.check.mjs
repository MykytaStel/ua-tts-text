import test from 'node:test';
import assert from 'node:assert/strict';
import { collectOccurrences, reviewMarkdown } from './audit-review.mjs';
const result = (text) => ({ text, ambiguous: ['мала'], unknown: [], homographs: [{key:'мала', variants:['ма́ла','мала́']}] });
test('counts repeated unresolved occurrences, excludes resolved occurrences of same word', () => {
 const found = collectOccurrences(result('Мала раділа. Вона мала м’яч, а м+ала сестра спала.'), 'story.txt');
 assert.equal(found.length, 2);
 assert.equal(found[0].sentence, 'Мала раділа.');
 assert.equal(found[1].sentence, 'Вона мала м’яч, а мала сестра спала.');
 assert.notEqual(found[0].id, found[1].id);
 assert.deepEqual(found[1].variants, ['ма́ла','мала́']);
});
test('acute-marked words are not split into unresolved fragments', () => {
 assert.equal(collectOccurrences(result('ма́ла мала́ мала'), 'story.txt').length, 1);
});
test('Markdown escapes table delimiters and HTML', () => {
 const markdown = reviewMarkdown({occurrences: collectOccurrences(result('мала | <b>'), 'a|b.txt')});
 assert.ok(markdown.includes('&#124;'));
 assert.ok(markdown.includes('&lt;b&gt;'));
 assert.ok(!markdown.includes('<b>'));
});
