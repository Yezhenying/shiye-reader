const DB_NAME = 'shiyue-reader';
const DB_VERSION = 1;

export const STORE_NAMES = [
  'books', 'files', 'sections', 'progress', 'notes', 'highlights', 'bookmarks',
  'tags', 'categories', 'sessions', 'settings', 'trash', 'jobs', 'meta',
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
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
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
        database.onversionchange = () => { database.close(); databasePromise = undefined; };
        resolve(database);
      };
      request.onblocked = () => reject(new Error('数据库升级被其他标签页阻塞，请关闭其他拾页页面后重试'));
      request.onerror = () => { databasePromise = undefined; reject(request.error || new Error('无法打开本地数据库')); };
    });
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

export async function restoreTrashItem(trashId) {
  const trash = await getRecord('trash', trashId);
  if (!trash) throw new Error('回收站项目不存在');
  const storeNames = ['books', 'notes', 'highlights', 'bookmarks'];
  const snapshots = Object.fromEntries(await Promise.all(storeNames.map(async name => [name, await getAllRecords(name)])));
  const database = await openDatabase();
  const transaction = database.transaction([...storeNames, 'trash'], 'readwrite');
  for (const storeName of storeNames) {
    const store = transaction.objectStore(storeName);
    for (const record of snapshots[storeName].filter(item => item.trashGenerationId === trashId)) {
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
