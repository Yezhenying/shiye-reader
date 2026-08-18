import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://localhost:5173/';
const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', '测试小说.txt');

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });

  await page.goto(APP_URL, { waitUntil: 'networkidle' });

  // Wait for app to load (not the loading spinner)
  await page.waitForSelector('.app', { timeout: 15000 });

  // Open import dialog
  await page.click('.import-button');
  await page.waitForSelector('.import-modal');

  // Set the hidden file input to the fixture
  const input = page.locator('.import-modal input[type="file"]');
  await input.setInputFiles(fixture);

  // Wait for success state
  await page.waitForSelector('.file-success', { timeout: 20000 });

  // Verify book appears
  const title = await page.locator('.file-success h3').textContent();
  console.log('import success title:', JSON.stringify(title));

  // Close and navigate to library
  await page.click('.file-success button:has-text("立即阅读")');
  await page.waitForSelector('.reader-workspace, .reader-unavailable', { timeout: 15000 });
  const readerText = await page.textContent('.reader-workspace, .reader-unavailable').catch(() => '');
  console.log('reader rendered:', readerText.includes('第一章') || readerText.includes('启程'));

  // Go to library and confirm book listed
  await page.goto(APP_URL + '#/library', { waitUntil: 'networkidle' });
  await page.waitForSelector('.library-grid', { timeout: 15000 });
  const hasBook = await page.locator('.library-card').count();
  console.log('library cards:', hasBook);

  const seriousErrors = errors.filter(e => !/favicon|Swipe|Download the React DevTools/.test(e));
  if (seriousErrors.length) console.log('PAGE ERRORS:', seriousErrors.slice(0, 5));
  else console.log('no serious page errors');

  const ok = title.includes('测试小说') && hasBook >= 1;
  await browser.close();
  if (!ok) { console.error('E2E IMPORT FAILED'); process.exit(1); }
  console.log('import.e2e: PASSED');
  process.exit(0);
}

main().catch(error => { console.error('E2E FAILED:', error); process.exit(1); });
