import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';

// Browser plugin not available. Actual built renderer/preload/main/SQLite in
// isolated Electron; a removed provenance row is the sole disclosure fault.
// No model execution or physical effect closure is qualified by this UI test.
test('a real Goal pause stays successful when its private details become unavailable', async ({}, info) => {
  const root = mkdtempSync(join(tmpdir(), 'continuity-goal-ui-'));
  mkdirSync(join(root, 'workspace'));
  let requests = 0, application: ElectronApplication | undefined, pid: number | undefined;
  const errors: string[] = [];
  const server = createServer((_request, response) => { requests++; response.writeHead(503); response.end('unexpected_model_execution'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    application = await electron.launch({ args: [join(process.cwd(), 'tests/e2e/fixtures/multi-agent-electron-main.mjs')], env: {
      ...process.env, NODE_ENV: 'test', XIAOK_CONFIG_DIR: join(root, 'config'), XIAOK_E2E_USER_DATA: join(root, 'profile'),
      XIAOK_MULTI_AGENT_E2E_ROOT: root, XIAOK_MULTI_AGENT_E2E_PROVIDER: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
      XIAOK_E2E_BACKGROUND: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    } });
    pid = application.process().pid;
    const page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.locator('textarea').first()).toBeVisible();
    await page.evaluate(() => localStorage.setItem('xiaok:locale', 'zh')); await page.reload();
    await expect(page.locator('textarea').first()).toBeVisible();
    const target = await page.evaluate(() => window.xiaokDesktop.createContextConversation({ operationId: crypto.randomUUID(), title: 'Goal control verification' }));
    await page.evaluate(id => { location.hash = `#/t/${id}`; }, target.id);
    // Controlled readiness-port contract, not a claim that a child was spawned.
    // The actual main coordinator, egress, IPC and renderer remain in use.
    await application.evaluate(() => {
      const service = (globalThis as any).multiAgentE2E.getServices().multiAgent.service;
      service.goalReadiness = () => 'waiting_children';
    });
    const created = await page.evaluate(threadId => window.xiaokDesktop.createGoal({ threadId,
      objective: 'GOAL_UI_PRIVATE_CANARY', expectedEvidenceKinds: ['answer'], turnLimit: 2 }), target.id);
    expect(created.goal.waitingReason).toBe('waiting_children');
    await page.reload();
    const userMessages = page.locator('[data-message-anchor]');
    await expect(userMessages).toHaveCount(1);
    await expect(userMessages.first()).toHaveText('GOAL_UI_PRIVATE_CANARY');
    await expect(userMessages.first()).not.toContainText('system_trigger');
    await expect(userMessages.first()).not.toContainText('goal_context');
    await page.screenshot({ path: info.outputPath('goal-public-input-restored.png') });
    const current = await page.evaluate(threadId => window.xiaokDesktop.getGoal(threadId), target.id);
    expect(current?.state.goalId).toBe(created.goal.state.goalId);
    writeFileSync(info.outputPath('before-panel.json'), JSON.stringify({ current, count: await page.locator('.goal-panel').count() }, null, 2));
    const entry = page.locator('.chat-right-entry');
    await expect(entry).toBeVisible();
    if (await entry.getAttribute('aria-expanded') === 'false') await entry.click();
    await page.getByTestId('chat-right-panel').getByRole('tab', { name: '任务', exact: true }).click();
    const panel = page.locator('.chat-right-panel .goal-panel');
    await expect(panel).toBeAttached();
    if (!await panel.getByText('GOAL_UI_PRIVATE_CANARY', { exact: true }).isVisible()) {
      await panel.getByRole('button', { name: '展开目标详情', exact: true }).click({ timeout: 5000 });
    }
    await expect(panel.getByText('GOAL_UI_PRIVATE_CANARY', { exact: true })).toBeVisible();
    expect(page.url()).toContain(target.id); expect(await page.title()).not.toBe('');
    const db = new DatabaseSync(join(root, 'data', 'goals', 'goals.sqlite'));
    try { db.prepare('delete from goal_user_input_sources where goal_id=?').run(created.goal.state.goalId); }
    finally { db.close(); }
    await panel.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(panel.getByRole('status')).toHaveText('已暂停');
    await expect(panel.getByText('目标详情当前不可用', { exact: true })).toBeVisible();
    await expect(panel.getByText('GOAL_UI_PRIVATE_CANARY', { exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: '恢复', exact: true })).toBeEnabled();
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('goal-paused-unavailable.png') });
    await page.setViewportSize({ width: 820, height: 780 });
    await expect(page.locator('.goal-panel [role="status"]').filter({ hasText: '已暂停' }).last()).toBeVisible();
    await page.screenshot({ path: info.outputPath('goal-paused-unavailable-narrow.png') });
    // Actual legacy owner files -> explicit main preview/claim -> real replay.
    // A claim proves exact archival display, never former physical execution.
    const legacyThread = crypto.randomUUID(), legacyTask = `task_archive_${crypto.randomUUID().replaceAll('-', '')}`;
    await application.evaluate(async (_electron, threadId) => {
      const main = (globalThis as any).multiAgentE2E.getServices(), agent = main.multiAgent;
      await agent.service.registerThreadWithOwnership({ threadId, profileId: agent.profileId,
        workspaceId: agent.workspaceId, cwd: agent.cwd }, 'user');
    }, legacyThread);
    await new FileTaskSnapshotStore(join(root, 'data', 'tasks')).save({ taskId: legacyTask, sessionId: 'legacy-archive-epoch',
      status: 'completed', prompt: 'CLAIMED_OLD_USER_REQUEST', materials: [], events: [], context: { threadId: legacyThread }, createdAt: 1, updatedAt: 2 });
    await page.evaluate(async ({ threadId, taskId }) => {
      const preview = await window.xiaokDesktop.previewLegacyContext({ operationId: crypto.randomUUID(), legacyThreadId: threadId, taskIds: [taskId] });
      await window.xiaokDesktop.claimLegacyContext({ operationId: crypto.randomUUID(), previewId: preview.previewId, expectedManifestHash: preview.manifestHash });
      location.hash = `#/t/${threadId}`;
    }, { threadId: legacyThread, taskId: legacyTask });
    await expect(page.locator('[data-message-anchor]')).toHaveCount(1);
    await expect(page.locator('[data-message-anchor]').first()).toHaveText('CLAIMED_OLD_USER_REQUEST');
    await page.screenshot({ path: info.outputPath('legacy-claimed-user-input-restored.png') });
    expect(requests).toBe(0); expect(errors).toEqual([]);
  } finally {
    const page = application?.windows()[0];
    if (page && !page.isClosed()) {
      try { writeFileSync(info.outputPath('body.txt'), await page.locator('body').innerText()); await page.screenshot({ path: info.outputPath('last-screen.png') }); } catch { /* Best-effort UI evidence before closing our own app. */ }
    }
    await application?.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    let reaped = pid === undefined;
    if (pid) { try { process.kill(pid, 0); } catch { reaped = true; } }
    try { writeFileSync(info.outputPath('electron.log'), readFileSync(join(root, 'electron.log'))); } catch { /* Preserve whichever startup evidence exists. */ }
    writeFileSync(info.outputPath('run.json'), JSON.stringify({ root, pid, reaped, requests, errors, browserFallback: 'Browser plugin not available' }, null, 2));
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    expect(reaped).toBe(true);
  }
});
