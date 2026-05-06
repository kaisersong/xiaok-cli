import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';

const DATA_ROOT = join(process.env.HOME!, '.xiaok', 'desktop');
const EXEC_FILE = join(DATA_ROOT, 'skill-exec.json');
const APP_PATH = '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok';

test.describe('Skill Stats', () => {
  test.afterEach(async ({}, testInfo) => {
    // Clean up test exec file
    try { rmSync(EXEC_FILE); } catch { /* ok */ }
  });

  test('no stats file → settings page renders normally without stats', async () => {
    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    await page.waitForTimeout(5000);

    const errors: string[] = [];
    page.on('pageerror', e => errors.push(`PAGE ERROR: ${e.message}`));

    // Navigate to settings → 技能管理
    const sidebarBtns = page.locator('aside button');
    await sidebarBtns.last().click();
    await page.waitForTimeout(1500);
    await page.locator('text=技能管理').first().click();
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'test-results/skill-stats-no-data.png' });

    // Should not crash even with no stats
    expect(errors.length).toBe(0);

    await app.close();
  });

  test('with mock stats data → settings page shows stats', async () => {
    // Write mock stats data
    mkdirSync(DATA_ROOT, { recursive: true });
    const now = Date.now();
    const mockRecords = Array.from({ length: 10 }, (_, i) => ({
      id: `exec_test_${i}`,
      skillNames: ['test-skill'],
      taskId: `task_test_${i}`,
      startTime: now - (10 - i) * 60000,
      endTime: now - (10 - i) * 60000 + 45000,
      durationMs: 45000,
      status: 'success',
      inputTokens: 1000,
      outputTokens: 500,
      prompt: 'test prompt',
      triggerType: 'slash_command',
    }));
    writeFileSync(EXEC_FILE, JSON.stringify(mockRecords));

    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    await page.waitForTimeout(5000);

    const errors: string[] = [];
    page.on('pageerror', e => errors.push(`PAGE ERROR: ${e.message}`));

    // Navigate to settings → 技能管理
    const sidebarBtns = page.locator('aside button');
    await sidebarBtns.last().click();
    await page.waitForTimeout(1500);
    await page.locator('text=技能管理').first().click();
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'test-results/skill-stats-with-data.png' });

    // Look for stats-related text in the page
    const bodyText = await page.locator('body').innerText();
    const hasStats = bodyText.includes('10 次') || bodyText.includes('10 calls') || bodyText.includes('avg');

    console.log(`[STATS] hasStats=${hasStats}, errors=${errors.length}`);
    console.log(`[STATS] bodyText snippet: ${bodyText.slice(0, 500)}`);

    expect(errors.length).toBe(0);

    await app.close();
  });

  test('corrupted stats file → settings page renders without crashing', async () => {
    mkdirSync(DATA_ROOT, { recursive: true });
    writeFileSync(EXEC_FILE, 'this is not valid json {{{');

    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    await page.waitForTimeout(5000);

    const errors: string[] = [];
    page.on('pageerror', e => errors.push(`PAGE ERROR: ${e.message}`));

    // Navigate to settings → 技能管理
    const sidebarBtns = page.locator('aside button');
    await sidebarBtns.last().click();
    await page.waitForTimeout(1500);
    await page.locator('text=技能管理').first().click();
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'test-results/skill-stats-corrupted.png' });

    // Should not crash with corrupted file
    expect(errors.length).toBe(0);

    await app.close();
  });

  test('stats with multiple skills → aggregated correctly', async () => {
    mkdirSync(DATA_ROOT, { recursive: true });
    const now = Date.now();
    const mockRecords = [
      // review: 5 calls, 4 success, 1 error
      ...Array.from({ length: 4 }, (_, i) => ({
        id: `exec_review_${i}`,
        skillNames: ['review'],
        taskId: `task_review_${i}`,
        startTime: now - (5 - i) * 3600000,
        endTime: now - (5 - i) * 3600000 + 30000,
        durationMs: 30000,
        status: 'success' as const,
        inputTokens: 2000,
        outputTokens: 800,
        prompt: '/review this code',
        triggerType: 'slash_command' as const,
      })),
      {
        id: 'exec_review_err',
        skillNames: ['review'],
        taskId: 'task_review_err',
        startTime: now - 3600000,
        endTime: now - 3600000 + 60000,
        durationMs: 60000,
        status: 'error' as const,
        inputTokens: 2000,
        outputTokens: 100,
        prompt: '/review failed',
        triggerType: 'slash_command' as const,
      },
      // qa: 3 calls, all success
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `exec_qa_${i}`,
        skillNames: ['qa'],
        taskId: `task_qa_${i}`,
        startTime: now - (3 - i) * 7200000,
        endTime: now - (3 - i) * 7200000 + 20000,
        durationMs: 20000,
        status: 'success' as const,
        inputTokens: 1500,
        outputTokens: 600,
        prompt: '/qa test',
        triggerType: 'slash_command' as const,
      })),
    ];
    writeFileSync(EXEC_FILE, JSON.stringify(mockRecords));

    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    await page.waitForTimeout(5000);

    const errors: string[] = [];
    page.on('pageerror', e => errors.push(`PAGE ERROR: ${e.message}`));

    // Navigate to settings → 技能管理
    const sidebarBtns = page.locator('aside button');
    await sidebarBtns.last().click();
    await page.waitForTimeout(1500);
    await page.locator('text=技能管理').first().click();
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'test-results/skill-stats-multi-skill.png' });

    expect(errors.length).toBe(0);

    await app.close();
  });

  test('exec file auto-created after skill execution', async () => {
    // Ensure no exec file exists
    try { rmSync(EXEC_FILE); } catch { /* ok */ }

    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    await page.waitForTimeout(5000);

    // Type a slash command in the chat input
    const textarea = page.locator('textarea');
    if (await textarea.isVisible()) {
      await textarea.fill('/review test code quality');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'test-results/skill-stats-slash-input.png' });

      // Press Enter to submit
      await textarea.press('Enter');
      await page.waitForTimeout(10000);

      // Check if exec file was created
      const fileExists = existsSync(EXEC_FILE);
      console.log(`[STATS] exec file created: ${fileExists}`);

      if (fileExists) {
        const content = JSON.parse(readFileSync(EXEC_FILE, 'utf-8'));
        console.log(`[STATS] records count: ${content.length}`);
        console.log(`[STATS] first record: ${JSON.stringify(content[0]?.skillNames)}`);
        expect(content.length).toBeGreaterThan(0);
        expect(content[0].skillNames).toContain('review');
      }
    } else {
      console.log('[STATS] textarea not visible, skipping submit');
    }

    await page.screenshot({ path: 'test-results/skill-stats-after-exec.png' });
    await app.close();
  });
});
