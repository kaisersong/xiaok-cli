import type { IntentLedgerRecord, SessionIntentLedger } from './types.js';
import type { StoredIntentRecordInput, NormalizedStoredIntentRecord } from './stored-intent-clone.js';
/** Only selection/stage/flag DATA consumed by the pending-handoff query. */
export interface PendingHandoffIntentData {
    readonly intentId: unknown;
    readonly activeStageId?: unknown;
    readonly stages?: unknown;
}
export interface PendingHandoffLedgerData<T extends PendingHandoffIntentData = PendingHandoffIntentData> {
    readonly activeIntentId?: unknown;
    readonly ownership: {
        readonly ownerInstanceId?: unknown;
        readonly previousOwnerInstanceId?: unknown;
    };
    readonly intents: readonly T[];
}
export declare function resolveOwnedActiveIntent(ledger: SessionIntentLedger | null | undefined, instanceId: string): IntentLedgerRecord | undefined;
export declare function resolveOwnedActiveIntent<T extends PendingHandoffIntentData>(ledger: PendingHandoffLedgerData<T> | null | undefined, instanceId: string): T | undefined;
export declare function hasPendingFreshContextHandoff(ledger: PendingHandoffLedgerData | null | undefined, instanceId: string): boolean;
export declare function consumeFreshContextHandoff(intent: IntentLedgerRecord, now?: number): IntentLedgerRecord;
export declare function consumeFreshContextHandoff(intent: StoredIntentRecordInput, now?: number): NormalizedStoredIntentRecord;
