import type { VerificationOwner } from './proof-authority.js';
import type { QuiescenceExpectation } from '../isolated-execution/physical-quiescence.js';
export type ArchiveResourceReview = {
    kind: 'transcript';
    resourceId: string;
    manifestHash: string;
    expected: QuiescenceExpectation;
    complete: boolean;
    truncated: boolean;
    stdout: {
        size: number;
        sha256: string;
    };
    stderr: {
        size: number;
        sha256: string;
    };
} | {
    kind: 'protected-run';
    sourceRunId: string;
    runNonce: string;
    rootInvocation: Pick<QuiescenceExpectation, 'sessionIdentity' | 'compoundOperationId' | 'validationInvocationId'>;
    state: 'sealed' | 'prepared' | 'complete' | 'deleted';
    archiveHash: string | null;
    archiveBytes: number | null;
    memberCount: number;
    censusHash: string;
};
export interface ArchiveOperationReview {
    version: 1;
    purpose: 'execution-archive-access';
    authorityId: string;
    challengeId: string;
    principal: {
        uid: number;
        accountGeneration: string;
        auditSessionId: number;
    };
    requestSource: 'user';
    action: 'read' | 'delete';
    owner: VerificationOwner;
    resource: ArchiveResourceReview;
    deadline: {
        domainId: string;
        qualificationEpoch: number;
        notBefore: number;
        validUntil: number;
    };
}
/** Pure response validation; this does not issue authority or a capability. */
export declare function parseArchiveReadResource(raw: unknown): Readonly<ArchiveResourceReview>;
/** Pure deletion descriptor validation; this does not authorize deletion. */
export declare function parseArchiveDeleteResource(raw: unknown): Readonly<ArchiveResourceReview>;
/** Pure exact review validation; a parsed review and hash grant no access. */
export declare function parseArchiveOperationReview(raw: unknown): Readonly<ArchiveOperationReview>;
export declare function archiveReviewBytes(raw: unknown): Buffer;
