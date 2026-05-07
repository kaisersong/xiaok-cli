import { test } from '@playwright/test';
import { _electron as electron } from 'playwright';
const APP = '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok';
test('verify actual UI', async () => {
  const app = await electron.launch({ executablePath: APP });
  const page = await app.firstWindow();
  await page.waitForTimeout(6000);
  
  // 1. 截图初始状态
  await page.screenshot({ path: '/tmp/ui-initial.png', fullPage: false });
  
  // 2. 点击收起按钮
  const collapseBtn = page.locator('button[title="收起侧边栏"]');
  if (await collapseBtn.isVisible()) {
    const box = await collapseBtn.boundingBox();
    console.log(`[COLLAPSE] position: top=${box?.y}, left=${box?.x}, size=${box?.width}x${box?.height}`);
    await collapseBtn.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: '/tmp/ui-collapsed.png' });
    
    // 3. 检查展开按钮位置
    const expandBtn = page.locator('button[title="展开侧边栏"]');
    if (await expandBtn.isVisible()) {
      const expBox = await expandBtn.boundingBox();
      console.log(`[EXPAND] position: top=${expBox?.y}, left=${expBox?.x}, size=${expBox?.width}x${expBox?.height}`);
    }
  }
  
  // 4. 点第一个thread看内容
  const threads = page.locator('[data-testid^="thread-item-"]');
  await threads.first().click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/ui-thread1.png' });
  
  // 5. 点第二个thread看是否串
  await threads.nth(1).click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/ui-thread2.png' });
  
  // 6. 进入设置看技能统计
  const settingsBtn = page.locator('aside button').last();
  await settingsBtn.click();
  await page.waitForTimeout(2000);
  await page.locator('text=技能管理').first().click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/ui-skills.png' });
  
  const body = await page.locator('body').innerText();
  console.log('[SKILLS] body contains:', body.slice(0, 800));
  
  await app.close();
});
