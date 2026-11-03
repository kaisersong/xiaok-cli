import type { PersistedSessionSnapshot } from '../../ai/runtime/session-store/store.js';
/** Presence facts only. A false result does not prove modern data or grant execution. */
export interface IntentProtectedHistoryData {
    readonly nativeContracts?: unknown;
    readonly intents?: unknown;
    readonly latestPlan?: unknown;
}
export declare function hasProtectedIntentProducerHistory(ledger: PersistedSessionSnapshot['intentDelegation']): boolean;
export declare function hasProtectedIntentProducerHistory(ledger: IntentProtectedHistoryData | null | undefined): boolean;
