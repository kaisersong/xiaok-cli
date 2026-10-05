import type { PersistedSessionSnapshot } from '../../ai/runtime/session-store/store.js';
export interface IntentExecutionTerminal {
    kind: 'turn' | 'step';
    identity: string;
    status: 'stopped' | 'completed' | 'failed';
    requestSource: 'user' | 'agent' | 'scheduler';
    recordedAt: number;
}
export interface IntentExecutionTerminalInput extends IntentExecutionTerminal {
    sessionId: string;
    intentId: string;
}
export { captureIntentData } from './data.js';
export declare function captureIntentSnapshot(snapshot: PersistedSessionSnapshot): PersistedSessionSnapshot;
export declare function parseIntentExecutionInput(raw: unknown): IntentExecutionTerminalInput;
export declare function hasProtectedIntentProducerHistory(ledger: PersistedSessionSnapshot['intentDelegation']): boolean;
/** Called inside both actual store locks. This is a deny boundary, not a grant. */
export declare function assertIntentSessionCommit(previous: PersistedSessionSnapshot | null, next: PersistedSessionSnapshot, forkSource?: PersistedSessionSnapshot, executionPrimitive?: boolean, producerPrimitive?: boolean, nativePrimitive?: boolean, publicationPrimitive?: boolean, verificationPrimitive?: boolean, receiverPrimitive?: boolean | 'projection'): void;
/** Store-private call path constructs from locked current state, never supplied nextSnapshot. */
export declare function appendIntentExecutionTerminal(previous: PersistedSessionSnapshot, input: IntentExecutionTerminalInput): PersistedSessionSnapshot;
export declare function captureIntentExecutionRequest(raw: IntentExecutionTerminalInput & {
    lease: import('../../ai/runtime/session-store/execution-authority.js').SessionExecutionLease;
}): {
    input: IntentExecutionTerminalInput;
    lease: import("../../ai/runtime/session-store/execution-authority.js").SessionExecutionLease;
};
