// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { InProcessTaskRuntimeHost, type TaskRunner, type InProcessTaskRuntimeHostOptions } from '../../../src/runtime/task-host/task-runtime-host.js';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('BDD: real task host multi-agent boundaries', () => {
  const roots: string[] = [];
  const hosts: InProcessTaskRuntimeHost[] = [];
  afterEach(async () => {
    for (const host of hosts.splice(0)) await host.drain();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });
  function setup(options: Partial<InProcessTaskRuntimeHostOptions> = {}) {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-multi-agent-host-')); roots.push(root);
    const snapshotStore = new FileTaskSnapshotStore(join(root, 'tasks'));
    const runner = vi.fn<TaskRunner>(async input => {
      await input.emitRuntimeEvent({ type: 'progress_plan_reported', sessionId: input.sessionId, steps: [
        { id: 'one', label: 'report', status: 'completed' }, { id: 'two', label: 'slides', status: 'pending' },
      ] });
      await input.emitRuntimeEvent({ type: 'receipt_emitted', sessionId: input.sessionId, turnId: 'turn-1', intentId: 'intent-1', stepId: 'step-1', note: 'partial output' });
    });
    const host = new InProcessTaskRuntimeHost({ materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 * 1024 }), snapshotStore, runner, ...options });
    hosts.push(host);
    return { host, runner, snapshotStore };
  }

  it('A41 Given explicit multi-agent delivery repair, When the actual gate rejects, Then the runner is not reentered and host delivery fails', async () => {
    const { host, runner } = setup({ getExecutionPolicy: () => ({ deliveryRepair: 'explicit' }) });
    const { taskId } = await host.createTask({ prompt: '生成一份报告和一份演示文稿', materials: [] });
    await host.drain();
    expect(runner).toHaveBeenCalledTimes(1);
    expect((await host.recoverTask(taskId)).snapshot).toMatchObject({ status: 'failed', salvage: { reason: 'needs_explicit_followup' } });
  });

  it('A41 Given ordinary policy, When its actual gate rejects, Then its existing one automatic repair remains unchanged', async () => {
    const { host, runner } = setup();
    const { taskId } = await host.createTask({ prompt: '生成一份报告和一份演示文稿', materials: [] });
    await host.drain();
    expect(runner).toHaveBeenCalledTimes(2);
    expect((await host.recoverTask(taskId)).snapshot.status).toBe('completed');
  });

  it('A41 Given root has sealed, When host checks delivery, Then it never starts the model-backed custom gate', async () => {
    const completionGate = vi.fn(async () => ({ complete: true }));
    const { host } = setup({ getExecutionPolicy: () => ({ deliveryRepair: 'explicit' }), completionGate, runner: async input => {
      await input.emitRuntimeEvent({ type: 'receipt_emitted', sessionId: input.sessionId, turnId: 'turn-1', intentId: 'intent-1', stepId: 'step-1', note: 'finished response' });
    } });
    const { taskId } = await host.createTask({ prompt: '生成一份报告和一份演示文稿', materials: [] });
    await host.drain();
    expect(completionGate).not.toHaveBeenCalled();
    expect((await host.recoverTask(taskId)).snapshot.status).toBe('completed');
  });

  it('A42 Given only an opaque identity reservation, When no prepare commits, Then host files and active indexes remain empty', async () => {
    const { host, snapshotStore, runner } = setup();
    const reservation = host.reserveTaskIdentity();
    expect(reservation.taskId).toBeTruthy();
    expect(await snapshotStore.recoverTask(reservation.taskId)).toBeNull();
    expect(await host.getActiveTasks()).toEqual([]);
    expect(runner).not.toHaveBeenCalled();
  });

  it('A42 Given a binding journal gate, When prepare precedes the binding, Then no host checkpoint is written', async () => {
    const authorizePreparation = vi.fn(() => { throw new Error('multi_agent_binding_missing'); });
    const { host, snapshotStore } = setup({ authorizePreparation });
    const reservation = host.reserveTaskIdentity();
    const marker = { groupId: 'g1', rootEpoch: 1, rootTurnId: 'rt1', preparationId: 'prep1', bootId: 'boot1' };
    await expect(host.prepareTask({ prompt: 'root', materials: [] }, { reservation, marker })).rejects.toThrow('multi_agent_binding_missing');
    expect(await snapshotStore.recoverTask(reservation.taskId)).toBeNull();
    expect(await host.getActiveTasks()).toEqual([]);
    expect(authorizePreparation).toHaveBeenCalledExactlyOnceWith(reservation.taskId, marker);
  });

  it('A42 Given a journal-authorized reservation, When prepare commits, Then its trusted marker is in the same checkpoint and reservation cannot be reused', async () => {
    const { host, snapshotStore } = setup({ authorizePreparation: () => {} });
    const reservation = host.reserveTaskIdentity();
    const marker = { groupId: 'g1', rootEpoch: 1, rootTurnId: 'rt1', preparationId: 'prep1', bootId: 'boot1' };
    const prepared = await host.prepareTask({ prompt: 'root', materials: [] }, { reservation, marker });
    expect(prepared.taskId).toBe(reservation.taskId);
    expect((await snapshotStore.recoverTask(prepared.taskId))?.multiAgentPreparation).toEqual(marker);
    await expect(host.prepareTask({ prompt: 'duplicate', materials: [] }, { reservation, marker })).rejects.toThrow(/reservation/);
  });

  it('A42 Given a serialized or foreign-host reservation, When prepare is attempted, Then authorization cannot be forged with matching strings', async () => {
    const { host, snapshotStore } = setup({ authorizePreparation: () => {} });
    const reservation = host.reserveTaskIdentity();
    const marker = { groupId: 'g1', rootEpoch: 1, rootTurnId: 'rt1', preparationId: 'prep1', bootId: 'boot1' };
    await expect(host.prepareTask({ prompt: 'forged', materials: [] }, { reservation: { ...reservation }, marker })).rejects.toThrow(/reservation/);
    expect(await snapshotStore.recoverTask(reservation.taskId)).toBeNull();
  });

  it('A31/A42 Given startup admission is pending, When direct startTask is called, Then the real runner cannot run before readiness', async () => {
    let ready!: () => void;
    const barrier = new Promise<void>(resolve => { ready = resolve; });
    const { host, runner } = setup({ assertTaskAdmission: async () => barrier });
    const { taskId } = await host.prepareTask({ prompt: 'ordinary', materials: [] });
    const started = host.startTask(taskId);
    await Promise.resolve();
    expect(runner).not.toHaveBeenCalled();
    ready();
    await started;
    await host.drain();
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('A42 Given an old-boot admission rejection, When direct startTask is attempted, Then it reports rejection with zero runner calls', async () => {
    const { host, runner } = setup({ assertTaskAdmission: async () => { throw new Error('multi_agent_prepare_interrupted'); } });
    const { taskId } = await host.prepareTask({ prompt: 'stale', materials: [] });
    await expect(host.startTask(taskId)).rejects.toThrow('multi_agent_prepare_interrupted');
    await host.drain();
    expect(runner).not.toHaveBeenCalled();
    expect(host.activeExecutionCount()).toBe(0);
  });

  it('A33 Given seal won cancellation, When the real host cancelTask is called, Then no host signal/status is changed', async () => {
    const entered = deferred<void>(); const finish = deferred<void>(); let signal!: AbortSignal;
    const decideCancellation = vi.fn(async () => ({ hostAbortAllowed: false }));
    const { host } = setup({ decideCancellation, runner: async input => { signal = input.signal; entered.resolve(); await finish.promise; } });
    const { taskId } = await host.createTask({ prompt: 'root', materials: [] });
    await entered.promise;
    try {
      await host.cancelTask(taskId);
      expect(decideCancellation).toHaveBeenCalledOnce();
      expect(signal.aborted).toBe(false);
      expect((await host.recoverTask(taskId)).snapshot.status).toBe('running');
    } finally { finish.resolve(); }
    await host.drain();
    expect((await host.recoverTask(taskId)).snapshot.status).toBe('completed');
  });

  it('A33 Given cancellation authorization is unknown, When its decision throws, Then a finally block cannot abort the host', async () => {
    const entered = deferred<void>(); const finish = deferred<void>(); let signal!: AbortSignal;
    const { host } = setup({ decideCancellation: async () => { throw new Error('decision unavailable'); },
      runner: async input => { signal = input.signal; entered.resolve(); await finish.promise; } });
    const { taskId } = await host.createTask({ prompt: 'root', materials: [] });
    await entered.promise;
    try {
      await expect(host.cancelTask(taskId)).rejects.toThrow('decision unavailable');
      expect(signal.aborted).toBe(false);
    } finally { finish.resolve(); }
  });

  it('A33 Given the root is already sealed, When its host watchdog fires, Then the same cancellation decision gates that sibling path', async () => {
    const entered = deferred<void>(); const finish = deferred<void>(); let signal!: AbortSignal;
    const decideCancellation = vi.fn(async () => ({ hostAbortAllowed: false }));
    const { host } = setup({ decideCancellation, taskWatchdogMs: 20,
      runner: async input => { signal = input.signal; entered.resolve(); await finish.promise; } });
    await host.createTask({ prompt: 'root', materials: [] });
    await entered.promise;
    try {
      await vi.waitFor(() => expect(decideCancellation).toHaveBeenCalledOnce(), { timeout: 200, interval: 5 });
      expect(signal.aborted).toBe(false);
    } finally { finish.resolve(); }
  });

  it('A33 Given the root is already sealed, When shutdown requests host abortAllActive, Then it cannot bypass the root decision', async () => {
    const entered = deferred<void>(); const finish = deferred<void>(); let signal!: AbortSignal;
    const decideCancellation = vi.fn(async () => ({ hostAbortAllowed: false }));
    const { host } = setup({ decideCancellation,
      runner: async input => { signal = input.signal; entered.resolve(); await finish.promise; } });
    await host.createTask({ prompt: 'root', materials: [] });
    await entered.promise;
    try {
      host.abortAllActive('app_shutdown');
      await vi.waitFor(() => expect(decideCancellation).toHaveBeenCalledOnce(), { timeout: 200, interval: 5 });
      expect(signal.aborted).toBe(false);
    } finally { finish.resolve(); }
  });

  it('A42 Given an old prepared host checkpoint, When main recovery compensates it, Then it fails durably without running and ordinary checkpoints are untouched', async () => {
    const { host, runner } = setup({ authorizePreparation: () => {} });
    const reservation = host.reserveTaskIdentity();
    const marker = { groupId: 'g1', rootEpoch: 1, rootTurnId: 'rt1', preparationId: 'prep1', bootId: 'old' };
    await host.prepareTask({ prompt: 'root', materials: [] }, { reservation, marker });
    const ordinary = await host.prepareTask({ prompt: 'ordinary', materials: [] });
    const expected = await host.inspectTask(reservation.taskId);
    expect(expected?.status).toBe('understanding');
    await host.abandonMultiAgentPreparation({ requestSource: 'scheduler', taskId: reservation.taskId, expectedMarker: marker });
    expect((await host.inspectTask(reservation.taskId))?.salvage?.reason).toBe('multi_agent_prepare_interrupted');
    expect((await host.inspectTask(reservation.taskId))?.status).toBe('failed');
    expect((await host.inspectTask(ordinary.taskId))?.status).toBe('understanding');
    expect(runner).not.toHaveBeenCalled();
  });

  it('A42 Given an unrelated or agent-requested compensation, When it is attempted, Then no checkpoint is modified', async () => {
    const { host } = setup({ authorizePreparation: () => {} });
    const reservation = host.reserveTaskIdentity();
    const marker = { groupId: 'g1', rootEpoch: 1, rootTurnId: 'rt1', preparationId: 'prep1', bootId: 'old' };
    await host.prepareTask({ prompt: 'root', materials: [] }, { reservation, marker });
    await expect(host.abandonMultiAgentPreparation({ requestSource: 'agent', taskId: reservation.taskId, expectedMarker: marker })).rejects.toThrow(/permitted/);
    await expect(host.abandonMultiAgentPreparation({ requestSource: 'scheduler', taskId: reservation.taskId, expectedMarker: { ...marker, preparationId: 'foreign' } })).rejects.toThrow(/mismatch/);
    expect((await host.inspectTask(reservation.taskId))?.status).toBe('understanding');
  });

  it('A42 Given independent host boots, When default root identities are reserved, Then they cannot reuse the same ordinal task ID', () => {
    const first = setup(); const second = setup();
    expect(first.host.reserveTaskIdentity().taskId).not.toBe(second.host.reserveTaskIdentity().taskId);
  });
});
