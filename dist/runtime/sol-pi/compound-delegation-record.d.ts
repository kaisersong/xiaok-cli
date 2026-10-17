/** Durable facts, not execution authority. Only the host adapter may authenticate
 * never-started or complete child-drain evidence before committing these facts. */
export interface ManagedCompoundRecord {
    version: 1;
    groupId: string;
    agentId: string;
    rootEpoch: number;
    operationId: string;
    nativeInvocationId: string;
    ackBytes: string;
    ackHash: string;
    ackReady: boolean;
    ackPublished: boolean;
    resourcesReleasedDigest: string | null;
}
export interface CompoundDelegationRecord {
    version: 1;
    admissionId: string;
    childSessionIdentity: string;
    childStoreRoot: string;
    generation: number;
    state: 'live' | 'revoked' | 'closed';
    childPhase: 'not_started' | 'running' | 'drained' | 'unknown';
    managed?: ManagedCompoundRecord;
}
export declare function validateCompoundDelegationRecord(value: unknown): asserts value is CompoundDelegationRecord;
export declare function assertCompoundDelegationTransition(previous: CompoundDelegationRecord, next: CompoundDelegationRecord): void;
