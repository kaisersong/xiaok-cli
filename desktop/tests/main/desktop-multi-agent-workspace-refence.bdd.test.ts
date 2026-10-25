// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { compileProtectionWorkerEntry } from '../fixtures/desktop-protection-worker-entry.js';
import { join } from 'node:path';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { DesktopExecutionCoordinator, type ExecutionLease } from '../../electron/desktop-execution-coordinator.js';
import type { DesktopAgentExecutionContext } from '../../electron/desktop-multi-agent-service.js';
import { authorizationFixture, authorizationRequest, deferred } from '../fixtures/multi-agent-authorization.js';

const nativeProtection = vi.hoisted(() => ({ output: '', root: '', starts: 0, exits: 0 }));
vi.mock('node:worker_threads', async importOriginal => {
  const actual = await importOriginal<typeof import('node:worker_threads')>();
  const source = new URL('../../../src/runtime/task-host/protection-read-worker.ts', import.meta.url).href;
  return { ...actual, Worker: class extends actual.Worker {
    constructor(filename: ConstructorParameters<typeof actual.Worker>[0], options?: ConstructorParameters<typeof actual.Worker>[1]) {
      const mapped = String(filename) === source;
      if (mapped && !nativeProtection.output) throw Error('fresh fixed protection Worker required');
      super(mapped ? nativeProtection.output : filename, options);
      if (mapped) { nativeProtection.starts++; this.once('exit', () => nativeProtection.exits++); }
    }
  } };
});
beforeAll(async () => { Object.assign(nativeProtection, await compileProtectionWorkerEntry()); });
afterAll(() => {
  try { expect(nativeProtection.exits).toBe(nativeProtection.starts); }
  finally { if (nativeProtection.root) rmSync(nativeProtection.root, { recursive: true, force: true, maxRetries: 3 }); }
});

// Hold the original FileStore's real journal append, not cancellation policy.
// The original native fs operation still runs once the controlled IO is released.
const disk = vi.hoisted(() => ({ taskId: '', entered: undefined as (() => void) | undefined,
  release: undefined as Promise<void> | undefined, salvageDispatches: 0, salvageWrites: 0, newTaskId: '', newSnapshotPrefix: '', newWrites: [] as number[] }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, writeFile: (...args: Parameters<typeof actual.writeFile>) => {
    if (disk.newTaskId && String(args[0]).startsWith(disk.newSnapshotPrefix) && String(args[0]).endsWith('.tmp')) disk.newWrites.push(disk.salvageWrites);
    return actual.writeFile(...args);
  }, appendFile: async (...args: Parameters<typeof actual.appendFile>) => {
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
  groups: Map<string, { root?: { ticket?: ExecutionLease; started: boolean; context?: DesktopAgentExecutionContext }; lifetime: AbortController; frozen?: string }> };

describe('BDD W6/W9: distinct revokes reuse existing cancellation and ticket owners', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    vi.useRealTimers();
    for (const action of cleanup.splice(0).reverse()) await action();
    vi.restoreAllMocks(); vi.unstubAllEnvs();
    disk.taskId = ''; disk.entered = undefined; disk.release = undefined;
    disk.salvageDispatches = 0; disk.salvageWrites = 0; disk.newTaskId = ''; disk.newSnapshotPrefix = ''; disk.newWrites = [];
  });

  it('revoke A, grant B, revoke C may call the old pending host twice, but commit one cancellation, retain its live ticket, and cancel the new queued group', async () => {
    const f = await authorizationFixture(cleanup), service = f.boundary.service;
    const internals = service as unknown as Internals, host = internals.host, coordinator = internals.options.coordinator;
    // Register both real thread owners before the old host read is deliberately held.
    await service.registerThreadWithOwnership({ ...f.boundary, threadId: 'refence-old' }, 'user');
    await service.registerThreadWithOwnership({ ...f.boundary, threadId: 'refence-new' }, 'user');
    const modelEntered = deferred(), releaseModel = deferred(), stopEntered = deferred(), releaseStop = deferred();
    cleanup.push(() => { releaseModel.resolve(); releaseStop.resolve(); });
    let modelCalls = 0, aborts = 0;
    const effect = join(f.root, 'must-not-be-written-after-revoke.txt');
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
      modelCalls++; modelEntered.resolve(); await releaseModel.promise;
      yield { type: 'tool_use', id: 'late-revoked-write', name: 'write', input: { file_path: effect, content: 'forbidden' } };
    });
    const old = await f.services.createTask({ prompt: 'Wait for the controlled response.', materials: [], permissionMode: 'auto', context: { threadId: 'refence-old' } });
    await modelEntered.promise;
    const context = internals.groups.get(f.store.getRootBinding(old.taskId)!.groupId)!.root!.context!;
    expect(context).toBeDefined(); context.signal.addEventListener('abort', () => { aborts++; });
    const oldGroup = internals.groups.get(context.groupId)!, ticket = context.memberTicket;
    const oldRevision = f.store.requireGroup(context.groupId).permissionRevision;
    const oldLifetime = oldGroup.lifetime;
    expect(coordinator.snapshot()).toMatchObject({ active: 1, waiting: 0 }); expect(ticket.refCount).toBe(1);
    disk.taskId = old.taskId; disk.entered = stopEntered.resolve; disk.release = releaseStop.promise;
    const cancel = vi.spyOn(host, 'cancelTask');
    const decision = vi.spyOn(service, 'decideHostCancellation');
    // Freeze only watchdog timers; native FS, SQLite and Promise queues remain real.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const a = authorizationRequest(await f.getAuthorization(), false, 'revoke-a');
    expect(await f.setAuthorization(a)).toMatchObject({ state: 'applied', permissionRevision: 1 });
    await stopEntered.promise;
    expect(f.store.getRootBinding(old.taskId)).toMatchObject({ phase: 'abandoned', status: 'interrupted' });
    const rootStatusEvents = () => f.store.readEvents(context.groupId, 0, 100).filter(event => event.kind === 'status'
      && event.agentId === context.agentId && (event.payload.agent as { status?: string } | undefined)?.status === 'interrupted');
    expect(rootStatusEvents()).toHaveLength(1);
    expect(disk.salvageDispatches).toBe(1); expect(disk.salvageWrites).toBe(0);
    expect(host.inFlightTaskIds()).toContain(old.taskId); expect(ticket.released).toBe(false);
    expect(await f.setAuthorization(a)).toMatchObject({ state: 'applied', permissionRevision: 1 });
    expect(cancel.mock.calls.filter(([id]) => id === old.taskId)).toHaveLength(1);
    expect(await f.setAuthorization(authorizationRequest(await f.getAuthorization(), true, 'grant-b'))).toMatchObject({ permissionRevision: 2, executionAllowed: true });
    const saveEntered=deferred();
    const originalSave=FileTaskSnapshotStore.prototype.save;
    let firstNewSave: Promise<void> | undefined, newSaveSettled=false;
    vi.spyOn(FileTaskSnapshotStore.prototype,'save').mockImplementation(function(this:FileTaskSnapshotStore,snapshot,previous){
      const raw=originalSave.call(this,snapshot,previous);
      if(snapshot.context?.threadId==='refence-new'&&!firstNewSave){firstNewSave=raw;void raw.then(()=>{newSaveSettled=true;},()=>{newSaveSettled=true;});disk.newTaskId=snapshot.taskId;disk.newSnapshotPrefix=join(f.root,'data','tasks','snapshots',snapshot.taskId+'.json.');saveEntered.resolve();}
      return raw;
    });
    const nextPending=f.services.createTask({ prompt: 'This new user task must remain behind the old live lease.', materials: [], permissionMode: 'auto', context: { threadId: 'refence-new' } });
    let nextSettled=false;void nextPending.then(()=>{nextSettled=true;},()=>{nextSettled=true;});
    await saveEntered.promise;
    expect(nextSettled).toBe(false);expect(newSaveSettled).toBe(false);expect(disk.newWrites).toEqual([]);expect(disk.salvageWrites).toBe(0);
    expect(coordinator.snapshot()).toMatchObject({active:1,waiting:0});expect(ticket.refCount).toBe(1);expect(modelCalls).toBe(1);
    // A separate actual store has its own writerQueue and must reach the real
    // root lock. Preserve the current snapshot; no old state is written back.
    const secondStore=new FileTaskSnapshotStore(join(f.root,'data','tasks'));
    const heldSnapshot=await secondStore.recoverTask(old.taskId);expect(heldSnapshot).toBeTruthy();
    await expect(secondStore.save(heldSnapshot!)).rejects.toThrow('session_save_locked');
    expect(existsSync(join(f.root,'data','tasks','.task-store.save.lock'))).toBe(true);
    expect(disk.salvageWrites).toBe(0);expect(disk.newWrites).toEqual([]);
    releaseStop.resolve();
    const next=await nextPending;
    expect(newSaveSettled).toBe(true);expect(disk.newWrites).toEqual([1]);
    const nextBinding = f.store.getRootBinding(next.taskId)!;
    expect(nextBinding.groupId).not.toBe(context.groupId);
    expect(f.store.requireGroup(nextBinding.groupId).permissionRevision).toBe(2);
    expect(coordinator.snapshot()).toMatchObject({ active: 1, waiting: 1 }); expect(modelCalls).toBe(1);
    expect(await f.setAuthorization(authorizationRequest(await f.getAuthorization(), false, 'revoke-c'))).toMatchObject({ permissionRevision: 3, executionAllowed: false });
    // The calls really happen. Their physical/durable effects are checked below,
    // rather than treating a repeated idempotent call as a resource debit.
    expect(cancel.mock.calls.filter(([id]) => id === old.taskId)).toHaveLength(2);
    expect(cancel.mock.calls.filter(([id]) => id === next.taskId)).toHaveLength(1);
    expect(coordinator.snapshot()).toMatchObject({ active: 1, waiting: 0 });
    expect(ticket.refCount).toBe(1); expect(ticket.released).toBe(false); expect(aborts).toBe(1);
    expect(oldGroup.lifetime).toBe(oldLifetime); expect(oldLifetime.signal.aborted).toBe(true);
    expect(f.store.requireGroup(context.groupId)).toMatchObject({ permissionRevision: oldRevision, mutationBlockedReason: 'permission_revoked' });
    expect(f.store.requireGroup(nextBinding.groupId)).toMatchObject({ permissionRevision: 2, mutationBlockedReason: 'permission_revoked' });
    expect(disk.salvageDispatches).toBe(1); expect(disk.salvageWrites).toBe(1);
    await Promise.all(cancel.mock.results.map(result => result.value));
    const cold = await new FileTaskSnapshotStore(join(f.root, 'data', 'tasks')).recoverTask(old.taskId);
    expect(cold?.status).toBe('cancelled'); expect(cold?.events.filter(event => event.type === 'salvage')).toHaveLength(1);
    expect(rootStatusEvents()).toHaveLength(1); expect(disk.salvageWrites).toBe(1);
    const stopRequestEventsBeforeSettle = rootStatusEvents().length;
    expect(host.inFlightTaskIds()).toContain(old.taskId); expect(ticket.refCount).toBe(1);
    const oldDecisions = await Promise.all(decision.mock.results.flatMap((result, index) =>
      decision.mock.calls[index]![0].taskId === old.taskId ? [result.value] : []));
    expect(oldDecisions.filter(value => value.hostAbortAllowed)).toHaveLength(1);
    releaseModel.resolve(); await host.drain();
    expect(coordinator.snapshot()).toMatchObject({ active: 0, waiting: 0 }); expect(ticket.refCount).toBe(0);
    expect(modelCalls).toBe(1); expect(existsSync(effect)).toBe(false);
    console.log('WORKSPACE_REFENCE_REAL_OWNERS', { oldHostCalls: 2, newHostCalls: 1, oldDecisions,
      oldSalvageNativeWrites: disk.salvageWrites, stopRequestEventsBeforeSettle,
      rootStatusFactsAfterPhysicalSettle: rootStatusEvents().length,
      actualAborts: aborts, modelCalls, finalLease: coordinator.snapshot(), oldRevision, newRevision: 2 });
    vi.useRealTimers(); await f.services.disposeMultiAgent();
    await f.services.closeTaskSourceWritersForMigration();
    const releasedStore=new FileTaskSnapshotStore(join(f.root,'data','tasks'));
    const releasedSnapshot=await releasedStore.recoverTask(old.taskId);expect(releasedSnapshot?.status).toBe('cancelled');
    await releasedStore.save(releasedSnapshot!);

  });

  it('one revoke already reaches release through fence and cancelRootTurn, but the original prepared ticket is debited only once', async () => {
    const f = await authorizationFixture(cleanup), service = f.boundary.service, internals = service as unknown as Internals;
    await service.registerThreadWithOwnership({ ...f.boundary, threadId: 'prepared-ticket' }, 'user');
    const created = await service.prepareRoot(internals.host, 'prepared-ticket', { prompt: 'Prepared but not started.', materials: [], permissionMode: 'auto', context: { threadId: 'prepared-ticket' } });
    const binding = f.store.getRootBinding(created.taskId)!, root = internals.groups.get(binding.groupId)!.root!;
    expect(root.started).toBe(false); const ticket = root.ticket!; expect(ticket.refCount).toBe(1);
    const release = vi.spyOn(ticket, 'release'), cancel = vi.spyOn(internals.host, 'cancelTask');
    await f.setAuthorization(authorizationRequest(await f.getAuthorization(), false, 'prepared-revoke'));
    await Promise.all(cancel.mock.results.map(result => result.value));
    expect(release).toHaveBeenCalledTimes(2);
    expect(ticket.refCount).toBe(0); expect(ticket.released).toBe(true);
    expect(internals.options.coordinator.snapshot()).toMatchObject({ active: 0, waiting: 0 });
    expect((await new FileTaskSnapshotStore(join(f.root, 'data', 'tasks')).recoverTask(created.taskId))?.events.filter(event => event.type === 'salvage')).toHaveLength(1);
    console.log('WORKSPACE_PREPARED_TICKET_REAL_ACCOUNTING', { releaseCalls: release.mock.calls.length,
      finalRefCount: ticket.refCount, capacity: internals.options.coordinator.snapshot() });
  });
});
