import { AgentSessionState } from '../../ai/runtime/session.js';
import type { ObservationReferenceOwnerFacts, ObservationReferenceOwnerResolution } from './reference-lifecycle.js';
import type { TransportAuthorityPort } from './transport-lease.js';
type Source = 'user' | 'agent' | 'scheduler';
export interface ObservationCallerClaims {
    sessionId: string;
    ownerAgentId: string;
    scopeId: string;
    permissionGeneration: number;
    requestSource: Source;
    surface: 'ordinary-owner' | 'room' | 'restricted' | 'multi-authority';
}
export interface ObservationDestination {
    provider: string;
    model: string;
    url: string;
}
export interface ObservationReadFileScope {
    filePath: string;
    startLine: number;
    endLine?: number;
}
export interface ObservationArchivePolicy {
    version: 1;
    id: string;
    revision: number;
    scopeId: string;
    sourceAdapterId: string;
    sourceDescriptors: string[];
    readFileScopes?: ObservationReadFileScope[];
    expiresAt: number;
    localPersistence: boolean;
    allowUnclassifiedText: boolean;
    allowIncomplete: boolean;
    destinations: ObservationDestination[];
}
export interface ObservationRef {
    version: 1;
    id: string;
    sessionId: string;
    invocationId: string;
    toolName: string;
    contentHash: string;
    byteLength: number;
    complete: boolean;
    incompleteReason?: string;
    executionState: 'running' | 'termination_pending' | 'interrupted' | 'terminal';
    outcome?: 'success' | 'error' | 'cancelled' | 'timeout';
    redactionVersion: string;
    createdAt: number;
    revision: number;
    terminalFactsId?: string;
    terminalFactsHash?: string;
}
export type ObservationCaller = object;
export type ObservationCapture = object;
/** Host-private identity, never serializable authorization. */
export type ObservationDelegation = object;
export type ObservationDelegationApproval = object;
type Mutation = {
    requestSource: Source;
    caller: ObservationCaller;
};
type Facts = Pick<ObservationRef, 'executionState' | 'outcome' | 'incompleteReason'>;
export declare class ObservationQuotaError extends Error {
    readonly code: 'observation_dependency_budget_exceeded' | 'observation_quota_exceeded';
    readonly recovery = "fresh-task";
    readonly retryable = false;
    constructor(code: 'observation_dependency_budget_exceeded' | 'observation_quota_exceeded');
}
/** Host-only single authority. No renderer or model receives this owner object. */
export declare function createObservationService(options: {
    profileRoot: string;
    profileId: string;
    redactor: {
        version: string;
        redact(text: string): string;
    };
    now?: () => number;
    /** Explicit host allocation for other bounded owners within this profile. */
    reservedProfileBytes?: number;
    /** Installed only by the local host; absence/async/error retains every pin. */
    resolveReferenceOwner?: (facts: Readonly<ObservationReferenceOwnerFacts>) => ObservationReferenceOwnerResolution;
    /** Host may lower hard limits for a profile, never raise them. */
    limits?: {
        recordBytes?: number;
        collectorBytes?: number;
        sessionBytes?: number;
        profileBytes?: number;
    };
}): {
    transportPort: TransportAuthorityPort;
    /** Host lifecycle event only; no caller or requestSource can mint this capability. */
    reconcileReferenceOwners(): void;
    getStorageBudget(): Readonly<{
        profileRoot: string;
        profileBytes: number;
        reservedBytes: number;
    }>;
    readonly authorityId: string;
    getReferenceMetadata(caller: ObservationCaller, id: string): Readonly<{
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
    }>;
    /** Existing recipient rights only. Ending a creator is not a new delegation. */
    assertPublishedSourceRead(input: {
        source: ObservationCaller;
        recipient: ObservationCaller;
        destination: ObservationDestination;
        observationIds: readonly string[];
    }): void;
    assertClosedSourceRead(input: {
        source: ObservationCaller;
        recipient: ObservationCaller;
        destination: ObservationDestination;
        observationIds: readonly string[];
    }): void;
    bindCaller(claims: ObservationCallerClaims): ObservationCaller;
    bindConsumerIncarnation(caller: ObservationCaller, session: AgentSessionState): void;
    endConsumerExecution(caller: ObservationCaller): void;
    assertConsumerSession(caller: ObservationCaller, sessionId: string): void;
    /** Host provider admission must validate an execution even with zero archived references. */
    assertConsumerExecution(caller: ObservationCaller, sessionId: string, destination: ObservationDestination): void;
    inspectDelegation(input: {
        capability: ObservationDelegation;
        recipient: ObservationCaller;
        parentCaller: ObservationCaller;
        sessionId: string;
        destination: ObservationDestination;
    }): readonly Readonly<ObservationRef>[];
    getDelegatedReferences(caller: ObservationCaller, sessionId: string, destination: ObservationDestination): readonly ObservationRef[] | undefined;
    approveDelegation(input: Mutation & {
        destination: ObservationDestination;
        maxDepth: number;
        maxChildren: number;
        expiresAt: number;
        sourcePolicyIds?: readonly string[];
    }): ObservationDelegationApproval;
    issueDelegationWithApproval(input: Mutation & {
        approval: ObservationDelegationApproval;
        recipient: ObservationCaller;
        observationIds: readonly string[];
        destination: ObservationDestination;
        expiresAt: number;
    }): object;
    inheritDelegatedArchivePolicies(input: Mutation & {
        approval: ObservationDelegationApproval;
        capability: ObservationDelegation;
        recipient: ObservationCaller;
    }): void;
    issueDelegationReturn(input: Mutation & {
        approval: ObservationDelegationApproval;
        recipient: ObservationCaller;
        observationIds: readonly string[];
        destination: ObservationDestination;
        expiresAt?: number;
    }): object;
    issueDelegationMessage(input: Mutation & {
        approval: ObservationDelegationApproval;
        recipient: ObservationCaller;
        observationIds: readonly string[];
        destination: ObservationDestination;
        expiresAt?: number;
    }): object;
    validateDelegationMessage(input: {
        capability: ObservationDelegation;
        issuer: ObservationCaller;
        recipient: ObservationCaller;
        destination: ObservationDestination;
    }): void;
    attachDelegationReturn(input: {
        capability: ObservationDelegation;
        recipient: ObservationCaller;
    }): void;
    issueDelegation(input: Mutation & {
        recipient: ObservationCaller;
        observationIds: readonly string[];
        destination: ObservationDestination;
        expiresAt: number;
    }): ObservationDelegation;
    bindDelegatedCaller(input: {
        capability: ObservationDelegation;
        recipient: ObservationCaller;
    }): ObservationCaller;
    revokeDelegation(input: Mutation & {
        capability: ObservationDelegation;
    }): void;
    revokeDelegationApproval(input: Mutation & {
        approval: ObservationDelegationApproval;
    }): void;
    setArchivePolicy(input: Mutation & {
        policy: ObservationArchivePolicy;
    }): void;
    revokePolicy(input: Mutation & {
        policyId: string;
    }): void;
    begin(input: Mutation & {
        invocationId: string;
        toolName: string;
        sourceAdapterId: string;
        sourceDescriptor: string;
    }): ObservationCapture;
    append(input: Mutation & {
        capture: ObservationCapture;
        text: string;
    }): void;
    finalize(input: Mutation & {
        capture: ObservationCapture;
    } & Facts): ObservationRef;
    reviseTerminal(input: Mutation & {
        id: string;
        outcome: NonNullable<ObservationRef["outcome"]>;
    }): ObservationRef;
    revokeCaller(input: Mutation & {
        target: ObservationCaller;
    }): void;
    read(input: {
        caller: object;
        id: string;
        offset: number;
        maxBytes: number;
        destination: ObservationDestination;
    }): {
        content: string;
        nextOffset: number;
        eof: boolean;
        contentHash: string;
        complete: boolean;
        dependencies: readonly Readonly<{
            authority: Readonly<{}>;
            key: string;
            epoch: number;
        }>[];
    };
    clear(input: Mutation & {
        id: string;
    }): void;
    pin(input: Mutation & {
        id: string;
        referenceId: string;
    }): void;
    unpin(input: Mutation & {
        id: string;
        referenceId: string;
    }): void;
    endSession(input: Mutation): void;
    dispose(): void;
};
export {};
