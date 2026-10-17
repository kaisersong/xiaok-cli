import { afterEach, describe, expect, it, vi } from 'vitest';
import { recoverModelStream } from '../../../src/ai/runtime/model-stream-recovery.js';
import { ModelStreamPhysicalOwner } from '../../../src/ai/runtime/model-stream-physical-owner.js';
import type { StreamChunk } from '../../../src/types.js';

const policy = { windowMs: 500, idleMs: 30, initialDelayMs: 0, maxDelayMs: 0 };
const cleanup: Array<() => void> = [];
afterEach(() => { for (const release of cleanup.splice(0).reverse()) release(); });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 10));
async function collect(stream: AsyncIterable<StreamChunk>) {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}
function failedReader(failure: unknown) {
  const closing = deferred<IteratorResult<StreamChunk>>();
  cleanup.push(() => closing.resolve({ done: true, value: undefined }));
  const finish = vi.fn(() => closing.promise);
  return { closing, finish, iterator: {
    [Symbol.asyncIterator]() { return this; },
    next: vi.fn(() => Promise.reject(failure)),
    return: finish,
  } };
}

describe('committed main recovery and physical owner integration', () => {
  it('a rejecting owner gate preserves the transient error and never reopens a reader', async () => {
    const error = Error('terminated preparation'), gate = vi.fn(() => false), notice = vi.fn();
    let count = 0;
    const open = vi.fn(async function* () { if (++count === 1) throw error; yield { type: 'done' as const }; });
    await expect(collect(recoverModelStream({ signal: new AbortController().signal, policy,
      shouldRetry: gate, onRetry: notice, open }))).rejects.toBe(error);
    expect(open).toHaveBeenCalledOnce(); expect(gate).toHaveBeenCalledExactlyOnceWith(error);
    expect(notice).not.toHaveBeenCalled();
  });

  it('an allowing owner cannot override permanent authentication or its cause', async () => {
    const error = new Error('terminated wrapper', { cause: { status: 401 } });
    const gate = vi.fn(() => true), notice = vi.fn();
    const open = vi.fn(async function* () { throw error; });
    await expect(collect(recoverModelStream({ signal: new AbortController().signal, policy,
      shouldRetry: gate, onRetry: notice, open }))).rejects.toBe(error);
    expect(open).toHaveBeenCalledOnce(); expect(gate).not.toHaveBeenCalled(); expect(notice).not.toHaveBeenCalled();
  });

  it('awaits the original asynchronous notice before admitting the next reader', async () => {
    const entered = deferred<void>(), notice = deferred<void>(); let count = 0;
    cleanup.push(() => notice.resolve());
    const open = vi.fn(async function* () { if (++count === 1) throw Error('terminated'); yield { type: 'text' as const, delta: 'resumed' }; });
    const run = collect(recoverModelStream({ signal: new AbortController().signal, policy, open,
      onRetry: () => { entered.resolve(); return notice.promise; } }));
    try {
      await entered.promise; await tick(); expect(open).toHaveBeenCalledOnce();
    } finally { notice.resolve(); }
    await expect(run).resolves.toEqual([{ type: 'text', delta: 'resumed' }]);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('cancellation retains the actual run claim through notice settlement and the actual return afterwards', async () => {
    const owner = new ModelStreamPhysicalOwner(), claim = owner.admit(), reason = new DOMException('original cancellation A', 'AbortError');
    const reader = failedReader(Error('terminated')), entered = deferred<void>(), notice = deferred<void>();
    cleanup.push(() => notice.resolve()); let visibleSettled = false, closedSettled = false;
    const open = vi.fn(() => reader.iterator);
    const run = (async () => {
      try { return await collect(recoverModelStream({ signal: owner.signal, physicalRun: claim, policy, open,
        onRetry: () => { entered.resolve(); return notice.promise; } })); }
      finally { claim.finish(); }
    })().then(value => { visibleSettled = true; return value; }, error => { visibleSettled = true; return error; });
    await entered.promise; owner.stop(reason);
    const closed = owner.waitForStopped().then(() => { closedSettled = true; });
    try {
      await tick(); expect(visibleSettled).toBe(false); expect(closedSettled).toBe(false); expect(owner.hasPending()).toBe(true);
      expect(reader.finish).not.toHaveBeenCalled();
    } finally { notice.resolve(); }
    expect(await run).toBe(reason); expect(open).toHaveBeenCalledOnce(); expect(reader.finish).toHaveBeenCalledOnce();
    await tick(); expect(closedSettled).toBe(false);
    reader.closing.resolve({ done: true, value: undefined }); await closed; expect(owner.hasPending()).toBe(false);
  });

  it('notice rejection remains the visible error while the original iterator return is still held', async () => {
    const owner = new ModelStreamPhysicalOwner(), claim = owner.admit(), reader = failedReader(Error('terminated'));
    const entered = deferred<void>(), notice = deferred<void>(), failure = Error('recovery status persistence rejected');
    cleanup.push(() => notice.resolve()); let count = 0;
    const run = (async () => {
      try { return await collect(recoverModelStream({ signal: owner.signal, physicalRun: claim, policy,
        open: () => ++count === 1 ? reader.iterator : (async function* () { yield { type: 'done' as const }; })(),
        onRetry: () => { entered.resolve(); return notice.promise; } })); }
      finally { claim.finish(); }
    })().catch(error => error);
    await entered.promise; notice.reject(failure);
    expect(await run).toBe(failure); expect(count).toBe(1); expect(reader.finish).toHaveBeenCalledOnce();
    owner.stop(); let settled = false; const closed = owner.waitForStopped().then(() => { settled = true; });
    await tick(); expect(settled).toBe(false); reader.closing.resolve({ done: true, value: undefined }); await closed;
  });

  it('gate rejection cannot discard a late original return failure', async () => {
    const owner = new ModelStreamPhysicalOwner(), claim = owner.admit(), error = Error('terminated'), late = Error('late physical return B');
    const reader = failedReader(error); let count = 0;
    const run = (async () => {
      try { await collect(recoverModelStream({ signal: owner.signal, physicalRun: claim, policy, shouldRetry: () => false,
        open: () => ++count === 1 ? reader.iterator : (async function* () { yield { type: 'done' as const }; })() })); }
      finally { claim.finish(); }
    })().catch(failure => failure);
    expect(await run).toBe(error); expect(count).toBe(1); owner.stop();
    const closed = owner.waitForStopped().catch(failure => failure); reader.closing.reject(late);
    const failure = await closed; expect(failure).toBeInstanceOf(AggregateError); expect(failure.errors).toEqual([late]);
  });
});
