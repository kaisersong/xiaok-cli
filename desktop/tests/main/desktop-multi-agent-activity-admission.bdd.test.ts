// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { activityFixture, barrier, nativeAuthorizer, rootRequest, serviceSite, spawnChunk, sqliteFault, tick, writeChunk, type Cleanup } from '../fixtures/multi-agent-activity-failure.js';
import type { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';

describe.runIf(nativeAuthorizer)('R6 AF6a actual direct LiveGroup admission callers', () => {
  const cleanup: Cleanup = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  async function siblings(rootFinishes: boolean, onBusyCall?: () => void) {
    const f = await activityFixture(cleanup), rootEntered = barrier(), busyEntered = barrier(), rootRelease = barrier(), busyRelease = barrier();
    cleanup.push(() => { rootRelease.release(); busyRelease.release(); });
    const effect = join(f.root, 'busy-next-effect.txt');
    let busyRequestedTool = false;
    f.setProgram(async function* ({ child, system, call }) {
      if (child) {
        if (system.includes('Assigned Desktop agent: /root/idle')) { yield { type: 'text', delta: 'idle child done' }; return; }
        onBusyCall?.();
        if (busyRequestedTool) { yield { type: 'text', delta: 'busy child done' }; return; }
        busyRequestedTool = true;
        busyEntered.release(); await busyRelease.wait; yield writeChunk(effect); return;
      }
      if (call === 1) { yield spawnChunk('idle'); yield spawnChunk('busy'); }
      else if (call === 2) { rootEntered.release(); if (!rootFinishes) await rootRelease.wait; yield { type: 'text', delta: 'root complete' }; }
      else yield { type: 'text', delta: 'new root complete' };
    });
    const taskId = await f.start(); await rootEntered.wait; await busyEntered.wait;
    const context = f.rootContext();
    await vi.waitFor(() => expect(f.store.listAgents(context.groupId).items.find(agent => agent.taskName === 'idle')).toMatchObject({ status: 'completed', executionActive: false }));
    const idle = f.store.listAgents(context.groupId).items.find(agent => agent.taskName === 'idle')!;
    const busy = f.contexts.find(candidate => candidate.agentId !== context.agentId && candidate.agentId !== idle.id)!;
    if (rootFinishes) await f.settled(taskId);
    const host = (f.service as unknown as { host: InProcessTaskRuntimeHost }).host;
    return { ...f, taskId, context, idle, busy, host, rootRelease, busyRelease, effect };
  }

  it('AF6a fixture released busy provider performs one write then reaches a real terminal result without an iteration watchdog', async () => {
    let busyCalls = 0;
    // Assert the provider protocol itself. This also exposes a hot microtask
    // loop as an ordinary failed result instead of starving Vitest's timers.
    const f = await siblings(false, () => { expect(++busyCalls).toBeLessThanOrEqual(2); });
    f.busyRelease.release(); f.rootRelease.release();
    await vi.waitFor(() => expect(f.store.getAgent(f.busy.groupId, f.busy.agentId)).toMatchObject({ status: 'completed', executionActive: false }));
    expect(existsSync(f.effect)).toBe(true);
    expect(f.calls.filter(call => call.child && !call.system.includes('Assigned Desktop agent: /root/idle'))).toHaveLength(2);
    await f.settled(f.taskId);
  });

  it.each(['prepare', 'root-followup', 'user-followup'].flatMap(caller => ['groups', 'thread_bindings'].map(table => ({ caller, table }))))('AF6a $caller × $table actual read failure cancels the existing sibling before new dispatch', async ({ caller, table }) => {
    const f = await siblings(caller === 'prepare');
    const site = caller === 'prepare' ? serviceSite('async prepareRoot(', 'this.assertWritable(group);')
      : caller === 'root-followup' ? serviceSite('private enqueueNextFollowup(', "this.assertWritable(group, 'multi_agent_followup_admission_failed')")
      : serviceSite('private async userCommand(', 'this.assertWritable(group);');
    const access = f.access();
    const fault = sqliteFault(f, { table, column: table === 'groups' ? 'data_json' : 'thread_id', site });
    let result: unknown;
    try {
      result = caller === 'prepare' ? await f.service.prepareRoot(f.host, 'activity-thread', { prompt: 'new root', materials: [] })
        : caller === 'root-followup' ? await f.service.followup({ ...rootRequest(f.context), target: f.idle.id, message: 'follow up' })
        : await f.service.userFollowup({ access, requestSource: 'user', groupId: f.context.groupId, agentId: f.idle.id,
          expectedTurn: f.idle.turn, operationId: 'user-followup', message: 'follow up' });
    } catch (error) { result = error; }
    await vi.waitFor(() => expect(fault.traces).toHaveLength(1)); await tick();
    // The root-followup grant already has its own catch in current production.
    expect.soft(f.live().frozen).toBe(caller === 'root-followup' ? 'multi_agent_followup_admission_failed' : 'multi_agent_persistence_failed');
    expect.soft(f.busy.signal.aborted).toBe(true);
    if (caller !== 'root-followup') expect(result).toBeInstanceOf(Error);
    f.busyRelease.release(); f.rootRelease.release(); await f.settled(f.taskId);
    await vi.waitFor(() => expect(f.store.getAgent(f.busy.groupId, f.busy.agentId)?.executionActive).toBe(false));
    expect(existsSync(f.effect)).toBe(false);
  });

  it.each(['groups', 'thread_bindings'] as const)('AF6a-extra prepare second existing host.prepareTask await then %s failure cancels retained child', async table => {
    const f = await siblings(true), prepared = barrier(), resume = barrier(); cleanup.push(() => { resume.release(); });
    const original = f.host.prepareTask.bind(f.host);
    vi.spyOn(f.host, 'prepareTask').mockImplementation(async (...args) => { const value = await original(...args); prepared.release(); await resume.wait; return value; });
    const outcome = f.service.prepareRoot(f.host, 'activity-thread', { prompt: 'second window', materials: [] }).then(value => ({ value }), error => ({ error }));
    await prepared.wait;
    const fault = sqliteFault(f, { table, column: table === 'groups' ? 'data_json' : 'thread_id', site: serviceSite('async prepareRoot(', 'this.assertWritable(group);', 1) });
    resume.release(); const result = await outcome;
    expect(result).toHaveProperty('error'); expect(fault.traces).toHaveLength(1);
    expect.soft(f.live().frozen).toBe('multi_agent_persistence_failed'); expect.soft(f.busy.signal.aborted).toBe(true);
    f.busyRelease.release(); await vi.waitFor(() => expect(f.store.getAgent(f.busy.groupId, f.busy.agentId)?.executionActive).toBe(false));
    expect(existsSync(f.effect)).toBe(false);
  });

  it.each(['groups', 'thread_bindings'] as const)('AF6a-extra runRoot actual lease await then %s failure cannot leave retained child running', async table => {
    const f = await siblings(true);
    const prepared = await f.service.prepareRoot(f.host, 'activity-thread', { prompt: 'joined root', materials: [] });
    cleanup.push(() => f.services.cancelTask(prepared.taskId).catch(() => {}));
    const callsBefore = f.calls.filter(call => !call.child).length;
    const fault = sqliteFault(f, { table, column: table === 'groups' ? 'data_json' : 'thread_id', site: serviceSite('async runRoot<', 'this.assertWritable(group);') });
    await f.host.startTask(prepared.taskId); await f.settled(prepared.taskId);
    expect(fault.traces).toHaveLength(1); expect(f.calls.filter(call => !call.child)).toHaveLength(callsBefore);
    expect.soft(f.live().frozen).toBe('multi_agent_persistence_failed'); expect.soft(f.busy.signal.aborted).toBe(true);
    f.busyRelease.release(); await vi.waitFor(() => expect(f.store.getAgent(f.busy.groupId, f.busy.agentId)?.executionActive).toBe(false));
    expect(existsSync(f.effect)).toBe(false);
  });

  it.each(['prepare-root-busy', 'root-followup-sealed', 'user-followup-stale'] as const)('AF6a ordinary %s refusal does not freeze a healthy sibling', async caller => {
    const f = await siblings(caller === 'root-followup-sealed');
    let result: unknown;
    try {
      result = caller === 'prepare-root-busy' ? await f.service.prepareRoot(f.host, 'activity-thread', { prompt: 'busy', materials: [] })
        : caller === 'root-followup-sealed' ? await f.service.followup({ ...rootRequest(f.context), target: f.idle.id, message: 'stale' })
        : await f.service.userFollowup({ access: f.access(), requestSource: 'user', groupId: f.context.groupId, agentId: f.idle.id,
          expectedTurn: f.idle.turn + 99, operationId: 'stale', message: 'stale' });
    } catch (error) { result = error; }
    if (caller === 'user-followup-stale') expect(result).toMatchObject({ outcome: 'rejected', error: 'stale_expected_turn' });
    else expect(result).toBeInstanceOf(Error);
    expect(f.live().frozen).toBeUndefined(); expect(f.busy.signal.aborted).toBe(false);
    f.busyRelease.release(); f.rootRelease.release(); await f.settled(f.taskId);
    await vi.waitFor(() => expect(existsSync(f.effect)).toBe(true));
  });

  it.each(['prepare', 'root-followup', 'user-followup'].flatMap(caller => ['reset', 'delete'].map(operation => ({ caller, operation }))))('AF4/AF6a ordinary $caller during actual $operation keeps the original abort reason, not a persistence freeze', async ({ caller, operation }) => {
    const f = await siblings(false), access = f.access();
    // These real lifecycle commands already cancel their old owner. A normal
    // refusal must preserve that reason, not assert an impossible live signal.
    const lifecycle = operation === 'reset'
      ? f.service.resetGroup({ access, requestSource: 'user', expectedGroupId: f.context.groupId, operationId: 'normal-reset', confirmTerminate: true })
      : f.service.deleteThread({ access, requestSource: 'user', expectedThreadRevision: f.store.getThread('activity-thread')!.threadRevision!,
        operationId: `delete:${f.store.getThread('activity-thread')!.threadRevision!}:normal`, confirmTerminate: true });
    const observedLifecycle = lifecycle.then(value => ({ value }), error => ({ error }));
    await vi.waitFor(() => expect(f.busy.signal.aborted).toBe(true));
    // Keep a pre-call observation: a lifecycle callback may itself fail before
    // the ordinary refusal. Such a failure must not be attributed to the guard.
    const frozenBeforeRefusal = f.live().frozen;
    const rootReason = f.context.signal.reason, childReason = f.busy.signal.reason;
    expect(rootReason).toMatchObject({ message: operation === 'reset' ? 'group_reset_pending' : 'multi_agent_thread_deletion_pending' });
    let result: unknown;
    try {
      result = caller === 'prepare' ? await f.service.prepareRoot(f.host, 'activity-thread', { prompt: 'refuse old owner', materials: [] })
        : caller === 'root-followup' ? await f.service.followup({ ...rootRequest(f.context), target: f.idle.id, message: 'refuse old actor' })
        : await f.service.userFollowup({ access, requestSource: 'user', groupId: f.context.groupId, agentId: f.idle.id,
          expectedTurn: f.idle.turn, operationId: 'refuse-old-user', message: 'refuse old scope' });
    } catch (error) { result = error; }
    expect(result).toBeInstanceOf(Error); expect.soft(frozenBeforeRefusal).toBeUndefined(); expect.soft(f.live().frozen).toBeUndefined();
    expect(f.context.signal.reason).toBe(rootReason); expect(f.busy.signal.reason).toBe(childReason);
    f.busyRelease.release(); f.rootRelease.release(); await f.settled(f.taskId); await observedLifecycle;
    expect(existsSync(f.effect)).toBe(false); expect(f.live().frozen).toBeUndefined();
  });

  it.each(['prepare', 'root-followup', 'user-followup'] as const)('AF4/AF6a actual disposed/not-ready owner rejects %s without introducing a persistence freeze', async caller => {
    const f = await siblings(false), access = f.access(), disposal = f.service.dispose();
    await tick();
    expect(f.context.signal.aborted).toBe(true);
    const reason = f.context.signal.reason;
    let result: unknown;
    try {
      result = caller === 'prepare' ? await f.service.prepareRoot(f.host, 'activity-thread', { prompt: 'shutdown', materials: [] })
        : caller === 'root-followup' ? await f.service.followup({ ...rootRequest(f.context), target: f.idle.id, message: 'shutdown' })
        : await f.service.userFollowup({ access, requestSource: 'user', groupId: f.context.groupId, agentId: f.idle.id,
          expectedTurn: f.idle.turn, operationId: 'shutdown-user', message: 'shutdown' });
    } catch (error) { result = error; }
    expect(result).toBeInstanceOf(Error);
    if (caller === 'prepare') expect(result).toMatchObject({ message: 'multi_agent_runtime_not_ready' });
    expect(f.live().frozen).toBeUndefined(); expect(f.context.signal.reason).toBe(reason);
    expect(f.store.getAgent(f.busy.groupId, f.busy.agentId)?.resourcesReleased).toBe(false);
    f.busyRelease.release(); f.rootRelease.release(); await f.settled(f.taskId); await disposal;
    expect(existsSync(f.effect)).toBe(false);
  });
});
