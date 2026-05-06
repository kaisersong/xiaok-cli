import { _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from '@playwright/test'

let electronApp: ElectronApplication
let page: Page

test.describe('Diff Visualization E2E', () => {
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
      const text = msg.text()
      if (msg.type() === 'error' || text.includes('[DIFF-E2E]')) {
        console.log(`[CONSOLE ${msg.type().toUpperCase()}] ${text}`)
      }
    })

    console.log(`[DIFF-E2E] Page URL: ${page.url()}`)
  })

  test.afterAll(async () => {
    await page.screenshot({ path: 'test-results/diff-e2e-final.png' }).catch(() => {})
    await electronApp.close().catch(() => {})
  })

  test('Edit tool shows diff visualization in ToolStepsMessage', async () => {
    test.setTimeout(180000)
    await page.screenshot({ path: 'test-results/diff-e2e-01-initial.png' })

    // Step 1: Start new chat
    console.log('[DIFF-E2E] Step 1: Start new chat')
    const newBtn = page.locator('aside button', { hasText: /New|新建/ })
    await expect(newBtn).toBeVisible({ timeout: 10000 })
    await newBtn.click()
    await page.waitForTimeout(2000)

    // Step 2: Send an edit request
    console.log('[DIFF-E2E] Step 2: Send edit request')
    const textarea = page.locator('textarea')
    await expect(textarea).toBeVisible({ timeout: 10000 })

    const marker = `diff-e2e-${Date.now()}`
    await textarea.fill(`用 edit 工具把 /Users/song/projects/xiaok-cli/desktop/renderer/src/styles/index.css 里的第一行 @import 'tailwindcss'; 替换成 @import 'tailwindcss'; /* ${marker} */。只用 edit 工具。`)

    const sendBtn = page.locator('button[type="submit"]')
    await sendBtn.first().click()
    await page.waitForTimeout(3000)
    await page.screenshot({ path: 'test-results/diff-e2e-02-sent.png' })

    // Step 3: Wait for edit completion
    console.log('[DIFF-E2E] Step 3: Wait for edit completion...')
    let editDetected = false

    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(3000)

      const check = await page.evaluate(() => {
        // Only check the main chat area, not the sidebar
        const mainEl = document.querySelector('main') || document.querySelector('[class*="chat"]')
        const chatText = mainEl ? mainEl.innerText : ''
        // Check if AI is still thinking/running
        const isRunning = chatText.includes('running') || chatText.includes('Thinking')
        // Detect edit tool completion — only when not running
        const hasStepComplete = !isRunning && chatText.includes('step completed')
        // Also check for final AI response (indicates task finished)
        const hasAssistantReply = chatText.includes('Result') || chatText.includes('完成')
        return { hasStepComplete, hasAssistantReply, isRunning, snippet: chatText.substring(0, 300) }
      })

      console.log(`[DIFF-E2E] Check ${i + 1}/30: ${JSON.stringify(check)}`)

      if ((check.hasStepComplete || check.hasAssistantReply) && !check.isRunning) {
        editDetected = true
        break
      }

      if (i % 8 === 7) {
        await page.screenshot({ path: `test-results/diff-e2e-progress-${i + 1}.png` }).catch(() => {})
      }
    }

    expect(editDetected).toBe(true)
    console.log('[DIFF-E2E] Edit detected, expanding step...')

    // Step 4: Expand the tool steps group and the edit step row
    // Click the "N step(s) completed" button to expand
    const groupBtn = page.locator('button').filter({ hasText: /step.*completed/ })
    if (await groupBtn.count() > 0) {
      // Check if already expanded (shows ∨) or collapsed (shows >)
      const groupText = await groupBtn.first().textContent()
      if (groupText?.includes('>')) {
        await groupBtn.first().click()
        await page.waitForTimeout(500)
      }
    }
    await page.screenshot({ path: 'test-results/diff-e2e-03-group-expanded.png' })

    // Click the edit step row to expand its response
    // The edit step button contains "edit" plus params
    const editStep = page.locator('button').filter({ hasText: /edit/ }).filter({ hasText: /file_path/ })
    if (await editStep.count() > 0) {
      await editStep.last().click()
      await page.waitForTimeout(1000)
    }
    await page.screenshot({ path: 'test-results/diff-e2e-04-step-expanded.png' })

    // Step 5: Check for DiffView / Pierre rendering
    await page.waitForTimeout(2000)

    const renderCheck = await page.evaluate(() => {
      const mainEl = document.querySelector('main') || document.querySelector('[class*="chat"]')
      const chatText = mainEl ? mainEl.innerText : document.body.innerText

      // Check for diffs-container (Pierre's custom element)
      const diffsContainers = document.querySelectorAll('diffs-container')
      if (diffsContainers.length > 0) {
        return { found: true, method: 'diffs-container', count: diffsContainers.length }
      }

      // Check for Shadow DOM with diff content (Pierre rendering)
      const allEls = document.querySelectorAll('*')
      for (const el of allEls) {
        if (el.shadowRoot) {
          const html = el.shadowRoot.innerHTML
          if (html.includes('deletion') || html.includes('addition') || html.includes('diff-content')) {
            return { found: true, method: 'shadow-dom', tag: el.tagName }
          }
        }
      }

      // Check for plain text diff (fallback)
      const hasDiff = chatText.includes('diff --git')
      const hasEditMsg = chatText.includes('已编辑')
      return { found: false, hasDiffText: hasDiff, hasEditMsg, snippet: chatText.substring(0, 500) }
    })

    console.log(`[DIFF-E2E] Render check: ${JSON.stringify(renderCheck)}`)
    await page.screenshot({ path: 'test-results/diff-e2e-05-final.png' })

    if (renderCheck.found) {
      console.log('[DIFF-E2E] PASS: Pierre diff visualization working!')
    } else if (renderCheck.hasDiffText) {
      console.log('[DIFF-E2E] PARTIAL: Diff text present but Pierre not rendered (fallback text mode)')
    } else {
      console.log('[DIFF-E2E] FAIL: No diff rendering detected')
    }

    expect(renderCheck.found || renderCheck.hasDiffText).toBe(true)
  })
})
