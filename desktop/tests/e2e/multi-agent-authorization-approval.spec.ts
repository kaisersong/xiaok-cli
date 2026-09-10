import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { assertOpenAIToolProtocol } from '../../../tests/support/openai-tool-protocol.js';
import type { MultiAgentApprovalView, MultiAgentGroupSnapshot } from '../../shared/multi-agent-types.js';

// Browser plugin is unavailable in this session. Reuse the repository's native
// Playwright Electron harness. This exercises the compiled factory and actual
// SQLite/CJS preload/renderer, not main.ts bootstrap, a packaged app or CUA.
// Chat/Goal UI currently use auto. Default approval tasks below are created by
// the real MAIN service API, which has permissionMode; public createTask does
// not expose that option. User decisions still go through the actual UI/IPC.
const desktop = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
type Scenario = 'plain' | 'child' | 'root-approval' | 'child-approval' | 'both-approval';
type RequestFact = { actor: 'root' | 'child'; round: number };
type Pending = NonNullable<MultiAgentGroupSnapshot['pendingApprovals']>[number];

async function fixture(scenario: Scenario) {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-desktop-authorization-electron-'));
  const workspace = join(root, 'workspace'); mkdirSync(workspace);
  const requests: RequestFact[] = [], providerErrors: string[] = [], pageErrors: string[] = [];
  const consoleErrors: string[] = [], milestones: Array<{ stage: string; at: number }> = [];
  const processEvidence: Array<{ pid?: number; mode: string; exitCode: number | null; signal: string | null; remainingOwnedPids: number[] }> = [];
  const rounds = { root: 0, child: 0 };
  const mark = (stage: string) => {
    milestones.push({ stage, at: Date.now() });
    writeFileSync(join(root, 'milestones.json'), JSON.stringify(milestones, null, 2));
  };
  const effect = (actor: 'root' | 'child') => join(workspace, `${actor}-approved.txt`);
  const content = (actor: 'root' | 'child') => `E3_${actor}_APPROVED_中文😀`;
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assertOpenAIToolProtocol(body.messages);
      const system = body.messages.filter((message: { role: string }) => message.role === 'system')
        .map((message: { content: string }) => message.content).join('\n');
      const actor = system.includes('Assigned Desktop agent:') ? 'child' : 'root';
      const round = ++rounds[actor]; requests.push({ actor, round });
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = (delta: unknown, finish: string | null = null) => response.write(`data: ${JSON.stringify({
        id: 'authorization-e3', object: 'chat.completion.chunk', created: 1, model: 'e2e-model',
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`);
      const tool = (name: string, input: unknown) => {
        expect(body.tools.some((entry: { function: { name: string } }) => entry.function.name === name)).toBe(true);
        const args = JSON.stringify(input), half = Math.ceil(args.length / 2);
        send({ tool_calls: [{ index: 0, id: `e3-${actor}-${round}`, type: 'function', function: { name, arguments: '' } }] });
        send({ tool_calls: [{ index: 0, function: { arguments: args.slice(0, half) } }] });
        send({ tool_calls: [{ index: 0, function: { arguments: args.slice(half) } }] }); send({}, 'tool_calls');
      };
      const needsChild = ['child', 'child-approval', 'both-approval'].includes(scenario);
      const writeRound = actor === 'root' && needsChild ? 2 : 1;
      const needsApproval = scenario === 'both-approval' || scenario === `${actor}-approval`;
      if (actor === 'root' && needsChild && round === 1) {
        tool('spawn_agent', { task_name: 'approval_child', message: 'E3 isolated verification task.', fork_context: false });
      } else if (needsApproval && round === writeRound) {
        tool('write', { file_path: effect(actor), content: content(actor) });
      } else {
        send({ content: `E3_${actor}_DONE. The requested isolated verification has finished; no further action is required.` }); send({}, 'stop');
      }
      response.end('data: [DONE]\n\n');
    } catch (error) {
      providerErrors.push(String(error)); if (!response.headersSent) response.writeHead(400); response.end(String(error));
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const launchOptions = { args: [join(desktop, 'tests/e2e/fixtures/multi-agent-electron-main.mjs')], env: {
    ...process.env, NODE_ENV: 'test', XIAOK_CONFIG_DIR: join(root, 'config'), XIAOK_E2E_USER_DATA: join(root, 'profile'),
    XIAOK_MULTI_AGENT_E2E_ROOT: root, XIAOK_MULTI_AGENT_E2E_PROVIDER: `http://127.0.0.1:${address.port}/v1`,
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  } };
  let app: ElectronApplication | undefined, page: Page;
  const observePage = async (next: Page) => {
    page = next; page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).not.toBeEmpty();
    expect(page.url()).toContain('dist/renderer/index.html');
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    // Test-only read observation: retain the actual entry state at native click
    // capture, before React's toggle handler. No state or event is rewritten.
    await page.evaluate(() => {
      document.addEventListener('click', event => {
        const element = event.target instanceof Element ? event.target.closest('.chat-right-entry') : null;
        if (element) console.info('E3_SURFACE_NATIVE_CLICK', JSON.stringify({ expanded: element.getAttribute('aria-expanded'),
          panelHidden: document.querySelector<HTMLElement>('[data-testid="chat-right-panel"]')?.hidden, at: performance.now() }));
      }, true);
    });
    page.on('console', message => { if (message.text().startsWith('E3_SURFACE_NATIVE_CLICK')) console.log(message.text()); });
  };
  const launch = async () => { app = await electron.launch(launchOptions); await observePage(await app.firstWindow()); mark('app-launched'); };
  const stop = async (mode: 'crash' | 'cleanup') => {
    const current = app; if (!current) return;
    const child = current.process();
    const ownedPids = await current.evaluate(({ app: mainApp }) => mainApp.getAppMetrics().map(metric => metric.pid)).catch(() => [child.pid!]);
    const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve()
      : new Promise<void>(resolve => child.once('exit', () => resolve()));
    // No race is treated as physical cleanup. The bound is a test-owned kill
    // fallback; return only after the real process exit notification arrives.
    let forced = mode === 'crash';
    const timer = setTimeout(() => { forced = true; child.kill('SIGKILL'); }, 8_000);
    let exitDeadline: ReturnType<typeof setTimeout> | undefined;
    try {
      if (mode === 'crash') child.kill('SIGKILL');
      else void current.close().catch(() => {});
      await Promise.race([exited, new Promise<never>((_resolve, reject) => {
        exitDeadline = setTimeout(() => reject(new Error('test-owned Electron exit remains unconfirmed after SIGKILL')), 15_000);
      })]);
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      const remainingOwnedPids = () => ownedPids.filter(pid => { try { process.kill(pid, 0); return true; } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error;
      } });
      // This is a physical read-only check of the exact test app's metrics,
      // not a general process tree manager. Never kill a possibly reused PID.
      try { await expect.poll(remainingOwnedPids, { timeout: 5_000 }).toEqual([]); }
      finally { processEvidence.push({ pid: child.pid, mode: forced ? `${mode}-forced` : mode, exitCode: child.exitCode, signal: child.signalCode, remainingOwnedPids: remainingOwnedPids() }); }
      app = undefined; mark(`${mode}-physical-exit`);
    } finally { clearTimeout(timer); clearTimeout(exitDeadline); }
  };
  const snapshot = (threadId: string, groupId?: string) => page.evaluate(input => window.xiaokDesktop.getMultiAgentSnapshot(input), { threadId, ...(groupId ? { groupId } : {}) });
  const authorization = () => page.evaluate(() => window.xiaokDesktop.getLocalExecutionAuthorization({}));
  const navigate = async (threadId: string) => {
    await page.evaluate(id => { location.hash = `#/t/${id}`; }, threadId);
    await expect(page.locator('.chat-right-main textarea')).toBeVisible();
  };
  const thread = async (id: string) => {
    // Seed only the normal renderer thread index. Never manufacture main task,
    // actor, approval, receipt, core snapshot or SQLite business records.
    await page.evaluate(async threadId => {
      const request = indexedDB.open('xiaok-desktop', 1);
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('threads')) request.result.createObjectStore('threads', { keyPath: 'id' }); };
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const tx = db.transaction('threads', 'readwrite');
      tx.objectStore('threads').put({ id: threadId, title: 'Authorization E3', status: 'idle', mode: 'chat', createdAt: Date.now(), updatedAt: Date.now(), taskIds: [], currentTaskId: null });
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
    }, id); await navigate(id);
  };
  const openSettings = async () => {
    // Existing Sidebar settings button has no accessible name. Select its
    // actual Bolt icon; do not add a production probe or click a fake settings UI.
    await page.locator('aside button').filter({ has: page.locator('svg.lucide-bolt') }).click();
    const card = page.getByRole('region', { name: '允许聊天与 Goal 执行任务', exact: true });
    await expect(card).toBeVisible(); await expect(card).toContainText(workspace); return card;
  };
  const changeAuthorization = async (allowed: boolean) => {
    const before = await authorization(); const card = await openSettings();
    await card.getByRole('button', { name: allowed ? '重新允许执行' : '暂停执行任务', exact: true }).click();
    await card.getByRole('button', { name: allowed ? '确认允许' : '确认暂停', exact: true }).click();
    await expect.poll(authorization).toMatchObject({ permissionRevision: before.permissionRevision + 1, executionAllowed: allowed, persistenceState: 'confirmed', bootId: before.bootId });
    await expect(card).toContainText(allowed ? '已允许执行任务' : '任务执行已暂停');
    await page.screenshot({ path: join(root, allowed ? 'settings-allowed.png' : 'settings-denied.png') });
    await page.getByRole('button', { name: '返回', exact: true }).click(); mark(allowed ? 'regranted' : 'denied');
  };
  const surface = async (beforeWait?: () => Promise<void>) => {
    const panel = page.getByTestId('chat-right-panel');
    // The caller owns the actual opening action: child facts auto-open, the
    // history path uses its Canvas shortcut, and root-only explicitly clicks.
    // An instantaneous visibility sample is not authority to toggle later.
    // H1 controls only the awaited observation gap; never production state.
    await beforeWait?.();
    await expect(panel).toBeVisible();
    await panel.locator('[role="tab"][id$="agents-tab"]').click();
    await expect(panel).toBeVisible(); await expect(panel).toHaveCount(1);
    await expect(page.getByRole('dialog', { name: 'SubAgent', exact: true })).toHaveCount(0);
    return panel;
  };
  const startDefault = (threadId: string) => app!.evaluate(async (_electron, id) => {
    return (globalThis as any).multiAgentE2E.getServices().createTask({ prompt: 'E3 isolated verification task.', materials: [], permissionMode: 'default', context: { threadId: id } });
  }, threadId) as Promise<{ taskId: string }>;
  const recover = (taskId: string) => app!.evaluate(async (_electron, id) =>
    (globalThis as any).multiAgentE2E.getServices().recoverTask(id), taskId) as Promise<{ snapshot: { status: string } }>;
  const approval = (threadId: string, groupId: string, pending: Pending, inputOffset?: number) => page.evaluate(input =>
    window.xiaokDesktop.getMultiAgentApproval(input), { threadId, groupId, approvalId: pending.approvalId, ...(inputOffset === undefined ? {} : { inputOffset }) });
  const audit = (command: 'approval_request' | 'approval_decision' = 'approval_request') => {
    const db = new DatabaseSync(join(root, 'data', 'multi-agent', 'groups.sqlite'), { readOnly: true });
    try {
      // Read actual rows written by production; never use the test process to
      // create or finalize an approval or to alter the execution authorization.
      return db.prepare("SELECT data_json FROM operations WHERE json_extract(data_json,'$.command')=? ORDER BY operation_id").all(command)
        .map(row => JSON.parse(String(row.data_json)));
    } finally { db.close(); }
  };
  const dispose = async () => {
    try {
      if (page && !page.isClosed()) await page.screenshot({ path: join(root, 'final-window.png'), timeout: 3_000 }).catch(() => {});
      await stop('cleanup');
    } finally {
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
      writeFileSync(join(root, 'evidence.json'), JSON.stringify({ scenario, requests, providerErrors, pageErrors, consoleErrors, processEvidence, milestones }, null, 2));
      console.log(`MULTI_AGENT_AUTHORIZATION_E3_EVIDENCE=${root}`);
    }
  };
  try { await launch(); } catch (error) { await dispose(); throw error; }
  return { root, workspace, effect, content, requests, providerErrors, pageErrors, consoleErrors, mark, launch, stop, dispose,
    get page() { return page; }, get app() { return app!; }, thread, navigate, snapshot, authorization, changeAuthorization, surface,
    startDefault, recover, approval, audit,
    reconnect: async (threadId: string) => {
      const beforePid = app!.process().pid, beforeBoot = (await authorization()).bootId;
      const opened = app!.waitForEvent('window'); await app!.evaluate(async () => { await (globalThis as any).multiAgentE2E.reopen(); });
      await observePage(await opened); await navigate(threadId);
      expect(app!.process().pid).toBe(beforePid); expect((await authorization()).bootId).toBe(beforeBoot); mark('same-process-window-reconnected');
    },
  };
}

test('E3a: real Settings denies Chat and Goal without losing drafts; explicit regrant permits a new user task', async () => {
  const f = await fixture('plain');
  try {
    await f.thread('e3-denied-chat');
    expect((await f.authorization()).executionAllowed).toBe(true);
    await expect(f.page.locator('.chat-right-entry')).toHaveCount(0);
    await f.changeAuthorization(false);
    const draft = 'E3_DENIED_CHAT_DRAFT 中文😀';
    const composer = f.page.locator('.chat-right-main textarea'); await composer.fill(draft); await composer.press('Enter');
    await expect(composer).toHaveValue(draft); expect(f.requests).toHaveLength(0);
    await expect(f.page.getByText('permission_revoked', { exact: false })).toBeVisible();
    await f.page.screenshot({ path: join(f.root, 'chat-draft-denied.png') });
    await f.page.evaluate(() => { location.hash = '#/'; });
    await f.page.getByTestId('quick-prompts').getByRole('button', { name: /Goal/ }).click();
    const objective = f.page.getByRole('textbox', { name: '目标', exact: true });
    await objective.fill('E3_DENIED_GOAL_DRAFT 中文😀');
    await f.page.getByRole('textbox', { name: '完成条件', exact: true }).fill('Return an answer only.');
    await f.page.getByRole('button', { name: '确认创建', exact: true }).click();
    await expect(objective).toHaveValue('E3_DENIED_GOAL_DRAFT 中文😀');
    await expect(f.page.getByRole('textbox', { name: '完成条件', exact: true })).toHaveValue('Return an answer only.');
    await expect(f.page.locator('.goal-panel [role="alert"]')).toBeVisible(); expect(f.requests).toHaveLength(0);
    await f.page.screenshot({ path: join(f.root, 'goal-draft-denied.png') });
    await f.changeAuthorization(true);
    await f.thread('e3-new-chat');
    const fresh = f.page.locator('.chat-right-main textarea'); await fresh.fill('E3 new user task after explicit grant.'); await fresh.press('Enter');
    await expect.poll(async () => (await f.snapshot('e3-new-chat')).root?.status).toBe('completed');
    expect(f.requests.length).toBeGreaterThan(0); expect(f.providerErrors).toEqual([]); expect(f.pageErrors).toEqual([]);
    f.mark('denied-drafts-and-new-grant-verified');
  } finally { await f.dispose(); }
});

test('H1: a pending real Canvas open must not be toggled closed by the surface observer', async () => {
  const f = await fixture('child');
  try {
    await f.thread('e3-harness-pending-canvas');
    await f.startDefault('e3-harness-pending-canvas');
    await expect.poll(async () => (await f.snapshot('e3-harness-pending-canvas')).agents.find(agent => agent.parentId !== null)?.status).toBe('completed');
    const panel = f.page.getByTestId('chat-right-panel');
    await expect(panel).toBeVisible();
    await f.page.locator('.chat-right-entry').click();
    await expect(panel).toBeHidden();
    const requests = f.requests.length;
    await f.surface(async () => {
      // A controlled awaited observation gap, not a fake visibility value:
      // use the actual shortcut and wait for the actual compiled React effect.
      await f.page.keyboard.press('Control+Shift+C');
      await expect(panel).toBeVisible();
    });
    await expect(panel).toBeVisible();
    expect(f.requests).toHaveLength(requests);
    expect(f.pageErrors).toEqual([]);
  } finally { await f.dispose(); }
});

test('E3b: regrant never revives a revoked group; only the existing confirmed new-group control creates its successor', async () => {
  const f = await fixture('child'); const threadId = 'e3-regrant-group';
  try {
    await f.thread(threadId); const composer = f.page.locator('.chat-right-main textarea');
    await composer.fill('E3 create one child.'); await composer.press('Enter');
    await expect.poll(async () => (await f.snapshot(threadId)).agents.find(agent => agent.taskName === 'approval_child')?.status).toBe('completed');
    await expect.poll(async () => (await f.snapshot(threadId)).root?.status).toBe('completed');
    const before = await f.snapshot(threadId), oldGroup = before.group!;
    const requests = f.requests.length;
    await f.changeAuthorization(false); await f.changeAuthorization(true);
    const revoked = await f.snapshot(threadId);
    expect(revoked.group?.groupId).toBe(oldGroup.groupId);
    expect(revoked.group?.mutationBlockedReason).toBe('permission_revoked'); expect(f.requests).toHaveLength(requests);
    await composer.fill('E3_REGRANT_STILL_NEEDS_RESET'); await composer.press('Enter');
    await expect(composer).toHaveValue('E3_REGRANT_STILL_NEEDS_RESET'); expect(f.requests).toHaveLength(requests);
    const panel = await f.surface(); await panel.getByRole('button', { name: '新建执行组', exact: true }).click();
    await panel.getByRole('button', { name: '确认新建执行组', exact: true }).click();
    await expect.poll(async () => (await f.snapshot(threadId)).group?.groupId).not.toBe(oldGroup.groupId);
    const next = await f.snapshot(threadId); expect(next.group?.permissionRevision).toBe((await f.authorization()).permissionRevision);
    expect((await f.snapshot(threadId, oldGroup.groupId)).group?.mutationBlockedReason).toBe('permission_revoked');
    await composer.fill('E3 explicit new-group user task.'); await composer.press('Enter');
    await expect.poll(async () => (await f.snapshot(threadId)).root?.status).toBe('completed');
    expect(f.requests.length).toBeGreaterThan(requests); expect(f.providerErrors).toEqual([]); expect(f.pageErrors).toEqual([]);
    await f.page.screenshot({ path: join(f.root, 'regrant-new-group.png') }); f.mark('explicit-new-group-verified');
  } finally { await f.dispose(); }
});

for (const actor of ['root', 'child'] as const) for (const decision of ['approve', 'deny'] as const) {
  test(`E3c: ${actor} default main task has one real ${decision} decision in the existing surface${decision === 'approve' ? ' after window reconnect' : ''}`, async () => {
    const f = await fixture(`${actor}-approval`); const threadId = `e3-${actor}-${decision}`;
    try {
      await f.thread(threadId); const task = await f.startDefault(threadId);
      await expect.poll(async () => (await f.snapshot(threadId)).pendingApprovalCount).toBe(1);
      const first = await f.snapshot(threadId), groupId = first.group!.groupId, pending = first.pendingApprovals![0];
      expect((pending.agentId === first.root?.id)).toBe(actor === 'root'); expect(existsSync(f.effect(actor))).toBe(false);
      const metadata = await f.approval(threadId, groupId, pending);
      expect(metadata).toMatchObject({ agentId: pending.agentId, turnId: pending.turnId, toolName: 'write', cwd: f.workspace, canDecide: true, status: 'pending' });
      if (actor === 'root') {
        // The shared collapsed entry now exposes the real pending count.
        // Keep an exact accessible-name assertion rather than ignoring it.
        const entry = f.page.getByRole('button', { name: '执行状态 · 1 项待审批', exact: true });
        await expect(entry).toBeVisible();
        await expect(entry).toHaveAttribute('aria-expanded', 'false');
        await expect(f.page.getByTestId('chat-right-panel')).toHaveCount(1);
      }
      if (decision === 'approve') {
        const requestCount = f.requests.length; await f.reconnect(threadId);
        expect((await f.snapshot(threadId)).pendingApprovals?.map(item => item.approvalId)).toEqual([pending.approvalId]);
        expect(f.requests).toHaveLength(requestCount); expect(existsSync(f.effect(actor))).toBe(false);
      }
      if (actor === 'root') {
        const entry = f.page.locator('.chat-right-entry');
        await expect(entry).toHaveAttribute('aria-expanded', 'false');
        await entry.click();
      }
      const panel = await f.surface(); const card = panel.getByRole('region', { name: /工具审批/ });
      await expect(card).toHaveCount(1); await expect(card).toContainText(pending.agentId); await expect(card).toContainText(pending.turnId);
      await expect(card).toContainText(f.workspace); await expect(card).toContainText(metadata.inputSha256);
      await card.getByRole('button', { name: '查看本次参数', exact: true }).click();
      await expect(card).toContainText(f.content(actor)); expect(existsSync(f.effect(actor))).toBe(false);
      if (actor === 'root') {
        // Real normal root approval: no interrupt/close action has occurred.
        // The old UI incorrectly treated non-resumable occupancy as a stop.
        const current = (await f.snapshot(threadId)).root!;
        expect(current.executionActive).toBe(true);
        expect(['requested', 'stalled']).not.toContain(current.stopState);
        const detail = panel.getByRole('region', { name: '主任务', exact: true });
        await expect(detail.getByText('执行资源占用中', { exact: true })).toBeVisible();
        await expect(detail.getByText('停止请求已发出', { exact: true })).toHaveCount(0);
        writeFileSync(join(f.root, 'root-resource-status.json'), JSON.stringify({
          agentId: current.id, executionActive: current.executionActive, stopState: current.stopState,
          runtimeResident: current.runtimeResident, sessionResident: current.sessionResident,
          resourcesReleased: current.resourcesReleased, resumable: current.resumable,
        }, null, 2));
      }
      await f.page.screenshot({ path: join(f.root, 'pending-input.png') });
      await card.getByRole('button', { name: decision === 'approve' ? '仅批准本次' : '拒绝本次', exact: true }).click();
      await expect.poll(async () => (await f.approval(threadId, groupId, pending)).status).toBe(decision === 'approve' ? 'approved' : 'denied');
      await expect.poll(async () => (await f.snapshot(threadId)).pendingApprovalCount).toBe(0);
      if (actor === 'child') await expect.poll(async () => (await f.snapshot(threadId)).agents.find(agent => agent.id === pending.agentId)?.status).toBe('completed');
      await expect.poll(async () => (await f.recover(task.taskId)).snapshot.status).toBe('completed');
      expect(existsSync(f.effect(actor))).toBe(decision === 'approve');
      if (decision === 'approve') expect(readFileSync(f.effect(actor), 'utf8')).toBe(f.content(actor));
      const audit = f.audit(); expect(audit).toHaveLength(1);
      expect(audit[0].result.approval).toMatchObject({ approvalId: pending.approvalId, status: decision === 'approve' ? 'approved' : 'denied', persistenceState: 'confirmed' });
      const decisions = f.audit('approval_decision'); expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({ applyState: 'applied', groupId, result: { state: 'applied', groupId, targetAgentId: pending.agentId } });
      writeFileSync(join(f.root, 'approval-audit.json'), JSON.stringify({ pending, metadata, requests: audit, decisions }, null, 2));
      expect(JSON.stringify(audit)).not.toContain(f.content(actor));
      expect((await f.approval(threadId, groupId, pending, 0)).inputPage).toBeUndefined();
      expect(f.providerErrors).toEqual([]); expect(f.pageErrors).toEqual([]); f.mark('ui-decision-real-effect-and-durable-audit-verified');
    } finally { await f.dispose(); }
  });
}

test('E3d: killing the isolated process with real root and child pending never restores old waiters or effects', async () => {
  const f = await fixture('both-approval'); const threadId = 'e3-crash-pending';
  try {
    await f.thread(threadId); await f.startDefault(threadId);
    await expect.poll(async () => (await f.snapshot(threadId)).pendingApprovalCount).toBe(2);
    const before = await f.snapshot(threadId), groupId = before.group!.groupId, pending = before.pendingApprovals!;
    expect(new Set(pending.map(item => item.agentId)).size).toBe(2);
    expect(f.audit().map(row => row.result.approval.status)).toEqual(['pending', 'pending']);
    await f.surface(); await expect(f.page.getByRole('region', { name: /工具审批/ })).toHaveCount(2);
    await f.page.screenshot({ path: join(f.root, 'before-crash-two-pending.png') });
    const requestCount = f.requests.length, oldPid = f.app.process().pid, oldBoot = (await f.authorization()).bootId;
    await f.stop('crash'); await f.launch(); expect(f.app.process().pid).not.toBe(oldPid);
    expect((await f.authorization()).bootId).not.toBe(oldBoot); await f.navigate(threadId);
    const restored = await f.snapshot(threadId, groupId);
    expect(restored.group?.historicalOnly).toBe(true); expect(restored.pendingApprovalCount).toBe(0);
    expect((await f.snapshot(threadId)).group).toBeNull();
    for (const item of pending) {
      const metadata: MultiAgentApprovalView = await f.approval(threadId, groupId, item, 0);
      expect(metadata).toMatchObject({ status: 'invalidated', reason: 'restart', canDecide: false }); expect(metadata.inputPage).toBeUndefined();
      // Negative semantic IPC, not a decision shortcut: a stale user request
      // cannot recreate a waiter merely because its scalar IDs remain known.
      const denied = await f.page.evaluate(async input => {
        try { await window.xiaokDesktop.decideMultiAgentApproval(input); return false; } catch { return true; }
      }, { threadId, groupId, approvalId: item.approvalId, operationId: `e3-stale-${item.approvalId}`, decision: 'approve' as const });
      expect(denied).toBe(true);
    }
    await expect(f.page.locator('.chat-right-main textarea')).toBeVisible();
    await expect(f.page.locator('.chat-right-entry')).toHaveCount(0);
    await f.page.keyboard.press('Control+Shift+C');
    await f.surface(); await f.page.getByRole('button', { name: '执行组历史', exact: true }).click();
    await f.page.locator('.multi-agent-history button').filter({ hasText: groupId.slice(0, 8) }).click();
    await expect(f.page.getByText('历史记录，只读', { exact: true })).toBeVisible();
    await expect(f.page.getByRole('button', { name: '仅批准本次', exact: true })).toHaveCount(0);
    expect(f.audit().map(row => row.result.approval.status)).toEqual(['invalidated', 'invalidated']);
    expect(f.audit('approval_decision')).toHaveLength(0);
    writeFileSync(join(f.root, 'restart-audit.json'), JSON.stringify({ oldPid, newPid: f.app.process().pid, oldBoot,
      newBoot: (await f.authorization()).bootId, before, restored, approvals: f.audit() }, null, 2));
    expect(f.requests).toHaveLength(requestCount); expect(existsSync(f.effect('root'))).toBe(false); expect(existsSync(f.effect('child'))).toBe(false);
    expect(f.providerErrors).toEqual([]); expect(f.pageErrors).toEqual([]);
    await f.page.screenshot({ path: join(f.root, 'restarted-readonly-approvals.png') }); f.mark('cross-process-no-waiter-no-effect-verified');
  } finally { await f.dispose(); }
});
