/** Internal controller protocol. Parsing or possession of a DTO never grants authority. */
export interface VerificationDependency {
    kind?: 'inherited';
    originOwner?: {
        profileId: string;
        ownerKind: VerificationTuple['ownerKind'];
        ownerId: string;
    };
    originalObligationId?: string;
    obligationId: string;
    predicateId: string;
    predicateVersion: string;
    definitionHash: string;
    activeAttemptId: string;
    attemptEpoch: number;
    sourceRunId: string;
    runNonce: string;
    subjectId: string;
    contentRoot: string;
    coreId: string;
    coreHash: string;
    coreFinalRevision: number;
    proofId: string;
    proofHash: string;
    proofRevision: number;
    requiredScopeId: string;
    scopeRevision: number;
    invalidationEpoch: number;
}
/** A direct identifier can never alias an inherited identity, regardless of its text. */
export declare function verificationDependencyKey(value: VerificationDependency): string;
export declare function compareVerificationDependencies(a: VerificationDependency, b: VerificationDependency): number;
export interface VerificationTuple {
    schemaVersion: 1;
    profileId: string;
    ownerKind: 'task' | 'intent' | 'goal' | 'loop' | 'project' | 'kswarm';
    ownerId: string;
    migrationEpoch: number;
    expectedBusinessRevision: number;
    obligationSetRevision: number;
    obligationSetHash: string;
    obligations: readonly Readonly<VerificationDependency>[];
    operationId: string;
    immutablePayloadHash: string;
    receiverId: string;
    receiverProtocolVersion: 1;
    receiverInstanceEpoch: number;
    reservationId: string;
    nonce: string;
    notBefore: number;
    validUntil: number;
    clockDomainId: string;
    clockQualificationEpoch: number;
}
export declare const VERIFICATION_BUDGET: Readonly<{
    profileBytes: number;
    controlDatabaseBytes: number;
    rollbackAndTemporaryBytes: number;
    outboxPayloadBytes: number;
    auxiliaryBytes: number;
    maximumCounterOwners: 64;
    counterOwnerBytes: number;
    archiveBytes: number;
    sessionBytes: number;
    recordBytes: number;
    maximumOutboxRecords: 4096;
    maximumObligationsPerOwner: 256;
    maximumObligationsPerProfile: 4096;
    maximumExecutionAttempts: 131072;
    maximumChecks: 4096;
    rpcBytes: number;
}>;
export declare function parseVerificationTuple(input: unknown): Readonly<VerificationTuple>;
export declare function canonicalVerificationJson(value: unknown): string;
export declare function hashVerificationTuple(value: unknown): string;
/** Structural edge check only; service must also enforce source, facts, tuple and revision. */
export declare function assertVerificationTransition(kind: string, from: string, to: string): void;
