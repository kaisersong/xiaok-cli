import type { IntentLedgerRecord, SessionIntentLedger } from './types.js';
export declare function resolveOwnedActiveIntent(ledger: SessionIntentLedger | null | undefined, instanceId: string): IntentLedgerRecord | undefined;
export declare function hasPendingFreshContextHandoff(ledger: SessionIntentLedger | null | undefined, instanceId: string): boolean;
export declare function consumeFreshContextHandoff(intent: IntentLedgerRecord, now?: number): IntentLedgerRecord;
