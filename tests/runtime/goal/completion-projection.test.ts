import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
const remote = vi.hoisted(() => ({ route: {} as any, application: {} as any, observation: {} as any, body: {} as any,
  closes: 0, reads: 0, afterPayload: undefined as undefined | (() => void) }));
vi.mock('../../../src/runtime/verification/installed-owner-state.js', () => ({ readInstalledCurrentOwner: () => structuredClone(remote.route) }));
vi.mock('../../../src/runtime/verification/controller-client.js', () => ({ createInstalledVerificationClient: () => ({
  applicationTransport: { call: async (method: string) => { expect(method).toBe('application.inspect'); return structuredClone(remote.application); } },
  dispose() { remote.closes++; },
}) }));
vi.mock('../../../src/runtime/verification/installed-completion-publication.js', () => ({ createInstalledCompletionPublisher: () => ({
  observe: async () => structuredClone(remote.observation),
  async readPayload() { remote.reads++; const bytes = Buffer.from(json(remote.body)); const p = remote.observation.publication;
    const result = { owner: remote.observation.owner, businessRevision: remote.observation.businessRevision, operationId: p.operationId,
      fullTupleHash: p.fullTupleHash, payloadHash: createHash('sha256').update(bytes).digest('hex'), bytes };
    remote.afterPayload?.(); return result; }, dispose() { remote.closes++; },
}) }));
import { canonicalVerificationJson as json } from '../../../src/runtime/verification/protocol.js';
import { goalApplicationBindingHash } from '../../../src/runtime/verification/goal-application-binding.js';
import { FileGoalStore } from '../../../src/runtime/goal/file-store.js';
import { InMemoryGoalStore } from '../../../src/runtime/goal/memory-store.js';
import { SqliteGoalStore } from '../../../desktop/electron/goal-store-sqlite.js';
import { GoalService } from '../../../src/runtime/goal/service.js';
import { createGoalState, reduceGoal } from '../../../src/runtime/goal/reducer.js';
import { createGoalCompletionIntent, goalApplicationFromState, type GoalCompletionIntent } from '../../../src/runtime/goal/completion-intent.js';
import { authorizeGoalCompletionProjection } from '../../../src/runtime/goal/completion-projection.js';
import { authorizeGoalNativeProjection } from '../../../src/runtime/goal/native-mutation-projection.js';
import { goalNativeStateHash } from '../../../src/runtime/goal/native-mutation-journal.js';
import type { GoalCommitInput, GoalState, GoalStore } from '../../../src/runtime/goal/types.js';
// Setup uses the actual native cache projection too; these tests continue to
// exercise completion independently after an application has been admitted.
async function commitApplication(store: GoalStore, input: GoalCommitInput, previous: GoalState | null = null) {
  const state = input.next, binding = goalApplicationFromState(state);
  remote.application = { state: 'active', current: { binding, bindingHash: goalApplicationBindingHash(binding), revision: state.epoch }, pendingTransitionId: null, pendingTarget: null };
  const row = { id: 'fixture', revision: 5, sessionId: state.sessionId, kind: previous ? 'replace' : 'create',
    previous: previous ? { goalId: previous.goalId, epoch: previous.epoch, revision: previous.revision,
      createdAt: previous.createdAt, forkedFromGoalId: previous.forkedFromGoalId ?? null, stateHash: goalNativeStateHash(previous) } : null,
    target: binding, turnLimit: state.budgetLimits.turnLimit, enrollmentRequestId: 'enrollment', applicationRequestId: 'application',
    status: 'ready', createdAt: state.updatedAt, updatedAt: state.updatedAt,
    definition: { version: 1, obligations: [{ obligationId: 'original', predicateId: 'artifact', predicateVersion: '1', semantics: 'current-subject',
      recipe: { kind: 'artifact-content', checks: [{ id: 'check', path: 'result.txt', sha256: 'a'.repeat(64), structure: 'utf8' }] } }] } };
  await store.commit(await authorizeGoalNativeProjection(store, input, row));
}
const cleanups: Array<() => void> = [];
afterEach(() => { for (const fn of cleanups.splice(0).reverse()) fn(); });
beforeEach(() => { remote.closes = 0; remote.reads = 0; remote.afterPayload = undefined; });
for (const kind of ['file','memory','sqlite'] as const) {
  async function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'goal-projection-')); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    let failWrite = false;
    const store: GoalStore = kind === 'file' ? new FileGoalStore(root, (path, data) => { if (failWrite) throw Error('disk failure'); writeFileSync(path, data); })
      : kind === 'memory' ? new InMemoryGoalStore() : new SqliteGoalStore(join(root, 'goals.db'));
    if (store instanceof SqliteGoalStore) cleanups.push(() => store.close());
    const state = createGoalState({ sessionId: 'session', goalId: 'goal', objective: 'original objective', expectedEvidenceKinds: ['answer'], now: 1 });
    const owner = { profileId: 'profile', ownerKind: 'goal', ownerId: state.goalId };
    remote.route = { kind: 'protected-unregistered', authorityId: 'authority', owner };
    const binding = goalApplicationFromState(state), active = { binding, bindingHash: goalApplicationBindingHash(binding), revision: 1 };
    remote.application = { state: 'active', current: active, pendingTransitionId: null, pendingTarget: null };
    remote.observation = { owner, businessRevision: 1, currentVerification: 'valid', publication: { status: 'committed', current: true, operationId: 'operation', fullTupleHash: 'a'.repeat(64) } };
    remote.body = { version: 1, owner, application: active, dependencies: [], evaluations: [] };
    await commitApplication(store, { sessionId: 'session', expectedRevision: null, next: state, events: [], turns: [], evidence: [] });
    const input: GoalCommitInput = { sessionId: 'session', expectedRevision: 1, next: reduceGoal(state, { type: 'complete', reason: 'done', now: 2 }), events: [], turns: [], evidence: [] };
    return { root, store, state, input, failWrite(value: boolean) { failWrite = value; } };
  }
  async function claimedFixture(committed = true) {
    const f = await fixture();
    let intent: GoalCompletionIntent = createGoalCompletionIntent({ state: f.state, taskId: 'task', turnId: 'turn', summary: 'original claim', now: 2 });
    const state = { ...f.state, revision: 2, updatedAt: 2 };
    await f.store.commit({ ...f.input, next: state, completionIntent: { expectedRevision: null, next: intent } });
    const challenge = { challengeId: 'challenge', owner: remote.observation.owner, fullTupleHash: 'a'.repeat(64),
      deadline: { domainId: 'clock', qualificationEpoch: 1, notBefore: 1, validUntil: 200 } };
    for (const status of ['prepared', 'authorizing', ...(committed ? ['committed'] as const : [])] as const) {
      const next: GoalCompletionIntent = { ...intent, revision: intent.revision + 1, updatedAt: intent.updatedAt + 1, status, challenge,
        observation: status === 'committed' ? { status, owner: challenge.owner, operationId: 'operation',
          fullTupleHash: challenge.fullTupleHash, businessRevision: 1, currentVerification: 'valid' } : null };
      await f.store.updateCompletionIntent('session', { expectedRevision: intent.revision, next }); intent = next;
    }
    const input: GoalCommitInput = { ...f.input, expectedRevision: 2, next: reduceGoal(state, { type: 'complete', reason: intent.summary, now: 8 }),
      completionIntentId: intent.intentId };
    return { ...f, state, intent, input };
  }
  it(`${kind}: projects only the original committed intent and service uses its original summary`, async () => {
    const f = await claimedFixture();
    const service = new GoalService({ store: f.store, ownership: { assertOwned() {} }, now: () => 8 });
    await service.completeClaim({ sessionId: 'session', instanceId: 'instance', requestSource: 'runtime', expectedRevision: 2 }, f.intent.intentId);
    expect((await f.store.load('session'))!.state).toMatchObject({ status: 'complete', terminalReason: 'original claim', turnsUsed: 0 });
  });
  it.each(['operation', 'tuple', 'revision', 'owner'] as const)(`${kind}: original intent cannot borrow another publication's %s`, async field => {
    const f = await claimedFixture();
    if (field === 'operation') remote.observation.publication.operationId = 'second-operation';
    if (field === 'tuple') remote.observation.publication.fullTupleHash = 'b'.repeat(64);
    if (field === 'revision') remote.observation.businessRevision = 2;
    if (field === 'owner') remote.observation.owner.profileId = 'different-profile';
    await expect(authorizeGoalCompletionProjection(f.store, f.input)).rejects.toThrow(/goal_projection/);
    expect((await f.store.load('session'))!.state.status).toBe('active');
  });
  it(`${kind}: omitting a durable intent or selecting a missing/uncommitted intent never authorizes completion`, async () => {
    const f = await claimedFixture(false);
    for (const completionIntentId of [undefined, 'missing', f.intent.intentId]) {
      await expect(authorizeGoalCompletionProjection(f.store, { ...f.input, completionIntentId })).rejects.toThrow(/goal_projection/);
    }
    const service = new GoalService({ store: f.store, ownership: { assertOwned() {} }, now: () => 8 });
    await expect(service.complete({ sessionId: 'session', instanceId: 'instance', requestSource: 'runtime', expectedRevision: 2 }, 'bypass')).rejects.toThrow(/goal_projection/);
  });
  it(`${kind}: changing the intent selector after observing cannot reuse its projection`, async () => {
    const f = await claimedFixture(), authorized = await authorizeGoalCompletionProjection(f.store, f.input);
    await expect(f.store.commit({ ...authorized, completionIntentId: 'other' })).rejects.toThrow(/goal_projection/);
    await expect(f.store.commit(authorized)).rejects.toThrow(/goal_projection/);
  });
  it(`${kind}: an original committed claim cannot complete a replacement Goal application`, async () => {
    const f = await claimedFixture();
    const replacement = reduceGoal(f.state, { type: 'replace', objective: 'replacement', expectedEvidenceKinds: ['answer'], now: 8 });
    await commitApplication(f.store, { ...f.input, next: replacement, completionIntentId: undefined }, f.state);
    const binding = goalApplicationFromState(replacement);
    remote.application.current = { binding, bindingHash: goalApplicationBindingHash(binding), revision: 2 };
    remote.body.application = remote.application.current;
    await expect(authorizeGoalCompletionProjection(f.store, { ...f.input, expectedRevision: replacement.revision,
      next: reduceGoal(replacement, { type: 'complete', reason: f.intent.summary, now: 9 }) })).rejects.toThrow(/goal_projection_intent/);
    const service = new GoalService({ store: f.store, ownership: { assertOwned() {} }, now: () => 9 });
    await expect(service.completeClaim({ sessionId: 'session', instanceId: 'instance', requestSource: 'runtime', expectedRevision: replacement.revision }, f.intent.intentId)).rejects.toThrow(/intent_not_committed/);
    expect((await f.store.load('session'))!.state).toEqual(replacement);
  });
  it(`${kind}: a prepared service projection holds no network work in the final CAS and cannot overwrite a pause`, async () => {
    const f = await claimedFixture(), service = new GoalService({ store: f.store, ownership: { assertOwned() {} }, now: () => 8 });
    const context = { sessionId: 'session', instanceId: 'instance', requestSource: 'runtime' as const, expectedRevision: 2 };
    const prepared = await service.prepareClaimCompletion(context, f.intent.intentId);
    expect(remote.reads).toBe(1);
    const paused = await service.pause({ ...context, requestSource: 'user' }, 'user_paused');
    await expect(prepared.commit()).rejects.toThrow();
    await expect(prepared.commit()).rejects.toThrow();
    expect(remote.reads).toBe(1);
    expect((await f.store.load('session'))!.state).toEqual(paused);
    expect((await f.store.loadCompletionIntent('session', f.intent.intentId))!.status).toBe('committed');
  });
  it(`${kind}: raw protected completion and copied observation cannot bypass the original projector`, async () => {
    const f = await fixture();
    await expect(f.store.commit(f.input)).rejects.toThrow(/goal_projection/);
    await expect(f.store.commit({ ...f.input, completionProjection: remote.observation } as any)).rejects.toThrow(/goal_projection/);
    expect((await f.store.load('session'))!.state.status).toBe('active');
  });
  it(`${kind}: original committed native application permits one exact cache projection`, async () => {
    const f = await fixture(), authorized = await authorizeGoalCompletionProjection(f.store, f.input);
    await f.store.commit(authorized); expect((await f.store.load('session'))!.state.status).toBe('complete');
    expect(remote.reads).toBe(1); expect(remote.closes).toBe(3); // Initial application plus both completion clients.
    await expect(f.store.commit({ ...authorized, expectedRevision: 2, next: { ...authorized.next, revision: 3 } })).rejects.toThrow();
  });
  it(`${kind}: copying a ticket or changing the captured input or store invalidates it`, async () => {
    const f = await fixture();
    const copy = await authorizeGoalCompletionProjection(f.store, f.input);
    await expect(f.store.commit(structuredClone(copy))).rejects.toThrow(/goal_projection/);
    const changed = await authorizeGoalCompletionProjection(f.store, f.input);
    changed.next.objective = 'forged'; await expect(f.store.commit(changed)).rejects.toThrow(/goal_projection/);
    const foreign = await authorizeGoalCompletionProjection(f.store, f.input), other = new InMemoryGoalStore();
    await commitApplication(other, { ...f.input, expectedRevision: null, next: f.state });
    await expect(other.commit(foreign)).rejects.toThrow(/goal_projection/);
    await expect(f.store.commit(foreign)).rejects.toThrow(/goal_projection/);
  });
  it(`${kind}: rejects a pending, wrong epoch, changed route or newly superseded publication`, async () => {
    const f = await fixture(), original = structuredClone(remote.application);
    remote.application.state = 'pending'; remote.application.pendingTransitionId = 'pending'; remote.application.pendingTarget = original.current.binding;
    await expect(authorizeGoalCompletionProjection(f.store, f.input)).rejects.toThrow(/goal_projection/);
    remote.application = original; remote.application.current.binding.epoch++;
    await expect(authorizeGoalCompletionProjection(f.store, f.input)).rejects.toThrow();
    remote.application = structuredClone(original); remote.application.current.binding.epoch--;
    remote.afterPayload = () => { remote.observation.publication.operationId = 'new-operation'; };
    await expect(authorizeGoalCompletionProjection(f.store, f.input)).rejects.toThrow(/goal_projection/);
    remote.afterPayload = undefined; remote.observation.publication.operationId = 'operation';
    const authorized = await authorizeGoalCompletionProjection(f.store, f.input);
    remote.route.authorityId = 'replacement'; await expect(f.store.commit(authorized)).rejects.toThrow(/goal_projection/);
  });
  it(`${kind}: real GoalService obtains the projection for complete and settled completion`, async () => {
    const f = await fixture(), service = new GoalService({ store: f.store, ownership: { assertOwned() {} }, now: () => 2 });
    const context = { sessionId: 'session', instanceId: 'instance', requestSource: 'runtime' as const, expectedRevision: 1 };
    await service.settleTurn(context, { turnId: 'turn', tokensUsed: 7, activeWallClockMs: 11, terminalDecision: { kind: 'complete', reason: 'done' } });
    expect((await f.store.load('session'))!.state).toMatchObject({ status: 'complete', turnsUsed: 1, tokensUsed: 7 });
  });
  it(`${kind}: a rejected first CAS attempt also consumes the original ticket`, async () => {
    const f = await fixture(), authorized = await authorizeGoalCompletionProjection(f.store, f.input);
    await expect(f.store.commit({ ...authorized, expectedRevision: 99 })).rejects.toThrow();
    await expect(f.store.commit(authorized)).rejects.toThrow(/goal_projection/);
  });
  it(`${kind}: capture failure consumes the ticket before cloning caller data`, async () => {
    const f = await fixture(), authorized = await authorizeGoalCompletionProjection(f.store, f.input);
    await expect(f.store.commit({ ...authorized, events: [() => undefined] } as any)).rejects.toThrow();
    await expect(f.store.commit(authorized)).rejects.toThrow(/goal_projection/);
  });
  it(`${kind}: a throwing native-ticket accessor cannot preserve a completion ticket`, async () => {
    const f = await fixture(), authorized = await authorizeGoalCompletionProjection(f.store, f.input);
    await expect(f.store.commit({ ...authorized, get nativeProjection(): object { throw Error('accessor'); } })).rejects.toThrow();
    await expect(f.store.commit(authorized)).rejects.toThrow(/goal_projection/);
  });
  it(`${kind}: invalid intent validation cannot preserve a ticket for reuse`, async () => {
    const f = await fixture(), authorized = await authorizeGoalCompletionProjection(f.store, f.input);
    await expect(f.store.commit({ ...authorized, completionIntent: { expectedRevision: null, next: {} } } as any)).rejects.toThrow();
    await expect(f.store.commit(authorized)).rejects.toThrow(/goal_projection/);
  });
  it(`${kind}: direct service completion also uses the original publisher`, async () => {
    const f = await fixture(), service = new GoalService({ store: f.store, ownership: { assertOwned() {} }, now: () => 2 });
    await service.complete({ sessionId: 'session', instanceId: 'instance', requestSource: 'user', expectedRevision: 1 }, 'done');
    expect((await f.store.load('session'))!.state.status).toBe('complete'); expect(remote.reads).toBe(1);
  });
  it(`${kind}: refuses forged next state and stale state while a publication read is in flight`, async () => {
    const f = await fixture();
    await expect(authorizeGoalCompletionProjection(f.store, { ...f.input, next: { ...f.input.next, objective: 'forged' } })).rejects.toThrow(/goal_projection/);
    const authorized = await authorizeGoalCompletionProjection(f.store, f.input);
    await commitApplication(f.store, { ...f.input, next: reduceGoal(f.state, { type: 'replace', objective: 'new goal', expectedEvidenceKinds: ['answer'], now: 2 }) }, f.state);
    await expect(f.store.commit(authorized)).rejects.toThrow();
    expect((await f.store.load('session'))!.state).toMatchObject({ status: 'active', epoch: 2, objective: 'new goal' });
  });
  it(`${kind}: ordinary completion retains its existing behavior`, async () => {
    const f = await fixture(); remote.route = { kind: 'ordinary' }; await f.store.commit(f.input);
    expect((await f.store.load('session'))!.state.status).toBe('complete'); expect(remote.reads).toBe(0);
  });
  if (kind === 'sqlite') it('sqlite: rollback consumes the ticket and restart repairs only the cache', async () => {
    const f = await fixture(), injection = new DatabaseSync(join(f.root, 'goals.db'));
    injection.exec("CREATE TRIGGER fail_cache BEFORE UPDATE ON goals BEGIN SELECT RAISE(ABORT, 'disk failure'); END");
    const authorized = await authorizeGoalCompletionProjection(f.store, f.input);
    await expect(f.store.commit(authorized)).rejects.toThrow('disk failure');
    injection.exec('DROP TRIGGER fail_cache'); injection.close();
    await expect(f.store.commit(authorized)).rejects.toThrow(/goal_projection/);
    const restarted = new SqliteGoalStore(join(f.root, 'goals.db')); cleanups.push(() => restarted.close());
    await restarted.commit(await authorizeGoalCompletionProjection(restarted, f.input));
    expect((await restarted.load('session'))!.state.status).toBe('complete'); expect(remote.reads).toBe(2);
  });
  if (kind === 'file') it('file: failed cache write consumes its ticket and a restarted store obtains a fresh read-only projection', async () => {
    const f = await fixture(), authorized = await authorizeGoalCompletionProjection(f.store, f.input); f.failWrite(true);
    await expect(f.store.commit(authorized)).rejects.toThrow('disk failure'); f.failWrite(false);
    await expect(f.store.commit(authorized)).rejects.toThrow(/goal_projection/);
    const restarted = new FileGoalStore(f.root), retry = await authorizeGoalCompletionProjection(restarted, f.input);
    await restarted.commit(retry); expect((await restarted.load('session'))!.state.status).toBe('complete'); expect(remote.reads).toBe(2);
  });
}
