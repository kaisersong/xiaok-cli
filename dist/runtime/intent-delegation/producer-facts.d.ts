import type { PersistedSessionSnapshot, StoredSessionSnapshot } from '../../ai/runtime/session-store/store.js';
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
export interface IntentProducerRouteData {
    readonly intents: readonly {
        readonly intentId: string;
    }[];
    readonly latestPlan?: {
        readonly intentId: string;
    } | null;
    readonly activeIntentId?: string;
}
export declare function intentProducerRouteVector(ledger: IntentProducerRouteData | undefined): string;
export declare function assertIntentProducerRoutesCurrent(ledger: IntentProducerRouteData | undefined, original: string): void;
/** Called only by actual SessionStore primitive under its original lease/save lock.
 * These are model reports, never proof of a producer side effect or current business. */
export declare function applyIntentProducerAction(previous: PersistedSessionSnapshot, input: IntentProducerActionInput, originalRoutes: string): PersistedSessionSnapshot;
export declare function applyIntentProducerAction(previous: StoredSessionSnapshot, input: IntentProducerActionInput, originalRoutes: string): StoredSessionSnapshot;
