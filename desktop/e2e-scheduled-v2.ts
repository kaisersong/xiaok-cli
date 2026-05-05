// E2E test for scheduled tasks v2 - sidebar, thread reuse, schedule context
import { _electron as electron } from '@playwright/test';
import { execSync } from 'child_process';

const PASS = (msg: string) => console.log(`✅ ${msg}`);
const FAIL = (msg: string) => { console.log(`❌ ${msg}`); failures.push(msg); };
const failures: string[] = [];

async function main() {
  console.log('[E2E] Testing Scheduled Tasks v2 (sidebar + thread reuse)...');

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

  page.on('pageerror', err => { console.log(`[PAGE ERROR] ${err.message}`); });
  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`[CONSOLE ERROR] ${msg.text()}`);
  });

  await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
  console.log(`[E2E] URL: ${page.url()}`);

  // --- TEST 1: Sidebar shows scheduled tasks list ---
  console.log('\n--- TEST 1: Sidebar scheduled tasks list ---');

  // First, create a scheduled task via the page
  await page.click('button:has-text("Scheduled")');
  await page.waitForTimeout(1000);

  // Create a task - use the "New task" button in the page header (not sidebar)
  // The header button is in the border-b section
  await page.locator('.border-b').locator('button:has-text("New task")').click();
  await page.waitForTimeout(1000);

  // Fill form fields using placeholder
  await page.locator('input[placeholder="daily-briefing"]').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('input[placeholder="daily-briefing"]').fill('E2E Test Task');
  await page.locator('input[placeholder="Summarize my calendar and inbox"]').fill('E2E test description');
  await page.locator('textarea[placeholder*="Check my calendar"]').fill('Run a test command');
  await page.waitForTimeout(500);

  // Save the task
  const saveBtn = page.locator('button').filter({ hasText: 'Save' }).first();
  await saveBtn.click();
  await page.waitForTimeout(1000);

  // Go back to home to check sidebar
  const newTaskBtn = page.locator('button').filter({ hasText: 'New task' }).first();
  await newTaskBtn.click();
  await page.waitForTimeout(2000);

  // Check sidebar for scheduled tasks section
  const sidebarText = await page.locator('aside').textContent() ?? '';

  if (sidebarText.includes('Scheduled') && sidebarText.includes('E2E Test Task')) {
    PASS('Sidebar shows scheduled tasks list with task name');
  } else {
    FAIL(`Sidebar missing scheduled section. Text: ${sidebarText.slice(0, 300)}`);
  }

  // --- TEST 2: Run scheduled task creates/reuses thread ---
  console.log('\n--- TEST 2: Run task and thread reuse ---');

  // Go to scheduled page
  const scheduledBtn = page.locator('button').filter({ hasText: 'Scheduled' }).first();
  await scheduledBtn.click();
  await page.waitForTimeout(1000);

  // Record current "Last run" state
  const beforeLastRun = await page.locator('[data-testid="scheduled-page"]').textContent() ?? '';

  // Click Run on the task
  const runBtn = page.locator('button').filter({ hasText: 'Run' }).first();
  await runBtn.click();
  await page.waitForTimeout(3000);

  // Check if we navigated to a thread view
  const url = page.url();
  if (url.includes('/t/')) {
    PASS('Clicking Run navigated to thread view');
  } else {
    FAIL(`Expected /t/ URL, got: ${url}`);
  }

  // Check if message appears in thread
  const threadContent = await page.locator('main').textContent() ?? '';
  if (threadContent.length > 10) {
    PASS('Thread has content after run');
  } else {
    FAIL('Thread appears empty after run');
  }

  // Go back to scheduled and check last run was updated
  await scheduledBtn.click();
  await page.waitForTimeout(2000);

  const afterLastRun = await page.locator('[data-testid="scheduled-page"]').textContent() ?? '';
  if (afterLastRun.includes('Last run:') && afterLastRun !== beforeLastRun) {
    PASS('Last run time was updated after run');
  } else {
    FAIL('Last run time not updated');
  }

  // --- TEST 3: Click task in sidebar navigates to thread ---
  console.log('\n--- TEST 3: Sidebar task click navigates to thread ---');

  // Click on the task in sidebar
  const sidebarTask = page.locator('aside button').filter({ hasText: 'E2E Test Task' }).first();
  const sidebarTaskVisible = await sidebarTask.isVisible({ timeout: 5000 }).catch(() => false);
  if (sidebarTaskVisible) {
    await sidebarTask.click();
    await page.waitForTimeout(1000);

    const afterClickUrl = page.url();
    if (afterClickUrl.includes('/t/')) {
      PASS('Clicking sidebar task navigates to thread');
    } else {
      FAIL(`Expected /t/ URL after sidebar click, got: ${afterClickUrl}`);
    }
  } else {
    FAIL('Sidebar task not found');
  }

  // --- TEST 4: Run task again reuses same thread ---
  console.log('\n--- TEST 4: Thread reuse on second run ---');

  // Get current thread ID
  const firstThreadUrl = page.url();

  // Go back to scheduled
  await scheduledBtn.click();
  await page.waitForTimeout(1000);

  // Run again
  await runBtn.click();
  await page.waitForTimeout(3000);

  // Check if we're on the same thread
  const secondThreadUrl = page.url();
  if (secondThreadUrl === firstThreadUrl) {
    PASS('Second run reused same thread');
  } else {
    // Extract thread IDs
    const firstId = firstThreadUrl.match(/\/t\/([^/?]+)/)?.[1] || '';
    const secondId = secondThreadUrl.match(/\/t\/([^/?]+)/)?.[1] || '';
    if (firstId && firstId === secondId) {
      PASS('Second run reused same thread (same threadId)');
    } else {
      FAIL(`Thread IDs differ: first=${firstId.slice(0, 8)}..., second=${secondId.slice(0, 8)}...`);
    }
  }

  // --- TEST 5: View button navigates to last run thread ---
  console.log('\n--- TEST 5: View button navigates to last run ---');

  await scheduledBtn.click();
  await page.waitForTimeout(1000);

  const viewBtn = page.locator('button').filter({ hasText: 'View' }).first();
  const viewVisible = await viewBtn.isVisible({ timeout: 3000 }).catch(() => false);
  if (viewVisible) {
    await viewBtn.click();
    await page.waitForTimeout(1000);

    const viewUrl = page.url();
    if (viewUrl.includes('/t/')) {
      PASS('View button navigates to thread');
    } else {
      FAIL(`Expected /t/ URL from View, got: ${viewUrl}`);
    }
  } else {
    FAIL('View button not visible');
  }

  // --- TEST 6: Task card shows frequency ---
  console.log('\n--- TEST 6: Task card shows frequency ---');

  await scheduledBtn.click();
  await page.waitForTimeout(1000);

  const cardText = await page.locator('[data-testid="scheduled-page"]').textContent() ?? '';
  if (cardText.includes('Manual')) {
    PASS('Task card shows frequency');
  } else {
    FAIL(`Task card missing frequency. Text: ${cardText.slice(0, 300)}`);
  }

  await page.screenshot({ path: 'e2e-results/scheduled-v2.png' });
  await app.close();

  console.log('\n========== RESULTS ==========');
  console.log(`Total: ${failures.length === 0 ? 'ALL PASSED' : `${failures.length} FAILED`}`);
  if (failures.length > 0) {
    failures.forEach(f => console.log(`  ❌ ${f}`));
    process.exit(1);
  }
}

main().catch(e => { console.error('[E2E] FATAL:', e); process.exit(1); });
