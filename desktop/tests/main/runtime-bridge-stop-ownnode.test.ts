// @vitest-environment node
import { expect, it } from 'vitest';
import { withWire, deferred, dataReady, resultOf } from './r318-owned-wire-fixture.js';
const NativePromise = Promise;

it('N1 full original factory: synchronous original close receiver/args, actual native close event, memoized stop', async () => {
  await withWire(async f => {
    await f.start(); await f.wait('registrations', 1);
    const closing = f.stop(); expect(f.client.stop()).toBe(closing);
    expect(f.counts.close).toBe(1); expect(f.closeReceivers[0]).toBe(f.sockets[0].owner); expect(f.closeArguments).toEqual([[]]);
    await closing;
    expect(f.sockets[0].native).toBeInstanceOf(WebSocket); expect(f.sockets[0].closedSeen).toBe(true);
    await f.wait('wsClosed', 1); const stats = await f.stats();
    expect(stats.registrations).toBe(1); expect(stats.activeWebSockets).toBe(0); expect(f.counts.forbidden).toBe(0);
  });
}, 25000);

it('N2 real headers/status ACK precedes held HTTP body EOF; stop cannot finish merely because the socket closed', async () => {
  await withWire(async f => {
    await f.start(); await f.wait('registrations', 1); expect((await f.stats()).activeResponses).toBe(1);
    const closing = f.stop(); let settled = false; void closing.then(() => { settled = true; }, () => { settled = true; });
    await f.sockets[0].closed; await f.wait('wsClosed', 1);
    expect((await f.stats()).activeResponses).toBe(1); expect(settled).toBe(false);
    await f.releaseHttp('/participants/register'); await closing;
    expect((await f.stats()).activeResponses).toBe(0); expect(f.counts.forbidden).toBe(0);
  }, { holdRegistrationBody: true });
}, 25000);

it('N3 actual wire-delivered admitted handler and its later HTTP child remain owned after seal; new public dispatch is refused', async () => {
  await withWire(async f => {
    const entered = deferred<void>(), release = deferred<ReturnType<typeof dataReady>>(); f.release(() => release.resolve(dataReady()));
    f.hooks.probe = async () => { entered.resolve(); return await release.promise; };
    await f.start(); await f.configure({ holdIntentBody: true }); await f.send(); await entered.promise;
    const closing = f.stop(); let settled = false; void closing.then(() => { settled = true; }, () => { settled = true; });
    await f.sockets[0].closed; await f.wait('wsClosed', 1);
    await f.own(f.client.handleSocketMessage(await f.wire()));
    expect(f.counts.probes).toBe(1); expect((await f.stats()).intents).toBe(0); expect(settled).toBe(false);
    release.resolve(dataReady()); await f.wait('intents', 1);
    expect((await f.stats()).activeResponses).toBe(1); expect(settled).toBe(false);
    await f.releaseHttp('/intents'); await closing;
    expect(f.counts.probes).toBe(1); expect(f.counts.forbidden).toBe(0);
  });
}, 25000);

it('N4 a real pending native fetch rejection remains the same handler/stop reason; failed retirement cannot silently reopen', async () => {
  await withWire(async f => {
    await f.start(); await f.configure({ holdIntentHeaders: true });
    const handler = f.own(f.client.handleSocketMessage(await f.wire())); await f.wait('intents', 1);
    const closing = f.stop(); const handlerResult = resultOf(handler), stopResult = resultOf(closing);
    await f.dropHttp('/intents'); const produced = await handlerResult, closed = await stopResult;
    expect(produced.status).toBe('rejected'); if (produced.status !== 'rejected') throw Error('actual_native_fetch_rejection_missing');
    expect(f.fetchFailures).toContain(produced.reason);
    expect(closed.status).toBe('rejected'); if (closed.status !== 'rejected' || !(closed.reason instanceof AggregateError)) throw Error('actual_stop_aggregate_missing');
    expect(closed.reason.errors).toContain(produced.reason); f.allowStopError(closed.reason);
    const before = await f.stats(), attempted = await resultOf(f.start());
    expect(attempted.status).toBe('rejected'); if (attempted.status !== 'rejected') throw Error('failed_retirement_reopened');
    expect(attempted.reason).toBe(closed.reason); expect((await f.stats()).wsOpened).toBe(before.wsOpened);
    expect(f.client.stop()).toBe(closing); expect(f.sockets.every(socket => socket.closedSeen)).toBe(true); expect(f.counts.forbidden).toBe(0);
  });
}, 25000);

it('N5 a handled historical HTTP startup failure and its real socket close do not poison a later healthy same-endpoint stop', async () => {
  await withWire(async f => {
    const first = await resultOf(f.start()); expect(first.status).toBe('rejected');
    if (first.status !== 'rejected' || !(first.reason instanceof Error)) throw Error('actual_http500_start_failure_missing');
    expect(first.reason.message).toBe('broker_http_500'); await f.sockets[0].closed; await f.wait('wsClosed', 1);
    await f.configure({ failRegistration: false }); await f.start(); await f.wait('registrations', 2);
    const closing = f.stop(); await closing;
    expect(f.sockets).toHaveLength(2); expect(f.sockets.every(socket => socket.closedSeen)).toBe(true);
    expect(f.client.stop()).toBe(closing); expect(f.counts.forbidden).toBe(0);
  }, { failRegistration: true });
}, 25000);

it('N6 synchronous ordinary handler-prefix stop already owns the same pending handler raw, without self-await or a synthetic drain', async () => {
  await withWire(async f => {
    const entered = deferred<void>(), release = deferred<ReturnType<typeof dataReady>>(); f.release(() => release.resolve(dataReady()));
    let closing: Promise<void> | undefined;
    f.hooks.probe = async () => { closing = f.stop(); entered.resolve(); return await release.promise; };
    await f.start(); const handler = f.own(f.client.handleSocketMessage(await f.wire())); await entered.promise;
    if (!closing) throw Error('actual_reentrant_stop_missing'); expect(f.client.stop()).toBe(closing);
    let settled = false; void closing.then(() => { settled = true; }, () => { settled = true; });
    await f.sockets[0].closed; await f.wait('wsClosed', 1); expect(settled).toBe(false); expect((await f.stats()).intents).toBe(0);
    release.resolve(dataReady()); await handler; await closing;
    expect((await f.stats()).intents).toBe(1); expect(f.counts.probes).toBe(1); expect(f.counts.forbidden).toBe(0);
  });
}, 25000);

it('N7 genuine pending upgrade and constructor-late arrival both require actual native close events and preserve pending start errors', async () => {
  await withWire(async f => {
    const start = f.start(); await f.wait('heldUpgrades', 1);
    const closing = f.stop(); const started = await resultOf(start), closed = await resultOf(closing);
    expect(started.status).toBe('rejected'); if (started.status !== 'rejected') throw Error('actual_open_interruption_missing');
    expect(closed.status).toBe('rejected'); if (closed.status !== 'rejected' || !(closed.reason instanceof AggregateError)) throw Error('actual_open_stop_aggregate_missing');
    expect(closed.reason.errors).toContain(started.reason); f.allowStopError(closed.reason);
    expect(f.sockets[0].closedSeen).toBe(true); expect((await f.stats()).registrations).toBe(0); expect(f.counts.forbidden).toBe(0);
  }, { holdUpgrade: true });
  await withWire(async f => {
    let closing: Promise<void> | undefined;
    f.hooks.construct = () => { closing = f.stop(); };
    await f.start(); if (!closing) throw Error('constructor_reentrant_stop_missing'); await closing;
    expect(f.client.stop()).toBe(closing); expect(f.sockets[0].native).toBeInstanceOf(WebSocket);
    expect(f.sockets[0].closedSeen).toBe(true); expect(f.counts.close).toBe(1); expect(f.closeArguments).toEqual([[]]);
    expect((await f.stats()).registrations).toBe(0); expect(f.counts.forbidden).toBe(0);
  });
}, 45000);

it('N8 start during pending stop is refused before effects; only fully retired same-client generation can explicitly restart', async () => {
  await withWire(async f => {
    await f.start(); const closing = f.stop(); expect(f.client.stop()).toBe(closing);
    const refused = await resultOf(f.start()); expect(refused.status).toBe('rejected');
    if (refused.status !== 'rejected' || !(refused.reason instanceof Error)) throw Error('pending_stop_admission_rejection_missing');
    expect(refused.reason.message).toBe('runtime_bridge_stop_in_progress'); expect((await f.stats()).registrations).toBe(1);
    await f.releaseHttp('/participants/register'); await closing;
    await f.configure({ holdRegistrationBody: false }); await f.start(); await f.wait('registrations', 2);
    const second = f.stop(); expect(second).not.toBe(closing); expect(f.client.stop()).toBe(second); await second;
    expect(f.sockets).toHaveLength(2); expect(f.sockets.every(socket => socket.closedSeen)).toBe(true); expect(f.counts.forbidden).toBe(0);
  }, { holdRegistrationBody: true });
}, 25000);

it('N9 an external real 5000ms observation deadline cannot release an owned HTTP body or manufacture stop success', async () => {
  await withWire(async f => {
    await f.start(); expect((await f.pauseReads()).pausedReads).toBe(1);
    const closing = f.stop(), cap = deferred<'observer-cap'>(); let settled = false; void closing.then(() => { settled = true; }, () => { settled = true; });
    const timer = setTimeout(() => cap.resolve('observer-cap'), 5000);
    try {
      const observed = await NativePromise.race([closing.then(() => 'drained', () => 'rejected'), cap.promise]);
      expect(observed).toBe('observer-cap'); expect((await f.stats()).activeResponses).toBe(1);
      expect(f.sockets[0].closedSeen).toBe(false);
      await f.releaseHttp('/participants/register');
      const bodyDone = await f.stats(); expect(bodyDone.activeResponses).toBe(0); expect(bodyDone.pausedReads).toBe(1);
      expect(f.sockets[0].closedSeen).toBe(false); expect(settled).toBe(false);
      await f.resumeReads(); await closing;
      expect((await f.stats()).activeResponses).toBe(0); expect(f.sockets[0].closedSeen).toBe(true); expect(f.counts.forbidden).toBe(0);
    } finally { clearTimeout(timer); }
  }, { holdRegistrationBody: true });
}, 30000);

it('N10 illegal ambient species reads no getter or producer before real start/handler/first stop; normal restored public call still works once', async () => {
  await withWire(async f => {
    await f.start(); const wire = await f.wire(), before = await f.stats(), calls = { ...f.counts };
    const originalSpecies = Object.getOwnPropertyDescriptor(NativePromise, Symbol.species);
    const originalGlobal = Object.getOwnPropertyDescriptor(globalThis, 'Promise');
    const originalThen = Object.getOwnPropertyDescriptor(NativePromise.prototype, 'then');
    if (!originalSpecies || !originalGlobal || !originalThen) throw Error('standard_promise_descriptor_missing');
    let getters = 0, ambientEffects = 0;
    const variants: Array<{ label: string; target: object; key: PropertyKey; original: PropertyDescriptor; poisoned: PropertyDescriptor }> = [
      { label: 'species accessor', target: NativePromise, key: Symbol.species, original: originalSpecies,
        poisoned: { configurable: true, get() { getters++; return NativePromise; } } },
      { label: 'global Promise accessor', target: globalThis, key: 'Promise', original: originalGlobal,
        poisoned: { configurable: true, get() { getters++; return NativePromise; } } },
      { label: 'global Promise value', target: globalThis, key: 'Promise', original: originalGlobal,
        poisoned: { ...originalGlobal, value: function () { ambientEffects++; throw Error('ambient_constructor_must_not_run'); } } },
      { label: 'Promise.prototype.then accessor', target: NativePromise.prototype, key: 'then', original: originalThen,
        poisoned: { configurable: true, get() { getters++; return originalThen.value; } } },
      { label: 'Promise.prototype.then value', target: NativePromise.prototype, key: 'then', original: originalThen,
        poisoned: { ...originalThen, value: function () { ambientEffects++; throw Error('ambient_then_must_not_run'); } } },
    ];
    for (const variant of variants) {
      const errors: unknown[] = [], returned: unknown[] = [];
      try {
        // No await, assertion, mock wrapper or framework callback in poison window.
        Object.defineProperty(variant.target, variant.key, variant.poisoned);
        for (const call of [() => f.client.start(), () => f.client.handleSocketMessage(wire), () => f.client.stop()]) {
          try { returned.push(call()); } catch (error) { errors.push(error); }
        }
      } finally { Object.defineProperty(variant.target, variant.key, variant.original); }
      for (const value of returned) if (value instanceof NativePromise) f.own(value);
      expect(errors, variant.label).toHaveLength(3);
      for (const error of errors) { expect(error).toBeInstanceOf(Error); if (!(error instanceof Error)) throw Error('ambient_rejection_missing'); expect(error.message).toBe('runtime_bridge_promise_unavailable'); }
      expect(getters, variant.label).toBe(0); expect(ambientEffects, variant.label).toBe(0); expect(f.counts).toEqual(calls);
      const after = await f.stats(); expect(after.requests).toBe(before.requests); expect(after.registrations).toBe(before.registrations); expect(after.intents).toBe(before.intents);
    }
    await f.own(f.client.handleSocketMessage(wire)); expect(f.counts.probes).toBe(1); await f.wait('intents', 1);
    await f.stop(); expect(f.counts.forbidden).toBe(0);
  });
}, 25000);
