// ARTIFACT CANDIDATE: UNREVIEWED / UNCOMPILED / UNRUN / POST-ONLY.
// Proposed copy path: tests/runtime/conversation-activity/store-write-unconfirmed.post-only.test.ts
import { afterEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fsSeam = vi.hoisted((): { armed: boolean; error: unknown; failures: string[] } =>
  ({ armed: false, error: undefined, failures: [] }));
// Existing FS-helper seam, NOT a Store constructor chmod option or new port.
// All non-fault calls execute the actual helper. No DB/store logic is duplicated.
vi.mock('../../../src/runtime/conversation-activity/storage-permissions.js', async original => {
  const actual = await original<typeof import('../../../src/runtime/conversation-activity/storage-permissions.js')>();
  return { ...actual, chmodPrivateActivityFile(path: string) {
    if (fsSeam.armed) { fsSeam.failures.push(path); throw fsSeam.error; }
    return actual.chmodPrivateActivityFile(path);
  } };
});
import { ConversationActivityStore } from '../../../src/runtime/conversation-activity/store.js';

type Faults = {
  begin?: Error; commitBefore?: Error; commitAfter?: Error; rollback?: Error;
  prepare?: Error; dataClose?: Error; ownerClose?: Error; ownerSetup?: Error;
};
type Fixture = {
  root: string; file: string; store?: ConversationActivityStore;
  data?: DatabaseSync; owner?: DatabaseSync;
  handles: Set<DatabaseSync>; closed: Set<DatabaseSync>; realCloseFailed: Set<DatabaseSync>;
  execCalls: string[]; closeCalls: DatabaseSync[]; faults: Faults;
  nowFailure: { armed: boolean; primary: unknown };
};
const fixtures: Fixture[] = [];
const retainedFixtureFailures: Fixture[] = [];
const originalExec = DatabaseSync.prototype.exec;
const originalPrepare = DatabaseSync.prototype.prepare;
const originalClose = DatabaseSync.prototype.close;
function attempt(run: () => unknown): { threw: true; error: unknown } | { threw: false } {
  try { run(); return { threw: false }; } catch (error) { return { threw: true, error }; }
}
function expectSameThrow(run: () => unknown, primary: unknown) {
  const observed = attempt(run);
  expect(observed.threw).toBe(true);
  if (!observed.threw) throw Error('control_expected_real_throw');
  expect(observed.error).toBe(primary);
}
function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'activity-store-cleanup-'));
  const f: Fixture = { root, file: join(root, 'conversation-activity.sqlite'), handles: new Set(), closed: new Set(),
    realCloseFailed: new Set(), execCalls: [], closeCalls: [], faults: {}, nowFailure: { armed: false, primary: undefined } };
  fixtures.push(f);
  vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (this: DatabaseSync, sql: string) {
    f.handles.add(this); f.execCalls.push(sql);
    if (sql.includes('BEGIN EXCLUSIVE')) { f.owner = this; if (f.faults.ownerSetup) throw f.faults.ownerSetup; }
    if (sql.startsWith('PRAGMA journal_mode=WAL')) f.data = this;
    if (sql === 'BEGIN IMMEDIATE' && f.faults.begin) throw f.faults.begin;
    if (sql === 'COMMIT' && f.faults.commitBefore) throw f.faults.commitBefore;
    if (sql === 'ROLLBACK' && f.faults.rollback) throw f.faults.rollback;
    const result = originalExec.call(this, sql);
    // Deliberate lower-call lost-ACK fault; not a claim native COMMIT usually does this.
    if (sql === 'COMMIT' && f.faults.commitAfter) throw f.faults.commitAfter;
    return result;
  });
  vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(function (
    this: DatabaseSync, ...args: Parameters<DatabaseSync['prepare']>
  ) {
    f.handles.add(this);
    if (!f.data && this !== f.owner) f.data = this;
    if (f.faults.prepare) throw f.faults.prepare;
    return originalPrepare.apply(this, args);
  });
  vi.spyOn(DatabaseSync.prototype, 'close').mockImplementation(function (this: DatabaseSync) {
    f.handles.add(this); f.closeCalls.push(this);
    if (this === f.data && f.faults.dataClose) throw f.faults.dataClose;
    if (this === f.owner && f.faults.ownerClose) throw f.faults.ownerClose;
    try { const result = originalClose.call(this); f.closed.add(this); return result; }
    catch (error) { f.realCloseFailed.add(this); throw error; }
  });
  fsSeam.armed = false; fsSeam.error = undefined; fsSeam.failures.length = 0;
  return f;
}
function open(f: Fixture): ConversationActivityStore {
  const store = new ConversationActivityStore(f.file, { now: () => {
    if (f.nowFailure.armed) throw f.nowFailure.primary;
    return Date.now();
  } });
  f.store = store; return store;
}
function seed(store: ConversationActivityStore) {
  const origin = { profileId: 'profile', threadId: 'thread', actorId: 'user', workspaceId: 'own-workspace' };
  store.prepareAssociation({ operationId: 'op', creationIdempotencyKey: 'op', origin });
  const watch = store.bindWork({ operationId: 'op', watchId: 'watch', source: 'task_host',
    logicalSourceId: 'storage-fixture', sourceDataEpoch: 'epoch', workId: 'storage-row' });
  store.prepareAssociation({ operationId: 'next-op', creationIdempotencyKey: 'next-op', origin });
  const projection = store.getProjection(watch.watchId);
  if (!projection) throw Error('actual_store_projection_missing');
  const activity = store.listActivities(origin.profileId, origin.threadId)[0];
  if (!activity) throw Error('actual_store_activity_missing');
  return { origin, watch, projection, activity };
}
// These are ordinary activity STORE data, never claimed as TaskHost/SDK admission.
// Values are read from the actual public store outputs; no authority/brand is fabricated.
function validWrites(store: ConversationActivityStore) {
  const { origin, watch, projection, activity } = seed(store);
  return [
    { name: 'prepareAssociation', run: () => store.prepareAssociation({ operationId: 'new-op', creationIdempotencyKey: 'new-op', origin }) },
    { name: 'forgetUnboundAssociation', run: () => store.forgetUnboundAssociation('next-op') },
    { name: 'markPresented', run: () => store.markPresented(origin.profileId, origin.threadId, 'cli', 0) },
    { name: 'bindWork', run: () => store.bindWork({ operationId: 'next-op', watchId: 'next-watch', source: watch.source,
      logicalSourceId: watch.logicalSourceId, sourceDataEpoch: watch.sourceDataEpoch, workId: 'next-storage-row' }) },
    { name: 'ingest', run: () => store.ingest(watch.watchId, { schemaVersion: 1, eventId: 'event-next', source: watch.source,
      logicalSourceId: watch.logicalSourceId, sourceDataEpoch: watch.sourceDataEpoch, workId: watch.workId,
      runId: watch.runId, sourceSequence: projection.sourceSequence + 1, transportGeneration: 0,
      kind: 'heartbeat', receivedAt: Date.now(), evidenceRefs: [] }) },
    { name: 'ingestRetainedPage', run: () => store.ingestRetainedPage(watch.watchId, {
      sourceDataEpoch: watch.sourceDataEpoch, coveredThrough: projection.sourceSequence, events: [], gapRanges: [] }) },
    { name: 'pruneRetention', run: () => store.pruneRetention() },
    { name: 'reportDue', run: () => store.reportDue(new Set([watch.watchId])) },
    { name: 'updateReporting', run: () => store.updateReporting(origin.profileId, watch.watchId, 'quiet', watch.policyRevision) },
    { name: 'stopWatch', run: () => store.stopWatch(origin.profileId, watch.watchId, watch.policyRevision) },
    { name: 'deleteThread', run: () => store.deleteThread(origin.profileId, origin.threadId, 'delete-op') },
    { name: 'claimNotification', run: () => store.claimNotification(activity.activityId) },
    { name: 'finishNotification', run: () => store.finishNotification(activity.activityId, 'suppressed') },
    { name: 'markRead', run: () => store.markRead(origin.profileId, origin.threadId, 0) },
    { name: 'setFreshness', run: () => store.setFreshness(watch.watchId, 'reconnecting') },
    { name: 'reconcileSnapshot', run: () => store.reconcileSnapshot(watch.watchId, watch.sourceDataEpoch,
      projection.sourceSequence, projection.executionState, false) },
  ];
}
function disarm(f: Fixture) { f.faults = {}; f.nowFailure.armed = false; fsSeam.armed = false; }
function assertAllWritesBlocked(f: Fixture, entries: ReturnType<typeof validWrites>, expectedState = 'unconfirmed') {
  disarm(f); // Gate must be the cause; stale producer/cleanup faults cannot fake it.
  if (!f.store) throw Error('actual_store_fixture_missing');
  expect(Object.getOwnPropertyDescriptor(f.store, 'writeState')?.value).toBe(expectedState);
  const before = f.execCalls.length;
  for (const entry of entries) expect(entry.run, entry.name).toThrow('conversation_activity_write_unconfirmed');
  expect(f.execCalls).toHaveLength(before); // No BEGIN/COMMIT/ROLLBACK reached by ANY sibling.
  expect(f.store?.getDiagnostics()).toHaveProperty('sourceEvents');
  expect(f.store?.getAssociation('op')).not.toBeNull(); // Read diagnostics remain usable; not a durable-readback claim.
}
function metadata(calls: readonly (readonly unknown[])[]) {
  return calls.flatMap(call => {
    const value: unknown = call[1];
    return value && typeof value === 'object' && !Array.isArray(value) ? [value] : [];
  });
}
afterEach(() => {
  const failures: unknown[] = [];
  fsSeam.armed = false;
  for (const f of fixtures.splice(0)) {
    disarm(f);
    try { f.store?.close(); } catch (error) { failures.push(error); }
    const closeActual = (db: DatabaseSync | undefined) => {
      if (!db || f.closed.has(db)) return true;
      if (f.realCloseFailed.has(db)) return false; // Never retry a genuine failed native close automatically.
      try { originalClose.call(db); f.closed.add(db); return true; }
      catch (error) { f.realCloseFailed.add(db); failures.push(error); return false; }
    };
    const dataClosed = closeActual(f.data);
    if (dataClosed) closeActual(f.owner); // Owner release depends on acknowledged actual data close.
    for (const db of f.handles) if (db !== f.data && db !== f.owner) closeActual(db);
    if ([...f.handles].every(db => f.closed.has(db))) {
      try { rmSync(f.root, { recursive: true, force: true }); } catch (error) { failures.push(error); retainedFixtureFailures.push(f); }
    } else {
      retainedFixtureFailures.push(f); // Keep actual resources; fail the hook, never fake a cleanup ACK.
      failures.push(Error('owned_store_fixture_resources_unconfirmed'));
    }
  }
  try { vi.restoreAllMocks(); } catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, 'owned_store_fixture_cleanup_failed');
});

const names = ['prepareAssociation','forgetUnboundAssociation','markPresented','bindWork','ingest','ingestRetainedPage',
  'pruneRetention','reportDue','updateReporting','stopWatch','deleteThread','claimNotification','finishNotification','markRead','setFreshness','reconcileSnapshot'];
it.each(names)('POST ONLY: valid public %s remains usable on a healthy actual store', name => {
  const f = fixture(), store = open(f), entry = validWrites(store).find(value => value.name === name);
  if (!entry) throw Error('actual_write_entry_missing');
  expect(entry.run).not.toThrow();
});

it.each(['rollback','secure','both'] as const)('POST ONLY: actual body primary identity + %s cleanup seals every public sibling', kind => {
  const f = fixture(), store = open(f), entries = validWrites(store);
  const primary = Object.freeze(new Error('actual_now_primary'));
  f.nowFailure = { armed: true, primary };
  if (kind !== 'secure') f.faults.rollback = new Error('owned_rollback_fault');
  if (kind !== 'rollback') { fsSeam.armed = true; fsSeam.error = new Error('owned_fs_fault'); }
  const log = vi.spyOn(console, 'error');
  expectSameThrow(() => store.bindWork({ operationId: 'next-op', watchId: 'failed-watch', source: 'task_host',
    logicalSourceId: 'storage-fixture', sourceDataEpoch: 'epoch', workId: 'body-failure-row' }), primary);
  if (kind !== 'secure') expect(metadata(log.mock.calls)).toContainEqual(expect.objectContaining({ phase: 'rollback', stage: 'body-failed' }));
  if (kind !== 'rollback') expect(metadata(log.mock.calls)).toContainEqual(expect.objectContaining({ phase: 'secure-sidecars', stage: 'body-failed' }));
  assertAllWritesBlocked(f, entries);
});
it('POST ONLY: body rejection with confirmed rollback/permissions stays retryable; primary remains identical', () => {
  const f = fixture(), store = open(f), entries = validWrites(store), primary = new Error('body_only');
  f.nowFailure = { armed: true, primary };
  expectSameThrow(() => store.bindWork({ operationId: 'next-op', watchId: 'failed-watch', source: 'task_host',
    logicalSourceId: 'storage-fixture', sourceDataEpoch: 'epoch', workId: 'body-only-row' }), primary);
  disarm(f);
  expect(Object.getOwnPropertyDescriptor(store, 'writeState')?.value).toBe('writable');
  const entry = entries.find(e => e.name === 'prepareAssociation');
  if (!entry) throw Error('actual_write_entry_missing');
  expect(entry.run).not.toThrow();
});
it('POST ONLY: post-COMMIT secure error keeps its own identity, actual committed row, and seals later writes', () => {
  const f = fixture(), store = open(f), entries = validWrites(store), cleanup = Object.freeze(new Error('postcommit_secure'));
  const origin = store.getAssociation('op')?.origin; if (!origin) throw Error('actual_origin_missing');
  fsSeam.armed = true; fsSeam.error = cleanup;
  const start = f.execCalls.length, log = vi.spyOn(console, 'error');
  expectSameThrow(() => store.prepareAssociation({ operationId: 'committed-op', creationIdempotencyKey: 'committed-op', origin }), cleanup);
  expect(f.execCalls.slice(start)).toEqual(['BEGIN IMMEDIATE','COMMIT']);
  expect(store.getAssociation('committed-op')).not.toBeNull();
  expect(metadata(log.mock.calls)).toContainEqual(expect.objectContaining({ stage: 'commit-returned', relation: 'primary-after-commit' }));
  assertAllWritesBlocked(f, entries, 'committed-unverified');
});
it.each(['before','after'] as const)('POST ONLY: COMMIT %s-return fault keeps primary and never infers rollback durability', when => {
  const f = fixture(), store = open(f), entries = validWrites(store), primary = new Error('commit_fault');
  if (when === 'before') f.faults.commitBefore = primary; else f.faults.commitAfter = primary;
  const origin = store.getAssociation('op')?.origin; if (!origin) throw Error('actual_origin_missing');
  expectSameThrow(() => store.prepareAssociation({ operationId: 'commit-edge', creationIdempotencyKey: 'commit-edge', origin }), primary);
  if (when === 'after') expect(store.getAssociation('commit-edge')).not.toBeNull();
  assertAllWritesBlocked(f, entries);
});
it('POST ONLY: BEGIN fault means unknown admission, no blind rollback, same primary and blocked siblings', () => {
  const f = fixture(), store = open(f), entries = validWrites(store), primary = new Error('begin_fault');
  f.faults.begin = primary; const start = f.execCalls.length;
  expectSameThrow(entries[0].run, primary);
  expect(f.execCalls.slice(start)).toEqual(['BEGIN IMMEDIATE']);
  assertAllWritesBlocked(f, entries);
});
it.each(['data','owner'] as const)('POST ONLY: failed constructor %s close preserves init identity and actual owner dependency', target => {
  const f = fixture(), primary = Object.freeze(new Error('constructor_now_primary'));
  f.nowFailure = { armed: true, primary };
  if (target === 'data') f.faults.dataClose = new Error('data_close_fault'); else f.faults.ownerClose = new Error('owner_close_fault');
  expectSameThrow(() => open(f), primary);
  expect(f.data).toBeDefined(); expect(f.owner).toBeDefined();
  if (target === 'data') { expect(f.closeCalls).toContain(f.data); expect(f.closeCalls).not.toContain(f.owner); }
  else { expect(f.closed.has(f.data!)).toBe(true); expect(f.closeCalls).toContain(f.owner); }
});
it('POST ONLY: readonly constructor native prepare+close failure preserves the real prepare error', () => {
  const f = fixture(); const bootstrap = new DatabaseSync(f.file); bootstrap.exec('PRAGMA user_version=0'); bootstrap.close();
  const primary = new Error('readonly_prepare_fault'); f.faults.prepare = primary; f.faults.dataClose = new Error('readonly_close_fault');
  expectSameThrow(() => new ConversationActivityStore(f.file, { readOnly: true }), primary);
  expect(f.data).toBeDefined(); expect(f.closeCalls).toContain(f.data);
});

it('POST ONLY: the real cleanup diagnostic prefix sees the already-sealed public writer', () => {
  const f = fixture(), store = open(f), entries = validWrites(store), primary = new Error('reentrant_primary');
  f.nowFailure = { armed: true, primary }; f.faults.rollback = new Error('rollback_fault');
  const reentries: ReturnType<typeof attempt>[] = [], realLog = console.error;
  vi.spyOn(console, 'error').mockImplementation((...args: Parameters<typeof console.error>) => {
    reentries.push(attempt(entries[0].run));
    realLog.apply(console, args);
  });
  expectSameThrow(() => store.bindWork({ operationId: 'next-op', watchId: 'failed-watch', source: 'task_host',
    logicalSourceId: 'storage-fixture', sourceDataEpoch: 'epoch', workId: 'reentrant-row' }), primary);
  expect(reentries).toHaveLength(1);
  expect(reentries[0]).toMatchObject({ threw: true, error: expect.objectContaining({ message: 'conversation_activity_write_unconfirmed' }) });
  assertAllWritesBlocked(f, entries);
});

it('POST ONLY: owner setup and close faults retain the existing owner-held mapping and original cause', () => {
  const f = fixture(), setup = new Error('owner_setup_fault');
  f.faults.ownerSetup = setup; f.faults.ownerClose = new Error('owner_close_fault');
  const observed = attempt(() => open(f));
  expect(observed.threw).toBe(true);
  if (!observed.threw) throw Error('control_expected_real_constructor_throw');
  expect(observed.error).toBeInstanceOf(Error);
  if (!(observed.error instanceof Error)) throw Error('actual_owner_mapping_error_missing');
  expect(observed.error.message).toBe('conversation_activity_owner_held');
  expect(observed.error.cause).toBe(setup);
  expect(f.data).toBeUndefined(); expect(f.owner).toBeDefined();
  expect(f.closeCalls).toEqual([f.owner]);
});
