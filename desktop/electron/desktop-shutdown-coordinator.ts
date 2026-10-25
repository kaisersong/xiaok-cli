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
 *  ② synchronously hide/destroy owned windows so queued preload invokes can no
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
    if (this.complete) return { preventDefault: false, shutdown: this.shutdownPromise! };
    if (this.shutdownPromise) return { preventDefault: true, shutdown: this.shutdownPromise };
    // Cache before callbacks such as window destruction can synchronously reenter.
    let resolve!: (report: ShutdownReport) => void;
    let reject!: (error: unknown) => void;
    this.shutdownPromise = new Promise<ShutdownReport>((done, failed) => { resolve = done; reject = failed; });
    this.isQuittingFlag = true;
    const failures: string[] = [];
    this.deps.gate.close();
    let protectedDrain: ProtectedDrainHandle = { leases: [], waitForSettled: async () => false };
    try { protectedDrain = this.deps.providerRuntime.beginShutdown(); }
    catch (error) { this.recordFailure(failures, 'protected_begin', error); }
    try { this.deps.destroyWindows(); }
    catch (error) { this.recordFailure(failures, 'destroy_windows', error); }
    void this.runAfterSynchronousPhases(protectedDrain, failures).then(resolve, reject);
    return { preventDefault: true, shutdown: this.shutdownPromise };
  }

  private log(event: string, detail?: Record<string, unknown>): void {
    try { this.deps.log?.(event, detail); } catch { /* diagnostics cannot skip cleanup */ }
  }

  private recordFailure(failures: string[], name: string, error: unknown): void {
    failures.push(name);
    this.log('shutdown_cleanup_unconfirmed', { owner: name, error: error instanceof Error ? error.message : String(error) });
  }

  private async runAfterSynchronousPhases(protectedDrain: ProtectedDrainHandle, cleanupFailed: string[]): Promise<ShutdownReport> {
    const ordinaryDeadline = this.deps.ordinaryCleanupDeadlineMs ?? 5_000;
    const protectedCap = this.deps.protectedDrainCapMs ?? 34_000;
    const protectedLeaseIds = protectedDrain.leases.map(l => l.leaseId);

    // Phase ③: one failing producer does not prevent siblings from stopping.
    for (const owner of this.deps.ingressOwners) {
      try { owner.stopAccepting(); }
      catch (error) { this.recordFailure(cleanupFailed, `ingress_stop:${owner.name}`, error); }
      try { owner.abortAllActive('app_shutdown'); }
      catch (error) { this.recordFailure(cleanupFailed, `ingress_abort:${owner.name}`, error); }
    }
    const start = <T>(work: () => Promise<T>): Promise<T> => {
      try { return work(); } catch (error) { return Promise.reject(error); }
    };
    const ingressDrains = this.deps.ingressOwners.map(owner => start(() => owner.drain(ordinaryDeadline)));
    const tokenDrain = start(() => this.deps.gate.drain(ordinaryDeadline));

    // Phase ④: provider cleanup starts alongside producer drain.
    try { this.deps.providerRuntime.hideAndAbortNonProtected(); }
    catch (error) { this.recordFailure(cleanupFailed, 'provider_hide', error); }
    const ordinaryProviderClose = start(() => this.deps.providerRuntime.closeOrdinaryProviders());
    const protectedWait = start(() => protectedDrain.waitForSettled(protectedCap));

    // Phase ⑤: settle every original owner; a rejected promise is not a drain.
    const [ownerResults, [tokenResult], [providerResult], [protectedResult]] = await Promise.all([
      Promise.allSettled(ingressDrains), Promise.allSettled([tokenDrain]),
      Promise.allSettled([ordinaryProviderClose]), Promise.allSettled([protectedWait]),
    ]);
    ownerResults.forEach((result, index) => {
      if (result.status === 'rejected') this.recordFailure(cleanupFailed, `ingress_drain:${this.deps.ingressOwners[index]!.name}`, result.reason);
    });
    if (tokenResult!.status === 'rejected') this.recordFailure(cleanupFailed, 'token_drain', tokenResult!.reason);
    if (providerResult!.status === 'rejected') this.recordFailure(cleanupFailed, 'provider_close', providerResult!.reason);
    else cleanupFailed.push(...providerResult!.value.cleanupFailed);
    if (protectedResult!.status === 'rejected') this.recordFailure(cleanupFailed, 'protected_drain', protectedResult!.reason);
    const ordinaryDrained = cleanupFailed.length === 0
      && ownerResults.every(result => result.status === 'fulfilled' && result.value)
      && tokenResult!.status === 'fulfilled' && tokenResult!.value;
    const protectedSettled = protectedResult!.status === 'fulfilled' && protectedResult!.value;
    if (!ordinaryDrained) this.log('shutdown_ordinary_cleanup_timeout', { outstanding: this.deps.gate.describeOutstanding() });
    if (!protectedSettled) this.log('protected_finalization_timeout', { protectedLeaseIds });

    // Phase ⑥: failed store closure retains the original source pin.
    let storesClosed = false;
    let deferredReason: string | undefined;
    if (this.deps.gate.outstanding === 0 && ordinaryDrained && protectedSettled) {
      const beforeStores = cleanupFailed.length;
      for (const store of this.deps.durableStores) {
        try { await store.close(); }
        catch (error) { this.recordFailure(cleanupFailed, `store_close:${store.name}`, error); }
      }
      if (cleanupFailed.length === beforeStores) {
        try { await this.deps.releaseMainSourcePin(); storesClosed = true; }
        catch (error) { this.recordFailure(cleanupFailed, 'source_pin_release', error); }
      }
      if (!storesClosed) deferredReason = 'store_close_unconfirmed';
    } else deferredReason = 'store_close_deferred_to_process_exit';
    if (deferredReason) this.log(deferredReason, { outstanding: this.deps.gate.describeOutstanding() });

    // Independent resources and the once-only continuation still run on failure.
    try { await this.deps.disposeLifetimeResources(); }
    catch (error) {
      this.recordFailure(cleanupFailed, 'lifetime_resources', error);
      if (error instanceof AggregateError) {
        for (const failure of error.errors) {
          cleanupFailed.push(`lifetime_resources:${failure instanceof Error ? failure.message : String(failure)}`);
        }
      }
    }
    this.complete = true;
    try { this.deps.continuation(); }
    catch (error) { this.recordFailure(cleanupFailed, 'continuation', error); }
    return { ordinaryDrained, protectedSettled, storesClosed,
      ...(deferredReason ? { deferredReason } : {}), cleanupFailed, protectedLeaseIds };
  }
}
