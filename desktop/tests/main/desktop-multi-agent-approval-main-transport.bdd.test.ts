// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import type { Tool, ToolExecutionContext, ToolPermissionGrant } from '../../../src/types.js';
import { mcpTestContext } from '../../../tests/support/mcp-cancellation-context.js';
import { DesktopCapabilityCatalog, type DesktopInvocationAuthority } from '../../electron/desktop-multi-agent-capabilities.js';
import { DesktopMultiAgentStore, encodeMultiAgentRow } from '../../electron/desktop-multi-agent-store.js';
import { DesktopMultiAgentService, type DesktopAgentExecutionContext } from '../../electron/desktop-multi-agent-service.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { failNextApprovalCommit, type SqliteWithAuthorizer } from '../fixtures/multi-agent-authorization.js';

const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; };
type Request = {
  invocation: object; descriptor: { capabilityId: string; revision: number }; tool: Tool; toolName: string;
  input: Record<string, unknown>; toolContext: ToolExecutionContext; issuedAt: number; minDeadlineAt: number;
  assertCurrent(): void; subscribeInvalidated(listener: (reason: string) => void): () => void;
};
const moduleUrl = new URL('../../electron/desktop-multi-agent-approval-transport.ts', import.meta.url);
const implementationPresent = existsSync(moduleUrl);

describe('BDD AP main-only catalog request port (actual Registry, no replacement transport)', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); });
  function scoped(requestApproval: (request: Request) => Promise<unknown>, options: { autoMode?: boolean; beforeOpaqueInvocation?(): Promise<void> } = {}) {
    const catalog = new DesktopCapabilityCatalog(), effect = vi.fn(async (_input: Record<string, unknown>) => 'actual-effect');
    const descriptor = catalog.publish({ requestSource: 'scheduler', ownerId: 'main-owner', entry: {
      definition: { name: 'write', description: 'actual bound fixture', inputSchema: { type: 'object', properties: {} } }, aliases: ['write_alias'], permission: 'write',
      scope: { workspaceId: 'workspace', materialIds: [], permissions: ['write'] }, bindInvocation: () => effect,
    } });
    catalog.authorize({ requestSource: 'user', capabilityId: descriptor.capabilityId });
    const authority = { groupId: 'group', agentId: 'actual-child', turnId: 'actual-turn', cwd: process.cwd(), workspaceId: 'workspace', materialIds: [],
      permissionRevision: 0, signal: new AbortController().signal, deadlineAt: Date.now() + 120_000,
      getApprovalDeadline: () => Date.now() + 60_000,
      requestApproval: requestApproval as unknown as NonNullable<DesktopInvocationAuthority['requestApproval']>, beforeOpaqueInvocation: options.beforeOpaqueInvocation };
    const scope = catalog.createScopedRegistry(catalog.snapshotPolicy(), authority, { autoMode: options.autoMode ?? false });
    cleanup.push(() => scope.dispose()); return { catalog, descriptor, scope, effect };
  }
  it.each(['write', 'write_alias'])('AP1/AP2 %s passes the exact resolved instance, private caller context and actual alias to the formal port', async name => {
    const request = vi.fn(async (_input: Request) => false), f = scoped(request);
    const context = mcpTestContext(new AbortController().signal), input = { content: 'private actual input' };
    await f.scope.registry.executeTool(name, input, context);
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0]).toMatchObject({ descriptor: f.descriptor, toolName: name, input, toolContext: context });
    expect(request.mock.calls[0][0].tool).toBe(f.scope.registry.getRegisteredTool(name));
    expect(f.effect).not.toHaveBeenCalled();
  });
  it('AP3 the formal transport owns the only timer; Catalog does not start its legacy approval timeout', async () => {
    const release = deferred<false>(), request = vi.fn(() => release.promise), f = scoped(request), timers = vi.spyOn(globalThis, 'setTimeout');
    const running = f.scope.registry.executeTool('write', {}, mcpTestContext(new AbortController().signal));
    try { for (let tick = 0; tick < 12 && !request.mock.calls.length; tick++) await Promise.resolve();
      expect(request).toHaveBeenCalledOnce(); expect(timers).not.toHaveBeenCalled();
    } finally { release.resolve(false); await running; }
  });
  it('AP2 no full internal tool context is a stable formal denial, never a fabricated root context', async () => {
    const request = vi.fn(async () => false), f = scoped(request);
    await expect(f.scope.registry.executeTool('write', {})).rejects.toThrow('approval_context_unavailable');
    expect(request).not.toHaveBeenCalled(); expect(f.effect).not.toHaveBeenCalled();
  });
  it('AP4 only the original descriptor subscription invalidates when its slot changes', async () => {
    const listener = vi.fn(), request = vi.fn(async (input: Request) => { cleanup.push(input.subscribeInvalidated(listener)); return false; }), f = scoped(request);
    await f.scope.registry.executeTool('write', {}, mcpTestContext(new AbortController().signal));
    expect(request).toHaveBeenCalledOnce();
    f.catalog.publish({ requestSource: 'scheduler', ownerId: f.descriptor.ownerId, slotId: f.descriptor.slotId, entry: f.descriptor });
    expect(listener).toHaveBeenCalledExactlyOnceWith('descriptor_changed');
    f.scope.dispose(); expect(listener).toHaveBeenCalledTimes(1);
  });
  it('AP2 identical input and repeated provider call ID still create distinct internal invocations', async () => {
    const request = vi.fn(async (_input: Request) => false), f = scoped(request);
    const context = Object.assign(mcpTestContext(new AbortController().signal), { toolInvocationId: 'same-model-id' });
    await f.scope.registry.executeTool('write', {}, context); await f.scope.registry.executeTool('write', {}, context);
    expect(request).toHaveBeenCalledTimes(2); expect(request.mock.calls[0][0].invocation).not.toBe(request.mock.calls[1][0].invocation);
  });
  it('AP2 a formal port cannot grant through a bare true (CLI boolean compatibility is a separate branch)', async () => {
    const request = vi.fn(async () => true), f = scoped(request);
    await f.scope.registry.executeTool('write', {}, mcpTestContext(new AbortController().signal));
    expect(request).toHaveBeenCalledOnce(); expect(f.effect).not.toHaveBeenCalled();
  });
  it('AP8 the main-only observer marks only actual post-journal dispatch', async () => {
    const entered = deferred<void>(), release = deferred<void>(), observed = vi.fn();
    const f = scoped(async () => false, { autoMode: true, beforeOpaqueInvocation: async () => { entered.resolve(); await release.promise; } });
    const context = Object.assign(mcpTestContext(new AbortController().signal), { onToolInvocationStarted: observed });
    const running = f.scope.registry.executeTool('write', {}, context);
    try { await entered.promise; expect(observed).not.toHaveBeenCalled(); expect(f.effect).not.toHaveBeenCalled(); }
    finally { release.resolve(); await running; }
    expect(observed).toHaveBeenCalledOnce(); expect(f.effect).toHaveBeenCalledOnce();
  });
});

describe('BDD AP formal transport availability', () => {
  it('the main-only production producer exists (this single missing-class contract is not the behavioral red matrix)', () => {
    expect(implementationPresent).toBe(true);
  });
});

// These downstream cases are explicitly not reached before the producer exists.
// No test-side waiter, reducer, grant or store implementation substitutes for it.
describe.skipIf(!implementationPresent)('BDD AP real transport + Service + SQLite + Registry', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); });
  async function setup(extras: { beforeOpaqueInvocation?(): void | Promise<void> } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-approval-main-')); cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite')); cleanup.push(() => store.close());
    const service = new DesktopMultiAgentService({ store, coordinator: new DesktopExecutionCoordinator(), createSession: vi.fn() });
    service.registerThread({ threadId: 'thread', profileId: 'profile', workspaceId: 'workspace', cwd: root });
    const entered = deferred<DesktopAgentExecutionContext>(), release = deferred<void>();
    const host = new InProcessTaskRuntimeHost({ snapshotStore: new FileTaskSnapshotStore(join(root, 'tasks')),
      materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 * 1024 }),
      authorizePreparation: (id, marker) => service.assertHostPreparation(id, marker), assertTaskAdmission: snapshot => service.assertHostAdmission(snapshot),
      decideCancellation: (snapshot, reason) => service.decideHostCancellation(snapshot, reason),
      runner: input => service.runRoot(input, async context => { entered.resolve(context); await release.promise; throw new Error('fixture cleanup'); }),
    });
    await service.initialize(host); const task = await service.prepareRoot(host, 'thread', { prompt: 'fixture', materials: [] }); await host.startTask(task.taskId);
    const context = await entered.promise;
    const production = await import(/* @vite-ignore */ moduleUrl.href);
    const transport = new production.DesktopMultiAgentApprovalTransport({ store, service });
    const catalog = new DesktopCapabilityCatalog(), effect = vi.fn(async (input: Record<string, unknown>) => JSON.stringify(input));
    const descriptor = catalog.publish({ requestSource: 'scheduler', ownerId: 'tool-owner', entry: {
      definition: { name: 'write', description: 'transport actual effect', inputSchema: { type: 'object', properties: {} } }, aliases: [], permission: 'write',
      scope: { workspaceId: 'workspace', materialIds: [], permissions: ['write'] }, bindInvocation: () => effect,
    } }); catalog.authorize({ requestSource: 'user', capabilityId: descriptor.capabilityId });
    const scope = catalog.createScopedRegistry(catalog.snapshotPolicy(), { ...context, workspaceId: 'workspace', materialIds: [], deadlineAt: context.effectiveDeadline,
      assertCurrent: () => service.assertInvocation(context.actor, context), getApprovalDeadline: () => service.getApprovalDeadline(context.actor), ...extras,
      requestApproval: (invocation: unknown) => transport.requestApproval({ context, invocation }),
    }, { autoMode: false });
    const access = service.createUserAccess({ requestSource: 'user', actorId: 'real-user', threadId: 'thread', profileId: 'profile', workspaceId: 'workspace' });
    cleanup.push(async () => { await transport.dispose(); scope.dispose(); await host.cancelTask(task.taskId); release.resolve(); await host.drain(); await service.dispose(); });
    const db = (store as unknown as { db: SqliteWithAuthorizer }).db;
    const pending = async () => {
      await vi.waitFor(() => expect(transport.getGroupProjection(context.groupId).pendingApprovals).toHaveLength(1));
      return transport.getGroupProjection(context.groupId).pendingApprovals[0];
    };
    const decide = (approvalId: string, operationId: string, decision = 'approve', overrides = {}) => transport.decideApproval({
      access, requestSource: 'user', groupId: context.groupId, approvalId, operationId, decision, ...overrides,
    });
    const get = (approvalId: string, inputOffset?: number) => transport.getApproval({ access, requestSource: 'user', groupId: context.groupId, approvalId, ...(inputOffset === undefined ? {} : { inputOffset }) });
    const execute = (input: Record<string, unknown> = { content: 'PRIVATE_INPUT' }) => scope.registry.executeTool('write', input, mcpTestContext(context.signal));
    return { root, store, service, host, context, transport, catalog, descriptor, scope, effect, db, pending, decide, get, execute, access };
  }

  it.each(['approve', 'deny'])('AP1/AP5 %s commits the real request/terminal/event/count once with no private DTO leak', async decision => {
    const f = await setup(), running = f.execute(), pending = await f.pending();
    const before = f.store.getThread('thread')!;
    expect(before.pendingApprovalCount).toBe(1);
    expect(JSON.stringify(f.store.getOperation(f.context.groupId, `approval-request:${pending.approvalId}`))).not.toContain('PRIVATE_INPUT');
    const result = await f.decide(pending.approvalId, 'one-decision', decision); await running;
    expect(f.effect).toHaveBeenCalledTimes(decision === 'approve' ? 1 : 0);
    expect(f.store.getThread('thread')).toMatchObject({ pendingApprovalCount: 0, threadRevision: before.threadRevision! + 1 });
    const events = f.store.readEvents(f.context.groupId).filter(event => event.kind === 'approval'); expect(events).toHaveLength(2);
    expect(await f.decide(pending.approvalId, 'one-decision', decision)).toEqual(result);
    expect(f.store.readEvents(f.context.groupId).filter(event => event.kind === 'approval')).toEqual(events);
    expect(f.get(pending.approvalId, 0)).not.toHaveProperty('inputPage');
  });
  it('AP2 changing the retained input before consumption has zero effect, with no automatic retry', async () => {
    const f = await setup(), input = { content: 'PRIVATE_INPUT' }, running = f.execute(input), pending = await f.pending();
    input.content = 'UNAPPROVED'; await f.decide(pending.approvalId, 'changed-input');
    expect(await running).toContain('approval_input_changed'); expect(f.effect).not.toHaveBeenCalled();
    expect(f.transport.getGroupProjection(f.context.groupId).pendingApprovalCount).toBe(0);
  });
  it.each(['before', 'after'] as const)('AP10 native %s-COMMIT decision fault never releases a grant and main projects raw DB status as unknown', async position => {
    const f = await setup(), running = f.execute().catch(error => error), pending = await f.pending();
    const fault = failNextApprovalCommit(f.db, position); cleanup.push(fault.restore);
    expect(await f.decide(pending.approvalId, 'fault')).toMatchObject({ state: 'unknown' }); await running;
    expect(fault.faults()).toBe(1); expect(f.effect).not.toHaveBeenCalled(); expect(f.context.signal.aborted).toBe(true);
    expect(f.store.getOperation(f.context.groupId, `approval-request:${pending.approvalId}`)).toMatchObject({ result: { approval: { status: position === 'before' ? 'pending' : 'approved' } } });
    expect(f.get(pending.approvalId, 0)).toMatchObject({ persistenceState: 'unknown', canDecide: false });
    expect(f.get(pending.approvalId, 0)).not.toHaveProperty('inputPage');
    expect(f.transport.getGroupProjection(f.context.groupId).pendingApprovalCount).toBe(0);
  });
  it('AP4 a real descriptor replacement invalidates only its waiter and releases it without any user', async () => {
    const f = await setup(), running = f.execute(), pending = await f.pending();
    f.catalog.publish({ requestSource: 'scheduler', ownerId: f.descriptor.ownerId, slotId: f.descriptor.slotId, entry: f.descriptor });
    await running; expect(f.get(pending.approvalId)).toMatchObject({ status: 'invalidated', reason: 'descriptor_changed', canDecide: false });
    expect(f.effect).not.toHaveBeenCalled(); expect(f.store.getThread('thread')?.pendingApprovalCount).toBe(0);
  });
  it('AP6 only real same-domain user access may decide or read private input bytes', async () => {
    const f = await setup(), running = f.execute(), pending = await f.pending();
    await expect(f.decide(pending.approvalId, 'agent-forgery', 'approve', { requestSource: 'agent' })).rejects.toThrow();
    await expect(f.decide(pending.approvalId, 'copy-forgery', 'approve', { access: { ...f.access } })).rejects.toThrow();
    const metadata = f.get(pending.approvalId); expect(metadata).not.toHaveProperty('inputPage');
    const page = f.get(pending.approvalId, 0); expect(Buffer.from(page.inputPage.base64, 'base64').toString()).toContain('PRIVATE_INPUT');
    expect(page.inputPage.sha256).toBe(page.inputSha256); expect(page.inputPage.byteLength).toBe(page.inputByteLength);
    await f.decide(pending.approvalId, 'deny', 'deny'); await running; expect(f.effect).not.toHaveBeenCalled();
  });

  it('AP3/AP6 expired metadata and snapshot projection are read-only: no actor abort, write, finalize or publication', async () => {
    const f = await setup(), running = f.execute().catch(error => error), pending = await f.pending();
    const writes = f.db.prepare('SELECT total_changes() AS n').get() as { n: number };
    const expire = vi.spyOn(f.service as any, 'expireApprovalActor'), publish = vi.spyOn(f.service as any, 'publishApprovalChange');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(f.context.effectiveDeadline + 1);
    try {
      expect(f.get(pending.approvalId, 0)).toMatchObject({ canDecide: false });
      expect(f.get(pending.approvalId, 0)).not.toHaveProperty('inputPage');
      expect(f.transport.getGroupProjection(f.context.groupId).pendingApprovalCount).toBe(0);
      expect.soft(f.context.signal.aborted).toBe(false); expect.soft(expire).not.toHaveBeenCalled(); expect.soft(publish).not.toHaveBeenCalled();
      expect.soft(f.db.prepare('SELECT total_changes() AS n').get()).toEqual(writes);
    } finally { clock.mockRestore(); await f.transport.dispose(); await running; }
  });

  it.each(['descriptor', 'actor-abort'] as const)('AP4 an approved grant paused before prepareInput releases its private bytes on %s', async action => {
    const f = await setup(), grantReady = deferred<ToolPermissionGrant>(), releaseGrant = deferred<void>();
    const request = f.transport.requestApproval.bind(f.transport);
    vi.spyOn(f.transport, 'requestApproval').mockImplementation(async (input: unknown) => {
      const grant = await request(input); if (grant) { grantReady.resolve(grant); await releaseGrant.promise; } return grant;
    });
    const running = f.execute().catch(error => error), pending = await f.pending();
    await f.decide(pending.approvalId, 'approve-before-barrier'); const grant = await grantReady.promise;
    const issued = (f.transport as { issued: Set<{ input?: unknown; bytes?: Buffer }> }).issued;
    const retained = [...issued][0]!; expect(retained.input).toBeDefined(); expect(retained.bytes).toBeDefined();
    try {
      if (action === 'descriptor') f.catalog.publish({ requestSource: 'scheduler', ownerId: f.descriptor.ownerId, slotId: f.descriptor.slotId, entry: f.descriptor });
      else await f.host.cancelTask(f.context.sourceTaskId!);
      expect.soft(issued.size).toBe(0); expect.soft(retained.input).toBeUndefined(); expect.soft(retained.bytes).toBeUndefined();
      expect(() => grant.prepareInput({ content: 'PRIVATE_INPUT' })).toThrow();
    } finally { releaseGrant.resolve(); await running; }
    expect(f.effect).not.toHaveBeenCalled();
  });

  it.each(['before', 'after'] as const)('AP10 native %s-COMMIT request failure cannot publish a decidable row or continue execution', async position => {
    const f = await setup(), fault = failNextApprovalCommit(f.db, position); cleanup.push(fault.restore);
    await f.execute().catch(() => undefined);
    expect(fault.faults()).toBe(1); expect(f.effect).not.toHaveBeenCalled(); expect(f.context.signal.aborted).toBe(true);
    expect(f.transport.getGroupProjection(f.context.groupId).pendingApprovalCount).toBe(0);
    const requests = f.store.listApprovalRequests({ groupId: f.context.groupId, bootId: f.store.bootId }).items;
    expect(requests).toHaveLength(position === 'before' ? 0 : 1);
    if (requests[0]) expect(f.get(requests[0].result.approval.approvalId)).toMatchObject({ persistenceState: 'unknown', canDecide: false });
  });

  it.each(['approval', 'actor'] as const)('AP3/AP9 %s deadline crossed during the real BEGIN is a confirmed expiry, not a persistence failure', async deadline => {
    const f = await setup(), running = f.execute().catch(error => error), pending = await f.pending();
    const dueAt = deadline === 'actor' ? f.context.effectiveDeadline : f.get(pending.approvalId).minDeadlineAt;
    const originalExec = f.db.exec.bind(f.db); let clock: ReturnType<typeof vi.spyOn> | undefined, boundaries = 0;
    const begin = vi.spyOn(f.db, 'exec').mockImplementation(sql => {
      const result = originalExec(sql);
      // SQLite BEGIN is genuinely synchronous but consumes wall time. Change
      // only the clock after that real IO, never inject an async transaction.
      if (sql === 'BEGIN IMMEDIATE' && !boundaries++) clock = vi.spyOn(Date, 'now').mockReturnValue(dueAt + 1);
      return result;
    });
    const freeze = vi.spyOn(f.service, 'freezeApprovalPersistence');
    try {
      expect(await f.decide(pending.approvalId, `begin-expiry-${deadline}`)).toMatchObject({ state: 'applied', outcome: 'rejected' });
      await running;
      expect(f.get(pending.approvalId)).toMatchObject({ status: 'expired', persistenceState: 'confirmed', canDecide: false,
        reason: deadline === 'actor' ? 'actor_deadline' : 'approval_deadline' });
      expect(freeze).not.toHaveBeenCalled(); expect(f.effect).not.toHaveBeenCalled();
      expect(f.context.signal.aborted).toBe(deadline === 'actor');
    } finally { clock?.mockRestore(); begin.mockRestore(); }
  });

  it.each(['approval', 'actor'] as const)('AP3/AP9 %s deadline crossed during real COMMIT preserves the approved audit without issuing a live grant or effect', async deadline => {
    const f = await setup(), running = f.execute().catch(error => error), pending = await f.pending();
    const dueAt = deadline === 'actor' ? f.context.effectiveDeadline : f.get(pending.approvalId).minDeadlineAt;
    const originalExec = f.db.exec.bind(f.db); let clock: ReturnType<typeof vi.spyOn> | undefined, crossed = false;
    const commit = vi.spyOn(f.db, 'exec').mockImplementation(sql => {
      const result = originalExec(sql);
      if (sql === 'COMMIT' && !crossed) { crossed = true; clock = vi.spyOn(Date, 'now').mockReturnValue(dueAt + 1); }
      return result;
    });
    const freeze = vi.spyOn(f.service, 'freezeApprovalPersistence');
    try {
      expect(await f.decide(pending.approvalId, `commit-expiry-${deadline}`)).toMatchObject({ state: 'applied' });
      await running; expect(crossed).toBe(true);
      expect(f.get(pending.approvalId, 0)).toMatchObject({ status: 'approved', persistenceState: 'confirmed', canDecide: false });
      expect(f.get(pending.approvalId, 0)).not.toHaveProperty('inputPage');
      expect(f.transport.getGroupProjection(f.context.groupId).pendingApprovalCount).toBe(0);
      expect((f.transport as { issued: Set<unknown> }).issued.size).toBe(0);
      expect(f.store.readEvents(f.context.groupId).filter(event => event.kind === 'approval')).toHaveLength(2);
      expect(freeze).not.toHaveBeenCalled(); expect(f.effect).not.toHaveBeenCalled();
      expect(f.context.signal.aborted).toBe(deadline === 'actor');
    } finally { clock?.mockRestore(); commit.mockRestore(); }
  });

  it('AP3 a caller abort preserves its original object and cannot freeze an otherwise healthy actor', async () => {
    const f = await setup(), controller = new AbortController(), reason = new Error('actual caller cancellation');
    const running = f.scope.registry.executeTool('write', { content: 'PRIVATE_INPUT' }, mcpTestContext(controller.signal)).catch(error => error);
    const pending = await f.pending(); controller.abort(reason);
    expect(await running).toBe(reason); expect(f.context.signal.aborted).toBe(false); expect(f.effect).not.toHaveBeenCalled();
    expect(f.get(pending.approvalId)).toMatchObject({ status: 'invalidated', reason: 'actor_aborted', persistenceState: 'confirmed' });
  });

  it.each([0, 1])('AP2 the actual producer enforces the canonical 2 MiB boundary with %s excess byte', async excess => {
    const f = await setup(), overhead = Buffer.byteLength(encodeMultiAgentRow({ content: '' }));
    const input = { content: 'x'.repeat(2 * 1024 * 1024 - overhead + excess) };
    const running = f.execute(input);
    if (excess) {
      await expect(running).rejects.toThrow('approval_input_too_large');
      expect(f.store.listApprovalRequests({ groupId: f.context.groupId, bootId: f.store.bootId }).items).toHaveLength(0);
    } else {
      const pending = await f.pending(); expect(f.get(pending.approvalId).inputByteLength).toBe(2 * 1024 * 1024);
      await f.decide(pending.approvalId, 'deny-large', 'deny'); await running;
    }
    expect(f.effect).not.toHaveBeenCalled(); expect(f.context.signal.aborted).toBe(false);
    expect(f.transport.getGroupProjection(f.context.groupId).pendingApprovalCount).toBe(0);
  });

  it('AP6 private pages use the original canonical UTF-8 bytes, bounded pages and explicit EOF without granting execution', async () => {
    const f = await setup(), input = { content: '多😀'.repeat(8000) }, original = Buffer.from(encodeMultiAgentRow(input));
    const running = f.execute(input), pending = await f.pending(); input.content = 'changed but not approved';
    const first = f.get(pending.approvalId, 0), second = f.get(pending.approvalId, first.inputPage.nextOffset);
    expect(Buffer.from(first.inputPage.base64, 'base64')).toHaveLength(32 * 1024);
    expect(Buffer.concat([first, second].map(page => Buffer.from(page.inputPage.base64, 'base64')))).toEqual(original);
    expect(first.inputSha256).toBe(createHash('sha256').update(original).digest('hex'));
    expect(first.inputSha256).toBe(second.inputSha256); expect(second.inputPage.nextOffset).toBe(original.length);
    expect(f.get(pending.approvalId, original.length).inputPage).toMatchObject({ base64: '', nextOffset: original.length, byteLength: original.length });
    for (const offset of [-1, 0.5, original.length + 1]) expect(() => f.get(pending.approvalId, offset)).toThrow('invalid approval input offset');
    expect(f.effect).not.toHaveBeenCalled(); await f.decide(pending.approvalId, 'deny-pages', 'deny'); await running;
    expect(f.get(pending.approvalId, 0)).not.toHaveProperty('inputPage');
  });

  it('AP2 a real issued grant consumes private input only once, even if retained by an internal caller', async () => {
    const f = await setup(), ready = deferred<ToolPermissionGrant>(), release = deferred<void>();
    const request = f.transport.requestApproval.bind(f.transport);
    vi.spyOn(f.transport, 'requestApproval').mockImplementation(async (input: unknown) => {
      const grant = await request(input); if (grant) { ready.resolve(grant); await release.promise; } return grant;
    });
    const running = f.execute(), pending = await f.pending(); await f.decide(pending.approvalId, 'one-use');
    const grant = await ready.promise;
    try {
      expect(grant.prepareInput({ content: 'PRIVATE_INPUT' })).toEqual({ content: 'PRIVATE_INPUT' });
      expect(() => grant.prepareInput({ content: 'PRIVATE_INPUT' })).toThrow('approval_grant_consumed');
    } finally { release.resolve(); }
    expect(await running).toContain('approval_grant_consumed'); expect(f.effect).not.toHaveBeenCalled();
  });

  it('AP1 per-actor pending capacity refuses a concurrent invocation and permits a fresh approval after terminal', async () => {
    const f = await setup(), running = f.execute(), first = await f.pending();
    await expect(f.execute()).rejects.toThrow('approval_capacity_exceeded');
    expect(f.transport.getGroupProjection(f.context.groupId).pendingApprovalCount).toBe(1);
    await f.decide(first.approvalId, 'deny-first', 'deny'); await running;
    const next = f.execute(), second = await f.pending(); expect(second.approvalId).not.toBe(first.approvalId);
    await f.decide(second.approvalId, 'approve-next'); await next; expect(f.effect).toHaveBeenCalledOnce();
  });

  it('AP5 a conflicting old decision ID cannot strand a fresh real approval in finalizing', async () => {
    const f = await setup(), firstRun = f.execute(), first = await f.pending();
    await f.decide(first.approvalId, 'retained-decision-id', 'deny'); await firstRun;
    const nextRun = f.execute(), next = await f.pending();
    const before = f.store.getThread('thread')!;
    await expect(f.decide(next.approvalId, 'retained-decision-id')).rejects.toThrow('operation_id_conflict');
    expect.soft(f.get(next.approvalId)).toMatchObject({ status: 'pending', canDecide: true, persistenceState: 'confirmed' });
    expect.soft(f.transport.getGroupProjection(f.context.groupId).pendingApprovalCount).toBe(1);
    expect(f.store.getThread('thread')).toEqual(before); expect(f.context.signal.aborted).toBe(false);
    await f.decide(next.approvalId, 'fresh-decision-id'); await nextRun;
    expect(f.effect).toHaveBeenCalledOnce();
  });
});
