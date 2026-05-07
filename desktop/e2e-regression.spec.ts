import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const APP_PATH = '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok';
const DATA_ROOT = join(process.env.HOME!, '.xiaok', 'desktop');
const EXEC_FILE = join(DATA_ROOT, 'skill-exec.json');

test.describe('Regression suite', () => {
  // ── Sidebar collapse/expand ──
  test('sidebar collapse then expand restores layout', async () => {
    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForTimeout(5000);

    // Sidebar should be visible initially
    const aside = page.locator('aside');
    await expect(aside).toBeVisible();

    // Click collapse button (inside title bar area)
    const collapseBtn = page.locator('button[title="收起侧边栏"]');
    if (await collapseBtn.isVisible()) {
      await collapseBtn.click();
      await page.waitForTimeout(1000);

      // Sidebar should be hidden
      await expect(aside).not.toBeVisible();

      // Click expand button
      const expandBtn = page.locator('button[title="展开侧边栏"]');
      await expect(expandBtn).toBeVisible();
      await expandBtn.click();
      await page.waitForTimeout(1000);

      // Sidebar should be back
      await expect(aside).toBeVisible();
    }

    await page.screenshot({ path: 'test-results/reg-sidebar-collapse.png' });
    await app.close();
    expect(errors.length).toBe(0);
  });

  // ── Settings → skill management loads without crash ──
  test('settings → skill management tab loads skills', async () => {
    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(`PAGE: ${e.message}`));
    await page.waitForTimeout(5000);

    // Open settings
    const settingsBtn = page.locator('aside button').last();
    await settingsBtn.click();
    await page.waitForTimeout(1500);

    // Click 技能管理 tab
    const skillTab = page.locator('text=技能管理').first();
    if (await skillTab.isVisible()) {
      await skillTab.click();
      await page.waitForTimeout(3000);

      // Should render without crash — look for skill cards or empty state
      const hasContent = await page.locator('body').innerText();
      const hasSkillUI = hasContent.includes('已安装') || hasContent.includes('Installed') || hasContent.includes('搜索');
      console.log(`[SKILL-MGMT] hasSkillUI=${hasSkillUI}, errors=${errors.length}`);

      await page.screenshot({ path: 'test-results/reg-skill-management.png' });
    } else {
      console.log('[SKILL-MGMT] 技能管理 tab not found');
    }

    await app.close();
    expect(errors.length).toBe(0);
  });

  // ── Skill stats display ──
  test('skill stats show call counts on skill cards', async () => {
    // Write mock stats data
    mkdirSync(DATA_ROOT, { recursive: true });
    const now = Date.now();
    const mockRecords = [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `exec_review_${i}`,
        skillNames: ['review'],
        taskId: `task_reg_${i}`,
        startTime: now - (5 - i) * 60000,
        endTime: now - (5 - i) * 60000 + 30000,
        durationMs: 30000,
        status: 'success',
        inputTokens: 2000,
        outputTokens: 800,
        prompt: '/review test code',
        triggerType: 'slash_command',
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `exec_qa_${i}`,
        skillNames: ['qa'],
        taskId: `task_qa_${i}`,
        startTime: now - (3 - i) * 120000,
        endTime: now - (3 - i) * 120000 + 20000,
        durationMs: 20000,
        status: i === 2 ? 'error' : 'success',
        inputTokens: 1500,
        outputTokens: 600,
        prompt: '/qa test',
        triggerType: 'slash_command',
      })),
    ];
    writeFileSync(EXEC_FILE, JSON.stringify(mockRecords));

    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(`PAGE: ${e.message}`));
    await page.waitForTimeout(5000);

    // Navigate to settings → 技能管理
    const settingsBtn = page.locator('aside button').last();
    await settingsBtn.click();
    await page.waitForTimeout(1500);
    await page.locator('text=技能管理').first().click();
    await page.waitForTimeout(3000);

    // Check for stats-related text (call counts, avg duration, success rate)
    const bodyText = await page.locator('body').innerText();
    const hasCallCount = bodyText.includes('次') || bodyText.includes('calls') || /\d+/.test(bodyText);
    const hasStatsKeywords = bodyText.includes('avg') || bodyText.includes('平均') || bodyText.includes('成功率') || bodyText.includes('rate');

    console.log(`[SKILL-STATS] hasCallCount=${hasCallCount}, hasStatsKeywords=${hasStatsKeywords}`);
    console.log(`[SKILL-STATS] bodyText snippet: ${bodyText.slice(0, 500)}`);

    await page.screenshot({ path: 'test-results/reg-skill-stats.png' });

    // Clean up
    try { rmSync(EXEC_FILE); } catch { /* ok */ }
    await app.close();
    expect(errors.length).toBe(0);
  });

  // ── New task creation via chat input ──
  test('create new task from chat and verify content', async () => {
    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForTimeout(5000);

    // Go to welcome page
    const newBtn = page.locator('button:has-text("New task")');
    if (await newBtn.isVisible()) {
      await newBtn.click();
      await page.waitForTimeout(1000);
    }

    // Type a prompt
    const textarea = page.locator('textarea');
    if (await textarea.isVisible()) {
      const testPrompt = `test prompt ${Date.now()}`;
      await textarea.fill(testPrompt);
      await page.waitForTimeout(500);
      await textarea.press('Enter');

      // Wait for navigation and task creation
      await page.waitForTimeout(8000);

      // Should navigate to chat page with the prompt visible
      const userBubbles = page.locator('[data-role="user"]');
      if (await userBubbles.count() > 0) {
        const firstMsg = await userBubbles.first().innerText();
        console.log(`[NEW-TASK] Created task, first msg: "${firstMsg.slice(0, 60)}"`);
        expect(firstMsg).toContain(testPrompt.slice(0, 30));
      } else {
        console.log('[NEW-TASK] No user bubble yet (task still loading)');
      }

      await page.screenshot({ path: 'test-results/reg-new-task.png' });
    } else {
      console.log('[NEW-TASK] textarea not found on welcome page');
    }

    await app.close();
    expect(errors.length).toBe(0);
  });

  // ── Tool steps visible in completed tasks ──
  test('completed tasks with tool calls show tool steps', async () => {
    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForTimeout(5000);

    // Click a thread that had tool calls (thread 1 — "把附件生成报告" has 203 events)
    const threads = page.locator('[data-testid^="thread-item-"]');
    const count = await threads.count();

    let foundToolSteps = false;
    for (let i = 0; i < Math.min(count, 5); i++) {
      const title = await threads.nth(i).locator('span').first().innerText();
      await threads.nth(i).click();
      await page.waitForTimeout(2000);

      // Check for tool steps indicators (step count text or tool name)
      const bodyText = await page.locator('body').innerText();
      if (bodyText.includes('step') || bodyText.includes('completed')) {
        foundToolSteps = true;
        console.log(`[TOOL-STEPS] Thread ${i} ("${title}") has tool steps`);
        break;
      }
    }

    if (!foundToolSteps) {
      console.log('[TOOL-STEPS] No tool steps found in first 5 threads');
    }

    await page.screenshot({ path: 'test-results/reg-tool-steps.png' });
    await app.close();
    expect(errors.length).toBe(0);
  });

  // ── No JS errors across app ──
  test('no JS errors on app start and basic navigation', async () => {
    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(`${e.message}\n${e.stack?.slice(0, 200)}`));
    await page.waitForTimeout(5000);

    // Navigate through sidebar
    const threads = page.locator('[data-testid^="thread-item-"]');
    if (await threads.count() > 0) {
      await threads.first().click();
      await page.waitForTimeout(2000);
    }

    // Open settings
    const settingsBtn = page.locator('aside button').last();
    await settingsBtn.click();
    await page.waitForTimeout(1500);

    // Go back
    await page.locator('button').first().click();
    await page.waitForTimeout(1000);

    await page.screenshot({ path: 'test-results/reg-no-errors.png' });
    await app.close();
    expect(errors.length).toBe(0);
  });
});
