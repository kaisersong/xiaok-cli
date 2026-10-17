import { type IntentPublicationCandidate, type IntentArtifactSelection, type IntentFileObservation } from './publication-candidate-journal.js';
import type { SessionStore } from '../../ai/runtime/session-store/store.js';
import type { SessionExecutionAuthority, SessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
import type { SessionIntentLedger } from './types.js';
export interface IntentParentCandidateWrite {
    ticket: object;
    lease: SessionExecutionLease;
}
/** Consume-only: ordinary observations cannot mint a parent capture ticket. */
export declare function consumeIntentParentCandidateWrite(store: SessionStore, raw: IntentParentCandidateWrite): {
    input: {
        publicationAction: "reserve-parent";
        sessionId: string;
        requestSource: "user";
        now: number;
        instanceId: string;
        expectedLedgerHash: string;
        fileObservations: IntentFileObservation[];
        references: readonly import("../verification/intent-application-binding.js").IntentStagePublicationReference[];
    };
    lease: SessionExecutionLease;
};
/** Fixed product composition. Journal/observations are facts, never business grants. */
export declare function createIntentPublicationHost(options: {
    store: SessionStore;
    authority: SessionExecutionAuthority;
    sessionId: string;
    instanceId: string;
    workspaceRoot: string;
    assertAdmission: () => void;
    now?: () => number;
}): Readonly<{
    draft(raw: {
        requestSource: "user";
    }): Promise<{
        intentId: string;
        stageId: string;
        artifacts: import("./types.js").StageArtifactRecord[];
        originalSelections: {
            obligationId: string;
            path: string;
        }[];
        configuration: {
            artifactSelections: ({
                obligationId: string;
                path: string;
                artifactId: string;
            } | {
                obligationId: null;
                path: null;
                artifactId: string;
            })[];
        };
    }>;
    captureParent(raw: {
        requestSource: "user";
        signal?: AbortSignal;
    }): Promise<IntentPublicationCandidate>;
    capture(raw: {
        artifactSelections: IntentArtifactSelection[];
        requestSource: "user";
        signal?: AbortSignal;
    }): Promise<IntentPublicationCandidate>;
    advance(raw: {
        candidateId: string;
        requestSource: "user";
        signal?: AbortSignal;
    }): Promise<IntentPublicationCandidate>;
    recover(raw: {
        candidateId: string;
        requestSource: "user" | "scheduler";
        signal?: AbortSignal;
    }): Promise<IntentPublicationCandidate>;
    retry(raw: {
        candidateId: string;
        requestSource: "user";
        signal?: AbortSignal;
    }): Promise<IntentPublicationCandidate>;
    get(candidateId: string): IntentPublicationCandidate;
    list(): IntentPublicationCandidate[];
    close(): Promise<void>;
    waitForClosedResources(): Promise<void>;
}>;
export declare function readIntentPublicationFileFacts(ledger: SessionIntentLedger, workspace: string, row?: Pick<IntentPublicationCandidate, 'intentId' | 'stageId'>): IntentFileObservation[];
