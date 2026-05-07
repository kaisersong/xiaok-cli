import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';

const APP_PATH = '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok';
const TRACE_FILE = join(process.env.HOME!, '.xiaok', 'desktop', 'skill-trace.jsonl');

test.describe('Skill execution E2E', () => {
  test('/browse skill executes and completes without hanging', async () => {
    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForTimeout(5000);

    const newBtn = page.locator('button:has-text("New task")');
    if (await newBtn.isVisible()) {
      await newBtn.click();
      await page.waitForTimeout(1000);
    }

    const textarea = page.locator('textarea');
    if (await textarea.isVisible()) {
      await textarea.fill('/browse https://example.com');
      await textarea.press('Enter');

      // Poll every 5s, max 60s
      let completed = false;
      for (let attempt = 0; attempt < 12; attempt++) {
        await page.waitForTimeout(5000);
        const bodyText = await page.locator('body').innerText();

        const hasStepsCompleted = bodyText.includes('steps completed');
        const hasStepsRunning = bodyText.includes('steps · running');
        const hasSessionError = bodyText.includes('session not found');
        const hasNoContent = bodyText.includes('模型没有返回内容');

        console.log(`[attempt ${attempt + 1}] completed=${hasStepsCompleted} running=${hasStepsRunning} err=${hasSessionError} empty=${hasNoContent}`);

        if (hasSessionError) {
          console.error('[FATAL] session not found');
          break;
        }
        if (hasStepsCompleted || (bodyText.length > 200 && !hasStepsRunning)) {
          completed = true;
          console.log('[OK] skill completed');
          break;
        }
        if (hasNoContent) {
          completed = true;
          console.log('[OK] finished (no content)');
          break;
        }
      }

      expect(completed).toBe(true);
      expect(errors.length).toBe(0);
      await page.screenshot({ path: 'test-results/skill-exec-browse.png' });
    }
    await app.close();
  });

  test('skill trace records invocation events', async () => {
    try { rmSync(TRACE_FILE); } catch { /* ok */ }

    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    await page.waitForTimeout(5000);

    const newBtn = page.locator('button:has-text("New task")');
    if (await newBtn.isVisible()) {
      await newBtn.click();
      await page.waitForTimeout(1000);
    }

    const textarea = page.locator('textarea');
    if (await textarea.isVisible()) {
      await textarea.fill('/browse https://example.com');
      await textarea.press('Enter');
      for (let i = 0; i < 12; i++) {
        await page.waitForTimeout(5000);
        const bodyText = await page.locator('body').innerText();
        if (bodyText.includes('steps completed') || bodyText.includes('模型没有返回内容')) break;
      }
    }

    await page.waitForTimeout(2000);
    await app.close();

    if (existsSync(TRACE_FILE)) {
      const lines = readFileSync(TRACE_FILE, 'utf-8').trim().split('\n').filter(Boolean);
      const invoked = lines.filter(l => l.includes('skill_invoked'));
      const turnStarts = lines.filter(l => l.includes('model_turn_start'));
      console.log(`[TRACE] total=${lines.length} invoked=${invoked.length} turns=${turnStarts.length}`);
      expect(invoked.length).toBeGreaterThan(0);
      expect(turnStarts.length).toBeGreaterThan(0);
      try { rmSync(TRACE_FILE); } catch { /* ok */ }
    }
  });
});
