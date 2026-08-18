const DB_NAME = 'shiyue-reader';
const DB_VERSION = 2;

export const STORE_NAMES = [
  'books', 'files', 'sections', 'progress', 'notes', 'highlights', 'bookmarks',
  'tags', 'categories', 'sessions', 'settings', 'trash', 'jobs', 'meta', 'drafts',
];

const STORE_DEFINITIONS = {
  books: { keyPath: 'id', indexes: [['status', 'status'], ['updatedAt', 'updatedAt'], ['deletedAt', 'deletedAt']] },
  files: { keyPath: 'id', indexes: [['bookId', 'bookId']] },
  sections: { keyPath: 'id', indexes: [['bookId', 'bookId'], ['bookOrder', ['bookId', 'order'], { unique: true }]] },
  progress: { keyPath: 'bookId' },
  notes: { keyPath: 'id', indexes: [['bookId', 'bookId'], ['updatedAt', 'updatedAt'], ['deletedAt', 'deletedAt']] },
  highlights: { keyPath: 'id', indexes: [['bookId', 'bookId'], ['deletedAt', 'deletedAt']] },
  bookmarks: { keyPath: 'id', indexes: [['bookId', 'bookId'], ['deletedAt', 'deletedAt']] },
  tags: { keyPath: 'id', indexes: [['name', 'name', { unique: true }]] },
  categories: { keyPath: 'id', indexes: [['order', 'order']] },
  sessions: { keyPath: 'id', indexes: [['bookId', 'bookId'], ['startedAt', 'startedAt']] },
  settings: { keyPath: 'id' },
  trash: { keyPath: 'id', indexes: [['deletedAt', 'deletedAt'], ['entityType', 'entityType']] },
  jobs: { keyPath: 'id', indexes: [['state', 'state']] },
  meta: { keyPath: 'key' },
  drafts: { keyPath: 'id', indexes: [['updatedAt', 'updatedAt']] },
};

let databasePromise;

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB 请求失败'));
  });
}

function transactionPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB 事务失败'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB 事务已取消'));
  });
}

export function openDatabase() {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('当前浏览器不支持 IndexedDB'));
  if (!databasePromise) {
    const opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      let settled = false;
      request.onupgradeneeded = () => {
        const database = request.result;
        for (const [name, definition] of Object.entries(STORE_DEFINITIONS)) {
          const store = database.objectStoreNames.contains(name)
            ? request.transaction.objectStore(name)
            : database.createObjectStore(name, { keyPath: definition.keyPath });
          for (const [indexName, keyPath, options] of definition.indexes || []) {
            if (!store.indexNames.contains(indexName)) store.createIndex(indexName, keyPath, options || {});
          }
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        if (settled) { database.close(); return; }
        settled = true;
        database.onversionchange = () => { database.close(); if (databasePromise === opening) databasePromise = undefined; };
        resolve(database);
      };
      request.onblocked = () => {
        if (settled) return;
        settled = true;
        if (databasePromise === opening) databasePromise = undefined;
        reject(new Error('数据库升级被其他标签页阻塞，请关闭其他拾页页面后重试'));
      };
      request.onerror = () => {
        if (settled) return;
        settled = true;
        if (databasePromise === opening) databasePromise = undefined;
        reject(request.error || new Error('无法打开本地数据库'));
      };
    });
    databasePromise = opening;
  }
  return databasePromise;
}

export async function getRecord(storeName, key) {
  const database = await openDatabase();
  return requestPromise(database.transaction(storeName, 'readonly').objectStore(storeName).get(key));
}

export async function getAllRecords(storeName, { index, query } = {}) {
  const database = await openDatabase();
  const store = database.transaction(storeName, 'readonly').objectStore(storeName);
  return requestPromise(index ? store.index(index).getAll(query) : store.getAll(query));
}

/** Read large reading payload only when a reader is opened, never during shelf refreshes. */
export async function getBookContent(bookId) {
  const database = await openDatabase();
  const transaction = database.transaction(['files', 'sections'], 'readonly');
  const files = requestPromise(transaction.objectStore('files').index('bookId').getAll(bookId));
  const sections = requestPromise(transaction.objectStore('sections').index('bookId').getAll(bookId));
  const [fileRecords, sectionRecords] = await Promise.all([files, sections]);
  await transactionPromise(transaction);
  return { files: fileRecords, sections: sectionRecords };
}

export async function putRecord(storeName, record) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readwrite');
  await requestPromise(transaction.objectStore(storeName).put(record));
  await transactionPromise(transaction);
  return record;
}

export async function deleteRecord(storeName, key) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readwrite');
  await requestPromise(transaction.objectStore(storeName).delete(key));
  await transactionPromise(transaction);
}

export async function clearStore(storeName) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readwrite');
  await requestPromise(transaction.objectStore(storeName).clear());
  await transactionPromise(transaction);
}

export async function putMany(storeName, records) {
  if (!records.length) return;
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readwrite');
  const store = transaction.objectStore(storeName);
  for (const record of records) store.put(record);
  await transactionPromise(transaction);
}

export async function commitLegacyRescue({ markerKey, books, sections, notes, completedAt }) {
  const database = await openDatabase();
  const transaction = database.transaction(['meta', 'books', 'sections', 'notes'], 'readwrite');
  const meta = transaction.objectStore('meta');
  const [marker, storedBooks, storedSections, storedNotes] = await Promise.all([
    requestPromise(meta.get(markerKey)),
    requestPromise(transaction.objectStore('books').getAllKeys()),
    requestPromise(transaction.objectStore('sections').getAllKeys()),
    requestPromise(transaction.objectStore('notes').getAllKeys()),
  ]);
  if (!marker) {
    const bookIds = new Set(storedBooks); const sectionIds = new Set(storedSections); const noteIds = new Set(storedNotes);
    const missingBooks = books.filter(record => !bookIds.has(record.id));
    const missingSections = sections.filter(record => !sectionIds.has(record.id));
    const missingNotes = notes.filter(record => !noteIds.has(record.id));
    for (const record of missingBooks) transaction.objectStore('books').put(record);
    for (const record of missingSections) transaction.objectStore('sections').put(record);
    for (const record of missingNotes) transaction.objectStore('notes').put(record);
    meta.put({ key: markerKey, completedAt, books: missingBooks.length, sections: missingSections.length, notes: missingNotes.length });
  }
  await transactionPromise(transaction);
}

export async function putProgressMonotonic(bookId, values) {
  const database = await openDatabase();
  const transaction = database.transaction('progress', 'readwrite');
  const store = transaction.objectStore('progress');
  const current = await requestPromise(store.get(bookId));
  const record = { ...values, bookId, revision: Math.max(0, Number(current?.revision) || 0) + 1 };
  store.put(record);
  await transactionPromise(transaction);
  return record;
}

export async function commitImport({ book, file, sections, job }) {
  const database = await openDatabase();
  const transaction = database.transaction(['books', 'files', 'sections', 'jobs'], 'readwrite');
  transaction.objectStore('jobs').put({ ...job, state: 'COMMITTING' });
  transaction.objectStore('books').put(book);
  transaction.objectStore('files').put(file);
  for (const section of sections) transaction.objectStore('sections').put(section);
  transaction.objectStore('jobs').put({ ...job, state: 'COMMITTED', completedAt: new Date().toISOString() });
  await transactionPromise(transaction);
}

export async function deleteCategoryAndUnassign(categoryId, books) {
  const database = await openDatabase();
  const transaction = database.transaction(['categories', 'books'], 'readwrite');
  transaction.objectStore('categories').delete(categoryId);
  const affected = books.filter(item => item.categoryIds?.includes(categoryId));
  const now = new Date().toISOString();
  for (const book of affected) transaction.objectStore('books').put({ ...book, categoryIds: [], revision: (book.revision || 0) + 1, updatedAt: now });
  await transactionPromise(transaction);
  return affected.length;
}

/** Atomically enforce the one-primary-category invariant for a batch of books. */
export async function setBooksPrimaryCategory(bookIds, categoryId = '') {
  const uniqueIds = [...new Set(bookIds)].filter(Boolean);
  if (!uniqueIds.length) return 0;
  const database = await openDatabase();
  const transaction = database.transaction('books', 'readwrite');
  const store = transaction.objectStore('books');
  const records = await Promise.all(uniqueIds.map(id => requestPromise(store.get(id))));
  const now = new Date().toISOString();
  let changed = 0;
  for (const book of records.filter(Boolean)) {
    const nextCategoryIds = categoryId ? [categoryId] : [];
    if (JSON.stringify(book.categoryIds || []) === JSON.stringify(nextCategoryIds)) continue;
    store.put({ ...book, categoryIds: nextCategoryIds, revision: (book.revision || 0) + 1, updatedAt: now });
    changed += 1;
  }
  await transactionPromise(transaction);
  return changed;
}

export async function setBooksStatus(bookIds, status) {
  const uniqueIds = [...new Set(bookIds)].filter(Boolean);
  if (!uniqueIds.length) return 0;
  const database = await openDatabase();
  const transaction = database.transaction('books', 'readwrite');
  const store = transaction.objectStore('books');
  const records = await Promise.all(uniqueIds.map(id => requestPromise(store.get(id))));
  const now = new Date().toISOString();
  let changed = 0;
  for (const book of records.filter(Boolean)) {
    if (book.status === status) continue;
    store.put({ ...book, status, revision: (book.revision || 0) + 1, updatedAt: now });
    changed += 1;
  }
  await transactionPromise(transaction);
  return changed;
}

export async function softDeleteBook(book, related = {}) {
  const now = new Date().toISOString();
  const trashId = `trash-${book.id}-${Date.now()}`;
  const database = await openDatabase();
  const stores = ['books', 'trash', 'notes', 'highlights', 'bookmarks'];
  const transaction = database.transaction(stores, 'readwrite');
  transaction.objectStore('books').put({ ...book, deletedAt: now, trashGenerationId: trashId, revision: (book.revision || 0) + 1, updatedAt: now });
  transaction.objectStore('trash').put({ id: trashId, entityType: 'BOOK', entityId: book.id, deletedAt: now, expiresAt: new Date(Date.now() + 30 * 864e5).toISOString(), state: 'TRASHED' });
  if (!related.keepAnnotations) {
    for (const [storeName, records] of [['notes', related.notes || []], ['highlights', related.highlights || []], ['bookmarks', related.bookmarks || []]]) {
      for (const record of records) transaction.objectStore(storeName).put({ ...record, deletedAt: now, trashGenerationId: trashId, revision: (record.revision || 0) + 1, updatedAt: now });
    }
  }
  await transactionPromise(transaction);
  return trashId;
}

export async function softDeleteEntity(storeName, record) {
  if (!['notes', 'highlights', 'bookmarks'].includes(storeName)) throw new Error('不支持的回收站类型');
  const now = new Date().toISOString();
  const trashId = `trash-${record.id}-${Date.now()}`;
  const database = await openDatabase();
  const transaction = database.transaction([storeName, 'trash'], 'readwrite');
  transaction.objectStore(storeName).put({ ...record, deletedAt: now, trashGenerationId: trashId, revision: (record.revision || 0) + 1, updatedAt: now });
  transaction.objectStore('trash').put({ id: trashId, entityType: storeName.toUpperCase(), entityId: record.id, storeName, deletedAt: now, expiresAt: new Date(Date.now() + 30 * 864e5).toISOString(), state: 'TRASHED' });
  await transactionPromise(transaction);
  return trashId;
}

export async function getTrashImpact(trashId) {
  const trash = await getRecord('trash', trashId);
  if (!trash || trash.state !== 'TRASHED') throw new Error('回收站项目不存在或已恢复');
  if (trash.storeName) return { trashId, entityType: trash.entityType, [trash.storeName]: 1, total: 1 };
  const [files, sections, progress, bookmarks, notes, highlights, sessions] = await Promise.all(
    ['files', 'sections', 'progress', 'bookmarks', 'notes', 'highlights', 'sessions'].map(getAllRecords),
  );
  const forBook = records => records.filter(record => record.bookId === trash.entityId).length;
  const relatedDeleted = records => records.filter(record => record.trashGenerationId === trashId).length;
  const impact = {
    trashId, entityType: trash.entityType, books: 1, files: forBook(files), sections: forBook(sections),
    progress: progress.some(record => record.bookId === trash.entityId) ? 1 : 0,
    bookmarks: forBook(bookmarks), notes: relatedDeleted(notes), highlights: relatedDeleted(highlights), sessions: forBook(sessions),
  };
  impact.total = Object.entries(impact).filter(([key]) => !['trashId', 'entityType', 'total'].includes(key)).reduce((sum, [, value]) => sum + value, 0);
  return impact;
}

/** Permanently remove one trashed entity and every dependent record in a single transaction. */
export async function permanentlyDeleteTrashItem(trashId) {
  const trash = await getRecord('trash', trashId);
  const impact = await getTrashImpact(trashId);
  if (trash.storeName) {
    const database = await openDatabase();
    const transaction = database.transaction([trash.storeName, 'trash'], 'readwrite');
    transaction.objectStore(trash.storeName).delete(trash.entityId);
    transaction.objectStore('trash').delete(trashId);
    await transactionPromise(transaction);
    return impact;
  }
  const [files, sections, bookmarks, notes, highlights, sessions] = await Promise.all(
    ['files', 'sections', 'bookmarks', 'notes', 'highlights', 'sessions'].map(getAllRecords),
  );
  const database = await openDatabase();
  const stores = ['books', 'files', 'sections', 'progress', 'bookmarks', 'notes', 'highlights', 'sessions', 'trash'];
  const transaction = database.transaction(stores, 'readwrite');
  transaction.objectStore('books').delete(trash.entityId);
  transaction.objectStore('progress').delete(trash.entityId);
  const deleteForBook = (storeName, records) => records.filter(record => record.bookId === trash.entityId).forEach(record => transaction.objectStore(storeName).delete(record.id));
  deleteForBook('files', files); deleteForBook('sections', sections); deleteForBook('bookmarks', bookmarks); deleteForBook('sessions', sessions);
  for (const storeName of ['notes', 'highlights']) {
    const records = storeName === 'notes' ? notes : highlights;
    records.filter(record => record.trashGenerationId === trashId).forEach(record => transaction.objectStore(storeName).delete(record.id));
  }
  transaction.objectStore('trash').delete(trashId);
  await transactionPromise(transaction);
  return impact;
}

/** Remove expired, still-trashed entries. Restored entries are never touched. */
export async function purgeExpiredTrash(now = Date.now()) {
  const entries = await getAllRecords('trash');
  const expired = entries.filter(entry => entry.state === 'TRASHED' && Number.isFinite(Date.parse(entry.expiresAt)) && Date.parse(entry.expiresAt) <= now);
  const impacts = [];
  for (const entry of expired) impacts.push(await permanentlyDeleteTrashItem(entry.id));
  return impacts;
}

export async function restoreTrashItem(trashId) {
  const trash = await getRecord('trash', trashId);
  if (!trash || trash.state !== 'TRASHED') throw new Error('回收站项目不存在或已恢复');
  const storeNames = trash.storeName ? [trash.storeName] : ['books', 'notes', 'highlights', 'bookmarks'];
  const snapshots = Object.fromEntries(await Promise.all(storeNames.map(async name => [name, await getAllRecords(name)])));
  const database = await openDatabase();
  const transaction = database.transaction([...storeNames, 'trash'], 'readwrite');
  for (const storeName of storeNames) {
    const store = transaction.objectStore(storeName);
    for (const record of snapshots[storeName].filter(item => item.trashGenerationId === trashId || (trash.storeName === storeName && item.id === trash.entityId))) {
      store.put({ ...record, deletedAt: undefined, trashGenerationId: undefined, revision: (record.revision || 0) + 1, updatedAt: new Date().toISOString() });
    }
  }
  transaction.objectStore('trash').put({ ...trash, state: 'RESTORED', restoredAt: new Date().toISOString() });
  await transactionPromise(transaction);
}

export async function exportDatabaseSnapshot() {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAMES, 'readonly');
  const snapshot = {};
  await Promise.all(STORE_NAMES.map(async name => { snapshot[name] = await requestPromise(transaction.objectStore(name).getAll()); }));
  await transactionPromise(transaction);
  return snapshot;
}

export async function replaceDatabaseSnapshot(snapshot) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAMES, 'readwrite');
  for (const name of STORE_NAMES) {
    const store = transaction.objectStore(name);
    store.clear();
    for (const record of Array.isArray(snapshot[name]) ? snapshot[name] : []) store.put(record);
  }
  await transactionPromise(transaction);
}

export async function storageStatus() {
  if (!navigator.storage?.estimate) return { usage: 0, quota: 0, persisted: false };
  const [estimate, persisted] = await Promise.all([
    navigator.storage.estimate(),
    navigator.storage.persisted?.().catch(() => false) || false,
  ]);
  return { usage: estimate.usage || 0, quota: estimate.quota || 0, persisted: Boolean(persisted) };
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

export const dbTestUtils = { DB_NAME, DB_VERSION, STORE_DEFINITIONS };
