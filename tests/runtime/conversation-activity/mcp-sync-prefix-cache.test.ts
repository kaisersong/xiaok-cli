import { expect, it, vi } from 'vitest';
import { withRealLateFixture, resultOf } from './r282-public-lateevent-fixture.js';

// Fault only a real instance's method lookup. Ordinary calls after restoration
// use the untouched production prototype and original receiver. No SDK fake.
function ownMethodGetter(target: object, key: string, get: () => unknown): () => void {
  const previous = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, get });
  return () => {
    if (previous) Object.defineProperty(target, key, previous);
    else if (!Reflect.deleteProperty(target, key)) throw Error('own_method_restore_failed');
  };
}

it('R294 observe: synchronous pre-await method getter rejection keeps the exact reason and does not cache a settled read; the real public event retries', async () => {
  await withRealLateFixture(async f => {
    const initial = await f.stats(), error = new Error('own synchronous canReadSource lookup');
    const original = f.service.canReadSource; let lookups = 0;
    const restore = ownMethodGetter(f.service, 'canReadSource', () => { lookups++; if (lookups === 1) throw error; return original; });
    try {
      const raw = f.observer.event(f.reference, f.event);
      if (!raw) throw Error('actual_async_event_required'); f.own(raw);
      const rejected = await resultOf(raw);
      expect(rejected.status).toBe('rejected');
      if (rejected.status !== 'rejected') throw Error('sync_prefix_rejection_missing');
      expect(rejected.reason).toBe(error); expect(lookups).toBe(1);
      expect((await f.stats()).gets).toBe(initial.gets);
    } finally { restore(); }
    // Same actual SDK execution/reference and same live owner, not a new actor.
    await f.observer.event(f.reference, f.event);
    expect((await f.stats()).gets).toBe(initial.gets + 1);
    expect(f.callbackErrors.filter(value => value === error)).toHaveLength(0);
  });
}, 30000);

it('R294 observe: synchronous lookup reenters close before raw publication; close retains the original reason, not a TDZ substitute', async () => {
  await withRealLateFixture(async f => {
    const initial = await f.stats(), error = new Error('own reentrant synchronous read lookup');
    const original = f.service.canReadSource; let lookups = 0, closing: Promise<void> | undefined;
    const restore = ownMethodGetter(f.service, 'canReadSource', () => {
      lookups++;
      if (lookups === 1) { closing = f.activities.close(); f.own(closing); throw error; }
      return original;
    });
    try {
      const raw = f.observer.event(f.reference, f.event);
      if (!raw) throw Error('actual_async_event_required'); f.own(raw);
      const rejected = await resultOf(raw);
      expect(rejected.status).toBe('rejected');
      if (rejected.status !== 'rejected') throw Error('sync_prefix_rejection_missing');
      expect(rejected.reason).toBe(error);
    } finally { restore(); }
    if (!closing) throw Error('actual_reentrant_close_missing');
    const closed = await resultOf(closing);
    expect(closed.status).toBe('rejected');
    if (closed.status !== 'rejected' || !(closed.reason instanceof AggregateError)) throw Error('actual_close_aggregate_missing');
    expect(closed.reason.errors).toHaveLength(1); expect(closed.reason.errors[0]).toBe(error);
    expect(f.activities.close()).toBe(closing); f.expectCloseError(closed.reason);
    expect((await f.stats()).gets).toBe(initial.gets); expect(lookups).toBe(1);
  });
}, 30000);

it('R294 restore: real drive synchronous prefix rejects through the public register path, is observed once, and a later same-connection register retries', async () => {
  await withRealLateFixture(async f => {
    const initial = await f.stats(), error = new Error('own synchronous getMcpReference lookup');
    const original = f.store.getMcpReference; let lookups = 0;
    const restore = ownMethodGetter(f.store, 'getMcpReference', () => { lookups++; if (lookups === 1) throw error; return original; });
    try {
      f.activities.register(f.connection);
      await vi.waitFor(() => expect(f.callbackErrors).toContain(error), { timeout: 5000 });
      expect(lookups).toBe(1); expect((await f.stats()).gets).toBe(initial.gets);
    } finally { restore(); }
    f.activities.register(f.connection);
    // Actual drive may also subscribe/refresh; do not invent an exactly-one
    // snapshot policy for that existing multi-step production path.
    await vi.waitFor(async () => expect((await f.stats()).gets).toBeGreaterThan(initial.gets), { timeout: 5000 });
    expect(f.callbackErrors.filter(value => value === error)).toHaveLength(1);
  });
}, 30000);

it('R294 restore: real drive prefix synchronously reenters close and its exact rejection remains owned by that memoized close', async () => {
  await withRealLateFixture(async f => {
    const initial = await f.stats(), error = new Error('own reentrant synchronous restore lookup');
    const original = f.store.getMcpReference; let lookups = 0, closing: Promise<void> | undefined;
    const restore = ownMethodGetter(f.store, 'getMcpReference', () => {
      lookups++;
      if (lookups === 1) { closing = f.activities.close(); f.own(closing); throw error; }
      return original;
    });
    try { f.activities.register(f.connection); }
    finally { restore(); }
    if (!closing) throw Error('actual_reentrant_restore_close_missing');
    const closed = await resultOf(closing);
    expect(closed.status).toBe('rejected');
    if (closed.status !== 'rejected' || !(closed.reason instanceof AggregateError)) throw Error('actual_restore_close_aggregate_missing');
    expect(closed.reason.errors).toHaveLength(1); expect(closed.reason.errors[0]).toBe(error);
    expect(f.activities.close()).toBe(closing); f.expectCloseError(closed.reason);
    await vi.waitFor(() => expect(f.callbackErrors).toContain(error), { timeout: 5000 });
    expect((await f.stats()).gets).toBe(initial.gets); expect(lookups).toBe(1);
  });
}, 30000);
