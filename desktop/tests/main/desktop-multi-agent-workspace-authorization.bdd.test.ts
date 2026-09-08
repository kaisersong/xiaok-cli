// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { authorizationFixture, authorizationRequest, deferred, failNextAuthorizationCommit,
  type Authorization, type AuthorizationReceipt, type AuthorizationRequest } from '../fixtures/multi-agent-authorization.js';

describe('BDD W9/W12/W16: real factory workspace authority and reload recovery', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it.each([
    ['revoke', 'before'], ['revoke', 'after'], ['grant', 'before'], ['grant', 'after'],
  ] as const)('W9/W12/W16 Given %s %s-COMMIT failure and a lost unknown ACK, Then a new authenticated sender recovers only the original retry and settles candidate revision once', async (operation, position) => {
    const f = await authorizationFixture(cleanup);
    const initial = await f.getAuthorization();
    expect(initial).toMatchObject({ permissionRevision: 0, executionAllowed: true, persistenceState: 'confirmed' });
    const entered = deferred(), release = deferred(); cleanup.push(() => release.resolve());
    const effect = join(f.root, 'must-not-run-after-revoke.txt');
    let requests = 0;
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
      requests++;
      yield { type: 'thinking', delta: '', reasoningProvenance: { captureVersion: 1, source: 'reasoning_content', fieldPresence: 'present' } };
      entered.resolve(); await release.promise;
      yield { type: 'tool_use', id: 'late-write', name: 'write', input: { file_path: effect, content: 'must not execute' } };
    });
    const created = await f.services.createTask({ prompt: 'Wait then write once.', permissionMode: 'auto', materials: [], context: { threadId: 'authority-thread' } });
    await entered.promise;
    const context = f.contexts[0]!; expect(context).toBeDefined();
    let aborts = 0; context.signal.addEventListener('abort', () => { aborts++; });
    if (operation === 'grant') await f.setAuthorization(authorizationRequest(initial, false, 'initial-deny'));
    const prior = await f.getAuthorization(), request = authorizationRequest(prior, operation === 'grant', 'lost-response');
    const candidate = prior.permissionRevision + 1;
    const fault = failNextAuthorizationCommit(f.db, position); cleanup.push(fault.restore);
    const lost = await f.setAuthorization(request); // Deliberately never deliver this ACK to a renderer cache.
    expect(fault.faults()).toBe(1);
    expect(lost).toMatchObject({ state: 'unknown', permissionRevision: candidate, executionAllowed: false, persistenceState: 'unknown' });
    expect(context.signal.aborted).toBe(true); expect(aborts).toBe(1);
    const old = f.reload();
    const recovered = await f.getAuthorization();
    expect(recovered).toMatchObject({ permissionRevision: candidate, executionAllowed: false, persistenceState: 'unknown', pendingOperation: request });
    expect(recovered.pendingOperation!.expectedPermissionRevision).toBe(prior.permissionRevision);
    const readsBefore = fault.writePreparations();
    const subscribed = await f.invoke<{ authorization: Authorization }>('subscribeLocalExecutionAuthorization', { subscriptionId: 'reloaded' });
    expect(subscribed.authorization).toMatchObject(recovered);
    expect(await f.invoke('getLocalExecutionAuthorizationOperation', { operationId: request.operationId })).toMatchObject({ kind: 'receipt', receipt: lost });
    expect(fault.writePreparations()).toBe(readsBefore);
    await expect(f.invoke('getLocalExecutionAuthorization', {}, old)).rejects.toThrow(/unauthorized/);
    await expect(f.setAuthorization(authorizationRequest(recovered, true, 'new-id'))).rejects.toThrow(/authorization_persistence_unknown/);
    await expect(f.setAuthorization({ ...request, executionAllowed: !request.executionAllowed })).rejects.toThrow(/conflict/);
    f.changePrincipal('different-user');
    await expect(f.getAuthorization()).rejects.toThrow(/owner|unauthorized|subject/);
    f.changePrincipal(`desktop-user:${f.boundary.profileId}`);
    expect(await f.getAuthorization()).toMatchObject(recovered);
    const writeBeforeRetry = fault.writePreparations();
    const confirmed = await f.setAuthorization(recovered.pendingOperation!);
    const allowed = operation === 'grant' && position === 'after';
    expect(confirmed).toMatchObject({ operationId: request.operationId, state: 'applied', permissionRevision: candidate, executionAllowed: allowed, persistenceState: 'confirmed' });
    if (operation === 'grant' && position === 'before') expect(confirmed).toMatchObject({ outcome: 'rejected', error: 'grant_not_applied' });
    if (position === 'after') expect(fault.writePreparations()).toBe(writeBeforeRetry);
    const stable = await f.getAuthorization();
    expect(stable).toMatchObject({ permissionRevision: candidate, executionAllowed: allowed, persistenceState: 'confirmed' });
    expect(stable).not.toHaveProperty('pendingOperation');
    expect(f.db.prepare('SELECT permission_revision,execution_allowed FROM workspace_execution_authorizations WHERE profile_id=? AND workspace_id=?')
      .get(f.boundary.profileId, f.boundary.workspaceId)).toMatchObject({ permission_revision: candidate, execution_allowed: Number(allowed) });
    const storedBeforeReplay = f.db.prepare('SELECT * FROM workspace_execution_authorizations').all();
    expect(await f.setAuthorization(request)).toEqual(confirmed);
    expect(f.db.prepare('SELECT * FROM workspace_execution_authorizations').all()).toEqual(storedBeforeReplay);
    expect(aborts).toBe(1);
    expect(() => f.boundary.service.assertInvocation(context.actor)).toThrow();
    release.resolve();
    await vi.waitFor(async () => expect(['completed', 'failed', 'cancelled', 'interrupted']).toContain((await f.services.recoverTask(created.taskId)).snapshot.status));
    expect(requests).toBe(1); expect(existsSync(effect)).toBe(false);
    expect(f.sent.filter(item => item.senderId === old.sender.id)).toEqual([]);
  });

  it('W16 Given main already confirmed and only the outgoing ACK is lost, Then reload stays confirmed without inventing a pending retry', async () => {
    const f = await authorizationFixture(cleanup); const initial = await f.getAuthorization();
    const request = authorizationRequest(initial, false, 'pure-ack-loss');
    const handlerResult = await f.setAuthorization(request);
    expect(handlerResult.persistenceState).toBe('confirmed');
    f.reload();
    const current = await f.getAuthorization();
    expect(current).toMatchObject({ executionAllowed: false, permissionRevision: initial.permissionRevision + 1, persistenceState: 'confirmed' });
    expect(current).not.toHaveProperty('pendingOperation');
    expect(await f.invoke('getLocalExecutionAuthorizationOperation', { operationId: request.operationId })).toMatchObject({ kind: 'receipt', receipt: handlerResult });
    expect(await f.setAuthorization(request)).toEqual(handlerResult);
  });

  it('W16 Given grant was not committed and its rejection settlement committed before another confirmation failure, Then the same original retry confirms denied without ever granting', async () => {
    const f = await authorizationFixture(cleanup);
    await f.setAuthorization(authorizationRequest(await f.getAuthorization(), false, 'first-deny'));
    const denied = await f.getAuthorization(), request = authorizationRequest(denied, true, 'failed-grant');
    const first = failNextAuthorizationCommit(f.db, 'before');
    try { expect(await f.setAuthorization(request)).toMatchObject({ state: 'unknown', executionAllowed: false, permissionRevision: denied.permissionRevision + 1 }); expect(first.faults()).toBe(1); }
    finally { first.restore(); }
    const second = failNextAuthorizationCommit(f.db, 'after');
    try { expect(await f.setAuthorization(request)).toMatchObject({ state: 'unknown', executionAllowed: false, permissionRevision: denied.permissionRevision + 1 }); expect(second.faults()).toBe(1); }
    finally { second.restore(); }
    f.reload();
    expect(await f.getAuthorization()).toMatchObject({ persistenceState: 'unknown', pendingOperation: request });
    const durable = f.db.prepare('SELECT permission_revision,execution_allowed,last_receipt_json FROM workspace_execution_authorizations').get();
    const result = await f.setAuthorization(request);
    expect(result).toMatchObject({ state: 'applied', persistenceState: 'confirmed', executionAllowed: false, permissionRevision: denied.permissionRevision + 1,
      outcome: 'rejected', error: 'grant_not_applied' });
    expect(f.db.prepare('SELECT permission_revision,execution_allowed,last_receipt_json FROM workspace_execution_authorizations').get()).toEqual(durable);
    expect(await f.getAuthorization()).not.toHaveProperty('pendingOperation');
  });

  it.each(['committed-deny', 'uncommitted-deny', 'retired-receipt'] as const)('W9/W16 Given the actual previous owner exits without dispose (%s), Then boot fencing reads only retained durable facts and never replays an old operation', async mode => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-auth-crash-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
    const child = await promisify(execFile)(process.execPath, ['--import', loader,
      fileURLToPath(new URL('../fixtures/multi-agent-authorization-crash.mts', import.meta.url)), root, mode], { timeout: 20_000, maxBuffer: 256 * 1024 });
    const line = child.stdout.split('\n').find(value => value.startsWith('FIXTURE_RESULT '));
    expect(line).toBeTruthy();
    const old = JSON.parse(line!.slice('FIXTURE_RESULT '.length)) as {
      prior: Authorization; beforeExit: Authorization; request: AuthorizationRequest; receipt: AuthorizationReceipt; faults: number;
    };
    if (mode === 'uncommitted-deny') {
      expect(old.faults).toBe(1); expect(old.beforeExit).toMatchObject({ executionAllowed: false, persistenceState: 'unknown' });
    }
    const f = await authorizationFixture(cleanup, root), recovered = await f.getAuthorization();
    expect(recovered.bootId).not.toBe(old.prior.bootId);
    expect(recovered).toMatchObject({ executionAllowed: mode !== 'committed-deny', persistenceState: 'confirmed' });
    expect(recovered).not.toHaveProperty('pendingOperation');
    const query = await f.invoke('getLocalExecutionAuthorizationOperation', { operationId: old.request.operationId });
    if (mode === 'committed-deny') {
      expect(query).toMatchObject({ kind: 'receipt', receipt: old.receipt });
      expect(await f.setAuthorization(old.request)).toEqual(old.receipt);
    } else {
      expect(query).toMatchObject({ kind: 'receipt_expired_unknown' });
      await expect(f.setAuthorization(old.request)).rejects.toThrow();
    }
    const fresh = authorizationRequest(recovered, !recovered.executionAllowed, 'current-boot-never-submitted');
    expect(await f.invoke('getLocalExecutionAuthorizationOperation', { operationId: fresh.operationId })).toMatchObject({ kind: 'not_found' });
    expect(await f.getAuthorization()).toEqual(recovered);
  });

  it('W10 Given forged frame/source/domain and non-confirmed commands, Then semantic IPC rejects before touching the real owner row', async () => {
    const f = await authorizationFixture(cleanup); const initial = await f.getAuthorization();
    const request = authorizationRequest(initial, false, 'forgery');
    const before = f.db.prepare('SELECT * FROM workspace_execution_authorizations').all();
    await expect(f.invoke('setLocalExecutionAuthorization', request, { ...f.caller(), senderFrame: {} })).rejects.toThrow(/unauthorized/);
    for (const extra of [{ requestSource: 'agent' }, { requestSource: 'scheduler' }, { workspaceId: 'foreign' }, { actorId: 'forged' }, { profileId: 'foreign' }]) {
      await expect(f.invoke('setLocalExecutionAuthorization', { ...request, ...extra })).rejects.toThrow(/argument/);
    }
    await expect(f.invoke('setLocalExecutionAuthorization', { ...request, confirm: false })).rejects.toThrow(/confirm/);
    expect(f.db.prepare('SELECT * FROM workspace_execution_authorizations').all()).toEqual(before);
    expect(await f.getAuthorization()).toEqual(initial);
  });

  it('W14 Given repeated same-state setters and a retired receipt, Then revision CAS prevents replay without an ever-growing history table', async () => {
    const f = await authorizationFixture(cleanup); let state = await f.getAuthorization();
    await expect(f.setAuthorization(authorizationRequest(state, true, 'same-state'))).rejects.toThrow(/already_in_requested_state/);
    const first = authorizationRequest(state, false, 'first'); let latest: AuthorizationReceipt | undefined;
    for (let index = 0; index < 1_000; index++) {
      latest = await f.setAuthorization(index === 0 ? first : authorizationRequest(state, !state.executionAllowed, `bounded-${index}`));
      state = await f.getAuthorization();
      expect(state.permissionRevision).toBe(index + 1);
    }
    const rows = f.db.prepare('SELECT * FROM workspace_execution_authorizations').all();
    expect(rows).toHaveLength(1); expect(Buffer.byteLength(JSON.stringify(rows[0]))).toBeLessThanOrEqual(4096);
    expect(await f.invoke('getLocalExecutionAuthorizationOperation', { operationId: first.operationId })).toMatchObject({ kind: 'receipt_expired_unknown' });
    await expect(f.setAuthorization(first)).rejects.toThrow();
    expect(await f.getAuthorization()).toEqual(state);
    expect(latest!.permissionRevision).toBe(1_000);
  });
});
