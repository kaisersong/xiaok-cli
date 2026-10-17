import { type IntentBusinessProjection } from './business-projection.js';
import { type IntentReceiverMutation } from './receiver-publication-journal.js';
import type { SessionStore } from '../../ai/runtime/session-store/store.js';
import type { SessionExecutionAuthority, SessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
export interface IntentReceiverWriteInput {
    ticket: object;
    lease: SessionExecutionLease;
}
/** Consume-only entry. Ordinary data cannot create a receiver journal write. */
export declare function consumeIntentReceiverWrite(store: SessionStore, raw: IntentReceiverWriteInput): {
    input: IntentReceiverMutation;
    lease: SessionExecutionLease;
};
/** Fixed native publisher. Historical status is not business completion authority. */
export declare function createIntentReceiverPublicationHost(options: {
    store: SessionStore;
    authority: SessionExecutionAuthority;
    sessionId: string;
    instanceId: string;
    workspaceRoot: string;
    assertAdmission(): void;
    now?: () => number;
}): Readonly<{
    get(candidateId: string): import("./receiver-publication-journal.js").IntentReceiverAttempt | undefined;
    list(candidateId: string): readonly import("./receiver-publication-journal.js").IntentReceiverAttempt[];
    publish(raw: {
        candidateId: string;
        requestSource: "user";
        signal?: AbortSignal;
    }): Promise<IntentBusinessProjection | import("./receiver-publication-journal.js").IntentReceiverAttempt>;
    project(raw: {
        candidateId: string;
        requestSource: "user";
        signal?: AbortSignal;
    }): Promise<IntentBusinessProjection | import("./receiver-publication-journal.js").IntentReceiverAttempt>;
    retry(raw: {
        candidateId: string;
        requestSource: "user";
        signal?: AbortSignal;
    }): Promise<IntentBusinessProjection | import("./receiver-publication-journal.js").IntentReceiverAttempt>;
    recover(raw: {
        candidateId: string;
        requestSource: "user" | "scheduler";
        signal?: AbortSignal;
    }): Promise<IntentBusinessProjection | import("./receiver-publication-journal.js").IntentReceiverAttempt>;
    close(): Promise<void>;
    waitForClosedResources(): Promise<void>;
}>;
