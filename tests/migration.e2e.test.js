import { chromium } from 'playwright-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://localhost:5173/';

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext();
  // Seed corrupt legacy localStorage BEFORE the page script runs.
  await context.addInitScript(() => {
    localStorage.setItem('shiyue-books', '{this is not valid JSON');
    localStorage.setItem('shiyue-notes', '["also broken');
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  await page.goto(APP_URL, { waitUntil: 'networkidle' });

  // App must still render (not the blocking error screen).
  const appRendered = await page.waitForSelector('.app', { timeout: 15000 }).then(() => true).catch(() => false);
  console.log('app rendered with corrupt legacy data:', appRendered);

  // The non-blocking migration banner should show.
  const banner = await page.locator('.migration-banner').count();
  console.log('migration banner shown:', banner > 0);

  // Import must STILL work despite corrupt legacy data.
  await page.click('.import-button');
  await page.waitForSelector('.import-modal');
  await page.locator('.import-modal input[type="file"]').setInputFiles('G:/Pi/tests/fixtures/测试小说.txt');
  await page.waitForSelector('.file-success', { timeout: 20000 });
  const title = await page.locator('.file-success h3').textContent();
  console.log('import works with corrupt legacy data:', title);

  const ok = appRendered && banner > 0 && title.includes('测试小说');
  await browser.close();
  if (!ok) { console.error('MIGRATION E2E FAILED'); process.exit(1); }
  console.log('migration.e2e: PASSED');
  process.exit(0);
}
main().catch(error => { console.error('FAILED:', error); process.exit(1); });
