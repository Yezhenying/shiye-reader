import JSZip from 'jszip';
import { exportDatabaseSnapshot, replaceDatabaseSnapshot, STORE_NAMES } from './db.js';

export const BACKUP_SCHEMA_VERSION = 2;
const ACCEPTED_SCHEMA_VERSIONS = new Set([1, BACKUP_SCHEMA_VERSION]);
const BACKUP_LIMITS = {
  fileBytes: 512 * 1024 * 1024, entries: 20000, entryBytes: 256 * 1024 * 1024,
  totalBytes: 1024 * 1024 * 1024, ratio: 300, recordsPerStore: 100000,
  recordBytes: 2 * 1024 * 1024, stringLength: 1024 * 1024, arrayLength: 10000,
};

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(value) {
  const bytes = value instanceof Blob ? await value.arrayBuffer() : new TextEncoder().encode(String(value));
  return bytesToHex(await crypto.subtle.digest('SHA-256', bytes));
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function keyFor(store, record) {
  return store === 'meta' ? record.key : store === 'progress' ? record.bookId : record.id;
}

function validateBoundedValue(value, path, depth = 0) {
  if (depth > 12) throw new Error(`${path} 嵌套过深`);
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${path} 包含非有限数值`);
  if (typeof value === 'string' && value.length > BACKUP_LIMITS.stringLength) throw new Error(`${path} 字符串过长`);
  if (Array.isArray(value)) {
    if (value.length > BACKUP_LIMITS.arrayLength) throw new Error(`${path} 数组过长`);
    value.forEach((item, index) => validateBoundedValue(item, `${path}[${index}]`, depth + 1));
  } else if (value && typeof value === 'object' && !(value instanceof Blob)) {
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error(`${path} 包含不安全字段`);
      validateBoundedValue(item, `${path}.${key}`, depth + 1);
    }
  }
}

function assertString(value, label, { optional = false, max = 1000 } = {}) {
  if (optional && (value === undefined || value === '')) return;
  if (typeof value !== 'string' || !value || value.length > max) throw new Error(`${label} 无效`);
}

function assertEnum(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} 无效`);
}

function assertRevision(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} 的 revision 无效`);
}

function assertTimestamp(value, label, optional = false) {
  if (optional && (value === undefined || value === '')) return;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`${label} 的时间无效`);
}

function validateLocator(locator, bookId, label) {
  if (!locator || typeof locator !== 'object' || Array.isArray(locator)) throw new Error(`${label} 的定位无效`);
  if (locator.bookId !== bookId) throw new Error(`${label} 的定位关系无效`);
  assertEnum(locator.kind, ['TEXT', 'PDF'], `${label} 的定位类型`);
  if (!Number.isInteger(locator.sectionOrder) || locator.sectionOrder < 0) throw new Error(`${label} 的章节位置无效`);
  if (locator.kind === 'PDF' && (!Number.isInteger(locator.pageNumber) || locator.pageNumber < 1)) throw new Error(`${label} 的页码无效`);
  if (locator.kind === 'TEXT' && (!Number.isFinite(locator.offset) || locator.offset < 0)) throw new Error(`${label} 的文字偏移无效`);
}

function normalizeBackupVersion(snapshot, manifest) {
  if (!ACCEPTED_SCHEMA_VERSIONS.has(manifest?.schemaVersion)) throw new Error('备份版本不受支持');
  if (manifest.schemaVersion === 1) {
    return {
      snapshot: { ...snapshot, drafts: Array.isArray(snapshot?.drafts) ? snapshot.drafts : [] },
      manifest: { ...manifest, stores: { ...(manifest.stores || {}), drafts: Array.isArray(snapshot?.drafts) ? snapshot.drafts.length : 0 } },
    };
  }
  return { snapshot, manifest };
}

function validateSnapshot(snapshot, manifest, { allowBinaryBlobs = false } = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('快照数据不是对象');
  const ids = {};
  for (const store of STORE_NAMES) {
    if (!Array.isArray(snapshot[store])) throw new Error(`备份缺少 ${store} 数据`);
    if (snapshot[store].length > BACKUP_LIMITS.recordsPerStore) throw new Error(`${store} 记录过多`);
    if (manifest.stores?.[store] !== snapshot[store].length) throw new Error(`${store} 记录数量与清单不符`);
    ids[store] = new Set();
    for (const record of snapshot[store]) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error(`${store} 包含无效记录`);
      validateBoundedValue(record, `${store} 记录`);
      if (JSON.stringify(record).length > BACKUP_LIMITS.recordBytes) throw new Error(`${store} 包含过大记录`);
      const key = keyFor(store, record);
      if (typeof key !== 'string' || !key || key.length > 300 || ids[store].has(key)) throw new Error(`${store} 包含无效或重复主键`);
      ids[store].add(key);
    }
  }

  const requireBook = (store, record, optional = false) => {
    if (optional && !record.bookId) return;
    assertString(record.bookId, `${store} 记录 ${keyFor(store, record)} 的 bookId`, { max: 300 });
    if (!ids.books.has(record.bookId)) throw new Error(`${store} 记录 ${keyFor(store, record)} 引用了不存在的书籍`);
  };
  for (const file of snapshot.files) {
    requireBook('files', file); assertString(file.name, `文件 ${file.id} 的名称`, { max: 500 });
    if (!Number.isFinite(file.size) || file.size < 0 || file.size > BACKUP_LIMITS.entryBytes) throw new Error(`文件 ${file.id} 的大小无效`);
    assertTimestamp(file.createdAt, `文件 ${file.id}`);
  }
  for (const section of snapshot.sections) {
    requireBook('sections', section); assertString(section.title, `章节 ${section.id} 的标题`, { max: 500 });
    if (!Number.isInteger(section.order) || section.order < 0 || typeof section.text !== 'string') throw new Error(`章节 ${section.id} 的内容或顺序无效`);
  }
  for (const progress of snapshot.progress) {
    requireBook('progress', progress); assertRevision(progress.revision, `进度 ${progress.bookId}`); assertTimestamp(progress.updatedAt, `进度 ${progress.bookId}`);
    if (!Number.isFinite(progress.percentage) || progress.percentage < 0 || progress.percentage > 1) throw new Error(`进度 ${progress.bookId} 的百分比无效`);
    validateLocator(progress.locator, progress.bookId, `进度 ${progress.bookId}`);
  }
  for (const note of snapshot.notes) {
    requireBook('notes', note, true); assertString(note.content, `笔记 ${note.id} 的内容`, { optional: true, max: 12000 });
    assertEnum(note.type, ['感悟','摘录','问题','行动','THOUGHT','QUOTE','QUESTION','ACTION'], `笔记 ${note.id} 的类型`);
    assertRevision(note.revision, `笔记 ${note.id}`); assertTimestamp(note.createdAt, `笔记 ${note.id}`); assertTimestamp(note.updatedAt, `笔记 ${note.id}`);
    if (!Array.isArray(note.tagIds) || note.tagIds.some(id => !ids.tags.has(id))) throw new Error(`笔记 ${note.id} 的标签关系无效`);
    if (note.locator && note.bookId) validateLocator(note.locator, note.bookId, `笔记 ${note.id}`);
    if (note.highlightId) {
      const highlight = snapshot.highlights.find(item => item.id === note.highlightId);
      if (!highlight || highlight.bookId !== note.bookId) throw new Error(`笔记 ${note.id} 的划线关系无效`);
    }
  }
  for (const highlight of snapshot.highlights) {
    requireBook('highlights', highlight); assertString(highlight.quote, `划线 ${highlight.id} 的摘录`, { max: 1000 });
    assertEnum(highlight.color, ['YELLOW','GREEN','BLUE','PURPLE'], `划线 ${highlight.id} 的颜色`);
    assertRevision(highlight.revision, `划线 ${highlight.id}`); assertTimestamp(highlight.createdAt, `划线 ${highlight.id}`); assertTimestamp(highlight.updatedAt, `划线 ${highlight.id}`);
    validateLocator(highlight.locator, highlight.bookId, `划线 ${highlight.id}`);
  }
  for (const bookmark of snapshot.bookmarks) {
    requireBook('bookmarks', bookmark); assertRevision(bookmark.revision, `书签 ${bookmark.id}`); assertTimestamp(bookmark.createdAt, `书签 ${bookmark.id}`); assertTimestamp(bookmark.updatedAt, `书签 ${bookmark.id}`);
    validateLocator(bookmark.locator, bookmark.bookId, `书签 ${bookmark.id}`);
  }
  for (const session of snapshot.sessions) {
    requireBook('sessions', session); assertTimestamp(session.startedAt, `阅读会话 ${session.id}`); assertTimestamp(session.endedAt, `阅读会话 ${session.id}`);
    if (!Number.isFinite(session.activeSeconds) || session.activeSeconds < 0) throw new Error(`阅读会话 ${session.id} 的时长无效`);
  }
  for (const book of snapshot.books) {
    assertString(book.title, `书籍 ${book.id} 的书名`, { max: 160 }); assertString(book.author, `书籍 ${book.id} 的作者`, { max: 120 });
    assertEnum(book.format, ['EPUB','PDF','TXT','MD','MOBI','AZW3','METADATA_ONLY'], `书籍 ${book.id} 的格式`);
    assertEnum(book.capability, ['FULL','TEXT_ONLY','VIEW_ONLY','FILE_ONLY','METADATA_ONLY','EXPERIMENTAL_TEXT','BASIC_PDF','TEXT_VERIFIED','PLAIN_TEXT'], `书籍 ${book.id} 的能力`);
    assertEnum(book.status, ['WANT_TO_READ','READING','PAUSED','FINISHED'], `书籍 ${book.id} 的状态`);
    assertRevision(book.revision, `书籍 ${book.id}`); assertTimestamp(book.createdAt, `书籍 ${book.id}`); assertTimestamp(book.updatedAt, `书籍 ${book.id}`);
    if (!Array.isArray(book.categoryIds) || book.categoryIds.some(id => !ids.categories.has(id))) throw new Error(`书籍 ${book.id} 的分类关系无效`);
    if (book.activeFileId) {
      const file = snapshot.files.find(item => item.id === book.activeFileId);
      if (!file || file.bookId !== book.id) throw new Error(`书籍 ${book.id} 的活动文件关系无效`);
    }
    if (!allowBinaryBlobs && book.coverBlob !== undefined) throw new Error(`书籍 ${book.id} 含有未序列化封面`);
  }
  for (const tag of snapshot.tags) { assertString(tag.name, `标签 ${tag.id} 的名称`, { max: 80 }); assertRevision(tag.revision, `标签 ${tag.id}`); }
  for (const category of snapshot.categories) assertString(category.name, `分类 ${category.id} 的名称`, { max: 80 });
  for (const setting of snapshot.settings) { assertString(setting.id, '设置主键', { max: 200 }); validateBoundedValue(setting.value, `设置 ${setting.id}`); }
  for (const draft of snapshot.drafts) {
    if (draft.bookId && !ids.books.has(draft.bookId)) throw new Error(`草稿 ${draft.id} 引用了不存在的书籍`);
    if (draft.editingId && !ids.notes.has(draft.editingId)) throw new Error(`草稿 ${draft.id} 引用了不存在的笔记`);
    if (draft.highlightId && !ids.highlights.has(draft.highlightId)) throw new Error(`草稿 ${draft.id} 引用了不存在的划线`);
  }
  return true;
}

function validateBinaryOwnership(snapshot, manifest) {
  const entries = new Map(manifest.entries.map(entry => [entry.path, entry]));
  const referenced = new Set(['data/snapshot.json']);
  for (const book of snapshot.books) if (book.coverBlobPath) {
    const expectedPath = `covers/${book.id}.bin`;
    if (book.coverBlobPath !== expectedPath) throw new Error(`书籍 ${book.id} 的封面路径无效`);
    const entry = entries.get(expectedPath);
    if (!entry || (manifest.schemaVersion >= 2 && (entry.ownerStore !== 'books' || entry.ownerId !== book.id))) throw new Error(`书籍 ${book.id} 的封面所有权无效`);
    referenced.add(expectedPath);
  }
  for (const file of snapshot.files) if (file.blobPath) {
    const expectedPath = `files/${file.id}/original.bin`;
    if (file.blobPath !== expectedPath) throw new Error(`文件 ${file.id} 的二进制路径无效`);
    const entry = entries.get(expectedPath);
    if (!entry || (manifest.schemaVersion >= 2 && (entry.ownerStore !== 'files' || entry.ownerId !== file.id))) throw new Error(`文件 ${file.id} 的二进制所有权无效`);
    referenced.add(expectedPath);
  }
  const binaryPaths = manifest.entries.filter(entry => entry.path !== 'data/snapshot.json').map(entry => entry.path);
  if (binaryPaths.some(path => !referenced.has(path))) throw new Error('备份包含没有业务记录归属的二进制条目');
}

function createLightSnapshot(snapshot) {
  return {
    ...snapshot,
    books: snapshot.books.map(({ coverBlob, ...book }) => ({
      ...book, activeFileId: '', sourceMissing: true,
      parseStatus: '轻量备份不含原文件与正文；恢复后请重新导入原文件',
    })),
    files: [], sections: [],
  };
}

export async function createFullBackup({ download = true } = {}) {
  const snapshot = await exportDatabaseSnapshot();
  const stores = Object.fromEntries(STORE_NAMES.map(name => [name, snapshot[name]?.length || 0]));
  validateSnapshot(snapshot, { stores }, { allowBinaryBlobs: true });
  const zip = new JSZip(); const binaryManifest = []; const files = []; const books = [];

  for (const record of snapshot.books || []) {
    const { coverBlob, ...metadata } = record;
    if (coverBlob instanceof Blob) {
      const path = `covers/${record.id}.bin`; zip.file(path, coverBlob);
      binaryManifest.push({ path, size: coverBlob.size, checksum: await sha256(coverBlob), mimeType: coverBlob.type || 'image/jpeg', ownerStore: 'books', ownerId: record.id });
      books.push({ ...metadata, coverBlobPath: path });
    } else books.push(metadata);
  }
  for (const record of snapshot.files || []) {
    const { blob, ...metadata } = record;
    if (blob instanceof Blob) {
      const path = `files/${record.id}/original.bin`; zip.file(path, blob);
      binaryManifest.push({ path, size: blob.size, checksum: await sha256(blob), mimeType: blob.type || record.mimeType || '', ownerStore: 'files', ownerId: record.id });
      files.push({ ...metadata, blobPath: path });
    } else files.push(metadata);
  }

  const data = { ...snapshot, books, files };
  const dataJson = JSON.stringify(data); const dataPath = 'data/snapshot.json'; zip.file(dataPath, dataJson);
  const manifest = {
    product: '拾页', schemaVersion: BACKUP_SCHEMA_VERSION, createdAt: new Date().toISOString(), mode: 'FULL', stores,
    entries: [{ path: dataPath, size: new Blob([dataJson]).size, checksum: await sha256(dataJson), mimeType: 'application/json', ownerStore: 'snapshot', ownerId: 'current' }, ...binaryManifest],
  };
  validateSnapshot(data, manifest); validateBinaryOwnership(data, manifest);
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  await inspectBackup(blob);
  if (download) downloadBlob(blob, `拾页当前版本完整快照-${new Date().toISOString().slice(0, 10)}.zip`);
  return { blob, manifest };
}

/** Export metadata and reading records without covers, original files, or derived sections. */
export async function createLightBackup({ download = true } = {}) {
  const snapshot = createLightSnapshot(await exportDatabaseSnapshot());
  const stores = Object.fromEntries(STORE_NAMES.map(name => [name, snapshot[name]?.length || 0]));
  validateSnapshot(snapshot, { stores });
  const dataJson = JSON.stringify(snapshot); const dataPath = 'data/snapshot.json';
  const manifest = {
    product: '拾页', schemaVersion: BACKUP_SCHEMA_VERSION, createdAt: new Date().toISOString(), mode: 'LIGHT', stores,
    entries: [{ path: dataPath, size: new Blob([dataJson]).size, checksum: await sha256(dataJson), mimeType: 'application/json', ownerStore: 'snapshot', ownerId: 'current' }],
  };
  const zip = new JSZip(); zip.file(dataPath, dataJson); zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  await inspectBackup(blob);
  if (download) downloadBlob(blob, `拾页轻量数据备份-${new Date().toISOString().slice(0, 10)}.zip`);
  return { blob, manifest };
}

export async function inspectBackup(file) {
  if (!(file instanceof Blob)) throw new Error('请选择有效的备份文件');
  if (file.size > BACKUP_LIMITS.fileBytes) throw new Error('备份容器过大，已停止读取');
  let zip;
  try { zip = await JSZip.loadAsync(file); } catch { throw new Error('备份不是有效的 ZIP 容器'); }
  const zipEntries = Object.values(zip.files);
  if (zipEntries.length > BACKUP_LIMITS.entries) throw new Error('备份条目过多');
  let expandedTotal = 0;
  for (const entry of zipEntries) {
    if (entry.name.includes('..') || entry.name.startsWith('/') || entry.name.includes('\\')) throw new Error('备份包含不安全路径');
    if (!entry.dir && !/^(manifest\.json|data\/snapshot\.json|covers\/[^/]+\.bin|files\/[^/]+\/original\.bin)$/.test(entry.name)) throw new Error(`备份包含未知条目：${entry.name}`);
    const expanded = Number(entry._data?.uncompressedSize || 0); const compressed = Number(entry._data?.compressedSize || 0);
    if (expanded > BACKUP_LIMITS.entryBytes || (compressed > 0 && expanded / compressed > BACKUP_LIMITS.ratio)) throw new Error(`备份条目资源异常：${entry.name}`);
    expandedTotal += expanded;
  }
  if (expandedTotal > BACKUP_LIMITS.totalBytes) throw new Error('备份展开后过大');
  const manifestEntry = zip.file('manifest.json'); const dataEntry = zip.file('data/snapshot.json');
  if (!manifestEntry || !dataEntry) throw new Error('备份结构不完整');
  let manifest; let snapshot;
  try { manifest = JSON.parse(await manifestEntry.async('text')); } catch { throw new Error('备份清单不是有效 JSON'); }
  if (manifest.product !== '拾页' || !ACCEPTED_SCHEMA_VERSIONS.has(manifest.schemaVersion)) throw new Error('备份版本不受支持');
  if (!Array.isArray(manifest.entries) || manifest.entries.some(entry => !entry || typeof entry.path !== 'string' || !Number.isFinite(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.checksum || ''))) throw new Error('备份清单条目无效');
  const actualPaths = new Set(zipEntries.filter(entry => !entry.dir && entry.name !== 'manifest.json').map(entry => entry.name));
  const manifestPaths = new Set(manifest.entries.map(entry => entry.path));
  if (manifestPaths.size !== manifest.entries.length || actualPaths.size !== manifestPaths.size || [...actualPaths].some(path => !manifestPaths.has(path))) throw new Error('备份条目与清单不一致');
  for (const expected of manifest.entries) {
    const entry = zip.file(expected.path); if (!entry) throw new Error(`备份缺少条目：${expected.path}`);
    const blob = await entry.async('blob');
    if (blob.size !== expected.size || await sha256(blob) !== expected.checksum) throw new Error(`备份条目校验失败：${expected.path}`);
  }
  try { snapshot = JSON.parse(await dataEntry.async('text')); } catch { throw new Error('快照不是有效 JSON'); }
  ({ snapshot, manifest } = normalizeBackupVersion(snapshot, manifest));
  validateSnapshot(snapshot, manifest); validateBinaryOwnership(snapshot, manifest);
  return { zip, manifest, snapshot };
}

export const RESTORE_STRATEGIES = ['REPLACE', 'SKIP', 'COPY', 'LATEST'];

async function materializeBackup({ zip, manifest, snapshot }) {
  const books = [];
  for (const record of snapshot.books) {
    if (!record.coverBlobPath) { books.push(record); continue; }
    const expected = manifest.entries.find(item => item.path === record.coverBlobPath);
    const coverBlob = await zip.file(record.coverBlobPath).async('blob');
    const { coverBlobPath, ...metadata } = record;
    books.push({ ...metadata, coverBlob: new Blob([coverBlob], { type: expected.mimeType || 'image/jpeg' }) });
  }
  const files = [];
  for (const record of snapshot.files) {
    if (!record.blobPath) { files.push(record); continue; }
    const expected = manifest.entries.find(item => item.path === record.blobPath);
    const blob = await zip.file(record.blobPath).async('blob');
    const { blobPath, ...metadata } = record;
    files.push({ ...metadata, blob: new Blob([blob], { type: expected.mimeType || record.mimeType || '' }) });
  }
  return { ...snapshot, books, files };
}

function recordTimestamp(record) {
  const time = Date.parse(record?.updatedAt || record?.createdAt || '');
  return Number.isFinite(time) ? time : 0;
}

function mergeByKey(store, current, incoming, strategy) {
  const existing = new Map(current.map(record => [storeKey(store, record), record]));
  for (const record of incoming) {
    const key = storeKey(store, record);
    if (!existing.has(key) || (strategy === 'LATEST' && recordTimestamp(record) > recordTimestamp(existing.get(key)))) existing.set(key, record);
  }
  return [...existing.values()];
}

function storeKey(store, record) { return keyFor(store, record); }

function skipConflicts(current, incoming) {
  const currentKeys = Object.fromEntries(STORE_NAMES.map(store => [store, new Set(current[store].map(record => storeKey(store, record)))]));
  const retainedBooks = new Set(incoming.books.filter(book => !currentKeys.books.has(book.id)).map(book => book.id));
  const hasBook = record => !record.bookId || retainedBooks.has(record.bookId) || currentKeys.books.has(record.bookId);
  const output = {};
  for (const store of STORE_NAMES) {
    output[store] = incoming[store].filter(record => !currentKeys[store].has(storeKey(store, record)) && hasBook(record));
  }
  return Object.fromEntries(STORE_NAMES.map(store => [store, [...current[store], ...output[store]]]));
}

function remapLocator(locator, bookIds) {
  return locator?.bookId ? { ...locator, bookId: bookIds.get(locator.bookId) || locator.bookId } : locator;
}

function copyConflicts(current, incoming) {
  const maps = Object.fromEntries(STORE_NAMES.filter(store => !['progress', 'meta', 'settings'].includes(store)).map(store => [store, new Map()]));
  const occupied = Object.fromEntries(STORE_NAMES.map(store => [store, new Set(current[store].map(record => storeKey(store, record)))]));
  for (const store of Object.keys(maps)) {
    for (const record of incoming[store]) {
      const key = storeKey(store, record);
      if (!occupied[store].has(key)) continue;
      let copy = `restored-${store}-${key}`; let sequence = 2;
      while (occupied[store].has(copy)) copy = `restored-${store}-${key}-${sequence++}`;
      maps[store].set(key, copy); occupied[store].add(copy);
    }
  }
  const mapped = (store, id) => maps[store]?.get(id) || id;
  const remapRecord = (store, record) => {
    const id = store === 'progress' ? mapped('books', record.bookId) : mapped(store, record.id);
    const bookId = record.bookId ? mapped('books', record.bookId) : record.bookId;
    const common = { ...record, ...(store === 'progress' ? { bookId: id } : { id }), ...(record.bookId ? { bookId } : {}), locator: remapLocator(record.locator, maps.books) };
    if (store === 'books') return { ...common, activeFileId: mapped('files', record.activeFileId), categoryIds: (record.categoryIds || []).map(value => mapped('categories', value)) };
    if (store === 'notes') return { ...common, tagIds: (record.tagIds || []).map(value => mapped('tags', value)), highlightId: mapped('highlights', record.highlightId) };
    if (store === 'trash') { const entityStore = { BOOK: 'books', NOTES: 'notes', HIGHLIGHTS: 'highlights', BOOKMARKS: 'bookmarks' }[record.entityType]; return { ...common, entityId: mapped(entityStore, record.entityId) }; }
    return common;
  };
  const output = {};
  for (const store of STORE_NAMES) {
    const records = incoming[store].map(record => remapRecord(store, record));
    output[store] = ['settings', 'meta'].includes(store) ? records.filter(record => !occupied[store].has(storeKey(store, record))) : records;
  }
  return Object.fromEntries(STORE_NAMES.map(store => [store, [...current[store], ...output[store]]]));
}

function combineSnapshots(current, incoming, strategy) {
  if (strategy === 'REPLACE') return incoming;
  if (strategy === 'SKIP') return skipConflicts(current, incoming);
  if (strategy === 'COPY') return copyConflicts(current, incoming);
  if (strategy === 'LATEST') return Object.fromEntries(STORE_NAMES.map(store => [store, mergeByKey(store, current[store], incoming[store], 'LATEST')]));
  throw new Error('未知的恢复冲突策略');
}

export async function restoreBackup(file, { strategy = 'REPLACE' } = {}) {
  if (!RESTORE_STRATEGIES.includes(strategy)) throw new Error('未知的恢复冲突策略');
  const inspected = await inspectBackup(file);
  const incoming = await materializeBackup(inspected);
  const snapshot = strategy === 'REPLACE' ? incoming : combineSnapshots(await exportDatabaseSnapshot(), incoming, strategy);
  const stores = Object.fromEntries(STORE_NAMES.map(name => [name, snapshot[name]?.length || 0]));
  validateSnapshot(snapshot, { stores }, { allowBinaryBlobs: true });
  await replaceDatabaseSnapshot(snapshot);
  return { manifest: inspected.manifest, strategy };
}

export async function restoreFullBackup(file) { return restoreBackup(file); }

export const backupTestUtils = { bytesToHex, validateSnapshot, validateBinaryOwnership, normalizeBackupVersion, createLightSnapshot, combineSnapshots };
