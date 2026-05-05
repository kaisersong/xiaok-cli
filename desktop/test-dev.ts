// Debug test for dev mode
import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

let electronApp: ElectronApplication;
let page: Page;

async function main() {
  console.log('[TEST] Launching dev mode...');
  electronApp = await electron.launch({
    args: ['--no-sandbox'],
    cwd: '/Users/song/projects/xiaok-cli/desktop',
    env: {
      ...process.env,
      XIAOK_DESKTOP_DEV_SERVER: 'http://127.0.0.1:5174/',
    },
    executablePath: 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
  });

  page = await electronApp.firstWindow();

  // Wait for the dev server page to load
  let loaded = false;
  for (let i = 0; i < 10; i++) {
    const url = page.url();
    console.log(`[TEST] Attempt ${i}: URL = ${url}`);
    if (url.includes('127.0.0.1') || url.includes('localhost')) {
      loaded = true;
      break;
    }
    await page.waitForTimeout(1000);
    // Try to get the next window if first one is default app
    const pages = electronApp.windows();
    if (pages.length > 1) {
      page = pages.find(p => p.url().includes('127.0.0.1') || p.url().includes('localhost')) || page;
    }
  }

  if (!loaded) {
    console.log('[TEST] Dev page not loaded, waiting longer...');
    await page.waitForTimeout(5000);
  }

  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000);

  page.on('pageerror', error => console.log(`[PAGE ERROR] ${error.message}`));
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[ChatShell]') || text.includes('[api-bridge]') || msg.type() === 'error') {
      console.log(`[CONSOLE] ${msg.type()}: ${text}`);
    }
  });

  console.log(`[TEST] Page URL: ${page.url()}`);
  await page.screenshot({ path: 'test-dev-1-initial.png' });

  // Step 1: Create a new thread
  console.log('[TEST] Step 1: Creating new thread...');
  await page.locator('aside button', { hasText: 'New' }).click();
  await page.waitForTimeout(2000);

  const textarea = page.locator('textarea');
  await textarea.fill('测试历史会话导航bug');
  await page.locator('button[type="submit"]').click();

  console.log('[TEST] Waiting for response...');
  await page.waitForTimeout(20000);
  await page.screenshot({ path: 'test-dev-2-after-submit.png' });

  // Step 2: Check sidebar
  console.log('[TEST] Step 2: Checking sidebar...');
  const sidebar = await page.locator('aside').textContent() ?? '';
  console.log(`[TEST] Sidebar text (first 300): ${sidebar.slice(0, 300)}`);
  const hasThread = sidebar.includes('测试历史会话导航');
  console.log(`[TEST] Thread in sidebar: ${hasThread}`);

  // Step 3: Navigate away
  console.log('[TEST] Step 3: Navigate to welcome page...');
  await page.locator('aside button', { hasText: 'New' }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-dev-3-welcome.png' });

  // Step 4: Click the thread
  console.log('[TEST] Step 4: Click thread in sidebar...');
  const threadItem = page.locator('[data-testid^="thread-item-"]').first();
  await threadItem.click();
  await page.waitForTimeout(3000);

  console.log(`[TEST] URL after click: ${page.url()}`);
  await page.screenshot({ path: 'test-dev-4-after-click.png' });

  // Step 5: Check main content
  console.log('[TEST] Step 5: Check main content...');
  const mainContent = await page.locator('main').textContent() ?? '';
  console.log(`[TEST] Main content (first 500): ${mainContent.slice(0, 500)}`);

  const isLoading = mainContent.toLowerCase().includes('loading');
  const hasUserMsg = mainContent.includes('测试历史会话导航');

  console.log(`[TEST] Is Loading: ${isLoading}`);
  console.log(`[TEST] Has user message: ${hasUserMsg}`);

  if (isLoading && !hasUserMsg) {
    console.log('[FAIL] Bug confirmed: showing Loading... instead of messages');
  } else if (hasUserMsg) {
    console.log('[PASS] Navigation works!');
  } else {
    console.log('[UNKNOWN] Unexpected state');
  }

  // Keep open for manual inspection
  console.log('[TEST] Keeping app open for 10s for inspection...');
  await page.waitForTimeout(10000);

  await electronApp.close();
}

main().catch(e => {
  console.error('[ERROR]', e);
  process.exit(1);
});