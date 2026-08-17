import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, BarChart3, BookOpen, BookPlus, Bookmark, Check, ChevronLeft, ChevronRight,
  Download, FileText, Highlighter, House, Library, List, LoaderCircle, Menu, Moon,
  NotebookPen, Plus, Search, Settings, Sun, Trash2, Upload, X,
} from 'lucide-react';
import { ACCEPTED_EBOOKS, parseEbookFile } from './ebookParser.js';
import { createFullBackup, restoreFullBackup } from './backup.js';
import { requestPersistentStorage } from './db.js';
import {
  BOOK_STATUSES, HIGHLIGHT_COLORS, bookStatusLabel, buildLocator, calculateProgress,
  calculateStatistics, globalSearch,
} from './domain.js';
import { useLibrary } from './useLibrary.js';
import { polishText } from './textPolish.js';

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
  const url = useBlobUrl(book?.coverBlob, book?.coverUrl || '');
  if (url) return <div className={`cover image-cover ${small ? 'small' : ''}`}><img src={url} alt={`${book?.title || '书籍'}封面`}/></div>;
  return <div className={`cover note ${small ? 'small' : ''}`}><span className="cover-top">SHI YE</span><strong>{book?.title || '拾页'}</strong><span className="cover-bottom">LOCAL READER</span></div>;
}

function Toast({ message, action }) {
  if (!message) return null;
  return <div className="toast" role="status"><Check size={15}/>{message}{action}</div>;
}

function Modal({ children, close, className = '' }) {
  useEffect(() => { const handler = e => e.key === 'Escape' && close(); addEventListener('keydown', handler); return () => removeEventListener('keydown', handler); }, [close]);
  return <div className="modal-backdrop" onMouseDown={close}><div className={`modal ${className}`} role="dialog" aria-modal="true" onMouseDown={e => e.stopPropagation()}>{children}</div></div>;
}

function ImportDialog({ library, close, openBook, toast }) {
  const inputRef = useRef();
  const [state, setState] = useState({ status: 'idle', message: '' });
  const [duplicate, setDuplicate] = useState(null);
  const [pending, setPending] = useState(null);
  const importFile = async (file, keepDuplicate = false) => {
    if (!file) return;
    setState({ status: 'loading', message: `正在解析 ${file.name}` });
    try {
      const parsed = pending?.file === file ? pending.parsed : await parseEbookFile(file);
      const result = await library.importPublication(file, parsed, { keepDuplicate });
      if (result.duplicate) { setDuplicate(result.duplicate); setPending({ file, parsed }); setState({ status: 'duplicate', message: '检测到相同原文件' }); return; }
      setState({ status: 'success', message: `《${result.book.title}》已安全写入本地数据库`, book: result.book });
      setDuplicate(null); setPending(null); toast('导入完成');
    } catch (error) { setState({ status: 'error', message: `${error.message || '导入失败'}。原有数据未被修改，请重试。` }); }
  };
  return <Modal close={close} className="import-modal"><div className="modal-head"><div><p>本地优先 · 原文件保存在当前浏览器</p><h2>导入电子书</h2></div><button onClick={close} aria-label="关闭"><X/></button></div>
    <input ref={inputRef} hidden type="file" accept={ACCEPTED_EBOOKS} onChange={e => importFile(e.target.files?.[0])}/>
    {state.status === 'idle' && <button className="file-dropzone" onClick={() => inputRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); importFile(e.dataTransfer.files?.[0]); }}><Upload size={28}/><strong>选择或拖入电子书</strong><span>完整阅读：流式 EPUB、PDF、TXT、Markdown</span><em>MOBI/AZW3 仅识别保存，不声称可阅读；最大 200MiB</em></button>}
    {state.status === 'loading' && <div className="file-feedback"><LoaderCircle className="spin"/><strong>解析并提交中</strong><span>{state.message}</span></div>}
    {state.status === 'duplicate' && <div className="file-feedback"><FileText/><strong>这本书已经在书架中</strong><span>打开已有书籍，或保留一份独立副本。</span><div className="dialog-buttons"><button onClick={() => { close(); openBook(duplicate); }}>打开已有</button><button onClick={() => importFile(pending.file, true)}>保留副本</button></div></div>}
    {state.status === 'error' && <div className="file-feedback error"><strong>未能导入</strong><span>{state.message}</span><button onClick={() => setState({ status: 'idle', message: '' })}>重新选择</button></div>}
    {state.status === 'success' && <div className="file-success"><Cover book={state.book}/><div><span><Check size={14}/>已提交</span><h3>{state.book.title}</h3><p>{state.book.author}</p><em>{state.message}</em><div className="dialog-buttons"><button onClick={() => { close(); openBook(state.book); }}>立即阅读</button><button onClick={() => setState({ status: 'idle', message: '' })}>继续导入</button></div></div></div>}
  </Modal>;
}

function NoteDialog({ library, close, bookId = '', highlight = null, editing = null, toast }) {
  const [type, setType] = useState(editing?.type || (highlight ? '摘录' : '感悟'));
  const [content, setContent] = useState(editing?.content || highlight?.quote || '');
  const [tags, setTags] = useState((editing?.tagIds || []).map(id => library.tags.find(tag => tag.id === id)?.name).filter(Boolean).join('，'));
  const save = async () => {
    if (!content.trim()) return;
    try {
      const tagIds = await library.ensureTags(tags.split(/[,，#\s]+/));
      await library.saveNote({ ...editing, bookId: bookId || editing?.bookId || '', highlightId: highlight?.id || editing?.highlightId, locator: highlight?.locator || editing?.locator, type, content: type === '摘录' ? content.trim() : polishText(content), originalContent: content.trim(), tagIds });
      toast('笔记已保存'); close();
    } catch (error) { toast(`保存失败：${error.message}`); }
  };
  return <Modal close={close} className="note-modal"><div className="modal-head"><div><p>自动保留原文</p><h2>{editing ? '编辑笔记' : '记录此刻的想法'}</h2></div><button onClick={close}><X/></button></div><div className="note-types">{['感悟','摘录','问题','行动'].map(item => <button key={item} className={type === item ? 'active' : ''} onClick={() => setType(item)}>{item}</button>)}</div><label className="field-label">标签<input value={tags} onChange={e => setTags(e.target.value)} placeholder="思考，历史"/></label><textarea autoFocus value={content} onChange={e => setContent(e.target.value)} maxLength={12000}/><div className="modal-actions"><span>{content.length}/12000 · 摘录不自动修改</span><button disabled={!content.trim()} onClick={save}><Check size={15}/>保存</button></div></Modal>;
}

function BookEditDialog({ book, library, close, toast }) {
  const [form, setForm] = useState({ title: book.title, author: book.author, status: book.status || 'WANT_TO_READ' });
  const save = async () => { await library.updateBook(book.id, form); toast('书籍信息已更新'); close(); };
  return <Modal close={close}><div className="modal-head"><div><p>书籍信息</p><h2>编辑《{book.title}》</h2></div><button onClick={close}><X/></button></div><div className="form-stack"><label>书名<input value={form.title} onChange={e => setForm({...form,title:e.target.value})}/></label><label>作者<input value={form.author} onChange={e => setForm({...form,author:e.target.value})}/></label><label>阅读状态<select value={form.status} onChange={e => setForm({...form,status:e.target.value})}>{BOOK_STATUSES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div><div className="modal-actions"><span/><button onClick={save}>保存修改</button></div></Modal>;
}

function Sidebar({ route, count, menu, close }) {
  const active = route.page === 'reader' ? '' : route.page;
  return <aside className={`sidebar ${menu ? 'show' : ''}`}><div className="brand"><div className="brand-mark"><BookOpen size={19}/></div><span>拾页</span></div><button className="close-menu" onClick={close}><X/></button><nav><p className="nav-label">阅读空间</p>{NAV.map(([label,Icon,href]) => { const key = href === '#/' ? 'home' : href.slice(2); return <a key={href} href={href} className={active === key ? 'active' : ''} onClick={close}><Icon size={18}/><span>{label}</span>{key === 'notes' && <em>{count}</em>}</a>; })}</nav><div className="sidebar-bottom"><div className="profile"><div className="avatar">拾</div><div><strong>本地阅读空间</strong><span>数据仅保存在此设备</span></div></div></div></aside>;
}

function Dashboard({ library, stats, openImport }) {
  const recent = [...library.books].sort((a,b) => String(b.lastOpenedAt).localeCompare(String(a.lastOpenedAt)))[0];
  const progress = recent ? library.progress.find(item => item.bookId === recent.id) : null;
  return <><section className="welcome"><div><span className="eyebrow">{new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'})}</span><h1>今天，读点什么？</h1><p>所有阅读、划线与笔记都保存在当前设备。</p></div><div className="streak"><span>连续阅读</span><strong>{stats.streak}<small> 天</small></strong></div></section>{recent ? <section className="current-real card"><Cover book={recent}/><div><span className="eyebrow">最近阅读</span><h2>{recent.title}</h2><p>{recent.author}</p><div className="progress"><i style={{width:`${Math.round((progress?.percentage || 0)*100)}%`}}/></div><span>{Math.round((progress?.percentage || 0)*100)}% · 今日 {stats.todayMinutes} 分钟</span><a className="primary-action" href={`#/reader/${encodeURIComponent(recent.id)}`}>继续阅读 <ChevronRight size={15}/></a></div></section> : <section className="empty-dashboard card"><BookPlus/><h2>书架还是空的</h2><p>导入你合法持有的电子书，开始本地阅读。</p><button className="primary-action" onClick={openImport}>导入第一本书</button></section>}<section className="quick-stats"><div className="card"><strong>{stats.bookCount}</strong><span>书架藏书</span></div><div className="card"><strong>{stats.noteCount}</strong><span>笔记</span></div><div className="card"><strong>{stats.highlightCount}</strong><span>划线</span></div><div className="card"><strong>{stats.todayMinutes}</strong><span>今日分钟</span></div></section></>;
}

function LibraryPage({ library, openImport, toast }) {
  const [filter, setFilter] = useState('ALL'); const [sort, setSort] = useState('recent'); const [edit, setEdit] = useState(null);
  const books = useMemo(() => library.books.filter(book => filter === 'ALL' || book.status === filter).sort((a,b) => sort === 'title' ? a.title.localeCompare(b.title,'zh-CN') : String(b.updatedAt).localeCompare(String(a.updatedAt))), [library.books,filter,sort]);
  const remove = async book => { if (!confirm(`将《${book.title}》移入回收站？默认保留笔记与划线。`)) return; await library.deleteBook(book.id,true); toast('已移入回收站'); };
  return <section className="module-page"><div className="module-heading module-heading-row"><div><span className="eyebrow">真实本地数据</span><h1>我的书架</h1><p>管理状态、排序、删除和恢复。</p></div><button className="primary-action" onClick={openImport}><BookPlus size={16}/>导入电子书</button></div><div className="library-toolbar"><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="ALL">全部状态</option>{BOOK_STATUSES.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select><select value={sort} onChange={e=>setSort(e.target.value)}><option value="recent">最近更新</option><option value="title">按书名</option></select></div>{books.length ? <div className="library-grid">{books.map(book => { const progress=library.progress.find(item=>item.bookId===book.id)?.percentage||0; return <article className="library-card card" key={book.id}><a href={`#/reader/${encodeURIComponent(book.id)}`}><Cover book={book}/></a><div><span>{bookStatusLabel(book.status)}</span><h3>{book.title}</h3><p>{book.author}</p><div className="library-progress"><i style={{width:`${progress*100}%`}}/></div><em>{Math.round(progress*100)}% · {book.format}</em><div className="card-actions"><a href={`#/reader/${encodeURIComponent(book.id)}`}>阅读</a><button onClick={()=>setEdit(book)}>编辑</button><button onClick={()=>remove(book)}><Trash2 size={12}/></button></div></div></article>; })}</div> : <div className="empty"><BookOpen/><strong>没有符合条件的书</strong><span>更改筛选，或导入一本电子书。</span></div>}{library.deletedBooks.length>0&&<section className="trash-section"><h2>回收站</h2>{library.deletedBooks.map(book=>{const trash=library.trash.find(item=>item.entityId===book.id&&item.state==='TRASHED');return <div key={book.id}><span>《{book.title}》· 保留至 {new Date(trash?.expiresAt||book.deletedAt).toLocaleDateString('zh-CN')}</span><button disabled={!trash} onClick={async()=>{await library.restoreBook(trash.id);toast('书籍已恢复')}}>恢复</button></div>})}</section>}{edit && <BookEditDialog book={edit} library={library} close={()=>setEdit(null)} toast={toast}/>}</section>;
}

function NotesPage({ library, highlightsOnly=false, toast }) {
  const [edit,setEdit]=useState(null); const list=highlightsOnly?library.highlights:library.notes;
  const bookMap=new Map(library.books.concat(library.deletedBooks).map(book=>[book.id,book]));
  return <section className="module-page"><div className="module-heading"><span className="eyebrow">{highlightsOnly?'原文摘录':'思想记录'}</span><h1>{highlightsOnly?'精彩划线':'全部笔记'}</h1><p>点击来源可回到对应章节。</p></div>{list.length?<div className="note-list">{list.map(item=>{const book=bookMap.get(item.bookId);return <article className="note-card" key={item.id}><Cover book={book||{title:'来源不可用'}} small/><div className="note-content"><div className="note-head"><div><h3>{book?.title||'来源不可用'}</h3><span>{new Date(item.updatedAt||item.createdAt).toLocaleString('zh-CN')}</span></div></div><p>“{item.content||item.quote}”</p><div className="card-actions">{book&&!book.deletedAt&&<a href={`#/reader/${book.id}?section=${item.locator?.sectionOrder||0}`}>定位</a>}{!highlightsOnly&&<button onClick={()=>setEdit(item)}>编辑</button>}<button onClick={async()=>{await library.deleteAnnotation(highlightsOnly?'highlights':'notes',item.id);toast('已移入回收站');}}>删除</button></div></div></article>})}</div>:<div className="empty"><NotebookPen/><strong>这里暂时是空的</strong><span>阅读时选择文字即可划线或转为笔记。</span></div>}{edit&&<NoteDialog library={library} editing={edit} bookId={edit.bookId} close={()=>setEdit(null)} toast={toast}/>}</section>;
}

function StatisticsPage({ stats }) {
  const max=Math.max(1,...stats.weekMinutes.map(day=>day.minutes));
  return <section className="module-page"><div className="module-heading"><span className="eyebrow">由阅读会话计算</span><h1>阅读统计</h1><p>空数据保持为零，不使用演示值。</p></div><div className="stats-panel">{[[stats.bookCount,'书架藏书'],[stats.noteCount,'累计笔记'],[stats.highlightCount,'累计划线'],[stats.todayMinutes,'今日分钟']].map(([v,l])=><div className="stat-card card" key={l}><strong>{v}</strong><span>{l}</span></div>)}<div className="year-chart card"><span className="eyebrow">近 7 个本地自然日</span><h2>阅读分钟</h2><div className="chart-bars">{stats.weekMinutes.map(day=><i key={day.key} style={{height:`${Math.max(4,day.minutes/max*100)}%`}} title={`${day.minutes} 分钟`}><span>{day.label}</span></i>)}</div></div></div></section>;
}

function SettingsPage({ library, prefs, setPrefs, toast }) {
  const restoreRef=useRef(); const [busy,setBusy]=useState(false);
  const update=async patch=>{const next={...prefs,...patch};setPrefs(next);await library.saveSetting('reader-preferences',next);};
  const backup=async()=>{setBusy(true);try{await createFullBackup();toast('完整备份已生成');}catch(e){toast(`备份失败：${e.message}`)}finally{setBusy(false)}};
  const restore=async file=>{if(!file)return;if(!confirm('恢复会替换当前本地数据，是否继续？'))return;setBusy(true);try{await restoreFullBackup(file);await library.reload();toast('备份已恢复');}catch(e){toast(`恢复失败：${e.message}`)}finally{setBusy(false)}};
  const used=library.storage.quota?`${(library.storage.usage/1048576).toFixed(1)} / ${(library.storage.quota/1048576).toFixed(0)} MiB`:'浏览器未提供估算';
  return <section className="module-page"><div className="module-heading"><span className="eyebrow">所有控件即时生效</span><h1>设置</h1><p>阅读外观、存储与备份。</p></div><div className="settings-card card"><div><strong>界面主题</strong><span>跟随你的阅读环境</span></div><div className="theme-segment">{[['light',Sun,'日间'],['dark',Moon,'夜间'],['sepia',BookOpen,'暖色']].map(([v,I,l])=><button className={prefs.theme===v?'active':''} key={v} onClick={()=>update({theme:v})}><I size={14}/>{l}</button>)}</div><div><strong>正文字号</strong><span>{prefs.fontSize}px</span></div><input type="range" min="14" max="26" value={prefs.fontSize} onChange={e=>update({fontSize:+e.target.value})}/><div><strong>行距</strong><span>{prefs.lineHeight}</span></div><input type="range" min="1.5" max="2.6" step="0.1" value={prefs.lineHeight} onChange={e=>update({lineHeight:+e.target.value})}/><div><strong>正文宽度</strong><span>{prefs.width}px</span></div><input type="range" min="560" max="920" step="20" value={prefs.width} onChange={e=>update({width:+e.target.value})}/><div><strong>本地存储</strong><span>{used} · {library.storage.persisted?'已获持久化':'未获持久化'}</span></div><button onClick={async()=>{const ok=await requestPersistentStorage();await library.reload();toast(ok?'已获得持久存储':'浏览器未授予持久存储，请定期备份');}}>请求持久存储</button><div><strong>完整 ZIP 备份</strong><span>包含业务数据、封面与原始电子书文件并校验 SHA-256</span></div><div className="dialog-buttons"><button disabled={busy} onClick={backup}>导出备份</button><button disabled={busy} onClick={()=>restoreRef.current?.click()}>恢复备份</button><input hidden ref={restoreRef} type="file" accept=".zip" onChange={e=>restore(e.target.files?.[0])}/></div></div></section>;
}

function PdfPage({ file, pageNumber, scale=1.25 }) {
  const canvasRef=useRef(); const textRef=useRef(); const [links,setLinks]=useState([]); const [error,setError]=useState('');
  useEffect(()=>{let cancelled=false,task; (async()=>{try{const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');const worker=(await import('pdfjs-dist/legacy/build/pdf.worker.mjs?url')).default;pdfjs.GlobalWorkerOptions.workerSrc=worker;task=pdfjs.getDocument({data:await file.blob.arrayBuffer(),isEvalSupported:false});const pdf=await task.promise;const page=await pdf.getPage(pageNumber);if(cancelled)return;const viewport=page.getViewport({scale});const canvas=canvasRef.current;canvas.width=viewport.width;canvas.height=viewport.height;canvas.style.width=`${viewport.width}px`;canvas.style.height=`${viewport.height}px`;await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;const text=await page.getTextContent();if(textRef.current){textRef.current.innerHTML='';const TextLayer=pdfjs.TextLayer;if(TextLayer)await new TextLayer({textContentSource:text,container:textRef.current,viewport}).render();}const annotations=await page.getAnnotations({intent:'display'});setLinks(annotations.filter(a=>a.url&&/^https?:/i.test(a.url)).map(a=>({url:a.url,title:a.title||a.url})));}catch(e){setError(e.message)}})();return()=>{cancelled=true;task?.destroy?.()}},[file,pageNumber,scale]);
  return <div className="pdf-page">{error&&<p>{error}</p>}<div className="pdf-canvas-wrap"><canvas ref={canvasRef}/><div ref={textRef} className="textLayer"/></div>{links.length>0&&<div className="pdf-links">本页链接：{links.map(link=><a key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.title}</a>)}</div>}</div>;
}

function Reader({ book, library, prefs, toast, openNote }) {
  const sections=useMemo(()=>library.sections.filter(item=>item.bookId===book.id).sort((a,b)=>a.order-b.order),[library.sections,book.id]);
  const saved=library.progress.find(item=>item.bookId===book.id); const requested=new URLSearchParams((location.hash.split('?')[1]||'')).get('section');
  const [order,setOrder]=useState(()=>Math.max(0,Math.min(sections.length-1,requested!==null?+requested:(saved?.locator?.sectionOrder||0))));
  const [panel,setPanel]=useState('toc'); const [query,setQuery]=useState(''); const [selection,setSelection]=useState(''); const [selectedHighlight,setSelectedHighlight]=useState(null);
  const started=useRef(Date.now()); const lastActive=useRef(Date.now()); const saveTimer=useRef(); const current=sections[order]; const file=library.files.find(item=>item.bookId===book.id);
  const results=useMemo(()=>query.trim()?sections.flatMap(section=>{const i=(section.text||'').toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase());return i>=0?[{section,preview:(section.text||'').slice(Math.max(0,i-35),i+query.length+70)}]:[]}):[],[query,sections]);
  useEffect(()=>{library.updateBook(book.id,{lastOpenedAt:new Date().toISOString(),status:book.status==='WANT_TO_READ'?'READING':book.status}).catch(()=>{});},[book.id]);
  useEffect(()=>{const onActivity=()=>lastActive.current=Date.now();addEventListener('scroll',onActivity,{passive:true});addEventListener('keydown',onActivity);return()=>{removeEventListener('scroll',onActivity);removeEventListener('keydown',onActivity)}},[]);
  useEffect(()=>{const persist=()=>{if(!current)return;const locator=buildLocator(book,current,Math.round((scrollY/Math.max(1,document.documentElement.scrollHeight-innerHeight))*(current.text?.length||1)));library.saveProgress(book.id,locator,calculateProgress(sections,locator)).catch(()=>toast('进度保存失败'));};const schedule=()=>{clearTimeout(saveTimer.current);saveTimer.current=setTimeout(persist,700)};schedule();addEventListener('scroll',schedule,{passive:true});addEventListener('pagehide',persist);return()=>{removeEventListener('scroll',schedule);removeEventListener('pagehide',persist);clearTimeout(saveTimer.current);persist()}},[order,current?.id]);
  useEffect(()=>()=>{const elapsed=Math.min(Date.now()-started.current,Math.max(0,lastActive.current-started.current)+60000);library.addSession(book.id,new Date(started.current).toISOString(),Math.floor(elapsed/1000)).catch(()=>{})},[book.id]);
  const selectText=()=>{const value=getSelection()?.toString().trim();if(value)setSelection(value.slice(0,1000));};
  const highlight=async color=>{const record=await library.saveHighlight({bookId:book.id,quote:selection,color,locator:buildLocator(book,current,0)});setSelection('');setSelectedHighlight(record);toast('划线已保存');};
  const addBookmark=async()=>{await library.saveBookmark({bookId:book.id,label:current?.title||`第 ${order+1} 节`,locator:buildLocator(book,current,0)});toast('书签已添加');};
  if(!sections.length&&book.capability==='FILE_ONLY')return <div className="reader-shell"><header><a href="#/library"><ArrowLeft/>返回书架</a><strong>{book.title}</strong><span/></header><div className="reader-unavailable"><FileText/><h1>此格式仅保存原文件</h1><p>MOBI/AZW3 暂不支持正文阅读，请转换为 EPUB、PDF、TXT 或 Markdown。</p></div></div>;
  return <div className="reader-workspace"><header className="reader-top"><a href="#/library"><ArrowLeft size={17}/>返回书架</a><div><strong>{book.title}</strong><span>{order+1} / {sections.length}</span></div><div className="reader-tools"><button onClick={()=>setPanel(panel==='toc'?'':'toc')}><List size={16}/>目录</button><button onClick={addBookmark}><Bookmark size={16}/>书签</button><button onClick={()=>setPanel(panel==='search'?'':'search')}><Search size={16}/>书内搜索</button></div></header><div className={`reader-layout ${panel?'has-panel':''}`}>{panel&&<aside className="reader-panel"><div className="panel-tabs"><button className={panel==='toc'?'active':''} onClick={()=>setPanel('toc')}>目录</button><button className={panel==='bookmarks'?'active':''} onClick={()=>setPanel('bookmarks')}>书签</button><button className={panel==='search'?'active':''} onClick={()=>setPanel('search')}>搜索</button></div>{panel==='toc'&&(book.toc?.length?book.toc:sections.map(s=>({label:s.title,sectionOrder:s.order}))).map((item,i)=><button className={item.sectionOrder===order?'active':''} key={i} onClick={()=>{setOrder(item.sectionOrder);scrollTo(0,0)}}>{item.label}</button>)}{panel==='bookmarks'&&library.bookmarks.filter(item=>item.bookId===book.id).map(item=><button key={item.id} onClick={()=>setOrder(item.locator?.sectionOrder||0)}>{item.label}</button>)}{panel==='search'&&<><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索当前书正文"/>{results.map((r,i)=><button key={i} onClick={()=>setOrder(r.section.order)}><strong>{r.section.title}</strong><span>{r.preview}</span></button>)}{query&&!results.length&&<p>没有找到匹配内容</p>}</>}</aside>}<main className="reader-main" onMouseUp={selectText}>{book.format==='PDF'&&file?<PdfPage file={file} pageNumber={order+1}/>:<article style={{maxWidth:prefs.width,fontSize:prefs.fontSize,lineHeight:prefs.lineHeight}}><span className="eyebrow">{book.format} · {order+1}/{sections.length}</span><h1>{current?.title||book.title}</h1>{(current?.text||'').split(/\n{2,}/).map((p,i)=><p key={i}>{p}</p>)}</article>}<div className="chapter-nav"><button disabled={order<=0} onClick={()=>{setOrder(o=>o-1);scrollTo(0,0)}}><ChevronLeft/>上一章</button><button disabled={order>=sections.length-1} onClick={()=>{setOrder(o=>o+1);scrollTo(0,0)}}>下一章<ChevronRight/></button></div></main><aside className="annotation-panel"><h3>本章记录</h3>{library.highlights.filter(h=>h.bookId===book.id&&h.locator?.sectionOrder===order).map(h=><div className={`highlight-item ${h.color.toLowerCase()}`} key={h.id}><p>{h.quote}</p><button onClick={()=>openNote(h)}>转为笔记</button></div>)}{library.notes.filter(n=>n.bookId===book.id&&n.locator?.sectionOrder===order).map(n=><div className="side-note" key={n.id}><p>{n.content}</p></div>)}</aside></div>{selection&&<div className="selection-toolbar"><span>已选择 {selection.length} 字</span>{HIGHLIGHT_COLORS.map(c=><button title={c.label} className={c.value.toLowerCase()} key={c.value} onClick={()=>highlight(c.value)}/>) }<button onClick={()=>openNote({quote:selection,locator:buildLocator(book,current,0)})}>写笔记</button><button onClick={()=>{getSelection()?.removeAllRanges();setSelection('')}}><X size={14}/></button></div>}{selectedHighlight&&null}</div>;
}

function AppShell() {
  const library=useLibrary(); const route=useRoute(); const [menu,setMenu]=useState(false); const [modal,setModal]=useState(''); const [noteContext,setNoteContext]=useState(null); const [toastMessage,setToastMessage]=useState(''); const [query,setQuery]=useState(''); const [offlineReady,setOfflineReady]=useState(!import.meta.env.PROD);
  const savedPrefs=library.settings.find(item=>item.id==='reader-preferences')?.value; const [prefs,setPrefs]=useState({theme:'light',fontSize:18,lineHeight:2,width:720,...savedPrefs});
  useEffect(()=>{if(savedPrefs)setPrefs(value=>({...value,...savedPrefs}))},[JSON.stringify(savedPrefs)]);
  useEffect(()=>{document.documentElement.dataset.theme=prefs.theme},[prefs.theme]);
  useEffect(()=>{navigator.serviceWorker?.ready.then(()=>setOfflineReady(true)).catch(()=>setOfflineReady(false))},[]);
  const toast=message=>{setToastMessage(message);setTimeout(()=>setToastMessage(''),3000)};
  const stats=useMemo(()=>calculateStatistics(library),[library.books,library.notes,library.highlights,library.sessions]);
  const search=useMemo(()=>globalSearch(library,query),[library.books,library.notes,library.tags,query]);
  useEffect(()=>{const handler=e=>{if(!(e.metaKey||e.ctrlKey))return;if(e.key.toLowerCase()==='o'){e.preventDefault();setModal('import')}if(e.key.toLowerCase()==='n'){e.preventDefault();setNoteContext(null);setModal('note')}if(e.key.toLowerCase()==='k'){e.preventDefault();document.querySelector('.global-search input')?.focus()}};addEventListener('keydown',handler);return()=>removeEventListener('keydown',handler)},[]);
  const openBook=book=>location.hash=`#/reader/${encodeURIComponent(book.id)}`;
  if(library.loading)return <div className="app-loading"><LoaderCircle className="spin"/><strong>正在打开本地阅读空间</strong></div>;
  if(library.error)return <div className="app-loading"><strong>无法读取本地数据</strong><p>{library.error}</p><button onClick={library.reload}>重试</button></div>;
  const readerBook=route.page==='reader'?library.books.find(book=>book.id===route.bookId):null;
  if(route.page==='reader')return readerBook?<><Reader book={readerBook} library={library} prefs={prefs} toast={toast} openNote={highlight=>{setNoteContext(highlight);setModal('note')}}/>{modal==='note'&&<NoteDialog library={library} bookId={readerBook.id} highlight={noteContext} close={()=>setModal('')} toast={toast}/>}<Toast message={toastMessage}/></>:<div className="reader-unavailable"><h1>找不到这本书</h1><a href="#/library">返回书架</a></div>;
  let page;if(route.page==='library')page=<LibraryPage library={library} openImport={()=>setModal('import')} toast={toast}/>;else if(route.page==='notes')page=<NotesPage library={library} toast={toast}/>;else if(route.page==='highlights')page=<NotesPage library={library} highlightsOnly toast={toast}/>;else if(route.page==='statistics')page=<StatisticsPage stats={stats}/>;else if(route.page==='settings')page=<SettingsPage library={library} prefs={prefs} setPrefs={setPrefs} toast={toast}/>;else page=<Dashboard library={library} stats={stats} openImport={()=>setModal('import')}/>;
  return <div className="app"><Sidebar route={route} count={library.notes.length} menu={menu} close={()=>setMenu(false)}/><main className="app-main"><header><button className="menu-button" onClick={()=>setMenu(true)}><Menu/></button><div className="search global-search"><Search size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索书名、作者、ISBN、笔记或标签"/>{query&&<button onClick={()=>setQuery('')}><X size={14}/></button>}</div><div className="header-actions"><span className={`offline-badge ${offlineReady?'ready':''}`}>{offlineReady?'离线资源已就绪':'准备离线资源…'}</span><button className="import-button" onClick={()=>setModal('import')}><Upload size={16}/>导入</button><button className="new-note" onClick={()=>{setNoteContext(null);setModal('note')}}><Plus size={17}/>新建笔记</button></div></header><div className="content">{query&&<section className="search-results card"><div><strong>正在搜索：{query}</strong><button onClick={()=>setQuery('')}>清除</button></div>{search.books.map(book=><button key={book.id} onClick={()=>openBook(book)}>书籍 · {book.title} — {book.author}</button>)}{search.notes.map(note=><a key={note.id} href="#/notes">笔记 · {note.content.slice(0,80)}</a>)}{search.tags.map(tag=><a key={tag.id} href="#/notes">标签 · #{tag.name}</a>)}{!search.books.length&&!search.notes.length&&!search.tags.length&&<p>没有业务数据匹配；全局搜索不检索正文。</p>}</section>}{page}<footer>拾页 · 本地优先的桌面阅读与深度笔记工具</footer></div></main>{menu&&<div className="menu-shade" onClick={()=>setMenu(false)}/>} {modal==='import'&&<ImportDialog library={library} close={()=>setModal('')} openBook={openBook} toast={toast}/>} {modal==='note'&&<NoteDialog library={library} highlight={noteContext} close={()=>setModal('')} toast={toast}/>}<Toast message={toastMessage}/></div>;
}

export default AppShell;
