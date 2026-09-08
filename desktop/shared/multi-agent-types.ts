import type { GuardFailure, HostDeliveryRecord } from '../../src/runtime/task-host/delivery-types.js';
/** Public, serializable multi-agent contract. No runtime handles or provider secrets. */
export type DesktopAgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'interrupted' | 'closed';
export type MultiAgentSender = { kind: 'agent'; agentId: string } | { kind: 'user'; actorId: string };
export type MultiAgentDeliveryState = 'unread' | 'consuming' | 'context_applied';

/** Service-owned fact; neither this public projection nor durable IDs grant execution. */
export interface ExecutionAuthorizationSnapshot {
  permissionRevision: number; executionAllowed: boolean; persistenceState: 'confirmed' | 'unknown'; bootId: string;
}
export interface ExecutionAuthorizationRetry {
  operationId: string; expectedPermissionRevision: number; executionAllowed: boolean; confirm: true;
}
export interface ExecutionAuthorizationReceipt {
  operationId: string; state: 'applied' | 'unknown'; permissionRevision: number; executionAllowed: boolean;
  persistenceState: 'confirmed' | 'unknown'; outcome?: 'rejected'; error?: string;
}
export interface ExecutionAuthorizationReceiptEnvelope { requestHash: string; receipt: ExecutionAuthorizationReceipt }
export type ExecutionAuthorizationUserSnapshot = ExecutionAuthorizationSnapshot & { pendingOperation?: ExecutionAuthorizationRetry };
export type ExecutionAuthorizationOperation = { kind: 'receipt'; receipt: ExecutionAuthorizationReceipt }
  | { kind: 'not_found' | 'receipt_expired_unknown'; authorization: ExecutionAuthorizationUserSnapshot };
export interface ExecutionAuthorizationTransport { subscriptionId: string; authorization: ExecutionAuthorizationUserSnapshot }
export interface WorkspaceExecutionAuthorizationRow {
  profileId: string; workspaceId: string; permissionRevision: number; executionAllowed: boolean; updatedAt: number;
  actorId: string | null; lastReceiptJson: string | null;
}
export type MultiAgentApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'invalidated';
export type MultiAgentApprovalReason = 'user_denied' | 'approval_deadline' | 'actor_deadline' | 'actor_aborted'
  | 'permission_revoked' | 'descriptor_changed' | 'scope_disposed' | 'factory_disposed' | 'turn_sealed' | 'restart' | 'approval_persistence_failed';
/** Strict durable scalar metadata. Never contains an actor, tool, grant, input, or canDecide. */
export interface MultiAgentApprovalDurable {
  approvalId: string; bootId: string; profileId: string; workspaceId: string; threadId: string; groupId: string;
  agentId: string; turn: number; turnId: string; sourceTaskId?: string;
  canonicalName: string; toolName: string; cwd: string; ownerId: string; slotId: string; capabilityId: string;
  revision: number; permissionRevision: number; invocationNonce: string; inputSha256: string; inputByteLength: number;
  issuedAt: number; minDeadlineAt: number; status: MultiAgentApprovalStatus; persistenceState: 'confirmed' | 'unknown'; reason?: MultiAgentApprovalReason;
}
export interface ApprovalRequestOperation extends MultiAgentOperation {
  command: 'approval_request'; result: { approval: MultiAgentApprovalDurable };
}
export interface MultiAgentApprovalEventPayload {
  approvalId: string; status: MultiAgentApprovalStatus; persistenceState: 'confirmed' | 'unknown'; reason?: MultiAgentApprovalReason;
}
export interface MultiAgentApprovalInputPage {
  offset: number; base64: string; nextOffset: number; byteLength: number; sha256: string;
}
export interface MultiAgentApprovalView {
  approvalId: string; threadId: string; groupId: string; bootId: string; agentId: string;
  turn: number; turnId: string; sourceTaskId?: string; toolName: string; cwd: string;
  issuedAt: number; minDeadlineAt: number; inputSha256: string; inputByteLength: number;
  status: MultiAgentApprovalStatus; persistenceState: 'confirmed' | 'unknown'; canDecide: boolean;
  reason?: MultiAgentApprovalReason; inputPage?: MultiAgentApprovalInputPage;
}
export type MultiAgentPendingApproval = Pick<MultiAgentApprovalView,
  'approvalId' | 'agentId' | 'turn' | 'turnId' | 'minDeadlineAt' | 'status' | 'persistenceState' |
  'canDecide' | 'inputSha256' | 'inputByteLength' | 'reason'>;
export interface MultiAgentApprovalFailure { groupId: string; bootId: string; code: 'multi_agent_approval_persistence_failed' }
export interface MultiAgentApprovalInput { threadId: string; groupId: string; approvalId: string; inputOffset?: number }
export interface MultiAgentApprovalDecisionInput {
  threadId: string; groupId: string; approvalId: string; operationId: string; decision: 'approve' | 'deny';
}

export interface DesktopAgentSnapshot {
  id: string;
  parentId: string | null;
  taskName: string;
  canonicalName: string;
  depth: number;
  status: DesktopAgentStatus;
  turn: number;
  turnId?: string;
  createdAt: number;
  executionActive: boolean;
  sessionResident: boolean;
  runtimeResident: boolean;
  resourcesReleased: boolean;
  cleanupPending: boolean;
  resumable: boolean;
  stopState: 'none' | 'requested' | 'stalled';
  closeReason: 'user' | 'ttl' | 'capacity' | 'restart' | 'shutdown' | null;
  activationState: 'prepared' | 'activating' | 'active' | 'settled';
  unreadMessages: number;
  phase?: string;
  currentTool?: string;
  startedAt?: number;
  endedAt?: number;
  lastActivityAt?: number;
  activityRevision?: number;
  error?: string;
  cleanupError?: string;
  lastResult?: string;
  resultContentId?: string;
  sourceTaskId?: string;
  hostDeliveryStatus?: HostDeliveryRecord['status'];
  guardFailure?: GuardFailure;
  hostDeliveryCleanupPending?: boolean;
  usage?: { inputTokens: number; outputTokens: number };
  presentationOrdinal?: number;
  taskSummary?: string;
  resultSummary?: string;
  toolsCompleted?: number;
  toolsFailed?: number;
  toolCounts?: Record<string, number>;
  otherToolCount?: number;
  toolStatisticsComplete?: boolean;
}

export interface DesktopMultiAgentGroup {
  groupId: string;
  threadId: string;
  bootId: string;
  historicalOnly: boolean;
  createdAt: number;
  lastSeq: number;
  byteUsage: number;
  currentRootEpoch: number;
  nextRootEpoch: number;
  mutationBlockedReason: string | null;
  /** Missing only on pre-v2 historical records; never upgrade an existing group. */
  permissionRevision?: number;
}

export interface MultiAgentMessage {
  messageId: string;
  groupId: string;
  sender: MultiAgentSender;
  receiverId: string;
  originalReceiverId?: string;
  kind: 'message' | 'result' | 'error';
  preview: string;
  contentId?: string;
  truncated: boolean;
  deliveryState: MultiAgentDeliveryState;
  claimId: string | null;
  turnId: string | null;
  createdAt: number;
}

export interface MultiAgentDrainedBatch { claimId: string | null; messages: MultiAgentMessage[] }
export interface DesktopMailboxPort {
  drainInput(): Promise<MultiAgentDrainedBatch>;
  confirmApplied(claimId: string): Promise<void>;
  returnClaim(claimId: string): Promise<void>;
  trySealTurn(input?: { limitReached?: boolean; outcome?: 'completed' | 'failed' | 'interrupted' }): Promise<{
    kind: 'sealed' | 'continue' | 'limit_reached'; batch?: MultiAgentDrainedBatch;
  }>;
}

export type MultiAgentEventKind = 'status' | 'message_sent' | 'message_consumed' | 'output' | 'result' | 'usage' | 'cleanup' | 'artifact' | 'tool_finished' | 'delivery' | 'approval';
export interface MultiAgentDurableEvent {
  schemaVersion: 1;
  channel: 'durable';
  groupId: string;
  seq: number;
  eventId: string;
  agentId: string;
  turnId?: string;
  kind: MultiAgentEventKind;
  timestamp: number;
  payload: Record<string, unknown>;
}

export type MultiAgentEnvelope = MultiAgentDurableEvent | {
  schemaVersion: 1; channel: 'activity'; groupId: string; agentId: string; turnId: string;
  activityRevision: number; timestamp: number; phase: string; currentTool?: string;
} | {
  channel: 'runtime_error'; groupId: string; code: string;
  threadId?: never; bootId?: never; approvalPersistenceState?: never;
} | {
  channel: 'runtime_error'; groupId: string; code: 'multi_agent_approval_persistence_failed';
  threadId: string; bootId: string; approvalPersistenceState: 'unknown';
} | {
  channel: 'group_changed'; threadId: string; threadRevision: number; oldGroupId: string | null; newGroupId: string | null;
  threadDeleteState?: 'none' | 'delete_pending' | 'deleted'; hasAgentHistory?: boolean; pendingApprovalCount?: number;
} | {
  channel: 'resync_required'; groupId: string;
};

export interface MultiAgentPage<T> { items: T[]; nextCursor: string | null }
export interface MultiAgentGroupSnapshot {
  threadId: string;
  activeGroupId: string | null;
  threadRevision: number;
  threadDeleteState?: 'none' | 'delete_pending' | 'deleted';
  hasAgentHistory?: boolean;
  group: DesktopMultiAgentGroup | null;
  root: DesktopAgentSnapshot | null;
  agents: DesktopAgentSnapshot[];
  residentAgents: DesktopAgentSnapshot[];
  nextAgentCursor: string | null;
  lastSeq: number;
  counts: { total: number; running: number; completed: number; failed: number; unread: number };
  runtimeError?: string;
  pendingApprovals?: MultiAgentPendingApproval[];
  pendingApprovalCount?: number;
  approvalFailure?: MultiAgentApprovalFailure;
}

export interface MultiAgentScopeInput { threadId: string; groupId?: string }
export interface MultiAgentControlInput extends MultiAgentScopeInput {
  groupId: string; agentId: string; operationId: string; expectedTurn: number;
}
export interface MultiAgentMessageInput extends MultiAgentControlInput { message: string }
export interface MultiAgentResetInput {
  threadId: string; expectedGroupId: string | null; operationId: string; confirmTerminate: true;
}
export interface MultiAgentThreadDeletionInput {
  threadId: string; operationId: string; expectedThreadRevision: number; confirmTerminate: true;
}
export interface MultiAgentThreadDeletionSnapshot {
  threadId: string; threadRevision: number; deleteState: 'none' | 'delete_pending' | 'deleted';
  operation: MultiAgentControlResult | null;
}
export interface MultiAgentResourceInput {
  threadId: string; groupId: string; resourceId: string; action: 'keep' | 'retryCleanup'; operationId: string;
}
export interface MultiAgentControlResult {
  operationId: string;
  state: 'applied' | 'queued_next_admission' | 'cleanup_pending' | 'completed' | 'unknown';
  targetAgentId?: string;
  expectedTurn?: number;
  messageId?: string;
  resourcesReleased?: boolean;
  cleanupPending?: boolean;
  groupId?: string;
  outcome?: 'cancelled' | 'rejected';
  error?: string;
}
export interface MultiAgentSubscriptionInput extends MultiAgentScopeInput { subscriptionId: string; afterSeq?: number }
export interface MultiAgentSubscriptionResult { subscriptionId: string; snapshot: MultiAgentGroupSnapshot }
export interface MultiAgentTransport { subscriptionId: string; envelope: MultiAgentEnvelope }

export interface MultiAgentEventsPage { items: MultiAgentDurableEvent[]; nextAfterSeq: number; headSeq: number; hasMore: boolean }
/** Semantic renderer surface. Ownership and requestSource are supplied only by main. */
export interface MultiAgentDesktopAPI {
  getLocalExecutionWorkspace(input: Record<string, never>): Promise<{ cwd: string }>;
  getMultiAgentApproval(input: MultiAgentApprovalInput): Promise<MultiAgentApprovalView>;
  decideMultiAgentApproval(input: MultiAgentApprovalDecisionInput): Promise<MultiAgentControlResult>;
  getLocalExecutionAuthorization(input: Record<string, never>): Promise<ExecutionAuthorizationUserSnapshot>;
  setLocalExecutionAuthorization(input: ExecutionAuthorizationRetry): Promise<ExecutionAuthorizationReceipt>;
  getLocalExecutionAuthorizationOperation(input: { operationId: string }): Promise<ExecutionAuthorizationOperation>;
  subscribeLocalExecutionAuthorization(input: { subscriptionId: string }, handler: (transport: ExecutionAuthorizationTransport) => void): Promise<ExecutionAuthorizationTransport>;
  unsubscribeLocalExecutionAuthorization(input: { subscriptionId: string }): Promise<void>;
  getMultiAgentSnapshot(input: MultiAgentScopeInput): Promise<MultiAgentGroupSnapshot>;
  listMultiAgentGroups(input: { threadId: string; cursor?: string }): Promise<MultiAgentPage<DesktopMultiAgentGroup>>;
  listMultiAgents(input: MultiAgentScopeInput & { groupId: string; cursor?: string }): Promise<MultiAgentPage<DesktopAgentSnapshot>>;
  getMultiAgentEvents(input: MultiAgentScopeInput & { groupId: string; afterSeq: number; limit?: number }): Promise<MultiAgentEventsPage>;
  getAgentContent(input: MultiAgentScopeInput & { groupId: string; contentId: string; offset?: number }): Promise<MultiAgentContentPage>;
  getMultiAgentOperation(input: MultiAgentScopeInput & { groupId: string; operationId: string }): Promise<MultiAgentOperation | null>;
  getMultiAgentResources(input: MultiAgentScopeInput & { groupId: string; cursor?: string }): Promise<MultiAgentPage<MultiAgentManagedResource>>;
  resolveMultiAgentResource(input: MultiAgentResourceInput): Promise<MultiAgentControlResult>;
  resetMultiAgentGroup(input: MultiAgentResetInput): Promise<MultiAgentControlResult>;
  getMultiAgentThreadDeletion(input: { threadId: string }): Promise<MultiAgentThreadDeletionSnapshot>;
  deleteMultiAgentThread(input: MultiAgentThreadDeletionInput): Promise<MultiAgentControlResult>;
  sendAgentMessage(input: MultiAgentMessageInput): Promise<MultiAgentControlResult>;
  followupAgent(input: MultiAgentMessageInput): Promise<MultiAgentControlResult>;
  interruptAgent(input: MultiAgentControlInput): Promise<MultiAgentControlResult>;
  closeAgent(input: MultiAgentControlInput): Promise<MultiAgentControlResult>;
  subscribeMultiAgents(input: MultiAgentSubscriptionInput, listener: (event: MultiAgentTransport) => void): Promise<MultiAgentSubscriptionResult>;
  unsubscribeMultiAgents(input: { subscriptionId: string }): Promise<void>;
}

export interface MultiAgentContent {
  contentId: string; groupId: string; agentId: string; utf8Text: string;
  byteLength: number; sha256: string; truncated: boolean;
}
export interface MultiAgentContentPage {
  contentId: string; base64: string; nextOffset: number; byteLength: number; sha256: string; truncated: boolean;
}

export interface MultiAgentRootBinding {
  sourceTaskId: string; groupId: string; threadId: string; rootTurnId: string; rootEpoch: number;
  preparationId: string; bootId: string;
  phase: 'preparing' | 'queued' | 'active' | 'settled' | 'abandoned';
  status: DesktopAgentStatus;
  delivery?: HostDeliveryRecord;
}
export interface MultiAgentOperation {
  groupId: string; operationId: string; requestHash: string; command: string;
  applyState: 'prepared' | 'applied' | 'unknown';
  result: Record<string, unknown>;
}
export interface MultiAgentManagedResource {
  resourceId: string; groupId: string; agentId: string; ownerBootId: string;
  kind: 'worktree'; canonicalPath: string; allocationToken: string;
  repositoryRoot?: string;
  cleanupPolicy: 'keep' | 'delete'; cleanupEligibility: 'auto' | 'manual';
  state: 'planned' | 'allocated' | 'cleanup_pending' | 'released' | 'retained_by_policy' | 'unknown';
  lastError?: string;
}
