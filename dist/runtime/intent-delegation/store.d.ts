import type { PersistedSessionSnapshot, SessionStore } from '../../ai/runtime/session-store/store.js';
import type { IntentLedgerRecord, IntentPlanDraft, RecordBreadcrumbInput, RecordReceiptInput, RecordSalvageInput, SessionIntentLedger, UpdateIntentLedgerPatch } from './types.js';
export { createEmptySessionIntentLedger } from './types.js';
export { rekeySessionIntentLedger } from './types.js';
export declare class SessionIntentDelegationStore {
    private readonly sessionStore;
    constructor(sessionStore: SessionStore);
    load(sessionId: string): Promise<SessionIntentLedger | null>;
    appendIntent(sessionId: string, plan: IntentPlanDraft): Promise<SessionIntentLedger>;
    updateIntent(sessionId: string, intentId: string, patch: UpdateIntentLedgerPatch): Promise<SessionIntentLedger>;
    recordBreadcrumb(sessionId: string, input: RecordBreadcrumbInput): Promise<SessionIntentLedger>;
    recordReceipt(sessionId: string, input: RecordReceiptInput): Promise<SessionIntentLedger>;
    recordSalvage(sessionId: string, input: RecordSalvageInput): Promise<SessionIntentLedger>;
    saveDispatchedIntent(sessionId: string, intent: IntentLedgerRecord): Promise<SessionIntentLedger>;
    private mutate;
    private requireSnapshot;
}
export declare function appendIntentToLedger(ledger: SessionIntentLedger, plan: IntentPlanDraft, now?: number): SessionIntentLedger;
export declare function updateIntentInLedger(ledger: SessionIntentLedger, intentId: string, patch: UpdateIntentLedgerPatch, now?: number): SessionIntentLedger;
export declare function recordBreadcrumbInLedger(ledger: SessionIntentLedger, input: RecordBreadcrumbInput, now?: number): SessionIntentLedger;
export declare function recordReceiptInLedger(ledger: SessionIntentLedger, input: RecordReceiptInput, now?: number): SessionIntentLedger;
export declare function recordSalvageInLedger(ledger: SessionIntentLedger, input: RecordSalvageInput, now?: number): SessionIntentLedger;
export declare function saveDispatchedIntentInLedger(ledger: SessionIntentLedger, intentRecord: IntentLedgerRecord): SessionIntentLedger;
export declare function readLedger(snapshot: PersistedSessionSnapshot): SessionIntentLedger;
