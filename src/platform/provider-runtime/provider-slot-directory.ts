/**
 * ProviderSlotDirectory + invocation leases (design v58 §3.4, §5.3–§5.5).
 *
 * Frozen behaviours this module owns:
 *  - only a `committed` generation grants leases; preparing/retiring/failed reject;
 *  - lease grant and ledger insertion happen in the same synchronous section;
 *  - the active ledger is `Map<leaseId, record>` — never a driftable counter;
 *  - `release()` is idempotent at lease and coordinator level (no double decrement);
 *  - `abortSource` freezes the first abort source; a later signal never overrides it;
 *  - runtime abort → settle grace → force-revoke with a tombstone, and a late
 *    `release()` can not disturb another lease or a newer generation;
 *  - `finalizing` leases are protected: no abort, no force-revoke;
 *  - `beginShutdown()` closes the executing→finalizing gate in the same
 *    synchronous section that a parse transition would use, and groups protected
 *    leases per generation so a shared child closes exactly once.
 */

import { ComponentEffectScope } from './effect-scope.js';
import {
  type ComponentInstanceKey,
  type EffectHandle,
  type LeaseAbortSource,
  type LeasePhase,
  type ProviderInvocationLease,
  type ProviderSlotState,
  ProviderUnavailableRetryError,
} from './types.js';

export type ProviderResourceMode = 'parallel-generation' | 'shared-host' | 'invocation-scoped';

export interface LeaseBudget {
  /** Total budget for the executing phase. */
  readonly executingMs: number;
  /** Extra budget granted once the gateway result is parsed (close + promotion + guard). */
  readonly finalizingMs: number;
}

interface LeaseRecord {
  readonly leaseId: string;
  readonly generation: GenerationRecord;
  readonly controller: AbortController;
  readonly budget: LeaseBudget;
  abortSource: LeaseAbortSource;
  phase: LeasePhase;
  released: boolean;
  revoked: boolean;
  deadlineTimer: ReturnType<typeof setTimeout> | null;
  readonly invocationHandles: EffectHandle[];
  readonly settled: Promise<void>;
  resolveSettled: () => void;
}

interface GenerationRecord {
  readonly key: ComponentInstanceKey;
  readonly capabilityKey: string;
  readonly resourceMode: ProviderResourceMode;
  readonly value: unknown;
  readonly scope: ComponentEffectScope;
  state: ProviderSlotState;
  readonly active: Map<string, LeaseRecord>;
  readonly tombstones: Set<string>;
  /** Protected finalizing leases still holding this generation's child. */
  readonly protectedLeases: Set<string>;
  closeOnceCalled: boolean;
  closeOnce: (() => Promise<void>) | null;
  /**
   * Grouped close only applies while retiring or shutting down. During normal
   * operation a parallel-generation child must stay ready after a protected
   * promotion settles (design R43-03), so this stays false.
   */
  closeWhenProtectedDrained: boolean;
}

export interface ProtectedFinalizationDrain {
  readonly leases: ReadonlyArray<{ leaseId: string; generationId: string; remainingMs: number }>;
  readonly generationDependencies: ReadonlyMap<string, {
    resourceMode: ProviderResourceMode;
    protectedLeaseIds: readonly string[];
  }>;
}

export interface AcquireOptions {
  readonly callerSignal?: AbortSignal;
  readonly budget: LeaseBudget;
  readonly leaseId?: string;
}

export class ProviderSlotDirectory {
  private readonly slots = new Map<string, {
    committed: GenerationRecord | null;
    preparing: GenerationRecord | null;
    retiring: GenerationRecord[];
  }>();

  private projectionRevision = 0;

  private leaseSeq = 0;

  private transitionGateOpen = true;

  constructor(
    private readonly options: {
      now?: () => number;
      setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
      clearTimer?: (t: ReturnType<typeof setTimeout>) => void;
      abortSettleGraceMs?: number;
    } = {},
  ) {}

  private get now(): () => number {
    return this.options.now ?? (() => Date.now());
  }

  private get setTimer() {
    return this.options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  }

  private get clearTimer() {
    return this.options.clearTimer ?? ((t: ReturnType<typeof setTimeout>) => clearTimeout(t));
  }

  private get abortSettleGraceMs(): number {
    return this.options.abortSettleGraceMs ?? 1_000;
  }

  get revision(): number {
    return this.projectionRevision;
  }

  private slot(capabilityKey: string) {
    let entry = this.slots.get(capabilityKey);
    if (!entry) {
      entry = { committed: null, preparing: null, retiring: [] };
      this.slots.set(capabilityKey, entry);
    }
    return entry;
  }

  /** Creates a provisional generation. Its resources are unreachable by callers. */
  prepare(input: {
    capabilityKey: string;
    provider: ComponentInstanceKey;
    resourceMode: ProviderResourceMode;
    value: unknown;
    closeOnce?: () => Promise<void>;
  }): { scope: ComponentEffectScope } {
    const slot = this.slot(input.capabilityKey);
    const record: GenerationRecord = {
      key: input.provider,
      capabilityKey: input.capabilityKey,
      resourceMode: input.resourceMode,
      value: input.value,
      scope: new ComponentEffectScope(input.provider, this.now),
      state: 'preparing',
      active: new Map(),
      tombstones: new Set(),
      protectedLeases: new Set(),
      closeOnceCalled: false,
      closeOnce: input.closeOnce ?? null,
      closeWhenProtectedDrained: false,
    };
    slot.preparing = record;
    return { scope: record.scope };
  }

  /** Synchronous critical section: swap the committed generation, bump revision. */
  commit(capabilityKey: string, provider: ComponentInstanceKey): void {
    const slot = this.slot(capabilityKey);
    const preparing = slot.preparing;
    if (!preparing || preparing.key.generationId !== provider.generationId) {
      throw new Error(`no preparing generation to commit for ${capabilityKey}`);
    }
    const previous = slot.committed;
    if (previous) {
      previous.state = 'retiring';
      slot.retiring.push(previous);
    }
    preparing.state = 'committed';
    slot.committed = preparing;
    slot.preparing = null;
    this.projectionRevision += 1;
  }

  markFailed(capabilityKey: string, provider: ComponentInstanceKey): void {
    const slot = this.slot(capabilityKey);
    for (const record of [slot.preparing, slot.committed]) {
      if (record && record.key.generationId === provider.generationId) record.state = 'failed';
    }
    if (slot.committed && slot.committed.state === 'failed') slot.committed = null;
    if (slot.preparing && slot.preparing.state === 'failed') slot.preparing = null;
    this.projectionRevision += 1;
  }

  stateOf(capabilityKey: string, generationId: string): ProviderSlotState | 'absent' {
    const slot = this.slot(capabilityKey);
    for (const record of [slot.committed, slot.preparing, ...slot.retiring]) {
      if (record && record.key.generationId === generationId) return record.state;
    }
    return 'absent';
  }

  activeLeaseCount(capabilityKey: string, generationId?: string): number {
    const slot = this.slot(capabilityKey);
    const records = [slot.committed, slot.preparing, ...slot.retiring].filter(
      (r): r is GenerationRecord => r !== null && (generationId === undefined || r.key.generationId === generationId),
    );
    return records.reduce((sum, r) => sum + r.active.size, 0);
  }

  /**
   * Grants a lease bound to the currently committed generation. Throws
   * `provider_unavailable_retry` when nothing is committed — callers surface a
   * structured unavailable result rather than touching a draining transport.
   */
  acquire<T>(capabilityKey: string, options: AcquireOptions): ProviderInvocationLease<T> {
    const slot = this.slot(capabilityKey);
    const generation = slot.committed;
    if (!generation || generation.state !== 'committed') {
      throw new ProviderUnavailableRetryError(`no committed provider for ${capabilityKey}`);
    }

    this.leaseSeq += 1;
    const leaseId = options.leaseId ?? `lease-${this.leaseSeq}`;
    const controller = new AbortController();
    let resolveSettled: () => void = () => {};
    const settled = new Promise<void>((resolve) => { resolveSettled = resolve; });

    const record: LeaseRecord = {
      leaseId,
      generation,
      controller,
      budget: options.budget,
      abortSource: 'none',
      phase: 'executing',
      released: false,
      revoked: false,
      deadlineTimer: null,
      invocationHandles: [],
      settled,
      resolveSettled,
    };
    generation.active.set(leaseId, record);

    if (options.callerSignal) {
      if (options.callerSignal.aborted) this.abortLease(record, 'caller');
      else {
        options.callerSignal.addEventListener('abort', () => this.abortLease(record, 'caller'), { once: true });
      }
    }
    record.deadlineTimer = this.setTimer(() => {
      void this.runtimeDeadlineReached(record);
    }, options.budget.executingMs);

    const self = this;
    return {
      leaseId,
      provider: generation.key,
      generationId: generation.key.generationId,
      value: generation.value as T,
      signal: controller.signal,
      get abortSource() { return record.abortSource; },
      get phase() { return record.phase; },
      registerInvocationHandle(handle: EffectHandle) {
        record.invocationHandles.push(handle);
      },
      beginFinalizing() {
        return self.beginFinalizing(record);
      },
      release() {
        self.releaseLease(record);
      },
    };
  }

  private abortLease(record: LeaseRecord, source: Exclude<LeaseAbortSource, 'none'>): void {
    if (record.phase !== 'executing') return; // finalizing/settled are protected
    if (record.abortSource === 'none') record.abortSource = source;
    if (!record.controller.signal.aborted) record.controller.abort();
  }

  private beginFinalizing(record: LeaseRecord): boolean {
    if (record.phase !== 'executing') return false;
    if (!this.transitionGateOpen) return false;
    record.phase = 'finalizing';
    if (record.deadlineTimer) {
      this.clearTimer(record.deadlineTimer);
      record.deadlineTimer = this.setTimer(() => {
        // Phase timeout is a typed cleanup/output error decided by the caller;
        // the runtime never force-revokes a finalizing lease.
      }, record.budget.finalizingMs);
    }
    record.generation.protectedLeases.add(record.leaseId);
    return true;
  }

  private releaseLease(record: LeaseRecord): void {
    if (record.released) return; // idempotent at lease level
    record.released = true;
    record.phase = 'settled';
    if (record.deadlineTimer) {
      this.clearTimer(record.deadlineTimer);
      record.deadlineTimer = null;
    }
    const generation = record.generation;
    if (generation.tombstones.has(record.leaseId)) {
      // Force-revoked earlier: the ledger entry is already gone, so a late
      // release must not touch another lease or a newer generation.
      record.resolveSettled();
      return;
    }
    generation.active.delete(record.leaseId); // idempotent at coordinator level
    if (generation.protectedLeases.delete(record.leaseId)
      && generation.protectedLeases.size === 0
      && generation.closeWhenProtectedDrained) {
      void this.maybeCloseGeneration(generation);
    }
    record.resolveSettled();
  }

  private async maybeCloseGeneration(generation: GenerationRecord): Promise<void> {
    if (generation.closeOnceCalled || !generation.closeOnce) return;
    generation.closeOnceCalled = true;
    await generation.closeOnce();
  }

  private async runtimeDeadlineReached(record: LeaseRecord): Promise<void> {
    if (record.phase !== 'executing' || record.released) return;
    this.abortLease(record, 'runtime');
    const settled = await Promise.race([
      record.settled.then(() => true),
      new Promise<boolean>((resolve) => {
        this.setTimer(() => resolve(false), this.abortSettleGraceMs);
      }),
    ]);
    if (settled || record.released || record.phase !== 'executing') return;
    await this.forceRevoke(record);
  }

  /** Bounded close of invocation-owned handles, then a tombstone. */
  private async forceRevoke(record: LeaseRecord): Promise<void> {
    if (record.revoked) return;
    record.revoked = true;
    for (const handle of [...record.invocationHandles].reverse()) {
      try {
        await handle.dispose();
      } catch {
        // Aggregated by the caller's cleanup diagnostics; never rethrown here.
      }
    }
    record.generation.active.delete(record.leaseId);
    record.generation.tombstones.add(record.leaseId);
  }

  /**
   * Retire a generation: stop granting leases (already true once it is no longer
   * committed), wait for the ledger to drain, then dispose its scope.
   */
  async retire(capabilityKey: string, generationId: string): Promise<{ drained: boolean }> {
    const slot = this.slot(capabilityKey);
    const record = [slot.committed, ...slot.retiring].find(
      (r): r is GenerationRecord => r !== null && r.key.generationId === generationId,
    );
    if (!record) return { drained: true };
    if (slot.committed === record) {
      slot.committed = null;
      record.state = 'retiring';
      slot.retiring.push(record);
      this.projectionRevision += 1;
    }
    record.closeWhenProtectedDrained = true;
    while (record.active.size > 0) {
      await Promise.race([...record.active.values()].map((r) => r.settled));
    }
    await this.maybeCloseGeneration(record);
    await record.scope.dispose();
    slot.retiring = slot.retiring.filter((r) => r !== record);
    record.tombstones.clear();
    return { drained: true };
  }

  /**
   * §5.5 step ①: close the executing→finalizing gate and freeze the protected
   * set in the same synchronous section, so the parse transition either won and
   * is protected, or lost and must go through abort cleanup.
   */
  beginShutdown(): ProtectedFinalizationDrain {
    this.transitionGateOpen = false;
    const leases: Array<{ leaseId: string; generationId: string; remainingMs: number }> = [];
    const deps = new Map<string, { resourceMode: ProviderResourceMode; protectedLeaseIds: readonly string[] }>();
    for (const slot of this.slots.values()) {
      for (const record of [slot.committed, slot.preparing, ...slot.retiring]) {
        if (!record) continue;
        const protectedIds: string[] = [];
        for (const lease of record.active.values()) {
          if (lease.phase !== 'finalizing') continue;
          protectedIds.push(lease.leaseId);
          leases.push({
            leaseId: lease.leaseId,
            generationId: record.key.generationId,
            remainingMs: lease.budget.finalizingMs,
          });
        }
        if (protectedIds.length > 0) {
          record.closeWhenProtectedDrained = true;
          deps.set(record.key.generationId, {
            resourceMode: record.resourceMode,
            protectedLeaseIds: Object.freeze(protectedIds),
          });
        }
      }
    }
    return { leases: Object.freeze(leases), generationDependencies: deps };
  }

  /** Aborts every non-protected executing lease (shutdown step ④). */
  abortNonProtected(): number {
    let aborted = 0;
    for (const slot of this.slots.values()) {
      for (const record of [slot.committed, slot.preparing, ...slot.retiring]) {
        if (!record) continue;
        for (const lease of record.active.values()) {
          if (lease.phase !== 'executing') continue;
          this.abortLease(lease, 'runtime');
          aborted += 1;
        }
      }
    }
    return aborted;
  }

  /** Test/diagnostic helper: how many times a generation's child was closed. */
  closeOnceInvoked(capabilityKey: string, generationId: string): boolean {
    const slot = this.slot(capabilityKey);
    const record = [slot.committed, slot.preparing, ...slot.retiring].find(
      (r): r is GenerationRecord => r !== null && r.key.generationId === generationId,
    );
    return record?.closeOnceCalled ?? false;
  }
}
