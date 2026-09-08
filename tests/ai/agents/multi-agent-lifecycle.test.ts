import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMultiAgentCoordinator, type ManagedAgentSession } from '../../../src/ai/agents/multi-agent-coordinator.js';

const caller = { requestSource: 'agent' as const, callerId: 'main' };
const tick = () => new Promise(setImmediate);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('multi-agent lifecycle audit regressions', () => {
  afterEach(() => vi.useRealTimers());

  it('returns pending physical cleanup, then reports real release on repeated close', async () => {
    const gate = deferred<string>();
    const dispose = vi.fn(async () => {});
    const coordinator = createMultiAgentCoordinator({ closeSettlementTimeoutMs: 5 });
    const child = await coordinator.spawn({ ...caller, taskName: 'stuck', message: 'start',
      createSession: async () => ({ run: () => gate.promise, dispose }),
    });
    await tick();
    const close = await coordinator.closeAgent({ ...caller, target: child.id });
    expect(close).toMatchObject({ closed: true, resourcesReleased: false, cleanupPending: true });
    expect(dispose).not.toHaveBeenCalled();
    gate.resolve('late result');
    await tick();
    expect(await coordinator.closeAgent({ ...caller, target: child.id }))
      .toMatchObject({ resourcesReleased: true, cleanupPending: false });
    expect(dispose).toHaveBeenCalledOnce();
    await coordinator.dispose();
  });

  it('publishes late cleanup failure and aggregates a failed descendant', async () => {
    const gate = deferred<string>();
    const events: unknown[] = [];
    const coordinator = createMultiAgentCoordinator({ closeSettlementTimeoutMs: 5, onEvent: (event) => events.push(event) });
    const parent = await coordinator.spawn({ ...caller, taskName: 'parent', message: 'start',
      createSession: async () => ({ run: async () => 'done', dispose: async () => {} }),
    });
    const child = await coordinator.spawn({ ...caller, callerId: parent.id, taskName: 'child', message: 'start',
      createSession: async () => ({ run: () => gate.promise, dispose: async () => { throw new Error('worktree locked'); } }),
    });
    await tick();
    expect(await coordinator.closeAgent({ ...caller, target: parent.id })).toMatchObject({ resourcesReleased: false, cleanupPending: true });
    gate.resolve('done');
    await tick();
    const result = await coordinator.closeAgent({ ...caller, target: parent.id });
    expect(result).toMatchObject({ resourcesReleased: false, cleanupPending: false,
      agents: expect.arrayContaining([expect.objectContaining({ id: child.id, cleanupError: expect.stringContaining('worktree locked') })]),
    });
    expect(events).toContainEqual(expect.objectContaining({ agent: expect.objectContaining({ id: child.id, cleanupError: expect.stringContaining('worktree locked') }) }));
    await coordinator.dispose();
  });

  it('still attempts dispose when deactivate throws synchronously', async () => {
    const dispose = vi.fn(async () => {});
    const coordinator = createMultiAgentCoordinator();
    const child = await coordinator.spawn({ ...caller, taskName: 'broken', message: 'start',
      createSession: async () => ({ run: async () => 'done', deactivate: () => { throw new Error('detach failed'); }, dispose }),
    });
    await tick();
    expect(await coordinator.closeAgent({ ...caller, target: child.id })).toMatchObject({ resourcesReleased: false,
      agents: [expect.objectContaining({ cleanupError: expect.stringContaining('detach failed') })],
    });
    expect(dispose).toHaveBeenCalledOnce();
    await coordinator.dispose();
  });

  it('interrupts pending creation, discards queued work and permits only a fresh settled followup', async () => {
    const creation = deferred<ManagedAgentSession>();
    const run = vi.fn(async (message: string) => message);
    const coordinator = createMultiAgentCoordinator();
    const child = await coordinator.spawn({ ...caller, taskName: 'pending', message: 'original', createSession: () => creation.promise });
    coordinator.followupTask({ ...caller, target: child.id, message: 'discard me' });
    expect(coordinator.interruptAgent({ ...caller, target: child.id })).toEqual({ interrupted: true });
    expect(() => coordinator.followupTask({ ...caller, target: child.id, message: 'too early' })).toThrow('settling');
    creation.resolve({ run, dispose: async () => {} });
    await tick();
    expect(run).not.toHaveBeenCalled();
    coordinator.followupTask({ ...caller, target: child.id, message: 'fresh' });
    await tick();
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0][0]).toBe('fresh');
    await coordinator.dispose();
  });

  it('propagates running interrupt and discards earlier queued followups', async () => {
    let signal!: AbortSignal;
    const gate = deferred<string>();
    const run = vi.fn(async (_message: string, value?: AbortSignal) => { signal = value!; return gate.promise; });
    const coordinator = createMultiAgentCoordinator();
    const child = await coordinator.spawn({ ...caller, taskName: 'running', message: 'first',
      createSession: async () => ({ run, dispose: async () => {} }),
    });
    await tick();
    coordinator.followupTask({ ...caller, target: child.id, message: 'old followup' });
    expect(coordinator.interruptAgent({ ...caller, target: child.id })).toEqual({ interrupted: true });
    expect(signal.aborted).toBe(true);
    expect(() => coordinator.followupTask({ ...caller, target: child.id, message: 'early' })).toThrow('settling');
    gate.resolve('late');
    await tick();
    expect(run).toHaveBeenCalledOnce();
    expect(coordinator.listAgents(caller)).toContainEqual(expect.objectContaining({ id: child.id, status: 'interrupted', executionActive: false }));
    await coordinator.dispose();
  });

  it.each(['completed', 'failed', 'interrupted'] as const)('does not mutate an idle %s task when interrupt returns false', async (status) => {
    const coordinator = createMultiAgentCoordinator();
    const child = await coordinator.spawn({ ...caller, taskName: 'idle', message: 'first',
      createSession: async () => ({ run: async () => {
        if (status === 'failed') throw new Error('failed');
        if (status === 'interrupted') throw new DOMException('aborted', 'AbortError');
        return 'done';
      }, dispose: async () => {} }),
    });
    await tick();
    const before = coordinator.listAgents(caller);
    expect(coordinator.interruptAgent({ ...caller, target: child.id })).toEqual({ interrupted: false });
    expect(coordinator.listAgents(caller)).toEqual(before);
    await coordinator.dispose();
  });

  it('keeps completed sessions reusable at capacity and recovers slots across repeated closes', async () => {
    const coordinator = createMultiAgentCoordinator({ maxResidentAgents: 4 });
    const dispose = vi.fn(async () => {});
    const spawn = (taskName: string) => coordinator.spawn({ ...caller, taskName, message: taskName,
      createSession: async () => ({ run: async (message) => message, dispose }),
    });
    const children = await Promise.all(['one', 'two', 'three'].map(spawn));
    await tick();
    await expect(spawn('full')).rejects.toThrow('close_agent');
    expect(dispose).not.toHaveBeenCalled();
    coordinator.followupTask({ ...caller, target: children[0].id, message: 'reused at capacity' });
    await tick();
    for (const child of children) {
      expect(await coordinator.closeAgent({ ...caller, target: child.id })).toMatchObject({ resourcesReleased: true });
    }
    for (let index = 0; index < 8; index++) {
      const child = await spawn(`replacement_${index}`);
      await tick();
      await coordinator.closeAgent({ ...caller, target: child.id });
    }
    expect(dispose).toHaveBeenCalledTimes(11);
    await coordinator.dispose();
  });

  it('returns timedOut for a live target and rejects empty, root, closed and closing mutations', async () => {
    vi.useFakeTimers();
    const gate = deferred<string>();
    const coordinator = createMultiAgentCoordinator({ closeSettlementTimeoutMs: 5 });
    const parent = await coordinator.spawn({ ...caller, taskName: 'parent', message: 'first',
      createSession: async () => ({ run: async () => 'done', dispose: async () => {} }),
    });
    const child = await coordinator.spawn({ ...caller, callerId: parent.id, taskName: 'child', message: 'first',
      createSession: async () => ({ run: () => gate.promise, dispose: async () => {} }),
    });
    const waiting = coordinator.waitForUpdate({ ...caller, targets: [child.id], timeoutMs: 5 });
    await vi.advanceTimersByTimeAsync(6);
    expect(await waiting).toMatchObject({ timedOut: true });
    await expect(coordinator.waitForUpdate({ ...caller, targets: [], timeoutMs: 5 })).rejects.toThrow('non-empty');
    expect(() => coordinator.followupTask({ ...caller, target: 'main', message: 'no' })).toThrow('root');
    const closing = coordinator.closeAgent({ ...caller, target: parent.id });
    for (const method of ['sendMessage', 'followupTask'] as const) {
      expect(() => coordinator[method]({ ...caller, target: parent.id, message: 'no' })).toThrow('closing');
      expect(() => coordinator[method]({ ...caller, target: child.id, message: 'no' })).toThrow(/closed|closing/);
    }
    gate.resolve('done');
    await closing;
    for (const method of ['sendMessage', 'followupTask'] as const) {
      expect(() => coordinator[method]({ ...caller, target: parent.id, message: 'no' })).toThrow('closed');
    }
    await coordinator.dispose();
  });
});
