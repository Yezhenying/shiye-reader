import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://localhost:5173/#/library';

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('.app');

  await page.evaluate(async () => new Promise((resolve, reject) => {
    const request = indexedDB.open('shiyue-reader');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const stores = ['books', 'categories', 'progress', 'files', 'sections'];
      const tx = db.transaction(stores, 'readwrite');
      for (const name of stores) tx.objectStore(name).clear();
      tx.objectStore('categories').put({ id: 'fiction', name: '小说', order: 0 });
      tx.objectStore('categories').put({ id: 'science', name: '科学', order: 1 });
      for (let index = 0; index < 1000; index += 1) {
        const id = `perf-${index}`;
        tx.objectStore('books').put({ id, title: `性能测试书 ${String(index).padStart(4, '0')}`, author: '本地测试', status: index % 3 ? 'WANT_TO_READ' : 'READING', categoryIds: [index % 2 ? 'fiction' : 'science'], updatedAt: new Date(2026, 0, 1, 0, 0, index % 60).toISOString(), revision: 1 });
      }
      tx.objectStore('files').put({ id: 'perf-file', bookId: 'perf-0', blob: new Blob(['large-reader-payload']) });
      tx.objectStore('sections').put({ id: 'perf-section', bookId: 'perf-0', order: 0, text: '按需读取的正文' });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.library-card');
  assert.equal(await page.locator('.library-card').count(), 48, '书架首屏只渲染 48 张卡片');
  const start = Date.now();
  await page.getByRole('button', { name: /小说 500/ }).click();
  await page.getByText('已筛选 · 共 500 本书').waitFor();
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1500, `筛选应在 1.5 秒内完成，实际 ${elapsed}ms`);
  assert.equal(await page.locator('.library-card').count(), 48, '筛选后仍只渲染可见批次');

  await browser.close();
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`shelf-performance.e2e: PASSED (${elapsed}ms)`);
}

main().catch(error => { console.error('SHELF PERFORMANCE E2E FAILED', error); process.exit(1); });
