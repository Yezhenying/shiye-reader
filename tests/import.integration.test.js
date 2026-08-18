import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { openDatabase, getAllRecords, commitImport } from '../src/db.js';
import { parseEbookFile } from '../src/ebookParser.js';
import { importPublication } from '../src/services/importService.js';
import { createId, normalizeBook, nowIso } from '../src/domain.js';

async function resetDb() {
  const db = await openDatabase();
  for (const name of db.objectStoreNames) await new Promise((resolve, reject) => { const tx = db.transaction(name, 'readwrite'); tx.objectStore(name).clear(); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
}

// Node 24+ provides native File/Blob where File instanceof Blob is true,
// matching real-browser behavior for structured-clone storage.

async function main() {
  await resetDb();

  // --- TXT happy path ---
  const file = new File(['第一章\n\n这是第一段内容。\n\n这是第二段内容。'], '测试书.txt', { type: 'text/plain' });
  const parsed = await parseEbookFile(file);
  assert.equal(parsed.format, 'TXT');
  assert.ok(parsed.sections.length >= 1, 'TXT 应解析出 section');
  assert.equal(parsed.capability, 'TEXT_VERIFIED');

  const result = await importPublication({ file, parsed, books: [], keepDuplicate: false });
  assert.ok(result.book, '导入应返回 book');
  assert.equal(result.book.title, '测试书');

  const books = await getAllRecords('books');
  const files = await getAllRecords('files');
  const sections = await getAllRecords('sections');
  assert.equal(books.length, 1, 'books 应有 1 条');
  assert.equal(files.length, 1, 'files 应有 1 条');
  assert.equal(sections.length, parsed.sections.length, 'sections 数量应等于解析数量');
  assert.ok(files[0].blob instanceof Blob, '原文件 Blob 应持久化');
  assert.equal(files[0].size, file.size, '文件 size 应一致');
  assert.equal(books[0].activeFileId, files[0].id, 'activeFileId 应指向文件');

  // --- duplicate detection ---
  const dup = await importPublication({ file, parsed, books, keepDuplicate: false });
  assert.ok(dup.duplicate, '相同文件应识别为重复');

  // --- keep duplicate ---
  const dup2 = await importPublication({ file, parsed, books, keepDuplicate: true });
  assert.ok(dup2.book, '保留副本应生成新书');
  const booksAfter = await getAllRecords('books');
  assert.equal(booksAfter.length, 2, '保留副本后应有 2 本书');

  // --- EPUB fake happy path (minimal) ---
  const epubFile = new File([], 'fake.epub', { type: 'application/epub+zip' });

  // --- commitImport direct with empty sections (MOBI/AZW3 style) ---
  const now = nowIso();
  const mobiId = createId('book');
  const fileId = createId('file');
  const genId = createId('import');
  const mobi = normalizeBook({ id: mobiId, title: 'MOBI书', author: '作者', fingerprint: 'abc', activeFileId: fileId, capability: 'FILE_ONLY', createdAt: now, updatedAt: now });
  const fileRec = { id: fileId, bookId: mobiId, generationId: genId, name: 'a.mobi', mimeType: '', size: 10, checksum: 'abc', blob: new Blob(['data']), createdAt: now, parseStatus: 'READY' };
  const job = { id: genId, kind: 'IMPORT', state: 'STAGING', createdAt: now, expiresAt: new Date(Date.now() + 864e5).toISOString() };
  await commitImport({ book: mobi, file: fileRec, sections: [], job });
  const mobiBooks = await getAllRecords('books');
  assert.equal(mobiBooks.length, 3, 'MOBI 空 sections 也应成功入库');
  const mobiFiles = await getAllRecords('files');
  assert.equal(mobiFiles.length, 3, 'MOBI 文件应入库（TXT×2 + MOBI）');

  console.log('import.integration: all assertions passed');
  process.exit(0);
}

main().catch(error => { console.error('IMPORT TEST FAILED:', error); process.exit(1); });
