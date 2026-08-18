import JSZip from 'jszip';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
fs.mkdirSync(dir, { recursive: true });

// --- Minimal valid EPUB ---
const zip = new JSZip();
zip.file('mimetype', 'application/epub+zip');
zip.file('META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
zip.file('OPS/content.opf', `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">test-epub-001</dc:identifier>
    <dc:title>测试EPUB</dc:title>
    <dc:creator>作者甲</dc:creator>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`);
zip.file('OPS/ch1.xhtml', `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head>
<body><h1>第一章 风起</h1><p>这是测试 EPUB 的第一段文字。</p><p>第二段内容用于验证章节解析。</p></body></html>`);
zip.file('OPS/nav.xhtml', `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head>
<body><nav epub:type="toc"><ol><li><a href="ch1.xhtml">第一章</a></li></ol></nav></body></html>`);
const epub = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
fs.writeFileSync(path.join(dir, '测试EPUB.epub'), epub);

// --- Minimal valid PDF (hand-crafted) ---
function buildPdfText(text, title) {
  const objects = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  const stream = `BT /F1 14 Tf 72 720 Td (${text}) Tj ET`;
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`);
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const refs = ['<< /Title (' + title + ') /Author (作者乙) /Producer (shiyue-fixture) >>'];
  let out = '%PDF-1.4\n';
  objects.forEach((body, i) => { const n = i + 1; out += `${n} 0 obj\n${body}\nendobj\n`; });
  out += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  let offset = out.length;
  objects.forEach((_, i) => { out += `${String(offset).padStart(10, '0')} 00000 n \n`; offset += 1; });
  out += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R /Info 6 0 R >>\nstartxref\n' + offset + '\n%%EOF\n';
  return out;
}
fs.writeFileSync(path.join(dir, '测试PDF.pdf'), buildPdfText('Hello PDF text layer', '测试PDF'));

console.log('fixtures generated in', dir);
