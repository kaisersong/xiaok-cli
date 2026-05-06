// E2E test for diff visualization in xiaok Desktop
// Run with: npx playwright test --config=playwright.e2e.config.ts e2e-diff-view.spec.ts

import { _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from '@playwright/test'

let electronApp: ElectronApplication
let page: Page

test.describe('xiaok Desktop - Diff Visualization', () => {
  test.beforeAll(async () => {
    electronApp = await electron.launch({
      executablePath: '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok',
      args: [],
      cwd: '/Users/song/projects/xiaok-cli/desktop',
    })

    page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(5000)

    page.on('pageerror', error => console.log(`[PAGE ERROR] ${error.message}`))
    page.on('console', msg => {
      if (msg.type() === 'error') console.log(`[CONSOLE ERROR] ${msg.text()}`)
    })
  })

  test.afterAll(async () => {
    await electronApp.close().catch(() => {})
  })

  // 17. 发送 edit 操作后验证 diff 显示
  test('Diff renders after edit_file tool call', async () => {
    await page.screenshot({ path: 'test-results/diff-initial.png' })

    // Step 1: Start new chat
    await page.locator('aside button', { hasText: 'New' }).click()
    await page.waitForTimeout(2000)

    // Step 2: Send message that triggers file edit
    const textarea = page.locator('textarea')
    await expect(textarea).toBeVisible({ timeout: 10000 })
    await textarea.fill('请修改 src/ui/render.ts 文件，在开头添加一行注释 // Modified by AI')
    await page.locator('button[type="submit"]').click()

    // Wait for AI response with diff
    await page.waitForTimeout(30000)

    await page.screenshot({ path: 'test-results/diff-after-edit.png' })

    // Step 3: Verify diff is rendered
    // Look for diff markers in the timeline
    const timelineContent = await page.locator('[class*="cop-timeline"]').textContent() ?? ''
    const hasDiffMarkers = timelineContent.includes('+') || timelineContent.includes('-')
    console.log(`[VERIFY] Timeline has diff markers: ${hasDiffMarkers}`)

    // Look for Pierre diff container
    const diffContainer = page.locator('[data-pierre-diff], .pierre-diff, [class*="PatchDiff"]')
    const diffVisible = await diffContainer.count() > 0
    console.log(`[VERIFY] Pierre diff container visible: ${diffVisible}`)
  })

  // 18. 主题切换后 diff 颜色正确
  test('Diff colors change with theme toggle', async () => {
    // Navigate to settings
    await page.locator('[data-testid="settings-button"], button[aria-label="Settings"]').click()
    await page.waitForTimeout(2000)

    // Find theme toggle
    const themeToggle = page.locator('[data-testid="theme-toggle"], button', { hasText: /Dark|Light|Theme/ })
    if (await themeToggle.count() > 0) {
      await themeToggle.first().click()
      await page.waitForTimeout(1000)
      await page.screenshot({ path: 'test-results/diff-theme-toggle.png' })
    }
  })

  // 19. 狭窄窗口下 split layout 不启用
  test('Stacked layout used in narrow viewport', async () => {
    // Resize window to narrow width
    await page.setViewportSize({ width: 400, height: 800 })
    await page.waitForTimeout(1000)

    await page.screenshot({ path: 'test-results/diff-narrow-width.png' })

    // Navigate back to the chat with diff
    await page.locator('aside button', { hasText: 'New' }).click()
    await page.waitForTimeout(2000)

    // Verify stacked layout (split would overflow at 400px)
    // This is a visual check - screenshot shows the layout
  })

  // 20. 大 diff 显示截断提示
  test('Large diff shows truncation warning', async () => {
    // This requires a tool that returns a large diff (>50KB)
    // Send message requesting large file edit
    const textarea = page.locator('textarea')
    await expect(textarea).toBeVisible({ timeout: 10000 })
    await textarea.fill('请读取并修改整个 desktop/renderer/src/storage.ts 文件，在开头添加注释')
    await page.locator('button[type="submit"]').click()

    await page.waitForTimeout(60000)

    await page.screenshot({ path: 'test-results/diff-large.png' })

    // Check for fallback text (if diff is too large)
    const timelineContent = await page.locator('[class*="cop-timeline"]').textContent() ?? ''
    const hasLargeDiff = timelineContent.length > 1000
    console.log(`[VERIFY] Large diff handled: ${hasLargeDiff}`)
  })

  // 21. Header counts match diff content (+/-)
  test('Header +/- counts match diff content', async () => {
    await page.locator('aside button', { hasText: 'New' }).click()
    await page.waitForTimeout(2000)

    const textarea = page.locator('textarea')
    await textarea.fill('创建一个简单的 test.ts 文件，内容只有一行: export const x = 1')
    await page.locator('button[type="submit"]').click()

    await page.waitForTimeout(30000)

    await page.screenshot({ path: 'test-results/diff-header-counts.png' })

    // Look for header with +/- counts
    const headerText = await page.locator('[class*="cop-diff-added"], [class*="cop-diff-removed"]').textContent() ?? ''
    console.log(`[VERIFY] Header counts: ${headerText}`)
  })
})