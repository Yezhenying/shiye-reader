import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://localhost:5173/';

async function seriousViolations(page, context) {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations
    .filter(item => ['critical', 'serious'].includes(item.impact))
    .map(item => `${context}: ${item.id} (${item.nodes.length} nodes)`);
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext();
  const violations = [];
  for (const hash of ['#/', '#/library', '#/settings']) {
    const page = await context.newPage();
    await page.goto(`${APP_URL}${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.app');
    violations.push(...await seriousViolations(page, hash));
    await page.close();
  }

  const page = await context.newPage();
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '新建笔记' }).click();
  await page.getByRole('dialog', { name: '新建笔记' }).waitFor();
  violations.push(...await seriousViolations(page, '新建笔记弹窗'));
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog', { name: '新建笔记' }).count(), 0, 'Escape 应关闭弹窗');
  await browser.close();
  assert.deepEqual(violations, [], `axe serious/critical violations:\n${violations.join('\n')}`);
  console.log('accessibility.e2e: axe serious/critical = 0; keyboard dialog close: PASSED');
}

main().catch(error => { console.error('ACCESSIBILITY E2E FAILED', error); process.exit(1); });
