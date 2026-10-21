import type { IntentNativeDefinition } from '../runtime/intent-delegation/native-contract-journal.js';
/** Explicit original definitions, not a recipe generator or authority. */
export declare function readIntentVerificationFile(path: string): IntentNativeDefinition;
export type IntentNativeCommand = {
    kind: 'status';
} | {
    kind: 'continue';
} | {
    kind: 'recover';
} | {
    kind: 'retry';
    stageId: string | null;
};
export declare function parseIntentNativeCommand(input: string): IntentNativeCommand | null;
/** Pure lexical selection for the fixed CLI. This is not an execution grant. */
export declare function prepareIntentNativeContinuation(ledger: import('../runtime/intent-delegation/types.js').SessionIntentLedger | undefined, input: string, hasAttachments: boolean): null | {
    plan: import('../ai/intent-delegation/types.js').IntentPlanDraft;
    text: string;
    basis: string;
};
