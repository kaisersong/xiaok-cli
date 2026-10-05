/** Durable identity/audit only. These fields never authorize sending protected history. */
export interface ProtectedObservationReference {
    authorityId: string;
    profileId: string;
    sourceSessionId: string;
    ownerAgentId: string;
    scopeId: string;
    permissionGeneration: number;
    observationId: string;
    contentHash: string;
    revision: number;
    policyId: string;
    policyRevision: number;
}
export interface ProtectedObservationClosure {
    version: 1;
    requiresReauthorization: true;
    observations: ProtectedObservationReference[];
}
/** Monotonic union. An absent incoming marker cannot erase a previously protected history. */
export declare function mergeProtectedObservationClosures(previous: ProtectedObservationClosure | undefined, incoming: ProtectedObservationClosure | undefined): ProtectedObservationClosure | undefined;
