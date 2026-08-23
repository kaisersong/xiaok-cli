/**
 * ComponentEffectScope (design v58 §3.3).
 *
 * The resource ledger of one generation. Contract points the tests freeze:
 *  - LIFO release order;
 *  - handle and scope dispose are idempotent;
 *  - one failing disposer never skips the rest; failures are aggregated;
 *  - a scope only releases handles whose owner is its own generation, so a late
 *    dispose can never reach a newer generation's resources;
 *  - registering into an already-disposed scope is a contract violation and
 *    fails fast instead of silently leaking.
 */
import { type ComponentInstanceKey, type EffectHandle, type EffectScopeDisposeResult } from './types.js';
export declare class EffectScopeContractViolation extends Error {
    constructor(message: string);
}
export declare class ComponentEffectScope {
    readonly owner: ComponentInstanceKey;
    private readonly now;
    private readonly entries;
    private disposeResult;
    private disposing;
    constructor(owner: ComponentInstanceKey, now?: () => number);
    get size(): number;
    get isDisposed(): boolean;
    /**
     * Records an effect that has already been created. Must be called before the
     * next interruptible boundary (§3.3), which is why it is synchronous.
     */
    register(handle: EffectHandle): EffectHandle;
    /** Releases every remaining handle in LIFO order; idempotent. */
    dispose(): Promise<EffectScopeDisposeResult>;
    private disposeEntry;
}
