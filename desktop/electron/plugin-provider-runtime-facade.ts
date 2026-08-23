/**
 * PluginProviderRuntimeFacade (design v58 §4, §5.5).
 *
 * Created synchronously at module scope, before any service or gateway exists, so
 * every static gateway can capture a stable identity. Until `start()` runs it
 * answers with a structured unavailable result instead of `undefined`, which is
 * what lets gateways be registered once for the process lifetime.
 *
 * The object is never replaced: `start()` is single-flight and may run once,
 * `dispose()` is idempotent, and the shutdown coordinator drives both
 * `beginShutdown()` and the provider close phases through this one handle.
 */

import { LifecycleReconciler, type PluginComponentSpec } from '../../src/platform/provider-runtime/lifecycle-reconciler.js';
import {
  ProviderSlotDirectory,
  type ProtectedFinalizationDrain,
} from '../../src/platform/provider-runtime/provider-slot-directory.js';
import {
  ProviderUnavailableRetryError,
  type ProviderInvocationLease,
} from '../../src/platform/provider-runtime/types.js';
import type { ProtectedDrainHandle, ProviderRuntimeShutdownFacade } from './desktop-shutdown-coordinator.js';
import type { GatewayRuntimeFacade, RendererProviderValue } from './provider-gateways/create-host-gateways.js';

/** Per-capability lease budgets frozen by design §3.4. */
export const LEASE_BUDGETS = Object.freeze({
  'mcp:report-renderer': Object.freeze({ executingMs: 94_000, finalizingMs: 34_000 }),
  'mcp:slide-renderer': Object.freeze({ executingMs: 61_000, finalizingMs: 34_000 }),
  'mcp:cua-driver': Object.freeze({ executingMs: 121_000, finalizingMs: 0 }),
} as Record<string, { executingMs: number; finalizingMs: number }>);

const DEFAULT_BUDGET = Object.freeze({ executingMs: 30_000, finalizingMs: 0 });

export interface ProviderRuntimeStatus {
  readonly started: boolean;
  readonly disposed: boolean;
  readonly shuttingDown: boolean;
}

export class PluginProviderRuntimeFacade implements GatewayRuntimeFacade, ProviderRuntimeShutdownFacade {
  private readonly slots = new ProviderSlotDirectory();

  private readonly reconciler = new LifecycleReconciler(this.slots);

  private startPromise: Promise<void> | null = null;

  private disposePromise: Promise<void> | null = null;

  private shuttingDown = false;

  status(): ProviderRuntimeStatus {
    return {
      started: this.startPromise !== null,
      disposed: this.disposePromise !== null,
      shuttingDown: this.shuttingDown,
    };
  }

  /** Single-flight and single-use: the runtime is started exactly once. */
  async start(specs: readonly PluginComponentSpec[]): Promise<void> {
    if (this.disposePromise) throw new Error('provider runtime already disposed');
    if (this.startPromise) return this.startPromise;
    this.startPromise = (async () => {
      for (const spec of specs) this.reconciler.register(spec);
      const desired: Record<string, boolean> = {};
      for (const spec of specs) desired[spec.id] = spec.activation === 'startup';
      await this.reconciler.reconcileFromPersistedState(desired);
    })();
    return this.startPromise;
  }

  get lifecycle(): LifecycleReconciler {
    return this.reconciler;
  }

  /* ---------------- GatewayRuntimeFacade ---------------- */

  acquire(
    capabilityKey: string,
    options: { callerSignal?: AbortSignal },
  ): ProviderInvocationLease<RendererProviderValue> {
    if (!this.startPromise || this.shuttingDown || this.disposePromise) {
      throw new ProviderUnavailableRetryError(`provider runtime not serving ${capabilityKey}`);
    }
    return this.slots.acquire<RendererProviderValue>(capabilityKey, {
      budget: LEASE_BUDGETS[capabilityKey] ?? DEFAULT_BUDGET,
      ...(options.callerSignal ? { callerSignal: options.callerSignal } : {}),
    });
  }

  describeUnavailable(capabilityKey: string): { code: string; message: string; retryable: boolean } {
    if (!this.startPromise) {
      return {
        code: 'provider_unavailable_retry',
        message: `${capabilityKey} runtime has not started yet`,
        retryable: true,
      };
    }
    if (this.shuttingDown || this.disposePromise) {
      return { code: 'shutting_down', message: `${capabilityKey} is shutting down`, retryable: false };
    }
    return {
      code: 'provider_unavailable_retry',
      message: `${capabilityKey} has no committed provider generation`,
      retryable: true,
    };
  }

  /* ---------------- ProviderRuntimeShutdownFacade ---------------- */

  /** Synchronous phase ①: close the transition gate, freeze protected leases. */
  beginShutdown(): ProtectedDrainHandle {
    this.shuttingDown = true;
    const drain: ProtectedFinalizationDrain = this.slots.beginShutdown();
    return {
      leases: drain.leases,
      waitForSettled: async (deadlineMs: number) => {
        if (drain.leases.length === 0) return true;
        const deadline = Date.now() + deadlineMs;
        while (Date.now() < deadline) {
          const remaining = drain.leases.filter(
            (l) => this.slots.activeLeaseCount(capabilityOfGeneration(drain, l.generationId), l.generationId) > 0,
          );
          if (remaining.length === 0) return true;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return false;
      },
    };
  }

  hideAndAbortNonProtected(): void {
    this.slots.abortNonProtected();
  }

  async closeOrdinaryProviders(): Promise<{ cleanupFailed: string[] }> {
    const cleanupFailed: string[] = [];
    await this.dispose().catch((error) => {
      cleanupFailed.push(error instanceof Error ? error.message : String(error));
    });
    return { cleanupFailed };
  }

  /** Idempotent; the coordinator and plugin-disable share this one disposer. */
  async dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposePromise = (async () => {
      this.shuttingDown = true;
      // Nothing else to release yet when no component was ever activated.
      if (!this.startPromise) return;
      await this.startPromise.catch(() => undefined);
    })();
    return this.disposePromise;
  }
}

function capabilityOfGeneration(drain: ProtectedFinalizationDrain, generationId: string): string {
  for (const [id, dep] of drain.generationDependencies) {
    if (id === generationId) return dep.resourceMode === 'parallel-generation' ? 'mcp:slide-renderer' : 'mcp:report-renderer';
  }
  return 'mcp:report-renderer';
}
