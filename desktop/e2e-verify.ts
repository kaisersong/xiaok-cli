// Full E2E verification - must pass before reporting success
import { _electron as electron } from '@playwright/test';

async function main() {
  const pass = (msg: string) => console.log(`✅ PASS: ${msg}`);
  const fail = (msg: string) => { console.log(`❌ FAIL: ${msg}`); failures.push(msg); };
  const failures: string[] = [];

  const app = await electron.launch({
    executablePath: '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok',
  });
  const page = app.windows()[0];
  page.on('pageerror', err => console.log(`[PAGE ERROR] ${err.message}`));

  await page.waitForTimeout(4000);
  console.log(`URL: ${page.url()}`);

  // ===== TEST 1: Create thread 1 and wait for AI response =====
  console.log('\n--- TEST 1: Create thread 1 ---');
  await page.locator('aside button', { hasText: 'New' }).click();
  await page.waitForTimeout(1500);

  const textarea = page.locator('textarea');
  await textarea.fill('端到端测试线程一');
  await page.locator('button[type="submit"]').click();
  console.log('Waiting 30s for AI response...');
  await page.waitForTimeout(30000);
  await page.screenshot({ path: 'e2e-results/thread1-response.png' });

  const t1Content = await page.locator('main').textContent() ?? '';
  const t1HasAI = t1Content.length > 50 && !t1Content.includes('Loading') && !t1Content.includes('Thinking');
  if (t1HasAI) pass('Thread 1 has AI response');
  else fail(`Thread 1 no AI response. Content: ${t1Content.slice(0, 200)}`);

  // ===== TEST 2: Thread 1 appears in sidebar =====
  console.log('\n--- TEST 2: Sidebar shows thread 1 ---');
  const sidebar = await page.locator('aside').textContent() ?? '';
  if (sidebar.includes('端到端测试线程一')) pass('Thread 1 in sidebar');
  else fail('Thread 1 NOT in sidebar');

  // ===== TEST 3: Navigate away =====
  console.log('\n--- TEST 3: Navigate to welcome ---');
  await page.locator('aside button', { hasText: 'New' }).click();
  await page.waitForTimeout(2000);
  const welcomeUrl = page.url();
  if (welcomeUrl.endsWith('#/') || welcomeUrl.includes('#/')) pass('Navigated to welcome');
  else fail(`Unexpected URL: ${welcomeUrl}`);

  // ===== TEST 4: Create thread 2 =====
  console.log('\n--- TEST 4: Create thread 2 ---');
  await page.locator('textarea').fill('端到端测试线程二');
  await page.locator('button[type="submit"]').click();
  console.log('Waiting 30s for AI response...');
  await page.waitForTimeout(30000);
  await page.screenshot({ path: 'e2e-results/thread2-response.png' });

  // ===== TEST 5: Navigate away and click thread 1 =====
  console.log('\n--- TEST 5: Click thread 1 from sidebar ---');
  await page.locator('aside button', { hasText: 'New' }).click();
  await page.waitForTimeout(2000);

  // Sidebar shows newest first, thread 1 is the older one
  const items = page.locator('[data-testid^="thread-item-"]');
  const count = await items.count();
  console.log(`Found ${count} thread items`);

  // Find thread 1 (contains "线程一")
  let thread1Item = null;
  for (let i = 0; i < count; i++) {
    const text = await items.nth(i).textContent() ?? '';
    if (text.includes('线程一')) { thread1Item = items.nth(i); break; }
  }

  if (!thread1Item) { fail('Could not find thread 1 in sidebar'); }
  else {
    await thread1Item.click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'e2e-results/thread1-loaded.png' });

    const loadedContent = await page.locator('main').textContent() ?? '';
    console.log(`Main content (300 chars): ${loadedContent.slice(0, 300)}`);

    // Must show user message "端到端测试线程一"
    const hasUserMsg = loadedContent.includes('线程一');
    const noLoading = !loadedContent.includes('Loading');
    const noThinking = !loadedContent.includes('Thinking');

    if (hasUserMsg) pass('Thread 1 shows user message');
    else fail('Thread 1 missing user message');

    if (noLoading) pass('No "Loading..." text');
    else fail('Still showing Loading...');

    if (noThinking) pass('No "Thinking..." text');
    else fail('Still showing Thinking...');

    // Should have some AI response content (more than just footer)
    const footerText = 'Xiaok is AI and can make mistakes.';
    const contentWithoutFooter = loadedContent.replace(footerText, '').trim();
    if (contentWithoutFooter.length > 20) pass('Has AI response content');
    else fail(`No AI response content. Content: ${loadedContent.slice(0, 200)}`);
  }

  // ===== TEST 6: Click thread 2 =====
  console.log('\n--- TEST 6: Click thread 2 from sidebar ---');
  // Navigate away first
  await page.locator('aside button', { hasText: 'New' }).click();
  await page.waitForTimeout(2000);

  let thread2Item = null;
  const items2 = page.locator('[data-testid^="thread-item-"]');
  for (let i = 0; i < await items2.count(); i++) {
    const text = await items2.nth(i).textContent() ?? '';
    if (text.includes('线程二')) { thread2Item = items2.nth(i); break; }
  }

  if (!thread2Item) { fail('Could not find thread 2 in sidebar'); }
  else {
    await thread2Item.click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'e2e-results/thread2-loaded.png' });

    const loadedContent2 = await page.locator('main').textContent() ?? '';
    const hasUserMsg2 = loadedContent2.includes('线程二');
    if (hasUserMsg2) pass('Thread 2 shows user message');
    else fail('Thread 2 missing user message');
  }

  await app.close();

  // ===== SUMMARY =====
  console.log('\n========== RESULTS ==========');
  console.log(`Total: ${failures.length === 0 ? 'ALL PASSED' : `${failures.length} FAILED`}`);
  if (failures.length > 0) {
    failures.forEach(f => console.log(`  ❌ ${f}`));
    process.exit(1);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });