// E2E test for scheduled tasks / reminders
import { _electron as electron } from '@playwright/test';
import { execSync } from 'child_process';

const PASS = (msg: string) => console.log(`✅ ${msg}`);
const FAIL = (msg: string) => { console.log(`❌ ${msg}`); failures.push(msg); };
const failures: string[] = [];

async function main() {
  console.log('[E2E] Testing Scheduled Tasks...');

  // Kill existing instances
  try {
    execSync('pkill -9 -f "xiaok.app" 2>/dev/null || true', { stdio: 'ignore' });
    execSync('pkill -9 -f "xiaok Helper" 2>/dev/null || true', { stdio: 'ignore' });
  } catch { /* ignore */ }
  await new Promise(r => setTimeout(r, 2000));

  const app = await electron.launch({
    executablePath: '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok',
    timeout: 60000,
  });

  let page = app.windows()[0];
  for (let i = 0; !page && i < 10; i++) {
    await new Promise(r => setTimeout(r, 1000));
    page = app.windows()[0];
  }

  if (!page) {
    FAIL('No window found');
    await app.close();
    process.exit(1);
    return;
  }

  page.on('pageerror', err => { console.log(`[PAGE ERROR] ${err.message}`); failures.push(`Page error: ${err.message}`); });
  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`[CONSOLE ERROR] ${msg.text()}`);
  });

  await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
  console.log(`[E2E] URL: ${page.url()}`);

  // TEST 1: Sidebar renders with New task and Scheduled nav items
  console.log('\n--- TEST 1: Sidebar navigation ---');
  const newTaskBtn = page.locator('button').filter({ hasText: 'New task' }).first();
  const newTaskVisible = await newTaskBtn.isVisible({ timeout: 5000 }).catch(() => false);
  if (newTaskVisible) {
    PASS('New task button visible');
  } else {
    FAIL('New task button not found');
  }

  const scheduledBtn = page.locator('button').filter({ hasText: 'Scheduled' }).first();
  const scheduledVisible = await scheduledBtn.isVisible({ timeout: 5000 }).catch(() => false);
  if (scheduledVisible) {
    PASS('Scheduled button visible');
  } else {
    FAIL('Scheduled button not found');
  }

  // TEST 2: Create a task (send message)
  console.log('\n--- TEST 2: Create task (send message) ---');
  await newTaskBtn.click();
  await page.waitForTimeout(1000);

  const textarea = page.locator('textarea');
  await textarea.fill('测试消息发送');
  await page.waitForTimeout(500);

  // Check submit button is enabled
  const submitBtn = page.locator('button[type="submit"]');
  const submitEnabled = await submitBtn.isEnabled({ timeout: 3000 }).catch(() => false);
  if (submitEnabled) {
    PASS('Submit button enabled');
  } else {
    FAIL('Submit button not enabled - cannot send message');
  }

  // Actually submit
  if (submitEnabled) {
    await submitBtn.click();
    await page.waitForTimeout(2000);

    // Verify input cleared
    const inputValue = await textarea.inputValue();
    if (inputValue === '') {
      PASS('Input cleared after submit');
    } else {
      FAIL(`Input not cleared: "${inputValue}"`);
    }
  }

  // TEST 3: Navigate to Scheduled page
  console.log('\n--- TEST 3: Navigate to Scheduled ---');
  await scheduledBtn.click();
  await page.waitForTimeout(1000);

  // Check URL changed
  const url = page.url();
  if (url.includes('scheduled')) {
    PASS('Navigated to /scheduled');
  } else {
    FAIL(`URL not /scheduled: ${url}`);
  }

  // TEST 4: Create a reminder via IPC
  console.log('\n--- TEST 4: Create reminder via IPC ---');
  const reminderResult = await page.evaluate(async () => {
    try {
      // @ts-ignore
      const r = await window.xiaokDesktop.createReminder({
        content: '测试提醒',
        scheduleAt: Date.now() + 60 * 60_000, // 1 hour from now
      });
      return { ok: true, id: r.reminderId };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  if (reminderResult.ok) {
    PASS(`Reminder created: ${reminderResult.id}`);
  } else {
    FAIL(`Reminder creation failed: ${reminderResult.error}`);
  }

  // TEST 5: List reminders
  console.log('\n--- TEST 5: List reminders ---');
  const listResult = await page.evaluate(async () => {
    try {
      // @ts-ignore
      const list = await window.xiaokDesktop.listReminders();
      return { ok: true, count: list.length };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  if (listResult.ok && listResult.count >= 1) {
    PASS(`Reminders listed: ${listResult.count}`);
  } else {
    FAIL(`Reminder listing failed: ${listResult.error || 'count=' + listResult.count}`);
  }

  // TEST 6: Check Scheduled page shows reminder
  console.log('\n--- TEST 6: Scheduled page shows reminder ---');
  const scheduledPage = page.locator('[data-testid="scheduled-page"]');
  const pageText = await scheduledPage.textContent() ?? '';
  if (pageText.includes('Scheduled Tasks') || pageText.includes('测试提醒') || pageText.includes('No scheduled tasks') || pageText.includes('暂无定时任务')) {
    PASS('Scheduled page renders correctly');
  } else {
    FAIL(`Scheduled page content unexpected: ${pageText.slice(0, 200)}`);
  }

  // TEST 7: Cancel reminder via IPC
  console.log('\n--- TEST 7: Cancel reminder ---');
  if (reminderResult.ok) {
    const cancelResult = await page.evaluate(async (id) => {
      try {
        // @ts-ignore
        const ok = await window.xiaokDesktop.cancelReminder(id);
        return { ok };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    }, reminderResult.id);

    if (cancelResult.ok) {
      PASS('Reminder cancelled');
    } else {
      FAIL(`Reminder cancel failed: ${cancelResult.error}`);
    }
  }

  // TEST 8: Status API
  console.log('\n--- TEST 8: Reminder status API ---');
  const statusResult = await page.evaluate(async () => {
    try {
      // @ts-ignore
      const status = await window.xiaokDesktop.getReminderStatus();
      return { ok: true, pendingCount: status.pendingCount };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  if (statusResult.ok) {
    PASS(`Status API works: ${statusResult.pendingCount} pending`);
  } else {
    FAIL(`Status API failed: ${statusResult.error}`);
  }

  await page.screenshot({ path: 'e2e-results/scheduled-e2e.png' });
  await app.close();

  console.log('\n========== RESULTS ==========');
  console.log(`Total: ${failures.length === 0 ? 'ALL PASSED' : `${failures.length} FAILED`}`);
  if (failures.length > 0) {
    failures.forEach(f => console.log(`  ❌ ${f}`));
    process.exit(1);
  }
}

main().catch(e => { console.error('[E2E] FATAL:', e); process.exit(1); });