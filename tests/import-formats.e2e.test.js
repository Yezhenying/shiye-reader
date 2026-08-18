import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://localhost:5173/';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('.app', { timeout: 15000 });

  const results = [];
  for (const fixture of ['测试EPUB.epub', '测试PDF.pdf']) {
    await page.click('.import-button');
    await page.waitForSelector('.import-modal');
    await page.locator('.import-modal input[type="file"]').setInputFiles(path.join(dir, fixture));
    // Either success or an explicit failure message (both are truthful paths)
    try {
      await page.waitForSelector('.file-success, .file-feedback.error', { timeout: 25000 });
    } catch { results.push(`${fixture}: TIMEOUT (no success/error state)`); await page.click('.modal-head button'); continue; }
    if (await page.locator('.file-success').count()) {
      const title = await page.locator('.file-success h3').textContent();
      results.push(`${fixture}: SUCCESS "${title}"`);
      await page.locator('.file-success button:has-text("继续导入")').click();
    } else {
      const msg = await page.locator('.file-feedback.error').textContent();
      results.push(`${fixture}: ERROR ${msg.trim().slice(0, 80)}`);
      await page.locator('.file-feedback.error button:has-text("重新选择")').click();
    }
    await page.click('.modal-head button'); // close
    await page.waitForSelector('.import-modal', { state: 'detached' });
  }
  console.log(results.join('\n'));
  const serious = errors.filter(e => !/favicon|React DevTools/.test(e));
  console.log(serious.length ? 'PAGE ERRORS:\n' + serious.slice(0, 6).join('\n') : 'no serious page errors');
  await browser.close();
  process.exit(0);
}
main().catch(error => { console.error('FAILED:', error); process.exit(1); });
