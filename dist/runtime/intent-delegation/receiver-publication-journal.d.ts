import { type IntentBusinessProjection } from './business-projection.js';
import { type PublicationChallenge, type PublicationObservation, type PublicationRequestRecovery } from '../verification/publication-client.js';
import { type IntentPublicationCandidate } from './publication-candidate-journal.js';
import type { PersistedSessionSnapshot } from '../../ai/runtime/session-store/store.js';
export interface IntentReceiverAttempt {
    requestId: string;
    candidateId: string;
    applicationRequestId: string;
    bindingHash: string;
    sourceHash: string;
    route: string;
    originalSource: 'user';
    ordinal: number;
    revision: number;
    status: 'preparing' | 'prepared' | 'authorizing' | 'pending' | 'committed' | 'cancelled' | 'not_prepared' | 'not_approved';
    challenge: Readonly<PublicationChallenge> | null;
    observation: Readonly<PublicationObservation> | null;
    retirement: Exclude<PublicationRequestRecovery, {
        status: 'settlement_exists';
    }> | null;
    createdAt: number;
    updatedAt: number;
}
export type IntentReceiverAction = {
    kind: 'project';
    projection: IntentBusinessProjection;
} | {
    kind: 'reserve';
    route: string;
} | {
    kind: 'prepared';
    challenge: Readonly<PublicationChallenge>;
} | {
    kind: 'authorizing';
} | {
    kind: 'observe';
    challenge: Readonly<PublicationChallenge>;
    observation: Readonly<PublicationObservation>;
} | {
    kind: 'retire';
    fact: Exclude<PublicationRequestRecovery, {
        status: 'settlement_exists';
    }>;
};
export interface IntentReceiverMutation {
    publicationAction: 'receiver';
    sessionId: string;
    instanceId: string;
    candidateId: string;
    expectedLedgerHash: string;
    requestSource: 'user' | 'scheduler';
    now: number;
    action: IntentReceiverAction;
}
export declare function parseIntentReceiverAttempts(raw: unknown, candidate: IntentPublicationCandidate): IntentReceiverAttempt[];
export declare function assertIntentReceiverRetained(before: IntentPublicationCandidate, after: IntentPublicationCandidate): void;
export declare function applyIntentReceiverMutation(previous: PersistedSessionSnapshot, input: IntentReceiverMutation): PersistedSessionSnapshot;
