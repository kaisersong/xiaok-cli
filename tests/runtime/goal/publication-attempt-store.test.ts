import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { writeFileAtomicallySync } from '../../../src/utils/atomic-file.js';
import { FileGoalStore } from '../../../src/runtime/goal/file-store.js';
import { InMemoryGoalStore } from '../../../src/runtime/goal/memory-store.js';
import { SqliteGoalStore } from '../../../desktop/electron/goal-store-sqlite.js';
import { createGoalState } from '../../../src/runtime/goal/reducer.js';
import { createGoalCompletionIntent } from '../../../src/runtime/goal/completion-intent.js';
import { createGoalPublicationAttempt, type GoalPublicationAttempt } from '../../../src/runtime/goal/publication-attempt.js';
import type { GoalStore } from '../../../src/runtime/goal/types.js';

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
for (const kind of ['file', 'memory', 'sqlite'] as const) {
  async function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'goal-publication-attempt-'));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const path = join(root, 'goals.db');
    let failWrite = false;
    const store: GoalStore = kind === 'file' ? new FileGoalStore(root, (path, data) => { if (failWrite) throw Error('journal disk failure'); writeFileAtomicallySync(path, data); })
      : kind === 'memory' ? new InMemoryGoalStore() : new SqliteGoalStore(path);
    if (store instanceof SqliteGoalStore) cleanups.push(() => store.close());
    const state = { ...createGoalState({ sessionId: 'session', objective: 'original', expectedEvidenceKinds: ['answer'], now: 1 }), turnsUsed: 1, tokensUsed: 7 };
    const intent = createGoalCompletionIntent({ state, taskId: 'task', turnId: 'turn', summary: 'original claim', now: 1 });
    await store.commit({ sessionId: 'session', expectedRevision: null, next: state, events: [], evidence: [],
      turns: [{ goalId: state.goalId, epoch: state.epoch, turnId: 'turn', tokensUsed: 7, activeWallClockMs: 9, recordedAt: 1 }],
      completionIntent: { expectedRevision: null, next: intent } });
    const attempt = createGoalPublicationAttempt(intent, 'agent', 2, 1);
    const put = (next: GoalPublicationAttempt, expectedRevision: number | null) => store.updateCompletionAttempt('session', { next, expectedRevision });
    const challenge = { challengeId: 'original-challenge', owner: { profileId: 'profile', ownerKind: 'goal' as const, ownerId: state.goalId },
      fullTupleHash: 'a'.repeat(64), deadline: { domainId: 'clock', qualificationEpoch: 1, notBefore: 1, validUntil: 200 } };
    async function finish(original: GoalPublicationAttempt, status: 'committed' | 'cancelled') {
      const prepared: GoalPublicationAttempt = { ...original, revision: 2, status: 'prepared', challenge, updatedAt: 3 };
      await put(prepared, 1);
      const authorizing: GoalPublicationAttempt = { ...prepared, revision: 3, status: 'authorizing', updatedAt: 4 };
      await put(authorizing, 2);
      const terminal: GoalPublicationAttempt = { ...authorizing, revision: 4, status, updatedAt: 5,
        observation: { status, owner: challenge.owner, operationId: 'operation', fullTupleHash: challenge.fullTupleHash, businessRevision: 1, currentVerification: 'valid' } };
      await put(terminal, 3); return terminal;
    }
    return { root, path, store, state, intent, attempt, put, challenge, finish, failWrite(value: boolean) { failWrite = value; } };
  }
  it(`${kind}: request identity is durable before any remote work and returned records are detached`, async () => {
    const f = await fixture(); await f.put(f.attempt, null);
    const reader = kind === 'file' ? new FileGoalStore(f.root) : kind === 'sqlite' ? new SqliteGoalStore(f.path) : f.store;
    if (reader instanceof SqliteGoalStore) cleanups.push(() => reader.close());
    const rows = await reader.listCompletionAttempts('session', f.intent.intentId);
    expect(rows).toEqual([f.attempt]); rows[0].attemptId = 'changed';
    expect(await reader.listCompletionAttempts('session', f.intent.intentId)).toEqual([f.attempt]);
    expect(await reader.listCompletionAttempts('other', f.intent.intentId)).toEqual([]);
    expect(await reader.listCompletionAttempts('session', 'missing')).toEqual([]);
  });
  it(`${kind}: concurrent original attempt creation admits one and rejects stale or cross-session writes`, async () => {
    const f = await fixture();
    const results = await Promise.allSettled([f.put(f.attempt, null), f.put(createGoalPublicationAttempt(f.intent, 'agent', 2, 1), null)]);
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect(await f.store.listCompletionAttempts('session', f.intent.intentId)).toHaveLength(1);
    await expect(f.put({ ...f.attempt, revision: 2, status: 'not_prepared', retirement: { status: 'not_prepared' }, updatedAt: 3 }, 99)).rejects.toThrow();
    await expect(f.store.updateCompletionAttempt('other', { expectedRevision: 1, next: f.attempt })).rejects.toThrow();
  });
  it(`${kind}: receiver cancellation permits an explicit new attempt without losing history or re-counting usage`, async () => {
    const f = await fixture(); await f.put(f.attempt, null); const cancelled = await f.finish(f.attempt, 'cancelled');
    await expect(f.store.finalizeCompletionAttempt('session', cancelled.attemptId)).rejects.toThrow();
    expect((await f.store.loadCompletionIntent('session', f.intent.intentId))!.status).toBe('claimed');
    const retry = createGoalPublicationAttempt(f.intent, 'user', 6, 2); await f.put(retry, null);
    // This second operation has its own original native challenge and publication.
    const challenge = { ...f.challenge, challengeId: 'retry-challenge', fullTupleHash: 'b'.repeat(64) };
    const committed: GoalPublicationAttempt = { ...retry, revision: 2, status: 'committed', challenge, updatedAt: 7,
      observation: { status: 'committed', owner: challenge.owner, operationId: 'retry-operation', fullTupleHash: challenge.fullTupleHash, businessRevision: 2, currentVerification: 'valid' } };
    // Recovery may find a remote commit while the host still has preparing.
    await f.put(committed, 1);
    const fact = await f.store.finalizeCompletionAttempt('session', retry.attemptId);
    expect(fact).toMatchObject({ status: 'committed', challenge, observation: { operationId: 'retry-operation' } });
    expect(await f.store.finalizeCompletionAttempt('session', retry.attemptId)).toEqual(fact);
    const document = (await f.store.load('session'))!;
    expect(document.state).toEqual(f.state); expect(document.turns).toHaveLength(1);
    expect(await f.store.listCompletionAttempts('session', f.intent.intentId)).toEqual([cancelled, committed]);
    await expect(f.put({ ...cancelled, revision: 5, status: 'committed' }, 4)).rejects.toThrow();
  });
  it(`${kind}: old pointer completion updates only the original claim and rejects mismatched identity`, async () => {
    const f = await fixture(); await f.put(f.attempt, null); await f.finish(f.attempt, 'committed');
    await f.store.commit({ sessionId: 'session', expectedRevision: f.state.revision, next: { ...f.state, revision: 2, status: 'cancelled' }, events: [], turns: [], evidence: [] });
    const replacement = createGoalState({ sessionId: 'session', objective: 'replacement', expectedEvidenceKinds: ['answer'], now: 8 });
    await f.store.commit({ sessionId: 'session', expectedRevision: 2, next: replacement, events: [], turns: [], evidence: [] });
    await f.store.finalizeCompletionAttempt('session', f.attempt.attemptId);
    expect((await f.store.load('session'))!.state).toEqual(replacement);
    await expect(f.store.finalizeCompletionAttempt('other', f.attempt.attemptId)).rejects.toThrow();
    await expect(f.put({ ...f.attempt, attemptId: 'forged', application: { ...f.attempt.application, epoch: 2 } }, null)).rejects.toThrow();
  });
  it(`${kind}: unapproved closure cannot be replaced by a late native result and retry is bounded`, async () => {
    const f = await fixture(); let previous = f.attempt;
    for (let sequence = 1; sequence <= 32; sequence++) {
      const attempt = sequence === 1 ? previous : createGoalPublicationAttempt(f.intent, 'user', sequence + 2, sequence);
      await f.put(attempt, null);
      const retired: GoalPublicationAttempt = { ...attempt, revision: 2, status: 'not_prepared', retirement: { status: 'not_prepared' }, updatedAt: sequence + 3 };
      await f.put(retired, 1); previous = retired;
    }
    await expect(f.put(createGoalPublicationAttempt(f.intent, 'user', 40, 33), null)).rejects.toThrow();
    await expect(f.put({ ...previous, revision: 3, status: 'prepared', challenge: f.challenge, retirement: null }, 2)).rejects.toThrow();
    await expect(f.store.finalizeCompletionAttempt('session', previous.attemptId)).rejects.toThrow();
    expect((await f.store.loadCompletionIntent('session', f.intent.intentId))!.status).toBe('claimed');
  });
  if (kind !== 'memory') it(`${kind}: failed claim projection leaves the original committed attempt recoverable after restart`, async () => {
    const f = await fixture(); await f.put(f.attempt, null); await f.finish(f.attempt, 'committed');
    let injection: DatabaseSync | undefined;
    if (kind === 'file') f.failWrite(true);
    else { injection = new DatabaseSync(f.path); injection.exec("CREATE TRIGGER fail_claim BEFORE UPDATE ON goal_completion_intents BEGIN SELECT RAISE(ABORT, 'journal disk failure'); END"); }
    await expect(f.store.finalizeCompletionAttempt('session', f.attempt.attemptId)).rejects.toThrow('journal disk failure');
    expect((await f.store.loadCompletionIntent('session', f.intent.intentId))!.status).toBe('claimed');
    expect((await f.store.listCompletionAttempts('session', f.intent.intentId))[0].status).toBe('committed');
    if (injection) { injection.exec('DROP TRIGGER fail_claim'); injection.close(); }
    f.failWrite(false);
    const restarted = kind === 'file' ? new FileGoalStore(f.root) : new SqliteGoalStore(f.path);
    if (restarted instanceof SqliteGoalStore) cleanups.push(() => restarted.close());
    expect((await restarted.finalizeCompletionAttempt('session', f.attempt.attemptId)).status).toBe('committed');
    expect((await restarted.load('session'))!.turns).toHaveLength(1);
  });
}
