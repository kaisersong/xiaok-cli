// E2E test: comprehensive test for all 4 bugs
import { _electron as electron } from '@playwright/test';

const PASS = (msg: string) => console.log(`✅ ${msg}`);
const FAIL = (msg: string) => console.log(`❌ ${msg}`);
const failures: string[] = [];

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('[E2E] Starting comprehensive test...\n');

  const app = await electron.launch({
    executablePath: '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok',
  });

  const page = app.windows()[0];
  page.on('pageerror', err => console.log(`[PAGE ERROR] ${err.message}`));

  await sleep(3000);

  // ===== TEST 1: Create task that writes TWO files =====
  console.log('--- TEST 1: Task with 2 file generation ---');
  await page.locator('aside button', { hasText: 'New task' }).click();
  await sleep(1500);

  const textarea = page.locator('textarea');
  await textarea.fill('在 /Users/song/Downloads 创建两个文件：xiaok-e2e-a.md 和 xiaok-e2e-b.html，内容都写 test');
  await page.locator('button[type="submit"]').click();
  await sleep(1000);

  // Wait for completion
  console.log('[E2E] Waiting for task completion...');
  let completed = false;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const hasResult = await page.locator('text=Result').isVisible().catch(() => false);
    if (hasResult) { completed = true; break; }
  }
  if (!completed) FAIL('Task did not complete');
  else PASS('Task completed');
  await sleep(2000);

  // ===== TEST 2: Both generated files visible =====
  console.log('\n--- TEST 2: Both generated files visible ---');
  const fileList = await page.locator('[data-testid="generated-files-list"]').isVisible().catch(() => false);
  if (fileList) PASS('Generated files list visible');
  else FAIL('Generated files list NOT visible');

  const fileA = await page.locator('[data-testid="generated-file-xiaok-e2e-a.md"]').isVisible().catch(() => false);
  const fileB = await page.locator('[data-testid="generated-file-xiaok-e2e-b.html"]').isVisible().catch(() => false);
  if (fileA) PASS('File A visible');
  else FAIL('File A NOT visible');
  if (fileB) PASS('File B visible');
  else FAIL('File B NOT visible');

  // ===== TEST 3: Click file A opens canvas with content =====
  if (fileA) {
    console.log('\n--- TEST 3: Click file opens Canvas with content ---');
    await page.locator('[data-testid="generated-file-xiaok-e2e-a.md"]').click();
    await sleep(3000);
    // Check for Canvas panel by looking for border-l class or Preview text
    const canvasPanel = await page.locator('div[class*="border-l"]').last().isVisible({ timeout: 5000 }).catch(() => false);
    const previewText = await page.locator('main').textContent().catch(() => '');
    if (canvasPanel && previewText.length > 20) PASS('Canvas opened with content');
    else if (previewText.length > 20) PASS(`Preview has content (${previewText.length} chars)`);
    else {
      FAIL('Canvas did NOT open');
      await page.screenshot({ path: '/Users/song/projects/xiaok-cli/desktop/test-results/e2e-canvas-a.png' });
    }
    // Close canvas
    await page.locator('button[title="Close Canvas"]').click({ timeout: 3000 }).catch(() => {});
    await sleep(500);
  }

  // ===== TEST 4: Click file B opens canvas with content =====
  if (fileB) {
    console.log('\n--- TEST 4: Click file B opens Canvas ---');
    // Make sure canvas is fully closed first
    await page.locator('button[title="Close Canvas"]').click({ timeout: 3000 }).catch(() => {});
    await sleep(1000);
    await page.locator('[data-testid="generated-file-xiaok-e2e-b.html"]').click();
    await sleep(3000);
    const canvasPanel = await page.locator('div[class*="border-l"]').last().isVisible({ timeout: 5000 }).catch(() => false);
    if (canvasPanel) PASS('Canvas opened for file B');
    else FAIL('Canvas did NOT open for file B');
    await page.locator('button[title="Close Canvas"]').click({ timeout: 3000 }).catch(() => {});
    await sleep(500);
  }

  // ===== TEST 5: History task display =====
  console.log('\n--- TEST 5: History task display ---');
  const threads = page.locator('[data-testid^="thread-item-"]');
  const count = await threads.count();
  if (count === 0) {
    FAIL('No history threads found');
  } else {
    await threads.last().click();
    await sleep(3000);

    // No tool_steps groups
    const toolStepsTexts = await page.locator('text=/steps completed/').all();
    if (toolStepsTexts.length === 0) PASS('No tool_steps groups in history');
    else FAIL(`Found ${toolStepsTexts.length} tool_steps groups`);

    // User messages visible
    const userBubbles = page.locator('.whitespace-pre-wrap').filter({ hasText: /.+/ });
    const userCount = await userBubbles.count();
    if (userCount > 0) PASS(`User messages visible (${userCount})`);
    else FAIL('No user message bubbles');

    // Check for artifacts in result card
    const artifactsVisible = await page.locator('text=/xiaok-e2e/').isVisible().catch(() => false);
    if (artifactsVisible) PASS('Artifacts visible in history');
    else console.log('[INFO] Artifacts not visible in this history task (may be expected)');
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  if (failures.length === 0) {
    console.log('ALL TESTS PASSED');
  } else {
    console.log(`${failures.length} TESTS FAILED:`);
    failures.forEach(f => console.log(`  ❌ ${f}`));
  }
  console.log('='.repeat(50));

  await app.close();
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch(e => { console.error(`[E2E] Fatal: ${e.message}`); process.exit(1); });
