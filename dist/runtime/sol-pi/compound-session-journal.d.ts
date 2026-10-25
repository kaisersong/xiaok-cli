import { type CompoundProviderAttemptInput, type ProviderTransportState } from './compound-provider-attempt.js';
import { type DirectOperationAdvance, type DirectOperationRecord } from './compound-direct-operation.js';
import { type CompoundTreeAllocationInput } from './compound-tree-budget.js';
import type { SessionStore, PersistedSessionSnapshot } from '../../ai/runtime/session-store/store.js';
import { type SessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
import { type CompoundAdvance, type CompoundOperationInput, type CompoundOperationLedger, type CompoundOperationRecord } from './compound-operation.js';
type Delivery = Pick<CompoundOperationInput, 'inputHash' | 'toolName' | 'permissionGeneration'> & {
    hostProviderInvocationId: string;
    originalToolUseId: string;
};
/** Host-bound journal adapter. It owns no second lock and never invokes tools or
 * approvals. Caller must hold the one shared execution lease across effects. */
export declare function createCompoundSessionJournal(options: {
    store: SessionStore;
    root: string;
    sessionIdentity: string;
    ownerId: string;
    scopeId: string;
    requestSource: 'user' | 'agent' | 'scheduler';
    assertCurrent(): void;
    /** Fixed host allocator; no tool input supplies this port. Called only before
     * a new native record, while all required ancestor leases are already held. */
    reserveMutation?(identity: {
        dispatch: CompoundOperationInput['dispatch'];
        inputHash: string;
    }, lease: SessionExecutionLease): Promise<void>;
}): Readonly<{
    reserveTreeAllocation(input: CompoundTreeAllocationInput, lease: SessionExecutionLease): Promise<{
        allocationId: string;
        created: boolean;
    }>;
    reserveProviderAttempt(input: CompoundProviderAttemptInput, lease: SessionExecutionLease, beforeCommit?: (candidate: PersistedSessionSnapshot) => void): Promise<{
        reservationId: string;
        created: boolean;
        bindingHash: string;
    }>;
    isUnissuedProviderAttemptFailure(error: unknown): boolean;
    cancelUnissuedProviderAttempt(error: unknown, lease: SessionExecutionLease): Promise<void>;
    /** Factual finalization only. The issuing transport must authenticate actual
     * local drain or irrevocable cancellation before calling. Revocation stops
     * new work, but cannot prevent recording an already issued attempt's fate.
     * This instance-local port does not authorize restored JSON or new sends. */
    settleIssuedProviderAttemptFacts(input: {
        reservationId: string;
        transportState: Exclude<ProviderTransportState, "reserved">;
    }, lease: SessionExecutionLease): Promise<void>;
    settleProviderAttempt(input: {
        reservationId: string;
        transportState: Exclude<ProviderTransportState, "reserved">;
    }, lease: SessionExecutionLease): Promise<void>;
    retireProviderAttempt(reservationId: string, context: {
        requestSource: "user" | "agent" | "scheduler";
    }, lease: SessionExecutionLease): Promise<void>;
    read(lease: SessionExecutionLease): Promise<CompoundOperationLedger>;
    createOrGet(input: Delivery, lease: SessionExecutionLease): Promise<{
        operation: import("./compound-operation.js").CompoundOperationTombstone | CompoundOperationRecord;
        created: boolean;
    }>;
    createOrGetDirect(input: Omit<Delivery, "toolName"> & {
        toolName: string;
    }, lease: SessionExecutionLease): Promise<{
        operation: import("./compound-operation.js").CompoundOperationTombstone | DirectOperationRecord;
        created: boolean;
    }>;
    /** Original native preparation only; never a child-runtime/physical receipt.
     * Exact prepared row equality proves this issuer has not advanced effects. */
    settleIssuedPreparedDirectFacts(input: {
        operationId: string;
        outcome: "cancelled" | "denied" | "invalid";
    }, lease: SessionExecutionLease): Promise<void>;
    settleIssuedPreparedCompoundFacts(input: {
        operationId: string;
        outcome: "cancelled" | "denied" | "failed";
    }, lease: SessionExecutionLease): Promise<void>;
    /** A durable native edit is kept. Only its still-undispatched validation may
     * be closed by this original issuer after the execution grant is revoked. */
    settleIssuedCommittedEditFacts(input: {
        operationId: string;
        validationStatus: "cancelled" | "denied";
    }, lease: SessionExecutionLease): Promise<void>;
    advanceDirect(operationId: string, change: DirectOperationAdvance, lease: SessionExecutionLease, beforeCommit?: () => void): Promise<DirectOperationRecord>;
    advance(operationId: string, change: CompoundAdvance, lease: SessionExecutionLease): Promise<CompoundOperationRecord>;
    retire(operationId: string, context: {
        requestSource: "user" | "agent" | "scheduler";
    }, lease: SessionExecutionLease): Promise<void>;
}>;
export {};
