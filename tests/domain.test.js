import assert from 'node:assert/strict';
import {
  activeRecords, buildLocator, calculateProgress, calculateStatistics, globalSearch,
  headingsFromMarkdown, splitTextSections,
} from '../src/domain.js';

assert.deepEqual(activeRecords([{ id: 1 }, { id: 2, deletedAt: 'x' }]).map(x => x.id), [1]);
const sections = [{ id: 'a', order: 0, text: '12345' }, { id: 'b', order: 1, text: '67890' }];
const locator = buildLocator({ id: 'book', format: 'TXT' }, sections[1], 2);
assert.equal(locator.kind, 'TEXT');
assert.equal(calculateProgress(sections, locator), 0.7);
assert.deepEqual(headingsFromMarkdown('# 标题\n正文\n## 小节').map(x => x.label), ['标题', '小节']);
assert.equal(splitTextSections('一\n\n二', { maxLength: 2 }).length, 2);
const search = globalSearch({ books: [{ id: 'b', title: '美丽新世界', author: '赫胥黎' }], notes: [{ id: 'n', content: '自由', tagIds: ['t'] }], tags: [{ id: 't', name: '思想' }] }, '思想');
assert.equal(search.notes.length, 1);
assert.equal(search.tags.length, 1);
const stats = calculateStatistics({ books: [{ id: 'b' }], notes: [{ id: 'n' }], highlights: [], sessions: [{ startedAt: new Date().toISOString(), activeSeconds: 125 }] });
assert.equal(stats.todayMinutes, 2);
assert.equal(stats.bookCount, 1);
console.log('domain: 10 assertions passed');
