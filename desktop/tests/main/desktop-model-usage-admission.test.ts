// @vitest-environment node
import { expect, it, vi, type TestContext } from 'vitest';
import { mkdtempSync, realpathSync, lstatSync, rmSync, existsSync, type Stats } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { DesktopMultiAgentService, type DesktopAgentExecutionContext } from '../../electron/desktop-multi-agent-service.js';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { mapDesktopModelUsageAdmission, type DesktopModelUsageAdmission } from '../../electron/desktop-model-usage-admission.js';
import { MultiAgentCommandSequencer } from '../../electron/desktop-multi-agent-mailbox.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { assertDesktopModelPhysicalIdle, waitDesktopModelPhysicalIdle, type DesktopModelPhysicalScope } from '../../electron/desktop-task-stream.js';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const outcome = <T>(promise: Promise<T>) => promise.then(
  value => ({ ok: true as const, value }), error => ({ ok: false as const, error }),
);

interface Fixture {
  service: DesktopMultiAgentService;
  store: DesktopMultiAgentStore;
  db: DatabaseSync;
  context: DesktopAgentExecutionContext;
  queue: MultiAgentCommandSequencer;
  capture(id: string): DesktopModelUsageAdmission;
  cancel(): Promise<void>;
  finish(): Promise<void>;
  expectIntegrityFailure(error: unknown): void;
  track<T>(name: string, promise: Promise<T>): Promise<T>;
  keep<T>(name: string, value: T): T;
  restores: Array<() => void>;
}
type Observed<T> = Awaited<ReturnType<typeof outcome<T>>>;
interface RootIdentity {
  root: string; nonce: string; runToken: string; workerPid: number; workerPpid: number;
  uid: number; dev: number; ino: number; birthtimeMs: number;
}
interface FixtureOwner {
  nonce: string; runToken: string; workerPid: number; workerPpid: number;
  identity?: RootIdentity;
  references: Map<string, unknown>;
}
// Strong and append-only for this actual worker's lifetime. No WeakRef,
// finalizer, afterAll, clear/delete, or child-side retained-root removal.
const retainedOwners: FixtureOwner[] = [];

/** Actual service/host/store actor. The literal root body has no SDK/provider,
 * recipe, spawn, fetch/config/registry dependency, or child session. */
function withFixture(context: TestContext, work: (fixture: Fixture) => Promise<void>): Promise<void> {
  const owner: FixtureOwner = { nonce: randomUUID(),
    runToken: process.env.XIAOK_USAGE_ADMISSION_RUN_TOKEN ?? randomUUID().replaceAll('-', ''),
    workerPid: process.pid, workerPpid: process.ppid, references: new Map() };
  const keep = <T>(name: string, value: T): T => {
    let key = name, suffix = 0;
    while (owner.references.has(key) && owner.references.get(key) !== value) key = `${name}#${++suffix}`;
    owner.references.set(key, value); return value;
  };
  const observe = <T>(name: string, raw: Promise<T>) => keep(`${name}.outcome`, outcome(keep(name, raw)));
  keep('testContext', context); keep('workCallback', work);
  const hold = keep('hold', deferred<void>()), entered = keep('entered', deferred<DesktopAgentExecutionContext>());
  const restores = keep('restores', [] as Array<() => void>), admissions = keep('admissions', [] as DesktopModelUsageAdmission[]);
  const cleanupErrors = keep('cleanupErrors', [] as unknown[]), abortErrors = keep('abortErrors', [] as unknown[]);
  const usageOutcomes = keep('usageOutcomes', [] as Promise<Observed<unknown>>[]);
  const ownAggregates = keep('ownAggregates', new Map<AggregateError, readonly unknown[]>());
  const aggregate = (originals: readonly unknown[], message: string) => {
    const values: unknown[] = [];
    const append = (value: unknown) => {
      // Only our exact constructor receipts may be expanded; every unknown
      // error remains opaque. Nullable/primitive occurrences retain presence.
      const owned = ownAggregates.get(value as AggregateError);
      if (owned) { for (const original of owned) append(original); return; }
      const reference = value !== null && (typeof value === 'object' || typeof value === 'function');
      if (!reference || !values.some(original => original === value)) values.push(value);
    };
    for (const original of originals) append(original);
    const result = new AggregateError(values, message, { cause: values[0] });
    ownAggregates.set(result, [...values]); return result;
  };
  keep('aggregateCallback', aggregate);
  let root: string | undefined, created: Stats | undefined;
  let store: DesktopMultiAgentStore | undefined, db: DatabaseSync | undefined, service: DesktopMultiAgentService | undefined;
  let host: InProcessTaskRuntimeHost | undefined, materials: MaterialRegistry | undefined, coordinator: DesktopExecutionCoordinator | undefined;
  let actor: DesktopAgentExecutionContext | undefined, scope: DesktopModelPhysicalScope | undefined;
  let nativeState: (() => boolean) | undefined;
  let rootOutcome: Promise<Observed<unknown>> | undefined;
  let finishResults: { rootResult?: Observed<unknown>; disposeResult?: Observed<void> } | undefined;
  let expectedSticky: { error: unknown } | undefined;
  let finishPromise: Promise<void> | undefined, healthy = false;
  let stickyVerified = false;
  let retentionRequested = false, retentionLogged = false;
  const record = (kind: string, extra: Record<string, unknown> = {}) => {
    console.info(`XIAOK_USAGE_FIXTURE_ROOT_${kind} ` + JSON.stringify({ ...(owner.identity ?? {
      root, nonce: owner.nonce, runToken: owner.runToken, workerPid: owner.workerPid, workerPpid: owner.workerPpid }), ...extra }));
  };
  keep('recordCallback', record);
  const registerRetention = () => {
    retentionRequested = true;
    let index = retainedOwners.indexOf(owner);
    if (index === -1) { retainedOwners.push(owner); index = retainedOwners.length - 1; }
    const stored = retainedOwners[index];
    expect(stored).toBe(owner); expect(stored.references).toBe(owner.references);
    expect(stored.identity).toBe(owner.identity); expect(stored.nonce).toBe(owner.nonce); expect(stored.runToken).toBe(owner.runToken);
    // Check acquired originals, not merely a copied list of reference names.
    const expected: Array<[string, unknown]> = [['testContext', context], ['workCallback', work], ['hold', hold], ['entered', entered],
      ['admissions', admissions], ['restores', restores], ['cleanupErrors', cleanupErrors], ['abortErrors', abortErrors]];
    if (store) expected.push(['store', store]); if (db) expected.push(['db', db]);
    if (service) expected.push(['service', service]); if (host) expected.push(['host', host]);
    if (materials) expected.push(['materials', materials]); if (coordinator) expected.push(['coordinator', coordinator]);
    if (actor) expected.push(['actor', actor], ['memberTicket', actor.memberTicket]);
    if (scope) expected.push(['physicalScope', scope]); if (rootOutcome) expected.push(['rootOutcome', rootOutcome]);
    if (finishPromise) expected.push(['finishPromise', finishPromise]);
    for (const [key, value] of expected) expect(stored.references.get(key)).toBe(value);
    const snapshot = [...owner.references];
    for (const [key, value] of snapshot) expect(stored.references.get(key)).toBe(value);
    return { registered: true, registryIndex: index, registrySize: retainedOwners.length, referenceCount: snapshot.length };
  };
  keep('registerRetentionCallback', registerRetention);
  const retain = (reason: string) => {
    const receipt = registerRetention();
    if (!retentionLogged) {
      retentionLogged = true;
      record('RETAINED', { ...receipt, reason, stickyVerified, expectedSticky: Boolean(expectedSticky), nativeOpen: db ? nativeState?.() : null });
    }
    return receipt;
  };
  keep('retainCallback', retain);
  const finish = () => {
    if (finishPromise) return finishPromise;
    finishPromise = (async () => {
      const failures: unknown[] = [];
      keep('finishFailures', failures);
      try { host?.stopAccepting('usage_fixture_end'); } catch (error) { failures.push(error); }
      try { host?.abortAllActive('app_shutdown'); } catch (error) { failures.push(error); }
      hold.resolve();
      let hostResult: Observed<void> | undefined, rootResult: Observed<unknown> | undefined;
      let physicalResult: Observed<void> | undefined, disposeResult: Observed<void> | undefined;
      if (host) hostResult = await observe('hostDrain', host.drain());
      if (rootOutcome) rootResult = await rootOutcome;
      // This is an additional idle query, not the original close Promise.
      if (scope) physicalResult = await observe('physicalIdleQuery', waitDesktopModelPhysicalIdle(scope));
      // Work asserted its intentional unit-level rejections; joining here is
      // completion only, never a claim that a failed journal/command succeeded.
      keep('joinedUsageOutcomes', await Promise.all(usageOutcomes));
      if (service) {
        try {
          const raw = keep('dispose', service.dispose()); expect(service.dispose()).toBe(raw);
          disposeResult = await observe('disposeObserved', raw);
        } catch (error) { failures.push(error); }
      }
      finishResults = keep('finishResults', { hostResult, rootResult, physicalResult, disposeResult });
      failures.push(...abortErrors);
      if (hostResult?.ok === false) failures.push(hostResult.error);
      if (physicalResult?.ok === false) failures.push(physicalResult.error);
      try {
        expect(actor).toBeDefined(); expect(scope).toBeDefined(); expect(rootResult).toBeDefined();
        expect(hostResult?.ok).toBe(true); expect(physicalResult?.ok).toBe(true);
        assertDesktopModelPhysicalIdle(scope!);
        expect(host!.inFlightTaskIds()).toEqual([]); expect(actor!.memberTicket.released).toBe(true);
        expect(coordinator!.snapshot().active).toBe(0);
        if (!rootResult) throw Error('usage_fixture_original_root_outcome_missing');
        if (expectedSticky) {
          expect(rootResult.ok).toBe(false);
          if (rootResult.ok) throw Error('usage_fixture_original_root_rejection_missing');
          expect(rootResult.error).toBe(expectedSticky.error);
          expect(disposeResult?.ok).toBe(false);
          if (!disposeResult || disposeResult.ok) throw Error('usage_fixture_original_dispose_rejection_missing');
          expect(disposeResult.error).toBe(expectedSticky.error);
          expect(store!.hasUsageIdentityFailure()).toBe(true); expect(service!.runtimeStatus().blocked).toBe(true);
          expect(store!.isClosed()).toBe(false); expect(nativeState!()).toBe(true);
          expect(db!.prepare('SELECT 1 AS alive').get()).toEqual({ alive: 1 });
          stickyVerified = failures.length === 0;
        } else {
          // The known literal action returns only undefined. Shutdown requests
          // cancellation asynchronously, so normal completion can win that race.
          if (rootResult.ok) expect(rootResult.value).toBeUndefined();
          else {
            expect(actor!.signal.aborted).toBe(true);
            expect(rootResult.error).toBe(actor!.signal.reason);
          }
          expect(disposeResult?.ok).toBe(true); expect(service!.runtimeStatus().blocked).toBe(false);
          if (disposeResult?.ok === false) throw disposeResult.error;
        }
      } catch (error) { failures.push(error); }
      // A signature is not full cleanup acceptance. If any extra U/nullable
      // failure exists, retain both actual source rejections in the final tree.
      if (failures.length) throw aggregate([
        ...(rootResult?.ok === false ? [rootResult.error] : []),
        ...(disposeResult?.ok === false ? [disposeResult.error] : []), ...failures,
      ], 'usage_fixture_owner_drain_failed');
      if (expectedSticky) return; // Unknown native/journal is retained, not closed.
      try { if (materials) await observe('materialsClose', materials.sealAndDrainInstanceMutations()).then(result => { if (!result.ok) throw result.error; }); }
      catch (error) { failures.push(error); }
      try { if (host) await observe('sourceWriterClose', host.closeSourceWriterForMigration()).then(result => { if (!result.ok) throw result.error; }); }
      catch (error) { failures.push(error); }
      if (failures.length) throw aggregate([
        ...(rootResult?.ok === false ? [rootResult.error] : []),
        ...(disposeResult?.ok === false ? [disposeResult.error] : []), ...failures,
      ], 'usage_fixture_writer_close_failed');
      healthy = true;
    })();
    keep('finishPromise', finishPromise); observe('finishObservation', finishPromise);
    return finishPromise;
  };
  keep('finishCallback', finish);
  const onAbort = () => {
    try { retain('test_context_aborted'); } catch (error) { abortErrors.push(error); cleanupErrors.push(error); }
    try { host?.abortAllActive('app_shutdown'); } catch (error) { abortErrors.push(error); cleanupErrors.push(error); }
    hold.resolve();
  };
  keep('abortCallback', onAbort);
  const raw = (async () => {
    let body: { error: unknown } | undefined;
    try {
      root = mkdtempSync(join(tmpdir(), 'desktop-usage-admission-')); keep('allocatedRootPath', root);
      root = realpathSync(root); created = lstatSync(root);
      owner.identity = { root, nonce: owner.nonce, runToken: owner.runToken, workerPid: owner.workerPid, workerPpid: owner.workerPpid,
        uid: created.uid, dev: created.dev, ino: created.ino, birthtimeMs: created.birthtimeMs };
      keep('rootIdentity', owner.identity); keep('rootCreationStat', created);
      record('CREATED');
      context.signal.addEventListener('abort', onAbort, { once: true });
      context.signal.throwIfAborted();
      store = keep('store', new DesktopMultiAgentStore(join(root, 'groups.sqlite')));
      db = keep('db', Reflect.get(store, 'db') as DatabaseSync);
      const descriptor = Object.getOwnPropertyDescriptor(db, 'isOpen');
      if (descriptor?.configurable !== false || typeof descriptor.get !== 'function') throw Error('native_close_receipt_unavailable');
      const getter = keep('nativeGetter', descriptor.get);
      nativeState = keep('nativeStateCallback', () => {
        const value: unknown = Reflect.apply(getter, db!, []);
        if (typeof value !== 'boolean') throw Error('native_close_receipt_invalid');
        return value;
      });
      coordinator = keep('coordinator', new DesktopExecutionCoordinator());
      service = keep('service', new DesktopMultiAgentService({ store, coordinator,
        createSession: async () => { throw Error('no child is requested by this service-unit fixture'); } }));
      service.registerThread({ threadId: 'usage-thread', profileId: 'usage-profile', workspaceId: 'usage-workspace', cwd: root });
      materials = keep('materials', new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1048576 }));
      host = keep('host', new InProcessTaskRuntimeHost({ snapshotStore: new FileTaskSnapshotStore(join(root, 'tasks')), materialRegistry: materials,
        runner: input => {
          const original = service!.runRoot(input, async current => { entered.resolve(current); await hold.promise; });
          rootOutcome = keep('rootOutcome', observe('rootRun', original)); return original;
        },
        authorizePreparation: (id, marker) => service!.assertHostPreparation(id, marker),
        assertTaskAdmission: snapshot => service!.assertHostAdmission(snapshot),
        decideCancellation: (snapshot, reason) => service!.decideHostCancellation(snapshot, reason) }));
      await observe('initialize', service.initialize(host)).then(result => { if (!result.ok) throw result.error; });
      const preparedResult = await observe('prepareRoot', service.prepareRoot(host, 'usage-thread', { prompt: 'Hold one actual root actor.', materials: [] }));
      if (!preparedResult.ok) throw preparedResult.error;
      const prepared = preparedResult.value;
      keep('preparedRoot', prepared);
      await observe('startTask', host.startTask(prepared.taskId)).then(result => { if (!result.ok) throw result.error; });
      actor = keep('actor', await entered.promise); keep('memberTicket', actor.memberTicket);
      scope = keep('physicalScope', service.captureRootModelPhysicalScope(actor)); assertDesktopModelPhysicalIdle(scope);
      const group = (Reflect.get(service, 'groups') as Map<string, { commands: MultiAgentCommandSequencer }>).get(actor.groupId)!;
      keep('queue', group.commands);
      const fixture: Fixture = { service, store, db, context: actor, queue: group.commands, restores, keep,
        track: (name, promise) => { usageOutcomes.push(observe(name, promise)); return promise; },
        capture(id) { const admission = service!.captureAdmittedUsage(actor!, id); admissions.push(admission); return admission; },
        cancel: () => keep('cancel', host!.cancelTask(prepared.taskId, 'usage_fixture_cancel')), finish,
        expectIntegrityFailure(error) {
          expect(expectedSticky).toBeUndefined(); expect(store!.hasUsageIdentityFailure()).toBe(true);
          let repeated: { error: unknown } | undefined;
          try { store!.readUsageIdentity(actor!.groupId, actor!.agentId, 'usage-thread'); }
          catch (value) { repeated = { error: value }; }
          expect(repeated).toBeDefined(); expect(repeated!.error).toBe(error);
          expectedSticky = keep('expectedSticky', { error });
        } };
      keep('fixture', fixture);
      const result = await observe('work', work(fixture)); if (!result.ok) throw result.error;
    } catch (error) { body = keep('businessFailure', { error }); }
    finally {
      try { await finish(); } catch (error) { cleanupErrors.push(error); }
      let removed = false;
      if (healthy && !retentionRequested && !body && cleanupErrors.length === 0) {
        for (const admission of admissions) { try { admission.revoke(); } catch (error) { cleanupErrors.push(error); } }
        for (let index = restores.length - 1; index >= 0; index--) { try { restores[index](); } catch (error) { cleanupErrors.push(error); } }
        if (cleanupErrors.length === 0) try {
          expect(coordinator!.snapshot().active).toBe(0); expect(service!.runtimeStatus().blocked).toBe(false);
          store!.close(); expect(nativeState!()).toBe(false);
          const current = lstatSync(root!);
          expect(current.isSymbolicLink()).toBe(false); expect(realpathSync(root!)).toBe(root);
          expect([current.uid, current.dev, current.ino, current.birthtimeMs]).toEqual([created!.uid, created!.dev, created!.ino, created!.birthtimeMs]);
          rmSync(root!, { recursive: true, force: false }); expect(existsSync(root!)).toBe(false);
          removed = true; record('DELETED', { nativeClosed: true });
        } catch (error) { cleanupErrors.push(error); }
      }
      if (!removed) {
        try {
          const receipt = registerRetention();
          if (expectedSticky && !body && cleanupErrors.length === 0) {
            expect(stickyVerified).toBe(true); expect(nativeState!()).toBe(true);
            expect(db!.prepare('SELECT 1 AS alive').get()).toEqual({ alive: 1 });
          }
          expect(receipt.registered).toBe(true);
          retain(expectedSticky ? 'verified_sticky_or_failure' : 'unconfirmed_cleanup');
        } catch (error) { cleanupErrors.push(error); }
      }
      try { context.signal.removeEventListener('abort', onAbort); } catch (error) { cleanupErrors.push(error); }
    }
    if (cleanupErrors.length || body) throw aggregate([
      ...(body ? [body.error] : []), ...(finishResults?.rootResult?.ok === false ? [finishResults.rootResult.error] : []),
      ...(finishResults?.disposeResult?.ok === false ? [finishResults.disposeResult.error] : []), ...cleanupErrors,
    ], 'usage_fixture_business_and_cleanup_failed');
  })();
  keep('scenario', raw);
  const settled = keep('scenarioOutcome', outcome(raw));
  context.onTestFinished(async () => { await settled; if (context.signal.aborted) throw context.signal.reason; });
  return raw;
}

function observeCommands(f: Fixture) {
  const commands: Promise<unknown>[] = [], original = f.queue.run;
  const spy = vi.spyOn(f.queue, 'run').mockImplementation(((action: () => unknown) => {
    const raw = original.call(f.queue, action); commands.push(raw); return raw;
  }) as typeof f.queue.run);
  f.keep('commandPromises', commands); f.keep('commandSpy', spy);
  f.restores.push(() => spy.mockRestore());
  return commands;
}
function usageEvents(f: Fixture) {
  return f.store.readEvents(f.context.groupId, 0, 1000).filter(event => event.kind === 'usage');
}

// Mutate the actual private SQLite row, never a replacement getAgent result.
// Restore the exact bytes before host disposal so the intentional corruption
// cannot alter the unrelated original root owner's final factual publication.
it('durable identity: refuses capture when the actual agent row JSON id differs from its SQL key', ctx => withFixture(ctx, async f => {
  const row = f.db.prepare('SELECT agent_id,data_json FROM agents WHERE group_id=? AND agent_id=?')
    .get(f.context.groupId, f.context.agentId) as { agent_id: string; data_json: string };
  const changed = { ...JSON.parse(row.data_json), id: 'different-durable-agent-id' };
  try {
    f.db.prepare('UPDATE agents SET data_json=? WHERE group_id=? AND agent_id=?')
      .run(JSON.stringify(changed), f.context.groupId, f.context.agentId);
    const actual = f.db.prepare('SELECT agent_id,json_extract(data_json,\'$.id\') AS json_id FROM agents WHERE group_id=? AND agent_id=?')
      .get(f.context.groupId, f.context.agentId) as { agent_id: string; json_id: string };
    expect(actual.agent_id).toBe(f.context.agentId); expect(actual.json_id).toBe(changed.id);
    expect(f.store.getAgent(f.context.groupId, f.context.agentId)?.id).toBe(changed.id);
    let failure: { error: unknown } | undefined;
    try { f.capture('corrupt-agent-before-capture'); } catch (error) { failure = { error }; }
    expect(failure).toBeDefined();
    expect(usageEvents(f)).toHaveLength(0);
    f.expectIntegrityFailure(failure!.error);
  } finally {
    f.db.prepare('UPDATE agents SET data_json=? WHERE group_id=? AND agent_id=?')
      .run(row.data_json, f.context.groupId, f.context.agentId);
  }
}));

it('durable identity: refuses queued settlement when actual SQL created_at diverges from unchanged agent JSON', ctx => withFixture(ctx, async f => {
  const cap = f.capture('corrupt-agent-after-queue');
  const row = f.db.prepare('SELECT created_at,data_json FROM agents WHERE group_id=? AND agent_id=?')
    .get(f.context.groupId, f.context.agentId) as { created_at: number; data_json: string };
  const raw = f.track('originalIdentityCommit', cap.commit(3, 5)), result = outcome(raw);
  try {
    f.db.prepare('UPDATE agents SET created_at=? WHERE group_id=? AND agent_id=?')
      .run(row.created_at + 1, f.context.groupId, f.context.agentId);
    const actual = f.db.prepare('SELECT created_at,data_json FROM agents WHERE group_id=? AND agent_id=?')
      .get(f.context.groupId, f.context.agentId) as { created_at: number; data_json: string };
    expect(actual.created_at).toBe(row.created_at + 1); expect(actual.data_json).toBe(row.data_json);
    const settled = await result;
    expect(settled.ok).toBe(false);
    expect(usageEvents(f)).toHaveLength(0);
    if (settled.ok) throw Error('expected actual identity rejection');
    f.expectIntegrityFailure(settled.error);
  } finally {
    await result;
    f.db.prepare('UPDATE agents SET created_at=?,data_json=? WHERE group_id=? AND agent_id=?')
      .run(row.created_at, row.data_json, f.context.groupId, f.context.agentId);
  }
}));

const durableDrifts = [
  'group-json-groupId', 'group-json-threadId', 'group-sql-thread_id', 'group-sql-boot_id',
  'group-sql-created_at', 'agent-json-id', 'agent-sql-parent_id', 'agent-sql-created_at',
] as const;
type SqlRow = Record<string, string | number | null>;
const factualTables = ['groups', 'agents', 'events', 'messages', 'contents', 'operations', 'root_turns',
  'managed_resources', 'activity_runs', 'activity_members'] as const;

for (const boundary of ['factory', 'queued'] as const) {
  it.for(durableDrifts)(`durable matrix ${boundary}: refuses %s without changing another actual group or its thread index`, (drift, ctx) => withFixture(ctx, async f => {
    // H, its root agent and B are real rows in the same database, not mocked
    // identities returned by a getter. H has a distinct, existing thread.
    f.service.registerThread({ threadId: 'usage-other-thread', profileId: 'usage-profile', workspaceId: 'usage-workspace', cwd: f.context.cwd });
    const h = f.store.createGroup('usage-other-thread');
    const hRoot = f.store.getAgent(h.groupId, `root_${h.groupId}`)!;
    f.store.putAgent(h.groupId, { ...hRoot, resourcesReleased: true, cleanupPending: false });
    const bId = `identity-witness-${randomUUID()}`;
    f.store.putAgent(f.context.groupId, { id: bId, parentId: null, taskName: 'identity_witness', canonicalName: '/identity_witness',
      depth: 0, status: 'closed', turn: 0, resourcesReleased: true, cleanupPending: false });
    const originalG = f.db.prepare('SELECT * FROM groups WHERE group_id=?').get(f.context.groupId) as SqlRow;
    const originalA = f.db.prepare('SELECT * FROM agents WHERE group_id=? AND agent_id=?').get(f.context.groupId, f.context.agentId) as SqlRow;
    const originalH = f.db.prepare('SELECT * FROM groups WHERE group_id=?').get(h.groupId) as SqlRow;
    const snapshotH = () => factualTables.map(table => ({ table,
      rows: f.db.prepare(`SELECT * FROM ${table} WHERE group_id=? ORDER BY rowid`).all(h.groupId) }));
    const beforeH = snapshotH(), beforeB = f.store.getAgent(f.context.groupId, bId);
    const beforeThreads = f.db.prepare('SELECT * FROM thread_bindings WHERE thread_id IN (?,?) ORDER BY thread_id')
      .all('usage-thread', 'usage-other-thread');
    const beforeEvents = f.db.prepare('SELECT * FROM events WHERE group_id=? ORDER BY seq').all(f.context.groupId);
    const beforeOperations = f.db.prepare('SELECT * FROM operations WHERE group_id=? ORDER BY operation_id').all(f.context.groupId);
    const beforeUsage = f.store.getAgent(f.context.groupId, f.context.agentId)!.usage;
    const cap = boundary === 'queued' ? f.capture(`matrix-${drift}`) : undefined;
    // P is published before the queued microtask executes. No await is allowed
    // between this call and the real SQL mutation below.
    const pending = cap ? outcome(f.track('matrixCommit', cap.commit(3, 5))) : undefined;
    const writeRow = (table: 'groups' | 'agents', row: SqlRow) => {
      const columns = Object.keys(row).filter(column => column !== 'group_id' && (table !== 'agents' || column !== 'agent_id'));
      f.db.prepare(`UPDATE ${table} SET ${columns.map(column => `${column}=?`).join(',')} WHERE group_id=?${table === 'agents' ? ' AND agent_id=?' : ''}`)
        .run(...columns.map(column => row[column]), row.group_id, ...(table === 'agents' ? [row.agent_id] : []));
    };
    try {
      const table = drift.startsWith('group-') ? 'groups' : 'agents';
      const original = table === 'groups' ? originalG : originalA;
      const changed = { ...original };
      if (drift === 'group-json-groupId' || drift === 'group-json-threadId' || drift === 'agent-json-id') {
        const json = JSON.parse(String(original.data_json));
        if (drift === 'group-json-groupId') json.groupId = h.groupId;
        else if (drift === 'group-json-threadId') json.threadId = 'usage-other-thread';
        else json.id = bId;
        changed.data_json = JSON.stringify(json);
      } else if (drift === 'group-sql-thread_id') changed.thread_id = 'usage-other-thread';
      else if (drift === 'group-sql-boot_id') changed.boot_id = 'different-physical-boot';
      else if (drift === 'agent-sql-parent_id') changed.parent_id = bId;
      else changed.created_at = Number(original.created_at) + 1;
      writeRow(table, changed);
      const actual = f.db.prepare(`SELECT * FROM ${table} WHERE group_id=?${table === 'agents' ? ' AND agent_id=?' : ''}`)
        .get(f.context.groupId, ...(table === 'agents' ? [f.context.agentId] : []));
      expect(actual).toEqual(changed);
      const result = pending ? await pending : await outcome(Promise.resolve().then(() => f.capture(`matrix-${drift}`)));
      // Inspect all cross-identity side effects before asserting refusal. This
      // also detects the rejected-v4 spread/freeze write into existing H.
      expect(snapshotH()).toEqual(beforeH);
      expect(f.db.prepare('SELECT byte_usage FROM groups WHERE group_id=?').get(h.groupId)).toEqual({ byte_usage: originalH.byte_usage });
      expect(f.db.prepare('SELECT thread_id FROM groups WHERE group_id=?').get(f.context.groupId)).toEqual({ thread_id: changed.thread_id ?? originalG.thread_id });
      expect(f.db.prepare('SELECT * FROM thread_bindings WHERE thread_id IN (?,?) ORDER BY thread_id').all('usage-thread', 'usage-other-thread')).toEqual(beforeThreads);
      expect(f.store.getAgent(f.context.groupId, bId)).toEqual(beforeB);
      expect(f.store.getAgent(f.context.groupId, f.context.agentId)!.usage).toEqual(beforeUsage);
      expect(f.db.prepare('SELECT * FROM events WHERE group_id=? ORDER BY seq').all(f.context.groupId)).toEqual(beforeEvents);
      expect(f.db.prepare('SELECT * FROM operations WHERE group_id=? ORDER BY operation_id').all(f.context.groupId)).toEqual(beforeOperations);
      expect(result.ok).toBe(false);
      if (result.ok) throw Error('expected actual matrix identity rejection');
      f.expectIntegrityFailure(result.error);
    } finally {
      if (pending) await pending;
      // Exact pre-corruption rows, including H if a buggy freeze overwrote it.
      // Do not normalize through a getter which has discarded the SQL keys.
      writeRow('groups', originalG); writeRow('groups', originalH); writeRow('agents', originalA);
    }
  }));
}

it('durable pre-COMMIT: swallowing an actual identity failure cannot commit earlier probe or later port/control writes', ctx => withFixture(ctx, async f => {
  const bId = `transaction-witness-${randomUUID()}`;
  f.store.putAgent(f.context.groupId, { id: bId, parentId: null, taskName: 'transaction_witness', canonicalName: '/transaction_witness',
    depth: 0, status: 'closed', turn: 0, resourcesReleased: true, cleanupPending: false });
  const row = f.db.prepare('SELECT data_json FROM agents WHERE group_id=? AND agent_id=?')
    .get(f.context.groupId, f.context.agentId) as { data_json: string };
  const originalGroup = f.store.requireGroup(f.context.groupId);
  const originalGroupRow = f.db.prepare('SELECT * FROM groups WHERE group_id=?').get(f.context.groupId) as SqlRow;
  const operationId = `identity-probe-${randomUUID()}`, lateOperationId = `${operationId}-late`;
  const failure: { value: unknown }[] = [], portFailure: { value: unknown }[] = [], controlFailure: { value: unknown }[] = [];
  let transactionResult: { ok: true; value: unknown } | { ok: false; error: unknown };
  try {
    try {
      const value = f.store.transaction(port => {
        port.putOperation({ groupId: f.context.groupId, operationId, command: 'usage', requestHash: 'before-identity-probe',
          applyState: 'applied', result: { state: 'completed' } });
        f.db.prepare('UPDATE agents SET data_json=? WHERE group_id=? AND agent_id=?')
          .run(JSON.stringify({ ...JSON.parse(row.data_json), id: bId }), f.context.groupId, f.context.agentId);
        expect(f.store.getAgent(f.context.groupId, f.context.agentId)?.id).toBe(bId);
        try { f.capture('inside-original-transaction'); } catch (error) { failure.push({ value: error }); }
        // Swallow the expected failure deliberately. Do not throw a test
        // assertion here: only the original store exit gate may force rollback.
        try { port.putOperation({ groupId: f.context.groupId, operationId: lateOperationId, command: 'usage', requestHash: 'after-identity-probe',
          applyState: 'applied', result: { state: 'completed' } }); }
        catch (error) { portFailure.push({ value: error }); }
        try { f.store.putGroup({ ...originalGroup, mutationBlockedReason: 'must-not-write-after-integrity-failure' }, true); }
        catch (error) { controlFailure.push({ value: error }); }
        return 'original callback swallowed its failure';
      });
      transactionResult = { ok: true, value };
    } catch (error) { transactionResult = { ok: false, error }; }
    // The outer transaction, not a test assertion thrown in its callback, must
    // roll back the successful earlier statement as well as the corrupt row.
    expect(f.db.prepare('SELECT operation_id FROM operations WHERE group_id=? AND operation_id IN (?,?)')
      .all(f.context.groupId, operationId, lateOperationId)).toEqual([]);
    expect(f.db.prepare('SELECT data_json FROM agents WHERE group_id=? AND agent_id=?').get(f.context.groupId, f.context.agentId)).toEqual(row);
    expect(failure).toHaveLength(1); expect(portFailure).toHaveLength(1); expect(controlFailure).toHaveLength(1);
    expect(portFailure[0].value).toBe(failure[0].value); expect(controlFailure[0].value).toBe(failure[0].value);
    expect(transactionResult.ok).toBe(false);
    if (transactionResult.ok) throw Error('expected original store exit failure');
    expect(transactionResult.error).toBe(failure[0].value);
    f.expectIntegrityFailure(transactionResult.error);
  } finally {
    f.db.prepare('UPDATE agents SET data_json=? WHERE group_id=? AND agent_id=?').run(row.data_json, f.context.groupId, f.context.agentId);
    f.db.prepare('DELETE FROM operations WHERE group_id=? AND operation_id IN (?,?)').run(f.context.groupId, operationId, lateOperationId);
    // Repair only this fixture's deliberate old-code control write before the
    // unrelated root-owner finalization. New code must never perform that write.
    const columns = Object.keys(originalGroupRow).filter(column => column !== 'group_id');
    f.db.prepare(`UPDATE groups SET ${columns.map(column => `${column}=?`).join(',')} WHERE group_id=?`)
      .run(...columns.map(column => originalGroupRow[column]), f.context.groupId);
  }
}));

it('memoizes the exact real command P and applies one durable event/operation', ctx => withFixture(ctx, async f => {
  const cap = f.capture('normal-usage'), commands = observeCommands(f);
  const p = f.track('normalCommit', cap.commit(11, 13));
  expect(Object.isFrozen(cap)).toBe(true); expect(p).toBe(commands[0]); expect(cap.commit(11, 13)).toBe(p);
  expect(() => cap.commit(12, 13)).toThrow('usage_id_conflict');
  await p;
  expect(commands).toHaveLength(1); expect(usageEvents(f)).toHaveLength(1);
  expect(f.store.getAgent(f.context.groupId, f.context.agentId)?.usage).toEqual({ inputTokens: 11, outputTokens: 13 });
  expect(usageEvents(f)[0].payload).toMatchObject({ usageId: 'normal-usage', inputTokens: 11, outputTokens: 13 });
}));

it('settles an admitted receipt after actual actor cancellation while ordinary usage remains denied', ctx => withFixture(ctx, async f => {
  const cap = f.capture('before-cancellation');
  await f.cancel(); expect(f.context.signal.aborted).toBe(true);
  await expect(f.service.recordUsage(f.context, { usageId: 'unadmitted', inputTokens: 2, outputTokens: 3 })).rejects.toThrow();
  expect(() => f.service.captureAdmittedUsage(f.context, 'after-cancellation')).toThrow();
  await f.track('cancelledCommit', cap.commit(17, 19));
  expect(usageEvents(f)).toHaveLength(1);
  expect(f.store.getAgent(f.context.groupId, f.context.agentId)?.usage).toEqual({ inputTokens: 17, outputTokens: 19 });
}));

it('rejects cloned/borrowed receivers and cross-service actors without revoking the original', ctx => withFixture(ctx, async f => {
  const cap = f.capture('receiver-owner');
  const clone = { ...cap };
  expect(() => clone.commit(1, 2)).toThrow('desktop_model_usage_admission_invalid');
  expect(() => cap.revoke.call(clone)).toThrow('desktop_model_usage_admission_invalid');
  expect(() => cap.commit.call({} as DesktopModelUsageAdmission, 1, 2)).toThrow('desktop_model_usage_admission_invalid');
  await withFixture(ctx, async other => {
    const otherCap = other.capture('other-service');
    expect(() => cap.commit.call(otherCap, 1, 2)).toThrow('desktop_model_usage_admission_invalid');
    expect(() => other.service.captureAdmittedUsage(f.context, 'foreign-context')).toThrow();
  });
  await f.track('receiverCommit', cap.commit(1, 2)); expect(usageEvents(f)).toHaveLength(1);
  cap.revoke(); cap.revoke();
  expect(() => cap.commit(1, 2)).toThrow('desktop_model_usage_admission_revoked');
}));

it('rejects durable turn and incarnation replacement before any usage transaction', ctx => withFixture(ctx, async f => {
  const cap = f.capture('fixed-identity'), before = f.store.getAgent(f.context.groupId, f.context.agentId)!;
  try {
    f.store.putAgent(f.context.groupId, { ...before, turn: before.turn + 1, turnId: 'different-turn' });
    expect(() => cap.commit(3, 5)).toThrow('desktop_model_usage_admission_stale');
    f.store.putAgent(f.context.groupId, { ...before, createdAt: before.createdAt + 1 });
    expect(() => cap.commit(3, 5)).toThrow('desktop_model_usage_admission_stale');
    expect(usageEvents(f)).toHaveLength(0);
  } finally { f.store.putAgent(f.context.groupId, before); }
}));

it('rejects store closure even when the original actor object still exists', ctx => withFixture(ctx, async f => {
  const cap = f.capture('closed-store');
  await f.finish(); f.store.close();
  expect(() => cap.commit(3, 5)).toThrow('desktop_model_usage_admission_stale');
}));

it('rejects every invalid token domain without queueing a factual command', ctx => withFixture(ctx, async f => {
  const cap = f.capture('invalid-tokens'), commands = observeCommands(f);
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => cap.commit(value, 1)).toThrow('invalid usage');
    expect(() => cap.commit(1, value)).toThrow('invalid usage');
  }
  expect(commands).toHaveLength(0); expect(usageEvents(f)).toHaveLength(0);
}));

it('rolls back overflow of the actual durable total without a usage event or operation', ctx => withFixture(ctx, async f => {
  const cap = f.capture('overflow'), before = f.store.getAgent(f.context.groupId, f.context.agentId)!;
  f.store.putAgent(f.context.groupId, { ...before, usage: { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 0 } });
  await expect(f.track('overflowCommit', cap.commit(1, 0))).rejects.toThrow('invalid usage');
  expect(f.store.getAgent(f.context.groupId, f.context.agentId)?.usage).toEqual({ inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 0 });
  expect(usageEvents(f)).toHaveLength(0);
}));

it('memoizes complete C separately from P and waits for the one original journal J', ctx => withFixture(ctx, async f => {
  const original = f.capture('mapped-journal'), commands = observeCommands(f), entered = deferred<void>(), journal = deferred<void>();
  let calls = 0, complete = false;
  f.keep('journalHold', journal); f.keep('journalEntered', entered);
  const cap = f.keep('mappedCap', mapDesktopModelUsageAdmission(original, () => { calls++; entered.resolve(); return f.track('journalJ', journal.promise); }));
  const c = f.track('mappedC', cap.commit(7, 9)); const settled = f.track('mappedSettlement', c.then(() => { complete = true; }));
  try {
    expect(cap.commit(7, 9)).toBe(c); expect(() => cap.commit(7, 10)).toThrow('usage_id_conflict');
    await entered.promise;
    expect(commands).toHaveLength(1); expect(c).not.toBe(commands[0]);
    expect(complete).toBe(false); expect(calls).toBe(1); expect(usageEvents(f)).toHaveLength(1);
    journal.resolve(); await c; await settled;
    expect(complete).toBe(true); expect(cap.commit(7, 9)).toBe(c); expect(calls).toBe(1);
    const clone = { ...cap };
    expect(() => clone.commit(7, 9)).toThrow('desktop_model_usage_admission_invalid');
    expect(() => cap.revoke.call(clone)).toThrow('desktop_model_usage_admission_invalid');
    cap.revoke(); cap.revoke(); expect(() => cap.commit(7, 9)).toThrow('desktop_model_usage_admission_revoked');
  } finally { journal.resolve(); await outcome(c); }
}));

for (const [name, reason] of [['Error', Error('original journal failure')], ['undefined', undefined], ['null', null]] as const) {
  it(`keeps journal rejection ${name} as the same failed C without a second J`, ctx => withFixture(ctx, async f => {
    const original = f.capture('failed-journal'), commands = observeCommands(f);
    let calls = 0;
    const cap = f.keep('failedMappedCap', mapDesktopModelUsageAdmission(original, () => { calls++; return f.track('failedJournalJ', Promise.reject(reason)); }));
    const c = f.track('failedMappedC', cap.commit(5, 6)); const result = await outcome(c);
    expect(result.ok).toBe(false); if (result.ok) throw Error('expected original journal rejection');
    expect(result.error).toBe(reason); expect(cap.commit(5, 6)).toBe(c);
    const repeated = await outcome(cap.commit(5, 6)); expect(repeated.ok).toBe(false);
    if (repeated.ok) throw Error('expected repeated original journal rejection');
    expect(repeated.error).toBe(reason); expect(calls).toBe(1); expect(commands).toHaveLength(1);
    expect(c).not.toBe(commands[0]); expect(usageEvents(f)).toHaveLength(1); cap.revoke();
  }));
}

it('revokes the original receipt if request-wrapper construction is rejected', ctx => withFixture(ctx, async f => {
  const original = f.capture('construction-failure');
  expect(() => mapDesktopModelUsageAdmission(original, undefined as never)).toThrow('desktop_model_usage_admission_invalid');
  expect(() => original.commit(1, 1)).toThrow('desktop_model_usage_admission_revoked');
  expect(usageEvents(f)).toHaveLength(0);
}));
