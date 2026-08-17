import { commitImport } from '../db.js';
import { createId, normalizeBook, nowIso } from '../domain.js';

export async function checksumBlob(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function importPublication({ file, parsed, books, keepDuplicate = false }) {
  const estimate = await navigator.storage?.estimate?.();
  if (estimate?.quota && estimate.usage + file.size * 1.5 > estimate.quota) {
    throw new Error('预计剩余空间不足以安全保存原文件和解析结果');
  }
  const fingerprint = await checksumBlob(file);
  const existing = books.find(book => book.fingerprint === fingerprint);
  if (existing && !keepDuplicate) return { duplicate: existing, duplicateTrashed: Boolean(existing.deletedAt) };
  const now = nowIso();
  const bookId = keepDuplicate ? createId('book') : parsed.id;
  const fileId = createId('file');
  const generationId = createId('import');
  const book = normalizeBook({
    ...parsed, id: bookId, fingerprint, activeFileId: fileId, status: 'WANT_TO_READ',
    sourceCapability: parsed.capability, createdAt: now, updatedAt: now,
  });
  const fileRecord = { id: fileId, bookId, generationId, name: file.name, mimeType: file.type, size: file.size, checksum: fingerprint, blob: file, createdAt: now, parseStatus: 'READY' };
  const sections = (parsed.sections || []).map((section, order) => ({ ...section, id: `section-${bookId}-${order}`, bookId, order }));
  const job = { id: generationId, kind: 'IMPORT', state: 'STAGING', createdAt: now, expiresAt: new Date(Date.now() + 864e5).toISOString() };
  await commitImport({ book, file: fileRecord, sections, job });
  navigator.storage?.persist?.().catch(() => false);
  return { book };
}
