import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { ConversationActivityStore } from '../../../src/runtime/conversation-activity/store.js';
import { ConversationActivityService, type ActivityThreadIdentity } from '../../../src/runtime/conversation-activity/service.js';
import { ConversationActivitySources } from '../../../src/runtime/conversation-activity/sources.js';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
const actor = { requestSource: 'user' as const, actorId: 'r264-own-user' };
const thread: ActivityThreadIdentity = { profileId: 'r264-own-profile', threadId: 'r264-own-thread', workspaceId: 'r264-own-workspace', deleteState: 'none' };
function options() {
  return { profileId: thread.profileId, actorId: actor.actorId,
    getThread(id: string) { return id === thread.threadId ? thread : null; },
    canObserveWork(watch: { source: string; workId: string }) { return watch.source === 'kswarm' && watch.workId === 'r264-own-project'; } };
}
async function bind(service: ConversationActivityService) {
  const operationId = randomUUID(), watchId = randomUUID();
  await service.prepareAssociation({ threadId: thread.threadId, operationId, creationIdempotencyKey: operationId }, actor);
  return service.bindWork({ operationId, watchId, source: 'kswarm', logicalSourceId: 'r264-own-project-data', sourceDataEpoch: randomUUID(), workId: 'r264-own-project' });
}
async function capture(promise: Promise<unknown>) { const [result] = await Promise.allSettled([promise]); return result; }
async function finish(root: string, store: ConversationActivityStore | undefined, closes: Array<() => void | Promise<unknown>>, expectedCloseError?: unknown, primaryFailure: unknown[] = []) {
  const results = await Promise.allSettled(closes.map(close => { try { return Promise.resolve(close()); } catch (error) { return Promise.reject(error); } }));
  const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []).filter(error => error !== expectedCloseError);
  if (errors.length || !store) throw new AggregateError([...primaryFailure, ...errors], 'actual owner drain/fixture setup unknown; root retained');
  // Test owns this exact Store and all producers are explicitly settled first.
  // This is regular local fixture disposal, never forced live-root deletion.
  store.close();
  if (expectedCloseError !== undefined) {
    writeFileSync(join(root, 'expected-drain-rejection.json'), JSON.stringify({ expected: true, rootReleaseClaimed: false }), { mode: 0o600 }); return;
  }
  rmSync(root, { recursive: true });
}

it('PUBLIC service: caller handles a real report producer rejection, a later actual report succeeds, then close succeeds', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r264-service-history-'));
  const primary: unknown[] = [];
  let store: ConversationActivityStore | undefined, service: ConversationActivityService | undefined;
  let now = 0, rejectRead = false, calls = 0;
  const error = new Error('own controlled authorization read failed');
  try {
    store = new ConversationActivityStore(join(root, 'activity.sqlite'), { now: () => now }); const own = options();
    service = new ConversationActivityService({ ...own, store,
      async canObserveWork(watch) { calls++; if (rejectRead) throw error; return own.canObserveWork(watch); },
      // Plain declared error callback, not an SDK stand-in: preserve/rethrow its
      // actual reason so the real reportDue rejection belongs to the caller.
      onError(reason) { throw reason; } });
    const watch = await bind(service); now = watch.nextReportDueAt; rejectRead = true;
    const first = await capture(service.reportDue()); expect(first.status).toBe('rejected');
    if (first.status !== 'rejected') throw Error('real producer rejection missing'); expect(first.reason).toBe(error);
    await Promise.resolve(); rejectRead = false; await service.reportDue(); expect(calls).toBe(2);
    const closing = service.close(); await closing; expect(service.close()).toBe(closing);
  } catch (error) { primary.push(error); throw error; } finally { await finish(root, store, [() => service?.close()], undefined, primary); }
}, 15000);

it('PUBLIC service: close while its actual report authorization is pending retains that exact rejection identity', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r264-service-inflight-')), gate = deferred<boolean>();
  const primary: unknown[] = [];
  let store: ConversationActivityStore | undefined, service: ConversationActivityService | undefined;
  let now = 0, armed = false, entered = false, expectedCloseError: unknown;
  let raw: Promise<void> | undefined, closing: Promise<void> | undefined;
  const error = new Error('own in-flight authorization read rejected');
  try {
    store = new ConversationActivityStore(join(root, 'activity.sqlite'), { now: () => now }); const own = options();
    service = new ConversationActivityService({ ...own, store,
      canObserveWork(watch) { if (armed) { entered = true; return gate.promise; } return own.canObserveWork(watch); },
      onError(reason) { throw reason; } });
    const watch = await bind(service); now = watch.nextReportDueAt; armed = true;
    raw = service.reportDue(); const rawResult = capture(raw); expect(entered).toBe(true);
    closing = service.close(); const closeResult = capture(closing); expect(service.close()).toBe(closing);
    gate.reject(error); const produced = await rawResult, closed = await closeResult;
    expect(produced.status).toBe('rejected'); if (produced.status !== 'rejected') throw Error('raw rejection missing'); expect(produced.reason).toBe(error);
    expect(closed.status).toBe('rejected'); if (closed.status !== 'rejected') throw Error('close rejection missing');
    expect(closed.reason).toBeInstanceOf(AggregateError); if (!(closed.reason instanceof AggregateError)) throw Error('aggregate missing');
    expect(closed.reason.errors).toContain(error); expectedCloseError = closed.reason;
  } catch (error) { primary.push(error); throw error; } finally {
    gate.resolve(false); await Promise.allSettled([raw, closing]);
    await finish(root, store, [() => service?.close()], expectedCloseError, primary);
  }
}, 15000);

it('PUBLIC sources: original caller handles sourceUnavailable lookup rejection, same source later writes successfully, then close succeeds', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r264-source-history-'));
  const primary: unknown[] = [];
  let store: ConversationActivityStore | undefined, service: ConversationActivityService | undefined, sources: ConversationActivitySources | undefined;
  let failLookup = false, taskHostCalls = 0;
  const error = new Error('own ordinary thread lookup temporarily failed');
  try {
    store = new ConversationActivityStore(join(root, 'activity.sqlite')); const own = options();
    service = new ConversationActivityService({ ...own, store, getThread(id) { if (failLookup) throw error; return own.getThread(id); } });
    const watch = await bind(service);
    sources = new ConversationActivitySources({ store, service,
      taskHost() { taskHostCalls++; throw Error('TaskHost is outside this ordinary source control'); },
      async readProject() { throw Error('disconnected method does not call project fetch'); } });
    failLookup = true; const first = await capture(sources.projectConnectionChanged('disconnected'));
    expect(first.status).toBe('rejected'); if (first.status !== 'rejected') throw Error('actual source rejection missing'); expect(first.reason).toBe(error);
    await Promise.resolve(); failLookup = false; await sources.projectConnectionChanged('disconnected');
    expect(store.getProjection(watch.watchId)?.freshness).toBe('reconnecting'); expect(taskHostCalls).toBe(0);
    const closing = sources.close(); await closing; expect(sources.close()).toBe(closing);
  } catch (error) { primary.push(error); throw error; } finally { await finish(root, store, [() => sources?.close(), () => service?.close()], undefined, primary); }
}, 15000);

it('PUBLIC sources: close snapshots the still-pending real disconnected producer and retains its original rejection reason', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r264-source-inflight-'));
  const primary: unknown[] = [];
  let store: ConversationActivityStore | undefined, service: ConversationActivityService | undefined, sources: ConversationActivitySources | undefined;
  let failLookup = false, expectedCloseError: unknown;
  let raw: Promise<void> | undefined, closing: Promise<void> | undefined;
  const error = new Error('own source producer rejected before its async await settles');
  try {
    store = new ConversationActivityStore(join(root, 'activity.sqlite')); const own = options();
    service = new ConversationActivityService({ ...own, store, getThread(id) { if (failLookup) throw error; return own.getThread(id); } });
    await bind(service);
    sources = new ConversationActivitySources({ store, service,
      taskHost() { throw Error('TaskHost is outside this ordinary source control'); },
      async readProject() { throw Error('disconnected method does not call project fetch'); } });
    failLookup = true; raw = sources.projectConnectionChanged('disconnected'); const rawResult = capture(raw);
    // Actual sourceUnavailable has rejected, but the original async producer's
    // await has not settled yet. Do not await it before taking the close snapshot.
    closing = sources.close(); const closeResult = capture(closing);
    const produced = await rawResult, closed = await closeResult;
    expect(produced.status).toBe('rejected'); if (produced.status !== 'rejected') throw Error('actual raw error missing'); expect(produced.reason).toBe(error);
    expect(closed.status).toBe('rejected'); if (closed.status !== 'rejected') throw Error('actual close error missing');
    expect(closed.reason).toBeInstanceOf(AggregateError); if (!(closed.reason instanceof AggregateError)) throw Error('aggregate missing');
    expect(closed.reason.errors).toContain(error); expectedCloseError = closed.reason; expect(sources.close()).toBe(closing);
  } catch (error) { primary.push(error); throw error; } finally {
    failLookup = false; await Promise.allSettled([raw, closing]);
    await finish(root, store, [() => sources?.close(), () => service?.close()], expectedCloseError, primary);
  }
}, 15000);
