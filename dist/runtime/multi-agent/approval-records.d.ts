/** Original pure persistent scalar contracts. These declarations grant no authority. */
type MultiAgentApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'invalidated';
type MultiAgentApprovalReason = 'user_denied' | 'approval_deadline' | 'actor_deadline' | 'actor_aborted' | 'permission_revoked' | 'descriptor_changed' | 'scope_disposed' | 'factory_disposed' | 'turn_sealed' | 'restart' | 'approval_persistence_failed';
interface MultiAgentApprovalDurable {
    approvalId: string;
    bootId: string;
    profileId: string;
    workspaceId: string;
    threadId: string;
    groupId: string;
    agentId: string;
    turn: number;
    turnId: string;
    sourceTaskId?: string;
    canonicalName: string;
    toolName: string;
    cwd: string;
    ownerId: string;
    slotId: string;
    capabilityId: string;
    revision: number;
    permissionRevision: number;
    invocationNonce: string;
    inputSha256: string;
    inputByteLength: number;
    issuedAt: number;
    minDeadlineAt: number;
    status: MultiAgentApprovalStatus;
    persistenceState: 'confirmed' | 'unknown';
    reason?: MultiAgentApprovalReason;
}
interface ApprovalRequestOperation {
    groupId: string;
    operationId: string;
    requestHash: string;
    command: 'approval_request';
    applyState: 'prepared' | 'applied' | 'unknown';
    result: {
        approval: MultiAgentApprovalDurable;
    };
}
interface WorkspaceExecutionAuthorizationRow {
    profileId: string;
    workspaceId: string;
    permissionRevision: number;
    executionAllowed: boolean;
    updatedAt: number;
    actorId: string | null;
    lastReceiptJson: string | null;
}
interface MultiAgentApprovalEventPayload {
    approvalId: string;
    status: MultiAgentApprovalStatus;
    persistenceState: 'confirmed' | 'unknown';
    reason?: MultiAgentApprovalReason;
}
export declare const MAX_CONTENT_BYTES: number;
export declare const APPROVAL_STATUSES: readonly MultiAgentApprovalStatus[];
export declare const APPROVAL_REASONS: readonly MultiAgentApprovalReason[];
export declare function boundedString(value: unknown, maximum?: number): asserts value is string;
export declare function safeInteger(value: unknown, minimum?: number): asserts value is number;
export declare function captureApprovalOperation(value: unknown): ApprovalRequestOperation;
/**
 * Admission invariant shared by transport and every pending-row writer. A
 * visible request must fit all legal finalizations, including their reason.
 * Read/recovery capture deliberately keeps the original current-row contract.
 */
export declare function captureApprovalOperationForWrite(value: unknown): ApprovalRequestOperation;
export declare function captureWorkspaceAuthorization(value: unknown): WorkspaceExecutionAuthorizationRow;
export declare function approvalEvent(approval: MultiAgentApprovalDurable): MultiAgentApprovalEventPayload;
export declare function captureApprovalEvent(value: unknown): MultiAgentApprovalEventPayload;
export {};
