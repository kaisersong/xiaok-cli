/**
 * DesktopShutdownCoordinator (design v58 §5.5).
 *
 * The single Xiaok-owned `before-quit` owner. The phase order is frozen because
 * both the text and the tests must agree on one sequence:
 *
 *  ① first real before-quit: preventDefault, set isQuitting/shutting_down,
 *     close the gate, and — in the same synchronous section — call
 *     `providerRuntime.beginShutdown()` to close the executing→finalizing
 *     transition gate and freeze the protected lease set with their original
 *     phase deadlines.
 *  ② synchronously destroy owned windows so queued preload invokes can no
 *     longer take a token.
 *  ③ tell every ingress owner to stop/abort without waiting for them to settle.
 *  ④ without waiting for ③, hide provider slots, abort non-protected leases and
 *     close ordinary provider children (3s each). Protected leases continue.
 *  ⑤ ordinary cleanup runs under a 5s deadline; protected leases drain under
 *     their own original deadlines (≤34s). 5s is not the overall exit bound.
 *  ⑥ re-check every token/owner: only if all drained do durable stores close
 *     and the main source-pin release get written; otherwise defer to process
 *     exit with a diagnostic.
 *  ⑦ mark complete and call the continuation exactly once.
 */

import type { DesktopShutdownGate } from './shutdown-aware-ipc-main.js';

export interface ProtectedDrainHandle {
  /** Frozen protected leases with their original remaining budget. */
  readonly leases: ReadonlyArray<{ leaseId: string; generationId: string; remainingMs: number }>;
  /** Resolves when every protected lease and grouped child close settled. */
  waitForSettled(deadlineMs: number): Promise<boolean>;
}

export interface ProviderRuntimeShutdownFacade {
  /** Synchronous: closes the transition gate and freezes the protected set. */
  beginShutdown(): ProtectedDrainHandle;
  /** Hide slots + abort non-protected executing leases. */
  hideAndAbortNonProtected(): void;
  /** Bounded controlled close for ordinary generations. */
  closeOrdinaryProviders(): Promise<{ cleanupFailed: string[] }>;
}

export interface IngressOwner {
  readonly name: string;
  stopAccepting(): void;
  abortAllActive(reason: string): void;
  drain(deadlineMs: number): Promise<boolean>;
}

export interface DurableStoreOwner {
  readonly name: string;
  close(): Promise<void>;
}

export interface ShutdownDeps {
  readonly gate: DesktopShutdownGate;
  readonly providerRuntime: ProviderRuntimeShutdownFacade;
  readonly ingressOwners: readonly IngressOwner[];
  readonly durableStores: readonly DurableStoreOwner[];
  destroyWindows(): void;
  /** Non-store cleanup that must always run (menu, tray, meeting, timers). */
  disposeLifetimeResources(): Promise<void>;
  releaseMainSourcePin(): Promise<void>;
  continuation(): void;
  readonly ordinaryCleanupDeadlineMs?: number;
  readonly protectedDrainCapMs?: number;
  log?(event: string, detail?: Record<string, unknown>): void;
}

export interface ShutdownReport {
  readonly ordinaryDrained: boolean;
  readonly protectedSettled: boolean;
  readonly storesClosed: boolean;
  readonly deferredReason?: string;
  readonly cleanupFailed: readonly string[];
  readonly protectedLeaseIds: readonly string[];
}

export class DesktopShutdownCoordinator {
  private shutdownPromise: Promise<ShutdownReport> | null = null;

  private complete = false;

  private isQuittingFlag = false;

  constructor(private readonly deps: ShutdownDeps) {}

  get isQuitting(): boolean {
    return this.isQuittingFlag;
  }

  get shutdownComplete(): boolean {
    return this.complete;
  }

  /**
   * Handles `before-quit`. Returns whether the event must be prevented; a second
   * event after completion is simply allowed through.
   */
  onBeforeQuit(): { preventDefault: boolean; shutdown: Promise<ShutdownReport> } {
    if (this.complete) {
      return { preventDefault: false, shutdown: this.shutdownPromise! };
    }
    if (this.shutdownPromise) {
      return { preventDefault: true, shutdown: this.shutdownPromise };
    }

    // ---- Phase ①: synchronous section, no await allowed in here. ----
    this.isQuittingFlag = true;
    this.deps.gate.close();
    const protectedDrain = this.deps.providerRuntime.beginShutdown();

    // ---- Phase ②: windows die before anything can await. ----
    this.deps.destroyWindows();

    this.shutdownPromise = this.runAfterSynchronousPhases(protectedDrain);
    return { preventDefault: true, shutdown: this.shutdownPromise };
  }

  private async runAfterSynchronousPhases(protectedDrain: ProtectedDrainHandle): Promise<ShutdownReport> {
    const log = this.deps.log ?? (() => {});
    const ordinaryDeadline = this.deps.ordinaryCleanupDeadlineMs ?? 5_000;
    const protectedCap = this.deps.protectedDrainCapMs ?? 34_000;
    const protectedLeaseIds = protectedDrain.leases.map((l) => l.leaseId);

    // ---- Phase ③: stop/abort ingress without waiting for settle. ----
    for (const owner of this.deps.ingressOwners) {
      owner.stopAccepting();
      owner.abortAllActive('app_shutdown');
    }
    const ingressDrains = this.deps.ingressOwners.map((o) => o.drain(ordinaryDeadline));
    const tokenDrain = this.deps.gate.drain(ordinaryDeadline);

    // ---- Phase ④: hide slots, abort non-protected, close ordinary children. ----
    this.deps.providerRuntime.hideAndAbortNonProtected();
    const ordinaryProviderClose = this.deps.providerRuntime.closeOrdinaryProviders();

    // ---- Phase ⑤: ordinary cleanup and protected drain run concurrently. ----
    const [ordinaryResults, tokensDrained, providerCleanup, protectedSettled] = await Promise.all([
      Promise.all(ingressDrains),
      tokenDrain,
      ordinaryProviderClose,
      protectedDrain.waitForSettled(protectedCap),
    ]);
    const ordinaryDrained = ordinaryResults.every(Boolean) && tokensDrained;
    if (!ordinaryDrained) {
      log('shutdown_ordinary_cleanup_timeout', { outstanding: this.deps.gate.describeOutstanding() });
    }
    if (!protectedSettled) {
      log('protected_finalization_timeout', { protectedLeaseIds });
    }

    // ---- Phase ⑥: final token re-check decides store close vs defer. ----
    let storesClosed = false;
    let deferredReason: string | undefined;
    if (this.deps.gate.outstanding === 0 && ordinaryDrained && protectedSettled) {
      for (const store of this.deps.durableStores) {
        await store.close();
      }
      await this.deps.releaseMainSourcePin();
      storesClosed = true;
    } else {
      deferredReason = 'store_close_deferred_to_process_exit';
      log(deferredReason, { outstanding: this.deps.gate.describeOutstanding() });
    }

    // Independent non-store cleanup always runs.
    await this.deps.disposeLifetimeResources();

    // ---- Phase ⑦: once-only continuation, no await after the finalize tick. ----
    this.complete = true;
    this.deps.continuation();

    return {
      ordinaryDrained,
      protectedSettled,
      storesClosed,
      ...(deferredReason ? { deferredReason } : {}),
      cleanupFailed: providerCleanup.cleanupFailed,
      protectedLeaseIds,
    };
  }
}
