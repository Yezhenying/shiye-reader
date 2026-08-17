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

export function normalizeBook(record) {
  const now = nowIso();
  return {
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
    coverUrl: /^https:\/\//.test(record.coverUrl || '') ? record.coverUrl : '',
    coverBlob: record.coverBlob instanceof Blob ? record.coverBlob : null,
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

export function buildLocator(book, section, offset = 0) {
  return {
    schemaVersion: 1,
    kind: book.format === 'PDF' ? 'PDF' : 'TEXT',
    bookId: book.id,
    sectionId: section?.id || '',
    sectionOrder: section?.order || 0,
    offset: Math.max(0, Number(offset) || 0),
    pageNumber: book.format === 'PDF' ? (section?.order || 0) + 1 : undefined,
  };
}

export function calculateProgress(sections, locator) {
  if (!sections?.length || !locator) return 0;
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

export function calculateStatistics({ books, notes, highlights, sessions, now = new Date() }) {
  const days = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - offset));
    return { key: localDateKey(date), label: `${date.getMonth() + 1}/${date.getDate()}`, seconds: 0 };
  });
  const byDay = new Map(days.map(day => [day.key, day]));
  for (const session of sessions || []) {
    const day = byDay.get(localDateKey(session.startedAt));
    if (day) day.seconds += Math.max(0, Number(session.activeSeconds) || 0);
  }
  const today = days.at(-1)?.seconds || 0;
  let streak = 0;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    if (days[index].seconds >= 60) streak += 1;
    else break;
  }
  return {
    bookCount: activeRecords(books).length,
    noteCount: activeRecords(notes).length,
    highlightCount: activeRecords(highlights).length,
    todayMinutes: Math.floor(today / 60),
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
