// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { DesktopMultiAgentStore, encodeMultiAgentRow } from '../../electron/desktop-multi-agent-store.js';
import type { MultiAgentOperation } from '../../shared/multi-agent-types.js';
import { authorizationFixture, deferred } from '../fixtures/multi-agent-authorization.js';

// This is fixture DATA, not a DTO projection implementation. Negative inputs
// below go directly through the existing production putOperation writer.
const durableKeys = ['approvalId', 'bootId', 'profileId', 'workspaceId', 'threadId', 'groupId', 'agentId', 'turn', 'turnId',
  'sourceTaskId', 'canonicalName', 'toolName', 'cwd', 'ownerId', 'slotId', 'capabilityId', 'revision', 'permissionRevision',
  'invocationNonce', 'inputSha256', 'inputByteLength', 'issuedAt', 'minDeadlineAt', 'status', 'persistenceState', 'reason'];
function fixtureMetadata(input: { store: DesktopMultiAgentStore; groupId: string; threadId: string; cwd: string; profileId?: string; workspaceId?: string }) {
  return {
    approvalId: randomUUID(), bootId: input.store.bootId, profileId: input.profileId ?? 'p'.repeat(64), workspaceId: input.workspaceId ?? 'w'.repeat(64),
    threadId: input.threadId, groupId: input.groupId, agentId: `root_${input.groupId}`, turn: 1, turnId: randomUUID(), sourceTaskId: `task_${randomUUID()}`,
    canonicalName: 'write', toolName: 'write', cwd: input.cwd, ownerId: randomUUID(), slotId: randomUUID(), capabilityId: randomUUID(),
    revision: 1, permissionRevision: 0, invocationNonce: randomUUID(), inputSha256: createHash('sha256').update('{}').digest('hex'), inputByteLength: 2,
    issuedAt: 1, minDeadlineAt: 600_001, status: 'pending', persistenceState: 'confirmed',
  };
}
function requestOperation(approval: Record<string, unknown>): MultiAgentOperation {
  return { groupId: approval.groupId as string, operationId: `approval-request:${approval.approvalId}`, command: 'approval_request',
    requestHash: 'f'.repeat(64), applyState: 'applied', result: { approval } };
}

describe('BDD AP-joint2: the real durable approval writer and restart boundary', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  function setup(threadId = 'dto-thread') {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-approval-dto-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite')); cleanup.push(() => store.close());
    store.registerThread({ threadId, profileId: 'p'.repeat(64), workspaceId: 'w'.repeat(64), cwd: root });
    const group = store.createGroup(threadId);
    const approval = fixtureMetadata({ store, groupId: group.groupId, threadId, cwd: root });
    const db = (store as unknown as { db: DatabaseSync }).db;
    const rawRows = () => db.prepare('SELECT operation_id,data_json,logical_bytes FROM operations WHERE group_id=? ORDER BY operation_id').all(group.groupId);
    return { root, store, db, group, approval, rawRows };
  }
  function assertRejected(f: ReturnType<typeof setup>, operation: MultiAgentOperation, control = false) {
    const before = f.rawRows(), usage = f.store.getByteUsage(f.group.groupId);
    expect(() => f.store.putOperation(operation, control), 'the actual approval request writer must reject before committing').toThrow();
    expect(f.rawRows()).toEqual(before); expect(f.store.getByteUsage(f.group.groupId)).toBe(usage);
  }

  it('AP-joint2 valid scalar-only request round-trips through actual SQLite without adding a decidable token', () => {
    const f = setup(); const operation = requestOperation(f.approval); f.store.putOperation(operation);
    expect(f.store.getOperation(f.group.groupId, operation.operationId)).toEqual(operation);
    const row = f.rawRows()[0] as { data_json: string; logical_bytes: number };
    expect(row.logical_bytes).toBe(Buffer.byteLength(encodeMultiAgentRow(operation)));
    expect(Object.keys(JSON.parse(row.data_json).result.approval).every(key => durableKeys.includes(key))).toBe(true);
    expect(row.data_json).not.toContain('canDecide');
  });

  it.each([
    ['privateInput', { content: 'PRIVATE_INPUT_MUST_NOT_BE_STORED' }],
    ['canonicalBytes', 'PRIVATE_CANONICAL_BYTES'],
    ['actor', { groupId: 'copied-public-id', agentId: 'root', turnId: 'turn' }],
    ['authority', { policyId: 'copied-authority-id' }],
    ['context', { taskId: 'copied-task', session: { cwd: 'copied-cwd' } }],
    ['grant', { approved: true }],
    ['canDecide', true],
  ])('AP-joint2 plain JSON %s is not a durable approval field, even though the generic encoder accepts it', (key, value) => {
    const f = setup(); const operation = requestOperation({ ...f.approval, [key as string]: value });
    expect(() => encodeMultiAgentRow(operation)).not.toThrow(); // Existing JSON validation alone cannot close this boundary.
    assertRejected(f, operation);
  });

  it('AP-joint2 the control-budget writer sibling cannot store a live grant or private input either', () => {
    const f = setup(); const operation = requestOperation({ ...f.approval, status: 'invalidated', reason: 'restart',
      canDecide: true, grant: { approved: true }, privateInput: { content: 'PRIVATE_CONTROL_INPUT' } });
    expect(() => encodeMultiAgentRow(operation)).not.toThrow();
    expect(Buffer.byteLength(encodeMultiAgentRow(operation))).toBeLessThan(4096);
    assertRejected(f, operation, true);
  });

  it('AP-joint2 an enum is an actual scalar, never a live object whose coercion hook may execute', () => {
    const f = setup(), coerce = vi.fn(() => 'confirmed');
    assertRejected(f, requestOperation({ ...f.approval, persistenceState: { toString: coerce } }));
    expect(coerce).not.toHaveBeenCalled();
  });
  it('AP-joint2 non-enumerable required identity must be rejected instead of silently disappearing from durable JSON', () => {
    const f = setup(), metadata = { ...f.approval };
    Object.defineProperty(metadata, 'bootId', { value: f.approval.bootId, enumerable: false });
    assertRejected(f, requestOperation(metadata));
  });

  it.each(['function', 'signal', 'promise'] as const)('AP-joint2 existing encoder compatibility: %s live objects are already refused and never stored', kind => {
    const f = setup(); const live = kind === 'function' ? () => true : kind === 'signal' ? new AbortController().signal : Promise.resolve(true);
    const operation = requestOperation({ ...f.approval, live });
    expect(() => encodeMultiAgentRow(operation)).toThrow(); assertRejected(f, operation);
  });

  it.each([
    ['turn', 1.5], ['revision', Number.MAX_SAFE_INTEGER + 1], ['permissionRevision', -1],
    ['inputByteLength', 2 * 1024 * 1024 + 1], ['inputSha256', 'A'.repeat(64)],
    ['status', 'running'], ['persistenceState', 'decidable'], ['reason', 'arbitrary private error'],
  ])('AP-joint2 durable scalar validation rejects invalid %s without a request row or quota change', (key, value) => {
    const f = setup(); assertRejected(f, requestOperation({ ...f.approval, [key as string]: value }));
  });

  it.each([4096, 4097])('AP-joint2 the ENTIRE ordinary-budget terminal request row has an exact %i-byte boundary', bytes => {
    // All identifiers/names remain <=256 UTF-16 units. A control-character
    // threadId is accepted by the existing production IPC id predicate; JSON
    // escaping, not an invented padding field, supplies the extra wire bytes.
    const f = setup('\u0001'.repeat(256));
    // Pending admission now reserves all legal finalizations (separate 4053 /
    // 4054 boundary tests). Keep this original 4096 / 4097 TOTAL-row gate on a
    // terminal DTO, which cannot grow into a later approval state.
    const approval = { ...f.approval, canonicalName: 'x'.repeat(256), toolName: 'x'.repeat(256), status: 'denied', reason: 'user_denied' };
    const initial = requestOperation(approval);
    const remaining = bytes - Buffer.byteLength(encodeMultiAgentRow(initial));
    expect(remaining).toBeGreaterThan(0);
    let cwd = f.root;
    const rowBytes = (candidate: string) => Buffer.byteLength(encodeMultiAgentRow(requestOperation({ ...approval, cwd: candidate })));
    while (bytes - rowBytes(cwd) > 80) cwd = join(cwd, 'x'.repeat(60));
    const needed = bytes - rowBytes(cwd);
    if (needed > 0) {
      // Measure the production encoder, including Windows' escaped separator;
      // no platform-specific JSON byte-count approximation is reproduced here.
      const oneCharacterSegment = rowBytes(join(cwd, 'x')) - rowBytes(cwd);
      cwd = needed >= oneCharacterSegment ? join(cwd, 'x'.repeat(needed - oneCharacterSegment + 1))
        : join(dirname(cwd), `${basename(cwd)}${'x'.repeat(needed)}`);
    }
    expect(cwd.length).toBeLessThanOrEqual(1024); mkdirSync(cwd, { recursive: true });
    approval.cwd = cwd;
    const operation = requestOperation(approval);
    expect(Buffer.byteLength(encodeMultiAgentRow(operation))).toBe(bytes);
    if (bytes === 4097) assertRejected(f, operation);
    else { f.store.putOperation(operation); expect(f.store.getOperation(f.group.groupId, operation.operationId)).toEqual(operation); }
  });

  it('AP-joint2 approval-request updates cannot bypass the row cap through an existing operation id', () => {
    const f = setup(); const original = requestOperation(f.approval); f.store.putOperation(original);
    const oversized = requestOperation({ ...f.approval, cwd: '丙😀'.repeat(1000) });
    expect(Buffer.byteLength(encodeMultiAgentRow(oversized))).toBeGreaterThan(4096);
    assertRejected(f, oversized); expect(f.store.getOperation(f.group.groupId, original.operationId)).toEqual(original);
  });

  it('AP-joint2 ordinary non-approval operation retains its existing budget and generic JSON contract', () => {
    const f = setup(); const operation: MultiAgentOperation = { groupId: f.group.groupId, operationId: 'ordinary', command: 'ordinary-fixture',
      requestHash: 'ordinary', applyState: 'applied', result: { ordinaryPayload: 'x'.repeat(5000) } };
    expect(Buffer.byteLength(encodeMultiAgentRow(operation))).toBeGreaterThan(4096);
    f.store.putOperation(operation); expect(f.store.getOperation(f.group.groupId, operation.operationId)).toEqual(operation);
  });

  it('AP-joint2 real transport projects its live actor/signal/private input into scalar-only SQLite metadata', async () => {
    const f = await authorizationFixture(cleanup), entered = deferred(), release = deferred(); cleanup.push(() => release.resolve());
    const effect = join(f.root, 'private-effect.txt'); let requests = 0;
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
      yield { type: 'thinking', delta: '', reasoningProvenance: { captureVersion: 1, source: 'reasoning_content', fieldPresence: 'present' } };
      if (++requests === 1) { yield { type: 'tool_use', id: 'dto-write', name: 'write', input: { file_path: effect, content: 'REAL_PRIVATE_INPUT_NOT_AUDIT' } }; entered.resolve(); }
      else { await release.promise; yield { type: 'text', delta: 'Finished.' }; }
    });
    await f.services.createTask({ prompt: 'Request one write.', permissionMode: 'default', materials: [], context: { threadId: 'real-dto' } });
    await entered.promise;
    const rows = () => f.db.prepare("SELECT data_json FROM operations WHERE json_extract(data_json,'$.command')='approval_request'").all() as Array<{ data_json: string }>;
    await vi.waitFor(() => expect(requests >= 2 || rows().length === 1).toBe(true));
    expect(rows(), 'missing real pending transport request; later DTO projection assertions have not run').toHaveLength(1);
    expect(f.contexts[0].signal).toBeInstanceOf(AbortSignal);
    const raw = rows()[0].data_json, approval = JSON.parse(raw).result.approval;
    expect(Object.keys(approval).every(key => durableKeys.includes(key))).toBe(true);
    expect(approval).toMatchObject({ agentId: f.contexts[0].agentId, turnId: f.contexts[0].turnId, status: 'pending', persistenceState: 'confirmed' });
    expect(approval).not.toHaveProperty('canDecide'); expect(approval).not.toHaveProperty('privateInput');
    expect(raw).not.toContain('REAL_PRIVATE_INPUT_NOT_AUDIT'); expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(4096);
    expect(existsSync(effect)).toBe(false); expect(requests).toBe(1);
  });

  it.each(['confirmed', 'unknown'] as const)('AP-joint2 actual quiesced factory reopen invalidates old-boot pending/%s scalars without recreating approval authority', async persistenceState => {
    // This is a real dispose/quiesced reopen, NOT a process-crash claim. No PID
    // or boot_owners rows are edited, no waiter/recovery reducer is substituted.
    const first = await authorizationFixture(cleanup);
    const threadId = 'reopen-dto';
    first.boundary.service.registerThread({ threadId, profileId: first.boundary.profileId, workspaceId: first.boundary.workspaceId, cwd: first.root });
    const group = first.store.createGroup(threadId);
    const approval = { ...fixtureMetadata({ store: first.store, groupId: group.groupId, threadId, cwd: first.root,
      profileId: first.boundary.profileId, workspaceId: first.boundary.workspaceId }), persistenceState };
    const operation = requestOperation(approval); first.store.putOperation(operation);
    const oldBoot = first.store.bootId;
    await first.services.disposeMultiAgent(); expect(first.store.isClosed()).toBe(true);
    const model = vi.spyOn(OpenAIAdapter.prototype, 'stream');
    const second = await authorizationFixture(cleanup, first.root);
    expect(second.store.bootId).not.toBe(oldBoot);
    expect(second.db.prepare('SELECT state FROM boot_owners WHERE boot_id=?').get(oldBoot)).toMatchObject({ state: 'quiesced' });
    const recovered = second.store.getOperation(group.groupId, operation.operationId);
    expect(recovered, 'production ready/recovery must normalize persisted request metadata before reopening admission').toMatchObject({
      result: { approval: { ...approval, status: 'invalidated', persistenceState: 'confirmed', reason: 'restart' } },
    });
    const scope = { threadId, groupId: group.groupId, approvalId: approval.approvalId };
    const view = await second.invoke<Record<string, unknown>>('getMultiAgentApproval', { ...scope, inputOffset: 0 });
    expect(view).toMatchObject({ status: 'invalidated', reason: 'restart', canDecide: false }); expect(view).not.toHaveProperty('inputPage');
    await expect(second.invoke('decideMultiAgentApproval', { ...scope, operationId: 'cannot-revive-scalars', decision: 'approve' })).rejects.toThrow(/invalidated|restart|historical|stale/);
    expect(() => second.boundary.service.assertInvocation({ groupId: group.groupId, agentId: approval.agentId, turnId: approval.turnId })).toThrow();
    expect(model).not.toHaveBeenCalled();
    const stable = second.store.getOperation(group.groupId, operation.operationId);
    expect(stable).toEqual(recovered);
  });
});
