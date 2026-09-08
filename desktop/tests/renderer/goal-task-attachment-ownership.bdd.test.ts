import { describe, expect, it, vi } from 'vitest';
import { attachPreparedGoalTask } from '../../renderer/src/lib/goal-task-attachment.js';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Frozen R1's new input fields are declared only to pass them to the actual
// helper before production implements them. This does not replace the helper,
// assert a future return type, or implement any ChatShell/source state logic.
type R1Input = Parameters<typeof attachPreparedGoalTask>[0] & {
  isCandidateCurrent: () => boolean;
  onSubscribed: (unsubscribe: () => void) => void;
};

function fixture() {
  const unsubscribe = vi.fn();
  const updateThreadTaskId = vi.fn(async () => {});
  const subscribeTask = vi.fn((_taskId: string, _handler: (event: unknown) => void) => unsubscribe);
  const ackGoalTaskAttached = vi.fn(async (_input: { threadId: string; attachmentId: string }) => {});
  const onSubscribed = vi.fn((_release: () => void) => {});
  const input: R1Input = {
    prepared: { threadId: 'thread-A', taskId: 'goal-task-B', attachmentId: 'attachment-B' },
    currentThreadId: 'thread-A', isCurrent: () => true, isCandidateCurrent: () => true,
    updateThreadTaskId, subscribeTask, onEvent: vi.fn(), ackGoalTaskAttached, onSubscribed,
  };
  return { input, unsubscribe, updateThreadTaskId, subscribeTask, ackGoalTaskAttached, onSubscribed };
}

describe('W2 R1 real Goal attachment helper ownership (not ChatShell/IPC E2E)', () => {
  it('H1 / U1 existing control: rejected real update Promise does not subscribe, transfer, or ACK', async () => {
    const f = fixture(); const write = deferred(); const error = new Error('test-owned IDB rejection');
    f.updateThreadTaskId.mockImplementation(() => write.promise);
    const result = attachPreparedGoalTask(f.input);
    const failure = expect(result).rejects.toBe(error);
    expect(f.subscribeTask).not.toHaveBeenCalled(); expect(f.onSubscribed).not.toHaveBeenCalled();
    write.reject(error); await failure;
    expect(f.ackGoalTaskAttached).not.toHaveBeenCalled(); expect(f.unsubscribe).not.toHaveBeenCalled();
  });

  it('H2 / U2 existing control: synchronous subscription failure does not ACK or pretend ownership transferred', async () => {
    const f = fixture(); const error = new Error('test-owned renderer subscription installation failure');
    f.subscribeTask.mockImplementation(() => { throw error; });
    await expect(attachPreparedGoalTask(f.input)).rejects.toBe(error);
    expect(f.updateThreadTaskId).toHaveBeenCalledExactlyOnceWith('thread-A', 'goal-task-B');
    expect(f.onSubscribed).not.toHaveBeenCalled(); expect(f.ackGoalTaskAttached).not.toHaveBeenCalled();
    expect(f.unsubscribe).not.toHaveBeenCalled();
  });

  it('H3 / U3 transfers the exact release after subscribe and before ACK, returning only a confirmed outcome', async () => {
    const f = fixture(); const order: string[] = [];
    f.updateThreadTaskId.mockImplementation(async () => { order.push('update'); });
    f.subscribeTask.mockImplementation(() => { order.push('subscribe'); return f.unsubscribe; });
    f.onSubscribed.mockImplementation(() => { order.push('transfer'); });
    f.ackGoalTaskAttached.mockImplementation(async () => { order.push('ack'); });
    const result = await attachPreparedGoalTask(f.input);
    expect.soft(order).toEqual(['update', 'subscribe', 'transfer', 'ack']);
    expect.soft(f.onSubscribed).toHaveBeenCalledExactlyOnceWith(f.unsubscribe);
    expect(result).toEqual({ kind: 'confirmed' });
    expect(f.unsubscribe).not.toHaveBeenCalled();
  });

  it.each(['async', 'sync'] as const)('H4 / U4 %s ACK failure returns the original unknown error without releasing the current observer', async mode => {
    const f = fixture(); const entered = deferred(); const ack = deferred(); const error = new Error('test-owned reply failure');
    f.ackGoalTaskAttached.mockImplementation(() => {
      entered.resolve();
      if (mode === 'sync') throw error;
      return ack.promise;
    });
    // Capture both forms, so a baseline rejection is evidence rather than an
    // unhandled rejection that prevents observing release/ACK counters.
    const settled = attachPreparedGoalTask(f.input).then(value => ({ resolved: value }), reason => ({ rejected: reason }));
    await entered.promise;
    if (mode === 'async') ack.reject(error);
    const result = await settled;
    expect.soft(f.ackGoalTaskAttached).toHaveBeenCalledExactlyOnceWith({ threadId: 'thread-A', attachmentId: 'attachment-B' });
    expect.soft(f.onSubscribed).toHaveBeenCalledExactlyOnceWith(f.unsubscribe);
    expect.soft(f.unsubscribe).not.toHaveBeenCalled();
    expect(result).toEqual({ resolved: { kind: 'unknown', error } });
  });

  it('H5 / U2 a throwing ownership transfer releases the candidate and never calls ACK', async () => {
    const f = fixture(); const error = new Error('test-owned transfer rejection');
    f.onSubscribed.mockImplementation(() => { throw error; });
    const settled = await attachPreparedGoalTask(f.input).then(value => ({ resolved: value }), reason => ({ rejected: reason }));
    expect.soft(f.onSubscribed).toHaveBeenCalledExactlyOnceWith(f.unsubscribe);
    expect.soft(f.unsubscribe).toHaveBeenCalledTimes(1);
    expect.soft(f.ackGoalTaskAttached).not.toHaveBeenCalled();
    expect(settled).toEqual({ rejected: error });
  });

  it('H6 / U9 existing control: a stale route before entry performs no mutation or subscription', async () => {
    const f = fixture(); f.input.isCurrent = () => false;
    expect(await attachPreparedGoalTask(f.input)).toBeNull();
    expect(f.updateThreadTaskId).not.toHaveBeenCalled(); expect(f.subscribeTask).not.toHaveBeenCalled();
    expect(f.onSubscribed).not.toHaveBeenCalled(); expect(f.ackGoalTaskAttached).not.toHaveBeenCalled();
  });

  it('H7 / U9 existing control: route changes during the actual update await and no candidate/ACK is created', async () => {
    const f = fixture(); const write = deferred(); let current = true;
    f.input.isCurrent = () => current;
    f.updateThreadTaskId.mockImplementation(() => write.promise);
    const result = attachPreparedGoalTask(f.input);
    current = false; write.resolve();
    expect(await result).toBeNull();
    expect(f.subscribeTask).not.toHaveBeenCalled(); expect(f.onSubscribed).not.toHaveBeenCalled();
    expect(f.ackGoalTaskAttached).not.toHaveBeenCalled(); expect(f.unsubscribe).not.toHaveBeenCalled();
  });

  it('H8 / U6 a newer same-route candidate during the update await prevents obsolete subscription and ACK', async () => {
    const f = fixture(); const write = deferred(); let candidateCurrent = true;
    f.input.isCandidateCurrent = () => candidateCurrent;
    f.updateThreadTaskId.mockImplementation(() => write.promise);
    const result = attachPreparedGoalTask(f.input);
    candidateCurrent = false; write.resolve();
    const outcome = await result;
    expect.soft(f.subscribeTask).not.toHaveBeenCalled(); expect.soft(f.onSubscribed).not.toHaveBeenCalled();
    expect.soft(f.ackGoalTaskAttached).not.toHaveBeenCalled(); expect.soft(f.unsubscribe).not.toHaveBeenCalled();
    expect(outcome).toBeNull();
  });

  it.each(['resolve', 'reject'] as const)('H9 / U9 route teardown during ACK %s releases only its own observer and returns stale', async outcome => {
    const f = fixture(); const ack = deferred(); const entered = deferred(); let current = true;
    f.input.isCurrent = () => current;
    f.ackGoalTaskAttached.mockImplementation(() => { entered.resolve(); return ack.promise; });
    const settled = attachPreparedGoalTask(f.input).then(value => ({ resolved: value }), reason => ({ rejected: reason }));
    await entered.promise; current = false;
    if (outcome === 'resolve') ack.resolve(); else ack.reject(new Error('test-owned late reply rejection'));
    const result = await settled;
    expect.soft(f.onSubscribed).toHaveBeenCalledExactlyOnceWith(f.unsubscribe);
    expect.soft(f.unsubscribe).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ resolved: null });
  });

  it.each(['resolve', 'reject'] as const)('H10 / U6 candidate-only replacement during transferred ACK %s must not release still-current B', async outcome => {
    const f = fixture(); const ack = deferred(); const entered = deferred(); let candidateCurrent = true;
    const error = new Error('test-owned reply after C candidate began');
    f.input.isCandidateCurrent = () => candidateCurrent;
    f.ackGoalTaskAttached.mockImplementation(() => { entered.resolve(); return ack.promise; });
    const settled = attachPreparedGoalTask(f.input).then(value => ({ resolved: value }), reason => ({ rejected: reason }));
    await entered.promise;
    // C merely began an update. The route is still live; caller has not
    // transferred display ownership to C. No fake synchronous window is used.
    candidateCurrent = false;
    if (outcome === 'resolve') ack.resolve(); else ack.reject(error);
    const result = await settled;
    expect.soft(f.onSubscribed).toHaveBeenCalledExactlyOnceWith(f.unsubscribe);
    expect.soft(f.unsubscribe).not.toHaveBeenCalled();
    expect(result).toEqual({ resolved: outcome === 'resolve' ? { kind: 'confirmed' } : { kind: 'unknown', error } });
  });
});
