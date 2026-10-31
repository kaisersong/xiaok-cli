import { type IntentPublicationCandidate, type IntentArtifactSelection, type IntentFileObservation } from './publication-candidate-journal.js';
import type { SessionStore } from '../../ai/runtime/session-store/store.js';
import type { SessionExecutionAuthority, SessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
type PublicationLedgerData = NonNullable<ReturnType<NonNullable<SessionStore['getIntentNativeLedgerSync']>>>;
interface PublicationArtifactData {
    readonly stageId?: unknown;
    readonly storage?: unknown;
    readonly path?: unknown;
    readonly artifactId?: unknown;
}
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
        fileObservations: IntentFileObservation[];
        expectedLedgerHash: string;
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
        artifacts: PublicationArtifactData[];
        originalSelections: {
            obligationId: string;
            path: string;
        }[];
        configuration: {
            artifactSelections: ({
                obligationId: string;
                path: string;
                artifactId: unknown;
            } | {
                obligationId: null;
                path: null;
                artifactId: unknown;
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
export declare function readIntentPublicationFileFacts(ledger: Pick<PublicationLedgerData, 'intents' | 'activeIntentId'>, workspace: string, row?: Pick<IntentPublicationCandidate, 'intentId' | 'stageId'>): IntentFileObservation[];
export {};
