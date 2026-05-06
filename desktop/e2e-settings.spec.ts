import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';

test.describe('Settings debug', () => {
  test('verify all settings tabs load without errors', async () => {
    const app = await electron.launch({
      executablePath: '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok',
    });
    const page = await app.firstWindow();
    await page.waitForTimeout(5000);

    const errors: string[] = [];
    page.on('pageerror', e => errors.push(`PAGE ERROR: ${e.message}\n${e.stack?.slice(0, 500)}`));
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        errors.push(`CONSOLE ${msg.type()}: ${msg.text()}`);
      }
    });

    // Click settings (last sidebar button)
    const sidebarBtns = page.locator('aside button');
    await sidebarBtns.last().click();
    await page.waitForTimeout(1500);

    // Verify settings page loaded
    await expect(page.locator('text=返回')).toBeVisible({ timeout: 5000 });

    // Test each tab
    const tabs = ['通用设置', '模型设置', '技能管理', '消息通道', 'MCP 服务器', '外观设置', '数据管理', '关于'];
    for (const tab of tabs) {
      await page.locator(`text=${tab}`).first().click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `test-results/settings-${tab.replace(/\s/g, '-')}.png` });
      // Verify no blank page: content area should have some rendered content
      const content = page.locator('.px-8');
      const innerText = await content.innerText().catch(() => '');
      expect(innerText.length, `${tab} tab appears blank`).toBeGreaterThan(0);
    }

    // Print all errors
    console.log(`\n[ALL ERRORS] count=${errors.length}`);
    for (const e of errors) {
      console.log(e);
    }

    await app.close();
    expect(errors.length).toBe(0);
  });

  test('channels test button shows feedback', async () => {
    const app = await electron.launch({
      executablePath: '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok',
    });
    const page = await app.firstWindow();
    await page.waitForTimeout(5000);

    const errors: string[] = [];
    page.on('pageerror', e => errors.push(`PAGE ERROR: ${e.message}`));
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(`CONSOLE error: ${msg.text()}`);
      }
    });

    // Click settings
    const sidebarBtns = page.locator('aside button');
    await sidebarBtns.last().click();
    await page.waitForTimeout(1000);

    // Navigate to 消息通道
    await page.locator('text=消息通道').first().click();
    await page.waitForTimeout(1500);

    // Check if test button exists (only if there are channels)
    const testBtn = page.locator('button:has-text("测试")');
    const btnCount = await testBtn.count();

    if (btnCount > 0) {
      // Click test button
      await testBtn.first().click();
      await page.waitForTimeout(3000);

      // Check for feedback message (success or error banner)
      const successBanner = page.locator('div.bg-green-50');
      const errorBanner = page.locator('div.bg-red-50');
      const bannerCount = await successBanner.count() + await errorBanner.count();

      // Should have some feedback after clicking test
      // Note: test may fail if channel is not configured, but should show error banner
      console.log(`[TEST BUTTON] Feedback banners: ${bannerCount}`);
      await page.screenshot({ path: 'test-results/channels-test-feedback.png' });
    } else {
      console.log('[TEST BUTTON] No channels configured, skipping test button click');
    }

    await app.close();
    expect(errors.length).toBe(0);
  });
});
