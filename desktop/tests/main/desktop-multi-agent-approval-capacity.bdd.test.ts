// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { mcpTestContext } from '../../../tests/support/mcp-cancellation-context.js';
import { DesktopCapabilityCatalog } from '../../electron/desktop-multi-agent-capabilities.js';
import { DesktopMultiAgentApprovalTransport } from '../../electron/desktop-multi-agent-approval-transport.js';
import { DesktopMultiAgentStore, encodeMultiAgentRow } from '../../electron/desktop-multi-agent-store.js';
import { DesktopMultiAgentService, type DesktopAgentExecutionContext } from '../../electron/desktop-multi-agent-service.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import type { ApprovalRequestOperation } from '../../shared/multi-agent-types.js';

const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; };
const bytes = (value: unknown) => Buffer.byteLength(encodeMultiAgentRow(value));

describe('BDD AP terminal capacity: accepted pending metadata must fit every legal terminal row', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); });

  function storeFixture() {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-approval-capacity-')); cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite')); cleanup.push(() => store.close());
    const db = (store as unknown as { db: DatabaseSync }).db;
    return { root, store, db };
  }
  function directFixture(targetBytes: number) {
    const f = storeFixture(); f.store.registerThread({ threadId: 'capacity-thread', profileId: 'profile', workspaceId: 'workspace', cwd: f.root });
    const group = f.store.createGroup('capacity-thread'), approvalId = randomUUID();
    const operation: ApprovalRequestOperation = { groupId: group.groupId, operationId: `approval-request:${approvalId}`,
      command: 'approval_request', requestHash: 'f'.repeat(64), applyState: 'applied', result: { approval: {
        approvalId, bootId: f.store.bootId, profileId: 'profile', workspaceId: 'workspace', threadId: 'capacity-thread',
        groupId: group.groupId, agentId: `root_${group.groupId}`, turn: 1, turnId: randomUUID(), canonicalName: 'write', toolName: 'write',
        cwd: f.root, ownerId: 'owner', slotId: randomUUID(), capabilityId: randomUUID(), revision: 1, permissionRevision: 0,
        invocationNonce: randomUUID(), inputSha256: 'a'.repeat(64), inputByteLength: 2, issuedAt: 1, minDeadlineAt: 600_001,
        status: 'pending', persistenceState: 'confirmed',
      } } };
    // Fixture DATA only. Measure the production encoder; never reproduce its
    // canonicalization or approval acceptance algorithm in the test.
    operation.result.approval.cwd += 'x'.repeat(targetBytes - bytes(operation));
    expect(operation.result.approval.cwd.length).toBeLessThanOrEqual(4096); expect(bytes(operation)).toBe(targetBytes);
    return { ...f, group, operation, facts: () => ({ operation: f.store.getOperation(group.groupId, operation.operationId),
      events: f.store.readEvents(group.groupId), thread: f.store.getThread('capacity-thread'), usage: f.store.getByteUsage(group.groupId) }) };
  }

  async function graphFixture(targetBytes: number) {
    const f = storeFixture(), threadId = '\u0001'.repeat(256), toolName = 'x'.repeat(256);
    const service = new DesktopMultiAgentService({ store: f.store, coordinator: new DesktopExecutionCoordinator(), createSession: vi.fn() });
    service.registerThread({ threadId, profileId: 'profile', workspaceId: 'workspace', cwd: f.root });
    const entered = deferred<DesktopAgentExecutionContext>(), release = deferred<void>();
    const host = new InProcessTaskRuntimeHost({ snapshotStore: new FileTaskSnapshotStore(join(f.root, 'tasks')),
      materialRegistry: new MaterialRegistry({ workspaceRoot: join(f.root, 'materials'), maxBytes: 1024 * 1024 }),
      authorizePreparation: (id, marker) => service.assertHostPreparation(id, marker), assertTaskAdmission: snapshot => service.assertHostAdmission(snapshot),
      decideCancellation: (snapshot, reason) => service.decideHostCancellation(snapshot, reason),
      runner: input => service.runRoot(input, async context => { entered.resolve(context); await release.promise; throw new Error('test-owned root cleanup'); }),
    });
    await service.initialize(host); const task = await service.prepareRoot(host, threadId, { prompt: 'capacity fixture', materials: [] }); await host.startTask(task.taskId);
    const context = await entered.promise, transport = new DesktopMultiAgentApprovalTransport({ store: f.store, service });
    const catalog = new DesktopCapabilityCatalog(), effect = vi.fn(async () => 'actual controlled effect');
    const access = service.createUserAccess({ requestSource: 'user', actorId: 'real-user', threadId, profileId: 'profile', workspaceId: 'workspace' });
    const publish = (ownerId: string) => {
      const descriptor = catalog.publish({ requestSource: 'scheduler', ownerId, entry: {
        definition: { name: toolName, description: 'Bound write permission', inputSchema: { type: 'object', properties: {} } }, aliases: [], permission: 'write',
        scope: { workspaceId: 'workspace', materialIds: [], permissions: ['write'] }, bindInvocation: () => effect,
      } }); catalog.authorize({ requestSource: 'user', capabilityId: descriptor.capabilityId });
      const scope = catalog.createScopedRegistry(catalog.snapshotPolicy(), { ...context, workspaceId: 'workspace', materialIds: [], deadlineAt: context.effectiveDeadline,
        assertCurrent: () => service.assertInvocation(context.actor, context), getApprovalDeadline: () => service.getApprovalDeadline(context.actor),
        requestApproval: invocation => transport.requestApproval({ context, invocation }),
      }, { autoMode: false });
      return { descriptor, scope, execute: () => scope.registry.executeTool(toolName, { content: 'PRIVATE_CAPACITY_INPUT' }, mcpTestContext(context.signal)) };
    };
    const decide = (approvalId: string, operationId: string) => transport.decideApproval({ access, requestSource: 'user', groupId: context.groupId, approvalId, operationId, decision: 'deny' });
    const pending = () => transport.getGroupProjection(context.groupId).pendingApprovals;
    const first = publish('owner-');
    cleanup.push(async () => { await transport.dispose(); first.scope.dispose(); await host.cancelTask(task.taskId); release.resolve(); await host.drain(); await service.dispose(); });
    // A real SMALL request + real deny measures the actual transport-generated
    // UUIDs, source binding, timestamps and requestHash. No DTO builder or waiter
    // is copied. Subsequent negative assertions use the post-calibration baseline.
    const calibrationRun = first.execute(); await vi.waitFor(() => expect(pending()).toHaveLength(1));
    const calibrationPending = pending()[0], calibration = f.store.getOperation(context.groupId, `approval-request:${calibrationPending.approvalId}`)!;
    const initialBytes = bytes(calibration), extra = targetBytes - initialBytes;
    expect(extra).toBeGreaterThan(0);
    await decide(calibrationPending.approvalId, 'calibration-deny'); await calibrationRun;
    first.scope.dispose(); catalog.revoke({ requestSource: 'scheduler', ownerId: first.descriptor.ownerId });
    const ownerId = `owner-${'\u0001'.repeat(Math.floor(extra / 6))}${'x'.repeat(extra % 6)}`;
    expect(ownerId.length).toBeLessThanOrEqual(256);
    const selected = publish(ownerId); cleanup.push(() => selected.scope.dispose());
    const freeze = vi.spyOn(service, 'freezeApprovalPersistence');
    const facts = () => ({ operations: f.db.prepare('SELECT operation_id,data_json FROM operations WHERE group_id=? ORDER BY operation_id').all(context.groupId),
      events: f.store.readEvents(context.groupId), thread: f.store.getThread(threadId), usage: f.store.getByteUsage(context.groupId) });
    return { ...f, ...selected, service, context, transport, catalog, access, effect, pending, decide, facts, freeze, initialBytes, targetBytes };
  }

  it.each([4054, 4080])('AP cap real Catalog→Registry→Transport→Service→SQLite rejects %i-byte pending before publication, without persistence freeze', async targetBytes => {
    const f = await graphFixture(targetBytes), before = f.facts();
    let outcome: unknown;
    const running = f.execute().then(value => { outcome = value; }, error => { outcome = String(error); });
    await vi.waitFor(() => expect(outcome !== undefined || f.pending().length > 0).toBe(true));
    const published = f.pending()[0];
    if (published) {
      const operation = f.store.getOperation(f.context.groupId, `approval-request:${published.approvalId}`)!;
      expect(bytes(operation)).toBe(targetBytes);
      // Before the fix, exercise the real failure as diagnostic evidence and
      // drain the waiter. This is not a desired success assertion or fake error.
      const decision = await f.decide(published.approvalId, 'unexpected-published-deny');
      console.log('AP_CAPACITY_RED_CHARACTERIZATION', { pendingBytes: bytes(operation), decision, frozen: f.freeze.mock.calls.length });
    }
    await running;
    expect.soft(String(outcome)).toContain('approval_metadata_too_large');
    expect.soft(f.facts()).toEqual(before); expect.soft(f.pending()).toHaveLength(0);
    expect.soft(f.freeze).not.toHaveBeenCalled(); expect.soft(f.context.signal.aborted).toBe(false); expect(f.effect).not.toHaveBeenCalled();
  });

  it.each(['commit', 'ordinary', 'control', 'update'] as const)('AP cap direct Store %s sibling rejects 4080-byte pending before any mutation', writer => {
    const f = directFixture(4080);
    if (writer === 'update') f.store.putOperation({ ...f.operation, result: { approval: { ...f.operation.result.approval, cwd: f.root } } });
    const before = f.facts();
    expect(() => writer === 'commit' ? f.store.commitApprovalRequest(f.operation) : f.store.putOperation(f.operation, writer === 'control')).toThrow('approval_metadata_too_large');
    expect(f.facts()).toEqual(before);
  });

  it.each(['deny', 'descriptor'] as const)('AP cap the maximum 4053-byte Catalog request can settle through real %s exactly once', async action => {
    const f = await graphFixture(4053), before = f.facts(); const running = f.execute();
    await vi.waitFor(() => expect(f.pending()).toHaveLength(1)); const pending = f.pending()[0];
    const operation = f.store.getOperation(f.context.groupId, `approval-request:${pending.approvalId}`)!; expect(bytes(operation)).toBe(4053);
    if (action === 'deny') await f.decide(pending.approvalId, 'boundary-deny');
    else f.catalog.publish({ requestSource: 'scheduler', ownerId: f.descriptor.ownerId, slotId: f.descriptor.slotId, entry: f.descriptor });
    await running;
    const terminal = f.store.getOperation(f.context.groupId, operation.operationId)! as ApprovalRequestOperation;
    expect(terminal.result.approval).toMatchObject({ status: action === 'deny' ? 'denied' : 'invalidated', reason: action === 'deny' ? 'user_denied' : 'descriptor_changed', persistenceState: 'confirmed' });
    expect(bytes(terminal)).toBe(action === 'deny' ? 4075 : 4087);
    expect(f.facts().events.filter(event => event.kind === 'approval')).toHaveLength(before.events.filter(event => event.kind === 'approval').length + 2);
    expect(f.store.getThread(terminal.result.approval.threadId)).toMatchObject({ pendingApprovalCount: 0, threadRevision: before.thread!.threadRevision! + 2 });
    const committed = f.facts();
    expect(f.store.finalizeApproval({ groupId: f.context.groupId, approvalId: pending.approvalId, bootId: f.store.bootId, status: 'invalidated', reason: 'descriptor_changed' }).changed).toBe(false);
    expect(f.facts()).toEqual(committed); expect(f.freeze).not.toHaveBeenCalled(); expect(f.context.signal.aborted).toBe(false); expect(f.effect).not.toHaveBeenCalled();
    console.log('AP_CAPACITY_BOUNDARY', { pendingBytes: bytes(operation), terminalBytes: bytes(terminal), action });
  });

  it('AP cap Store worst legal status/reason settles 4053-byte pending as an exact 4096-byte row', () => {
    const f = directFixture(4053); f.store.commitApprovalRequest(f.operation);
    const result = f.store.finalizeApproval({ groupId: f.group.groupId, approvalId: f.operation.result.approval.approvalId,
      bootId: f.store.bootId, status: 'invalidated', reason: 'approval_persistence_failed' });
    expect(result.changed).toBe(true); expect(bytes(result.operation)).toBe(4096);
    expect(f.store.getThread('capacity-thread')?.pendingApprovalCount).toBe(0);
  });

  it.each([4054, 4080])('AP cap legacy %i-byte pending remains readable; recovery uses its actual terminal bytes, not new-request admission', pendingBytes => {
    const f = directFixture(pendingBytes);
    const compact: ApprovalRequestOperation = { ...f.operation, result: { approval: { ...f.operation.result.approval, cwd: f.root } } };
    f.store.commitApprovalRequest(compact);
    // An old-version SQLite fixture, not a second writer implementation. The
    // approved new writer may not create this row. Keep real canonical bytes,
    // count and usage consistent with the old accepted request before reopening.
    f.store.transaction(() => {
      f.db.prepare('UPDATE operations SET data_json=?,logical_bytes=? WHERE group_id=? AND operation_id=?')
        .run(encodeMultiAgentRow(f.operation), pendingBytes, f.group.groupId, f.operation.operationId);
      f.db.prepare('UPDATE groups SET byte_usage=byte_usage+? WHERE group_id=?').run(pendingBytes - bytes(compact), f.group.groupId);
    });
    expect(f.store.listApprovalRequests({ groupId: f.group.groupId, bootId: f.store.bootId }).items).toEqual([f.operation]);
    f.store.close(); const reopened = new DesktopMultiAgentStore(join(f.root, 'groups.sqlite')); cleanup.push(() => reopened.close());
    if (pendingBytes === 4054) {
      reopened.recoverPreviousBoot();
      const recovered = reopened.getOperation(f.group.groupId, f.operation.operationId)! as ApprovalRequestOperation;
      expect(recovered.result.approval).toMatchObject({ status: 'invalidated', reason: 'restart' }); expect(bytes(recovered)).toBe(4077);
      expect(reopened.getThread('capacity-thread')?.pendingApprovalCount).toBe(0);
    } else {
      // This old 4080+23 row cannot fit without changing the frozen contract.
      // Preserve it and report failure; never truncate identity or fake recovery.
      expect(() => reopened.recoverPreviousBoot()).toThrow('approval_metadata_too_large');
      expect(reopened.getOperation(f.group.groupId, f.operation.operationId)).toEqual(f.operation);
      expect(reopened.getThread('capacity-thread')?.pendingApprovalCount).toBe(1);
    }
  });
});
