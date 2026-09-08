// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopMultiAgentService, type DesktopHostDeliveryAuthority } from '../../electron/desktop-multi-agent-service.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { DesktopGoalCoordinator } from '../../electron/desktop-goal-coordinator.js';
import { SqliteGoalStore } from '../../electron/goal-store-sqlite.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { compileVerifierEntry } from '../fixtures/desktop-post-seal-verifier-contract.js';

const nativeWorker = vi.hoisted(() => ({ output: '', root: '' }));
vi.mock('node:worker_threads', async importOriginal => {
  const actual = await importOriginal<typeof import('node:worker_threads')>();
  const source = new URL('../../../src/runtime/task-host/delivery-verifier-worker.js', import.meta.url).href;
  return { ...actual, Worker: class extends actual.Worker {
    constructor(filename: ConstructorParameters<typeof actual.Worker>[0], options?: ConstructorParameters<typeof actual.Worker>[1]) {
      const mapped = String(filename) === source;
      if (mapped && !nativeWorker.output) throw new Error('test compiled Worker entry is not ready');
      super(mapped ? nativeWorker.output : filename, options);
    }
  } };
});
beforeAll(async () => { Object.assign(nativeWorker, await compileVerifierEntry('delivery-verifier-worker.ts')); });
afterAll(() => { if (nativeWorker.root) rmSync(nativeWorker.root, { recursive: true, force: true, maxRetries: 3 }); });

describe('BDD: Goal settlement and child execution share the actual group decision boundary', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { vi.restoreAllMocks(); for (const action of cleanup.splice(0).reverse()) await action(); });
  it.each([false, true].flatMap(complete => ['completed', 'failed', 'interrupted', 'closed', 'handoff-write-failure', 'late-success', 'late-failure', 'queued-interrupted', 'queued-closed', 'init-failed'].map(outcome => ({ complete, outcome }))))('A18 Given complete=$complete and child outcome=$outcome, Then automatic settlement waits for the actual child handoff', async ({ complete, outcome }) => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-ma-goal-')); cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite')); const goals = new SqliteGoalStore(join(root, 'goals.sqlite'));
    cleanup.push(() => { store.close(); goals.close(); });
    let finish!: () => void; const childResult = new Promise<void>(resolve => { finish = resolve; });
    let entered!: () => void; const running = new Promise<void>(resolve => { entered = resolve; });
    const service = new DesktopMultiAgentService({ store, coordinator: new DesktopExecutionCoordinator(), createSession: async () => {
      if (outcome === 'init-failed') { entered(); throw new Error('CHILD_INIT_FAILURE'); }
      return {
      run: async () => { entered(); await childResult; if (['failed', 'handoff-write-failure', 'late-failure'].includes(outcome)) throw new Error('CHILD_FAILURE'); return 'CHILD_RESULT'; }, suspend: async () => {}, dispose: async () => {},
    }; } });
    cleanup.push(async () => { finish(); await service.dispose(); });
    service.registerThread({ threadId: 'thread', profileId: 'profile', workspaceId: 'workspace', cwd: root });
    let goal!: DesktopGoalCoordinator; let runs = 0; let groupId = '';
    let authority: DesktopHostDeliveryAuthority | undefined;
    const host = new InProcessTaskRuntimeHost({ snapshotStore: new FileTaskSnapshotStore(join(root, 'tasks')),
      materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 }),
      authorizePreparation: (id, marker) => service.assertHostPreparation(id, marker), assertTaskAdmission: snapshot => service.assertHostAdmission(snapshot),
      getExecutionPolicy: () => ({ deliveryRepair: 'explicit' }),
      onDeliveryReport: report => {
        if (!authority) throw new Error('test host owner is not bound');
        return service.recordHostDelivery({ requestSource: 'scheduler', authority, report });
      },
      onPersistedEvent: input => goal.handlePersistedTaskEvent(input),
      runner: input => service.runRoot(input, async context => {
        groupId = context.groupId; runs++;
        if (runs === 1) {
          await service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'spawn', taskName: 'child', message: 'work' }); await running;
          if (outcome.startsWith('queued-')) {
            const child = store.allAgents(groupId).find(agent => agent.depth === 1)!;
            await service.followup({ actor: context.actor, requestSource: 'agent', operationId: 'queued-work', target: child.id, message: 'must not disappear' });
          }
          if (outcome.startsWith('late-')) {
            const child = store.allAgents(groupId).find(agent => agent.depth === 1)!;
            await service.interrupt({ actor: context.actor, requestSource: 'agent', operationId: 'cancel-in-root', target: child.id });
            await vi.waitFor(() => expect(store.listMessages(groupId, context.agentId)).toHaveLength(1));
            const batch = await context.mailbox.drainInput();
            expect(service.goalReadiness('thread')).toBe('children_need_attention');
            await context.mailbox.confirmApplied(batch.claimId!);
            expect(service.goalReadiness('thread')).toBe('waiting_children');
            expect(store.getAgent(groupId, child.id)?.executionActive).toBe(true);
          }
        } else {
          const batch = await context.mailbox.drainInput(); if (batch.claimId) await context.mailbox.confirmApplied(batch.claimId);
        }
        if (complete || runs > 1) await goal.createGoalToolHost(input.taskId).requestComplete('finished');
        await input.emitRuntimeEvent({ type: 'assistant_delta', sessionId: input.sessionId, turnId: context.turnId, intentId: 'answer', stepId: 'answer', delta: 'ROOT_ANSWER' });
      }),
    });
    const ready = service.initialize(host);
    authority = service.bindHostDeliveryOwner(host);
    await ready;
    goal = new DesktopGoalCoordinator({ store: goals, instanceId: 'test', multiAgent: service,
      taskHost: { prepareTask: input => service.prepareRoot(host, 'thread', input), startTask: id => host.startTask(id), cancelTask: id => host.cancelTask(id) } });
    cleanup.push(() => goal.disarmAll());
    const initial = await goal.createGoal({ threadId: 'thread', objective: 'answer', expectedEvidenceKinds: ['answer'], turnLimit: 4 });
    await goal.ackGoalTaskAttached({ threadId: 'thread', attachmentId: initial.preparedTask.attachmentId }); await host.drain();
    await vi.waitFor(async () => expect((await goal.getGoal('thread'))?.state.turnsUsed).toBe(1));
    if (outcome === 'init-failed') {
      // This deliberately minimal runner does not consume an error that arrives
      // before it seals. The existing bounded mailbox guard must fail closed.
      expect((await goal.getGoal('thread'))?.state.status).toBe('paused');
      expect(goal.getPendingAttachmentForTest('thread')).toBeNull();
      expect(store.listMessages(groupId, `root_${groupId}`)).toMatchObject([{ kind: 'error', preview: 'CHILD_INIT_FAILURE' }]);
      return;
    }
    expect((await goal.getGoal('thread'))?.state.status).toBe('active');
    expect(goal.getPendingAttachmentForTest('thread')).toBeNull(); expect(runs).toBe(1);
    expect(await goal.getGoal('thread')).toMatchObject({ state: { turnsUsed: 1 }, waitingReason: outcome === 'init-failed' ? 'children_need_attention' : 'waiting_children' });
    const child = store.allAgents(groupId).find(agent => agent.depth === 1)!;
    if (outcome === 'handoff-write-failure') {
      const send = store.sendMessage.bind(store);
      vi.spyOn(store, 'sendMessage').mockImplementation((group, input) => { if (input.kind === 'error') throw new Error('SQLITE_FULL: handoff'); return send(group, input); });
    }
    if (outcome === 'interrupted' || outcome === 'closed' || outcome.startsWith('queued-')) {
      const access = service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 'thread', profileId: 'profile', workspaceId: 'workspace' });
      const input = { access, requestSource: 'user' as const, groupId, agentId: child.id, expectedTurn: child.turn, operationId: 'stop-child' };
      const close = outcome.endsWith('closed');
      await (close ? service.userClose(input) : service.userInterrupt(input));
      await (close ? service.userClose(input) : service.userInterrupt(input));
      expect(store.getAgent(groupId, child.id)?.executionActive).toBe(true);
      expect(goal.getPendingAttachmentForTest('thread')).toBeNull();
    }
    finish(); await vi.waitFor(() => expect(store.getAgent(groupId, child.id)?.executionActive).toBe(false));
    if (outcome === 'handoff-write-failure') {
      await vi.waitFor(() => expect(store.getGroup(groupId)?.mutationBlockedReason).toMatch(/persistence/));
      expect(service.goalReadiness('thread')).toBe('children_need_attention');
      expect(store.listMessages(groupId, `root_${groupId}`)).toHaveLength(0);
      expect(store.readEvents(groupId, 0, 100).filter(event => event.kind === 'result')).toHaveLength(0);
      expect(goal.getPendingAttachmentForTest('thread')).toBeNull(); return;
    }
    expect(await goal.getGoal('thread')).toMatchObject({ state: { status: 'active' },
      ...(outcome.startsWith('late-') ? {} : { waitingReason: outcome === 'completed' ? 'waiting_children' : 'children_need_attention' }) });
    if (outcome.startsWith('late-')) {
      expect(service.goalReadiness('thread')).toBe('ready'); expect(store.getAgent(groupId, child.id)?.status).toBe('interrupted');
    }
    const handoffs = store.listMessages(groupId, `root_${groupId}`).filter(message => message.sender.kind === 'agent' && message.sender.agentId === child.id);
    expect(handoffs).toHaveLength(outcome.startsWith('queued-') ? 2 : 1);
    for (const handoff of handoffs) expect(handoff.kind).toBe(outcome === 'completed' ? 'result' : 'error');
    if (outcome.startsWith('queued-')) {
      const cancellation = handoffs.find(message => message.preview.includes('queued-work'))!;
      expect(cancellation.preview).toContain('2');
      expect(store.getOperation(groupId, 'queued-work')?.result).toMatchObject({ outcome: 'cancelled', messageId: cancellation.messageId });
      expect(store.getAgent(groupId, child.id)?.turn).toBe(1);
    }
    expect(goal.getPendingAttachmentForTest('thread')).toBeNull();
    await goal.admitUserTask({ prompt: 'consume child result then finish', materials: [], context: { threadId: 'thread' } }); await host.drain();
    await vi.waitFor(async () => expect((await goal.getGoal('thread'))?.state.turnsUsed).toBe(2));
    expect(await goal.getGoal('thread')).toMatchObject({ state: { status: 'complete', turnsUsed: 2 } }); expect(runs).toBe(2);
  });
});
