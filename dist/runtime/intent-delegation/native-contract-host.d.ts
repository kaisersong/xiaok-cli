import { type IntentNativeContractRecord, type IntentNativeDefinition } from './native-contract-journal.js';
import type { IntentPlanDraft } from './types.js';
import type { SessionStore } from '../../ai/runtime/session-store/store.js';
import type { SessionExecutionAuthority } from '../../ai/runtime/session-store/execution-authority.js';
interface Action {
    intentId: string;
    requestSource: 'user' | 'scheduler';
    signal?: AbortSignal;
}
/** Actual product host only. Its journal records facts; it never grants execution. */
export declare function createIntentNativeContractHost(options: {
    store: SessionStore;
    authority: SessionExecutionAuthority;
    sessionId: string;
    instanceId: string;
    assertAdmission: () => void;
    now?: () => number;
}): Readonly<{
    reserve(raw: {
        plan: IntentPlanDraft;
        definition: IntentNativeDefinition;
        requestSource: "user";
    }): Promise<IntentNativeContractRecord>;
    advance(raw: Action): Promise<IntentNativeContractRecord>;
    recover(raw: Action): Promise<IntentNativeContractRecord>;
    retrySubject(raw: Action & {
        stageId: string | null;
    }): Promise<IntentNativeContractRecord>;
    get(intentId: string): IntentNativeContractRecord;
    list(): IntentNativeContractRecord[];
    close(): Promise<void>;
    waitForClosedResources(): Promise<void>;
}>;
export {};
