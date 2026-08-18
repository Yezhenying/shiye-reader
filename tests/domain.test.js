import assert from 'node:assert/strict';
import {
  activeRecords, buildLegacyRescueRecords, buildLocator, calculateProgress, calculateStatistics,
  creditedActivitySeconds, globalSearch, headingsFromMarkdown, normalizeBook, splitSessionByLocalDate,
  splitTextSections,
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
const preserved = normalizeBook({ id: 'b', title: '书', fingerprint: 'abc', activeFileId: 'f', toc: [{ label: '章' }], language: 'zh', parseWarnings: ['warning'] });
assert.equal(preserved.fingerprint, 'abc');
assert.equal(preserved.activeFileId, 'f');
assert.equal(preserved.toc.length, 1);
assert.deepEqual(normalizeBook({ categoryIds: ['primary', 'legacy-extra'] }).categoryIds, ['primary']);
assert.equal(calculateProgress(sections, buildLocator({ id: 'pdf', format: 'PDF' }, sections[1], 0, { pageProgression: 0.5 })), 0.75);
assert.equal(creditedActivitySeconds(0, 125000), 60);
const midnight = new Date(); midnight.setHours(23, 59, 30, 0);
const split = splitSessionByLocalDate({ startedAt: midnight.toISOString(), endedAt: new Date(midnight.getTime() + 60000).toISOString(), activeSeconds: 60 });
assert.equal(split.length, 2);
assert.equal(Math.round(split.reduce((sum, part) => sum + part.seconds, 0)), 60);
const streakNow = new Date(); streakNow.setHours(12, 0, 0, 0);
const streakSessions = Array.from({ length: 9 }, (_, offset) => { const date = new Date(streakNow); date.setDate(date.getDate() - offset); return { startedAt: date.toISOString(), endedAt: new Date(date.getTime() + 60000).toISOString(), activeSeconds: 60 }; });
assert.equal(calculateStatistics({ books: [], notes: [], highlights: [], sessions: streakSessions, now: streakNow }).streak, 9);
const legacy = buildLegacyRescueRecords([{ id: 'same', title: '旧书', contentPreview: '正文' }], [{ id: 'note', bookId: 'same', note: '想法' }], '2020-01-01T00:00:00.000Z');
assert.equal(legacy.sections[0].id, 'section-same-0');
assert.equal(buildLegacyRescueRecords([{ id: 'same', title: '旧书', contentPreview: '正文' }], [], '2020-01-01T00:00:00.000Z').sections[0].id, legacy.sections[0].id);
console.log('domain: 22 assertions passed');
