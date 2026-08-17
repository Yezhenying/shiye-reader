import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  commitImport, getAllRecords, getRecord, putMany, putRecord, restoreTrashItem,
  softDeleteBook, storageStatus,
} from './db.js';
import { activeRecords, createId, normalizeBook, nowIso } from './domain.js';
import { normalizeImportedBooks } from './bookUtils.js';
import { normalizeStoredNotes } from './textPolish.js';

const DATA_STORES = ['books', 'files', 'sections', 'progress', 'notes', 'highlights', 'bookmarks', 'tags', 'categories', 'sessions', 'settings', 'trash'];
const DEFAULT_CATEGORIES = ['文学与小说', '思想与哲学', '商业与经济', '自然与科学'];

async function checksumBlob(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function migrateLegacyStorage() {
  if (await getRecord('meta', 'legacy-migration-v1')) return;
  let books = [];
  let notes = [];
  try { books = normalizeImportedBooks(JSON.parse(localStorage.getItem('shiyue-books') || '[]')); } catch { /* quarantine by leaving original keys */ }
  try { notes = normalizeStoredNotes(JSON.parse(localStorage.getItem('shiyue-notes') || '[]')); } catch { /* quarantine by leaving original keys */ }
  const now = nowIso();
  const migratedBooks = books.map(book => normalizeBook({ ...book, capability: book.contentPreview ? 'TEXT_ONLY' : 'METADATA_ONLY', createdAt: now, updatedAt: now }));
  const sections = migratedBooks.flatMap(book => {
    const original = books.find(item => item.id === book.id);
    return original?.contentPreview ? [{ id: `section-${book.id}-0`, bookId: book.id, order: 0, title: '旧版预览', text: original.contentPreview, wordCount: original.contentPreview.replace(/\s/g, '').length }] : [];
  });
  const migratedNotes = notes.map((note, index) => ({
    id: note.id || `legacy-note-${index}`, bookId: note.bookId || '', type: note.type || '感悟', content: note.note || '',
    tagIds: [], legacyTags: note.tags || [], revision: 1, createdAt: now, updatedAt: now, legacyTitle: note.title || '随手记', legacyAuthor: note.author || '',
  }));
  await Promise.all([putMany('books', migratedBooks), putMany('sections', sections), putMany('notes', migratedNotes)]);
  await putRecord('meta', { key: 'legacy-migration-v1', completedAt: now, books: migratedBooks.length, notes: migratedNotes.length });
}

export function useLibrary() {
  const [data, setData] = useState(Object.fromEntries(DATA_STORES.map(name => [name, []])));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [storage, setStorage] = useState({ usage: 0, quota: 0, persisted: false });
  const channelRef = useRef(null);

  const reload = useCallback(async () => {
    try {
      await migrateLegacyStorage();
      const values = await Promise.all(DATA_STORES.map(getAllRecords));
      setData(Object.fromEntries(DATA_STORES.map((name, index) => [name, values[index]])));
      setStorage(await storageStatus());
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '读取本地数据失败');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    reload();
    if ('BroadcastChannel' in window) {
      channelRef.current = new BroadcastChannel('shiyue-data');
      channelRef.current.onmessage = event => event.data?.type === 'changed' && reload();
    }
    return () => channelRef.current?.close();
  }, [reload]);

  const notify = useCallback(() => channelRef.current?.postMessage({ type: 'changed', at: Date.now() }), []);
  const mutate = useCallback(async action => { await action(); await reload(); notify(); }, [notify, reload]);

  const importPublication = useCallback(async (file, parsed, { keepDuplicate = false } = {}) => {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.quota && estimate.usage + file.size * 1.5 > estimate.quota) throw new Error('预计剩余空间不足以安全保存原文件和解析结果');
    const fingerprint = await checksumBlob(file);
    const existing = data.books.find(book => !book.deletedAt && book.fingerprint === fingerprint);
    if (existing && !keepDuplicate) return { duplicate: existing };
    const now = nowIso();
    const bookId = keepDuplicate ? createId('book') : parsed.id;
    const fileId = createId('file');
    const generationId = createId('import');
    const book = normalizeBook({
      ...parsed, id: bookId, fingerprint, status: 'WANT_TO_READ', capability: parsed.capability,
      toc: parsed.toc || [], coverBlob: parsed.coverBlob, createdAt: now, updatedAt: now,
    });
    const fileRecord = { id: fileId, bookId, generationId, name: file.name, mimeType: file.type, size: file.size, checksum: fingerprint, blob: file, createdAt: now, parseStatus: 'READY' };
    const sections = (parsed.sections || []).map((section, order) => ({ ...section, id: `section-${bookId}-${order}`, bookId, order }));
    const job = { id: generationId, kind: 'IMPORT', state: 'STAGING', createdAt: now, expiresAt: new Date(Date.now() + 864e5).toISOString() };
    await commitImport({ book: { ...book, activeFileId: fileId }, file: fileRecord, sections, job });
    navigator.storage?.persist?.().catch(() => false);
    await reload(); notify();
    return { book };
  }, [data.books, notify, reload]);

  const updateBook = useCallback(async (bookId, patch) => {
    const current = data.books.find(book => book.id === bookId);
    if (!current) throw new Error('书籍不存在');
    const updated = normalizeBook({ ...current, ...patch, id: bookId, revision: (current.revision || 0) + 1, updatedAt: nowIso() });
    await mutate(() => putRecord('books', updated));
    return updated;
  }, [data.books, mutate]);

  const deleteBook = useCallback(async (bookId, keepAnnotations = true) => {
    const book = data.books.find(item => item.id === bookId);
    if (!book) return;
    await mutate(() => softDeleteBook(book, {
      keepAnnotations,
      notes: data.notes.filter(item => item.bookId === bookId),
      highlights: data.highlights.filter(item => item.bookId === bookId),
      bookmarks: data.bookmarks.filter(item => item.bookId === bookId),
    }));
  }, [data, mutate]);

  const restoreBook = useCallback(async trashId => mutate(() => restoreTrashItem(trashId)), [mutate]);

  const saveNote = useCallback(async input => {
    const now = nowIso();
    const current = input.id ? data.notes.find(note => note.id === input.id) : null;
    const record = {
      ...current, ...input, id: current?.id || createId('note'), content: String(input.content || '').trim(),
      tagIds: input.tagIds || current?.tagIds || [], type: input.type || current?.type || '感悟',
      revision: (current?.revision || 0) + 1, createdAt: current?.createdAt || now, updatedAt: now, deletedAt: undefined,
    };
    await mutate(() => putRecord('notes', record));
    return record;
  }, [data.notes, mutate]);

  const deleteAnnotation = useCallback(async (storeName, id) => {
    const current = data[storeName].find(item => item.id === id);
    if (!current) return;
    const now = nowIso();
    await mutate(() => putRecord(storeName, { ...current, deletedAt: now, revision: (current.revision || 0) + 1, updatedAt: now }));
  }, [data, mutate]);

  const saveHighlight = useCallback(async input => {
    const now = nowIso();
    const record = { id: createId('highlight'), color: 'YELLOW', ...input, revision: 1, locatorStatus: 'RESOLVED', createdAt: now, updatedAt: now };
    await mutate(() => putRecord('highlights', record));
    return record;
  }, [mutate]);

  const saveBookmark = useCallback(async input => {
    const now = nowIso();
    const record = { id: createId('bookmark'), ...input, revision: 1, locatorStatus: 'RESOLVED', createdAt: now, updatedAt: now };
    await mutate(() => putRecord('bookmarks', record));
    return record;
  }, [mutate]);

  const saveProgress = useCallback(async (bookId, locator, percentage) => {
    const current = data.progress.find(item => item.bookId === bookId);
    await putRecord('progress', { bookId, locator, percentage, revision: (current?.revision || 0) + 1, updatedAt: nowIso(), deviceId: 'local-web' });
    setData(value => ({ ...value, progress: [...value.progress.filter(item => item.bookId !== bookId), { bookId, locator, percentage, revision: (current?.revision || 0) + 1, updatedAt: nowIso(), deviceId: 'local-web' }] }));
    notify();
  }, [data.progress, notify]);

  const addSession = useCallback(async (bookId, startedAt, activeSeconds) => {
    if (activeSeconds < 1) return;
    await putRecord('sessions', { id: createId('session'), bookId, startedAt, endedAt: nowIso(), activeSeconds });
    notify();
  }, [notify]);

  const ensureTags = useCallback(async names => {
    const cleaned = [...new Set(names.map(name => name.trim()).filter(Boolean))].slice(0, 8);
    const existingByName = new Map(activeRecords(data.tags).map(tag => [tag.name, tag]));
    const records = cleaned.map(name => existingByName.get(name) || ({ id: createId('tag'), name, revision: 1, createdAt: nowIso() }));
    await putMany('tags', records.filter(record => !existingByName.has(record.name)));
    await reload(); notify();
    return records.map(record => record.id);
  }, [data.tags, notify, reload]);

  const saveSetting = useCallback(async (id, value) => mutate(() => putRecord('settings', { id, value, revision: (data.settings.find(item => item.id === id)?.revision || 0) + 1, updatedAt: nowIso() })), [data.settings, mutate]);

  const active = useMemo(() => ({
    books: activeRecords(data.books), notes: activeRecords(data.notes), highlights: activeRecords(data.highlights), bookmarks: activeRecords(data.bookmarks), tags: activeRecords(data.tags),
  }), [data]);

  return {
    ...data, ...active, deletedBooks: data.books.filter(book => book.deletedAt), loading, error, storage,
    reload, importPublication, updateBook, deleteBook, restoreBook, saveNote, deleteAnnotation,
    saveHighlight, saveBookmark, saveProgress, addSession, ensureTags, saveSetting,
  };
}
