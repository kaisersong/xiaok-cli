// Quick E2E: debug generated files rendering
import { _electron as electron } from '@playwright/test';

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('[E2E] Starting...\n');

  const app = await electron.launch({
    executablePath: '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok',
  });

  const page = app.windows()[0];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('generatedFiles')) console.log(`[CONSOLE] ${text}`);
  });

  await sleep(3000);

  // Create task
  await page.locator('aside button', { hasText: 'New task' }).click();
  await sleep(1500);

  const textarea = page.locator('textarea');
  await textarea.fill('在 /Users/song/Downloads 创建 xiaok-e2e.md 文件，内容为 test');
  await page.locator('button[type="submit"]').click();
  await sleep(1000);

  // Wait for completion
  console.log('[E2E] Waiting for task...');
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const hasResult = await page.locator('text=Result').isVisible().catch(() => false);
    if (hasResult) {
      console.log(`[E2E] Result card appeared at ${i}s`);
      break;
    }
  }
  await sleep(2000);

  // Debug: find all clickable elements with accent color
  const allButtons = await page.locator('button.cursor-pointer').all();
  console.log(`\n[E2E] Found ${allButtons.length} cursor-pointer buttons`);

  // Get text of all accent-colored buttons
  const accentButtons = page.locator('button.text-\\\\[var\\\\(--c-accent)\\\\]');
  const accentCount = await accentButtons.count().catch(() => 0);
  console.log(`[E2E] Accent-colored buttons: ${accentCount}`);

  // Check the card element
  const cardVisible = await page.locator('[data-testid="generated-files-list"]').isVisible().catch(() => false);
  console.log(`[E2E] generated-files-list visible: ${cardVisible}`);

  // Get full page text
  const pageText = await page.locator('body').textContent().catch(() => '');
  const hasFileName = pageText.includes('xiaok-e2e.md');
  console.log(`[E2E] Page text contains "xiaok-e2e.md": ${hasFileName}`);

  // Screenshot
  await page.screenshot({ path: '/Users/song/projects/xiaok-cli/desktop/test-results/e2e-debug2.png', fullPage: true });
  console.log('[E2E] Screenshot saved');

  // Dump the result card HTML
  const resultCard = page.locator('div.rounded-xl').first();
  const cardHtml = await resultCard.innerHTML().catch(() => 'N/A');
  console.log('\n--- RESULT CARD HTML ---');
  console.log(cardHtml.slice(0, 500));
  console.log('--- END ---');

  await app.close();
}

main().catch(e => { console.error(e); process.exit(1); });
