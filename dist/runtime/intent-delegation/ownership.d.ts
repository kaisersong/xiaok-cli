import type { StoredSessionIntentLedgerInput, NormalizedStoredSessionIntentLedger } from './stored-intent-clone.js';
import type { SessionIntentLedger, TakeoverSessionOptions } from './types.js';
export declare function markSessionOwned(ledger: SessionIntentLedger, instanceId: string, now?: number): SessionIntentLedger;
export declare function markSessionOwned(ledger: StoredSessionIntentLedgerInput, instanceId: string, now?: number): NormalizedStoredSessionIntentLedger;
export declare function releaseSessionOwnership(ledger: SessionIntentLedger, instanceId: string, now?: number): SessionIntentLedger;
export declare function releaseSessionOwnership(ledger: StoredSessionIntentLedgerInput, instanceId: string, now?: number): NormalizedStoredSessionIntentLedger;
export declare function resumeSessionOwnership(ledger: SessionIntentLedger, instanceId: string, now?: number): SessionIntentLedger;
export declare function resumeSessionOwnership(ledger: StoredSessionIntentLedgerInput, instanceId: string, now?: number): NormalizedStoredSessionIntentLedger;
/** Data fields consumed by the existing ownership check; never a grant. */
export interface SessionWriteOwnershipData {
    readonly ownership: {
        readonly ownerInstanceId?: unknown;
        readonly previousOwnerInstanceId?: unknown;
        readonly state?: unknown;
    };
    readonly instanceId?: unknown;
    readonly intents: readonly unknown[];
    readonly latestPlan: unknown;
}
export declare function assertSessionWriteOwnership(ledger: SessionWriteOwnershipData, instanceId: string, action?: string, options?: {
    allowInitialClaim?: boolean;
}): void;
export declare function takeoverSessionOwnership(ledger: SessionIntentLedger, instanceId: string, options?: TakeoverSessionOptions): SessionIntentLedger;
export declare function takeoverSessionOwnership(ledger: StoredSessionIntentLedgerInput, instanceId: string, options?: TakeoverSessionOptions): NormalizedStoredSessionIntentLedger;
