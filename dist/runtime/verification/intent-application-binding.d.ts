import { type IntentHostSubject } from './intent-host-subject.js';
import { type IntentBusinessContract } from './intent-business-contract.js';
import { type PublishedArtifactSelection } from './published-artifact-selection.js';
import { type IntentProducerReport } from '../intent-delegation/producer-report.js';
import type { IntentExecutionTerminal } from '../intent-delegation/intent-commit-boundary.js';
export interface IntentCandidateArtifact {
    readonly artifactId: string;
    readonly stageId: string;
    readonly kind: 'markdown' | 'report' | 'slides' | 'summary' | 'analysis' | 'document' | 'unknown';
    readonly label: string;
    readonly summary: string | null;
    readonly createdAt: number;
    readonly content: {
        readonly kind: 'inline';
        readonly text: string;
    } | {
        readonly kind: 'file';
        readonly originalPath: string;
    };
    readonly selection: Readonly<PublishedArtifactSelection>;
    readonly sha256: string;
    readonly size: number;
}
export interface IntentStagePublicationReference {
    readonly subject: Readonly<IntentHostSubject>;
    readonly candidateId: string;
    readonly candidateRevision: number;
    readonly bindingHash: string;
    readonly immutablePayloadHash: string;
    readonly operationId: string;
    readonly fullTupleHash: string;
    readonly committedBusinessRevision: number;
    readonly receiverId: string;
    readonly receiverProtocolVersion: 1;
    readonly receiverInstanceEpoch: number;
}
export type IntentCandidateBody = {
    readonly kind: 'intent-stage';
    readonly stageId: string;
    readonly summary: string;
    readonly executionReports: readonly Readonly<IntentExecutionTerminal>[];
    readonly producerReports?: readonly Readonly<IntentProducerReport>[];
    readonly artifacts: readonly Readonly<IntentCandidateArtifact>[];
} | {
    readonly kind: 'intent-parent';
    readonly summary: string;
    readonly stages: readonly Readonly<IntentStagePublicationReference>[];
    readonly artifacts: readonly Readonly<IntentCandidateArtifact>[];
};
export interface IntentApplicationBinding {
    readonly version: 1;
    readonly kind: 'intent';
    readonly subject: Readonly<IntentHostSubject>;
    readonly candidateId: string;
    readonly candidateRevision: number;
    readonly contract: Readonly<IntentBusinessContract>;
    readonly contractHash: string;
    readonly body: Readonly<IntentCandidateBody>;
    readonly candidatePayloadHash: string;
}
export type IntentApplicationCandidate = Omit<IntentApplicationBinding, 'contractHash' | 'candidatePayloadHash'>;
export declare function createIntentApplicationBinding(raw: unknown): Readonly<IntentApplicationBinding>;
export declare function parseIntentApplicationBinding(raw: unknown): Readonly<IntentApplicationBinding>;
export declare function intentApplicationBindingHash(raw: unknown): string;
/** Validate the original nested value before an outer protocol clone can discard
 * non-JSON keys. This is data validation, not authority or native approval. */
export declare function assertIntentApplicationEnvelope(raw: unknown): void;
