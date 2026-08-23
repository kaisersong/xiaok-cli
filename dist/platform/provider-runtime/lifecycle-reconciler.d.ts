/**
 * LifecycleReconciler (design v58 §4.1, §5.1–§5.5).
 *
 * Single responsibility: compare persisted desired configuration against the
 * provider slots and produce the minimal, serialised lifecycle actions.
 *
 * Frozen behaviours:
 *  - one single-flight reconcile per component; concurrent inputs only bump
 *    `desiredRevision` instead of starting a second activate/deactivate;
 *  - after every async boundary the revision is re-compared, and a stale
 *    attempt disposes its provisional scope instead of committing;
 *  - commit happens in a synchronous critical section (no `await` inside);
 *  - a failed new generation never removes a healthy committed one — the
 *    projection becomes `active_degraded`, not disconnected;
 *  - retire drain/dispose failures surface as `cleanup_failed`, and they never
 *    block reconciliation of unrelated components;
 *  - `health_signal` is queued, never applied inside the reporter's lease;
 *  - retry never writes persisted desired state.
 */
import type { ComponentEffectScope } from './effect-scope.js';
import { ProviderSlotDirectory, type ProviderResourceMode } from './provider-slot-directory.js';
import { type ComponentInstanceKey } from './types.js';
export type ComponentRuntimeState = 'inactive' | 'activating' | 'active' | 'active_degraded' | 'deactivating' | 'failed' | 'blocked_manifest' | 'cleanup_failed';
export interface ComponentActivationContext {
    readonly provider: ComponentInstanceKey;
    readonly scope: ComponentEffectScope;
    /** True once the desired revision moved on; adapters may bail out early. */
    isStale(): boolean;
}
export interface ActivationResult {
    /** Provider value published to the slot; must contain every declared operation. */
    readonly value: unknown;
    /** Optional generation-scoped child close, invoked once per generation. */
    readonly closeOnce?: () => Promise<void>;
}
export interface PluginComponentSpec {
    readonly id: string;
    readonly pluginName: string;
    readonly version: string;
    readonly activation: 'startup' | 'user';
    readonly resourceMode: ProviderResourceMode;
    /** Exact capability key this component publishes. */
    readonly provides: string;
    activate(context: ComponentActivationContext): Promise<ActivationResult>;
}
export interface ComponentProjection {
    readonly componentId: string;
    readonly pluginName: string;
    readonly desiredActive: boolean;
    readonly runtimeState: ComponentRuntimeState;
    readonly resourceMode: ProviderResourceMode;
    readonly committedGeneration: string | null;
    readonly preparingGeneration: string | null;
    readonly ready: boolean;
    readonly activeInvocationCount: number;
    readonly availableActions: readonly ('enable' | 'disable' | 'retry')[];
    readonly lastError?: string;
    readonly blockedBy?: string;
    readonly cleanupStatus?: string;
    readonly revision: number;
}
export interface HealthSignal {
    readonly componentId: string;
    readonly generationId: string;
    readonly failureCode: string;
    readonly persistent: boolean;
}
export declare class LifecycleReconciler {
    readonly slots: ProviderSlotDirectory;
    private readonly hooks;
    private readonly components;
    private projectionRevision;
    constructor(slots?: ProviderSlotDirectory, hooks?: {
        onProjection?: (projection: ComponentProjection) => void;
        /** Reconciler is the only writer of persisted recovery metadata (§5.4). */
        onArchivePersistentFailure?: (signal: HealthSignal) => void;
        onClearPersistentFailure?: (componentId: string) => void;
    });
    register(spec: PluginComponentSpec): void;
    projection(componentId: string): ComponentProjection;
    /** Persisted desired-state mutation; only user-sourced callers reach this. */
    setDesiredActive(componentId: string, desiredActive: boolean, requestSource: 'user'): Promise<void>;
    /** Startup path: read persisted state and converge without writing anything. */
    reconcileFromPersistedState(input: Record<string, boolean>): Promise<void>;
    /** Component-specific retry; never mutates persisted desired state (§7.2). */
    retry(componentId: string, requestSource: 'user'): Promise<void>;
    /**
     * Health observation only. It never writes persisted state itself and is not
     * applied inside the reporting lease.
     */
    submitHealthSignal(signal: HealthSignal): void;
    /** Applied by the runtime after the reporting lease has been released. */
    applyPendingHealthSignals(componentId: string): Promise<void>;
    /** Single-flight per component; extra calls coalesce onto the running attempt. */
    reconcile(componentId: string): Promise<void>;
    private needsWork;
    private runReconcile;
    /**
     * §5.3 transactional replacement: prepare and validate the new generation
     * while the old one keeps serving, swap in a synchronous critical section,
     * then drain the old generation. A failed attempt leaves the old generation
     * committed and only projects `active_degraded`.
     */
    replaceGeneration(componentId: string): Promise<{
        replaced: boolean;
    }>;
    private activate;
    private retireCommitted;
    private setState;
    private require;
}
/** Desired active but manifest/trusted source unresolvable (§5.1). */
export declare class BlockedManifestError extends Error {
    readonly diagnostic: string;
    constructor(diagnostic: string);
}
