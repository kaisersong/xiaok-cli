import {captureUsageNativeOpen} from './usage-native-database-state.js';
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

import {deferred,outcome,retainedOwners,fixtureErrorGraph,type Fixture,type RootIdentity,type FixtureOwner,type Observed} from './model-usage-fixture-values.js';
export function withFixture(context: TestContext, work: (fixture: Fixture) => Promise<void>): Promise<void> {
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
  let entrySeen = false;
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
      nativeState = keep('nativeStateCallback', captureUsageNativeOpen(db));
      coordinator = keep('coordinator', new DesktopExecutionCoordinator());
      service = keep('service', new DesktopMultiAgentService({ store, coordinator,
        createSession: async () => { throw Error('no child is requested by this service-unit fixture'); } }));
      service.registerThread({ threadId: 'usage-thread', profileId: 'usage-profile', workspaceId: 'usage-workspace', cwd: root });
      materials = keep('materials', new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1048576 }));
      host = keep('host', new InProcessTaskRuntimeHost({ snapshotStore: new FileTaskSnapshotStore(join(root, 'tasks')), materialRegistry: materials, groupObservationSource: service,
        runner: input => {
          const original = service!.runRoot(input, async current => { entrySeen = true; entered.resolve(current); await hold.promise; });
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
      const earlyDrain = observe('entryDrain', host.drain()).then(result => {
        if (entrySeen) return entered.promise;
        if (!result.ok) throw result.error;
        throw Error('usage_fixture_root_ended_before_entry');
      });
      actor = keep('actor', await Promise.race([entered.promise, earlyDrain])); keep('memberTicket', actor.memberTicket);
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
    } catch (error) { body = keep('businessFailure', { error });try{record('BODY_FAILURE',{graph:fixtureErrorGraph(error)});}catch(diagnostic){cleanupErrors.push(diagnostic);} }
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
export function usageEvents(f: Fixture) {
  return f.store.readEvents(f.context.groupId, 0, 1000).filter(event => event.kind === 'usage');
}
