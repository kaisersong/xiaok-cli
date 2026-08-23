/**
 * Provider runtime core types (design v58 §3.1–§3.4).
 *
 * Pure logic only: this module must not import Electron or Desktop runtime
 * types. Desktop main owns the single instance; the CLI does not use it yet.
 */
/** Stable component id + non-reusable generation id. */
export interface ComponentInstanceKey {
    readonly componentId: string;
    readonly generationId: string;
}
export declare function componentInstanceKeyOf(componentId: string, generationId: string): ComponentInstanceKey;
export declare function sameComponentInstance(a: ComponentInstanceKey, b: ComponentInstanceKey): boolean;
/** Every generation/invocation-owned resource returns one of these (§3.3). */
export interface EffectHandle {
    readonly owner: ComponentInstanceKey;
    readonly kind: string;
    readonly resourceId: string;
    dispose(): void | Promise<void>;
}
export interface EffectDisposeFailure {
    readonly kind: string;
    readonly resourceId: string;
    readonly error: Error;
}
export interface EffectScopeDisposeResult {
    readonly disposed: number;
    readonly failures: readonly EffectDisposeFailure[];
    readonly durationMs: number;
}
export type ProviderSlotState = 'preparing' | 'committed' | 'retiring' | 'failed';
export type LeaseAbortSource = 'none' | 'caller' | 'runtime';
/** §3.4 lease phases. `finalizing` is protected from abort/force-revoke. */
export type LeasePhase = 'executing' | 'finalizing' | 'settled';
export interface ProviderInvocationLease<T> {
    readonly leaseId: string;
    readonly provider: ComponentInstanceKey;
    readonly generationId: string;
    readonly value: T;
    readonly signal: AbortSignal;
    /** Getter backed by the mutable lease record; freezes on first abort. */
    readonly abortSource: LeaseAbortSource;
    readonly phase: LeasePhase;
    registerInvocationHandle(handle: EffectHandle): void;
    /**
     * Marks the gateway result as parsed, entering protected host finalization.
     * Returns false when the runtime already closed the transition gate.
     */
    beginFinalizing(): boolean;
    release(): void;
}
export declare class ProviderUnavailableError extends Error {
    readonly code = "provider_unavailable";
    constructor(message?: string);
}
export declare class ProviderUnavailableRetryError extends Error {
    readonly code = "provider_unavailable_retry";
    constructor(message?: string);
}
/** Canonical caller cancellation, rebuilt by gateways from a frozen abortSource. */
export declare function canonicalAbortError(reason?: string): Error;
export declare function isAbortErrorLike(error: unknown): boolean;
