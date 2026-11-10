// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { FileTaskSnapshotStore, recoverTaskSnapshotSync } from '../../../src/runtime/task-host/snapshot-store.js';
import { expect, it, vi } from 'vitest';
const windows = vi.hoisted(() => ({ targets: [] as unknown[], beforeList: undefined as (() => void) | undefined }));
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/xiaok-goal-ipc-disclosure-test' },
  BrowserWindow: { getAllWindows: () => { windows.beforeList?.(); return windows.targets; }, fromWebContents: () => undefined },
  clipboard: { read: vi.fn() }, dialog: { showOpenDialog: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() } }));
import { registerDesktopIpc } from '../../electron/ipc.js';
import { createDesktopServices } from '../../electron/desktop-services.js';
import { DesktopGoalCoordinator } from '../../electron/desktop-goal-coordinator.js';
import { createGoalDisclosure } from '../../electron/context-continuity/goal-disclosure.js';
import { SqliteGoalStore } from '../../electron/goal-store-sqlite.js';
import { DesktopOwnedToolRegistry } from '../../electron/desktop-multi-agent-catalog-bridge.js';

it.each(['already-revoked', 'last-await', 'pause-control', 'cancel-control', 'ipc-get', 'ipc-sender', 'ipc-broadcast', 'ipc-private-window'] as const)('protects a real Task-derived settled Goal reason at %s disclosure', async mode => {
  const root = mkdtempSync(join(tmpdir(), 'continuity-goal-disclosure-'));
  let refId = '', registry: DesktopOwnedToolRegistry | undefined;
  const register = DesktopOwnedToolRegistry.prototype.registerTool;
  const capture = vi.spyOn(DesktopOwnedToolRegistry.prototype, 'registerTool').mockImplementation(function (tool) {
    if (tool.definition.name === 'goal_request_complete') registry = this;
    return register.call(this, tool);
  });
  const main = createDesktopServices({ dataRoot: root, knowledgeDbPath: join(root, 'knowledge.test.sqlite'),
    kswarmService: { getStatus: () => ({ running: false, port: 0 }), request: async () => new Response('{}'), getDesktopMutationToken: () => 'test' } as never,
    runner: async input => {
      const p = main.continuity.port();
      const summary = input.prompt === 'source' ? 'GOAL_SOURCE_CANARY' : 'GOAL_DERIVED_' + p.service.resolveReference(
        { ...p.actor, requestSource: 'agent', taskId: input.taskId }, { refId }).messages.find(message => message.role === 'assistant')!.text;
      await input.emitRuntimeEvent({ type: 'assistant_delta', sessionId: input.sessionId, turnId: input.taskId,
        intentId: 'test', stepId: 'test', delta: summary });
      if (input.executionScope?.kind === 'goal_turn') {
        expect(registry).toBeTruthy();
        const control = mode.endsWith('control') || mode === 'ipc-broadcast' || mode === 'ipc-private-window';
        const result = await registry!.executeTool(control ? 'goal_request_blocked' : 'goal_request_complete',
          control ? { reason: `BLOCK_REASON_${summary}`, fingerprint: `BLOCK_FINGERPRINT_${summary}` } : { summary }, {
          taskId: input.taskId, signal: input.signal,
          recordUnprovenEffect: name => main.continuity.recordUnprovenEffect(input.taskId, 'fixture-goal-claim', name),
        });
        expect(result).toContain(control ? 'Goal blocked claim accepted' : 'Goal completion claim accepted');
      }
      await input.emitRuntimeEvent({ type: 'receipt_emitted', sessionId: input.sessionId, turnId: input.taskId,
        intentId: 'test', stepId: 'test', note: JSON.stringify({ summary, artifacts: [] }) });
    },
  });
  let readSpy: ReturnType<typeof vi.spyOn> | undefined;
  try {
    const p = main.continuity.port(), source = p.service.createConversation(p.actor, { operationId: 'source' }),
      target = p.service.createConversation(p.actor, { operationId: 'goal-target' });
    const a = await main.createTask({ prompt: 'source', materials: [], context: { threadId: source.id } });
    await vi.waitFor(() => expect(p.service.store.db.prepare('SELECT 1 FROM effect_owner_receipts WHERE task_id=?').get(a.taskId)).toBeTruthy());
    refId = p.service.createReference(p.actor, { conversationId: source.id, expectedRevision: p.service.getConversation(p.actor, source.id)!.revision, operationId: 'ref' }).refId;
    const grant = p.service.attachReference(p.actor, { refId, targetConversationId: target.id, operationId: 'grant' });
    const control = mode.endsWith('control') || mode === 'ipc-broadcast' || mode === 'ipc-private-window';
    const created = await main.createGoal({ threadId: target.id, objective: 'derive and finish', expectedEvidenceKinds: ['answer'], turnLimit: control ? 2 : 1 });
    await main.ackGoalTaskAttached({ threadId: target.id, attachmentId: created.preparedTask.attachmentId });
    await vi.waitFor(async () => expect((await main.getGoal(target.id))?.state.turnsUsed).toBe(1));
    const initial = (await main.getGoal(target.id))!.state;
    expect(control ? initial.blockerFingerprint : initial.terminalReason).toContain('GOAL_DERIVED_GOAL_SOURCE_CANARY');
    if (mode.startsWith('ipc-')) {
      const handlers = new Map<string, (event: unknown, value: unknown) => unknown>();
      const sent: unknown[] = [], foreignSent: unknown[] = [];
      const frame = { url: 'app://trusted-test' }, contents = { id: 1, mainFrame: frame, send: (_channel: string, value: unknown) => sent.push(value) };
      const window = { isDestroyed: () => false, once: vi.fn(), webContents: contents };
      const foreignWindow = { isDestroyed: () => false, webContents: { id: 2, mainFrame: { url: 'https://foreign.invalid' }, send: (_channel: string, value: unknown) => foreignSent.push(value) } };
      const event = { sender: contents, senderFrame: frame };
      windows.targets = [window, foreignWindow];
      await registerDesktopIpc({ handle: (name: string, handler: (event: unknown, value: unknown) => unknown) => { handlers.set(name, handler); } } as never,
        window as never, main, { multiAgentAuthorize: input => input.sender === contents && input.senderFrame === frame ? { actorId: p.actor.actorId } : null });
      expect(JSON.stringify(await handlers.get('desktop:goal:get')!(event, { threadId: target.id }))).toContain('GOAL_DERIVED_GOAL_SOURCE_CANARY');
      if (mode === 'ipc-sender') {
        await expect(handlers.get('desktop:goal:get')!({ sender: foreignWindow.webContents, senderFrame: foreignWindow.webContents.mainFrame }, { threadId: target.id })).rejects.toThrow(/forbidden|unavailable/);
      } else if (mode === 'ipc-get') {
        const original = main.getGoal;
        readSpy = vi.spyOn(main, 'getGoal').mockImplementation(async id => {
          const value = await original(id);
          if (id === target.id) queueMicrotask(() => p.service.revokeGrant(p.actor, grant));
          return value;
        });
        await expect(handlers.get('desktop:goal:get')!(event, { threadId: target.id })).rejects.toThrow(/not_readable|goal_content_unavailable/);
      } else {
        if (mode === 'ipc-broadcast') windows.beforeList = () => { windows.beforeList = undefined; p.service.revokeGrant(p.actor, grant); };
        await main.pauseGoal(target.id);
        expect(foreignSent).toEqual([]);
        if (mode === 'ipc-broadcast') expect(JSON.stringify(sent)).not.toContain('GOAL_DERIVED_GOAL_SOURCE_CANARY');
        else expect(JSON.stringify(sent)).toContain('GOAL_DERIVED_GOAL_SOURCE_CANARY');
      }
      return;
    }
    if (control) {
      p.service.revokeGrant(p.actor, grant);
      const result = mode === 'pause-control' ? await main.pauseGoal(target.id) : await main.cancelGoal(target.id);
      await expect(main.recoverTask(created.preparedTask.taskId)).rejects.toThrow('not_readable');
      expect(JSON.stringify(result)).not.toContain('GOAL_DERIVED_GOAL_SOURCE_CANARY');
      expect(result).toEqual({ threadId: target.id, status: mode === 'pause-control' ? 'paused' : 'cancelled', revision: expect.any(Number) });
      return;
    }
    if (mode === 'already-revoked') p.service.revokeGrant(p.actor, grant);
    else {
      const original = DesktopGoalCoordinator.prototype.getGoal;
      readSpy = vi.spyOn(DesktopGoalCoordinator.prototype, 'getGoal').mockImplementation(async function (id) {
        const result = await original.call(this, id);
        if (id === target.id) queueMicrotask(() => p.service.revokeGrant(p.actor, grant));
        return result;
      });
    }
    await expect(main.getGoal(target.id)).rejects.toThrow(/not_readable|goal_content_unavailable/);
    await expect(main.recoverTask(created.preparedTask.taskId)).rejects.toThrow('not_readable');
  } finally {
    windows.targets = []; windows.beforeList = undefined;
    readSpy?.mockRestore(); capture.mockRestore(); await main.disposeMultiAgent(); main.getKnowledgeBaseStore().close();
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

async function goalIpcFixture() {
  const root = mkdtempSync(join(tmpdir(), 'continuity-goal-ipc-boundary-'));
  const runner = vi.fn(async () => {});
  const main = createDesktopServices({ dataRoot: root, knowledgeDbPath: join(root, 'knowledge.test.sqlite'), runner,
    kswarmService: { getStatus: () => ({ running: false, port: 0 }), request: async () => new Response('{}'), getDesktopMutationToken: () => 'test' } as never });
  const p = main.continuity.port(), target = p.service.createConversation(p.actor, { operationId: 'ipc-target' });
  const frame = {}, contents = { id: 1, mainFrame: frame, send: vi.fn() };
  const event = { sender: contents, senderFrame: frame }, handlers = new Map<string, (event: unknown, input: unknown) => Promise<unknown>>();
  const window = { isDestroyed: () => false, once: vi.fn(), webContents: contents };
  windows.targets = [window];
  await registerDesktopIpc({ handle: (name: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => { handlers.set(name, handler); } } as never,
    window as never, main, { multiAgentAuthorize: value => value.sender === contents && value.senderFrame === contents.mainFrame ? { actorId: p.actor.actorId } : null });
  return { main, root, runner, p, target, contents, event,
    input: { threadId: target.id, objective: 'USER_GOAL_PRIVATE_CANARY', expectedEvidenceKinds: ['answer'] as const, turnLimit: 1 },
    invoke: (name: string, input: unknown, sender: unknown = event) => handlers.get(`desktop:goal:${name}`)!(sender, input),
    close: async () => { windows.targets = []; windows.beforeList = undefined; await main.disposeMultiAgent(); main.getKnowledgeBaseStore().close(); rmSync(root, { recursive: true, force: true, maxRetries: 3 }); } };
}

it.each(['sender', 'epoch', 'pointer'] as const)('fences an actual positive Goal reply after the last await changes its %s', async kind => {
  const f = await goalIpcFixture(), original = f.main.createGoal;
  const spy = vi.spyOn(f.main, 'createGoal').mockImplementation(async (input, actor) => {
    const value = await original(input, actor);
    if (kind === 'sender') queueMicrotask(() => { f.contents.mainFrame = {}; });
    if (kind === 'pointer') await f.main.cancelGoal(input.threadId);
    if (kind === 'epoch') {
      const root = join(f.root, 'tasks'), store = new FileTaskSnapshotStore(root), before = recoverTaskSnapshotSync(root, value.preparedTask.taskId)!;
      await store.save({ ...before, sessionId: 'different-prepared-source-epoch' });
    }
    return value;
  });
  try {
    await expect(f.invoke('create', f.input)).rejects.toThrow(/forbidden|unavailable/);
    expect(f.runner).not.toHaveBeenCalled();
  } finally { spy.mockRestore(); await f.close(); }
});

it('requires opaque receipts for null reads and actual positive replies, and refuses clones', async () => {
  const f = await goalIpcFixture();
  let actor: Parameters<typeof f.main.createGoal>[1];
  const original = f.main.createGoal, spy = vi.spyOn(f.main, 'createGoal').mockImplementation(async (input, caller) => { actor = caller; return original(input, caller); });
  try {
    expect(await f.main.getGoal(f.target.id)).toBeNull();
    const captured = f.main.goalOutput.captureRead(f.target.id, null, f.p.actor);
    f.main.goalOutput.assertRead(captured.receipt, null, f.p.actor);
    expect(() => f.main.goalOutput.assertRead({}, null, f.p.actor)).toThrow('goal_content_unavailable');
    const value = await f.invoke('create', f.input) as Awaited<ReturnType<typeof f.main.createGoal>>;
    f.main.goalOutput.assertReply(value, actor!);
    expect(() => f.main.goalOutput.assertReply(structuredClone(value), actor!)).toThrow('goal_content_unavailable');
    expect(() => f.main.goalOutput.assertRead(captured.receipt, null, f.p.actor)).toThrow('goal_content_unavailable');
    expect(f.runner).not.toHaveBeenCalled();
  } finally { spy.mockRestore(); await f.close(); }
});

it('refuses foreign ACK and queue-control senders without changing a pending Goal, then accepts its actual owner ACK', async () => {
  const f = await goalIpcFixture();
  try {
    const created = await f.invoke('create', f.input) as Awaited<ReturnType<typeof f.main.createGoal>>;
    const input = { threadId: f.target.id, attachmentId: created.preparedTask.attachmentId };
    for (const [method, value] of [['ackTaskAttached', input], ['setUserQueuePending', { threadId: f.target.id, pending: true }]] as const) {
      await expect(f.invoke(method, value, { sender: {}, senderFrame: {} })).rejects.toThrow(/forbidden/);
    }
    expect(f.runner).not.toHaveBeenCalled();
    await f.invoke('ackTaskAttached', input);
    await vi.waitFor(() => expect(f.runner).toHaveBeenCalledOnce());
  } finally { await f.close(); }
});

it.each(['pause', 'cancel', 'timeout', 'legacy-missing-proof'] as const)('preserves a fresh zero-turn Goal after %s with actual control evidence', async mode => {
  const root = mkdtempSync(join(tmpdir(), 'continuity-goal-empty-'));
  const runner = vi.fn(async () => {});
  const main = createDesktopServices({ dataRoot: root, knowledgeDbPath: join(root, 'knowledge.test.sqlite'), runner,
    kswarmService: { getStatus: () => ({ running: false, port: 0 }), request: async () => new Response('{}'), getDesktopMutationToken: () => 'test' } as never });
  try {
    const p = main.continuity.port(), target = p.service.createConversation(p.actor, { operationId: 'fresh-goal' });
    const created = await main.createGoal({ threadId: target.id, objective: 'user-owned objective', expectedEvidenceKinds: ['answer'], turnLimit: 2 });
    expect((await main.getGoal(target.id))?.state.turnsUsed).toBe(0);
    const status = mode === 'cancel' ? 'cancelled' : 'paused';
    if (mode === 'timeout') {
      await vi.waitFor(async () => expect((await main.getGoal(target.id))?.state.status).toBe('paused'), { timeout: 33_000, interval: 100 });
    } else {
      const receipt = mode === 'cancel' ? await main.cancelGoal(target.id) : await main.pauseGoal(target.id);
      expect(receipt).toEqual({ threadId: target.id, status, revision: expect.any(Number) });
    }
    if (mode === 'legacy-missing-proof') {
      // Remove the new transition proof from our real user mutation, never synthesize a safe legacy source.
      const db = new DatabaseSync(join(root, 'goals', 'goals.sqlite'));
      try { db.prepare("update goal_events set event_json=json_remove(event_json,'$.reason') where goal_id=?").run(created.goal.state.goalId); }
      finally { db.close(); }
      await expect(main.getGoal(target.id)).rejects.toThrow('goal_content_unavailable');
    } else {
      const goal = await main.getGoal(target.id);
      expect(goal?.state).toMatchObject({ status, turnsUsed: 0, objective: 'user-owned objective', terminalReason: mode === 'timeout' ? 'thread_attachment_timeout' : mode === 'cancel' ? 'user_cancelled' : 'user_paused' });
    }
    expect(runner).not.toHaveBeenCalled();
  } finally {
    await main.disposeMultiAgent(); main.getKnowledgeBaseStore().close();
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
}, 36_000);

it('rejects an armed Goal projection when its actual live activation changes at the last await', async () => {
  const root = mkdtempSync(join(tmpdir(), 'continuity-goal-live-'));
  const main = createDesktopServices({ dataRoot: root, knowledgeDbPath: join(root, 'knowledge.test.sqlite'), runner: vi.fn(async () => {}),
    kswarmService: { getStatus: () => ({ running: false, port: 0 }), request: async () => new Response('{}'), getDesktopMutationToken: () => 'test' } as never });
  let spy: ReturnType<typeof vi.spyOn> | undefined;
  try {
    const p = main.continuity.port(), target = p.service.createConversation(p.actor, { operationId: 'live-goal' });
    await main.createGoal({ threadId: target.id, objective: 'user-owned live goal', expectedEvidenceKinds: ['answer'], turnLimit: 2 });
    expect((await main.getGoal(target.id))?.activation).toBe('armed');
    const original = DesktopGoalCoordinator.prototype.getGoal;
    spy = vi.spyOn(DesktopGoalCoordinator.prototype, 'getGoal').mockImplementation(async function (id) {
      const value = await original.call(this, id);
      if (id === target.id) queueMicrotask(() => this.disarmAll());
      return value;
    });
    await expect(main.getGoal(target.id)).rejects.toThrow('goal_content_unavailable');
  } finally {
    spy?.mockRestore(); await main.disposeMultiAgent(); main.getKnowledgeBaseStore().close();
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

it('rechecks the current child-readiness port without treating its enum as a source proof', async () => {
  const root = mkdtempSync(join(tmpdir(), 'continuity-goal-readiness-'));
  // Dependency contract only: real coordinator/store/gate, controlled readiness port;
  // this does not qualify a real child execution or physical tool closure.
  let readiness: 'waiting_children' | 'children_need_attention' = 'waiting_children';
  const store = new SqliteGoalStore(join(root, 'goals.sqlite'), { requireReadProvenance: true });
  const actor = Object.freeze({ requestSource: 'user' as const, actorId: 'test-owner' });
  const coordinator = new DesktopGoalCoordinator({ store, instanceId: 'test', requireReadProvenance: true,
    assertPreparedTaskCurrent: () => {},
    taskHost: { prepareTask: async () => ({ taskId: 'prepared-only' }), startTask: vi.fn(), cancelTask: vi.fn() },
    multiAgent: { goalReadiness: () => readiness,
      getExecutionAuthorization: () => ({ permissionRevision: 1 }),
      assertExecutionAdmission: () => {}, assertThreadAdmission: async () => {}, withGoalDecision: vi.fn() } as never,
    capturePreparedSourceEpoch: async () => 'prepared-epoch',
    captureGoalRead: (threadId, value) => { gate.capture(threadId, value, actor); },
    assertGoalReadCurrent: (threadId, value) => { gate.assertValueCurrent(threadId, value, actor); } });
  const gate = createGoalDisclosure({ store, assertAccess: () => {}, readTask: () => null, assertTaskReadable: () => {},
    assertLiveProjection: (threadId, value) => coordinator.assertLiveProjection(threadId, value) });
  try {
    await coordinator.createGoal({ threadId: 'thread', objective: 'user-owned goal', expectedEvidenceKinds: ['answer'], turnLimit: 2 });
    const value = await coordinator.getGoal('thread');
    expect(value?.waitingReason).toBe('waiting_children');
    gate.assertValueCurrent('thread', value, actor);
    readiness = 'children_need_attention';
    expect(() => gate.assertValueCurrent('thread', value, actor)).toThrow('goal_content_unavailable');
    expect((await coordinator.getGoal('thread'))?.waitingReason).toBe('children_need_attention');
    await coordinator.stopForWorkspaceExecutionRevocation({ requestSource: 'user' });
    expect((await coordinator.getGoal('thread'))?.state).toMatchObject({ status: 'paused', terminalReason: 'permission_revoked' });
  } finally {
    coordinator.disarmAll(); store.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});
