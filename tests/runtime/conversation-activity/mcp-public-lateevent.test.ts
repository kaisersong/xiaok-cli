import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withRealLateFixture, gate, checkpoint, resultOf } from './r282-public-lateevent-fixture.js';

it('U1 actual SDK execution/ref/event: normal observation once, then late event cannot start a new SDK snapshot after close', async () => {
  await withRealLateFixture(async f => {
    const initial = await f.stats(); expect(initial.created).toBe(1); expect(initial.gets).toBe(0);
    await f.observer.event(f.reference, f.event);
    const normal = await f.stats(); expect(normal.created).toBe(1); expect(normal.gets).toBe(1);
    const closing = f.activities.close(); await closing; expect(f.activities.close()).toBe(closing);
    await f.observer.event(f.reference, f.event);
    expect((await f.stats()).gets).toBe(normal.gets);
    // Closing the observer did not cancel/suspend the real owned remote task.
    expect((await f.stats()).active).toBe(1);
  });
}, 30000);

it('U2 actual Service authorization pending at close: await the raw producer, then do not start a post-seal SDK snapshot', async () => {
  await withRealLateFixture(async f => {
    const authorization = gate<boolean>(); let entered = false, closed = false;
    f.release(() => authorization.resolve(true));
    f.hooks.authorize = () => { entered = true; return authorization.promise; };
    const event = Promise.resolve(f.observer.event(f.reference, f.event)); f.own(event);
    await vi.waitFor(() => expect(entered).toBe(true), { timeout: 5000 });
    const closing = f.activities.close(); f.own(closing); const observed = closing.then(() => { closed = true; }); f.own(observed);
    await checkpoint(); expect(closed).toBe(false);
    authorization.resolve(true); await event; await closing; await observed;
    expect((await f.stats()).gets).toBe(0); expect(closed).toBe(true);
  });
}, 30000);

it('U2 rejection countercontrol: the real pending authorization rejection remains the exact raw reason in close', async () => {
  await withRealLateFixture(async f => {
    const authorization = gate<boolean>(), error = new Error('own in-flight public read authorization rejected'); let entered = false;
    f.release(() => authorization.resolve(false)); f.hooks.authorize = () => { entered = true; return authorization.promise; };
    const event = Promise.resolve(f.observer.event(f.reference, f.event)); f.own(event); const eventResult = resultOf(event);
    await vi.waitFor(() => expect(entered).toBe(true), { timeout: 5000 });
    const closing = f.activities.close(); f.own(closing); const closeResult = resultOf(closing);
    authorization.reject(error); const produced = await eventResult, closed = await closeResult;
    expect(produced.status).toBe('rejected'); if (produced.status !== 'rejected') throw Error('actual event rejection missing'); expect(produced.reason).toBe(error);
    expect(closed.status).toBe('rejected'); if (closed.status !== 'rejected') throw Error('actual close rejection missing');
    expect(closed.reason).toBeInstanceOf(AggregateError); if (!(closed.reason instanceof AggregateError)) throw Error('actual close aggregate missing');
    expect(closed.reason.errors).toContain(error); expect(f.activities.close()).toBe(closing); f.expectCloseError(closed.reason);
    expect((await f.stats()).gets).toBe(0);
  });
}, 30000);

it('U3 actual public authorization synchronously reenters close: ownership is captured before the read prefix', async () => {
  await withRealLateFixture(async f => {
    const authorization = gate<boolean>(); let closed = false, closing: Promise<void> | undefined;
    f.release(() => authorization.resolve(true));
    f.hooks.authorize = () => {
      closing = f.activities.close(); f.own(closing);
      const observed = closing.then(() => { closed = true; }); f.own(observed);
      return authorization.promise;
    };
    const event = Promise.resolve(f.observer.event(f.reference, f.event)); f.own(event);
    await vi.waitFor(() => expect(closing).toBeDefined(), { timeout: 5000 });
    await checkpoint(); expect(closed).toBe(false);
    authorization.resolve(true); await event; await closing; await Promise.resolve();
    expect(closed).toBe(true); expect((await f.stats()).gets).toBe(0);
  });
}, 30000);

it('U4 real late hooks and endpointReady continuation: no new prepare/read/restore writer after seal', async () => {
  await withRealLateFixture(async f => {
    const endpoint = gate<void>(); let entered = false, closed = false;
    f.release(() => endpoint.resolve()); f.hooks.endpointReady = () => { entered = true; return endpoint.promise; };
    const invocation = randomUUID(), originBefore = f.counters.origin;
    const initializing = f.activities.observer(f.callerId, invocation, f.connection); f.own(initializing);
    await vi.waitFor(() => expect(entered).toBe(true), { timeout: 5000 });
    const closing = f.activities.close(); f.own(closing); const observed = closing.then(() => { closed = true; }); f.own(observed);
    const before = f.store.getProjection(f.watch.watchId);
    await f.observer.unavailable?.(f.reference); await f.observer.detached?.(f.reference); await f.observer.immediate?.();
    expect(f.store.getProjection(f.watch.watchId)).toEqual(before); expect((await f.stats()).gets).toBe(0);
    await checkpoint(); expect(closed).toBe(false); endpoint.resolve();
    expect(await initializing).toBeUndefined(); await closing; await observed;
    expect(f.counters.origin).toBe(originBefore); expect(f.store.getAssociation(`mcp:${invocation}`)).toBeNull();
    // Old detached already stopped before SDK I/O. This test does not invent
    // a physical read RED for its former bookkeeping-only restore Promise.
  });
}, 30000);
