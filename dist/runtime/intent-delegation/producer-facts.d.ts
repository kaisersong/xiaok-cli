import type { PersistedSessionSnapshot } from '../../ai/runtime/session-store/store.js';
import type { SessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
import { type IntentProducerAction } from './producer-report.js';
export type { IntentProducerOrigin, IntentProducerAction, IntentProducerReport } from './producer-report.js';
export interface IntentProducerActionInput {
    instanceId: string;
    sessionId: string;
    intentId: string;
    expectedLedgerHash: string;
    requestSource: 'user' | 'agent' | 'scheduler';
    action: IntentProducerAction;
    now: number;
}
export declare function captureIntentProducerRequest(raw: IntentProducerActionInput & {
    lease: SessionExecutionLease;
}): {
    input: IntentProducerActionInput;
    lease: SessionExecutionLease;
};
export declare function intentProducerLedgerHash(ledger: unknown): string;
export declare function intentProducerRouteVector(ledger: PersistedSessionSnapshot['intentDelegation']): string;
export declare function assertIntentProducerRoutesCurrent(ledger: PersistedSessionSnapshot['intentDelegation'], original: string): void;
/** Called only by actual SessionStore primitive under its original lease/save lock.
 * These are model reports, never proof of a producer side effect or current business. */
export declare function applyIntentProducerAction(previous: PersistedSessionSnapshot, input: IntentProducerActionInput, originalRoutes: string): PersistedSessionSnapshot;
