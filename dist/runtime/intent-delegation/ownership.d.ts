import type { SessionIntentLedger, TakeoverSessionOptions } from './types.js';
export declare function markSessionOwned(ledger: SessionIntentLedger, instanceId: string, now?: number): SessionIntentLedger;
export declare function releaseSessionOwnership(ledger: SessionIntentLedger, instanceId: string, now?: number): SessionIntentLedger;
export declare function resumeSessionOwnership(ledger: SessionIntentLedger, instanceId: string, now?: number): SessionIntentLedger;
export declare function assertSessionWriteOwnership(ledger: SessionIntentLedger, instanceId: string, action?: string, options?: {
    allowInitialClaim?: boolean;
}): void;
export declare function takeoverSessionOwnership(ledger: SessionIntentLedger, instanceId: string, options?: TakeoverSessionOptions): SessionIntentLedger;
