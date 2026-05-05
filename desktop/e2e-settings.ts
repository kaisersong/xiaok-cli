// E2E test specifically for Settings UI
import { _electron as electron } from '@playwright/test';
import { execSync } from 'child_process';

const PASS = (msg: string) => console.log(`✅ ${msg}`);
const FAIL = (msg: string) => { console.log(`❌ ${msg}`); failures.push(msg); };
const failures: string[] = [];

async function main() {
  console.log('[E2E] Testing Settings UI...');

  // Kill any existing instances to avoid single-instance lock conflicts
  try {
    execSync('pkill -9 -f "xiaok.app" 2>/dev/null || true', { stdio: 'ignore' });
    execSync('pkill -9 -f "xiaok Helper" 2>/dev/null || true', { stdio: 'ignore' });
  } catch { /* ignore */ }

  // Wait a moment for cleanup
  await new Promise(r => setTimeout(r, 2000));

  const app = await electron.launch({
    executablePath: '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok',
    timeout: 60000,
  });

  // Wait and retry for window
  let page = app.windows()[0];
  for (let i = 0; !page && i < 10; i++) {
    await new Promise(r => setTimeout(r, 1000));
    page = app.windows()[0];
  }

  if (!page) {
    FAIL('No window found after 10s');
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

  // ---- TEST 1: Open settings ----
  console.log('\n--- TEST 1: Open settings ---');
  const settingsBtn = page.locator('button').filter({ hasText: '' }).locator('svg.lucide-bolt').first();
  const settingsVisible = await settingsBtn.isVisible({ timeout: 5000 }).catch(() => false);
  if (!settingsVisible) {
    FAIL('Settings button (bolt icon) not found');
  } else {
    await settingsBtn.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'e2e-results/settings-open.png' });

    // Check settings content
    const settingsText = await page.locator('body').textContent() ?? '';
    console.log(`[TEST] Settings text length: ${settingsText.length}`);
    console.log(`[TEST] First 300 chars: ${settingsText.slice(0, 300)}`);

    if (settingsText.length > 100) {
      PASS('Settings page opened with content');
    } else {
      FAIL('Settings page is empty or minimal');
    }
  }

  // ---- TEST 2: Navigate tabs ----
  console.log('\n--- TEST 2: Navigate tabs ---');
  const tabs = ['模型设置', '技能管理', '消息通道', 'MCP 服务器', '外观设置', '数据管理', '关于'];
  for (const tab of tabs) {
    const tabBtn = page.locator(`button:has-text("${tab}")`);
    const visible = await tabBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (visible) {
      await tabBtn.click();
      await page.waitForTimeout(1000);
      PASS(`Tab "${tab}" navigated`);
    } else {
      FAIL(`Tab "${tab}" not found`);
    }
  }

  // ---- TEST 3: Model settings has content ----
  console.log('\n--- TEST 3: Model settings content ---');
  const modelTab = page.locator('button:has-text("模型设置")');
  await modelTab.click();
  await page.waitForTimeout(1000);

  const modelText = await page.locator('body').textContent() ?? '';
  if (modelText.includes('API Key') || modelText.includes('提供商')) {
    PASS('Model settings has content');
  } else {
    FAIL(`Model settings missing content. Text: ${modelText.slice(0, 300)}`);
  }

  // ---- TEST 4: Skills has content ----
  console.log('\n--- TEST 4: Skills content ---');
  const skillsTab = page.locator('button:has-text("技能管理")');
  await skillsTab.click();
  await page.waitForTimeout(3000);

  const skillsText = await page.locator('body').textContent() ?? '';
  if (skillsText.length > 50) {
    PASS('Skills page has content');
  } else {
    FAIL('Skills page is empty');
  }

  // ---- TEST 5: Channels ----
  console.log('\n--- TEST 5: Channels (消息通道) ---');
  const channelsTab = page.locator('button:has-text("消息通道")');
  await channelsTab.click();
  await page.waitForTimeout(1000);

  const channelsText = await page.locator('body').textContent() ?? '';
  if (channelsText.includes('添加通道') || channelsText.includes('暂无')) {
    PASS('Channels page has content');
  } else {
    FAIL(`Channels page missing content. Text: ${channelsText.slice(0, 200)}`);
  }

  // ---- TEST 6: Close settings ----
  console.log('\n--- TEST 6: Close settings ---');
  const backBtn = page.locator('button').filter({ hasText: '返回' }).first();
  const backVisible = await backBtn.isVisible({ timeout: 3000 }).catch(() => false);
  if (backVisible) {
    await backBtn.click();
    await page.waitForTimeout(1000);
    const chatArea = await page.locator('main').textContent() ?? '';
    if (!chatArea.includes('模型设置') && !chatArea.includes('技能管理')) {
      PASS('Settings closed, back to chat');
    } else {
      FAIL('Settings did not close properly');
    }
  } else {
    FAIL('Back button not found');
  }

  await page.screenshot({ path: 'e2e-results/settings-final.png' });
  await app.close();

  console.log('\n========== RESULTS ==========');
  console.log(`Total: ${failures.length === 0 ? 'ALL PASSED' : `${failures.length} FAILED`}`);
  if (failures.length > 0) {
    failures.forEach(f => console.log(`  ❌ ${f}`));
    process.exit(1);
  }
}

main().catch(e => { console.error('[E2E] FATAL:', e); process.exit(1); });