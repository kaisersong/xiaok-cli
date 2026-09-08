// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import type { DesktopAgentExecutionContext } from '../../electron/desktop-multi-agent-service.js';
import type { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { authorizationFixture, authorizationRequest, deferred } from '../fixtures/multi-agent-authorization.js';

const disk = vi.hoisted(() => ({ taskId: '', entered: undefined as (() => void) | undefined,
  release: undefined as Promise<void> | undefined, salvageDispatches: 0, salvageWrites: 0 }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, appendFile: async (...args: Parameters<typeof actual.appendFile>) => {
    const payload = typeof args[1] === 'string' && String(args[0]).endsWith('.journal.jsonl')
      ? JSON.parse(args[1]) as { taskId?: string; events?: Array<{ type?: string }> } : undefined;
    const held = payload?.taskId === disk.taskId && payload.events?.some(event => event.type === 'salvage');
    if (held) { disk.salvageDispatches++; disk.entered?.(); await disk.release; }
    const result = await actual.appendFile(...args);
    if (held) disk.salvageWrites++;
    return result;
  } };
});

type Internals = { host: InProcessTaskRuntimeHost; options: { coordinator: DesktopExecutionCoordinator };
  groups: Map<string, { root?: { context?: DesktopAgentExecutionContext }; lifetime: AbortController; frozen?: string }> };

describe('BDD: root cancellation keeps one settlement owner even if its first native SQLite transaction rolls back', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    vi.useRealTimers();
    for (const action of cleanup.splice(0).reverse()) await action();
    vi.restoreAllMocks(); vi.unstubAllEnvs();
    disk.taskId = ''; disk.entered = undefined; disk.release = undefined;
    disk.salvageDispatches = 0; disk.salvageWrites = 0;
  });

  it('W6/W9 a rollback before the first host salvage cannot authorize a second settlement after grant and a distinct revoke', async () => {
    const f = await authorizationFixture(cleanup), service = f.boundary.service, internals = service as unknown as Internals;
    const host = internals.host, coordinator = internals.options.coordinator;
    const modelEntered = deferred(), releaseModel = deferred(), stopEntered = deferred(), releaseStop = deferred();
    cleanup.push(() => { releaseModel.resolve(); releaseStop.resolve(); });
    const effect = join(f.root, 'rollback-late-tool-must-not-run.txt');
    let modelCalls = 0;
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
      modelCalls++; modelEntered.resolve(); await releaseModel.promise;
      yield { type: 'tool_use', id: 'late-after-rollback', name: 'write', input: { file_path: effect, content: 'forbidden' } };
    });
    const task = await f.services.createTask({ prompt: 'Wait at the original model boundary.', materials: [], permissionMode: 'auto', context: { threadId: 'rollback-refence' } });
    await modelEntered.promise;
    const originalBinding = f.store.getRootBinding(task.taskId)!, live = internals.groups.get(originalBinding.groupId)!;
    const context = live.root!.context!, ticket = context.memberTicket;
    let aborts = 0; context.signal.addEventListener('abort', () => { aborts++; });
    disk.taskId = task.taskId; disk.entered = stopEntered.resolve; disk.release = releaseStop.promise;
    const cancel = vi.spyOn(host, 'cancelTask'), decide = vi.spyOn(service, 'decideHostCancellation');
    let touchedRoot = false, deniedCommits = 0, rollbacks = 0;
    // SQLite itself denies only the first COMMIT which changed root_turns.
    // Authorization COMMITs touch their own table/groups and remain permitted.
    f.db.setAuthorizer((action, name) => {
      if (action === 22 && name === 'BEGIN') touchedRoot = false;
      if ((action === 18 || action === 23) && name === 'root_turns') touchedRoot = true;
      if (action === 22 && name === 'ROLLBACK') rollbacks++;
      if (action === 22 && name === 'COMMIT' && touchedRoot && deniedCommits === 0) { deniedCommits++; return 1; }
      return 0;
    });
    cleanup.push(() => f.db.setAuthorizer(null));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    expect(await f.setAuthorization(authorizationRequest(await f.getAuthorization(), false, 'rollback-a'))).toMatchObject({ state: 'applied', permissionRevision: 1, executionAllowed: false });
    await stopEntered.promise;
    f.db.setAuthorizer(null);
    expect(deniedCommits).toBe(1); expect(rollbacks).toBe(1);
    expect(f.store.getRootBinding(task.taskId)).toEqual(originalBinding);
    expect(disk.salvageDispatches).toBe(1); expect(disk.salvageWrites).toBe(0);
    expect(await decide.mock.results[0]!.value).toEqual({ hostAbortAllowed: true, ack: 'unknown' });
    expect(await f.setAuthorization(authorizationRequest(await f.getAuthorization(), true, 'rollback-b'))).toMatchObject({ state: 'applied', permissionRevision: 2, executionAllowed: true });
    expect(await f.setAuthorization(authorizationRequest(await f.getAuthorization(), false, 'rollback-c'))).toMatchObject({ state: 'applied', permissionRevision: 3, executionAllowed: false });
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(aborts).toBe(1); expect(ticket.refCount).toBe(1); expect(coordinator.snapshot().active).toBe(1);
    releaseStop.resolve();
    const stops = await Promise.allSettled(cancel.mock.results.map(result => result.value));
    const decisions = await Promise.all(decide.mock.results.map(result => result.value));
    const cold = await new FileTaskSnapshotStore(join(f.root, 'data', 'tasks')).recoverTask(task.taskId);
    const salvages = cold?.events.filter(event => event.type === 'salvage') ?? [];
    console.log('WORKSPACE_REFENCE_NATIVE_ROLLBACK', { deniedCommits, rollbacks, decisions,
      stopStates: stops.map(result => result.status), coldStatus: cold?.status,
      nativeSalvageWrites: disk.salvageWrites, coldSalvages: salvages.length, aborts,
      physicalBeforeModelExit: { live: host.inFlightTaskIds().includes(task.taskId), refCount: ticket.refCount, capacity: coordinator.snapshot() } });
    // Actual production effects, not a rule that an idempotent method is only
    // callable once. Keep later physical settlement checks running on the red.
    expect.soft(disk.salvageWrites).toBe(1); expect.soft(salvages).toHaveLength(1);
    expect(stops.some(result => result.status === 'rejected')).toBe(true);
    expect(host.inFlightTaskIds()).toContain(task.taskId); expect(ticket.released).toBe(false);
    expect(f.store.requireGroup(context.groupId)).toMatchObject({ permissionRevision: 0, mutationBlockedReason: 'permission_revoked' });
    releaseModel.resolve(); await host.drain();
    expect(coordinator.snapshot()).toMatchObject({ active: 0, waiting: 0 }); expect(ticket.refCount).toBe(0);
    expect(modelCalls).toBe(1); expect(existsSync(effect)).toBe(false);
  });

  it('the real main expiry command cannot persist two cancellations for the same live source and epoch', async () => {
    const f = await authorizationFixture(cleanup), service = f.boundary.service, internals = service as unknown as Internals;
    const host = internals.host;
    // Configure an explicit test policy before any lease is acquired; the
    // actual factory coordinator and cancellation owner are not substituted.
    Object.defineProperty(internals.options.coordinator, 'multiAgentLeaseMs', { value: 30 * 60_000 });
    const modelEntered = deferred(), releaseModel = deferred(), stopEntered = deferred(), releaseStop = deferred();
    cleanup.push(() => { releaseModel.resolve(); releaseStop.resolve(); });
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
      modelEntered.resolve(); await releaseModel.promise; yield { type: 'text', delta: 'late' };
    });
    const task = await f.services.createTask({ prompt: 'Stay in the original provider until expiry.', materials: [], permissionMode: 'auto', context: { threadId: 'expiry-refence' } });
    await modelEntered.promise;
    const binding = f.store.getRootBinding(task.taskId)!, context = internals.groups.get(binding.groupId)!.root!.context!;
    const ticket = context.memberTicket;
    disk.taskId = task.taskId; disk.entered = stopEntered.resolve; disk.release = releaseStop.promise;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(ticket.deadlineAt! + 1);
    cleanup.push(() => clock.mockRestore());
    const decide = vi.spyOn(service, 'decideHostCancellation');
    // Exercise the actual main-only command used by both installLease's timer
    // and expireApprovalActor. This is not a fake duplicate timer callback and
    // does not claim to reproduce the full approval UI scheduling overlap.
    const command = { requestSource: 'scheduler' as const, groupId: binding.groupId, leaseEpoch: ticket.epoch };
    const first = service.expireLease(command); await stopEntered.promise;
    expect(f.store.getRootBinding(task.taskId)).toMatchObject({ phase: 'abandoned' });
    const second = service.expireLease(command);
    releaseStop.resolve(); await Promise.all([first, second]);
    const decisions = await Promise.all(decide.mock.results.map(result => result.value));
    const cold = await new FileTaskSnapshotStore(join(f.root, 'data', 'tasks')).recoverTask(task.taskId);
    console.log('LEASE_EXPIRY_CANCELLATION_OWNER', { decisions, nativeSalvageWrites: disk.salvageWrites,
      coldSalvages: cold?.events.filter(event => event.type === 'salvage').length, refCount: ticket.refCount });
    expect.soft(disk.salvageWrites).toBe(1);
    expect.soft(cold?.events.filter(event => event.type === 'salvage')).toHaveLength(1);
    expect(host.inFlightTaskIds()).toContain(task.taskId); expect(ticket.released).toBe(false);
    releaseModel.resolve(); await host.drain(); expect(ticket.refCount).toBe(0);
  });

  it('the actual unbound host sibling must persist one cancellation for two concurrent public cancelTask callers', async () => {
    const f = await authorizationFixture(cleanup), internals = f.boundary.service as unknown as Internals;
    const task = await internals.host.prepareTask({ prompt: 'Ordinary prepared host task without a multi-agent binding.', materials: [] });
    expect(f.store.getRootBinding(task.taskId)).toBeNull();
    const stopEntered = deferred(), releaseStop = deferred(); cleanup.push(() => releaseStop.resolve());
    disk.taskId = task.taskId; disk.entered = stopEntered.resolve; disk.release = releaseStop.promise;
    const first = f.services.cancelTask(task.taskId); await stopEntered.promise;
    const second = f.services.cancelTask(task.taskId); releaseStop.resolve();
    await Promise.all([first, second]);
    const cold = await new FileTaskSnapshotStore(join(f.root, 'data', 'tasks')).recoverTask(task.taskId);
    console.log('ORDINARY_CANCELLATION_SIBLING', { nativeSalvageWrites: disk.salvageWrites,
      coldSalvages: cold?.events.filter(event => event.type === 'salvage').length, status: cold?.status });
    // The same host writer is in scope; authorization is allowed to run twice.
    // This does not require a second queue or an ordinary-runtime redesign.
    expect.soft(disk.salvageWrites).toBe(1);
    expect.soft(cold?.events.filter(event => event.type === 'salvage')).toHaveLength(1);
  });
});
