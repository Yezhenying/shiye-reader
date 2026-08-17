export const BOOK_STATUSES = [
  { value: 'WANT_TO_READ', label: '想读' },
  { value: 'READING', label: '在读' },
  { value: 'PAUSED', label: '搁置' },
  { value: 'FINISHED', label: '读完' },
];

export const HIGHLIGHT_COLORS = [
  { value: 'YELLOW', label: '杏黄' },
  { value: 'GREEN', label: '鼠尾草' },
  { value: 'BLUE', label: '雾蓝' },
  { value: 'PURPLE', label: '淡紫' },
];

export function createId(prefix) {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

export function nowIso() { return new Date().toISOString(); }

export function activeRecords(records) {
  return (Array.isArray(records) ? records : []).filter(record => !record.deletedAt);
}

export function bookStatusLabel(status) {
  return BOOK_STATUSES.find(item => item.value === status)?.label || '想读';
}

export function normalizeBook(record = {}) {
  const now = nowIso();
  const preserved = { ...record };
  return {
    ...preserved,
    id: record.id || createId('book'),
    title: String(record.title || '未命名电子书').trim().slice(0, 160),
    author: String(record.author || '作者待补充').trim().slice(0, 120),
    isbn: String(record.isbn || '').trim().slice(0, 40),
    year: String(record.year || '').trim().slice(0, 20),
    format: record.format || 'METADATA_ONLY',
    capability: record.capability || (record.contentPreview ? 'TEXT_ONLY' : 'METADATA_ONLY'),
    status: record.status || 'WANT_TO_READ',
    categoryIds: Array.isArray(record.categoryIds) ? record.categoryIds : [],
    progress: Math.max(0, Math.min(100, Number(record.progress) || 0)),
    // Remote covers are retained as metadata for compatibility, but never rendered automatically.
    coverUrl: typeof record.coverUrl === 'string' ? record.coverUrl : '',
    coverBlob: record.coverBlob instanceof Blob ? record.coverBlob : null,
    fingerprint: String(record.fingerprint || ''),
    activeFileId: String(record.activeFileId || ''),
    toc: Array.isArray(record.toc) ? record.toc : [],
    language: String(record.language || '').slice(0, 40),
    sourceCapability: record.sourceCapability || record.capability || '',
    parseWarnings: Array.isArray(record.parseWarnings) ? record.parseWarnings : [],
    fileName: record.fileName || '',
    fileSize: Number(record.fileSize) || 0,
    pageCount: Number(record.pageCount) || 0,
    wordCount: Number(record.wordCount) || 0,
    parseStatus: record.parseStatus || '',
    revision: Number(record.revision) || 1,
    createdAt: record.createdAt || now,
    updatedAt: record.updatedAt || now,
    lastOpenedAt: record.lastOpenedAt || '',
    deletedAt: record.deletedAt,
    trashGenerationId: record.trashGenerationId,
  };
}

export function buildLegacyRescueRecords(legacyBooks, legacyNotes, completedAt = nowIso()) {
  const books = (Array.isArray(legacyBooks) ? legacyBooks : [])
    .filter(item => item && typeof item.title === 'string' && item.title.trim())
    .map((item, index) => normalizeBook({
      ...item,
      id: typeof item.id === 'string' && item.id ? item.id : `legacy-book-${index}`,
      capability: item.contentPreview ? 'TEXT_ONLY' : 'METADATA_ONLY',
      createdAt: item.createdAt || completedAt,
      updatedAt: item.updatedAt || completedAt,
    }));
  const sections = books.flatMap(book => book.contentPreview ? [{
    id: `section-${book.id}-0`, bookId: book.id, order: 0, title: '旧版预览',
    text: String(book.contentPreview), wordCount: String(book.contentPreview).replace(/\s/g, '').length,
  }] : []);
  const notes = (Array.isArray(legacyNotes) ? legacyNotes : [])
    .filter(item => item && typeof item.note === 'string')
    .map((note, index) => ({
      id: typeof note.id === 'string' && note.id ? note.id : `legacy-note-${index}`,
      bookId: typeof note.bookId === 'string' ? note.bookId : '', type: note.type || '感悟', content: note.note,
      tagIds: [], legacyTags: Array.isArray(note.tags) ? note.tags : [], revision: 1,
      createdAt: note.createdAt || completedAt, updatedAt: note.updatedAt || completedAt,
      legacyTitle: note.title || '随手记', legacyAuthor: note.author || '',
    }));
  return { books, sections, notes };
}

export function buildLocator(book, section, offset = 0, context = {}) {
  const safeOffset = Math.max(0, Number(offset) || 0);
  const text = String(section?.text || '');
  const quote = String(context.quote || '').slice(0, 1000);
  return {
    schemaVersion: 2,
    kind: book.format === 'PDF' ? 'PDF' : 'TEXT',
    bookId: book.id,
    sectionId: section?.id || '',
    sectionOrder: section?.order || 0,
    offset: safeOffset,
    quote,
    prefix: String(context.prefix ?? text.slice(Math.max(0, safeOffset - 32), safeOffset)).slice(-32),
    suffix: String(context.suffix ?? text.slice(safeOffset + quote.length, safeOffset + quote.length + 32)).slice(0, 32),
    sectionProgression: Math.max(0, Math.min(1, Number(context.sectionProgression) || (text.length ? safeOffset / text.length : 0))),
    pageNumber: book.format === 'PDF' ? (section?.order || 0) + 1 : undefined,
    pageProgression: book.format === 'PDF' ? Math.max(0, Math.min(1, Number(context.pageProgression) || 0)) : undefined,
  };
}

export function calculateProgress(sections, locator) {
  if (!sections?.length || !locator) return 0;
  if (locator.kind === 'PDF') {
    const pageIndex = Math.max(0, Number(locator.pageNumber || ((locator.sectionOrder || 0) + 1)) - 1);
    return Math.max(0, Math.min(1, (pageIndex + Math.max(0, Math.min(1, Number(locator.pageProgression) || 0))) / sections.length));
  }
  const total = sections.reduce((sum, section) => sum + Math.max(1, section.text?.length || section.wordCount || 1), 0);
  let complete = 0;
  for (const section of sections) {
    const size = Math.max(1, section.text?.length || section.wordCount || 1);
    if (section.order < (locator.sectionOrder || 0)) complete += size;
    else if (section.order === (locator.sectionOrder || 0)) complete += Math.min(size, Math.max(0, locator.offset || 0));
  }
  return Math.max(0, Math.min(1, complete / total));
}

export function globalSearch({ books, notes, tags }, query) {
  const keyword = String(query || '').trim().toLocaleLowerCase('zh-CN');
  if (!keyword) return { books: [], notes: [], tags: [] };
  const includes = value => String(value || '').toLocaleLowerCase('zh-CN').includes(keyword);
  const tagById = new Map(activeRecords(tags).map(tag => [tag.id, tag]));
  return {
    books: activeRecords(books).filter(book => [book.title, book.author, book.isbn].some(includes)),
    notes: activeRecords(notes).filter(note => includes(note.content) || (note.tagIds || []).some(id => includes(tagById.get(id)?.name))),
    tags: activeRecords(tags).filter(tag => includes(tag.name)),
  };
}

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function creditedActivitySeconds(previousAt, currentAt) {
  return Math.max(0, Math.min(60, (Number(currentAt) - Number(previousAt)) / 1000));
}

export function splitSessionByLocalDate(session) {
  const start = new Date(session?.startedAt).getTime();
  const activeSeconds = Math.max(0, Number(session?.activeSeconds) || 0);
  if (!Number.isFinite(start) || !activeSeconds) return [];
  const declaredEnd = new Date(session?.endedAt).getTime();
  const end = Number.isFinite(declaredEnd) && declaredEnd > start ? declaredEnd : start + activeSeconds * 1000;
  const wallMilliseconds = Math.max(1, end - start);
  const parts = [];
  let cursor = start;
  while (cursor < end) {
    const boundary = new Date(cursor); boundary.setHours(24, 0, 0, 0);
    const partEnd = Math.min(end, boundary.getTime());
    parts.push({ key: localDateKey(cursor), seconds: activeSeconds * ((partEnd - cursor) / wallMilliseconds) });
    cursor = partEnd;
  }
  return parts;
}

export function calculateStatistics({ books, notes, highlights, sessions, now = new Date() }) {
  const days = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - offset));
    return { key: localDateKey(date), label: `${date.getMonth() + 1}/${date.getDate()}`, seconds: 0 };
  });
  const allSessionSeconds = new Map();
  for (const session of sessions || []) for (const part of splitSessionByLocalDate(session)) allSessionSeconds.set(part.key, (allSessionSeconds.get(part.key) || 0) + part.seconds);
  for (const day of days) day.seconds = allSessionSeconds.get(day.key) || 0;
  const qualifyingDays = new Set([...allSessionSeconds].filter(([, seconds]) => seconds >= 60).map(([key]) => key));
  for (const record of [...activeRecords(notes), ...activeRecords(highlights)]) {
    const value = record.createdAt || record.updatedAt;
    if (value && Number.isFinite(new Date(value).getTime())) qualifyingDays.add(localDateKey(value));
  }
  let streak = 0; const cursor = new Date(now); cursor.setHours(0, 0, 0, 0);
  while (qualifyingDays.has(localDateKey(cursor))) { streak += 1; cursor.setDate(cursor.getDate() - 1); }
  return {
    bookCount: activeRecords(books).length,
    noteCount: activeRecords(notes).length,
    highlightCount: activeRecords(highlights).length,
    todayMinutes: Math.floor((days.at(-1)?.seconds || 0) / 60),
    weekMinutes: days.map(day => ({ ...day, minutes: Math.floor(day.seconds / 60) })),
    streak,
  };
}

export function headingsFromMarkdown(text) {
  const lines = String(text || '').split(/\r?\n/);
  const toc = [];
  lines.forEach((line, index) => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match) toc.push({ id: `heading-${index}`, level: match[1].length, label: match[2].replace(/[*_`]/g, ''), line: index });
  });
  return toc;
}

export function splitTextSections(text, { maxLength = 12000, title = '正文' } = {}) {
  const normalized = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/);
  const chunks = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > maxLength) { chunks.push(current); current = ''; }
    current += `${current ? '\n\n' : ''}${paragraph}`;
  }
  if (current) chunks.push(current);
  return chunks.map((chunk, order) => ({ order, title: chunks.length > 1 ? `${title} ${order + 1}` : title, text: chunk, wordCount: chunk.replace(/\s/g, '').length }));
}

export const domainTestUtils = { localDateKey };
