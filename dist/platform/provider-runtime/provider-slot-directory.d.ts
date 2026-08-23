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
import { type ComponentInstanceKey, type ProviderInvocationLease, type ProviderSlotState } from './types.js';
export type ProviderResourceMode = 'parallel-generation' | 'shared-host' | 'invocation-scoped';
export interface LeaseBudget {
    /** Total budget for the executing phase. */
    readonly executingMs: number;
    /** Extra budget granted once the gateway result is parsed (close + promotion + guard). */
    readonly finalizingMs: number;
}
export interface ProtectedFinalizationDrain {
    readonly leases: ReadonlyArray<{
        leaseId: string;
        generationId: string;
        remainingMs: number;
    }>;
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
export declare class ProviderSlotDirectory {
    private readonly options;
    private readonly slots;
    private projectionRevision;
    private leaseSeq;
    private transitionGateOpen;
    constructor(options?: {
        now?: () => number;
        setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
        clearTimer?: (t: ReturnType<typeof setTimeout>) => void;
        abortSettleGraceMs?: number;
    });
    private get now();
    private get setTimer();
    private get clearTimer();
    private get abortSettleGraceMs();
    get revision(): number;
    private slot;
    /** Creates a provisional generation. Its resources are unreachable by callers. */
    prepare(input: {
        capabilityKey: string;
        provider: ComponentInstanceKey;
        resourceMode: ProviderResourceMode;
        value: unknown;
        closeOnce?: () => Promise<void>;
    }): {
        scope: ComponentEffectScope;
    };
    /** Synchronous critical section: swap the committed generation, bump revision. */
    commit(capabilityKey: string, provider: ComponentInstanceKey): void;
    markFailed(capabilityKey: string, provider: ComponentInstanceKey): void;
    stateOf(capabilityKey: string, generationId: string): ProviderSlotState | 'absent';
    activeLeaseCount(capabilityKey: string, generationId?: string): number;
    /**
     * Grants a lease bound to the currently committed generation. Throws
     * `provider_unavailable_retry` when nothing is committed — callers surface a
     * structured unavailable result rather than touching a draining transport.
     */
    acquire<T>(capabilityKey: string, options: AcquireOptions): ProviderInvocationLease<T>;
    private abortLease;
    private beginFinalizing;
    private releaseLease;
    private maybeCloseGeneration;
    private runtimeDeadlineReached;
    /** Bounded close of invocation-owned handles, then a tombstone. */
    private forceRevoke;
    /**
     * Retire a generation: stop granting leases (already true once it is no longer
     * committed), wait for the ledger to drain, then dispose its scope.
     */
    retire(capabilityKey: string, generationId: string): Promise<{
        drained: boolean;
    }>;
    /**
     * §5.5 step ①: close the executing→finalizing gate and freeze the protected
     * set in the same synchronous section, so the parse transition either won and
     * is protected, or lost and must go through abort cleanup.
     */
    beginShutdown(): ProtectedFinalizationDrain;
    /** Aborts every non-protected executing lease (shutdown step ④). */
    abortNonProtected(): number;
    /** Test/diagnostic helper: how many times a generation's child was closed. */
    closeOnceInvoked(capabilityKey: string, generationId: string): boolean;
}
