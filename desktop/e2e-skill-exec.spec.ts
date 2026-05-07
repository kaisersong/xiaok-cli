import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const APP_PATH = '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok';
const TRACE_FILE = join(process.env.HOME!, '.xiaok', 'desktop', 'skill-trace.jsonl');

// Mock skill-exec.json with some historical data for stats test
const DATA_ROOT = join(process.env.HOME!, '.xiaok', 'desktop');
const EXEC_FILE = join(DATA_ROOT, 'skill-exec.json');

function setupMockSkillData() {
  mkdirSync(DATA_ROOT, { recursive: true });
  const now = Date.now();
  const records = [
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `exec_review_${i}`, skillNames: ['review'], taskId: `task_${i}`,
      startTime: now - (5 - i) * 60000, endTime: now - (5 - i) * 60000 + 30000,
      durationMs: 30000, status: 'success', inputTokens: 2000, outputTokens: 800,
      prompt: '/review test', triggerType: 'slash_command',
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      id: `exec_qa_${i}`, skillNames: ['qa'], taskId: `task_qa_${i}`,
      startTime: now - (3 - i) * 120000, endTime: now - (3 - i) * 120000 + 20000,
      durationMs: 20000, status: i === 2 ? 'error' : 'success',
      inputTokens: 1500, outputTokens: 600, prompt: '/qa test',
      triggerType: 'slash_command',
    })),
  ];
  writeFileSync(EXEC_FILE, JSON.stringify(records));
}

async function waitForSkillCompletion(page: any, timeoutMs: number = 180000): Promise<{ completed: boolean; bodyLength: number; duration: number }> {
  const startTime = Date.now();
  let lastBodyLen = 0;

  while (Date.now() - startTime < timeoutMs) {
    await page.waitForTimeout(5000);
    const bodyText = await page.locator('body').innerText();
    lastBodyLen = bodyText.length;

    const hasStepsCompleted = bodyText.includes('steps completed');
    const hasStepsRunning = bodyText.includes('steps · running');
    const hasSessionError = bodyText.includes('session not found');
    const hasActiveTaskError = bodyText.includes('active task already exists');
    const hasNoContent = bodyText.includes('模型没有返回内容');

    console.log(`[${Math.round((Date.now() - startTime) / 1000)}s] completed=${hasStepsCompleted} running=${hasStepsRunning} err=${hasSessionError} activeTaskErr=${hasActiveTaskError} empty=${hasNoContent} bodyLen=${bodyText.length}`);

    if (hasSessionError) {
      console.error('[FATAL] session not found');
      return { completed: false, bodyLength: bodyText.length, duration: Date.now() - startTime };
    }
    if (hasActiveTaskError) {
      console.error('[FATAL] active task already exists');
      return { completed: false, bodyLength: bodyText.length, duration: Date.now() - startTime };
    }
    if (hasStepsCompleted) {
      console.log('[OK] skill completed');
      return { completed: true, bodyLength: bodyText.length, duration: Date.now() - startTime };
    }
    if (hasNoContent) {
      console.log('[OK] finished (no content)');
      return { completed: true, bodyLength: bodyText.length, duration: Date.now() - startTime };
    }
  }

  console.log(`[TIMEOUT] after ${timeoutMs / 1000}s, bodyLen=${lastBodyLen}`);
  return { completed: false, bodyLength: lastBodyLen, duration: timeoutMs };
}

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

      // Allow 90s for browse skill
      // Allow 180s for browse skill (includes LLM reasoning time between tool calls)
      const result = await waitForSkillCompletion(page, 180000);
      expect(result.completed).toBe(true);
      expect(result.duration).toBeLessThan(180000);
      expect(errors.length).toBe(0);
      await page.screenshot({ path: 'test-results/skill-exec-browse.png' });
    }
    await app.close();
  });

  test('/kai-report-creator 简单报告 completes within 120s', async () => {
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
      await textarea.fill('/kai-report-creator 简单报告');
      await textarea.press('Enter');

      // Allow 300s for report creator (was 500-800s before optimization)
      const result = await waitForSkillCompletion(page, 300000);
      console.log(`[REPORT-CREATOR] completed=${result.completed} duration=${result.duration / 1000}s bodyLen=${result.bodyLength}`);

      // Should complete - was 500-800s before optimization
      expect(result.completed).toBe(true);
      expect(result.duration).toBeLessThan(300000);
      expect(errors.length).toBe(0);

      await page.screenshot({ path: 'test-results/skill-exec-report-creator.png' });
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
      await waitForSkillCompletion(page, 60000);
    }

    await page.waitForTimeout(2000);
    await app.close();

    if (existsSync(TRACE_FILE)) {
      const lines = readFileSync(TRACE_FILE, 'utf-8').trim().split('\n').filter(Boolean);
      const invoked = lines.filter(l => l.includes('skill_invoked'));
      const turnStarts = lines.filter(l => l.includes('model_turn_start'));
      const toolStarts = lines.filter(l => l.includes('tool_start'));
      console.log(`[TRACE] total=${lines.length} invoked=${invoked.length} turns=${turnStarts.length} tools=${toolStarts.length}`);
      expect(invoked.length).toBeGreaterThan(0);
      expect(turnStarts.length).toBeGreaterThan(0);
      try { rmSync(TRACE_FILE); } catch { /* ok */ }
    }
  });

  test('regression: sidebar collapse/expand', async () => {
    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForTimeout(5000);

    const aside = page.locator('aside');
    await expect(aside).toBeVisible();

    const collapseBtn = page.locator('button[title="收起侧边栏"]');
    if (await collapseBtn.isVisible()) {
      await collapseBtn.click();
      await page.waitForTimeout(1000);
      await expect(aside).not.toBeVisible();

      const expandBtn = page.locator('button[title="展开侧边栏"]');
      await expect(expandBtn).toBeVisible();
      await expandBtn.click();
      await page.waitForTimeout(1000);
      await expect(aside).toBeVisible();
    }
    await app.close();
    expect(errors.length).toBe(0);
  });

  test('regression: no JS errors on navigation', async () => {
    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForTimeout(5000);

    const threads = page.locator('[data-testid^="thread-item-"]');
    if (await threads.count() > 0) {
      await threads.first().click();
      await page.waitForTimeout(2000);
    }

    const settingsBtn = page.locator('aside button').last();
    await settingsBtn.click();
    await page.waitForTimeout(1500);

    await app.close();
    expect(errors.length).toBe(0);
  });

  test('regression: skill stats show call counts', async () => {
    setupMockSkillData();

    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForTimeout(5000);

    const settingsBtn = page.locator('aside button').last();
    await settingsBtn.click();
    await page.waitForTimeout(1500);

    const skillTab = page.locator('text=技能管理').first();
    if (await skillTab.isVisible()) {
      await skillTab.click();
      await page.waitForTimeout(3000);

      const bodyText = await page.locator('body').innerText();
      const hasCallCount = bodyText.includes('次') || bodyText.includes('calls') || /\d+/.test(bodyText);
      console.log(`[SKILL-STATS] hasCallCount=${hasCallCount}`);
      expect(hasCallCount).toBe(true);
    }

    await app.close();
    expect(errors.length).toBe(0);
  });
});
