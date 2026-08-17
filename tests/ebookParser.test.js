import assert from 'node:assert/strict';
import { ACCEPTED_EBOOKS, MAX_EBOOK_SIZE, ebookTestUtils, parseEbookFile } from '../src/ebookParser.js';

assert.match(ACCEPTED_EBOOKS, /\.epub/);
assert.match(ACCEPTED_EBOOKS, /\.azw3/);
assert.equal(MAX_EBOOK_SIZE, 200 * 1024 * 1024);
assert.equal(ebookTestUtils.extensionOf('我的书.EPUB'), 'epub');
assert.equal(ebookTestUtils.titleFromFile('美丽新世界-笔记.md'), '美丽新世界-笔记');
assert.equal(ebookTestUtils.titleFromFile(''), '未命名电子书');
assert.equal(ebookTestUtils.cleanText('第一段  内容\n\n\n第二段'), '第一段 内容\n\n第二段');
assert.equal(ebookTestUtils.resolveZipPath('OPS/package.opf', 'text/chapter.xhtml'), 'OPS/text/chapter.xhtml');
const textBook = await parseEbookFile(new File(['第一章\n\n测试内容。'], '测试书.txt', { type: 'text/plain' }));
assert.equal(textBook.title, '测试书');
assert.equal(textBook.format, 'TXT');
assert.match(textBook.parseStatus, /全文已解析/);
assert.equal(textBook.sections.length, 1);
assert.equal(textBook.sections[0].bookId, undefined);
assert.equal(textBook.capability, 'FULL');

console.log('ebookParser: 14 assertions passed');
