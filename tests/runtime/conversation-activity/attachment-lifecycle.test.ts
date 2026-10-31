import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ownAttachmentLifecycle, type AttachmentClosable } from '../../../src/runtime/conversation-activity/attachment-lifecycle.js';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function observe<T>(promise: Promise<T>) {
  const fulfilled: T[] = [], rejected: unknown[] = [];
  const done = promise.then(value => { fulfilled.push(value); }, error => { rejected.push(error); });
  return { fulfilled, rejected, done };
}
// A real normally constructed LOCAL resource implementing only the production
// lifecycle contract. This is not a Cli/SDK/daemon/native/authority instance.
class LocalClosable implements AttachmentClosable {
  closeCalls = 0;
  constructor(private readonly completion: Promise<void> = Promise.resolve()) {}
  close(): Promise<void> { this.closeCalls++; return this.completion; }
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('H1: undefined is an actual settled result and repeat close has one completion', async () => {
  const pending = Promise.resolve<LocalClosable | undefined>(undefined);
  const owner = ownAttachmentLifecycle(pending, { waitMs: 2000 });
  expect(owner.settled).toBe(pending);
  expect(await owner.initial).toBeUndefined();
  expect(await owner.settled).toBeUndefined();
  const closing = owner.close(); expect(owner.close()).toBe(closing);
  await closing; expect(vi.getTimerCount()).toBe(0);
});

it.each([false, true])('H2: exact pending rejection propagates, deferred=%s', async delayed => {
  const pending = deferred<LocalClosable | undefined>();
  const owner = ownAttachmentLifecycle(pending.promise, { waitMs: 2000 });
  const initial = observe(owner.initial), settled = observe(owner.settled);
  const closing = owner.close(), close = observe(closing);
  const failure = new Error('local attachment rejected');
  try {
    if (delayed) {
      await vi.advanceTimersByTimeAsync(2000);
      expect(initial.fulfilled).toEqual([undefined]); expect(close.fulfilled).toEqual([]);
    }
    pending.reject(failure);
    await Promise.all([initial.done, settled.done, close.done]);
    expect(settled.rejected).toEqual([failure]); expect(close.rejected).toEqual([failure]);
    expect(close.fulfilled).toEqual([]); expect(owner.close()).toBe(closing);
    if (!delayed) expect(initial.rejected).toEqual([failure]);
  } finally {
    pending.reject(failure);
    await Promise.allSettled([owner.initial, owner.settled, closing]);
  }
});

it('H3: immediate actual local instance closes once and completion waits its real close Promise', async () => {
  const completion = deferred<void>(); const instance = new LocalClosable(completion.promise);
  const pending = Promise.resolve<LocalClosable | undefined>(instance);
  const owner = ownAttachmentLifecycle(pending, { waitMs: 2000 });
  try {
    expect(await owner.initial).toBe(instance); expect(await owner.settled).toBe(instance);
    const closing = owner.close(), observed = observe(closing);
    expect(owner.close()).toBe(closing);
    await vi.advanceTimersByTimeAsync(0);
    expect(instance.closeCalls).toBe(1); expect(observed.fulfilled).toEqual([]);
    completion.resolve(); await closing; expect(observed.rejected).toEqual([]);
    expect(instance.closeCalls).toBe(1);
  } finally { completion.resolve(); await Promise.allSettled([owner.initial, owner.settled, owner.close()]); }
});

it('H4: cleanup after timeout BEFORE instance arrival cannot report drained from an empty late queue', async () => {
  const pending = deferred<LocalClosable | undefined>(), completion = deferred<void>();
  const instance = new LocalClosable(completion.promise);
  const owner = ownAttachmentLifecycle(pending.promise, { waitMs: 2000 });
  try {
    await vi.advanceTimersByTimeAsync(2000); expect(await owner.initial).toBeUndefined();
    const closing = owner.close(), observed = observe(closing);
    expect(owner.close()).toBe(closing); expect(owner.settled).toBe(pending.promise);
    await vi.advanceTimersByTimeAsync(0);
    expect(instance.closeCalls).toBe(0); expect(observed.fulfilled).toEqual([]);
    pending.resolve(instance); await vi.advanceTimersByTimeAsync(0);
    expect(await owner.settled).toBe(instance); expect(instance.closeCalls).toBe(1);
    expect(observed.fulfilled).toEqual([]); expect(observed.rejected).toEqual([]);
    completion.resolve(); await closing; expect(instance.closeCalls).toBe(1);
  } finally {
    pending.resolve(instance); completion.resolve();
    await Promise.allSettled([owner.initial, owner.settled, owner.close()]);
  }
});

it('H5: normal late arrival retains the same pending/instance and has one close', async () => {
  const pending = deferred<LocalClosable | undefined>(); const instance = new LocalClosable();
  const owner = ownAttachmentLifecycle(pending.promise, { waitMs: 2000 });
  try {
    await vi.advanceTimersByTimeAsync(2000); expect(await owner.initial).toBeUndefined();
    pending.resolve(instance); expect(await owner.settled).toBe(instance);
    expect(owner.settled).toBe(pending.promise); expect(instance.closeCalls).toBe(0);
    const closing = owner.close(); expect(owner.close()).toBe(closing); await closing;
    expect(instance.closeCalls).toBe(1);
  } finally { pending.resolve(instance); await Promise.allSettled([owner.initial, owner.settled, owner.close()]); }
});

it('H6: actual local close rejection remains rejected, never a drained success', async () => {
  const completion = deferred<void>(); const instance = new LocalClosable(completion.promise);
  const owner = ownAttachmentLifecycle(Promise.resolve(instance), { waitMs: 2000 });
  const failure = new Error('local close rejected');
  try {
    expect(await owner.initial).toBe(instance);
    const closing = owner.close(), observed = observe(closing);
    completion.reject(failure); await observed.done;
    expect(observed.rejected).toEqual([failure]); expect(observed.fulfilled).toEqual([]);
    expect(owner.close()).toBe(closing); expect(instance.closeCalls).toBe(1);
  } finally { completion.reject(failure); await Promise.allSettled([owner.initial, owner.settled, owner.close()]); }
});

it('H7: unresolved attach remains unresolved past an observed deadline; test releases its own gate', async () => {
  const pending = deferred<LocalClosable | undefined>(); const instance = new LocalClosable();
  let deferredCalls = 0;
  const owner = ownAttachmentLifecycle(pending.promise, { waitMs: 2000, onDeferred() { deferredCalls++; } });
  const closing = owner.close(), observed = observe(closing);
  try {
    await vi.advanceTimersByTimeAsync(5000);
    expect(await owner.initial).toBeUndefined(); expect(deferredCalls).toBe(1);
    expect(observed.fulfilled).toEqual([]); expect(observed.rejected).toEqual([]);
    expect(instance.closeCalls).toBe(0);
  } finally {
    pending.resolve(instance); await Promise.allSettled([owner.initial, owner.settled, closing]);
  }
  expect(instance.closeCalls).toBe(1);
});

it('H4/H7: closing before startup resolution suppresses initial delivery but still closes the late resource', async () => {
  const pending = deferred<LocalClosable | undefined>(), completion = deferred<void>();
  const instance = new LocalClosable(completion.promise);
  const owner = ownAttachmentLifecycle(pending.promise, { waitMs: 2000 });
  const closing = owner.close(), observed = observe(closing);
  try {
    pending.resolve(instance); expect(await owner.initial).toBeUndefined();
    await vi.advanceTimersByTimeAsync(0); expect(instance.closeCalls).toBe(1);
    expect(observed.fulfilled).toEqual([]); completion.resolve(); await closing;
  } finally { pending.resolve(instance); completion.resolve(); await Promise.allSettled([owner.initial, owner.settled, closing]); }
});

it('H7: a deferred-notice error rejects initial without abandoning the actual pending close', async () => {
  const pending = deferred<LocalClosable | undefined>(); const instance = new LocalClosable();
  const failure = new Error('notice rejected');
  const owner = ownAttachmentLifecycle(pending.promise, { waitMs: 2000, onDeferred() { throw failure; } });
  const initial = observe(owner.initial), closing = owner.close(), observed = observe(closing);
  try {
    await vi.advanceTimersByTimeAsync(2000);
    expect(initial.rejected).toEqual([failure]); expect(observed.fulfilled).toEqual([]);
    pending.resolve(instance); await closing; expect(instance.closeCalls).toBe(1);
    expect(observed.rejected).toEqual([]);
  } finally { pending.resolve(instance); await Promise.allSettled([owner.initial, owner.settled, closing]); }
});
