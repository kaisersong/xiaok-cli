import { afterEach, describe, expect, it, vi } from 'vitest';
import { MultiAgentCoordinator } from '../../../src/ai/agents/multi-agent-coordinator.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';

describe('Desktop explicitly unbounded runtime lifetime', () => {
  afterEach(() => vi.useRealTimers());
  it('does not expire default group ownership after thirty minutes', async () => {
    vi.useFakeTimers();
    const coordinator = new DesktopExecutionCoordinator();
    const root = await coordinator.acquireLease({ groupId: 'long', policy: 'multiAgent' });
    expect(root.deadlineAt).toBeUndefined();
    await vi.advanceTimersByTimeAsync(31 * 60_000);
    const child = root.retain();
    expect(coordinator.snapshot().active).toBe(1);
    child.release(); root.release();
    expect(coordinator.snapshot().active).toBe(0);
  });
  it('keeps explicit group deadlines enforceable', async () => {
    vi.useFakeTimers();
    const coordinator = new DesktopExecutionCoordinator({ multiAgentLeaseMs: 100 });
    const root = await coordinator.acquireLease({ groupId: 'short', policy: 'multiAgent' });
    await vi.advanceTimersByTimeAsync(101);
    expect(() => root.retain()).toThrow('expired');
    root.release();
  });
  it('keeps a child alive beyond the old idle and total limits, then honors cancel', async () => {
    vi.useFakeTimers();
    const coordinator = new MultiAgentCoordinator({ idleTimeoutMs: 0, turnTimeoutMs: 0 });
    const caller = { requestSource: 'agent' as const, callerId: 'main' };
    let signal!: AbortSignal;
    const child = await coordinator.spawn({ ...caller, taskName: 'long', message: 'work', createSession: async () => ({
      run: async (_message, abort) => { signal = abort!; return new Promise<string>((_resolve, reject) => abort!.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })); },
      dispose: async () => {},
    }) });
    await vi.advanceTimersByTimeAsync(31 * 60_000);
    expect(signal.aborted).toBe(false);
    expect(coordinator.listAgents(caller).find(a => a.id === child.id)?.status).toBe('running');
    const disposing = coordinator.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    await disposing;
    expect(signal.aborted).toBe(true);
  });
});
