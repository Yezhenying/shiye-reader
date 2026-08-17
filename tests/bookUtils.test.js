import assert from 'node:assert/strict';
import { buildMarkdown, mapOpenLibraryBook, normalizeImportedBooks } from '../src/bookUtils.js';

assert.equal(mapOpenLibraryBook(null), null);
assert.equal(mapOpenLibraryBook({ title: '' }), null);
const mapped = mapOpenLibraryBook({ key: '/works/OL1W', title: '测试书', author_name: ['甲'], cover_i: 12, first_publish_year: 2020, isbn: ['123'] });
assert.equal(mapped.title, '测试书');
assert.equal(mapped.coverUrl, 'https://covers.openlibrary.org/b/id/12-M.jpg');
assert.equal(mapped.id, 'ol--works-OL1W');
const restored = normalizeImportedBooks([{ title: '  书名 ', progress: 160, coverUrl: 'javascript:bad' }, null]);
assert.equal(restored.length, 1);
assert.equal(restored[0].progress, 100);
assert.equal(restored[0].coverUrl, '');
assert.match(buildMarkdown([{ title: '书', note: '内容', tags: ['思考'] }]), /## 书[\s\S]*#思考[\s\S]*内容/);
assert.match(buildMarkdown(null), /^# 拾页/);

console.log('bookUtils: 10 assertions passed');
