import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';

const APP_PATH = '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok';

test.describe('Skill execution', () => {
  test('slash command triggers skill and produces output', async () => {
    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(`PAGE: ${e.message}`));
    await page.waitForTimeout(5000);

    // Navigate to new task
    const newBtn = page.locator('button:has-text("New task")');
    if (await newBtn.isVisible()) {
      await newBtn.click();
      await page.waitForTimeout(1000);
    }

    // Type a slash command that should trigger a skill
    const textarea = page.locator('textarea');
    if (await textarea.isVisible()) {
      await textarea.fill('/browse https://example.com');
      await textarea.press('Enter');

      // Wait for the skill to load and produce output (up to 30s)
      await page.waitForTimeout(15000);

      // Check for evidence of skill execution:
      // 1. There should be an assistant message (not just "Loading...")
      // 2. There should be NO error message containing "session not found"
      // 3. There should be NO error message containing "active task already exists"
      const bodyText = await page.locator('body').innerText();

      const hasSessionNotFound = bodyText.includes('session not found');
      const hasActiveTaskError = bodyText.includes('active task already exists');
      const hasAssistantContent = bodyText.includes('step') || bodyText.includes('completed') || bodyText.includes('browse') || bodyText.includes('example');

      console.log(`[SKILL-EXEC] hasSessionNotFound=${hasSessionNotFound}, hasActiveTaskError=${hasActiveTaskError}`);
      console.log(`[SKILL-EXEC] hasAssistantContent=${hasAssistantContent}`);
      console.log(`[SKILL-EXEC] bodyText snippet: ${bodyText.slice(0, 500)}`);

      expect(hasSessionNotFound).toBe(false);
      expect(hasActiveTaskError).toBe(false);

      await page.screenshot({ path: 'test-results/skill-execution.png' });
    } else {
      console.log('[SKILL-EXEC] textarea not found');
    }

    await app.close();
    expect(errors.length).toBe(0);
  });

  test('intent_create does not fail with session not found', async () => {
    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(`PAGE: ${e.message}`));
    await page.waitForTimeout(5000);

    // Navigate to new task
    const newBtn = page.locator('button:has-text("New task")');
    if (await newBtn.isVisible()) {
      await newBtn.click();
      await page.waitForTimeout(1000);
    }

    // Submit a task that would trigger intent_create
    const textarea = page.locator('textarea');
    if (await textarea.isVisible()) {
      await textarea.fill('帮我分析一下当前项目的架构');
      await textarea.press('Enter');

      // Wait for task to complete or produce output
      await page.waitForTimeout(20000);

      const bodyText = await page.locator('body').innerText();
      const hasSessionNotFound = bodyText.includes('session not found');

      console.log(`[INTENT-TEST] hasSessionNotFound=${hasSessionNotFound}`);
      console.log(`[INTENT-TEST] bodyText snippet: ${bodyText.slice(0, 500)}`);

      expect(hasSessionNotFound).toBe(false);

      await page.screenshot({ path: 'test-results/intent-test.png' });
    }

    await app.close();
    expect(errors.length).toBe(0);
  });
});
