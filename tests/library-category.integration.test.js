import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {
  deleteCategoryAndUnassign, getAllRecords, getBookContent, getTrashImpact, openDatabase, permanentlyDeleteTrashItem, putRecord, purgeExpiredTrash,
  setBooksPrimaryCategory, setBooksStatus, softDeleteBook, softDeleteEntity,
} from '../src/db.js';

async function resetDb() {
  const db = await openDatabase();
  for (const name of db.objectStoreNames) {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(name, 'readwrite');
      tx.objectStore(name).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
}

async function main() {
  await resetDb();
  await putRecord('categories', { id: 'fiction', name: '小说', order: 0 });
  await putRecord('categories', { id: 'science', name: '科学', order: 1 });
  await putRecord('books', { id: 'one', title: '一', status: 'WANT_TO_READ', categoryIds: ['fiction'], revision: 1 });
  await putRecord('books', { id: 'two', title: '二', status: 'READING', categoryIds: [], revision: 1 });
  await putRecord('files', { id: 'file-one', bookId: 'one', blob: new Blob(['source']) });
  await putRecord('sections', { id: 'section-one', bookId: 'one', order: 0, text: '正文' });

  assert.equal(await setBooksPrimaryCategory(['one', 'two', 'two'], 'science'), 2, '批量归类应去重并一次完成');
  let books = await getAllRecords('books');
  assert.deepEqual(books.find(book => book.id === 'one').categoryIds, ['science']);
  assert.deepEqual(books.find(book => book.id === 'two').categoryIds, ['science']);

  assert.equal(await setBooksStatus(['one', 'two'], 'FINISHED'), 2, '批量状态应原子更新');
  books = await getAllRecords('books');
  assert.ok(books.every(book => book.status === 'FINISHED'));

  const content = await getBookContent('one');
  assert.equal(content.files.length, 1, '阅读器按书读取文件');
  assert.equal(content.sections.length, 1, '阅读器按书读取章节');
  assert.equal(content.sections[0].text, '正文');

  assert.equal(await deleteCategoryAndUnassign('science', books), 2, '删除分类只解除受影响书籍');
  books = await getAllRecords('books');
  assert.ok(books.every(book => book.categoryIds.length === 0));
  assert.equal((await getAllRecords('categories')).length, 1, '只删除目标分类');

  await putRecord('progress', { bookId: 'one', percentage: 0.2 });
  await putRecord('bookmarks', { id: 'bookmark-one', bookId: 'one' });
  await putRecord('sessions', { id: 'session-one', bookId: 'one' });
  await putRecord('notes', { id: 'note-one', bookId: 'one' });
  await putRecord('highlights', { id: 'highlight-one', bookId: 'one' });
  const one = (await getAllRecords('books')).find(book => book.id === 'one');
  const trashId = await softDeleteBook(one, { keepAnnotations: false, notes: [{ id: 'note-one', bookId: 'one' }], highlights: [{ id: 'highlight-one', bookId: 'one' }], bookmarks: [{ id: 'bookmark-one', bookId: 'one' }] });
  const impact = await getTrashImpact(trashId);
  assert.equal(impact.files, 1, '彻底删除前应统计原文件');
  assert.equal(impact.sections, 1, '彻底删除前应统计章节');
  assert.equal(impact.notes, 1, '彻底删除前应统计随书删除的笔记');
  assert.equal(impact.total, 8, '应统计书籍及其依赖记录');
  await permanentlyDeleteTrashItem(trashId);
  assert.equal((await getAllRecords('books')).some(book => book.id === 'one'), false);
  assert.equal((await getAllRecords('files')).some(file => file.bookId === 'one'), false);
  assert.equal((await getAllRecords('notes')).some(note => note.id === 'note-one'), false);

  await putRecord('notes', { id: 'expired-note', content: '过期', revision: 1 });
  const expiredTrashId = await softDeleteEntity('notes', { id: 'expired-note', content: '过期', revision: 1 });
  await putRecord('trash', { id: expiredTrashId, entityType: 'NOTES', entityId: 'expired-note', storeName: 'notes', state: 'TRASHED', expiresAt: '2000-01-01T00:00:00.000Z' });
  assert.equal((await purgeExpiredTrash()).length, 1, '应自动清理已到期的回收站记录');
  assert.equal((await getAllRecords('notes')).some(note => note.id === 'expired-note'), false);

  console.log('library.category integration: 19 assertions passed');
}

main().catch(error => { console.error('CATEGORY TEST FAILED:', error); process.exit(1); });
