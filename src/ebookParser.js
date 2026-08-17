import JSZip from 'jszip';
import { headingsFromMarkdown, splitTextSections } from './domain.js';

export const ACCEPTED_EBOOKS = '.epub,.pdf,.txt,.md,.markdown,.mobi,.azw3';
export const MAX_EBOOK_SIZE = 200 * 1024 * 1024;
const PREVIEW_LIMIT = 24000;
const EPUB_LIMITS = { entries: 4000, entryBytes: 32 * 1024 * 1024, totalBytes: 160 * 1024 * 1024, ratio: 200 };

function extensionOf(name = '') {
  return name.split('.').pop()?.toLowerCase() || '';
}

function titleFromFile(name = '') {
  return name.replace(/\.(epub|pdf|txt|md|markdown|mobi|azw3)$/i, '').trim() || '未命名电子书';
}

function cleanText(text = '', limit = Number.POSITIVE_INFINITY) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n[\t ]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, limit);
}

function resolveZipPath(basePath, relativePath) {
  const base = new URL(basePath, 'https://ebook.local/');
  return new URL(relativePath, base).pathname.replace(/^\//, '');
}

function xmlDocument(xml, type = 'application/xml') {
  const document = new DOMParser().parseFromString(xml, type);
  if (document.querySelector('parsererror')) throw new Error('电子书内部文档格式损坏');
  return document;
}

function textOf(document, selectors) {
  for (const selector of selectors) {
    const value = document.querySelector(selector)?.textContent?.trim();
    if (value) return value;
  }
  return '';
}

async function fileToCoverBlob(zipEntry, mimeType) {
  const blob = await zipEntry.async('blob');
  if (blob.size > 5 * 1024 * 1024) return null;
  return new Blob([blob], { type: mimeType || 'image/jpeg' });
}

function validateZipEntries(zip) {
  const entries = Object.values(zip.files);
  if (entries.length > EPUB_LIMITS.entries) throw new Error(`EPUB 条目过多（上限 ${EPUB_LIMITS.entries}）`);
  let total = 0;
  for (const entry of entries) {
    if (entry.name.includes('..') || entry.name.startsWith('/') || entry.name.includes('\\')) throw new Error('EPUB 包含不安全路径');
    const expanded = Number(entry._data?.uncompressedSize || 0);
    const compressed = Number(entry._data?.compressedSize || 0);
    if (expanded > EPUB_LIMITS.entryBytes) throw new Error(`EPUB 单个条目展开后过大：${entry.name}`);
    if (compressed > 0 && expanded / compressed > EPUB_LIMITS.ratio) throw new Error(`EPUB 压缩比异常：${entry.name}`);
    total += expanded;
  }
  if (total > EPUB_LIMITS.totalBytes) throw new Error('EPUB 展开后内容过大，已停止导入');
}

async function parseEpub(file) {
  let zip;
  try { zip = await JSZip.loadAsync(file); } catch { throw new Error('不是有效的 EPUB ZIP 容器'); }
  validateZipEntries(zip);
  const containerEntry = zip.file('META-INF/container.xml');
  if (!containerEntry) throw new Error('不是有效的 EPUB：缺少 container.xml');
  const container = xmlDocument(await containerEntry.async('text'));
  const opfPath = container.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath || !zip.file(opfPath)) throw new Error('EPUB 目录信息不完整');

  const opf = xmlDocument(await zip.file(opfPath).async('text'));
  const title = textOf(opf, ['metadata > title', 'dc\\:title', 'title']) || titleFromFile(file.name);
  const author = textOf(opf, ['metadata > creator', 'dc\\:creator', 'creator']) || '作者待补充';
  const language = textOf(opf, ['metadata > language', 'dc\\:language', 'language']);
  const layoutMeta = opf.querySelector('metadata > meta[property="rendition:layout"], meta[name="fixed-layout"], meta[property="rendition:layout"]');
  const layout = layoutMeta?.textContent?.trim() || layoutMeta?.getAttribute('content') || '';
  const fixedLayout = /pre-paginated|true/i.test(layout);
  const manifest = new Map();
  opf.querySelectorAll('manifest > item, item').forEach(item => {
    const id = item.getAttribute('id');
    if (id) manifest.set(id, { href: item.getAttribute('href') || '', type: item.getAttribute('media-type') || '', properties: item.getAttribute('properties') || '' });
  });

  const sections = [];
  const warnings = [];
  const spineIds = [...opf.querySelectorAll('spine > itemref')].map(item => item.getAttribute('idref')).filter(Boolean);
  for (const id of spineIds) {
    const item = manifest.get(id);
    if (!item?.href) { warnings.push(`书脊项目 ${id} 缺少路径`); continue; }
    const path = resolveZipPath(opfPath, item.href);
    const entry = zip.file(path);
    if (!entry) { warnings.push(`缺少章节：${path}`); continue; }
    try {
      const chapter = xmlDocument(await entry.async('text'), 'text/html');
      chapter.querySelectorAll('script, style, nav, iframe, object, embed, form').forEach(element => element.remove());
      const content = cleanText(chapter.body?.textContent || chapter.documentElement.textContent || '');
      if (content) sections.push({ order: sections.length, title: textOf(chapter, ['h1', 'h2', 'title']) || `第 ${sections.length + 1} 章`, text: content, canonicalPath: path, wordCount: content.replace(/\s/g, '').length });
    } catch { warnings.push(`章节损坏，未展示：${path}`); }
  }
  if (!fixedLayout && !sections.length) throw new Error('EPUB 没有可读取的正文；原有数据未被修改');

  let toc = [];
  const navItem = [...manifest.values()].find(item => item.properties.includes('nav'));
  if (navItem?.href) {
    const navPath = resolveZipPath(opfPath, navItem.href);
    const navEntry = zip.file(navPath);
    if (navEntry) {
      try {
        const navDoc = xmlDocument(await navEntry.async('text'), 'text/html');
        toc = [...navDoc.querySelectorAll('nav a')].map((anchor, order) => {
          const href = anchor.getAttribute('href') || '';
          const [pathPart] = href.split('#');
          const canonicalPath = pathPart ? resolveZipPath(navPath, pathPart) : navPath;
          const section = sections.find(item => item.canonicalPath === canonicalPath);
          return { order, label: anchor.textContent?.trim() || `目录 ${order + 1}`, sectionOrder: section?.order ?? 0 };
        });
      } catch { /* 使用章节标题 fallback */ }
    }
  }
  if (!toc.length) toc = sections.map(section => ({ order: section.order, label: section.title, sectionOrder: section.order }));

  let coverBlob = null;
  const coverMetaId = opf.querySelector('meta[name="cover"]')?.getAttribute('content');
  const coverItem = manifest.get(coverMetaId) || [...manifest.values()].find(item => item.properties.includes('cover-image'));
  if (coverItem?.href) {
    const coverEntry = zip.file(resolveZipPath(opfPath, coverItem.href));
    if (coverEntry) {
      try { coverBlob = await fileToCoverBlob(coverEntry, coverItem.type); } catch { /* 封面失败不影响正文 */ }
    }
  }

  const content = sections.map(section => section.text).join('\n\n');
  return { title, author, language, coverBlob, content, sections: fixedLayout ? [] : sections, toc, fixedLayout, warnings, parseStatus: fixedLayout ? '固定版式 EPUB：仅保存原文件，当前版本不支持阅读' : `实验性纯文本阅读 · ${sections.length} 个章节${warnings.length ? ` · ${warnings.length} 项警告` : ''}` };
}

async function parsePdf(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const document = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const metadata = await document.getMetadata().catch(() => ({ info: {} }));
  const sections = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const text = await page.getTextContent();
    const content = cleanText(text.items.map(item => item.str || '').join(' '));
    sections.push({ order: pageNumber - 1, title: `第 ${pageNumber} 页`, text: content, wordCount: content.replace(/\s/g, '').length });
  }
  return {
    title: metadata.info?.Title?.trim() || titleFromFile(file.name),
    author: metadata.info?.Author?.trim() || '作者待补充',
    content: sections.map(section => section.text).join('\n\n'),
    sections,
    toc: sections.map(section => ({ order: section.order, label: section.title, sectionOrder: section.order })),
    pageCount: document.numPages,
    parseStatus: sections.some(section => section.text) ? `已解析 ${document.numPages} 页文本层` : 'PDF 无可搜索文本层，可阅读原始页面',
  };
}

async function validateSignature(file, format) {
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (format === 'pdf' && String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') throw new Error('扩展名是 PDF，但文件签名不匹配');
  if (format === 'epub' && !(bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2]))) throw new Error('扩展名是 EPUB，但不是 ZIP 容器');
}

async function decodeTextFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le', { fatal: true }).decode(bytes.slice(2)), encoding: 'UTF-16LE' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be', { fatal: true }).decode(bytes.slice(2)), encoding: 'UTF-16BE' };
  const source = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.slice(3) : bytes;
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(source), encoding: 'UTF-8' }; }
  catch {
    try { return { text: new TextDecoder('gb18030', { fatal: true }).decode(bytes), encoding: 'GB18030' }; }
    catch { throw new Error('无法可靠识别文本编码；请转换为 UTF-8 后重试'); }
  }
}

export async function parseEbookFile(file) {
  if (!(file instanceof File)) throw new Error('请选择有效的电子书文件');
  if (file.size === 0) throw new Error('文件内容为空');
  if (file.size > MAX_EBOOK_SIZE) throw new Error('文件超过 200MB；当前整文件解析模式无法安全处理，请选择较小文件');
  const format = extensionOf(file.name);
  if (!['epub', 'pdf', 'txt', 'md', 'markdown', 'mobi', 'azw3'].includes(format)) throw new Error('暂不支持该格式');
  await validateSignature(file, format);

  let parsed;
  if (format === 'epub') parsed = await parseEpub(file);
  else if (format === 'pdf') parsed = await parsePdf(file);
  else if (['txt', 'md', 'markdown'].includes(format)) {
    const decoded = await decodeTextFile(file);
    const content = cleanText(decoded.text);
    if (!content) throw new Error('文本文件只包含空白字符，没有可阅读正文');
    const sections = splitTextSections(content, { title: format === 'txt' ? '正文' : 'Markdown' });
    const headings = format === 'txt' ? [] : headingsFromMarkdown(content);
    parsed = {
      title: titleFromFile(file.name), author: '作者待补充', content, sections,
      toc: headings.length ? headings.map((heading, order) => ({ order, label: heading.label, sectionOrder: Math.min(sections.length - 1, Math.floor((heading.line / Math.max(1, content.split(/\r?\n/).length)) * sections.length)) })) : sections.map(section => ({ order: section.order, label: section.title, sectionOrder: section.order })),
      parseStatus: `${format === 'txt' ? '文本阅读' : 'Markdown 纯文本阅读'} · ${decoded.encoding} · ${sections.length} 个区块`,
    };
  } else {
    parsed = { title: titleFromFile(file.name), author: '作者待补充', content: '', parseStatus: '文件已识别；MOBI/AZW3 正文需转换为 EPUB 后阅读' };
  }

  return {
    id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: parsed.title,
    author: parsed.author,
    year: '', isbn: '', progress: 0, imported: true,
    coverBlob: parsed.coverBlob || null,
    format: format === 'markdown' ? 'MD' : format.toUpperCase(),
    fileName: file.name,
    fileSize: file.size,
    pageCount: parsed.pageCount || null,
    language: parsed.language || '',
    contentPreview: (parsed.content || '').slice(0, PREVIEW_LIMIT),
    wordCount: (parsed.content || '').replace(/\s/g, '').length,
    parseStatus: parsed.parseStatus,
    parseWarnings: parsed.warnings || [],
    sections: parsed.sections || [],
    toc: parsed.toc || [],
    capability: ['mobi', 'azw3'].includes(format) || parsed.fixedLayout ? 'FILE_ONLY' : format === 'epub' ? 'EXPERIMENTAL_TEXT' : format === 'pdf' && !(parsed.content || '').trim() ? 'VIEW_ONLY' : format === 'pdf' ? 'BASIC_PDF' : format === 'txt' ? 'TEXT_VERIFIED' : 'PLAIN_TEXT',
  };
}

export const ebookTestUtils = { extensionOf, titleFromFile, cleanText, resolveZipPath, validateZipEntries };
