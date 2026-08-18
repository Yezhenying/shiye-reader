import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, BarChart3, BookOpen, BookPlus, Bookmark, Check, ChevronLeft, ChevronRight,
  Download, FileText, Highlighter, House, Library, List, LoaderCircle, Menu, Moon,
  NotebookPen, Plus, Search, Settings, Sun, Trash2, Upload, X,
} from 'lucide-react';
import { ACCEPTED_EBOOKS, parseEbookFile } from './ebookParser.js';
import { createFullBackup, inspectBackup, restoreFullBackup } from './backup.js';
import { requestPersistentStorage } from './db.js';
import {
  BOOK_STATUSES, HIGHLIGHT_COLORS, bookStatusLabel, buildLocator, calculateProgress,
  calculateStatistics, creditedActivitySeconds, globalSearch,
} from './domain.js';
import { useLibrary } from './useLibrary.js';
import { describePolishChanges, polishText } from './textPolish.js';

const NAV = [
  ['今日阅读', House, '#/'], ['我的书架', Library, '#/library'], ['全部笔记', NotebookPen, '#/notes'],
  ['精彩划线', Highlighter, '#/highlights'], ['阅读统计', BarChart3, '#/statistics'], ['设置', Settings, '#/settings'],
];

function useRoute() {
  const parse = () => {
    const hash = location.hash || '#/';
    const match = /^#\/reader\/([^/?]+)/.exec(hash);
    return match ? { page: 'reader', bookId: decodeURIComponent(match[1]) } : { page: hash.slice(2).split('?')[0] || 'home' };
  };
  const [route, setRoute] = useState(parse);
  useEffect(() => { const handler = () => setRoute(parse()); addEventListener('hashchange', handler); return () => removeEventListener('hashchange', handler); }, []);
  return route;
}

function useBlobUrl(blob, fallback = '') {
  const [url, setUrl] = useState(fallback);
  useEffect(() => {
    if (!(blob instanceof Blob)) { setUrl(fallback); return; }
    const next = URL.createObjectURL(blob); setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob, fallback]);
  return url;
}

function Cover({ book, small = false }) {
  const url = useBlobUrl(book?.coverBlob, '');
  if (url) return <div className={`cover image-cover ${small ? 'small' : ''}`}><img src={url} alt={`${book?.title || '书籍'}封面`}/></div>;
  return <div className={`cover note ${small ? 'small' : ''}`}><span className="cover-top">SHI YE</span><strong>{book?.title || '拾页'}</strong><span className="cover-bottom">LOCAL READER</span></div>;
}

function Toast({ message, action }) {
  if (!message) return null;
  return <div className="toast" role="status"><Check size={15}/>{message}{action}</div>;
}

function Modal({ children, close, className = '', label = '对话框' }) {
  const dialogRef = useRef(); const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    const focusable = () => [...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]')];
    focusable()[0]?.focus();
    const handler = event => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const items = focusable(); if (!items.length) return;
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    addEventListener('keydown', handler);
    return () => { removeEventListener('keydown', handler); previous?.focus?.(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={close}><div ref={dialogRef} className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={label} onMouseDown={e => e.stopPropagation()}>{children}</div></div>;
}

function ImportDialog({ library, close, openBook, toast }) {
  const inputRef = useRef();
  const [state, setState] = useState({ status: 'idle', message: '' });
  const [duplicate, setDuplicate] = useState(null);
  const [pending, setPending] = useState(null);
  const busy = state.status === 'loading';
  const safeClose = () => { if (!busy) close(); };
  const resetPicker = () => { if (inputRef.current) inputRef.current.value = ''; };
  const chooseAgain = () => { resetPicker(); setPending(null); setDuplicate(null); setState({ status: 'idle', message: '' }); };
  const importFile = async (file, keepDuplicate = false) => {
    if (!file || busy) return;
    setState({ status: 'loading', message: `正在解析 ${file.name}` });
    try {
      const parsed = pending?.file === file ? pending.parsed : await parseEbookFile(file);
      const result = await library.importPublication(file, parsed, { keepDuplicate });
      if (result.duplicate) { setDuplicate({ book: result.duplicate, trashed: result.duplicateTrashed }); setPending({ file, parsed }); setState({ status: 'duplicate', message: '检测到相同原文件' }); return; }
      setState({ status: 'success', message: `《${result.book.title}》已安全写入本地数据库`, book: result.book });
      setDuplicate(null); setPending(null); resetPicker(); toast('导入完成');
    } catch (error) { setState({ status: 'error', message: `${error.message || '导入失败'}。原有数据未被修改，请重试。` }); }
    finally { resetPicker(); }
  };
  const recoverDuplicate = async () => { const recovered = await library.recoverDuplicateBook(duplicate.book); close(); openBook(recovered); };
  return <Modal close={safeClose} className="import-modal"><div className="modal-head"><div><p>本地优先 · 原文件保存在当前浏览器</p><h2>导入电子书</h2></div><button disabled={busy} onClick={safeClose} aria-label={busy?'导入处理中，暂不能关闭':'关闭导入'}><X/></button></div>
    <input ref={inputRef} hidden type="file" accept={ACCEPTED_EBOOKS} onChange={e => { const file=e.target.files?.[0]; importFile(file); e.target.value=''; }}/>
    {state.status === 'idle' && <button className="file-dropzone" onClick={() => inputRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); importFile(e.dataTransfer.files?.[0]); }}><Upload size={28}/><strong>选择或拖入电子书</strong><span>TXT 验证编码；Markdown 纯文本；EPUB 实验性纯文本；PDF 基础页面/文本层</span><em>EPUB 样式、图片与内链不保留；MOBI/AZW3 和固定版式 EPUB 仅保存文件；最大 200MiB</em></button>}
    {busy && <div className="file-feedback" aria-live="polite"><LoaderCircle className="spin"/><strong>解析并提交中</strong><span>{state.message}</span><em>处理中暂不支持取消，请等待完成。</em></div>}
    {state.status === 'duplicate' && <div className="file-feedback"><FileText/><strong>{duplicate.trashed?'相同原文件在回收站中':'这本书已经在书架中'}</strong><span>{duplicate.trashed?'恢复原书及其阅读记录，或保留独立副本。':'打开已有书籍，或保留一份独立副本。'}</span><div className="dialog-buttons"><button onClick={duplicate.trashed?recoverDuplicate:()=>{ close(); openBook(duplicate.book); }}>{duplicate.trashed?'恢复并打开':'打开已有'}</button><button onClick={() => importFile(pending.file, true)}>保留副本</button></div></div>}
    {state.status === 'error' && <div className="file-feedback error"><strong>未能导入</strong><span>{state.message}</span><button onClick={chooseAgain}>重新选择</button></div>}
    {state.status === 'success' && <div className="file-success"><Cover book={state.book}/><div><span><Check size={14}/>已提交</span><h3>{state.book.title}</h3><p>{state.book.author}</p><em>{state.message}</em><div className="dialog-buttons"><button onClick={() => { close(); openBook(state.book); }}>立即阅读</button><button onClick={chooseAgain}>继续导入</button></div></div></div>}
  </Modal>;
}

function NoteDialog({ library, close, bookId = '', highlight = null, editing = null, toast }) {
  const draftId = `note-${editing?.id || highlight?.id || bookId || 'global'}`;
  const recovered = library.drafts.find(item => item.id === draftId);
  const initialType = editing?.type || (highlight ? '摘录' : '感悟');
  const initialContent = editing?.content ?? highlight?.quote ?? '';
  const initialTags = (editing?.tagIds || []).map(id => library.tags.find(tag => tag.id === id)?.name).filter(Boolean).join('，');
  const initialSourceContent = editing?.originalContent || '';
  const [type, setType] = useState(recovered?.type || initialType);
  const [content, setContent] = useState(recovered?.content ?? initialContent);
  const [tags, setTags] = useState(recovered?.tags ?? initialTags);
  const [sourceContent, setSourceContent] = useState(recovered?.sourceContent ?? initialSourceContent);
  const [polishPreview, setPolishPreview] = useState(null);
  const [draftStatus, setDraftStatus] = useState(recovered ? '已恢复草稿' : '');
  const dirty = Boolean(recovered) || type !== initialType || content !== initialContent || tags !== initialTags || sourceContent !== initialSourceContent;
  const draft = { id: draftId, bookId: bookId || editing?.bookId || '', editingId: editing?.id || '', highlightId: highlight?.id || '', type, content, tags, sourceContent };
  useEffect(() => {
    if (!dirty) return;
    setDraftStatus('正在保存草稿…');
    const timer = setTimeout(() => library.saveDraft(draft).then(() => setDraftStatus('草稿已保存')).catch(() => setDraftStatus('草稿保存失败')), 500);
    return () => clearTimeout(timer);
  }, [draftId, type, content, tags, sourceContent, dirty]);
  const guardedClose = async () => { if (dirty) { try { await library.saveDraft(draft); } catch { if (!confirm('草稿未能保存，关闭会丢失本次修改。仍要关闭吗？')) return; } } close(); };
  const generatePolish = () => {
    if (type === '摘录' || !content.trim()) return;
    const suggestion = polishText(content);
    if (suggestion === content) { toast('未发现适合的本地优化项'); return; }
    setPolishPreview({ original: content, suggestion, changes: describePolishChanges(content, suggestion) });
  };
  const applyPolish = () => {
    if (!polishPreview) return;
    setContent(polishPreview.suggestion);
    setSourceContent(polishPreview.original);
    setPolishPreview(null);
    setDraftStatus('已采用本地优化建议');
  };
  const restoreOriginal = () => {
    if (!sourceContent) return;
    setContent(sourceContent);
    setSourceContent('');
    setPolishPreview(null);
    setDraftStatus('已恢复原文');
  };
  const updateType = nextType => { setType(nextType); if (nextType === '摘录') setPolishPreview(null); };
  const save = async () => {
    if (!content.trim()) return;
    try {
      const tagIds = await library.ensureTags(tags.split(/[,，#\s]+/));
      const originalContent = type === '摘录' || sourceContent === content ? undefined : sourceContent || undefined;
      await library.saveNote({ ...editing, bookId: bookId || editing?.bookId || '', highlightId: highlight?.id || editing?.highlightId, locator: highlight?.locator || editing?.locator, type, content, originalContent, tagIds });
      await library.discardDraft(draftId);
      toast(originalContent ? '笔记已保存，可随时恢复原文' : '笔记已保存'); close();
    } catch (error) { toast(`保存失败：${error.message}`); }
  };
  return <Modal close={guardedClose} className="note-modal" label={editing ? '编辑笔记' : '新建笔记'}><div className="modal-head"><div><p>草稿 500ms 自动保存 · 本地处理，不会联网</p><h2>{editing ? '编辑笔记' : '记录此刻的想法'}</h2></div><button onClick={guardedClose} aria-label="关闭笔记"><X/></button></div><div className="note-types">{['感悟','摘录','问题','行动'].map(item => <button key={item} className={type === item ? 'active' : ''} onClick={() => updateType(item)}>{item}</button>)}</div><label className="field-label">标签<input value={tags} onChange={e => setTags(e.target.value)} placeholder="思考，历史"/></label><textarea autoFocus aria-label="笔记内容" value={content} onChange={event => { setContent(event.target.value); setPolishPreview(null); }} maxLength={12000}/>{type !== '摘录' ? <div className="polish-tools"><button type="button" className="polish-trigger" disabled={!content.trim()} onClick={generatePolish}>轻度表达优化</button>{sourceContent && <button type="button" className="restore-original" onClick={restoreOriginal}>恢复原文</button>}<span>只调整口语措辞、段落和标点；不扩写观点。</span></div> : <p className="quote-protection">摘录必须保持原文准确性，已关闭表达优化。</p>}{polishPreview && <section className="polish-compare" aria-label="本地表达优化建议"><div className="polish-compare-head"><div><strong>本地表达优化建议</strong><span>{polishPreview.changes.join('、')}</span></div><button type="button" onClick={() => setPolishPreview(null)} aria-label="关闭优化建议"><X size={15}/></button></div><div className="polish-columns"><div><span>原文</span><p>{polishPreview.original}</p></div><div><span>建议</span><p>{polishPreview.suggestion}</p></div></div><div className="polish-actions"><button type="button" onClick={() => setPolishPreview(null)}>保留原文</button><button type="button" className="accept-polish" onClick={applyPolish}>采用建议</button></div></section>}<div className="modal-actions"><span>{content.length}/12000 · {draftStatus}</span><button disabled={!content.trim()} onClick={save}><Check size={15}/>保存</button></div></Modal>;
}

function BookEditDialog({ book, library, close, toast }) {
  const [form, setForm] = useState({ title: book.title, author: book.author, status: book.status || 'WANT_TO_READ', categoryIds: (book.categoryIds || []).slice(0, 1) });
  const save = async () => {
    try { await library.updateBook(book.id, form); toast('书籍信息已更新'); close(); }
    catch (error) { toast(`保存失败：${error.message}`); }
  };
  return <Modal close={close} label="编辑书籍"><div className="modal-head"><div><p>书籍信息</p><h2>编辑《{book.title}》</h2></div><button onClick={close} aria-label="关闭书籍编辑"><X/></button></div><div className="form-stack"><label>书名<input value={form.title} onChange={e => setForm({...form,title:e.target.value})}/></label><label>作者<input value={form.author} onChange={e => setForm({...form,author:e.target.value})}/></label><label>阅读状态<select value={form.status} onChange={e => setForm({...form,status:e.target.value})}>{BOOK_STATUSES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><div className="field-label"><span>主分类</span><div className="category-choice" role="group" aria-label="主分类"><button type="button" aria-pressed={!form.categoryIds[0]} className={!form.categoryIds[0] ? 'active' : ''} onClick={() => setForm({...form,categoryIds:[]})}>未分类</button>{library.categories.map(item => <button type="button" aria-pressed={form.categoryIds[0]===item.id} className={form.categoryIds[0]===item.id ? 'active' : ''} key={item.id} onClick={() => setForm({...form,categoryIds:[item.id]})}>{item.name}</button>)}</div></div></div><div className="modal-actions"><span>每本书只能设置一个主分类</span><button onClick={save}>保存修改</button></div></Modal>;
}

function CategoryManagerDialog({ library, close, toast }) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editingName, setEditingName] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [busy, setBusy] = useState(false);
  const categories = useMemo(() => [...library.categories].sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name, 'zh-CN')), [library.categories]);
  const countFor = id => library.books.filter(book => book.categoryIds?.[0] === id).length;
  const create = async event => {
    event.preventDefault();
    try { setBusy(true); const category = await library.saveCategory(newName); setNewName(''); toast(`已创建“${category.name}”`); }
    catch (error) { toast(error.message); }
    finally { setBusy(false); }
  };
  const rename = async id => {
    try { setBusy(true); const category = await library.renameCategory(id, editingName); setEditingId(''); setEditingName(''); toast(`已重命名为“${category.name}”`); }
    catch (error) { toast(error.message); }
    finally { setBusy(false); }
  };
  const remove = async id => {
    const category = categories.find(item => item.id === id);
    try { setBusy(true); const count = await library.deleteCategory(id); setDeletingId(''); toast(`已删除“${category?.name || '分类'}”，${count} 本书变为未分类`); }
    catch (error) { toast(`删除失败：${error.message}`); }
    finally { setBusy(false); }
  };
  return <Modal close={close} className="category-manager" label="管理书架分类"><div className="modal-head"><div><p>书架整理</p><h2>管理分类</h2></div><button onClick={close} aria-label="关闭分类管理"><X/></button></div><form className="category-create" onSubmit={create}><label>新分类<input value={newName} maxLength={40} onChange={event => setNewName(event.target.value)} placeholder="例如：待读书单"/></label><button disabled={busy || !newName.trim()}><Plus size={15}/>新建</button></form><p className="category-helper">每本书只保留一个主分类。删除分类不会删除书籍，只会将相关书籍设为未分类。</p><div className="category-manager-list">{categories.length ? categories.map(category => { const count = countFor(category.id); const editing = editingId === category.id; const deleting = deletingId === category.id; return <div className="category-manager-row" key={category.id}><div className="category-row-title">{editing ? <input aria-label={`重命名 ${category.name}`} value={editingName} maxLength={40} onChange={event => setEditingName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') rename(category.id); if (event.key === 'Escape') setEditingId(''); }}/> : <><strong>{category.name}</strong><span>{count} 本书</span></>}</div>{editing ? <div className="category-row-actions"><button disabled={busy || !editingName.trim()} onClick={() => rename(category.id)}>保存</button><button disabled={busy} onClick={() => setEditingId('')}>取消</button></div> : <div className="category-row-actions"><button disabled={busy} onClick={() => { setEditingId(category.id); setEditingName(category.name); setDeletingId(''); }}>重命名</button><button disabled={busy} onClick={() => { setDeletingId(category.id); setEditingId(''); }}>删除</button></div>}{deleting && <div className="category-delete-confirm" role="alert"><span>确认删除“{category.name}”？{count ? `${count} 本书将变为未分类。` : '该分类目前没有书籍。'}</span><button disabled={busy} onClick={() => remove(category.id)}>确认删除</button><button disabled={busy} onClick={() => setDeletingId('')}>取消</button></div>}</div>; }) : <div className="empty compact"><strong>还没有分类</strong><span>新建分类后，可在书架中批量归类。</span></div>}</div></Modal>;
}

const LibraryBookCard = React.memo(function LibraryBookCard({ book, progress, categoryName, selectionMode, selected, onToggle, onEdit, onRemove }) {
  return <article className={`library-card card ${selected ? 'selected' : ''}`}><div className="library-card-cover">{selectionMode && <button type="button" className="book-selector" role="checkbox" aria-checked={selected} aria-label={`${selected ? '取消选择' : '选择'}《${book.title}》`} onClick={() => onToggle(book.id)}><Check size={15}/></button>}<a href={`#/reader/${encodeURIComponent(book.id)}`} tabIndex={selectionMode ? -1 : undefined}><Cover book={book}/></a></div><div><div className="library-card-meta"><span>{bookStatusLabel(book.status)}</span>{categoryName && <small>{categoryName}</small>}</div><h3>{book.title}</h3><p>{book.author}</p><div className="library-progress"><i style={{width:`${progress * 100}%`}}/></div><em>{Math.round(progress * 100)}% · {book.format}</em>{!selectionMode && <div className="card-actions"><a href={`#/reader/${encodeURIComponent(book.id)}`}>阅读</a><button onClick={() => onEdit(book)}>编辑</button><button aria-label={`删除《${book.title}》`} onClick={() => onRemove(book)}><Trash2 size={12}/></button></div>}</div></article>;
});

function Sidebar({ route, count, menu, close }) {
  const active = route.page === 'reader' ? '' : route.page;
  return <aside className={`sidebar ${menu ? 'show' : ''}`}><div className="brand"><div className="brand-mark"><BookOpen size={19}/></div><span>拾页</span></div><button className="close-menu" aria-label="关闭导航菜单" onClick={close}><X/></button><nav><p className="nav-label">阅读空间</p>{NAV.map(([label,Icon,href]) => { const key = href === '#/' ? 'home' : href.slice(2); return <a key={href} href={href} className={active === key ? 'active' : ''} onClick={close}><Icon size={18}/><span>{label}</span>{key === 'notes' && <em>{count}</em>}</a>; })}</nav><div className="sidebar-bottom"><div className="profile"><div className="avatar">拾</div><div><strong>本地阅读空间</strong><span>数据仅保存在此设备</span></div></div></div></aside>;
}

function Dashboard({ library, stats, openImport }) {
  const recent = [...library.books].sort((a,b) => String(b.lastOpenedAt).localeCompare(String(a.lastOpenedAt)))[0];
  const progress = recent ? library.progress.find(item => item.bookId === recent.id) : null;
  return <><section className="local-space-notice" aria-label="本地数据说明"><div><strong>本地阅读空间</strong><span>书籍、笔记与进度仅保存在当前浏览器；换设备前请先导出完整备份。</span></div><a href="#/settings">前往备份</a></section><section className="welcome"><div><span className="eyebrow">{new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'})}</span><h1>今天，读点什么？</h1><p>所有阅读、划线与笔记都保存在当前设备。</p></div><div className="streak"><span>连续阅读</span><strong>{stats.streak}<small> 天</small></strong></div></section>{recent ? <section className="current-real card"><Cover book={recent}/><div><span className="eyebrow">最近阅读</span><h2>{recent.title}</h2><p>{recent.author}</p><div className="progress"><i style={{width:`${Math.round((progress?.percentage || 0)*100)}%`}}/></div><span>{Math.round((progress?.percentage || 0)*100)}% · 今日 {stats.todayMinutes} 分钟</span><a className="primary-action" href={`#/reader/${encodeURIComponent(recent.id)}`}>继续阅读 <ChevronRight size={15}/></a></div></section> : <section className="empty-dashboard card"><BookPlus/><h2>书架还是空的</h2><p>导入你合法持有的电子书，开始本地阅读。</p><button className="primary-action" onClick={openImport}>导入第一本书</button></section>}<section className="quick-stats"><div className="card"><strong>{stats.bookCount}</strong><span>书架藏书</span></div><div className="card"><strong>{stats.noteCount}</strong><span>笔记</span></div><div className="card"><strong>{stats.highlightCount}</strong><span>划线</span></div><div className="card"><strong>{stats.todayMinutes}</strong><span>今日分钟</span></div></section></>;
}

function LibraryPage({ library, openImport, toast }) {
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [sort, setSort] = useState('recent');
  const [edit, setEdit] = useState(null);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [visibleCount, setVisibleCount] = useState(48);
  const categories = useMemo(() => [...library.categories].sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name, 'zh-CN')), [library.categories]);
  const categoryMap = useMemo(() => new Map(categories.map(category => [category.id, category])), [categories]);
  const progressMap = useMemo(() => new Map(library.progress.map(item => [item.bookId, item.percentage || 0])), [library.progress]);
  const categoryCounts = useMemo(() => {
    const counts = new Map(categories.map(category => [category.id, 0]));
    library.books.forEach(book => { const id = book.categoryIds?.[0]; if (counts.has(id)) counts.set(id, counts.get(id) + 1); });
    return counts;
  }, [categories, library.books]);
  const books = useMemo(() => library.books
    .filter(book => (statusFilter === 'ALL' || book.status === statusFilter) && (categoryFilter === 'ALL' || book.categoryIds?.[0] === categoryFilter))
    .sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'zh-CN') : String(b.updatedAt).localeCompare(String(a.updatedAt))), [library.books, statusFilter, categoryFilter, sort]);
  const visibleBooks = books.slice(0, visibleCount);
  useEffect(() => { setVisibleCount(48); setSelectedIds(new Set()); setCategoryMenuOpen(false); setStatusMenuOpen(false); }, [statusFilter, categoryFilter, sort]);
  useEffect(() => { if (categoryFilter !== 'ALL' && !categoryMap.has(categoryFilter)) setCategoryFilter('ALL'); }, [categoryFilter, categoryMap]);
  const remove = async book => { if (!confirm(`将《${book.title}》移入回收站？默认保留笔记与划线。`)) return; await library.deleteBook(book.id, true); toast('已移入回收站'); };
  const toggleSelected = id => setSelectedIds(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const setPrimaryCategory = async categoryId => {
    if (!selectedIds.size) return;
    try { setBatchBusy(true); const changed = await library.assignPrimaryCategory([...selectedIds], categoryId); const name = categoryMap.get(categoryId)?.name || '未分类'; toast(`${changed} 本书已设为“${name}”`); setSelectedIds(new Set()); setCategoryMenuOpen(false); }
    catch (error) { toast(`归类失败：${error.message}`); }
    finally { setBatchBusy(false); }
  };
  const setBatchStatus = async status => {
    if (!selectedIds.size) return;
    try { setBatchBusy(true); const changed = await library.updateBooksStatus([...selectedIds], status); toast(`${changed} 本书的阅读状态已更新`); setSelectedIds(new Set()); setStatusMenuOpen(false); }
    catch (error) { toast(`更新失败：${error.message}`); }
    finally { setBatchBusy(false); }
  };
  const selectAll = () => setSelectedIds(new Set(books.map(book => book.id)));
  const clearSelection = () => setSelectedIds(new Set());
  const exitSelection = () => { setSelectionMode(false); clearSelection(); setCategoryMenuOpen(false); setStatusMenuOpen(false); };
  return <section className="module-page"><div className="module-heading module-heading-row"><div><span className="eyebrow">真实本地数据</span><h1>我的书架</h1><p>用状态和唯一主分类整理你的本地阅读空间。</p></div><button className="primary-action" onClick={openImport}><BookPlus size={16}/>导入电子书</button></div><section className="shelf-controls" aria-label="书架筛选与管理"><div className="shelf-filter-line"><span>阅读状态</span><div className="filter-chips" role="group" aria-label="阅读状态筛选"><button aria-pressed={statusFilter==='ALL'} className={statusFilter==='ALL'?'active':''} onClick={() => setStatusFilter('ALL')}>全部</button>{BOOK_STATUSES.map(item => <button key={item.value} aria-pressed={statusFilter===item.value} className={statusFilter===item.value?'active':''} onClick={() => setStatusFilter(item.value)}>{item.label}</button>)}</div></div><div className="shelf-filter-line"><span>主分类</span><div className="filter-chips category-filter-chips" role="group" aria-label="主分类筛选"><button aria-pressed={categoryFilter==='ALL'} className={categoryFilter==='ALL'?'active':''} onClick={() => setCategoryFilter('ALL')}>全部 <em>{library.books.length}</em></button>{categories.map(category => <button key={category.id} aria-pressed={categoryFilter===category.id} className={categoryFilter===category.id?'active':''} onClick={() => setCategoryFilter(category.id)}>{category.name} <em>{categoryCounts.get(category.id) || 0}</em></button>)}</div></div><div className="shelf-control-footer"><div className="filter-chips compact" role="group" aria-label="书架排序"><button aria-pressed={sort==='recent'} className={sort==='recent'?'active':''} onClick={() => setSort('recent')}>最近更新</button><button aria-pressed={sort==='title'} className={sort==='title'?'active':''} onClick={() => setSort('title')}>书名排序</button></div><div className="shelf-control-actions"><button onClick={() => setCategoryManagerOpen(true)}>管理分类</button><button aria-pressed={selectionMode} className={selectionMode?'active':''} onClick={() => selectionMode ? exitSelection() : setSelectionMode(true)}>{selectionMode ? '退出多选' : '多选归类'}</button></div></div></section><div className="shelf-result-bar" aria-live="polite"><span>{categoryFilter !== 'ALL' || statusFilter !== 'ALL' ? '已筛选 · ' : ''}共 {books.length} 本书</span>{(categoryFilter !== 'ALL' || statusFilter !== 'ALL') && <button onClick={() => { setCategoryFilter('ALL'); setStatusFilter('ALL'); }}>清除筛选</button>}</div>{selectionMode && <section className="batch-actions" aria-label="批量整理"><strong>已选择 {selectedIds.size} 本</strong><button disabled={batchBusy || !books.length} onClick={selectedIds.size === books.length ? clearSelection : selectAll}>{selectedIds.size === books.length ? '取消全选' : '全选筛选结果'}</button><div className="batch-menu"><button disabled={batchBusy || !selectedIds.size} aria-expanded={categoryMenuOpen} onClick={() => { setCategoryMenuOpen(value => !value); setStatusMenuOpen(false); }}>设为主分类</button>{categoryMenuOpen && <div role="menu" className="batch-popover"><button role="menuitem" onClick={() => setPrimaryCategory('')}>设为未分类</button>{categories.map(category => <button role="menuitem" key={category.id} onClick={() => setPrimaryCategory(category.id)}>{category.name}</button>)}</div>}</div><div className="batch-menu"><button disabled={batchBusy || !selectedIds.size} aria-expanded={statusMenuOpen} onClick={() => { setStatusMenuOpen(value => !value); setCategoryMenuOpen(false); }}>修改状态</button>{statusMenuOpen && <div role="menu" className="batch-popover">{BOOK_STATUSES.map(item => <button role="menuitem" key={item.value} onClick={() => setBatchStatus(item.value)}>{item.label}</button>)}</div>}</div><button disabled={batchBusy || !selectedIds.size} onClick={() => setPrimaryCategory('')}>移出分类</button><button onClick={exitSelection}>完成</button></section>}{books.length ? <><div className={`library-grid ${selectionMode ? 'selection-mode' : ''}`}>{visibleBooks.map(book => <LibraryBookCard key={book.id} book={book} progress={progressMap.get(book.id) || 0} categoryName={categoryMap.get(book.categoryIds?.[0])?.name || ''} selectionMode={selectionMode} selected={selectedIds.has(book.id)} onToggle={toggleSelected} onEdit={setEdit} onRemove={remove}/>)}</div>{books.length > visibleBooks.length && <div className="shelf-more"><button onClick={() => setVisibleCount(count => count + 48)}>显示更多（还有 {books.length - visibleBooks.length} 本）</button></div>}</> : <div className="empty"><BookOpen/><strong>没有符合条件的书</strong><span>更改筛选，或导入一本电子书。</span></div>}{library.deletedBooks.length > 0 && <section className="trash-section"><h2>回收站</h2>{library.deletedBooks.map(book => { const trash = library.trash.find(item => item.entityId === book.id && item.state === 'TRASHED'); return <div key={book.id}><span>《{book.title}》· 保留至 {new Date(trash?.expiresAt || book.deletedAt).toLocaleDateString('zh-CN')}</span><button disabled={!trash} onClick={async () => { await library.restoreBook(trash.id); toast('书籍已恢复'); }}>恢复</button></div>; })}</section>}{edit && <BookEditDialog book={edit} library={library} close={() => setEdit(null)} toast={toast}/>} {categoryManagerOpen && <CategoryManagerDialog library={library} close={() => setCategoryManagerOpen(false)} toast={toast}/>}</section>;
}

function NotesPage({ library, highlightsOnly=false, toast }) {
  const [edit,setEdit]=useState(null);
  const params=new URLSearchParams((location.hash.split('?')[1]||'')); const focusedId=params.get('focus'); const tagId=params.get('tag');
  const source=highlightsOnly?library.highlights:library.notes; const list=tagId&&!highlightsOnly?source.filter(item=>(item.tagIds||[]).includes(tagId)):source;
  const bookMap=new Map(library.books.concat(library.deletedBooks).map(book=>[book.id,book]));
  useEffect(()=>{if(!focusedId)return;setTimeout(()=>document.getElementById(`record-${focusedId}`)?.focus(),0)},[focusedId]);
  return <section className="module-page"><div className="module-heading"><span className="eyebrow">{highlightsOnly?'原文摘录':'思想记录'}</span><h1>{highlightsOnly?'精彩划线':tagId?`标签：#${library.tags.find(tag=>tag.id===tagId)?.name||'未知'}`:'全部笔记'}</h1><p>点击来源可回到对应章节；无法重定位时会明确提示。</p></div>{list.length?<div className="note-list">{list.map(item=>{const book=bookMap.get(item.bookId);return <article id={`record-${item.id}`} tabIndex="-1" className="note-card" key={item.id}><Cover book={book||{title:'来源不可用'}} small/><div className="note-content"><div className="note-head"><div><h3>{book?.title||'来源不可用'}</h3><span>{new Date(item.updatedAt||item.createdAt).toLocaleString('zh-CN')}</span></div></div><p>“{item.content||item.quote}”</p><div className="card-actions">{book&&!book.deletedAt&&<a href={`#/reader/${book.id}?section=${item.locator?.sectionOrder||0}&offset=${item.locator?.offset||0}`}>尝试定位</a>}{!highlightsOnly&&<button onClick={()=>setEdit(item)}>编辑</button>}{highlightsOnly&&HIGHLIGHT_COLORS.map(color=><button aria-label={`改为${color.label}`} aria-pressed={item.color===color.value} title={color.label} key={color.value} onClick={async()=>{await library.saveHighlight({...item,color:color.value});toast('划线颜色已更新')}}>{color.label}</button>)}<button onClick={async()=>{await library.deleteAnnotation(highlightsOnly?'highlights':'notes',item.id);toast('已移入回收站');}}>删除</button></div></div></article>})}</div>:<div className="empty"><NotebookPen/><strong>这里暂时是空的</strong><span>{tagId?'此标签下没有笔记。':'阅读时选择文字即可划线或转为笔记。'}</span></div>}{library[highlightsOnly?'deletedHighlights':'deletedNotes'].length>0&&<section className="trash-section"><h2>{highlightsOnly?'划线':'笔记'}回收站</h2>{library[highlightsOnly?'deletedHighlights':'deletedNotes'].map(item=>{const trash=library.trash.find(entry=>entry.entityId===item.id&&entry.state==='TRASHED');return <div key={item.id}><span>{String(item.content||item.quote).slice(0,60)}</span><button disabled={!trash} onClick={async()=>{await library.restoreAnnotation(trash.id);toast('已恢复')}}>恢复</button></div>})}</section>}{edit&&<NoteDialog library={library} editing={edit} bookId={edit.bookId} close={()=>setEdit(null)} toast={toast}/>}</section>;
}

function StatisticsPage({ stats }) {
  const max=Math.max(1,...stats.weekMinutes.map(day=>day.minutes));
  return <section className="module-page"><div className="module-heading"><span className="eyebrow">由阅读会话计算</span><h1>阅读统计</h1><p>空数据保持为零，不使用演示值。</p></div><div className="stats-panel">{[[stats.bookCount,'书架藏书'],[stats.noteCount,'累计笔记'],[stats.highlightCount,'累计划线'],[stats.todayMinutes,'今日分钟']].map(([v,l])=><div className="stat-card card" key={l}><strong>{v}</strong><span>{l}</span></div>)}<div className="year-chart card"><span className="eyebrow">近 7 个本地自然日</span><h2>阅读分钟</h2><div className="chart-bars">{stats.weekMinutes.map(day=><i key={day.key} style={{height:`${Math.max(4,day.minutes/max*100)}%`}} title={`${day.minutes} 分钟`}><span>{day.label}</span></i>)}</div></div></div></section>;
}

function SettingsPage({ library, prefs, setPrefs, toast }) {
  const restoreRef=useRef(); const [busy,setBusy]=useState(false);
  const update=async patch=>{const next={...prefs,...patch};setPrefs(next);await library.saveSetting('reader-preferences',next);};
  const backup=async()=>{setBusy(true);try{await createFullBackup();toast('schema v2 完整快照已生成');}catch(e){toast(`快照导出失败：${e.message}`)}finally{setBusy(false)}};
  const restore=async file=>{if(!file)return;setBusy(true);try{const preview=await inspectBackup(file);const counts=Object.entries(preview.manifest.stores).filter(([,count])=>count).map(([name,count])=>`${name} ${count}`).join('，');if(!confirm(`将恢复快照（${counts||'空快照'}）并原子替换当前本地数据。建议先导出当前快照。恢复期间其他拾页标签页将暂停写入。是否继续？`))return;await library.runWithWriteBarrier(()=>restoreFullBackup(file));toast('快照已恢复，其他标签页已刷新');}catch(e){toast(`恢复失败：${e.message}。现有数据库未被修改。`)}finally{setBusy(false)}};
  const used=library.storage.quota?`${(library.storage.usage/1048576).toFixed(1)} / ${(library.storage.quota/1048576).toFixed(0)} MiB`:'浏览器未提供估算';
  return <section className="module-page"><div className="module-heading"><span className="eyebrow">所有控件即时生效</span><h1>设置</h1><p>阅读外观、存储与备份。</p></div><div className="settings-card card"><div><strong>界面主题</strong><span>跟随你的阅读环境</span></div><div className="theme-segment" role="group" aria-label="界面主题">{[['light',Sun,'日间'],['dark',Moon,'夜间'],['sepia',BookOpen,'暖色']].map(([v,I,l])=><button aria-pressed={prefs.theme===v} className={prefs.theme===v?'active':''} key={v} onClick={()=>update({theme:v})}><I size={14}/>{l}</button>)}</div><div><strong>正文字号</strong><span>{prefs.fontSize}px</span></div><input aria-label="正文字号" type="range" min="14" max="26" value={prefs.fontSize} onChange={e=>update({fontSize:+e.target.value})}/><div><strong>行距</strong><span>{prefs.lineHeight}</span></div><input aria-label="正文行距" type="range" min="1.5" max="2.6" step="0.1" value={prefs.lineHeight} onChange={e=>update({lineHeight:+e.target.value})}/><div><strong>正文宽度</strong><span>{prefs.width}px</span></div><input aria-label="正文宽度" type="range" min="560" max="920" step="20" value={prefs.width} onChange={e=>update({width:+e.target.value})}/><div><strong>本地存储</strong><span>{used} · {library.storage.persisted?'已获持久化':'未获持久化'}</span></div><button onClick={async()=>{const ok=await requestPersistentStorage();await library.reload();toast(ok?'已获得持久存储':'浏览器未授予持久存储，请定期备份');}}>请求持久存储</button><div><strong>完整快照 schema v2</strong><span>导出前校验当前数据；包含草稿、封面与原文件。恢复兼容无草稿的 schema v1 快照。</span></div><div className="dialog-buttons"><button disabled={busy} onClick={backup}>导出备份</button><button disabled={busy} onClick={()=>restoreRef.current?.click()}>恢复备份</button><input aria-label="选择备份文件" hidden ref={restoreRef} type="file" accept=".zip" onChange={e=>{const file=e.target.files?.[0];restore(file);e.target.value='';}}/></div></div></section>;
}

const pdfDocumentCache = new WeakMap();
async function getPdfDocument(blob) {
  if (!pdfDocumentCache.has(blob)) pdfDocumentCache.set(blob, (async()=>{const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');const worker=(await import('pdfjs-dist/legacy/build/pdf.worker.mjs?url')).default;pdfjs.GlobalWorkerOptions.workerSrc=worker;return { pdfjs, pdf: await pdfjs.getDocument({data:await blob.arrayBuffer(),isEvalSupported:false}).promise }})());
  return pdfDocumentCache.get(blob);
}
function PdfPage({ file, pageNumber, scale=1.25, textLayerRef }) {
  const canvasRef=useRef(); const textRef=useRef(); const [links,setLinks]=useState([]); const [error,setError]=useState('');
  useEffect(()=>{let cancelled=false;let renderTask;let textLayerTask;setError('');setLinks([]);(async()=>{try{const {pdfjs,pdf}=await getPdfDocument(file.blob);if(cancelled)return;const page=await pdf.getPage(pageNumber);if(cancelled)return;const viewport=page.getViewport({scale});const canvas=canvasRef.current;if(!canvas)return;canvas.width=viewport.width;canvas.height=viewport.height;canvas.style.width=`${viewport.width}px`;canvas.style.height=`${viewport.height}px`;renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport});await renderTask.promise;if(cancelled)return;const text=await page.getTextContent();if(cancelled)return;if(textRef.current){textRef.current.innerHTML='';const TextLayer=pdfjs.TextLayer;if(TextLayer){textLayerTask=new TextLayer({textContentSource:text,container:textRef.current,viewport});await textLayerTask.render();}}if(cancelled)return;const annotations=await page.getAnnotations({intent:'display'});if(!cancelled)setLinks(annotations.filter(a=>a.url&&/^https?:/i.test(a.url)).map(a=>({url:a.url,title:a.title||a.url})));}catch(e){if(!cancelled&&e?.name!=='RenderingCancelledException')setError(e.message)}})();return()=>{cancelled=true;renderTask?.cancel?.();textLayerTask?.cancel?.()}},[file,pageNumber,scale]);
  const assignTextRef=node=>{textRef.current=node;if(textLayerRef)textLayerRef.current=node};
  const openExternal=link=>{if(confirm(`即将离开拾页并打开外部链接：\n${link.url}\n是否继续？`))window.open(link.url,'_blank','noopener,noreferrer')};
  return <div className="pdf-page">{error&&<p role="alert">{error}</p>}<div className="pdf-canvas-wrap"><canvas ref={canvasRef}/><div ref={assignTextRef} className="textLayer" aria-label={`PDF 第 ${pageNumber} 页文本层`}/></div>{links.length>0&&<div className="pdf-links">本页外部链接：{links.map(link=><button key={link.url} onClick={()=>openExternal(link)}>{link.title}</button>)}</div>}</div>;
}

function textRangeLocator(root, range) {
  if (!root || !range || !root.contains(range.commonAncestorContainer)) return null;
  const rawQuote=range.toString(); const leading=rawQuote.match(/^\s*/)?.[0].length||0; const quote=rawQuote.trim().slice(0,1000);
  if(!quote)return null;
  const before = range.cloneRange(); before.selectNodeContents(root); before.setEnd(range.startContainer, range.startOffset);
  const offset = before.toString().length + leading; const text=root.textContent||'';
  return { offset, quote, prefix: text.slice(Math.max(0, offset - 32), offset), suffix: text.slice(offset + quote.length, offset + quote.length + 32) };
}

function scrollTextOffset(root, locator) {
  if (!root || !locator) return false;
  const text = root.textContent || ''; const quote=String(locator.quote||'');
  let target = Math.min(text.length, Math.max(0, Number(locator.offset) || 0));
  if (quote && text.slice(target, target + quote.length) !== quote) {
    const candidates=[];let index=text.indexOf(quote);while(index>=0){candidates.push(index);index=text.indexOf(quote,index+1)}
    const contextual=candidates.find(position=>(!locator.prefix||text.slice(Math.max(0,position-locator.prefix.length),position)===locator.prefix)&&(!locator.suffix||text.slice(position+quote.length,position+quote.length+locator.suffix.length)===locator.suffix));
    if(contextual!==undefined)target=contextual;else if(candidates.length===1)target=candidates[0];else return false;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let consumed = 0, node;
  while ((node = walker.nextNode())) { if (consumed + node.data.length >= target) { const range = document.createRange(); range.setStart(node, target - consumed); range.collapse(true); range.startContainer.parentElement?.scrollIntoView({ block: 'center' }); return true; } consumed += node.data.length; }
  return false;
}

function highlightedText(text, highlights) {
  const ranges = highlights.map(item => ({ item, start: Math.max(0, Number(item.locator?.offset) || 0), end: Math.max(0, Number(item.locator?.offset) || 0) + String(item.quote || '').length })).filter(range => range.end > range.start && text.slice(range.start, range.end) === range.item.quote).sort((a,b)=>a.start-b.start);
  const output=[]; let cursor=0;
  for(const range of ranges){if(range.start<cursor)continue;output.push(text.slice(cursor,range.start));output.push(<mark key={range.item.id} className={range.item.color?.toLowerCase()}>{text.slice(range.start,range.end)}</mark>);cursor=range.end}output.push(text.slice(cursor));return output;
}

function useBookContent(library, bookId) {
  const [state, setState] = useState({ loading: true, error: '', files: [], sections: [] });
  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: '', files: [], sections: [] });
    library.loadBookContent(bookId)
      .then(content => { if (!cancelled) setState({ loading: false, error: '', ...content }); })
      .catch(error => { if (!cancelled) setState({ loading: false, error: error.message || '无法读取本书正文', files: [], sections: [] }); });
    return () => { cancelled = true; };
  }, [bookId, library.loadBookContent]);
  return state;
}

function Reader({ book, library, prefs, toast, openNote }) {
  const content = useBookContent(library, book.id);
  if (content.loading) return <div className="reader-unavailable reader-loading"><LoaderCircle className="spin"/><h1>正在打开正文</h1><p>原文件与章节仅在打开此书时从本地读取。</p></div>;
  if (content.error) return <div className="reader-unavailable"><FileText/><h1>无法读取正文</h1><p>{content.error}</p><a href="#/library">返回书架</a></div>;
  return <ReaderContent book={book} library={library} prefs={prefs} toast={toast} openNote={openNote} sections={[...content.sections].sort((a,b) => a.order - b.order)} file={content.files.find(file => file.id === book.activeFileId) || content.files[0]}/>;
}

function ReaderContent({ book, library, prefs, toast, openNote, sections, file }) {
  const saved=library.progress.find(item=>item.bookId===book.id); const params=new URLSearchParams((location.hash.split('?')[1]||'')); const requested=params.get('section'); const requestedOffset=params.get('offset');
  const [order,setOrder]=useState(()=>Math.max(0,Math.min(sections.length-1,requested!==null?+requested:(saved?.locator?.sectionOrder||0))));
  const [panel,setPanel]=useState('toc'); const [annotationsOpen,setAnnotationsOpen]=useState(false); const [query,setQuery]=useState(''); const [selection,setSelection]=useState(null); const [selectedHighlight,setSelectedHighlight]=useState(null);
  const lastActivity=useRef(Date.now()); const accountedThrough=useRef(lastActivity.current); const pendingSession=useRef({startedAt:0,seconds:0}); const sessionTimer=useRef(); const saveTimer=useRef(); const textRoot=useRef(); const current=sections[order];
  const results=useMemo(()=>query.trim()?sections.flatMap(section=>{const text=section.text||'';const i=text.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase());return i>=0?[{section,offset:i,quote:text.slice(i,i+query.trim().length),preview:text.slice(Math.max(0,i-35),i+query.length+70)}]:[]}):[],[query,sections]);
  useEffect(()=>{library.updateBook(book.id,{lastOpenedAt:new Date().toISOString(),status:book.status==='WANT_TO_READ'?'READING':book.status}).catch(()=>{});},[book.id]);
  useEffect(()=>{const flush=()=>{const pending=pendingSession.current;const seconds=Math.floor(pending.seconds);if(seconds<1)return;pendingSession.current={startedAt:pending.startedAt+seconds*1000,seconds:pending.seconds-seconds};library.addSession(book.id,new Date(pending.startedAt).toISOString(),seconds).catch(()=>{})};const accountUntil=now=>{const end=Math.min(now,lastActivity.current+60000);const credited=creditedActivitySeconds(accountedThrough.current,end);if(credited>0){if(!pendingSession.current.startedAt)pendingSession.current.startedAt=accountedThrough.current;pendingSession.current.seconds+=credited;accountedThrough.current=end}};const onActivity=()=>{const now=Date.now();accountUntil(now);lastActivity.current=now;accountedThrough.current=now};const onVisibility=()=>{if(document.hidden){accountUntil(Date.now());flush()}else{lastActivity.current=Date.now();accountedThrough.current=lastActivity.current}};sessionTimer.current=setInterval(()=>{accountUntil(Date.now());flush()},5000);addEventListener('scroll',onActivity,{passive:true});addEventListener('keydown',onActivity);addEventListener('pointerdown',onActivity);document.addEventListener('visibilitychange',onVisibility);return()=>{accountUntil(Date.now());flush();clearInterval(sessionTimer.current);removeEventListener('scroll',onActivity);removeEventListener('keydown',onActivity);removeEventListener('pointerdown',onActivity);document.removeEventListener('visibilitychange',onVisibility)}},[book.id]);
  useEffect(()=>{const locator=requested!==null&&+requested===order?{...(saved?.locator||{}),sectionOrder:order,offset:Number(requestedOffset)||0}:saved?.locator?.sectionOrder===order?saved.locator:null;if(!locator)return;const timer=setTimeout(()=>{if(book.format==='PDF')scrollTo(0,0);else if(!scrollTextOffset(textRoot.current,locator))toast('已恢复到章节；精确位置暂时无法匹配')},80);return()=>clearTimeout(timer)},[current?.id]);
  useEffect(()=>{const persist=()=>{if(!current)return;const ratio=Math.max(0,Math.min(1,scrollY/Math.max(1,document.documentElement.scrollHeight-innerHeight)));const offset=book.format==='PDF'?0:Math.round(ratio*(current.text?.length||1));const locator=buildLocator(book,current,offset,book.format==='PDF'?{pageProgression:ratio}:{sectionProgression:ratio});library.saveProgress(book.id,locator,calculateProgress(sections,locator)).catch(()=>toast('进度保存失败'));};const schedule=()=>{clearTimeout(saveTimer.current);saveTimer.current=setTimeout(persist,700)};schedule();addEventListener('scroll',schedule,{passive:true});addEventListener('pagehide',persist);return()=>{removeEventListener('scroll',schedule);removeEventListener('pagehide',persist);clearTimeout(saveTimer.current);persist()}},[order,current?.id]);
  const currentViewportLocator=()=>{const ratio=Math.max(0,Math.min(1,scrollY/Math.max(1,document.documentElement.scrollHeight-innerHeight)));return buildLocator(book,current,book.format==='PDF'?0:Math.round(ratio*(current?.text?.length||1)),book.format==='PDF'?{pageProgression:ratio}:{sectionProgression:ratio})};
  useEffect(()=>{setSelection(null);getSelection()?.removeAllRanges()},[current?.id]);
  const selectText=()=>{const range=getSelection()?.rangeCount?getSelection().getRangeAt(0):null;const located=textRangeLocator(textRoot.current,range);if(located?.quote)setSelection({...located,sectionId:current?.id,sectionOrder:order});};
  const highlight=async color=>{if(!selection||selection.sectionId!==current?.id){setSelection(null);getSelection()?.removeAllRanges();toast('章节已切换，请重新选择文字');return}const locator=buildLocator(book,current,selection.offset,selection);const record=await library.saveHighlight({bookId:book.id,quote:selection.quote,color,locator});setSelection(null);getSelection()?.removeAllRanges();setSelectedHighlight(record);toast(book.format==='PDF'?'划线已保存到当前页':'划线已保存并可按上下文定位');};
  const addBookmark=async()=>{await library.saveBookmark({bookId:book.id,label:current?.title||`第 ${order+1} 节`,locator:currentViewportLocator()});toast('书签已添加');};
  if(!sections.length&&book.capability==='FILE_ONLY')return <div className="reader-shell"><header><a href="#/library"><ArrowLeft/>返回书架</a><strong>{book.title}</strong><span/></header><div className="reader-unavailable"><FileText/><h1>此格式仅保存原文件</h1><p>MOBI/AZW3 或固定版式 EPUB 暂不支持正文阅读，请转换为流式 EPUB、PDF、TXT 或 Markdown。</p></div></div>;
  if(!sections.length)return <div className="reader-unavailable"><FileText/><h1>没有可显示的正文</h1><p>该文件没有解析出可读章节。原文件仍安全保存在书架中。</p><a href="#/library">返回书架</a></div>;
  return <div className="reader-workspace"><header className="reader-top"><a href="#/library"><ArrowLeft size={17}/>返回书架</a><div><strong>{book.title}</strong><span>{order+1} / {sections.length}</span></div><div className="reader-tools"><button aria-label="切换目录面板" aria-pressed={panel==='toc'} onClick={()=>setPanel(panel==='toc'?'':'toc')}><List size={16}/>目录</button><button aria-label="添加当前位置书签" onClick={addBookmark}><Bookmark size={16}/>书签</button><button aria-label="切换书内搜索" aria-pressed={panel==='search'} onClick={()=>setPanel(panel==='search'?'':'search')}><Search size={16}/>书内搜索</button><button aria-label="切换记录面板" aria-pressed={annotationsOpen} onClick={()=>setAnnotationsOpen(value=>!value)}><Highlighter size={16}/>记录</button></div></header><div className={`reader-layout ${panel?'has-panel':''} ${annotationsOpen?'has-annotations':'no-annotations'}`}>{panel&&<aside className="reader-panel"><div className="panel-tabs"><button className={panel==='toc'?'active':''} onClick={()=>setPanel('toc')}>目录</button><button className={panel==='bookmarks'?'active':''} onClick={()=>setPanel('bookmarks')}>书签</button><button className={panel==='search'?'active':''} onClick={()=>setPanel('search')}>搜索</button></div>{panel==='toc'&&(book.toc?.length?book.toc:sections.map(s=>({label:s.title,sectionOrder:s.order}))).map((item,i)=><button className={item.sectionOrder===order?'active':''} key={i} onClick={()=>{setOrder(item.sectionOrder);scrollTo(0,0)}}>{item.label}</button>)}{panel==='bookmarks'&&library.bookmarks.filter(item=>item.bookId===book.id).map(item=><button key={item.id} onClick={()=>{setOrder(item.locator?.sectionOrder||0);setTimeout(()=>scrollTextOffset(textRoot.current,item.locator),80)}}>{item.label}</button>)}{panel==='search'&&<><input aria-label="搜索当前书正文" autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索当前书正文"/>{results.map((r,i)=><button key={i} onClick={()=>{setOrder(r.section.order);setTimeout(()=>{if(!scrollTextOffset(textRoot.current,buildLocator(book,r.section,r.offset,{quote:r.quote})))toast('已打开匹配章节，但无法确认精确文字位置')},80)}}><strong>{r.section.title}</strong><span>{r.preview}</span></button>)}{query&&!results.length&&<p>没有找到匹配内容</p>}</>}</aside>}<main className="reader-main" onMouseUp={selectText}>{book.format==='PDF'&&file?<PdfPage file={file} pageNumber={order+1} textLayerRef={textRoot}/>: <article style={{maxWidth:prefs.width,fontSize:prefs.fontSize,lineHeight:prefs.lineHeight}}><span className="eyebrow">{book.format} · {order+1}/{sections.length}</span><h1>{current?.title||book.title}</h1><p ref={textRoot} className="reader-text">{highlightedText(current?.text||'',library.highlights.filter(h=>h.bookId===book.id&&h.locator?.sectionOrder===order))}</p></article>}<div className="chapter-nav"><button disabled={order<=0} onClick={()=>{setOrder(o=>o-1);scrollTo(0,0)}}><ChevronLeft/>上一章</button><button disabled={order>=sections.length-1} onClick={()=>{setOrder(o=>o+1);scrollTo(0,0)}}>下一章<ChevronRight/></button></div></main>{annotationsOpen&&<aside className="annotation-panel"><h3>本章记录</h3>{library.highlights.filter(h=>h.bookId===book.id&&h.locator?.sectionOrder===order).map(h=><div className={`highlight-item ${h.color.toLowerCase()}`} key={h.id}><p>{h.quote}</p><button onClick={()=>openNote(h)}>转为笔记</button></div>)}{library.notes.filter(n=>n.bookId===book.id&&n.locator?.sectionOrder===order).map(n=><div className="side-note" key={n.id}><p>{n.content}</p></div>)}</aside>}</div>{selection&&<div className="selection-toolbar"><span>已选择 {selection.quote.length} 字</span>{HIGHLIGHT_COLORS.map(c=><button aria-label={`保存${c.label}划线`} title={c.label} className={c.value.toLowerCase()} key={c.value} onClick={()=>highlight(c.value)}/>) }<button onClick={()=>{if(selection.sectionId!==current?.id){setSelection(null);toast('章节已切换，请重新选择文字');return}openNote({quote:selection.quote,locator:buildLocator(book,current,selection.offset,selection)})}}>写笔记</button><button aria-label="取消选择" onClick={()=>{getSelection()?.removeAllRanges();setSelection(null)}}><X size={14}/></button></div>}{selectedHighlight&&null}</div>;
}

function AppShell() {
  const library=useLibrary(); const route=useRoute(); const [menu,setMenu]=useState(false); const [modal,setModal]=useState(''); const [noteContext,setNoteContext]=useState(null); const [toastMessage,setToastMessage]=useState(''); const [query,setQuery]=useState(''); const [offlineStatus,setOfflineStatus]=useState('preparing');
  const savedPrefs=library.settings.find(item=>item.id==='reader-preferences')?.value; const [prefs,setPrefs]=useState({theme:'light',fontSize:18,lineHeight:2,width:720,...savedPrefs});
  useEffect(()=>{if(savedPrefs)setPrefs(value=>({...value,...savedPrefs}))},[JSON.stringify(savedPrefs)]);
  useEffect(()=>{document.documentElement.dataset.theme=prefs.theme},[prefs.theme]);
  useEffect(()=>{if(!navigator.serviceWorker){setOfflineStatus('unavailable');return}navigator.serviceWorker.getRegistration().then(registration=>{const worker=registration?.active;if(!worker){setOfflineStatus('unavailable');return}const channel=new MessageChannel();const timeout=setTimeout(()=>setOfflineStatus('unavailable'),2500);channel.port1.onmessage=event=>{clearTimeout(timeout);setOfflineStatus(event.data?.cached||event.data?.complete?'ready':'preparing')};worker.postMessage({type:'CACHE_STATUS'},[channel.port2])}).catch(()=>setOfflineStatus('unavailable'))},[]);
  const toast=message=>{setToastMessage(message);setTimeout(()=>setToastMessage(''),3000)};
  const stats=useMemo(()=>calculateStatistics(library),[library.books,library.notes,library.highlights,library.sessions]);
  const search=useMemo(()=>globalSearch(library,query),[library.books,library.notes,library.tags,query]);
  useEffect(()=>{const handler=e=>{if(!(e.metaKey||e.ctrlKey)||modal)return;const target=e.target;if(target instanceof HTMLElement&&(target.matches('input,textarea,select,[contenteditable="true"]')||target.closest('[role="dialog"]')))return;const key=e.key.toLowerCase();if(key==='o'){e.preventDefault();setModal('import')}if(key==='n'){e.preventDefault();setNoteContext(null);setModal('note')}if(key==='k'){e.preventDefault();document.querySelector('.global-search input')?.focus()}};addEventListener('keydown',handler);return()=>removeEventListener('keydown',handler)},[modal]);
  const openBook=book=>location.hash=`#/reader/${encodeURIComponent(book.id)}`;
  if(library.loading)return <div className="app-loading"><LoaderCircle className="spin"/><strong>正在打开本地阅读空间</strong></div>;
  if(library.error)return <div className="app-loading"><strong>无法读取本地数据</strong><p>{library.error}</p><button onClick={library.reload}>重试</button></div>;
  const readerBook=route.page==='reader'?library.books.find(book=>book.id===route.bookId):null;
  if(route.page==='reader')return readerBook?<><Reader book={readerBook} library={library} prefs={prefs} toast={toast} openNote={highlight=>{setNoteContext(highlight);setModal('note')}}/>{modal==='note'&&<NoteDialog library={library} bookId={readerBook.id} highlight={noteContext} close={()=>setModal('')} toast={toast}/>}<Toast message={toastMessage}/></>:<div className="reader-unavailable"><h1>找不到这本书</h1><a href="#/library">返回书架</a></div>;
  let page;if(route.page==='library')page=<LibraryPage library={library} openImport={()=>setModal('import')} toast={toast}/>;else if(route.page==='notes')page=<NotesPage library={library} toast={toast}/>;else if(route.page==='highlights')page=<NotesPage library={library} highlightsOnly toast={toast}/>;else if(route.page==='statistics')page=<StatisticsPage stats={stats}/>;else if(route.page==='settings')page=<SettingsPage library={library} prefs={prefs} setPrefs={setPrefs} toast={toast}/>;else page=<Dashboard library={library} stats={stats} openImport={()=>setModal('import')}/>;
  return <div className="app"><Sidebar route={route} count={library.notes.length} menu={menu} close={()=>setMenu(false)}/><main className="app-main">{library.migrationWarning&&<div className="migration-banner" role="alert"><strong>旧版数据未迁移</strong><span>{library.migrationWarning}；原数据已保留在浏览器，可正常导入新书。</span></div>}<header><button className="menu-button" aria-label="打开导航菜单" aria-expanded={menu} onClick={()=>setMenu(true)}><Menu/></button><div className="search global-search"><Search size={18}/><input aria-label="全局业务搜索" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索书名、作者、ISBN、笔记或标签"/>{query&&<button aria-label="清除搜索" onClick={()=>setQuery('')}><X size={14}/></button>}</div><div className="header-actions"><span className={`offline-badge ${offlineStatus==='ready'?'ready':''}`}>{offlineStatus==='ready'?'离线资源已缓存':offlineStatus==='preparing'?'离线资源准备中':'离线资源不可用'}</span><button className="import-button" aria-label="导入电子书" onClick={()=>setModal('import')}><Upload size={16}/><span>导入</span></button><button className="new-note" aria-label="新建笔记" onClick={()=>{setNoteContext(null);setModal('note')}}><Plus size={17}/><span>新建笔记</span></button></div></header><div className="content">{query&&<section className="search-results card"><div><strong>正在搜索：{query}</strong><button onClick={()=>setQuery('')}>清除</button></div>{search.books.map(book=><button key={book.id} onClick={()=>openBook(book)}>书籍 · {book.title} — {book.author}</button>)}{search.notes.map(note=><a key={note.id} href={`#/notes?focus=${encodeURIComponent(note.id)}`}>笔记 · {note.content.slice(0,80)}</a>)}{search.tags.map(tag=><a key={tag.id} href={`#/notes?tag=${encodeURIComponent(tag.id)}`}>标签 · #{tag.name}</a>)}{!search.books.length&&!search.notes.length&&!search.tags.length&&<p>没有业务数据匹配；全局搜索不检索正文。</p>}</section>}{page}<footer>拾页 · 本地优先的桌面阅读与深度笔记工具</footer></div></main>{menu&&<div className="menu-shade" onClick={()=>setMenu(false)}/>} {modal==='import'&&<ImportDialog library={library} close={()=>setModal('')} openBook={openBook} toast={toast}/>} {modal==='note'&&<NoteDialog library={library} highlight={noteContext} close={()=>setModal('')} toast={toast}/>}<Toast message={toastMessage}/></div>;
}

export default AppShell;
