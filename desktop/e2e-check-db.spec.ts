import { test } from '@playwright/test';
import { _electron as electron } from 'playwright';
const APP = '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok';
test('check thread currentTaskIds', async () => {
  const app = await electron.launch({ executablePath: APP });
  const page = await app.firstWindow();
  const logs: string[] = [];
  page.on('console', msg => { if (msg.text().includes('[ChatShell]')) logs.push(msg.text()); });
  await page.waitForTimeout(5000);
  const threads = page.locator('[data-testid^="thread-item-"]');
  const count = await threads.count();
  for (let i = 0; i < Math.min(count, 12); i++) {
    logs.length = 0;
    const title = await threads.nth(i).locator('span').first().innerText();
    await threads.nth(i).click();
    await page.waitForTimeout(2000);
    const log = logs.find(l => l.includes('Loading thread'));
    console.log(`[${i}] "${title.slice(0,40)}" → ${log || 'no log'}`);
  }
  await app.close();
});
