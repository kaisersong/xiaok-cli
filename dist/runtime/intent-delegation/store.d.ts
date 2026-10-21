import { type IntentProducerAction, type IntentProducerActionInput } from './producer-facts.js';
import type { SessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
import { type IntentExecutionTerminalInput } from './intent-commit-boundary.js';
import type { PersistedSessionSnapshot, SessionStore } from '../../ai/runtime/session-store/store.js';
import type { IntentLedgerRecord, IntentPlanDraft, RecordBreadcrumbInput, RecordReceiptInput, RecordSalvageInput, SessionIntentLedger, UpdateIntentLedgerPatch } from './types.js';
export { createEmptySessionIntentLedger } from './types.js';
export { rekeySessionIntentLedger } from './types.js';
type ProducerMutationPort = SessionIntentDelegationStore['recordProducerAction'];
export declare function isIntentDelegationStoreFor(store: SessionIntentDelegationStore, sessionStore: SessionStore): boolean;
/** Fixed host port; the actual Store still requires its private source-bound lease. */
export declare function getIntentProducerMutationPort(store: SessionIntentDelegationStore): ProducerMutationPort;
export declare class SessionIntentDelegationStore {
    private readonly sessionStore;
    constructor(sessionStore: SessionStore);
    recordExecutionTerminal(sessionId: string, input: Omit<IntentExecutionTerminalInput, 'sessionId'>, lease: SessionExecutionLease): Promise<SessionIntentLedger>;
    recordProducerAction(sessionId: string, intentId: string, instanceId: string, action: IntentProducerAction, requestSource: IntentProducerActionInput['requestSource'], lease: SessionExecutionLease): Promise<SessionIntentLedger>;
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
