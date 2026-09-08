import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMultiAgentCoordinator, type ManagedAgentSession } from '../../../src/ai/agents/multi-agent-coordinator.js';

const caller = { requestSource: 'agent' as const, callerId: 'main' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function untilAbort(_message: string, signal?: AbortSignal): Promise<string> {
  return new Promise((_resolve, reject) => {
    const abort = () => reject(new DOMException('cancelled', 'AbortError'));
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

describe('watchdog reclaims its own agent without explicit close', () => {
  afterEach(() => vi.useRealTimers());

  it.each(['idle', 'turn'] as const)('reclaims cooperative %s timeouts across repeated capacity cycles', async (kind) => {
    vi.useFakeTimers();
    const coordinator = createMultiAgentCoordinator({ maxResidentAgents: 2,
      idleTimeoutMs: kind === 'idle' ? 100 : 500, turnTimeoutMs: kind === 'turn' ? 100 : 500,
    });
    const deactivate = vi.fn(async () => {});
    const dispose = vi.fn(async () => {});
    for (let index = 0; index < 6; index++) {
      const child = await coordinator.spawn({ ...caller, taskName: `expired_${index}`, message: 'run',
        createSession: async () => ({ run: untilAbort, deactivate, dispose }),
      });
      await vi.advanceTimersByTimeAsync(101);
      expect(coordinator.listAgents(caller)).toContainEqual(expect.objectContaining({ id: child.id, status: 'failed',
        error: expect.stringContaining(kind === 'idle' ? 'MULTI_AGENT_IDLE_TIMEOUT' : 'MULTI_AGENT_TURN_TIMEOUT'),
        executionActive: false, resourcesReleased: true,
      }));
      expect(deactivate).toHaveBeenCalledTimes(index + 1);
      expect(dispose).toHaveBeenCalledTimes(index + 1);
      expect(() => coordinator.followupTask({ ...caller, target: child.id, message: 'must not resurrect' })).toThrow('closing');
    }
    await coordinator.dispose();
    expect(dispose).toHaveBeenCalledTimes(6);
  });

  it('deactivates immediately but holds capacity until an abort-insensitive run settles', async () => {
    vi.useFakeTimers();
    const gate = deferred<string>();
    const deactivate = vi.fn(async () => {});
    const dispose = vi.fn(async () => {});
    const coordinator = createMultiAgentCoordinator({ maxResidentAgents: 2, idleTimeoutMs: 100 });
    const child = await coordinator.spawn({ ...caller, taskName: 'stuck', message: 'run',
      createSession: async () => ({ run: () => gate.promise, deactivate, dispose }),
    });
    await vi.advanceTimersByTimeAsync(101);
    expect(deactivate).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();
    const replacement = () => coordinator.spawn({ ...caller, taskName: 'replacement', message: 'run',
      createSession: async () => ({ run: async () => 'done', dispose: async () => {} }),
    });
    await expect(replacement()).rejects.toThrow('capacity');
    gate.resolve('late result');
    await vi.advanceTimersByTimeAsync(0);
    expect(coordinator.listAgents(caller)).toContainEqual(expect.objectContaining({ id: child.id, status: 'failed', resourcesReleased: true }));
    expect(dispose).toHaveBeenCalledOnce();
    await expect(replacement()).resolves.toMatchObject({ taskName: 'replacement' });
    expect(await coordinator.closeAgent({ ...caller, target: child.id })).toMatchObject({ resourcesReleased: true, cleanupPending: false });
    expect(dispose).toHaveBeenCalledOnce();
    await coordinator.dispose();
  });

  it('automatically disposes a session created after its initialization timed out', async () => {
    vi.useFakeTimers();
    const gate = deferred<ManagedAgentSession>();
    const run = vi.fn(async () => 'must not run');
    const dispose = vi.fn(async () => {});
    const deactivate = vi.fn(async () => {});
    const coordinator = createMultiAgentCoordinator({ idleTimeoutMs: 100 });
    const child = await coordinator.spawn({ ...caller, taskName: 'pending', message: 'run', createSession: () => gate.promise });
    await vi.advanceTimersByTimeAsync(101);
    gate.resolve({ run, dispose, deactivate });
    await vi.advanceTimersByTimeAsync(0);
    expect(run).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
    expect(deactivate).toHaveBeenCalledOnce();
    expect(coordinator.listAgents(caller)).toContainEqual(expect.objectContaining({ id: child.id, status: 'failed', resourcesReleased: true }));
    await coordinator.dispose();
  });

  it('waits for a still-running descendant before disposing the timed-out parent resources', async () => {
    vi.useFakeTimers();
    const gate = deferred<string>();
    const order: string[] = [];
    const coordinator = createMultiAgentCoordinator({ maxResidentAgents: 3, idleTimeoutMs: 100, closeSettlementTimeoutMs: 5 });
    const parent = await coordinator.spawn({ ...caller, taskName: 'parent', message: 'run',
      createSession: async () => ({ run: untilAbort, dispose: async () => { order.push('parent'); } }),
    });
    await vi.advanceTimersByTimeAsync(50);
    await coordinator.spawn({ ...caller, callerId: parent.id, taskName: 'child', message: 'run',
      createSession: async () => ({ run: () => gate.promise, dispose: async () => { order.push('child'); } }),
    });
    await vi.advanceTimersByTimeAsync(101);
    expect(order).toEqual([]);
    expect(coordinator.listAgents(caller)).toContainEqual(expect.objectContaining({ id: parent.id, status: 'failed', executionActive: false, resourcesReleased: false }));
    gate.resolve('done');
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['child', 'parent']);
    expect(coordinator.listAgents(caller)).toContainEqual(expect.objectContaining({ id: parent.id, resourcesReleased: true }));
    await coordinator.dispose();
  });

  it('exposes automatic cleanup errors and does not falsely free the slot', async () => {
    vi.useFakeTimers();
    const coordinator = createMultiAgentCoordinator({ maxResidentAgents: 2, idleTimeoutMs: 100 });
    const dispose = vi.fn(async () => { throw new Error('release denied'); });
    const child = await coordinator.spawn({ ...caller, taskName: 'cleanup_failed', message: 'run',
      createSession: async () => ({ run: untilAbort, dispose }),
    });
    await vi.advanceTimersByTimeAsync(101);
    expect(coordinator.listAgents(caller)).toContainEqual(expect.objectContaining({ id: child.id, status: 'failed',
      resourcesReleased: false, cleanupError: 'release denied', error: expect.stringContaining('MULTI_AGENT_IDLE_TIMEOUT'),
    }));
    expect(dispose).toHaveBeenCalledOnce();
    await coordinator.dispose();
  });

  it('bounds shutdown of a truly never-settling run without claiming physical release', async () => {
    vi.useFakeTimers();
    const deactivate = vi.fn(async () => {});
    const dispose = vi.fn(async () => {});
    const coordinator = createMultiAgentCoordinator({ closeSettlementTimeoutMs: 5 });
    const child = await coordinator.spawn({ ...caller, taskName: 'never', message: 'run',
      createSession: async () => ({ run: () => new Promise(() => {}), deactivate, dispose }),
    });
    const closing = coordinator.closeAgent({ ...caller, target: child.id });
    await vi.advanceTimersByTimeAsync(6);
    expect(await closing).toMatchObject({ resourcesReleased: false, cleanupPending: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deactivate).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();
    expect(coordinator.listAgents(caller)).toContainEqual(expect.objectContaining({ id: child.id, executionActive: true, resourcesReleased: false }));
    const shutdown = coordinator.dispose();
    await vi.advanceTimersByTimeAsync(6);
    await shutdown;
  });

  it('keeps a truly never-settling initialization visible and does not admit a replacement', async () => {
    vi.useFakeTimers();
    const coordinator = createMultiAgentCoordinator({ maxResidentAgents: 2, closeSettlementTimeoutMs: 5 });
    let initializationSignal: AbortSignal | undefined;
    const createSession = vi.fn((_identity, signal?: AbortSignal) => {
      initializationSignal = signal;
      return new Promise<ManagedAgentSession>(() => {});
    });
    const child = await coordinator.spawn({ ...caller, taskName: 'never_initialized', message: 'run', createSession });
    const closing = coordinator.closeAgent({ ...caller, target: child.id });
    await vi.advanceTimersByTimeAsync(6);
    expect(await closing).toMatchObject({ resourcesReleased: false, cleanupPending: true });
    try {
      expect(initializationSignal?.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(coordinator.listAgents(caller)).toContainEqual(expect.objectContaining({
        id: child.id, status: 'closed', phase: 'starting', executionActive: true,
        resourcesReleased: false, runtimeResident: true,
      }));
      await expect(coordinator.spawn({ ...caller, taskName: 'replacement', message: 'must not start',
        createSession: async () => ({ run: async () => 'done', dispose: async () => {} }),
      })).rejects.toThrow('capacity');
      expect(createSession).toHaveBeenCalledOnce();
    } finally {
      const shutdown = coordinator.dispose();
      await vi.advanceTimersByTimeAsync(6);
      await shutdown;
    }
  });
});
