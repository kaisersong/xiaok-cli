import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileGoalStore } from '../../../src/runtime/goal/file-store.js';
import { InMemoryGoalStore } from '../../../src/runtime/goal/memory-store.js';
import { createGoalState } from '../../../src/runtime/goal/reducer.js';
import { createGoalCompletionIntent } from '../../../src/runtime/goal/completion-intent.js';
import type { GoalCommitInput, GoalStore } from '../../../src/runtime/goal/types.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
for (const kind of ['file', 'memory'] as const) {
  async function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'goal-intent-')); roots.push(root);
    const store: GoalStore = kind === 'file' ? new FileGoalStore(root) : new InMemoryGoalStore();
    const state = createGoalState({ sessionId: 'session', objective: 'original goal', expectedEvidenceKinds: ['answer'], now: 1 });
    const intent = createGoalCompletionIntent({ state, taskId: 'task', turnId: 'turn', summary: 'completion claim', now: 2 });
    const commit: GoalCommitInput = { sessionId: state.sessionId, expectedRevision: null, next: state, events: [], turns: [], evidence: [], completionIntent: { expectedRevision: null, next: intent } };
    await store.commit(commit);
    return { root, store, state, intent, commit };
  }
  it(`${kind}: persists a claim with full original identity and survives an independent reader`, async () => {
    const f = await fixture();
    const reader = kind === 'file' ? new FileGoalStore(f.root) : f.store;
    expect((await reader.load('session'))?.completionIntents).toEqual([f.intent]);
    const document = (await reader.load('session'))!;
    document.completionIntents![0].summary = 'mutated reader';
    expect((await reader.load('session'))?.completionIntents?.[0].summary).toBe('completion claim');
  });
  it(`${kind}: rejects stale intent CAS atomically with Goal state and evidence`, async () => {
    const f = await fixture();
    await expect(f.store.commit({ ...f.commit, expectedRevision: f.state.revision, next: { ...f.state, revision: f.state.revision + 1 }, completionIntent: { expectedRevision: 99, next: { ...f.intent, revision: 2, status: 'superseded', updatedAt: 3 } } })).rejects.toThrow(/intent.*revision/);
    expect((await f.store.load('session'))?.state.revision).toBe(f.state.revision);
    expect((await f.store.load('session'))?.completionIntents).toEqual([f.intent]);
  });
  it(`${kind}: rejects relabeling the same claim into a new epoch or another summary`, async () => {
    const f = await fixture();
    for (const replacement of [{ ...f.intent, application: { ...f.intent.application, epoch: 2 } }, { ...f.intent, summary: 'replacement' }]) {
      await expect(f.store.commit({ ...f.commit, expectedRevision: f.state.revision, completionIntent: { expectedRevision: 1, next: { ...replacement, revision: 2, status: 'superseded', updatedAt: 3 } } })).rejects.toThrow(/intent.*identity/);
    }
  });
  it(`${kind}: does not allow a second claim for the same original Goal turn`, async () => {
    const f = await fixture();
    await expect(f.store.commit({ ...f.commit, expectedRevision: f.state.revision, completionIntent: { expectedRevision: null, next: { ...f.intent, intentId: 'another' } } })).rejects.toThrow(/intent.*turn/);
  });
  it(`${kind}: updates an old intent without overwriting a replaced current Goal`, async () => {
    const f = await fixture();
    const replacement = { ...f.state, epoch: 2, objective: 'replacement', revision: f.state.revision + 1 };
    await f.store.commit({ ...f.commit, expectedRevision: f.state.revision, next: replacement, completionIntent: undefined });
    await f.store.updateCompletionIntent('session', { expectedRevision: 1, next: { ...f.intent, revision: 2, status: 'superseded', updatedAt: 3 } });
    const document = (await f.store.load('session'))!;
    expect(document.state).toEqual(replacement);
    expect(document.completionIntents?.[0]).toMatchObject({ revision: 2, status: 'superseded', application: { epoch: 1, objective: 'original goal' } });
    await expect(f.store.updateCompletionIntent('other', { expectedRevision: 2, next: { ...f.intent, revision: 3, status: 'superseded', updatedAt: 4 } })).rejects.toThrow();
  });

  it(`${kind}: keeps the original challenge and unknown operation through restart recovery`, async () => {
    const f = await fixture();
    const challenge = { challengeId: 'challenge', owner: { profileId: 'profile', ownerKind: 'goal' as const, ownerId: f.state.goalId }, fullTupleHash: 'a'.repeat(64), deadline: { domainId: 'clock', qualificationEpoch: 1, notBefore: 1, validUntil: 200 } };
    let intent = { ...f.intent, revision: 2, status: 'prepared' as const, challenge, updatedAt: 3 };
    await f.store.updateCompletionIntent('session', { expectedRevision: 1, next: intent });
    await expect(f.store.updateCompletionIntent('session', { expectedRevision: 2, next: { ...intent, revision: 3, status: 'committed' } })).rejects.toThrow();
    const authorizing = { ...intent, revision: 3, status: 'authorizing' as const, updatedAt: 4 };
    await f.store.updateCompletionIntent('session', { expectedRevision: 2, next: authorizing });
    const observation = { status: 'unknown' as const, owner: challenge.owner, operationId: 'original-operation', fullTupleHash: challenge.fullTupleHash, businessRevision: 1, currentVerification: 'unavailable' as const };
    const pending = { ...authorizing, revision: 4, status: 'pending' as const, observation, updatedAt: 5 };
    await f.store.updateCompletionIntent('session', { expectedRevision: 3, next: pending });
    const reader = kind === 'file' ? new FileGoalStore(f.root) : f.store;
    expect((await reader.load('session'))?.completionIntents?.[0]).toEqual(pending);
    for (const invalid of [
      { ...pending, observation: null },
      { ...pending, observation: { ...observation, operationId: 'replacement-operation' } },
      { ...pending, challenge: { ...challenge, challengeId: 'replacement-challenge' } },
      { ...pending, status: 'superseded' as const },
    ]) await expect(reader.updateCompletionIntent('session', { expectedRevision: 4, next: { ...invalid, revision: 5, updatedAt: 6 } })).rejects.toThrow();
    const committed = { ...pending, revision: 5, status: 'committed' as const, observation: { ...observation, status: 'committed' as const, currentVerification: 'valid' as const }, updatedAt: 6 };
    await reader.updateCompletionIntent('session', { expectedRevision: 4, next: committed });
    expect((await reader.load('session'))?.state.status).toBe('active');
    await expect(reader.updateCompletionIntent('session', { expectedRevision: 5, next: { ...committed, revision: 6, status: 'pending' } })).rejects.toThrow();
  });

  it(`${kind}: refuses a raw duplicate turn before changing counters or the original claim`, async () => {
    const f = await fixture();
    const turn = { goalId: f.state.goalId, epoch: f.state.epoch, turnId: 'recorded', tokensUsed: 4, activeWallClockMs: 8, recordedAt: 3 };
    const next = { ...f.state, revision: f.state.revision + 1, turnsUsed: 1, tokensUsed: 4 };
    await f.store.commit({ ...f.commit, expectedRevision: f.state.revision, next, completionIntent: undefined, turns: [turn] });
    await expect(f.store.commit({ ...f.commit, expectedRevision: next.revision, next: { ...next, revision: next.revision + 1, turnsUsed: 2, tokensUsed: 8 }, completionIntent: undefined, turns: [turn] })).rejects.toThrow(/duplicate.*turn/);
    const document = (await f.store.load('session'))!;
    expect(document.turns).toEqual([turn]);
    expect(document.state.tokensUsed).toBe(4);
  });

}
