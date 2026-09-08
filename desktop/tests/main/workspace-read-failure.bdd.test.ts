// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { authorizationFixture, authorizationRequest, deferred,
  type AuthorizationRequest, type SqliteWithAuthorizer } from '../fixtures/multi-agent-authorization.js';
import { compileVerifierEntry } from '../fixtures/desktop-post-seal-verifier-contract.js';

// Only the source-mode fixed Worker URL is mapped. CPU evaluation, filesystem
// effects, message/error/exit and the actual host settlement remain native.
const nativeWorker = vi.hoisted(() => ({ output: '', root: '', starts: 0, exits: 0 }));
vi.mock('node:worker_threads', async importOriginal => {
  const actual = await importOriginal<typeof import('node:worker_threads')>();
  const source = new URL('../../../src/runtime/task-host/delivery-verifier-worker.js', import.meta.url).href;
  return { ...actual, Worker: class extends actual.Worker {
    constructor(filename: ConstructorParameters<typeof actual.Worker>[0], options?: ConstructorParameters<typeof actual.Worker>[1]) {
      const mapped = String(filename) === source;
      if (mapped && !nativeWorker.output) throw new Error('test compiled Worker entry is not ready');
      super(mapped ? nativeWorker.output : filename, options);
      if (mapped) { nativeWorker.starts++; this.once('exit', () => { nativeWorker.exits++; }); }
    }
  } };
});
beforeAll(async () => { Object.assign(nativeWorker, await compileVerifierEntry('delivery-verifier-worker.ts')); });
afterAll(() => {
  try { expect(nativeWorker.exits).toBe(nativeWorker.starts); }
  finally { if (nativeWorker.root) rmSync(nativeWorker.root, { recursive: true, force: true, maxRetries: 3 }); }
});

// Native SQLite READ (20), DENY (1), OK (0). No replacement Service/Store
// decision logic: SQLite itself rejects the first workspace-table read.
function failFirstWorkspaceRead(db: SqliteWithAuthorizer) {
  let faults = 0;
  db.setAuthorizer((action, table) => {
    if (action === 20 && table === 'workspace_execution_authorizations' && faults === 0) { faults++; return 1; }
    return 0;
  });
  return { faults: () => faults, restore: () => db.setAuthorizer(null) };
}

describe('BDD W12/W16: native first authorization READ failure at the real factory boundary', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  async function pair(withOldReceipt = false) {
    const f = await authorizationFixture(cleanup);
    let oldRevoke: AuthorizationRequest | undefined, retainedGrant: AuthorizationRequest | undefined;
    if (withOldReceipt) {
      oldRevoke = authorizationRequest(await f.getAuthorization(), false, 'retired-revoke');
      await f.setAuthorization(oldRevoke);
      retainedGrant = authorizationRequest(await f.getAuthorization(), true, 'retained-grant');
      await f.setAuthorization(retainedGrant);
    }
    const rootEntered = deferred(), childEntered = deferred(), release = deferred();
    cleanup.push(() => release.resolve());
    const effects = { root: join(f.root, 'root-after-read-fault.txt'), child: join(f.root, 'child-after-read-fault.txt') };
    const requests = { root: 0, child: 0 };
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* (_messages, _tools, system) {
      const role = system?.includes('Assigned Desktop agent:') ? 'child' : 'root';
      const count = ++requests[role];
      yield { type: 'thinking', delta: '', reasoningProvenance: { captureVersion: 1, source: 'reasoning_content', fieldPresence: 'present' } };
      if (count === 1) yield role === 'root'
        ? { type: 'tool_use', id: 'spawn-read-fault-child', name: 'spawn_agent', input: { task_name: 'read_fault_child', message: 'Send main one message, then wait.', fork_context: false } }
        : { type: 'tool_use', id: 'read-fault-child-ready', name: 'send_message', input: { target: 'main', message: 'READ_FAULT_CHILD_READY' } };
      else if (count === 2) {
        (role === 'root' ? rootEntered : childEntered).resolve(); await release.promise;
        yield { type: 'tool_use', id: `${role}-after-read-fault`, name: 'write', input: { file_path: effects[role], content: 'actual tool effect after adapter barrier' } };
      } else yield { type: 'text', delta: `${role} finished.` };
    });
    const created = await f.services.createTask({ prompt: 'Delegate one child, then save the result and finish.', permissionMode: 'auto', materials: [], context: { threadId: 'workspace-read-failure' } });
    await Promise.all([rootEntered.promise, childEntered.promise]);
    const root = f.contexts.find(context => context.agentId === `root_${context.groupId}`)!;
    const child = f.contexts.find(context => context.agentId !== `root_${context.groupId}`)!;
    expect(root).toBeDefined(); expect(child).toBeDefined(); expect(child.groupId).toBe(root.groupId);
    expect(f.store.listMessages(root.groupId, root.agentId).some(message => message.preview === 'READ_FAULT_CHILD_READY')).toBe(true);
    const aborts = { root: 0, child: 0 };
    root.signal.addEventListener('abort', () => { aborts.root++; });
    child.signal.addEventListener('abort', () => { aborts.child++; });
    const settled = async () => {
      await vi.waitFor(async () => expect(['completed', 'failed', 'cancelled', 'interrupted']).toContain((await f.services.recoverTask(created.taskId)).snapshot.status));
      await vi.waitFor(() => expect(f.store.getAgent(root.groupId, child.agentId)?.executionActive).toBe(false));
    };
    return { ...f, rootContext: root, childContext: child, oldRevoke, retainedGrant, release, effects, requests, aborts, settled };
  }

  it('W12 Given live root+child ignore abort, When a legitimate new revoke hits its first native READ failure, Then memory denies immediately and neither real next write/model dispatch occurs', async () => {
    const f = await pair(), prior = await f.getAuthorization(), request = authorizationRequest(prior, false, 'first-read-live-revoke');
    const fault = failFirstWorkspaceRead(f.db); cleanup.push(fault.restore);
    const result = await f.setAuthorization(request).then(receipt => ({ receipt }), error => ({ error: String(error) }));
    fault.restore();
    expect(fault.faults()).toBe(1);
    expect.soft(result).toMatchObject({ receipt: { operationId: request.operationId, state: 'unknown', permissionRevision: prior.permissionRevision + 1, executionAllowed: false, persistenceState: 'unknown' } });
    expect.soft(await f.getAuthorization()).toMatchObject({ permissionRevision: prior.permissionRevision + 1, executionAllowed: false, persistenceState: 'unknown', pendingOperation: request });
    expect.soft(f.aborts).toEqual({ root: 1, child: 1 });
    expect.soft(f.rootContext.signal.aborted).toBe(true); expect.soft(f.childContext.signal.aborted).toBe(true);
    expect(f.store.getAgent(f.rootContext.groupId, f.childContext.agentId)).toMatchObject({ resourcesReleased: false, executionActive: true });
    expect(f.requests).toEqual({ root: 2, child: 2 });
    // The fault did not persist a revocation. Only the real in-memory owner can
    // stop these effects; this is not a read-after-write assertion in disguise.
    expect(f.store.readWorkspaceAuthorization(f.boundary)).toMatchObject({ permissionRevision: prior.permissionRevision, executionAllowed: true });
    f.release.resolve(); await f.settled();
    expect.soft(existsSync(f.effects.root)).toBe(false); expect.soft(existsSync(f.effects.child)).toBe(false);
    expect.soft(f.requests).toEqual({ root: 2, child: 2 });
    const confirmed = await f.setAuthorization(request);
    expect(confirmed).toMatchObject({ state: 'applied', permissionRevision: prior.permissionRevision + 1, executionAllowed: false });
    expect(await f.setAuthorization(request)).toEqual(confirmed);
    expect(f.store.requireGroup(f.rootContext.groupId).permissionRevision).toBe(prior.permissionRevision);
  });

  it('W16 Given the first revoke READ failed, Then a reloaded same-user sender recovers only the original retry and one candidate, without repeating abort or reviving the old group', async () => {
    const f = await pair(), prior = await f.getAuthorization(), request = authorizationRequest(prior, false, 'first-read-reload');
    const fault = failFirstWorkspaceRead(f.db); cleanup.push(fault.restore);
    const first = await f.setAuthorization(request).then(receipt => ({ receipt }), error => ({ error: String(error) }));
    fault.restore(); expect(fault.faults()).toBe(1);
    expect.soft(first).toMatchObject({ receipt: { state: 'unknown', permissionRevision: prior.permissionRevision + 1 } });
    f.reload();
    const recovered = await f.getAuthorization();
    expect.soft(recovered).toMatchObject({ permissionRevision: prior.permissionRevision + 1, persistenceState: 'unknown', executionAllowed: false, pendingOperation: request });
    expect.soft(f.aborts).toEqual({ root: 1, child: 1 });
    const other = await f.setAuthorization(authorizationRequest(recovered, true, 'not-the-original-retry')).then(receipt => ({ receipt }), error => ({ error: String(error) }));
    expect.soft(other).toMatchObject({ error: expect.stringMatching(/authorization_persistence_unknown/) });
    const receipt = await f.setAuthorization(request);
    expect(receipt).toMatchObject({ state: 'applied', permissionRevision: prior.permissionRevision + 1, executionAllowed: false });
    expect(await f.setAuthorization(request)).toEqual(receipt);
    expect(f.aborts).toEqual({ root: 1, child: 1 });
    expect(await f.getAuthorization()).not.toHaveProperty('pendingOperation');
    f.release.resolve(); await f.settled();
    expect(existsSync(f.effects.root)).toBe(false); expect(existsSync(f.effects.child)).toBe(false);
    expect(f.requests).toEqual({ root: 2, child: 2 });
  });

  it('W12 Given execution was already denied, When a new grant first READ fails, Then it reserves one denied unknown candidate and explicit retry records rejection instead of granting', async () => {
    const f = await authorizationFixture(cleanup);
    await f.setAuthorization(authorizationRequest(await f.getAuthorization(), false, 'initial-deny'));
    const prior = await f.getAuthorization(), request = authorizationRequest(prior, true, 'first-read-grant');
    const fault = failFirstWorkspaceRead(f.db); cleanup.push(fault.restore);
    const result = await f.setAuthorization(request).then(receipt => ({ receipt }), error => ({ error: String(error) }));
    fault.restore(); expect(fault.faults()).toBe(1);
    expect.soft(result).toMatchObject({ receipt: { state: 'unknown', permissionRevision: prior.permissionRevision + 1, executionAllowed: false, persistenceState: 'unknown' } });
    expect.soft(await f.getAuthorization()).toMatchObject({ permissionRevision: prior.permissionRevision + 1, executionAllowed: false, persistenceState: 'unknown', pendingOperation: request });
    const retry = await f.setAuthorization(request);
    expect.soft(retry).toMatchObject({ state: 'applied', permissionRevision: prior.permissionRevision + 1, executionAllowed: false, outcome: 'rejected', error: 'grant_not_applied' });
    expect(await f.setAuthorization(request)).toEqual(retry);
  });

  it.each(['retired-revoke', 'retained-grant', 'retained-id-different-input', 'old-boot', 'same-state', 'invalid-confirm', 'revision-mismatch', 'malformed-id', 'cross-user'] as const)(
    'W12 healthy control: %s cannot use a pending native READ fault to cancel a currently authorized root or child', async kind => {
      const f = await pair(true), prior = await f.getAuthorization();
      let input: unknown = authorizationRequest(prior, false, 'untrusted-read-failure');
      if (kind === 'retired-revoke') input = f.oldRevoke!;
      if (kind === 'retained-grant') input = f.retainedGrant!;
      if (kind === 'retained-id-different-input') input = { ...f.retainedGrant!, executionAllowed: false };
      if (kind === 'old-boot') input = { ...input as object, operationId: `exec-auth:retired-boot:${prior.permissionRevision}:old-boot` };
      if (kind === 'same-state') input = authorizationRequest(prior, true, 'unchanged');
      if (kind === 'invalid-confirm') input = { ...input as object, confirm: false };
      if (kind === 'revision-mismatch') input = { ...input as object, expectedPermissionRevision: prior.permissionRevision + 1 };
      if (kind === 'malformed-id') input = { ...input as object, operationId: 'not-an-authorization-id' };
      if (kind === 'cross-user') f.changePrincipal('desktop-user:foreign-profile');
      const fault = failFirstWorkspaceRead(f.db); cleanup.push(fault.restore);
      const result = await f.invoke('setLocalExecutionAuthorization', input).then(receipt => ({ receipt }), error => ({ error: String(error) }));
      fault.restore(); f.changePrincipal(`desktop-user:${f.boundary.profileId}`);
      expect(result).toHaveProperty('error');
      // Early input/source rejection may correctly avoid SQLite entirely.
      expect(fault.faults()).toBeLessThanOrEqual(1);
      expect(await f.getAuthorization()).toEqual(prior);
      expect(f.aborts).toEqual({ root: 0, child: 0 });
      expect(f.rootContext.signal.aborted).toBe(false); expect(f.childContext.signal.aborted).toBe(false);
      expect(() => f.boundary.service.assertInvocation(f.rootContext.actor, f.rootContext)).not.toThrow();
      expect(() => f.boundary.service.assertInvocation(f.childContext.actor, f.childContext)).not.toThrow();
      f.release.resolve(); await f.settled();
      expect(existsSync(f.effects.root)).toBe(true); expect(existsSync(f.effects.child)).toBe(true);
      expect(f.requests).toEqual({ root: 3, child: 3 });
    });
});
