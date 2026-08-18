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
  await page.waitForSelector('.app');
  await page.click('.import-button');
  await page.locator('.import-modal input[type="file"]').setInputFiles(fixture);
  await page.waitForSelector('.file-success', { timeout: 20000 });
  await page.locator('.import-modal').getByRole('button', { name: '关闭导入' }).click();
  await page.goto(`${APP_URL}#/library`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.library-card');

  await page.getByRole('button', { name: '管理分类' }).click();
  await page.locator('.category-create input').fill('测试分类');
  await page.locator('.category-create button').click();
  await page.getByText('测试分类', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: '关闭分类管理' }).click();

  await page.getByRole('button', { name: '多选归类' }).click();
  await page.locator('.book-selector').first().click();
  await page.getByRole('button', { name: '设为主分类' }).click();
  await page.getByRole('menuitem', { name: '测试分类' }).click();
  await page.getByText('测试分类', { exact: true }).last().waitFor();

  await page.getByRole('button', { name: '退出多选' }).click();
  await page.getByRole('button', { name: '新建笔记' }).click();
  await page.locator('textarea[aria-label="笔记内容"]').fill('我觉得这个想法挺有意思，所以想再看一遍');
  await page.getByRole('button', { name: '轻度表达优化' }).click();
  await page.waitForSelector('.polish-compare');
  const suggestion = await page.locator('.polish-columns > div').nth(1).textContent();
  await page.getByRole('button', { name: '采用建议' }).click();
  await page.getByRole('button', { name: '保存' }).click();
  await page.waitForTimeout(250);

  await page.goto(`${APP_URL}#/notes`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.note-card');
  const notesText = await page.locator('.note-list').textContent();
  const seriousErrors = errors.filter(error => !/favicon|Download the React DevTools/.test(error));
  await browser.close();

  if (!suggestion?.includes('在我看来') || !notesText?.includes('在我看来') || seriousErrors.length) {
    console.error('CATEGORY/POLISH E2E FAILED', { suggestion, seriousErrors });
    process.exit(1);
  }
  console.log('category-polish.e2e: PASSED');
}

main().catch(error => { console.error('CATEGORY/POLISH E2E FAILED', error); process.exit(1); });
