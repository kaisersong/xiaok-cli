import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const remote = vi.hoisted(() => ({ prepare: vi.fn(), approve: vi.fn(), recover: vi.fn(), reconcile: vi.fn(), inspect: vi.fn(), dispose: vi.fn() }));
vi.mock('../../../src/runtime/verification/installed-completion-publication.js', () => ({ createInstalledCompletionPublisher: () => ({
  prepareRequest: remote.prepare, approve: remote.approve, recoverRequest: remote.recover, reconcile: remote.reconcile, dispose: remote.dispose,
}) }));
vi.mock('../../../src/runtime/verification/installed-goal-application.js', () => ({ createInstalledGoalApplicationClient: () => ({ inspect: remote.inspect, dispose: remote.dispose }) }));
import { createGoalPublicationWorkflow } from '../../../src/runtime/goal/publication-workflow.js';
import { FileGoalStore } from '../../../src/runtime/goal/file-store.js';
import { InMemoryGoalStore } from '../../../src/runtime/goal/memory-store.js';
import { SqliteGoalStore } from '../../../desktop/electron/goal-store-sqlite.js';
import { GoalService } from '../../../src/runtime/goal/service.js';
import { goalApplicationFromState } from '../../../src/runtime/goal/completion-intent.js';
import type { GoalStore } from '../../../src/runtime/goal/types.js';
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
beforeEach(() => { for (const fn of Object.values(remote)) fn.mockReset(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
for (const kind of ['file', 'memory', 'sqlite'] as const) {
  async function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'goal-publication-workflow-')); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const store: GoalStore = kind === 'file' ? new FileGoalStore(root) : kind === 'memory' ? new InMemoryGoalStore() : new SqliteGoalStore(join(root, 'goals.db'));
    if (store instanceof SqliteGoalStore) cleanups.push(() => store.close());
    const service = new GoalService({ store, ownership: { assertOwned() {} }, now: () => 10 });
    const context = { sessionId: 'session', instanceId: 'instance', requestSource: 'runtime' as const, expectedRevision: 1 };
    const state = await service.create({ ...context, requestSource: 'user', expectedRevision: null }, { objective: 'goal', expectedEvidenceKinds: ['answer'] });
    const intent = await service.requestCompletion(context, { taskId: 'task', turnId: 'turn', summary: 'done' });
    await service.recordTurn({ ...context, expectedRevision: 2 }, { turnId: 'turn', tokensUsed: 7, activeWallClockMs: 9 });
    const challenge = { challengeId: 'challenge', owner: { profileId: 'profile', ownerKind: 'goal' as const, ownerId: state.goalId }, fullTupleHash: 'a'.repeat(64),
      deadline: { domainId: 'clock', qualificationEpoch: 1, notBefore: 1, validUntil: 200 } };
    const observation = { status: 'committed' as const, owner: challenge.owner, operationId: 'operation', fullTupleHash: challenge.fullTupleHash, businessRevision: 1, currentVerification: 'valid' as const };
    remote.inspect.mockResolvedValue({ state: 'active', current: { binding: goalApplicationFromState(state) }, pendingTransitionId: null, pendingTarget: null });
    remote.prepare.mockImplementation(async (requestId: string) => {
      const rows = await store.listCompletionAttempts('session', intent.intentId);
      expect(rows.at(-1)).toMatchObject({ attemptId: requestId, status: 'preparing' }); return challenge;
    });
    remote.approve.mockImplementation(async (ticket: unknown) => {
      expect(ticket).toBe(challenge);
      expect((await store.listCompletionAttempts('session', intent.intentId)).at(-1)?.status).toBe('authorizing'); return observation;
    });
    remote.recover.mockResolvedValue({ status: 'not_prepared' });
    remote.reconcile.mockResolvedValue(observation);
    const workflow = createGoalPublicationWorkflow({ store, now: () => 20 });
    const input = { sessionId: 'session', intentId: intent.intentId, requestSource: 'agent' as const, action: 'start' as const };
    return { store, service, context, state, intent, challenge, observation, workflow, input };
  }
  it(`${kind}: persists request then authorizing before native and counts the original turn only once`, async () => {
    const f = await fixture();
    const result = await f.workflow.run(f.input);
    expect(result.status).toBe('committed');
    expect((await f.store.loadCompletionIntent('session', f.intent.intentId))!.observation).toEqual(f.observation);
    expect((await f.store.load('session'))!.state).toMatchObject({ status: 'active', turnsUsed: 1, tokensUsed: 7 });
    await f.workflow.run({ ...f.input, action: 'recover', requestSource: 'scheduler' });
    expect(remote.prepare).toHaveBeenCalledTimes(1); expect(remote.approve).toHaveBeenCalledTimes(1); expect(remote.recover).not.toHaveBeenCalled();
  });
  it(`${kind}: lost prepare response recovers the same durable request without replaying native approval`, async () => {
    const f = await fixture(); remote.prepare.mockRejectedValue(Error('response lost'));
    await expect(f.workflow.run(f.input)).rejects.toThrow('response lost');
    const original = (await f.store.listCompletionAttempts('session', f.intent.intentId))[0];
    const retirement = { status: 'not_approved', owner: f.challenge.owner, challengeId: f.challenge.challengeId,
      operationId: 'operation', fullTupleHash: f.challenge.fullTupleHash, challenge: f.challenge };
    remote.recover.mockResolvedValue(retirement);
    const restarted = createGoalPublicationWorkflow({ store: f.store, now: () => 21 });
    expect((await restarted.run({ ...f.input, action: 'recover', requestSource: 'scheduler' })).status).toBe('not_approved');
    expect(remote.recover).toHaveBeenCalledWith(original.attemptId, undefined);
    expect(remote.prepare).toHaveBeenCalledTimes(1); expect(remote.approve).not.toHaveBeenCalled();
    expect((await f.store.loadCompletionIntent('session', f.intent.intentId))!.status).toBe('claimed');
  });
  it(`${kind}: receiver cancel followed by explicit user retry reuses no native ticket and no usage`, async () => {
    const f = await fixture(); remote.approve.mockResolvedValueOnce({ ...f.observation, status: 'cancelled' });
    expect((await f.workflow.run(f.input)).status).toBe('cancelled');
    for (const requestSource of ['agent', 'scheduler'] as const) await expect(f.workflow.run({ ...f.input, action: 'retry', requestSource })).rejects.toThrow(/source/);
    const nextChallenge = { ...f.challenge, challengeId: 'retry-challenge', fullTupleHash: 'b'.repeat(64) };
    remote.prepare.mockResolvedValue(nextChallenge);
    remote.approve.mockImplementation(async ticket => { expect(ticket).toBe(nextChallenge); return { ...f.observation, operationId: 'retry-operation', fullTupleHash: nextChallenge.fullTupleHash, businessRevision: 2 }; });
    expect((await f.workflow.run({ ...f.input, action: 'retry', requestSource: 'user' })).status).toBe('committed');
    const attempts = await f.store.listCompletionAttempts('session', f.intent.intentId);
    expect(attempts.map(row => row.status)).toEqual(['cancelled', 'committed']); expect(attempts[0].attemptId).not.toBe(attempts[1].attemptId);
    expect((await f.store.load('session'))!.turns).toHaveLength(1);
  });
  it(`${kind}: replacement while prepare is pending retires the original request and never requests native approval`, async () => {
    const f = await fixture(), entered = deferred<void>(), release = deferred<typeof f.challenge>();
    remote.prepare.mockImplementation(async () => { entered.resolve(); return release.promise; });
    remote.recover.mockResolvedValue({ status: 'not_approved', owner: f.challenge.owner, challengeId: f.challenge.challengeId,
      operationId: 'operation', fullTupleHash: f.challenge.fullTupleHash, challenge: f.challenge });
    const running = f.workflow.run(f.input); await entered.promise;
    const replacement = await f.service.replace({ ...f.context, requestSource: 'user', expectedRevision: 3 }, { objective: 'replacement', expectedEvidenceKinds: ['answer'] });
    release.resolve(f.challenge); expect((await running).status).toBe('not_approved');
    expect(remote.approve).not.toHaveBeenCalled(); expect((await f.store.load('session'))!.state).toEqual(replacement);
  });
  it(`${kind}: a competing recovery closure wins its CAS before a late native response can promote the claim`, async () => {
    const f = await fixture(), entered = deferred<void>(), release = deferred<typeof f.observation>();
    remote.approve.mockImplementation(async () => { entered.resolve(); return release.promise; });
    const running = f.workflow.run(f.input); await entered.promise;
    const original = (await f.store.listCompletionAttempts('session', f.intent.intentId))[0];
    await f.store.updateCompletionAttempt('session', { expectedRevision: original.revision, next: { ...original, revision: original.revision + 1,
      status: 'not_approved', retirement: { status: 'not_approved', owner: f.challenge.owner, challengeId: f.challenge.challengeId,
        operationId: 'operation', fullTupleHash: f.challenge.fullTupleHash, challenge: f.challenge }, updatedAt: original.updatedAt } });
    release.resolve(f.observation); await expect(running).rejects.toThrow(/stale_revision/);
    expect((await f.store.loadCompletionIntent('session', f.intent.intentId))!.status).toBe('claimed');
    expect((await f.store.listCompletionAttempts('session', f.intent.intentId))[0].status).toBe('not_approved');
  });
  it(`${kind}: pause is responsive during native wait and late commit only updates original history`, async () => {
    const f = await fixture(), entered = deferred<void>(), release = deferred<typeof f.observation>();
    remote.approve.mockImplementation(async () => { entered.resolve(); return release.promise; });
    const running = f.workflow.run(f.input); await entered.promise;
    const paused = await f.service.pause({ ...f.context, requestSource: 'user', expectedRevision: 3 }, 'user_paused');
    release.resolve(f.observation); expect((await running).status).toBe('committed');
    expect((await f.store.load('session'))!.state).toEqual(paused);
    expect((await f.store.loadCompletionIntent('session', f.intent.intentId))!.status).toBe('committed');
  });
  it(`${kind}: two local starts share one native attempt, and a restarted unknown only reconciles the original operation`, async () => {
    const f = await fixture(); remote.approve.mockRejectedValueOnce(Error('commit reply lost'));
    const [first, second] = await Promise.allSettled([f.workflow.run(f.input), f.workflow.run(f.input)]);
    expect(first.status).toBe('rejected'); expect(second.status).toBe('rejected'); expect(remote.approve).toHaveBeenCalledTimes(1);
    remote.recover.mockResolvedValue({ status: 'settlement_exists', owner: f.challenge.owner, challengeId: f.challenge.challengeId,
      operationId: f.observation.operationId, fullTupleHash: f.challenge.fullTupleHash, challenge: f.challenge });
    expect((await createGoalPublicationWorkflow({ store: f.store }).run({ ...f.input, action: 'recover', requestSource: 'scheduler' })).status).toBe('committed');
    expect(remote.prepare).toHaveBeenCalledTimes(1); expect(remote.approve).toHaveBeenCalledTimes(1); expect(remote.reconcile).toHaveBeenCalledTimes(1);
  });
}
