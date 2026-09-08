import { vi } from 'vitest';
import type { DesktopAgentSnapshot, MultiAgentApprovalView, MultiAgentPendingApproval, MultiAgentDesktopAPI, MultiAgentGroupSnapshot, MultiAgentTransport } from '../../shared/multi-agent-types';

export type ApprovalView = MultiAgentApprovalView;
export type PendingApproval = MultiAgentPendingApproval;
export type ApprovalSnapshot = MultiAgentGroupSnapshot & { pendingApprovalCount: number; pendingApprovals: PendingApproval[];
  approvalFailure?: { groupId: string; bootId: string; code: 'multi_agent_approval_persistence_failed' } };
export type ApprovalAPI = MultiAgentDesktopAPI;
export function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
export function agent(id: string, ordinal = 0): DesktopAgentSnapshot {
  return { id, parentId: ordinal ? 'root_g' : null, taskName: ordinal ? 'same review name' : 'main', canonicalName: `/${id}`, depth: ordinal ? 1 : 0,
    status: 'running', turn: 3, turnId: `turn-${id}-3`, createdAt: 1, executionActive: true, sessionResident: true, runtimeResident: true,
    resourcesReleased: false, cleanupPending: false, resumable: false, stopState: 'none', closeReason: null, activationState: 'active',
    unreadMessages: 0, ...(ordinal ? { presentationOrdinal: ordinal } : {}) };
}
export function approval(id = 'approval-root', agentId = 'root_g'): ApprovalView {
  return { approvalId: id, threadId: 'thread', groupId: 'g', bootId: 'boot', agentId, turn: 3, turnId: `turn-${agentId}-3`,
    toolName: 'write', cwd: 'workspace', issuedAt: Date.now() - 1000, minDeadlineAt: Date.now() + 60_000,
    inputSha256: 'a'.repeat(64), inputByteLength: 8, status: 'pending', persistenceState: 'confirmed', canDecide: true };
}
export function compact(view: ApprovalView): PendingApproval {
  const { approvalId, agentId, turn, turnId, minDeadlineAt, status, persistenceState, canDecide, inputSha256, inputByteLength, reason } = view;
  return { approvalId, agentId, turn, turnId, minDeadlineAt, status, persistenceState, canDecide, inputSha256, inputByteLength, ...(reason ? { reason } : {}) };
}
export function snapshot(views = [approval()]): ApprovalSnapshot {
  const members = [...new Set(views.map(item => item.agentId))].filter(id => id !== 'root_g').map((id, index) => agent(id, index + 1));
  return { threadId: 'thread', activeGroupId: 'g', threadRevision: 1, threadDeleteState: 'none', hasAgentHistory: members.length > 0,
    group: { groupId: 'g', threadId: 'thread', bootId: 'boot', historicalOnly: false, createdAt: 1, lastSeq: 0, byteUsage: 100,
      currentRootEpoch: 3, nextRootEpoch: 3, mutationBlockedReason: null },
    root: agent('root_g'), agents: members, residentAgents: members, nextAgentCursor: null, lastSeq: 0,
    counts: { total: 1 + members.length, running: 1 + members.length, completed: 0, failed: 0, unread: 0 },
    pendingApprovalCount: views.filter(item => item.canDecide).length, pendingApprovals: views.map(compact) };
}
export function approvalFixture(views = [approval()], initial = snapshot(views)) {
  let current = initial;
  const metadata = new Map(views.map(item => [item.approvalId, item]));
  const subscriptions: Array<{ id: string; listener: (value: MultiAgentTransport) => void }> = [];
  const api = {
    subscribeMultiAgents: vi.fn<MultiAgentDesktopAPI['subscribeMultiAgents']>(async (input, listener) => {
      subscriptions.push({ id: input.subscriptionId, listener }); return { subscriptionId: input.subscriptionId, snapshot: current };
    }),
    unsubscribeMultiAgents: vi.fn(async () => {}), getMultiAgentSnapshot: vi.fn(async () => current),
    getMultiAgentEvents: vi.fn(async () => ({ items: [], nextAfterSeq: 0, headSeq: current.lastSeq, hasMore: false })),
    getMultiAgentApproval: vi.fn<ApprovalAPI['getMultiAgentApproval']>(async input => {
      const value = metadata.get(input.approvalId); if (!value) throw new Error('approval not found'); return value;
    }),
    decideMultiAgentApproval: vi.fn<ApprovalAPI['decideMultiAgentApproval']>(async input => ({ operationId: input.operationId, state: 'applied' })),
    getMultiAgentOperation: vi.fn<MultiAgentDesktopAPI['getMultiAgentOperation']>(async () => null),
    getLocalExecutionAuthorization: vi.fn(async () => ({ bootId: 'boot', permissionRevision: 0, executionAllowed: true, persistenceState: 'confirmed' as const })),
    subscribeLocalExecutionAuthorization: vi.fn<MultiAgentDesktopAPI['subscribeLocalExecutionAuthorization']>(async input => ({ subscriptionId: input.subscriptionId,
      authorization: { bootId: 'boot', permissionRevision: 0, executionAllowed: true, persistenceState: 'confirmed' } })),
    unsubscribeLocalExecutionAuthorization: vi.fn(async () => {}),
    listMultiAgentGroups: vi.fn(async () => ({ items: [current.group!], nextCursor: null })),
    getMultiAgentResources: vi.fn(async () => ({ items: [], nextCursor: null })),
    sendAgentMessage: vi.fn(), followupAgent: vi.fn(), interruptAgent: vi.fn(), closeAgent: vi.fn(),
  };
  return { api: api as typeof api & ApprovalAPI, metadata, subscriptions, current: () => current,
    setSnapshot: (value: ApprovalSnapshot) => { current = value; },
    emit: (envelope: MultiAgentTransport['envelope']) => {
      for (const item of subscriptions) item.listener({ subscriptionId: item.id, envelope });
    },
  };
}
