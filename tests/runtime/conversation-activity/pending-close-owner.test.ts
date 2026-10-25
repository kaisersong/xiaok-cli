import { expect, it } from 'vitest';
import { ownPendingClose } from '../../../src/runtime/conversation-activity/pending-close-owner.js';
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class LocalClosable {
  calls = 0;
  constructor(private readonly completion = Promise.resolve()) {}
  close(): Promise<void> { this.calls++; return this.completion; }
}
it('waits the same actual pending value and its close, including close-before-value arrival', async () => {
  const pending = deferred<LocalClosable>(), release = deferred<void>();
  const value = new LocalClosable(release.promise), owner = ownPendingClose(pending.promise);
  let done = false; const closing = owner.close(); const observed = closing.then(() => { done = true; });
  try {
    expect(owner.settled).toBe(pending.promise); expect(owner.close()).toBe(closing);
    expect(value.calls).toBe(0); expect(done).toBe(false);
    pending.resolve(value); await Promise.resolve(); await Promise.resolve();
    expect(value.calls).toBe(1); expect(done).toBe(false);
    release.resolve(); await observed; expect(value.calls).toBe(1);
  } finally { pending.resolve(value); release.resolve(); await Promise.allSettled([owner.settled, closing]); }
});
it('closes an already-created ordinary value once', async () => {
  const value = new LocalClosable(), owner = ownPendingClose(Promise.resolve(value));
  const closing = owner.close(); expect(owner.close()).toBe(closing); await closing;
  expect(value.calls).toBe(1);
});
it('preserves actual producer rejection instead of claiming drained', async () => {
  const pending = deferred<LocalClosable>(), owner = ownPendingClose(pending.promise);
  const failure = new Error('owned producer rejected');
  const observed = Promise.allSettled([owner.settled, owner.close()]);
  pending.reject(failure);
  const results = await observed;
  for (const result of results) { expect(result.status).toBe('rejected'); if (result.status === 'rejected') expect(result.reason).toBe(failure); }
});
it('preserves actual close rejection and the same rejected close Promise', async () => {
  const release = deferred<void>(), failure = new Error('owned close rejected');
  const value = new LocalClosable(release.promise), owner = ownPendingClose(Promise.resolve(value));
  const closing = owner.close(), observed = Promise.allSettled([closing]);
  release.reject(failure); const [result] = await observed;
  expect(result.status).toBe('rejected'); if (result.status === 'rejected') expect(result.reason).toBe(failure);
  expect(owner.close()).toBe(closing); expect(value.calls).toBe(1);
});
