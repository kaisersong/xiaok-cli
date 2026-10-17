import { type IntentHostSubject } from '../../../runtime/verification/intent-host-subject.js';
import type { PersistedSessionSnapshot, StoredSessionSnapshot } from './store.js';
export declare const SESSION_SCHEMA_VERSION = 1;
export interface PersistedSessionDocument extends StoredSessionSnapshot {
    schemaVersion: typeof SESSION_SCHEMA_VERSION;
}
export interface SessionDeletionJournal {
    version: 1;
    sessionId: string;
    operationId: string;
    deletedAt: number;
    state: 'pending' | 'committed';
    snapshotHash: string;
    closure: NonNullable<PersistedSessionSnapshot['protectedObservationClosure']>;
}
export declare function parseFileSessionSnapshot(raw: string, sessionId: string, preserveIntent?: boolean): StoredSessionSnapshot;
/** Statements contained in one captured file; the full collector must verify
 * their native registrations and references before forming any attribution. */
export declare function readCapturedFileSession(raw: string, sessionId: string): Readonly<{
    kind: "captured-source-declarations";
    containerSessionId: string;
    sessionReferences: {
        relation: string;
        recordId: string;
        sessionIdentity: string;
        childStoreRoot?: string;
    }[];
    typedReferences: {
        namespace: string;
        identity: string;
    }[];
    publicationDeclarations: {
        nativeContracts: import("../../../runtime/intent-delegation/native-contract-journal.js").IntentNativeContractRecord[];
        candidates: import("../../../runtime/intent-delegation/publication-candidate-journal.js").IntentPublicationCandidate[];
        verificationExecutions: import("../../../runtime/intent-delegation/verification-execution-journal.js").IntentVerificationExecution[];
    };
    storedSessionIdentity: "present" | "null" | "absent";
    lineageReferences: readonly string[];
    forkReference: string | null;
    intentSubjects: readonly Readonly<IntentHostSubject>[];
    observationReferences: readonly import("../protected-observation-closure.js").ProtectedObservationReference[];
}>;
/** Common serialized snapshot declarations. SQLite callers validate their
 * original JSON columns before passing the original normalized document here;
 * only the File wrapper applies its physical filename identity restriction. */
export declare function readCapturedSessionDocument(raw: string, sessionId: string): Readonly<{
    kind: "captured-source-declarations";
    containerSessionId: string;
    sessionReferences: {
        relation: string;
        recordId: string;
        sessionIdentity: string;
        childStoreRoot?: string;
    }[];
    typedReferences: {
        namespace: string;
        identity: string;
    }[];
    publicationDeclarations: {
        nativeContracts: import("../../../runtime/intent-delegation/native-contract-journal.js").IntentNativeContractRecord[];
        candidates: import("../../../runtime/intent-delegation/publication-candidate-journal.js").IntentPublicationCandidate[];
        verificationExecutions: import("../../../runtime/intent-delegation/verification-execution-journal.js").IntentVerificationExecution[];
    };
    storedSessionIdentity: "present" | "null" | "absent";
    lineageReferences: readonly string[];
    forkReference: string | null;
    intentSubjects: readonly Readonly<IntentHostSubject>[];
    observationReferences: readonly import("../protected-observation-closure.js").ProtectedObservationReference[];
}>;
/** Original deletion body validator; raw-byte hash linkage is checked by its caller. */
export declare function parseSessionDeletionJournal(raw: unknown, sessionId: string): SessionDeletionJournal;
