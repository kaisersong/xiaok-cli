import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileGoalStore, GoalTamperDetectedError } from '../../../src/runtime/goal/file-store.js';
import { createGoalState } from '../../../src/runtime/goal/reducer.js';
import { GoalService } from '../../../src/runtime/goal/service.js';
import { createGoalPublicationAttempt } from '../../../src/runtime/goal/publication-attempt.js';
import { writeFileAtomicallySync } from '../../../src/utils/atomic-file.js';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function fixture(atomicWrite = writeFileAtomicallySync) {
  const root = mkdtempSync(join(tmpdir(), 'goal-document-version-')); roots.push(root);
  const store = new FileGoalStore(root, atomicWrite), state = createGoalState({ sessionId: 'session', objective: 'original', expectedEvidenceKinds: ['answer'], now: 1 });
  await store.commit({ sessionId: 'session', expectedRevision: null, next: state, events: [], turns: [], evidence: [] });
  return { root, store, state, path: join(root, 'session.goal.json') };
}
it('two long-lived stores alternate writes after reading the current durable revision', async () => {
  const f = await fixture(), second = new FileGoalStore(f.root); await second.load('session');
  for (const [index, store] of [f.store, second, f.store, second].entries()) {
    const current = (await store.load('session'))!.state;
    await store.commit({ sessionId: 'session', expectedRevision: current.revision, next: { ...current, revision: current.revision + 1, objective: `writer-${index}` }, events: [], turns: [], evidence: [] });
  }
  expect((await f.store.load('session'))!.state).toMatchObject({ revision: 5, objective: 'writer-3' });
});
it('journal-only changes advance document version and retain exact attempt CAS across long-lived stores', async () => {
  const f = await fixture(), service = new GoalService({ store: f.store, ownership: { assertOwned() {} }, now: () => 2 });
  const claim = await service.requestCompletion({ sessionId: 'session', instanceId: 'host', requestSource: 'runtime', expectedRevision: 1 }, { taskId: 'task', turnId: 'turn', summary: 'done' });
  const second = new FileGoalStore(f.root), original = (await second.load('session'))!.state;
  const attempt = createGoalPublicationAttempt(claim, 'user', 2, 1);
  await f.store.updateCompletionAttempt('session', { expectedRevision: null, next: attempt });
  expect((await second.load('session'))!.state).toEqual(original);
  const next = { ...attempt, revision: 2, updatedAt: 3, status: 'not_prepared' as const, retirement: { status: 'not_prepared' as const } };
  await second.updateCompletionAttempt('session', { expectedRevision: 1, next });
  expect(await f.store.listCompletionAttempts('session', claim.intentId)).toEqual([next]);
  await expect(f.store.updateCompletionAttempt('session', { expectedRevision: 1, next })).rejects.toThrow(/stale|revision/);
});
it.each(['same', 'lower'] as const)('repeated reads cannot bless %s document-version corruption', async mode => {
  const f = await fixture(), raw = JSON.parse(readFileSync(f.path, 'utf8'));
  raw.state.objective = 'out-of-band'; raw.state.revision += 1;
  if (mode === 'lower') raw.storageRevision = 0;
  writeFileSync(f.path, JSON.stringify(raw));
  await expect(f.store.load('session')).rejects.toBeInstanceOf(GoalTamperDetectedError);
  await expect(f.store.load('session')).rejects.toBeInstanceOf(GoalTamperDetectedError);
  await expect(f.store.commit({ sessionId: 'session', expectedRevision: raw.state.revision, next: { ...raw.state, revision: 3 }, events: [], turns: [], evidence: [] })).rejects.toBeInstanceOf(GoalTamperDetectedError);
});
it('a cached document disappearing cannot be recreated as a fresh null revision', async () => {
  const f = await fixture(); rmSync(f.path);
  await expect(f.store.load('session')).rejects.toBeInstanceOf(GoalTamperDetectedError);
  await expect(f.store.commit({ sessionId: 'session', expectedRevision: null, next: f.state, events: [], turns: [], evidence: [] })).rejects.toBeInstanceOf(GoalTamperDetectedError);
});
it('legacy schema-one documents without storageRevision upgrade on their next actual write', async () => {
  const f = await fixture(), raw = JSON.parse(readFileSync(f.path, 'utf8')); delete raw.storageRevision; writeFileSync(f.path, JSON.stringify(raw));
  const legacy = new FileGoalStore(f.root), current = (await legacy.load('session'))!.state;
  await legacy.commit({ sessionId: 'session', expectedRevision: 1, next: { ...current, revision: 2 }, events: [], turns: [], evidence: [] });
  expect(JSON.parse(readFileSync(f.path, 'utf8')).storageRevision).toBe(1);
});
it.each([-1, 1.5, '2'])('rejects invalid document revision %s', async storageRevision => {
  const f = await fixture(), raw = JSON.parse(readFileSync(f.path, 'utf8')); raw.storageRevision = storageRevision; writeFileSync(f.path, JSON.stringify(raw));
  await expect(new FileGoalStore(f.root).load('session')).rejects.toThrow(/storage_revision/);
});
it('never increments an exhausted safe-integer document version', async () => {
  const f = await fixture(), raw = JSON.parse(readFileSync(f.path, 'utf8')); raw.storageRevision = Number.MAX_SAFE_INTEGER; writeFileSync(f.path, JSON.stringify(raw));
  const store = new FileGoalStore(f.root); await store.load('session');
  await expect(store.commit({ sessionId: 'session', expectedRevision: 1, next: { ...f.state, revision: 2 }, events: [], turns: [], evidence: [] })).rejects.toThrow(/storage_revision/);
});
it.each(['before', 'after'] as const)('atomic write failure %s rename does not permanently poison a long-lived cache', async phase => {
  let fail = false;
  const f = await fixture((path, data) => {
    if (fail && phase === 'before') throw Error('disk fault');
    writeFileAtomicallySync(path, data);
    if (fail) throw Error('disk fault');
  });
  fail = true;
  await expect(f.store.commit({ sessionId: 'session', expectedRevision: 1, next: { ...f.state, revision: 2 }, events: [], turns: [], evidence: [] })).rejects.toThrow('disk fault');
  fail = false;
  const current = (await f.store.load('session'))!.state;
  expect(current.revision).toBe(phase === 'after' ? 2 : 1);
  await f.store.commit({ sessionId: 'session', expectedRevision: current.revision, next: { ...current, revision: current.revision + 1 }, events: [], turns: [], evidence: [] });
});
