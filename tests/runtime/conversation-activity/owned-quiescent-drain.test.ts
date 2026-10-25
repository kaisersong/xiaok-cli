import { createServer } from 'node:http';
import { mkdtempSync, rmSync, rmdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { ConversationActivityStore } from '../../../src/runtime/conversation-activity/store.js';
import { ConversationActivityService, type ActivityThreadIdentity } from '../../../src/runtime/conversation-activity/service.js';
import { ConversationActivitySources } from '../../../src/runtime/conversation-activity/sources.js';
import { ConversationActivityOwnerHost } from '../../../src/runtime/conversation-activity/owner-host.js';
import { ActivitySourceSupervisor, type ActivityManagedSource, type SourceReceipt } from '../../../src/runtime/conversation-activity/source-supervisor.js';

function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
async function attemptAll(steps: Array<() => void | Promise<unknown>>): Promise<unknown[]> {
  const outcomes = await Promise.allSettled(steps.map(run => { try { return Promise.resolve(run()); } catch (error) { return Promise.reject(error); } }));
  return outcomes.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
}
const checkpoint = () => new Promise<void>(resolve => setTimeout(resolve, 100));
const actor = { requestSource: 'user' as const, actorId: 'r247-owned-user' };
const thread: ActivityThreadIdentity = { profileId: 'r247-own-profile', threadId: 'r247-own-thread', workspaceId: 'r247-own-workspace', deleteState: 'none' };
function plainDomainOptions() {
  return { profileId: thread.profileId, actorId: actor.actorId,
    getThread: (id: string) => id === thread.threadId ? thread : null,
    canObserveWork: (watch: { source: string; workId: string }) => watch.source === 'kswarm' && watch.workId === 'r247-own-project' };
}
async function bindOwnedProject(service: ConversationActivityService, epoch: string) {
  const operationId = randomUUID(), watchId = randomUUID();
  await service.prepareAssociation({ threadId: thread.threadId, operationId, creationIdempotencyKey: operationId }, actor);
  return service.bindWork({ operationId, watchId, source: 'kswarm', logicalSourceId: 'r247-own-http-data', sourceDataEpoch: epoch, workId: 'r247-own-project' });
}

it('PUBLIC BEFORE/POST: host.stop waits the real admitted notification Promise before closing SQLite', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r247-host-notify-')), gate = deferred();
  let entered = false, notified = false, stopped = false;
  let host: ConversationActivityOwnerHost | undefined, event: Promise<unknown> | undefined, closing: Promise<void> | undefined;
  let originalFailure: unknown; let failed = false;
  try {
    host = new ConversationActivityOwnerHost({ dataRoot: root, ...plainDomainOptions(), authorizeProducer: () => false,
      async notify() { entered = true; await gate.promise; notified = true; return 'shown'; } });
    await host.start(); const watch = await bindOwnedProject(host.service, randomUUID());
    event = host.service.acceptEvent(watch.watchId, { schemaVersion: 1, eventId: randomUUID(), source: 'kswarm',
      logicalSourceId: watch.logicalSourceId, sourceDataEpoch: watch.sourceDataEpoch, workId: watch.workId,
      transportGeneration: watch.generation, sourceSequence: 1, kind: 'completed', businessOutcome: 'success', receivedAt: Date.now(), evidenceRefs: [] });
    const eventObserved = Promise.allSettled([event]);
    await vi.waitFor(() => expect(entered).toBe(true), { timeout: 5000 });
    closing = host.stop(); const observed = closing.then(() => { stopped = true; }); const closeObserved = Promise.allSettled([observed]);
    await checkpoint(); expect(notified).toBe(false); expect(stopped).toBe(false);
    expect(host.store.listWatches()).toHaveLength(1);
    gate.release(); await eventObserved; await observed; await closeObserved;
    expect(notified).toBe(true); expect(stopped).toBe(true);
    expect(() => host!.store.listWatches()).toThrow();
  } catch (error) { failed = true; originalFailure = error; throw error; } finally {
    gate.release();
    const failures = await attemptAll([() => Promise.allSettled([event, closing]), () => host?.stop()]);
    if (failures.length) throw new AggregateError([...(failed ? [originalFailure] : []), ...failures], 'notification cleanup failed; root retained');
    if (!host && failed) throw new AggregateError([originalFailure], 'host constructor ownership unknown; root retained');
    if (host && process.platform !== 'win32') {
      const expected = join(tmpdir(), `xa-${process.getuid?.() ?? 'windows-user'}-${host.address.rootHash.slice(0, 12)}`);
      if (dirname(host.address.socketPath) !== expected) throw Error('owned_socket_directory_mismatch'); rmdirSync(expected);
    }
    rmSync(root, { recursive: true });
  }
}, 15000);

it('POST actual public service: close captures pending report authorization, memoizes, and waits the real producer', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r247-report-')), gate = deferred();
  let store: ConversationActivityStore | undefined, service: ConversationActivityService | undefined;
  let now = 0, armed = false, entered = false, closed = false;
  let reporting: Promise<void> | undefined, closing: Promise<void> | undefined;
  let originalFailure: unknown; let failed = false;
  try {
    store = new ConversationActivityStore(join(root, 'activity.sqlite'), { now: () => now });
    const options = plainDomainOptions();
    service = new ConversationActivityService({ ...options, store, async canObserveWork(watch) {
      if (armed) { entered = true; await gate.promise; } return options.canObserveWork(watch);
    } });
    const watch = await bindOwnedProject(service, randomUUID());
    // Public store clock injection follows the ACTUAL produced due value; no
    // hand-filled watch/status/bool or changed product/env timeout.
    now = watch.nextReportDueAt; armed = true; reporting = service.reportDue();
    const reportObserved = Promise.allSettled([reporting]);
    await vi.waitFor(() => expect(entered).toBe(true), { timeout: 5000 });
    closing = service.close(); const observed = closing.then(() => { closed = true; }); const closeObserved = Promise.allSettled([observed]);
    expect(service.close()).toBe(closing); await checkpoint(); expect(closed).toBe(false);
    expect(store.listWatches()).toHaveLength(1);
    gate.release(); await reporting; await observed; await reportObserved; await closeObserved; expect(closed).toBe(true);
  } catch (error) { failed = true; originalFailure = error; throw error; } finally {
    gate.release(); const failures = await attemptAll([() => service?.close(), () => Promise.allSettled([reporting, closing])]);
    if (failures.length) throw new AggregateError([...(failed ? [originalFailure] : []), ...failures], 'report drain failed; store/root retained');
    if (!store && failed) throw new AggregateError([originalFailure], 'store constructor ownership unknown; root retained');
    store?.close(); rmSync(root, { recursive: true });
  }
}, 15000);

it('POST actual sources + real Supervisor: an own Node HTTP producer ignoring abort stays pending until its real response/server/child close', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r247-own-node-')), instance = randomUUID();
  let probe: ReturnType<typeof createServer> | undefined, store: ConversationActivityStore | undefined;
  let service: ConversationActivityService | undefined, sources: ConversationActivitySources | undefined, supervisor: ActivitySourceSupervisor | undefined;
  let receipt: SourceReceipt | undefined, url: string | undefined, refresh: Promise<void> | undefined;
  let sourceClose: Promise<void> | undefined, childClose: Promise<void> | undefined, sourcesDone = false, childDone = false, taskHostCalls = 0;
  let originalFailure: unknown; let failed = false;
  const headers = { 'x-r247-fixture-instance': instance };
  try {
    probe = createServer();
    await new Promise<void>((yes, no) => { probe!.once('error', no); probe!.listen(0, '127.0.0.1', yes); });
    const address = probe.address(); if (!address || typeof address === 'string') throw Error('own_port_missing'); const port = address.port;
    await new Promise<void>((yes, no) => probe!.close(error => error ? no(error) : yes()));
    url = `http://127.0.0.1:${port}`;
    supervisor = new ActivitySourceSupervisor(root, randomUUID());
    const source: ActivityManagedSource = { name: 'broker', executable: process.execPath,
      entryPath: resolve('tests/support/r247-owned-natural-service.mjs'), cwd: process.cwd(),
      env: { R247_ROOT: root, R247_PORT: String(port), R247_INSTANCE: instance },
      healthUrl: `${url}/health`, expectedHealth: { ok: true, fixtureInstance: instance } };
    // Name is the existing descriptor's plain enum DATA, not a real broker/SDK
    // identity assertion. Entry hash, process birth, PID and health are real.
    receipt = await supervisor.ensure(source); expect(receipt.external).toBe(false);
    expect(JSON.parse(readFileSync(join(root, 'ready.json'), 'utf8'))).toEqual({ pid: receipt.pid, instance });
    store = new ConversationActivityStore(join(root, 'activity.sqlite'));
    service = new ConversationActivityService({ ...plainDomainOptions(), store }); await bindOwnedProject(service, instance);
    sources = new ConversationActivitySources({ store, service,
      taskHost() { taskHostCalls++; throw Error('private_task_host_not_in_ordinary_project_control'); },
      async readProject() {
        // This genuine owned HTTP producer deliberately does not consume the
        // abort signal. Actual source.close must wait its real Promise anyway.
        const response = await fetch(`${url}/project`, { headers }); if (!response.ok) throw Error('own_http_read_failed'); return response.json();
      } });
    refresh = sources.refreshProject('r247-own-project'); const refreshObserved = Promise.allSettled([refresh]);
    await vi.waitFor(() => expect(existsSync(join(root, 'project-entered.json'))).toBe(true), { timeout: 5000 });
    sourceClose = sources.close(); childClose = supervisor.sealAndDrainSpawned();
    const observed = Promise.allSettled([sourceClose.then(() => { sourcesDone = true; }), childClose.then(() => { childDone = true; })]);
    expect(sources.close()).toBe(sourceClose); expect(supervisor.sealAndDrainSpawned()).toBe(childClose);
    await checkpoint(); expect(sourcesDone).toBe(false); expect(childDone).toBe(false); expect(taskHostCalls).toBe(0);
    await expect(supervisor.ensure(source)).rejects.toThrow('activity_source_closing');
    const released = await fetch(`${url}/release`, { method: 'POST', headers }); expect(released.ok).toBe(true); await released.arrayBuffer();
    await sourceClose; await childClose; await refreshObserved; await observed;
    expect(sourcesDone).toBe(true); expect(childDone).toBe(true);
    expect(JSON.parse(readFileSync(join(root, 'server-closed.json'), 'utf8'))).toEqual({ pid: receipt.pid, instance });
    expect(JSON.parse(readFileSync(join(root, 'exited.json'), 'utf8'))).toEqual({ pid: receipt.pid, instance, code: 0 });
    let absent: unknown; try { process.kill(receipt.pid, 0); } catch (error) { absent = error; } expect(absent).toMatchObject({ code: 'ESRCH' });
  } catch (error) { failed = true; originalFailure = error; throw error; } finally {
    // Only the own ready file + exact nonce proves this release is our fixture.
    if (url && existsSync(join(root, 'ready.json')) && !existsSync(join(root, 'exited.json'))) {
      const ready: unknown = JSON.parse(readFileSync(join(root, 'ready.json'), 'utf8'));
      if (ready && typeof ready === 'object' && 'instance' in ready && ready.instance === instance) {
        try { const response = await fetch(`${url}/release`, { method: 'POST', headers }); await response.arrayBuffer(); } catch { /* final real child barrier, not this request, decides cleanup */ }
      }
    }
    const failures = await attemptAll([() => new Promise<void>((yes, no) => { if (!probe?.listening) { yes(); return; } probe.close(error => error ? no(error) : yes()); }), () => sources?.close(), () => supervisor?.sealAndDrainSpawned(), () => Promise.allSettled([refresh, sourceClose, childClose]), () => service?.close()]);
    if (failures.length) throw new AggregateError([...(failed ? [originalFailure] : []), ...failures], 'own Node drain unconfirmed; actual root retained');
    if (!receipt || !existsSync(join(root, 'exited.json'))) throw new AggregateError([...(failed ? [originalFailure] : []), Error('actual child exit evidence missing')], 'own Node root retained');
    let absent: unknown; try { process.kill(receipt.pid, 0); } catch (error) { absent = error; }
    if (!absent || typeof absent !== 'object' || !('code' in absent) || absent.code !== 'ESRCH') throw Error('actual child still alive/unknown; root retained');
    store?.close(); rmSync(root, { recursive: true });
  }
}, 35000);
