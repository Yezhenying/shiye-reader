import JSZip from 'jszip';
import { exportDatabaseSnapshot, replaceDatabaseSnapshot, STORE_NAMES } from './db.js';

export const BACKUP_SCHEMA_VERSION = 1;

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
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function createFullBackup({ download = true } = {}) {
  const snapshot = await exportDatabaseSnapshot();
  const zip = new JSZip();
  const binaryManifest = [];
  const files = [];
  const books = [];

  for (const record of snapshot.books || []) {
    const { coverBlob, ...metadata } = record;
    if (coverBlob instanceof Blob) {
      const path = `covers/${record.id}.bin`;
      zip.file(path, coverBlob);
      binaryManifest.push({ path, size: coverBlob.size, checksum: await sha256(coverBlob), mimeType: coverBlob.type || 'image/jpeg' });
      books.push({ ...metadata, coverBlobPath: path });
    } else books.push(metadata);
  }

  for (const record of snapshot.files || []) {
    const { blob, ...metadata } = record;
    if (blob instanceof Blob) {
      const path = `files/${record.id}/original.bin`;
      zip.file(path, blob);
      binaryManifest.push({ path, size: blob.size, checksum: await sha256(blob), mimeType: blob.type || record.mimeType || '' });
      files.push({ ...metadata, blobPath: path });
    } else files.push(metadata);
  }

  const data = { ...snapshot, books, files };
  const dataJson = JSON.stringify(data);
  const dataPath = 'data/snapshot.json';
  zip.file(dataPath, dataJson);
  const manifest = {
    product: '拾页',
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    mode: 'FULL',
    stores: Object.fromEntries(STORE_NAMES.map(name => [name, data[name]?.length || 0])),
    entries: [{ path: dataPath, size: new Blob([dataJson]).size, checksum: await sha256(dataJson), mimeType: 'application/json' }, ...binaryManifest],
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  if (download) downloadBlob(blob, `拾页完整备份-${new Date().toISOString().slice(0, 10)}.zip`);
  return { blob, manifest };
}

export async function inspectBackup(file) {
  if (!(file instanceof Blob)) throw new Error('请选择有效的备份文件');
  const zip = await JSZip.loadAsync(file);
  const manifestEntry = zip.file('manifest.json');
  const dataEntry = zip.file('data/snapshot.json');
  if (!manifestEntry || !dataEntry) throw new Error('备份结构不完整');
  const manifest = JSON.parse(await manifestEntry.async('text'));
  if (manifest.product !== '拾页' || manifest.schemaVersion !== BACKUP_SCHEMA_VERSION) throw new Error('备份版本不受支持');
  const dataText = await dataEntry.async('text');
  const expected = manifest.entries?.find(entry => entry.path === 'data/snapshot.json');
  if (!expected || await sha256(dataText) !== expected.checksum) throw new Error('备份数据校验失败，文件可能已损坏');
  const snapshot = JSON.parse(dataText);
  for (const store of STORE_NAMES) if (!Array.isArray(snapshot[store])) throw new Error(`备份缺少 ${store} 数据`);
  return { zip, manifest, snapshot };
}

export async function restoreFullBackup(file) {
  const { zip, manifest, snapshot } = await inspectBackup(file);
  const books = [];
  for (const record of snapshot.books) {
    if (!record.coverBlobPath) { books.push(record); continue; }
    const entry = zip.file(record.coverBlobPath);
    const expected = manifest.entries.find(item => item.path === record.coverBlobPath);
    if (!entry || !expected) throw new Error(`备份缺少封面：${record.title || record.id}`);
    const coverBlob = await entry.async('blob');
    if (coverBlob.size !== expected.size || await sha256(coverBlob) !== expected.checksum) throw new Error(`封面校验失败：${record.title || record.id}`);
    const { coverBlobPath, ...metadata } = record;
    books.push({ ...metadata, coverBlob: new Blob([coverBlob], { type: expected.mimeType || 'image/jpeg' }) });
  }
  const files = [];
  for (const record of snapshot.files) {
    if (!record.blobPath) { files.push(record); continue; }
    const entry = zip.file(record.blobPath);
    const expected = manifest.entries.find(item => item.path === record.blobPath);
    if (!entry || !expected) throw new Error(`备份缺少原文件：${record.name || record.id}`);
    const blob = await entry.async('blob');
    if (blob.size !== expected.size || await sha256(blob) !== expected.checksum) throw new Error(`原文件校验失败：${record.name || record.id}`);
    const { blobPath, ...metadata } = record;
    files.push({ ...metadata, blob: new Blob([blob], { type: expected.mimeType || record.mimeType || '' }) });
  }
  await replaceDatabaseSnapshot({ ...snapshot, books, files });
  return manifest;
}

export const backupTestUtils = { bytesToHex };
