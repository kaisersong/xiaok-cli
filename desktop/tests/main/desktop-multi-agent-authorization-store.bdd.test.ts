// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DesktopMultiAgentStore, encodeMultiAgentRow, type MultiAgentThreadBinding } from '../../electron/desktop-multi-agent-store.js';
import type { DesktopMultiAgentGroup, MultiAgentOperation, MultiAgentPage } from '../../shared/multi-agent-types.js';

// Reviewed store ports, not test-side CAS/finalization implementations. The
// signatures keep the formal red executable before these production APIs exist.
type Receipt = { operationId: string; state: 'applied' | 'unknown'; permissionRevision: number; executionAllowed: boolean;
  persistenceState: 'confirmed' | 'unknown'; outcome?: 'rejected'; error?: string };
type Row = { profileId: string; workspaceId: string; permissionRevision: number; executionAllowed: boolean; updatedAt: number;
  actorId: string | null; lastReceiptJson: string | null };
type StorePorts = {
  initializeWorkspaceAuthorization(domain: { profileId: string; workspaceId: string }): Row;
  readWorkspaceAuthorization(domain: { profileId: string; workspaceId: string }): Row | null;
  compareAndSetWorkspaceAuthorization(input: { profileId: string; workspaceId: string; expectedPermissionRevision: number; next: Row }): boolean;
  commitApprovalRequest(operation: MultiAgentOperation): { created: boolean; operation: MultiAgentOperation };
  finalizeApproval(input: { groupId: string; approvalId: string; bootId: string; status: 'approved' | 'denied' | 'expired' | 'invalidated';
    reason?: string; decisionOperation?: MultiAgentOperation }): { changed: boolean; operation: MultiAgentOperation };
  listApprovalRequests(input: { groupId: string; bootId: string; cursor?: string; limit?: number }): MultiAgentPage<MultiAgentOperation>;
  listWorkspaceThreads(input: { profileId: string; workspaceId: string; cursor?: string; limit?: number }): MultiAgentPage<MultiAgentThreadBinding>;
  listWorkspaceGroups(input: { threadId: string; bootId: string; cursor?: string; limit?: number }): MultiAgentPage<DesktopMultiAgentGroup>;
};
type AuthorizerDb = DatabaseSync & { setAuthorizer(callback: ((action: number, table: string | null, column: string | null) => number) | null): void };
const hasAuthorizer = typeof (DatabaseSync.prototype as unknown as Partial<AuthorizerDb>).setAuthorizer === 'function';

describe('BDD W/AP store: real CAS, transactional request/finalization and restart', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const action of cleanup.splice(0).reverse()) action(); });
  const domain = { profileId: 'profile', workspaceId: 'workspace' };
  function setup(options: { maxBytes?: number; reserveBytes?: number } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-wap-store-')); cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const path = join(root, 'groups.sqlite');
    const store = new DesktopMultiAgentStore(path, { bootId: 'old-boot', now: () => 123, ...options }); cleanup.push(() => store.close());
    store.registerThread({ threadId: 'thread', ...domain, cwd: root }); const group = store.createGroup('thread');
    const db = (store as unknown as { db: AuthorizerDb }).db;
    const api = store as unknown as StorePorts;
    const requirePort = (key: keyof StorePorts) => expect(api[key], `missing actual store port ${key}; downstream SQL assertions have not run`).toBeTypeOf('function');
    const snapshot = () => ({ group: store.requireGroup(group.groupId), thread: store.getThread('thread'),
      operations: db.prepare('SELECT * FROM operations ORDER BY group_id,operation_id').all(), events: store.readEvents(group.groupId) });
    return { root, path, store, group, db, api, requirePort, snapshot };
  }
  function nextRow(previous: Row, allowed = false): Row {
    const receipt: Receipt = { operationId: `exec-auth:old-boot:${previous.permissionRevision}:fixture`, state: 'applied',
      permissionRevision: previous.permissionRevision + 1, executionAllowed: allowed, persistenceState: 'confirmed' };
    return { ...previous, permissionRevision: previous.permissionRevision + 1, executionAllowed: allowed, updatedAt: 456,
      actorId: 'desktop-user:profile', lastReceiptJson: encodeMultiAgentRow({ requestHash: 'f'.repeat(64), receipt }) };
  }
  function approval(f: ReturnType<typeof setup>, turn = 1, groupId = f.group.groupId): MultiAgentOperation {
    const approvalId = randomUUID();
    return { groupId, operationId: `approval-request:${approvalId}`, command: 'approval_request', requestHash: 'a'.repeat(64), applyState: 'applied',
      result: { approval: { approvalId, bootId: f.store.bootId, ...domain, threadId: 'thread', groupId, agentId: `root_${groupId}`, turn, turnId: `turn-${turn}`,
        canonicalName: 'write', toolName: 'write', cwd: f.root, ownerId: 'owner', slotId: 'slot', capabilityId: 'capability', revision: 1,
        permissionRevision: 0, invocationNonce: randomUUID(), inputSha256: 'b'.repeat(64), inputByteLength: 2,
        issuedAt: 1, minDeadlineAt: 60_001, status: 'pending', persistenceState: 'confirmed' } } };
  }
  function terminal(f: ReturnType<typeof setup>, operation: MultiAgentOperation, status: 'approved' | 'denied' | 'invalidated' = 'approved') {
    return { groupId: f.group.groupId, approvalId: (operation.result.approval as { approvalId: string }).approvalId, bootId: f.store.bootId, status };
  }

  it('W store initialization is explicit, scoped, insert-only and never overwrites an existing denied receipt', () => {
    const f = setup(); f.requirePort('initializeWorkspaceAuthorization');
    expect(f.api.readWorkspaceAuthorization(domain)).toBeNull();
    const initial = f.api.initializeWorkspaceAuthorization(domain);
    expect(initial).toEqual({ ...domain, permissionRevision: 0, executionAllowed: true, updatedAt: 123, actorId: null, lastReceiptJson: null });
    const next = nextRow(initial);
    expect(f.api.compareAndSetWorkspaceAuthorization({ ...domain, expectedPermissionRevision: 0, next })).toBe(true);
    expect(f.api.initializeWorkspaceAuthorization(domain)).toEqual(next);
    expect(f.api.readWorkspaceAuthorization({ ...domain, workspaceId: 'unregistered' })).toBeNull();
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM workspace_execution_authorizations').get()).toMatchObject({ n: 1 });
  });
  it('W store a stale CAS is false and cannot change the actual SQL row or latest receipt', () => {
    const f = setup(); f.requirePort('compareAndSetWorkspaceAuthorization'); const initial = f.api.initializeWorkspaceAuthorization(domain), next = nextRow(initial);
    expect(f.api.compareAndSetWorkspaceAuthorization({ ...domain, expectedPermissionRevision: 0, next })).toBe(true);
    expect(f.api.compareAndSetWorkspaceAuthorization({ ...domain, expectedPermissionRevision: 0, next: { ...next, updatedAt: 999 } })).toBe(false);
    expect(f.api.readWorkspaceAuthorization(domain)).toEqual(next);
  });
  it.each(['wrong-profile', 'wrong-workspace', 'skip-revision', 'unknown-receipt', 'extra-receipt-field', 'oversize-row'] as const)
    ('W store CAS rejects %s before touching either target domain', mutation => {
      const f = setup(); f.requirePort('compareAndSetWorkspaceAuthorization'); const initial = f.api.initializeWorkspaceAuthorization(domain), next = nextRow(initial);
      if (mutation === 'wrong-profile') next.profileId = 'foreign';
      if (mutation === 'wrong-workspace') next.workspaceId = 'foreign';
      if (mutation === 'skip-revision') next.permissionRevision += 1;
      const envelope = JSON.parse(next.lastReceiptJson!);
      if (mutation === 'unknown-receipt') envelope.receipt.persistenceState = 'unknown';
      if (mutation === 'extra-receipt-field') envelope.privateAuthority = { approved: true };
      if (mutation === 'oversize-row') next.actorId = '丙😀'.repeat(1000);
      next.lastReceiptJson = encodeMultiAgentRow(envelope);
      const before = f.db.prepare('SELECT * FROM workspace_execution_authorizations').all();
      expect(() => f.api.compareAndSetWorkspaceAuthorization({ ...domain, expectedPermissionRevision: 0, next })).toThrow();
      expect(f.db.prepare('SELECT * FROM workspace_execution_authorizations').all()).toEqual(before);
    });
  it('W store caller transaction atomically rolls back authorization CAS and the related group marker', () => {
    const f = setup(); f.requirePort('compareAndSetWorkspaceAuthorization'); const initial = f.api.initializeWorkspaceAuthorization(domain);
    const before = f.snapshot();
    expect(() => f.store.transaction(() => {
      expect(f.api.compareAndSetWorkspaceAuthorization({ ...domain, expectedPermissionRevision: 0, next: nextRow(initial) })).toBe(true);
      f.store.putGroup({ ...f.store.requireGroup(f.group.groupId), mutationBlockedReason: 'permission_revoked' });
      throw new Error('caller rolls back');
    })).toThrow('caller rolls back');
    expect(f.api.readWorkspaceAuthorization(domain)).toEqual(initial); expect(f.snapshot()).toEqual(before);
  });
  it('W store new group captures the supplied revision and later workspace CAS never rewrites it', () => {
    const f = setup(); f.store.clearActiveGroup('thread', f.group.groupId);
    const create = f.store.createGroup as (threadId: string, permissionRevision: number) => DesktopMultiAgentGroup & { permissionRevision?: number };
    const captured = create.call(f.store, 'thread', 7);
    expect(captured.permissionRevision, 'real createGroup must persist its input revision').toBe(7);
    const initial = f.api.initializeWorkspaceAuthorization(domain); f.api.compareAndSetWorkspaceAuthorization({ ...domain, expectedPermissionRevision: 0, next: nextRow(initial) });
    expect(f.store.requireGroup(captured.groupId)).toMatchObject({ permissionRevision: 7 });
  });
  it('W store workspace scans filter profile/workspace/boot/history in SQL and preserve actual page cursors', () => {
    const f = setup(); f.requirePort('listWorkspaceThreads'); f.requirePort('listWorkspaceGroups');
    for (const [threadId, profileId, workspaceId] of [['b', 'profile', 'workspace'], ['c', 'foreign', 'workspace'], ['d', 'profile', 'foreign']]) {
      f.store.registerThread({ threadId, profileId, workspaceId, cwd: f.root });
    }
    const first = f.api.listWorkspaceThreads({ ...domain, limit: 1 }); const second = f.api.listWorkspaceThreads({ ...domain, cursor: first.nextCursor!, limit: 1 });
    expect([...first.items, ...second.items].map(item => item.threadId).sort()).toEqual(['b', 'thread']); expect(second.nextCursor).toBeNull();
    f.store.clearActiveGroup('thread', f.group.groupId);
    const historical = f.store.createGroup('thread'); f.store.putGroup({ ...historical, historicalOnly: true }); f.store.clearActiveGroup('thread', historical.groupId);
    const old = f.store.createGroup('thread'); f.store.putGroup({ ...old, bootId: 'different-boot' }); f.store.clearActiveGroup('thread', old.groupId);
    const current = f.store.createGroup('thread');
    const a = f.api.listWorkspaceGroups({ threadId: 'thread', bootId: f.store.bootId, limit: 1 });
    const b = f.api.listWorkspaceGroups({ threadId: 'thread', bootId: f.store.bootId, limit: 1, cursor: a.nextCursor! });
    expect([...a.items, ...b.items].map(item => item.groupId).sort()).toEqual([f.group.groupId, current.groupId].sort()); expect(b.nextCursor).toBeNull();
  });

  it('AP store request creation commits request/event/count/revision once and an identical replay is read-only', () => {
    const f = setup(); f.requirePort('commitApprovalRequest'); const operation = approval(f), revision = f.store.getThread('thread')!.threadRevision!;
    expect(f.api.commitApprovalRequest(operation)).toEqual({ created: true, operation });
    expect(f.store.getThread('thread')).toMatchObject({ pendingApprovalCount: 1, threadRevision: revision + 1 });
    expect(f.store.readEvents(f.group.groupId)).toMatchObject([{ kind: 'approval', agentId: `root_${f.group.groupId}`, turnId: 'turn-1',
      payload: { approvalId: (operation.result.approval as { approvalId: string }).approvalId, status: 'pending', persistenceState: 'confirmed' } }]);
    const before = f.snapshot(); expect(f.api.commitApprovalRequest(operation)).toEqual({ created: false, operation }); expect(f.snapshot()).toEqual(before);
    expect(() => f.api.commitApprovalRequest({ ...operation, requestHash: 'c'.repeat(64) })).toThrow(/conflict/); expect(f.snapshot()).toEqual(before);
  });
  it('AP store finalization commits terminal request/decision/event/count/revision together and duplicate terminal stays unchanged', () => {
    const f = setup(); f.requirePort('finalizeApproval'); const operation = approval(f); f.api.commitApprovalRequest(operation);
    const revision = f.store.getThread('thread')!.threadRevision!;
    const decision: MultiAgentOperation = { groupId: f.group.groupId, operationId: 'decision-1', requestHash: 'd'.repeat(64), command: 'approval_decision', applyState: 'applied', result: { state: 'applied' } };
    const result = f.api.finalizeApproval({ ...terminal(f, operation), decisionOperation: decision });
    expect(result.changed).toBe(true); expect(result.operation).toMatchObject({ result: { approval: { status: 'approved', persistenceState: 'confirmed' } } });
    expect(f.store.getOperation(f.group.groupId, decision.operationId)).toEqual(decision);
    expect(f.store.getThread('thread')).toMatchObject({ pendingApprovalCount: 0, threadRevision: revision + 1 });
    expect(f.store.readEvents(f.group.groupId).filter(event => String(event.kind) === 'approval')).toHaveLength(2);
    const before = f.snapshot();
    expect(f.api.finalizeApproval(terminal(f, operation))).toEqual({ changed: false, operation: result.operation });
    expect(f.api.finalizeApproval(terminal(f, operation, 'denied'))).toEqual({ changed: false, operation: result.operation });
    expect(f.snapshot()).toEqual(before);
  });
  it.skipIf(!hasAuthorizer).each(['request', 'finalize'] as const)('AP store native count UPDATE failure during %s rolls back all SQL facts and logical quota', phase => {
    const f = setup(); f.requirePort('commitApprovalRequest'); f.requirePort('finalizeApproval');
    const operation = approval(f); if (phase === 'finalize') f.api.commitApprovalRequest(operation);
    expect(f.db.setAuthorizer, 'real SQLite authorizer is required, not a replacement counter').toBeTypeOf('function');
    const before = f.snapshot(); let denied = 0;
    f.db.setAuthorizer((action, table, column) => { if (!denied && action === 23 && table === 'thread_bindings' && column === 'pending_approval_count') { denied++; return 1; } return 0; });
    try { expect(() => phase === 'request' ? f.api.commitApprovalRequest(operation) : f.api.finalizeApproval(terminal(f, operation))).toThrow(); }
    finally { f.db.setAuthorizer(null); }
    expect(denied).toBe(1); expect(f.snapshot()).toEqual(before);
  });
  it('AP store a stale boot cannot finalize a current request or insert a decision into a foreign group', () => {
    const f = setup(); f.requirePort('finalizeApproval'); const operation = approval(f); f.api.commitApprovalRequest(operation); const before = f.snapshot();
    expect(() => f.api.finalizeApproval({ ...terminal(f, operation), bootId: 'foreign-boot' })).toThrow();
    expect(() => f.api.finalizeApproval({ ...terminal(f, operation), decisionOperation: { ...operation, command: 'approval_decision', groupId: 'foreign' } })).toThrow();
    expect(f.snapshot()).toEqual(before);
  });
  it('AP store ordinary quota exhaustion still leaves terminal event and receipt able to use the existing reserve', () => {
    const f = setup({ maxBytes: 15000, reserveBytes: 5000 }); f.requirePort('commitApprovalRequest'); const operation = approval(f); f.api.commitApprovalRequest(operation);
    const filler: MultiAgentOperation = { groupId: f.group.groupId, operationId: 'ordinary-fill', command: 'ordinary', requestHash: 'fill', applyState: 'applied', result: { text: '' } };
    const length = 10000 - f.store.getByteUsage(f.group.groupId) - Buffer.byteLength(encodeMultiAgentRow(filler));
    expect(length).toBeGreaterThan(0); filler.result.text = 'x'.repeat(length); f.store.putOperation(filler);
    expect(f.store.getByteUsage(f.group.groupId)).toBe(10000);
    expect(f.api.finalizeApproval({ ...terminal(f, operation, 'invalidated'), reason: 'actor_aborted' }).changed).toBe(true);
    expect(f.store.getThread('thread')).toMatchObject({ pendingApprovalCount: 0 });
    expect(f.store.readEvents(f.group.groupId).at(-1)).toMatchObject({ kind: 'approval', payload: { status: 'invalidated', reason: 'actor_aborted' } });
  });
  it('AP store real indexed pages exclude ordinary operation siblings and preserve all terminal audit rows', () => {
    const f = setup(); f.requirePort('listApprovalRequests'); const ids: string[] = [];
    for (let turn = 1; turn <= 53; turn++) {
      const operation = approval(f, turn); (operation.result.approval as Record<string, unknown>).status = 'denied'; f.store.putOperation(operation); ids.push(operation.operationId);
    }
    const ordinary = approval(f, 54); f.store.putOperation({ ...ordinary, operationId: 'not-an-approval', command: 'ordinary' });
    const a = f.api.listApprovalRequests({ groupId: f.group.groupId, bootId: f.store.bootId });
    expect(a.items).toHaveLength(50);
    const b = f.api.listApprovalRequests({ groupId: f.group.groupId, bootId: f.store.bootId, cursor: a.nextCursor! });
    expect(b.items).toHaveLength(3); expect(b.nextCursor).toBeNull(); expect([...a.items, ...b.items].map(item => item.operationId)).toEqual(ids.sort());
    expect(f.api.listApprovalRequests({ groupId: f.group.groupId, bootId: 'different' }).items).toEqual([]);
  });
  it('AP store old-boot restart normalizes scalar pending once, preserves approved facts, and cannot recreate live authority', () => {
    const f = setup(); f.requirePort('commitApprovalRequest'); const pending = approval(f, 1), approved = approval(f, 2);
    f.api.commitApprovalRequest(pending); f.api.commitApprovalRequest(approved); f.api.finalizeApproval(terminal(f, approved)); f.store.close();
    const reopened = new DesktopMultiAgentStore(f.path, { bootId: 'new-boot' }); cleanup.push(() => reopened.close()); reopened.recoverPreviousBoot();
    expect(reopened.getOperation(f.group.groupId, pending.operationId)).toMatchObject({ result: { approval: { status: 'invalidated', reason: 'restart', persistenceState: 'confirmed' } } });
    expect(reopened.getOperation(f.group.groupId, approved.operationId)).toMatchObject({ result: { approval: { status: 'approved' } } });
    expect(reopened.getThread('thread')).toMatchObject({ pendingApprovalCount: 0, activeGroupId: null });
    const before = { rows: reopened.readEvents(f.group.groupId), thread: reopened.getThread('thread'), group: reopened.requireGroup(f.group.groupId) };
    reopened.recoverPreviousBoot(); expect({ rows: reopened.readEvents(f.group.groupId), thread: reopened.getThread('thread'), group: reopened.requireGroup(f.group.groupId) }).toEqual(before);
    expect(JSON.stringify(reopened.getOperation(f.group.groupId, pending.operationId))).not.toMatch(/canDecide|privateInput|waiter|grant/);
  });
});
