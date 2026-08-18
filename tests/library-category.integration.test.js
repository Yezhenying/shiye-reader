import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {
  deleteCategoryAndUnassign, getAllRecords, getBookContent, openDatabase, putRecord,
  setBooksPrimaryCategory, setBooksStatus,
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

  console.log('library.category integration: 10 assertions passed');
}

main().catch(error => { console.error('CATEGORY TEST FAILED:', error); process.exit(1); });
