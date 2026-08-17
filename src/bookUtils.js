export function mapOpenLibraryBook(doc, index = 0) {
  if (!doc || typeof doc.title !== 'string' || !doc.title.trim()) return null;
  const coverId = Number.isFinite(doc.cover_i) ? doc.cover_i : null;
  return {
    id: typeof doc.key === 'string' ? `ol-${doc.key.replaceAll('/', '-')}` : `ol-result-${index}`,
    title: doc.title.trim(),
    author: Array.isArray(doc.author_name) && doc.author_name.length ? doc.author_name.slice(0, 2).join('、') : '作者不详',
    year: Number.isFinite(doc.first_publish_year) ? String(doc.first_publish_year) : '年份不详',
    isbn: Array.isArray(doc.isbn) && doc.isbn.length ? String(doc.isbn[0]) : '',
    coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : '',
    progress: 0,
    imported: true,
  };
}

export function normalizeImportedBooks(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(book => book && typeof book.title === 'string' && book.title.trim())
    .map((book, index) => ({
      id: typeof book.id === 'string' ? book.id : `restored-book-${index}`,
      title: book.title.trim().slice(0, 160),
      author: typeof book.author === 'string' ? book.author.slice(0, 120) : '作者不详',
      year: typeof book.year === 'string' ? book.year : '',
      isbn: typeof book.isbn === 'string' ? book.isbn : '',
      coverUrl: typeof book.coverUrl === 'string' && (/^https:\/\//.test(book.coverUrl) || /^data:image\//.test(book.coverUrl)) ? book.coverUrl : '',
      progress: Math.min(100, Math.max(0, Number(book.progress) || 0)),
      format: typeof book.format === 'string' ? book.format.slice(0, 10) : '',
      fileName: typeof book.fileName === 'string' ? book.fileName.slice(0, 220) : '',
      fileSize: Math.max(0, Number(book.fileSize) || 0),
      pageCount: Math.max(0, Number(book.pageCount) || 0) || null,
      language: typeof book.language === 'string' ? book.language.slice(0, 20) : '',
      contentPreview: typeof book.contentPreview === 'string' ? book.contentPreview.slice(0, 24000) : '',
      wordCount: Math.max(0, Number(book.wordCount) || 0),
      parseStatus: typeof book.parseStatus === 'string' ? book.parseStatus.slice(0, 120) : '',
      sampleUrl: typeof book.sampleUrl === 'string' && book.sampleUrl.startsWith('/') ? book.sampleUrl : '',
      imported: true,
    }));
}

export function buildMarkdown(notes) {
  const safeNotes = Array.isArray(notes) ? notes : [];
  const sections = safeNotes.map(note => {
    const tags = Array.isArray(note.tags) ? note.tags.map(tag => `#${tag}`).join(' ') : '';
    return `## ${note.title || '随手记'}\n\n- 类型：${note.type || '感悟'}\n- 作者：${note.author || '我'}\n- 日期：${note.date || ''}\n- 标签：${tags || '无'}\n\n${note.note || ''}`;
  });
  return `# 拾页 · 读书笔记\n\n> 导出时间：${new Date().toLocaleString('zh-CN')}\n\n${sections.join('\n\n---\n\n')}\n`;
}
