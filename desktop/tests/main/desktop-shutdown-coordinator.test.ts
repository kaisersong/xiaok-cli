import { describe, expect, it, vi } from 'vitest';
import {
  DesktopShutdownCoordinator,
  type IngressOwner,
  type ProtectedDrainHandle,
  type ShutdownDeps,
} from '../../electron/desktop-shutdown-coordinator.js';
import { DesktopShutdownGate } from '../../electron/shutdown-aware-ipc-main.js';

function ingress(name: string, opts: { drained?: boolean } = {}): IngressOwner & { events: string[] } {
  const events: string[] = [];
  return {
    name,
    events,
    stopAccepting() { events.push('stopAccepting'); },
    abortAllActive(reason: string) { events.push(`abort:${reason}`); },
    async drain() { events.push('drain'); return opts.drained ?? true; },
  };
}

function drainHandle(
  leases: Array<{ leaseId: string; generationId: string; remainingMs: number }>,
  settled: boolean | (() => Promise<boolean>) = true,
): ProtectedDrainHandle {
  return {
    leases,
    waitForSettled: typeof settled === 'function' ? settled : async () => settled,
  };
}

function deps(overrides: Partial<ShutdownDeps> = {}): {
  deps: ShutdownDeps;
  gate: DesktopShutdownGate;
  order: string[];
} {
  const order: string[] = [];
  const gate = overrides.gate ?? new DesktopShutdownGate();
  const base: ShutdownDeps = {
    gate,
    providerRuntime: {
      beginShutdown: () => { order.push('beginShutdown'); return drainHandle([]); },
      hideAndAbortNonProtected: () => { order.push('hideAndAbort'); },
      closeOrdinaryProviders: async () => { order.push('closeOrdinary'); return { cleanupFailed: [] }; },
    },
    ingressOwners: [],
    durableStores: [{ name: 'sqlite', close: async () => { order.push('closeStore'); } }],
    destroyWindows: () => { order.push('destroyWindows'); },
    disposeLifetimeResources: async () => { order.push('disposeLifetime'); },
    releaseMainSourcePin: async () => { order.push('releasePin'); },
    continuation: () => { order.push('continuation'); },
    ...overrides,
  };
  return { deps: base, gate, order };
}

describe('DesktopShutdownCoordinator phase order (design §5.5)', () => {
  it('closes the gate and freezes the protected set before any await', () => {
    const { deps: d, gate, order } = deps();
    const coordinator = new DesktopShutdownCoordinator(d);

    const { preventDefault } = coordinator.onBeforeQuit();

    expect(preventDefault).toBe(true);
    expect(coordinator.isQuitting).toBe(true);
    expect(gate.isOpen).toBe(false);
    // Both synchronous phases completed before the async tail started.
    expect(order.slice(0, 2)).toEqual(['beginShutdown', 'destroyWindows']);
  });

  it('runs the frozen seven-phase order to a single continuation', async () => {
    const owner = ingress('scheduler');
    const { deps: d, order } = deps({ ingressOwners: [owner] });
    const coordinator = new DesktopShutdownCoordinator(d);

    const report = await coordinator.onBeforeQuit().shutdown;

    expect(order).toEqual([
      'beginShutdown', 'destroyWindows', 'hideAndAbort', 'closeOrdinary',
      'closeStore', 'releasePin', 'disposeLifetime', 'continuation',
    ]);
    expect(owner.events).toEqual(['stopAccepting', 'abort:app_shutdown', 'drain']);
    expect(report.storesClosed).toBe(true);
    expect(coordinator.shutdownComplete).toBe(true);
  });

  it('aborts providers without waiting for ingress drain to settle', async () => {
    const slowOwner: IngressOwner = {
      name: 'kswarm',
      stopAccepting() {},
      abortAllActive() {},
      drain: async () => { await new Promise((r) => setTimeout(r, 30)); return true; },
    };
    const seen: string[] = [];
    const { deps: d } = deps({
      ingressOwners: [slowOwner],
      providerRuntime: {
        beginShutdown: () => drainHandle([]),
        hideAndAbortNonProtected: () => { seen.push('hideAndAbort'); },
        closeOrdinaryProviders: async () => { seen.push('closeOrdinary'); return { cleanupFailed: [] }; },
      },
    });
    const coordinator = new DesktopShutdownCoordinator(d);

    const shutdown = coordinator.onBeforeQuit().shutdown;
    // Provider abort already happened while the ingress drain is still pending.
    await Promise.resolve();
    expect(seen).toContain('hideAndAbort');

    await shutdown;
  });

  it('is idempotent: repeated before-quit shares one shutdown and one continuation', async () => {
    const { deps: d, order } = deps();
    const coordinator = new DesktopShutdownCoordinator(d);

    const first = coordinator.onBeforeQuit();
    const second = coordinator.onBeforeQuit();
    expect(second.preventDefault).toBe(true);
    expect(second.shutdown).toBe(first.shutdown);
    await first.shutdown;

    // After completion a further event is allowed through instead of prevented.
    const third = coordinator.onBeforeQuit();
    expect(third.preventDefault).toBe(false);
    expect(order.filter((o) => o === 'continuation')).toHaveLength(1);
  });
});

describe('DesktopShutdownCoordinator protected finalization (design §5.5 ⑤, R45-01, R46-01)', () => {
  it('waits past the 5s ordinary deadline for a protected promotion', async () => {
    vi.useFakeTimers();
    try {
      let settleProtected: (() => void) | null = null;
      const protectedSettled = new Promise<void>((resolve) => { settleProtected = resolve; });
      const { deps: d, order } = deps({
        ordinaryCleanupDeadlineMs: 5_000,
        protectedDrainCapMs: 34_000,
        providerRuntime: {
          beginShutdown: () => drainHandle(
            [{ leaseId: 'lease-1', generationId: 'gen-1', remainingMs: 34_000 }],
            async () => { await protectedSettled; return true; },
          ),
          hideAndAbortNonProtected: () => {},
          closeOrdinaryProviders: async () => ({ cleanupFailed: [] }),
        },
      });
      const coordinator = new DesktopShutdownCoordinator(d);
      const shutdown = coordinator.onBeforeQuit().shutdown;

      await vi.advanceTimersByTimeAsync(5_000);
      // 5s is not the overall bound: nothing was finalised yet.
      expect(order).not.toContain('continuation');
      expect(order).not.toContain('closeStore');

      settleProtected?.();
      await vi.advanceTimersByTimeAsync(10);
      const report = await shutdown;

      expect(report.protectedSettled).toBe(true);
      expect(report.protectedLeaseIds).toEqual(['lease-1']);
      expect(order).toContain('continuation');
    } finally {
      vi.useRealTimers();
    }
  });

  it('defers store close when a token is still outstanding', async () => {
    const gate = new DesktopShutdownGate();
    const stuck = gate.acquire('task_execution', 'long-task');
    const { deps: d, order } = deps({ gate, ordinaryCleanupDeadlineMs: 10 });
    const coordinator = new DesktopShutdownCoordinator(d);

    const report = await coordinator.onBeforeQuit().shutdown;

    expect(report.ordinaryDrained).toBe(false);
    expect(report.storesClosed).toBe(false);
    expect(report.deferredReason).toBe('store_close_deferred_to_process_exit');
    expect(order).not.toContain('closeStore');
    // Independent non-store cleanup still runs, and we still exit once.
    expect(order).toContain('disposeLifetime');
    expect(order).toContain('continuation');
    stuck.release();
  });

  it('surfaces provider cleanup failures without blocking the exit', async () => {
    const { deps: d } = deps({
      providerRuntime: {
        beginShutdown: () => drainHandle([]),
        hideAndAbortNonProtected: () => {},
        closeOrdinaryProviders: async () => ({ cleanupFailed: ['cua-driver: child refused to exit'] }),
      },
    });
    const coordinator = new DesktopShutdownCoordinator(d);

    const report = await coordinator.onBeforeQuit().shutdown;

    expect(report.cleanupFailed).toEqual(['cua-driver: child refused to exit']);
    expect(coordinator.shutdownComplete).toBe(true);
  });

  it('reports a protected drain that blows its own deadline', async () => {
    const { deps: d } = deps({
      protectedDrainCapMs: 5,
      providerRuntime: {
        beginShutdown: () => drainHandle(
          [{ leaseId: 'lease-9', generationId: 'gen-2', remainingMs: 34_000 }],
          async () => false,
        ),
        hideAndAbortNonProtected: () => {},
        closeOrdinaryProviders: async () => ({ cleanupFailed: [] }),
      },
    });
    const logged: string[] = [];
    const coordinator = new DesktopShutdownCoordinator({ ...d, log: (e) => logged.push(e) });

    const report = await coordinator.onBeforeQuit().shutdown;

    expect(report.protectedSettled).toBe(false);
    expect(logged).toContain('protected_finalization_timeout');
    expect(report.storesClosed).toBe(false);
  });
});
