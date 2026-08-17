import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  commitLegacyRescue, deleteCategoryAndUnassign, deleteRecord, getAllRecords, putMany, putProgressMonotonic,
  putRecord, restoreTrashItem, softDeleteBook, softDeleteEntity, storageStatus,
} from './db.js';
import { activeRecords, buildLegacyRescueRecords, createId, normalizeBook, nowIso } from './domain.js';
import { importPublication as commitPublication } from './services/importService.js';

const DATA_STORES = ['books', 'files', 'sections', 'progress', 'notes', 'highlights', 'bookmarks', 'tags', 'categories', 'sessions', 'settings', 'trash', 'drafts'];
const DEFAULT_CATEGORIES = ['文学与小说', '思想与哲学', '商业与经济', '自然与科学'];

function parseLegacyArray(key) {
  const raw = localStorage.getItem(key);
  if (raw === null || raw === '') return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`${key} 不是数组，已保留原始数据等待修复`);
  return parsed;
}

async function migrateLegacyStorage() {
  let books; let notes;
  try {
    books = parseLegacyArray('shiyue-books');
    notes = parseLegacyArray('shiyue-notes');
  } catch (error) {
    throw new Error(`旧版数据迁移暂停：${error.message}`);
  }
  const completedAt = nowIso();
  const records = buildLegacyRescueRecords(books, notes, completedAt);
  // Marker and every repaired record commit together. v3 also repairs sections missed by the old non-atomic v2 rescue.
  await commitLegacyRescue({ markerKey: 'legacy-rescue-v3', ...records, completedAt });
}

export function useLibrary() {
  const [data, setData] = useState(Object.fromEntries(DATA_STORES.map(name => [name, []])));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [storage, setStorage] = useState({ usage: 0, quota: 0, persisted: false });
  const channelRef = useRef(null);
  const writeSuspendedRef = useRef(false);

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
      channelRef.current.onmessage = event => {
        if (event.data?.type === 'restore-begin') writeSuspendedRef.current = true;
        if (event.data?.type === 'restore-complete') { writeSuspendedRef.current = false; reload(); }
        if (event.data?.type === 'changed' && !writeSuspendedRef.current) reload();
      };
    }
    return () => channelRef.current?.close();
  }, [reload]);

  const notify = useCallback(() => channelRef.current?.postMessage({ type: 'changed', at: Date.now() }), []);
  const assertWritable = useCallback(() => { if (writeSuspendedRef.current) throw new Error('另一标签页正在恢复备份，本标签页已暂停写入'); }, []);
  const mutate = useCallback(async action => { assertWritable(); await action(); await reload(); notify(); }, [assertWritable, notify, reload]);
  const runWithWriteBarrier = useCallback(async action => {
    if (writeSuspendedRef.current) throw new Error('已有备份恢复正在进行');
    writeSuspendedRef.current = true;
    channelRef.current?.postMessage({ type: 'restore-begin', at: Date.now() });
    await new Promise(resolve => setTimeout(resolve, 250));
    try { return await action(); }
    finally {
      writeSuspendedRef.current = false;
      await reload();
      channelRef.current?.postMessage({ type: 'restore-complete', at: Date.now() });
    }
  }, [reload]);

  const importPublication = useCallback(async (file, parsed, options = {}) => {
    assertWritable();
    const result = await commitPublication({ file, parsed, books: data.books, ...options });
    if (!result.duplicate) { await reload(); notify(); }
    return result;
  }, [assertWritable, data.books, notify, reload]);

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
  const recoverDuplicateBook = useCallback(async book => {
    const trashItem = data.trash.find(item => item.entityId === book.id && item.state === 'TRASHED');
    if (!trashItem) throw new Error('未找到可恢复的回收站记录');
    await mutate(() => restoreTrashItem(trashItem.id));
    return { ...book, deletedAt: undefined };
  }, [data.trash, mutate]);

  const saveNote = useCallback(async input => {
    const now = nowIso();
    const current = input.id ? data.notes.find(note => note.id === input.id) : null;
    const record = {
      ...current, ...input, id: current?.id || createId('note'), content: String(input.content || ''),
      tagIds: input.tagIds || current?.tagIds || [], type: input.type || current?.type || '感悟',
      revision: (current?.revision || 0) + 1, createdAt: current?.createdAt || now, updatedAt: now, deletedAt: undefined,
    };
    await mutate(() => putRecord('notes', record));
    return record;
  }, [data.notes, mutate]);

  const deleteAnnotation = useCallback(async (storeName, id) => {
    const current = data[storeName].find(item => item.id === id);
    if (!current) return;
    await mutate(() => softDeleteEntity(storeName, current));
  }, [data, mutate]);

  const restoreAnnotation = useCallback(async trashId => mutate(() => restoreTrashItem(trashId)), [mutate]);

  const saveDraft = useCallback(async draft => {
    assertWritable();
    const record = { ...draft, id: draft.id, updatedAt: nowIso() };
    await putRecord('drafts', record);
    setData(value => ({ ...value, drafts: [...value.drafts.filter(item => item.id !== record.id), record] }));
    return record;
  }, [assertWritable]);
  const discardDraft = useCallback(async id => {
    assertWritable();
    await deleteRecord('drafts', id);
    setData(value => ({ ...value, drafts: value.drafts.filter(item => item.id !== id) }));
  }, [assertWritable]);

  const saveHighlight = useCallback(async input => {
    const now = nowIso();
    const current = input.id ? data.highlights.find(item => item.id === input.id) : null;
    const record = { ...current, id: current?.id || createId('highlight'), color: 'YELLOW', ...input, revision: (current?.revision || 0) + 1, locatorStatus: 'RESOLVED', createdAt: current?.createdAt || now, updatedAt: now, deletedAt: undefined };
    await mutate(() => putRecord('highlights', record));
    return record;
  }, [data.highlights, mutate]);

  const saveBookmark = useCallback(async input => {
    const now = nowIso();
    const record = { id: createId('bookmark'), ...input, revision: 1, locatorStatus: 'RESOLVED', createdAt: now, updatedAt: now };
    await mutate(() => putRecord('bookmarks', record));
    return record;
  }, [mutate]);

  const saveProgress = useCallback(async (bookId, locator, percentage) => {
    assertWritable();
    const record = await putProgressMonotonic(bookId, { locator, percentage, updatedAt: nowIso(), deviceId: 'local-web' });
    setData(value => ({ ...value, progress: [...value.progress.filter(item => item.bookId !== bookId), record] }));
    notify();
    return record;
  }, [assertWritable, notify]);

  const addSession = useCallback(async (bookId, startedAt, activeSeconds) => {
    assertWritable();
    if (activeSeconds < 1) return null;
    const record = {
      id: createId('session'), bookId, startedAt,
      endedAt: new Date(new Date(startedAt).getTime() + activeSeconds * 1000).toISOString(), activeSeconds,
    };
    await putRecord('sessions', record);
    setData(value => ({ ...value, sessions: [...value.sessions, record] }));
    notify();
    return record;
  }, [assertWritable, notify]);

  const ensureTags = useCallback(async names => {
    assertWritable();
    const cleaned = [...new Set(names.map(name => name.trim()).filter(Boolean))].slice(0, 8);
    const existingByName = new Map(activeRecords(data.tags).map(tag => [tag.name, tag]));
    const records = cleaned.map(name => existingByName.get(name) || ({ id: createId('tag'), name, revision: 1, createdAt: nowIso() }));
    await putMany('tags', records.filter(record => !existingByName.has(record.name)));
    await reload(); notify();
    return records.map(record => record.id);
  }, [assertWritable, data.tags, notify, reload]);

  const saveSetting = useCallback(async (id, value) => mutate(() => putRecord('settings', { id, value, revision: (data.settings.find(item => item.id === id)?.revision || 0) + 1, updatedAt: nowIso() })), [data.settings, mutate]);
  const saveCategory = useCallback(async name => {
    const cleaned = String(name || '').trim().slice(0, 40); if (!cleaned) throw new Error('分类名不能为空');
    if (data.categories.some(item => item.name === cleaned)) throw new Error('分类已存在');
    await mutate(() => putRecord('categories', { id: createId('category'), name: cleaned, order: data.categories.length, createdAt: nowIso() }));
  }, [data.categories, mutate]);
  const deleteCategory = useCallback(async id => mutate(() => deleteCategoryAndUnassign(id, data.books)), [data.books, mutate]);

  const active = useMemo(() => ({
    books: activeRecords(data.books), notes: activeRecords(data.notes), highlights: activeRecords(data.highlights), bookmarks: activeRecords(data.bookmarks), tags: activeRecords(data.tags),
  }), [data]);

  return {
    ...data, ...active,
    deletedBooks: data.books.filter(book => book.deletedAt),
    deletedNotes: data.notes.filter(item => item.deletedAt),
    deletedHighlights: data.highlights.filter(item => item.deletedAt),
    deletedBookmarks: data.bookmarks.filter(item => item.deletedAt),
    loading, error, storage,
    reload, runWithWriteBarrier, importPublication, updateBook, deleteBook, restoreBook, recoverDuplicateBook, saveNote, deleteAnnotation, restoreAnnotation,
    saveHighlight, saveBookmark, saveProgress, addSession, ensureTags, saveSetting, saveDraft, discardDraft, saveCategory, deleteCategory,
  };
}
