import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ObserverNativePromise, observeTrustedObserverPromise } from '../../../src/runtime/conversation-activity/observer-promise-contract.js';
import { withRealLateFixture, resultOf } from './r282-public-lateevent-fixture.js';

for (const mode of ['species', 'then', 'constructor'] as const) {
  it(`N7 ${mode}: real public observer rejects before producer, reads no ambient getter, abandons no inner rejection`, async () => {
    await withRealLateFixture(async f => {
      const prototype = Promise.prototype;
      const target = mode === 'species' ? Promise : prototype;
      const key = mode === 'species' ? Symbol.species : mode;
      const original = Object.getOwnPropertyDescriptor(target, key);
      if (!original) throw Error('standard_promise_descriptor_missing');
      const before = { ...f.counters }, statsBefore = await f.stats(), invocation = randomUUID();
      let getterReads = 0, synchronous: unknown, returned: Promise<unknown> | undefined;
      const unhandled: unknown[] = [], listener = (reason: unknown) => { unhandled.push(reason); };
      process.on('unhandledRejection', listener);
      try {
        // Plain functions/counters only: no vi.fn(async), SDK mock or forged raw.
        // No await, expect or framework call occurs while the getter is installed.
        Object.defineProperty(target, key, { configurable: true, get() {
          getterReads++;
          if (mode === 'then' && 'value' in original) return original.value;
          return Promise;
        } });
        try {
          if (mode === 'species') { const actual = f.observer.event(f.reference, f.event); if (actual) returned = actual; }
          else returned = f.activities.observer(f.callerId, invocation, f.connection);
        }
        catch (error) { synchronous = error; }
        finally { Object.defineProperty(target, key, original); }
        if (returned) {
          const settled = await resultOf(returned); expect(settled.status).toBe('rejected');
          if (settled.status !== 'rejected') throw Error('ambient pre-producer rejection missing'); synchronous = settled.reason;
        }
        expect(synchronous).toBeInstanceOf(Error);
        if (!(synchronous instanceof Error)) throw Error('boundary error missing');
        expect(synchronous.message).toBe('activity_mcp_promise_unavailable'); expect(getterReads).toBe(0);
        expect(f.counters).toEqual(before); expect(await f.stats()).toEqual(statsBefore);
        await new Promise<void>(yes => setImmediate(yes)); await new Promise<void>(yes => setImmediate(yes));
        expect(unhandled).toEqual([]);
      } finally {
        Object.defineProperty(target, key, original); process.off('unhandledRejection', listener);
      }
    });
  }, 30000);
}


it('actual production adopter owns a genuine raw Promise rejection without reading its throwing then or ambient species', async () => {
  let rejectRaw!: (reason: unknown) => void, resolveObserved!: (reason: unknown) => void;
  const raw = new ObserverNativePromise<void>((_resolve, reject) => { rejectRaw = reject; });
  const observed = new ObserverNativePromise<unknown>(resolve => { resolveObserved = resolve; });
  const error = new Error('own genuine native raw rejection'); let getterReads = 0;
  Object.defineProperty(raw, 'then', { configurable: true, get() { getterReads++; throw Error('raw then must never be read'); } });
  const descriptor = Object.getOwnPropertyDescriptor(ObserverNativePromise, Symbol.species);
  if (!descriptor) throw Error('standard_species_descriptor_missing');
  try {
    Object.defineProperty(ObserverNativePromise, Symbol.species, { configurable: true, get() { getterReads++; throw Error('species must never be read'); } });
    // Local actual native Promise contract, not a forged SDK object. This tests
    // adopter behavior only; public pipeline admission is exercised above.
    observeTrustedObserverPromise(raw, () => resolveObserved(Error('unexpected success')), reason => resolveObserved(reason));
  } finally { Object.defineProperty(ObserverNativePromise, Symbol.species, descriptor); }
  rejectRaw(error); expect(await observed).toBe(error); expect(getterReads).toBe(0);
}, 15000);
