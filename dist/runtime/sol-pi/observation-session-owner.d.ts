import { type SessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
import { type SessionStore } from '../../ai/runtime/session-store/store.js';
import { type ProviderAncestorAdmission } from './compound-provider-admission.js';
import { type NativeObservationProvenancePort, type ObservationProvenanceReceipt } from './observation-provenance.js';
import type { Tool, Message, ToolDefinition, ModelAdapter } from '../../types.js';
import type { StreamOptions } from '../../ai/runtime/model-capabilities.js';
import type { createFullSendCounter } from './full-send-counter.js';
import type { AgentSessionState, AgentSessionSnapshot } from '../../ai/runtime/session.js';
import { type ProtectedObservationClosure } from '../../ai/runtime/protected-observation-closure.js';
import type { ObservationCollectorPort } from './collector-port.js';
import type { ObservationExecutionOwner } from './observation-execution-scope.js';
import type { createObservationService, ObservationCaller, ObservationDestination, ObservationRef } from './observation-service.js';
import { type ProviderDisclosureContext } from './provider-disclosure.js';
import { type VerifiedCapacityProfile } from './capacity-admission.js';
type Service = ReturnType<typeof createObservationService>;
type NativeSource = Parameters<ObservationCollectorPort['begin']>[0];
/** Exact, host-constructed source selector. Source text is hashed by the service. */
export declare function describeObservationSource(input: NativeSource): string;
export interface ObservationProjectionDiagnostics {
    preparedRequests: number;
    projectedRequests: number;
    skippedRequests: number;
    fullObservationViews: number;
    referenceObservationViews: number;
    unknownFullObservationViews: number;
    authorizedPages: number;
    reasons: Record<string, number>;
}
export interface ObservationRequestInput {
    logicalInvocationId: string;
    messages: Message[];
    tools: ToolDefinition[];
    systemPrompt: string;
    options?: StreamOptions;
    requestPreview?: ModelAdapter['getObservationRequestPreview'];
}
export interface ObservationPreparedRequest {
    messages: Message[];
    providerDisclosure?: ProviderDisclosureContext;
    projectionStatus: 'projected' | 'skipped';
}
export interface ObservationSessionOwner extends ObservationExecutionOwner {
    stopNewCapture(): void;
    getMode(): 'active' | 'recall-only';
    assertSession(session: AgentSessionState): void;
    collectorFor(invocationId: string): ObservationCollectorPort;
    projectToolResult(invocationId: string, legacyResult: string): Promise<string>;
    getResultProvenance(invocationId: string): NativeObservationProvenancePort | undefined;
    finalizeToolResult(invocationId: string, finalContent: string): ObservationProvenanceReceipt | undefined;
    getFinalizedToolResult(invocationId: string): ObservationProvenanceReceipt | undefined;
    prepareRequest(input: ObservationRequestInput): Promise<ObservationPreparedRequest>;
    publishCurrentHistory?(input: {
        strictPrivateProtocol: boolean;
    }): Promise<void>;
    /** Exact host anchors: only qualified archived native segments may become recall references. */
    prepareSemanticAnchors(messages: readonly Message[]): Message[];
    getProjectionDiagnostics(): Readonly<ObservationProjectionDiagnostics>;
    read(id: string, offset: number, maxBytes: number): Promise<string>;
    dispose(): void;
}
/** Host factory only. The returned one-shot projector stays in Registry's private
 * execution stack; native tools never receive the lease or publication capability. */
export declare function bindCompoundObservationPublisher(input: {
    owner: ObservationSessionOwner;
    store: SessionStore;
    root: string;
}): (invocationId: string, lease: SessionExecutionLease) => (nativeResult: string) => Promise<string>;
export interface ObservationClosedReadAnchor {
    readonly __closedReadAnchor?: never;
}
/** No execution port: only this actual owner's completed disposal can seal it. */
export declare function getObservationClosedReadAnchor(owner: ObservationSessionOwner): ObservationClosedReadAnchor;
export declare function getObservationClosedReadBinding(anchor: ObservationClosedReadAnchor, recipientOwner: ObservationSessionOwner): Readonly<{
    service: {
        transportPort: import("./transport-lease.js").TransportAuthorityPort;
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
        bindCaller(claims: import("./observation-service.js").ObservationCallerClaims): ObservationCaller;
        bindConsumerIncarnation(caller: ObservationCaller, session: AgentSessionState): void;
        endConsumerExecution(caller: ObservationCaller): void;
        assertConsumerSession(caller: ObservationCaller, sessionId: string): void;
        assertConsumerExecution(caller: ObservationCaller, sessionId: string, destination: ObservationDestination): void;
        inspectDelegation(input: {
            capability: import("./observation-service.js").ObservationDelegation;
            recipient: ObservationCaller;
            parentCaller: ObservationCaller;
            sessionId: string;
            destination: ObservationDestination;
        }): readonly Readonly<ObservationRef>[];
        getDelegatedReferences(caller: ObservationCaller, sessionId: string, destination: ObservationDestination): readonly ObservationRef[] | undefined;
        approveDelegation(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            destination: ObservationDestination;
            maxDepth: number;
            maxChildren: number;
            expiresAt: number;
            sourcePolicyIds?: readonly string[];
        }): import("./observation-service.js").ObservationDelegationApproval;
        issueDelegationWithApproval(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            approval: import("./observation-service.js").ObservationDelegationApproval;
            recipient: ObservationCaller;
            observationIds: readonly string[];
            destination: ObservationDestination;
            expiresAt: number;
        }): object;
        inheritDelegatedArchivePolicies(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            approval: import("./observation-service.js").ObservationDelegationApproval;
            capability: import("./observation-service.js").ObservationDelegation;
            recipient: ObservationCaller;
        }): void;
        issueDelegationReturn(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            approval: import("./observation-service.js").ObservationDelegationApproval;
            recipient: ObservationCaller;
            observationIds: readonly string[];
            destination: ObservationDestination;
            expiresAt?: number;
        }): object;
        issueDelegationMessage(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            approval: import("./observation-service.js").ObservationDelegationApproval;
            recipient: ObservationCaller;
            observationIds: readonly string[];
            destination: ObservationDestination;
            expiresAt?: number;
        }): object;
        validateDelegationMessage(input: {
            capability: import("./observation-service.js").ObservationDelegation;
            issuer: ObservationCaller;
            recipient: ObservationCaller;
            destination: ObservationDestination;
        }): void;
        attachDelegationReturn(input: {
            capability: import("./observation-service.js").ObservationDelegation;
            recipient: ObservationCaller;
        }): void;
        issueDelegation(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            recipient: ObservationCaller;
            observationIds: readonly string[];
            destination: ObservationDestination;
            expiresAt: number;
        }): import("./observation-service.js").ObservationDelegation;
        bindDelegatedCaller(input: {
            capability: import("./observation-service.js").ObservationDelegation;
            recipient: ObservationCaller;
        }): ObservationCaller;
        revokeDelegation(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            capability: import("./observation-service.js").ObservationDelegation;
        }): void;
        revokeDelegationApproval(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            approval: import("./observation-service.js").ObservationDelegationApproval;
        }): void;
        setArchivePolicy(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            policy: import("./observation-service.js").ObservationArchivePolicy;
        }): void;
        revokePolicy(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            policyId: string;
        }): void;
        begin(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            invocationId: string;
            toolName: string;
            sourceAdapterId: string;
            sourceDescriptor: string;
        }): import("./observation-service.js").ObservationCapture;
        append(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            capture: import("./observation-service.js").ObservationCapture;
            text: string;
        }): void;
        finalize(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            capture: import("./observation-service.js").ObservationCapture;
        } & {
            outcome?: "success" | "error" | "cancelled" | "timeout" | undefined;
            executionState: "running" | "termination_pending" | "interrupted" | "terminal";
            incompleteReason?: string | undefined;
        }): ObservationRef;
        reviseTerminal(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            id: string;
            outcome: NonNullable<ObservationRef["outcome"]>;
        }): ObservationRef;
        revokeCaller(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
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
        clear(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            id: string;
        }): void;
        pin(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            id: string;
            referenceId: string;
        }): void;
        unpin(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            id: string;
            referenceId: string;
        }): void;
        endSession(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        }): void;
        dispose(): void;
    };
    validate: () => void;
    current: () => void;
}>;
/** Durable facts only; reconstruction always obtains fresh current recipient rights. */
export interface PublishedClosureReadFacts {
    version: 1;
    sourceSessionId: string;
    recipientSessionId: string;
    historyDigest: string;
    closure: ProtectedObservationClosure;
}
export interface PublishedClosureReadAnchor {
    readonly opaquePublishedClosureReadAnchor: never;
}
/** Actual publication writers only: no caller-supplied body or reference set. */
export declare function capturePublishedClosureRead(sourceOwner: ObservationSessionOwner, recipientOwner: ObservationSessionOwner): PublishedClosureReadAnchor;
/** Host Main recovery only, after verifying the original immutable SQLite row.
 * This descriptor is not authority: both restored owners and every original
 * reference must still have current grants before a fresh anchor is returned. */
export declare function restorePublishedClosureRead(sourceOwner: ObservationSessionOwner, recipientOwner: ObservationSessionOwner, value: PublishedClosureReadFacts): PublishedClosureReadAnchor;
export declare function getPublishedClosureReadBinding(anchor: PublishedClosureReadAnchor): Readonly<{
    service: {
        transportPort: import("./transport-lease.js").TransportAuthorityPort;
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
        bindCaller(claims: import("./observation-service.js").ObservationCallerClaims): ObservationCaller;
        bindConsumerIncarnation(caller: ObservationCaller, session: AgentSessionState): void;
        endConsumerExecution(caller: ObservationCaller): void;
        assertConsumerSession(caller: ObservationCaller, sessionId: string): void;
        assertConsumerExecution(caller: ObservationCaller, sessionId: string, destination: ObservationDestination): void;
        inspectDelegation(input: {
            capability: import("./observation-service.js").ObservationDelegation;
            recipient: ObservationCaller;
            parentCaller: ObservationCaller;
            sessionId: string;
            destination: ObservationDestination;
        }): readonly Readonly<ObservationRef>[];
        getDelegatedReferences(caller: ObservationCaller, sessionId: string, destination: ObservationDestination): readonly ObservationRef[] | undefined;
        approveDelegation(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            destination: ObservationDestination;
            maxDepth: number;
            maxChildren: number;
            expiresAt: number;
            sourcePolicyIds?: readonly string[];
        }): import("./observation-service.js").ObservationDelegationApproval;
        issueDelegationWithApproval(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            approval: import("./observation-service.js").ObservationDelegationApproval;
            recipient: ObservationCaller;
            observationIds: readonly string[];
            destination: ObservationDestination;
            expiresAt: number;
        }): object;
        inheritDelegatedArchivePolicies(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            approval: import("./observation-service.js").ObservationDelegationApproval;
            capability: import("./observation-service.js").ObservationDelegation;
            recipient: ObservationCaller;
        }): void;
        issueDelegationReturn(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            approval: import("./observation-service.js").ObservationDelegationApproval;
            recipient: ObservationCaller;
            observationIds: readonly string[];
            destination: ObservationDestination;
            expiresAt?: number;
        }): object;
        issueDelegationMessage(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            approval: import("./observation-service.js").ObservationDelegationApproval;
            recipient: ObservationCaller;
            observationIds: readonly string[];
            destination: ObservationDestination;
            expiresAt?: number;
        }): object;
        validateDelegationMessage(input: {
            capability: import("./observation-service.js").ObservationDelegation;
            issuer: ObservationCaller;
            recipient: ObservationCaller;
            destination: ObservationDestination;
        }): void;
        attachDelegationReturn(input: {
            capability: import("./observation-service.js").ObservationDelegation;
            recipient: ObservationCaller;
        }): void;
        issueDelegation(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            recipient: ObservationCaller;
            observationIds: readonly string[];
            destination: ObservationDestination;
            expiresAt: number;
        }): import("./observation-service.js").ObservationDelegation;
        bindDelegatedCaller(input: {
            capability: import("./observation-service.js").ObservationDelegation;
            recipient: ObservationCaller;
        }): ObservationCaller;
        revokeDelegation(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            capability: import("./observation-service.js").ObservationDelegation;
        }): void;
        revokeDelegationApproval(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            approval: import("./observation-service.js").ObservationDelegationApproval;
        }): void;
        setArchivePolicy(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            policy: import("./observation-service.js").ObservationArchivePolicy;
        }): void;
        revokePolicy(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            policyId: string;
        }): void;
        begin(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            invocationId: string;
            toolName: string;
            sourceAdapterId: string;
            sourceDescriptor: string;
        }): import("./observation-service.js").ObservationCapture;
        append(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            capture: import("./observation-service.js").ObservationCapture;
            text: string;
        }): void;
        finalize(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            capture: import("./observation-service.js").ObservationCapture;
        } & {
            outcome?: "success" | "error" | "cancelled" | "timeout" | undefined;
            executionState: "running" | "termination_pending" | "interrupted" | "terminal";
            incompleteReason?: string | undefined;
        }): ObservationRef;
        reviseTerminal(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            id: string;
            outcome: NonNullable<ObservationRef["outcome"]>;
        }): ObservationRef;
        revokeCaller(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
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
        clear(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            id: string;
        }): void;
        pin(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            id: string;
            referenceId: string;
        }): void;
        unpin(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        } & {
            id: string;
            referenceId: string;
        }): void;
        endSession(input: {
            requestSource: "user" | "agent" | "scheduler";
            caller: ObservationCaller;
        }): void;
        dispose(): void;
    };
    facts: PublishedClosureReadFacts;
    validate: () => void;
    current: () => void;
}>;
/** Host child installer only; must run before the first provider preparation. */
export declare function bindObservationProviderAdmission(owner: ObservationSessionOwner, capability: ProviderAncestorAdmission): void;
type ObservationPublicationBarrier = (facts: Readonly<{
    sessionId: string;
    closure: AgentSessionSnapshot['protectedObservationClosure'];
}>) => Promise<void>;
/** Additional host durability barrier, never an authorization or tool capability. Fixed before first publication. */
export declare function bindObservationPublicationBarrier(owner: ObservationSessionOwner, barrier: ObservationPublicationBarrier): void;
/** Host factory introspection; persisted DTOs and ordinary owner-shaped objects have no binding. */
export declare function getObservationSessionOwnerHostBinding(owner: ObservationSessionOwner): {
    service: Service;
    caller: ObservationCaller;
    session: AgentSessionState;
    destination: ObservationDestination;
    counter?: ReturnType<typeof createFullSendCounter>;
    onDispose(listener: () => void): () => void;
    pauseTransport(): Promise<void>;
    assertTransportPaused(): void;
    drainTransport(): Promise<void>;
    waitForCurrentTransport(): Promise<void>;
    resumeTransport(): void;
};
/** Host-only composition: the tool context never receives this wrapping capability. */
export declare function composeCompoundObservationResult(owner: ObservationSessionOwner, invocationId: string, before: string, body: string, after: string): string;
/** Host-only adoption. Caller must already have exact source authorization;
 * model-supplied reference lists cannot invent the child's sticky footprint. */
export declare function adoptDelegatedObservationClosure(parentOwner: ObservationSessionOwner, childOwner: ObservationSessionOwner): Promise<void>;
/** A host-authorized fork may preserve an exact native result's segmentation;
 * generated summaries and changed/unknown text never gain native provenance. */
export declare function inheritDelegatedObservationProjections(parentOwner: ObservationSessionOwner, childOwner: ObservationSessionOwner, snapshot: AgentSessionSnapshot): void;
/** Experimental ordinary CLI owner. Caller policy and durable barrier are host
 * capabilities; creating an owner never grants archive/disclosure permission. */
export declare function createObservationSessionOwner(options: {
    capacityProfile?: VerifiedCapacityProfile;
    fullSendCounter?: ReturnType<typeof createFullSendCounter>;
    service: Service;
    caller: ObservationCaller;
    session: AgentSessionState;
    destination: ObservationDestination;
    persist(snapshot: AgentSessionSnapshot): Promise<void>;
}): ObservationSessionOwner;
/** Register only in this owner's private registry. No caller/model destination fields. */
export declare function createObservationReadTool(owner: ObservationSessionOwner): Tool;
export {};
