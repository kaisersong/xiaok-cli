import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { MultiAgentCoordinator, type AgentExecutionHandle, type AgentIdentity, type ManagedAgentSession, type MultiAgentEvent, type MultiAgentSnapshot, type PreparedAgentHandle } from '../../src/ai/agents/multi-agent-coordinator.js';
import type { InProcessTaskRuntimeHost, TaskCancellationDecision, TaskRunnerInput } from '../../src/runtime/task-host/task-runtime-host.js';
import type { TaskCreateInput, TaskMultiAgentPreparation, TaskSnapshot } from '../../src/runtime/task-host/types.js';
import type { DesktopAgentSnapshot, DesktopMultiAgentGroup, DesktopMailboxPort, MultiAgentControlResult, MultiAgentRootBinding, MultiAgentPage, MultiAgentGroupSnapshot, MultiAgentEnvelope, MultiAgentThreadDeletionSnapshot } from '../shared/multi-agent-types.js';
import { DesktopExecutionCoordinator, currentExecutionLane, type ExecutionLane, type ExecutionLease, type ExecutionLeaseRequest } from './desktop-execution-coordinator.js';
import { DesktopMultiAgentStore, encodeMultiAgentRow, truncateMultiAgentText, type MultiAgentThreadBinding } from './desktop-multi-agent-store.js';
import { DesktopMultiAgentTurnMailbox, MultiAgentCommandSequencer } from './desktop-multi-agent-mailbox.js';
import type { RuntimeEvent } from '../../src/runtime/events.js';
import type { RuntimeActivity } from '../../src/ai/runtime/events.js';
import { DesktopWorktreeJournalError, type DesktopMultiAgentWorktrees } from './desktop-multi-agent-worktrees.js';
import { desktopSubAgentSummary } from './desktop-subagent-presentation.js';
import type { HostDeliveryReport, HostDeliveryRecord, HostDeliverySource, HostDeliveryRecoveryAuthority, HostDeliveryRecoveryInvocation, HostDeliveryRecoveryReceipt } from '../../src/runtime/task-host/delivery-types.js';
import { assertHostDeliveryAdvance, captureHostDeliveryReport, reconcileHostDeliveryRecords } from './desktop-host-delivery-projection.js';
import type { ExecutionAuthorizationSnapshot, ExecutionAuthorizationRetry, ExecutionAuthorizationReceipt, ExecutionAuthorizationReceiptEnvelope, WorkspaceExecutionAuthorizationRow } from '../shared/multi-agent-types.js';
import type { DesktopApprovalOwner, DesktopApprovalFailure, DesktopMultiAgentApprovalTransport } from './desktop-multi-agent-approval-transport.js';

/** Public fields are diagnostic only. The WeakMap entry is the actual authority. */
export interface DesktopAgentActor { readonly groupId: string; readonly agentId: string; readonly turnId: string }
/** Opaque seed issued by the main runtime bridge, never accepted from IPC/model JSON. */
export interface DesktopAgentSessionSeed { readonly seedId: string }
export interface DesktopMultiAgentUserAccess { readonly accessId: string }
export interface DesktopWorkspaceUserAccess { readonly accessId: string }
interface WorkspaceUserAccessState { actorId: string; profileId: string; workspaceId: string; active: boolean }
interface PendingAuthorization {
  request: ExecutionAuthorizationRetry; requestHash: string; actorId: string;
  originalAllowed: boolean; candidate: number;
}
/** Main factory only. The opaque identity, not this diagnostic id, authorizes reports. */
export interface DesktopHostDeliveryAuthority { readonly ownerId: string }
interface HostDeliveryOwner { host: InProcessTaskRuntimeHost; bootId: string; active: boolean }
interface DeliveryRecoveryOwner {
  host: InProcessTaskRuntimeHost; source: HostDeliverySource; phase: 'host' | 'consumers';
  expectedDeliveryRevision: number; delivery?: HostDeliveryRecord; receipt?: Omit<HostDeliveryRecoveryReceipt, 'authority'>;
}
interface UserAccessState { actorId: string; threadId: string; profileId: string; workspaceId: string; active: boolean }
export interface DesktopMultiAgentUserControl {
  access: DesktopMultiAgentUserAccess; requestSource: Source; groupId: string; agentId: string; operationId: string; expectedTurn: number;
}
export interface DesktopAgentExecutionContext {
  actor: DesktopAgentActor; groupId: string; agentId: string; turnId: string; turn: number;
  rootEpoch: number; cwd: string; effectiveDeadline: number; signal: AbortSignal;
  readonly permissionRevision: number;
  memberTicket: ExecutionLease; mailbox: DesktopMailboxPort;
  sourceTaskId?: string;
}
export interface DesktopMultiAgentServiceOptions {
  store: DesktopMultiAgentStore;
  coordinator: DesktopExecutionCoordinator;
  worktrees?: DesktopMultiAgentWorktrees;
  /** One immutable main-owned execution domain; never renderer supplied. */
  executionDomain?: { profileId: string; workspaceId: string; cwd: string; actorId: string };
  onExecutionAuthorizationChanged?(snapshot: ExecutionAuthorizationSnapshot): void;
  stopForWorkspaceExecutionRevocation?(): Promise<void>;
  createSession(input: {
    groupId: string; identity: AgentIdentity; parent: DesktopAgentExecutionContext; signal: AbortSignal;
    getTurnContext(): DesktopAgentExecutionContext;
    bindWorkingDirectory?(cwd: string): void;
    sessionSeed?: DesktopAgentSessionSeed;
  }): Promise<ManagedAgentSession>;
  closeGraceMs?: number;
  /** Main Goal owner cancellation. Never an agent tool or renderer callback. */
  beforeThreadDeletion?(threadId: string): Promise<void>;
  /** Main Goal and host history lookup, including terminal legacy records. */
  hasUnboundHistory?(threadId: string): Promise<boolean>;
  /** Fixed main adapter; rejection keeps startup unavailable, never warn-and-swallow. */
  onRecoveredHostTerminal?(input: HostDeliveryRecoveryReceipt): Promise<void>;
}
type Source = 'user' | 'agent' | 'scheduler';
export type DesktopGoalChildReadiness = 'ready' | 'waiting_children' | 'children_need_attention';
interface AgentRequest { actor: DesktopAgentActor; requestSource: Source; operationId: string }
interface ActorState { context: DesktopAgentExecutionContext; group: LiveGroup; active: boolean; sealed: boolean; outcome?: DesktopAgentSnapshot['status'] }
interface LiveChild {
  id: string; parentId: string; context: DesktopAgentExecutionContext; prepared: PreparedAgentHandle;
  execution?: AgentExecutionHandle; sessionResident: boolean; fullResult?: string;
  stopRequested: boolean; ttl?: ReturnType<typeof setTimeout>;
  controller: AbortController;
  stopTimer?: ReturnType<typeof setTimeout>;
  followups: PendingFollowup[];
  cwd?: string;
}
interface PendingFollowup {
  lane: ExecutionLane;
  acceptedEpoch?: number;
  operationId: string; callerId: string; message: string; expectedTurn: number;
  readonly sourceTaskId: string | undefined;
  forceNewEpoch: boolean; controller: AbortController; request?: ExecutionLeaseRequest; ticket?: ExecutionLease;
  requestSource: 'agent' | 'user';
}
interface RootPreparation {
  binding: MultiAgentRootBinding; controller: AbortController; request?: ExecutionLeaseRequest;
  ticket?: ExecutionLease; context?: DesktopAgentExecutionContext; started: boolean; preparing: boolean;
  stopTimer?: ReturnType<typeof setTimeout>;
  leaseExpiryDecision?: TaskCancellationDecision;
}
interface ActivityRecord {
  turnId: string; phase: RuntimeActivity['phase']; currentTool?: string; lastActivityAt: number;
  revision: number; lastPublishedAt: number; lastCheckpointAt: number;
  publishTimer?: ReturnType<typeof setTimeout>; checkpointTimer?: ReturnType<typeof setTimeout>;
}
interface LiveGroup {
  id: string; threadId: string; core: MultiAgentCoordinator; commands: MultiAgentCommandSequencer;
  children: Map<string, LiveChild>; root?: RootPreparation; lifetime: AbortController;
  lease?: ExecutionLease; leaseController?: AbortController; deadlineTimer?: ReturnType<typeof setTimeout>;
  frozen?: string; waiters: Set<() => void>;
  approvalFailure?: DesktopApprovalFailure;
  persistenceFailed?: boolean;
  outputs: Map<string, { turnId: string; text: string; timer?: ReturnType<typeof setTimeout> }>;
  activities: Map<string, ActivityRecord>;
  deactivating?: boolean;
}
interface PendingReset {
  access: DesktopMultiAgentUserAccess; threadId: string; expectedGroupId: string | null;
  journalGroupId: string; operationId: string; requestHash: string;
  permissionRevision: number;
}
interface ThreadDeletionScanFacts {
  initialInFlight: Set<string>; inspected: Set<string>; targetTasks: Set<string>;
  terminalTasks: Set<string>; cancellableTasks: Set<string>; unknownAttribution: boolean;
}
interface ThreadDeletionScan { promise: Promise<ThreadDeletionScanFacts>; facts?: ThreadDeletionScanFacts }
export interface DesktopAgentWaitResult {
  reason: 'settled_terminal' | 'stopping' | 'stalled' | 'timeout' | 'queued' | 'message'; settled: boolean;
  agents: DesktopAgentSnapshot[];
  operationId?: string; expectedTurn?: number;
  messageIds?: string[];
}
const TERMINAL = new Set(['completed', 'failed', 'interrupted', 'closed']);
const MAX_RESIDENT_CHILDREN = 8;

/** Main owns execution, durable truth and permission checks; renderer owns none. */
export class DesktopMultiAgentService {
  readonly approvalCapacity = MAX_RESIDENT_CHILDREN + 1;
  private approvalOwner?: DesktopApprovalOwner;
  private approvalTransport?: DesktopMultiAgentApprovalTransport;
  private readonly groups = new Map<string, LiveGroup>();
  private readonly dormant = new Map<string, number>();
  private readonly actors = new WeakMap<DesktopAgentActor, ActorState>();
  private readonly slots = new Set<string>();
  private readonly resourceCommands = new Map<string, { commands: MultiAgentCommandSequencer; users: number }>();
  private readonly uncertainOperations = new Set<string>();
  private readonly threadCommands = new Map<string, MultiAgentCommandSequencer>();
  private readonly pendingResets = new Map<string, PendingReset>();
  private readonly deletionAttempts = new Map<string, symbol>();
  private readonly pendingDeletionStops = new Set<Promise<unknown>>();
  private readonly deletionScans = new Map<string, ThreadDeletionScan>();
  private readonly deletionStops = new Map<string, { goal: Promise<void>; goalConfirmed: boolean; goalFailed: boolean;
    tasks: Map<string, { promise: Promise<void>; executionObserved: boolean; state: 'pending' | 'confirmed' | 'failed' }> }>();
  private readonly goalDecisions = new Set<string>();
  private readonly userAccess = new WeakMap<DesktopMultiAgentUserAccess, UserAccessState>();
  private readonly workspaceUserAccess = new WeakMap<DesktopWorkspaceUserAccess, WorkspaceUserAccessState>();
  private readonly authorizationCommands = new MultiAgentCommandSequencer();
  private readonly authorizationListeners = new Set<{ access: DesktopWorkspaceUserAccess; listener: (snapshot: ExecutionAuthorizationSnapshot & { pendingOperation?: ExecutionAuthorizationRetry }) => void }>();
  private authorization?: ExecutionAuthorizationSnapshot;
  private pendingAuthorization?: PendingAuthorization;
  private readonly authorizationStops = new Set<Promise<unknown>>();
  private readonly listeners = new Set<{ access: DesktopMultiAgentUserAccess; listener: (envelope: MultiAgentEnvelope) => void }>();
  private readonly unsubscribeStore: () => void;
  private initialized = false;
  private initialization?: Promise<void>;
  private host?: InProcessTaskRuntimeHost;
  private readonly hostDeliveryOwners = new WeakMap<DesktopHostDeliveryAuthority, HostDeliveryOwner>();
  private hostDeliveryAuthority?: DesktopHostDeliveryAuthority;
  private readonly pendingHostDeliveries = new Set<string>();
  private readonly deliveryRecoveryOwners = new WeakMap<HostDeliveryRecoveryAuthority, DeliveryRecoveryOwner>();
  private readonly recoveryPending = new Set<Promise<unknown>>();
  private bootQuiesced = false;
  private shutdownOwnerChecksReady = false;
  private disposed = false;
  private disposal?: Promise<void>;
  private runtimeBlockedReason?: string;
  private readonly grace: number;

  constructor(private readonly options: DesktopMultiAgentServiceOptions) {
    this.grace = options.closeGraceMs ?? 500;
    options.coordinator.setReady(false);
    this.unsubscribeStore = options.store.subscribe(event => this.publish(event));
  }

  registerThread(binding: MultiAgentThreadBinding): void { this.assertExecutionDomain(binding); this.options.store.registerThread(binding); }

  createWorkspaceUserAccess(input: { requestSource: Source; actorId: string; profileId: string; workspaceId: string }): DesktopWorkspaceUserAccess {
    const domain = this.options.executionDomain;
    if (input.requestSource !== 'user' || !domain || this.disposed || !this.initialized
      || input.profileId !== domain.profileId || input.workspaceId !== domain.workspaceId || input.actorId !== domain.actorId) {
      throw new Error('workspace_user_owner_mismatch');
    }
    const access = Object.freeze({ accessId: randomUUID() });
    this.workspaceUserAccess.set(access, { actorId: input.actorId, profileId: input.profileId, workspaceId: input.workspaceId, active: true });
    return access;
  }

  private requireWorkspaceUserAccess(access: DesktopWorkspaceUserAccess, source: Source): WorkspaceUserAccessState {
    const state = this.workspaceUserAccess.get(access), domain = this.options.executionDomain;
    if (source !== 'user' || !state?.active || !domain || this.disposed || !this.initialized
      || state.profileId !== domain.profileId || state.workspaceId !== domain.workspaceId || state.actorId !== domain.actorId) {
      throw new Error('invalid_workspace_user_authority');
    }
    return state;
  }

  getExecutionAuthorization(): ExecutionAuthorizationSnapshot {
    if (this.disposed || !this.initialized) throw new Error('multi_agent_runtime_not_ready');
    return { ...(this.authorization ?? { bootId: this.options.store.bootId, permissionRevision: 0, executionAllowed: true, persistenceState: 'confirmed' as const }) };
  }

  getExecutionWorkspaceForUser(input: { access: DesktopWorkspaceUserAccess; requestSource: Source }): { cwd: string } {
    this.requireWorkspaceUserAccess(input.access, input.requestSource);
    return { cwd: this.options.executionDomain!.cwd };
  }

  getExecutionAuthorizationForUser(input: { access: DesktopWorkspaceUserAccess; requestSource: Source }): ExecutionAuthorizationSnapshot & { pendingOperation?: ExecutionAuthorizationRetry } {
    const user = this.requireWorkspaceUserAccess(input.access, input.requestSource);
    const snapshot = this.getExecutionAuthorization(), pending = this.pendingAuthorization;
    if (pending && pending.actorId !== user.actorId) throw new Error('workspace_user_owner_mismatch');
    return { ...snapshot, ...(snapshot.persistenceState === 'unknown' && pending ? { pendingOperation: { ...pending.request } } : {}) };
  }

  subscribeExecutionAuthorization(input: { access: DesktopWorkspaceUserAccess; requestSource: Source }, listener: (snapshot: ExecutionAuthorizationSnapshot & { pendingOperation?: ExecutionAuthorizationRetry }) => void): () => void {
    this.requireWorkspaceUserAccess(input.access, input.requestSource);
    const subscription = { access: input.access, listener };
    this.authorizationListeners.add(subscription);
    return () => {
      this.authorizationListeners.delete(subscription);
      const state = this.workspaceUserAccess.get(input.access); if (state) state.active = false;
    };
  }

  private publishExecutionAuthorization(): void {
    const snapshot = this.authorization!;
    // Catalog gets execution facts only; pending recovery parameters are private
    // to the authenticated original user projection below.
    try { this.options.onExecutionAuthorizationChanged?.({ ...snapshot }); }
    catch { this.runtimeBlockedReason = 'authorization_projection_failed'; this.options.coordinator.block('authorization_projection_failed'); }
    for (const subscription of this.authorizationListeners) {
      try { subscription.listener(this.getExecutionAuthorizationForUser({ access: subscription.access, requestSource: 'user' })); }
      catch { /* Viewer delivery failure cannot roll back a committed decision. */ }
    }
  }

  private parseAuthorizationId(operationId: string): { bootId: string; revision: number } {
    const match = typeof operationId === 'string' && operationId.length <= 128
      ? /^exec-auth:([a-zA-Z0-9_-]{1,64}):(0|[1-9][0-9]*):([a-zA-Z0-9_-]{1,64})$/.exec(operationId) : null;
    if (!match || !Number.isSafeInteger(Number(match[2]))) throw new Error('invalid authorization operationId');
    return { bootId: match[1]!, revision: Number(match[2]) };
  }

  private readAuthorizationRow(): WorkspaceExecutionAuthorizationRow {
    const domain = this.options.executionDomain;
    if (!domain) throw new Error('workspace_execution_domain_missing');
    const row = this.options.store.readWorkspaceAuthorization({ profileId: domain.profileId, workspaceId: domain.workspaceId });
    if (!row) throw new Error('workspace_execution_authorization_missing');
    return row;
  }

  private authorizationReceipt(row: WorkspaceExecutionAuthorizationRow): ExecutionAuthorizationReceiptEnvelope | null {
    if (!row.lastReceiptJson) return null;
    const result = JSON.parse(row.lastReceiptJson) as ExecutionAuthorizationReceiptEnvelope;
    if (!result || typeof result.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(result.requestHash)
      || result.receipt?.state !== 'applied' || result.receipt.persistenceState !== 'confirmed'
      || result.receipt.permissionRevision !== row.permissionRevision || result.receipt.executionAllowed !== row.executionAllowed) {
      throw new Error('invalid_workspace_authorization_receipt');
    }
    this.parseAuthorizationId(result.receipt.operationId);
    return result;
  }

  private unknownAuthorizationReceipt(pending: PendingAuthorization): ExecutionAuthorizationReceipt {
    return { operationId: pending.request.operationId, state: 'unknown', permissionRevision: pending.candidate,
      executionAllowed: false, persistenceState: 'unknown' };
  }

  getExecutionAuthorizationOperation(input: { access: DesktopWorkspaceUserAccess; requestSource: Source; operationId: string }):
    { kind: 'receipt'; receipt: ExecutionAuthorizationReceipt } | { kind: 'not_found' | 'receipt_expired_unknown'; authorization: ExecutionAuthorizationSnapshot & { pendingOperation?: ExecutionAuthorizationRetry } } {
    const user = this.requireWorkspaceUserAccess(input.access, input.requestSource);
    const id = this.parseAuthorizationId(input.operationId), pending = this.pendingAuthorization;
    if (pending?.request.operationId === input.operationId) {
      if (pending.actorId !== user.actorId) throw new Error('workspace_user_owner_mismatch');
      return { kind: 'receipt', receipt: this.unknownAuthorizationReceipt(pending) };
    }
    const row = this.readAuthorizationRow(), last = this.authorizationReceipt(row);
    if (last?.receipt.operationId === input.operationId) {
      if (row.actorId !== user.actorId) throw new Error('workspace_user_owner_mismatch');
      return { kind: 'receipt', receipt: { ...last.receipt } };
    }
    const authorization = this.getExecutionAuthorizationForUser(input);
    if (id.bootId === authorization.bootId && id.revision > authorization.permissionRevision) throw new Error('invalid authorization revision');
    return { kind: id.bootId !== authorization.bootId || id.revision < authorization.permissionRevision ? 'receipt_expired_unknown' : 'not_found', authorization };
  }

  setExecutionAuthorization(input: ExecutionAuthorizationRetry & { access: DesktopWorkspaceUserAccess; requestSource: Source }): Promise<ExecutionAuthorizationReceipt> {
    this.requireWorkspaceUserAccess(input.access, input.requestSource);
    if (input.confirm !== true) throw new Error('execution authorization requires explicit confirmation');
    if (typeof input.executionAllowed !== 'boolean' || !Number.isSafeInteger(input.expectedPermissionRevision) || input.expectedPermissionRevision < 0) {
      throw new Error('invalid authorization argument');
    }
    const id = this.parseAuthorizationId(input.operationId);
    if (id.revision !== input.expectedPermissionRevision) throw new Error('authorization_operation_revision_conflict');
    const request: ExecutionAuthorizationRetry = { operationId: input.operationId, expectedPermissionRevision: input.expectedPermissionRevision, executionAllowed: input.executionAllowed, confirm: true };
    return this.authorizationCommands.run(() => {
      const user = this.requireWorkspaceUserAccess(input.access, input.requestSource), domain = this.options.executionDomain!;
      const hash = this.requestHash(request.operationId, { profileId: domain.profileId, workspaceId: domain.workspaceId, actorId: user.actorId, ...request });
      const pending = this.pendingAuthorization;
      if (pending?.request.operationId === request.operationId) {
        if (pending.requestHash !== hash) throw new Error('operation_id_conflict');
        return this.settleAuthorization(pending, true);
      }
      const current = this.getExecutionAuthorization();
      const fresh = current.persistenceState === 'confirmed' && id.bootId === current.bootId
        && request.expectedPermissionRevision === current.permissionRevision;
      // A committed receipt advances r to r+1 while its ID retains r. A fresh
      // request at the confirmed revision cannot match that receipt, so no IO
      // may precede its in-memory fence. Retired/unknown retries still consult
      // the original durable receipt and never cancel a newer execution.
      if (!fresh) {
        const row = this.readAuthorizationRow(), last = this.authorizationReceipt(row);
        if (last?.receipt.operationId === request.operationId) {
          if (last.requestHash !== hash || row.actorId !== user.actorId) throw new Error('operation_id_conflict');
          return { ...last.receipt };
        }
        if (current.persistenceState === 'unknown') throw new Error('authorization_persistence_unknown');
        throw new Error('stale_authorization_operation');
      }
      if (request.executionAllowed === current.executionAllowed) throw new Error('already_in_requested_state');
      const candidate = current.permissionRevision + 1;
      if (!Number.isSafeInteger(candidate)) throw new Error('authorization_revision_exhausted');
      const next: PendingAuthorization = { request, requestHash: hash, actorId: user.actorId, candidate, originalAllowed: current.executionAllowed };
      this.pendingAuthorization = next;
      this.authorization = { bootId: current.bootId, permissionRevision: candidate, executionAllowed: false, persistenceState: 'unknown' };
      // This synchronous fence comes before any SQLite/Goal/host IO. It is issued
      // exactly once, even if COMMIT or the user's outgoing ACK is later lost.
      this.publishExecutionAuthorization();
      if (!request.executionAllowed) this.fenceWorkspaceExecution();
      return this.settleAuthorization(next, false);
    });
  }

  private settleAuthorization(pending: PendingAuthorization, retry: boolean): ExecutionAuthorizationReceipt {
    let receipt: ExecutionAuthorizationReceipt;
    try {
      const row = this.readAuthorizationRow(), previous = this.authorizationReceipt(row);
      if (row.permissionRevision === pending.candidate && previous?.receipt.operationId === pending.request.operationId) {
        if (previous.requestHash !== pending.requestHash || row.actorId !== pending.actorId) throw new Error('authorization_receipt_mismatch');
        receipt = previous.receipt;
      } else {
        if (row.permissionRevision !== pending.request.expectedPermissionRevision || row.executionAllowed !== pending.originalAllowed) throw new Error('authorization_reconciliation_mismatch');
        const rejectedGrant = retry && pending.request.executionAllowed;
        receipt = { operationId: pending.request.operationId, state: 'applied', permissionRevision: pending.candidate,
          executionAllowed: rejectedGrant ? false : pending.request.executionAllowed, persistenceState: 'confirmed',
          ...(rejectedGrant ? { outcome: 'rejected', error: 'grant_not_applied' } : {}) };
        const next = { ...row, permissionRevision: pending.candidate, executionAllowed: receipt.executionAllowed,
          updatedAt: Date.now(), actorId: pending.actorId, lastReceiptJson: encodeMultiAgentRow({ requestHash: pending.requestHash, receipt }) };
        this.options.store.transaction(() => {
          if (!this.options.store.compareAndSetWorkspaceAuthorization({ profileId: row.profileId, workspaceId: row.workspaceId,
            expectedPermissionRevision: pending.request.expectedPermissionRevision, next })) throw new Error('authorization_cas_failed');
          if (!pending.request.executionAllowed) this.persistWorkspaceRevocation();
        });
      }
    } catch {
      // Never interpret old durable allowed as permission to clear this boot's
      // unknown fence. Only an explicit retry can reconcile the same candidate.
      return this.unknownAuthorizationReceipt(pending);
    }
    this.authorization = { bootId: this.options.store.bootId, permissionRevision: pending.candidate,
      executionAllowed: receipt.executionAllowed, persistenceState: 'confirmed' };
    this.pendingAuthorization = undefined;
    this.publishExecutionAuthorization();
    return { ...receipt };
  }

  private trackAuthorizationStop(promise: Promise<unknown>): void {
    this.authorizationStops.add(promise);
    void promise.then(() => { this.authorizationStops.delete(promise); this.tryShutdownQuiescence(); }, () => {
      this.authorizationStops.delete(promise);
      // Grant denial is already synchronous. A failed secondary Goal/host stop
      // is not a successful coordination ACK and must stay visible/recoverable.
      this.runtimeBlockedReason = 'authorization_stop_coordination_failed';
      this.options.coordinator.block(this.runtimeBlockedReason);
      for (const group of this.groups.values()) this.publish({ channel: 'runtime_error', groupId: group.id, code: this.runtimeBlockedReason });
      this.tryShutdownQuiescence();
    });
  }

  private fenceWorkspaceExecution(): void {
    const reason = new Error('permission_revoked');
    // Live groups can only be created from this factory's fixed domain. There
    // is deliberately no disk lookup before issuing their lifetime fences.
    for (const group of this.groups.values()) {
      group.frozen ??= 'permission_revoked';
      group.lifetime.abort(reason);
      const root = group.root;
      if (root && !this.actors.get(root.context?.actor as DesktopAgentActor)?.sealed) {
        root.controller.abort(reason);
        if (!root.started) (root.ticket ?? root.request?.ticket)?.release();
        if (root.context) this.markRootStopping(group, root);
        this.trackAuthorizationStop(Promise.resolve().then(() => this.host?.cancelTask(root.binding.sourceTaskId, 'permission_revoked')));
      }
      for (const child of group.children.values()) {
        child.controller.abort(reason);
        for (const pending of child.followups) { pending.controller.abort(reason); (pending.ticket ?? pending.request?.ticket)?.release(); }
        if (child.execution) this.markStopping(group, child, reason);
      }
      // Cancel all prepared reset continuations before any late cleanup wake.
      for (const [threadId, pending] of this.pendingResets) if (pending.journalGroupId === group.id) {
        this.pendingResets.delete(threadId);
        void group.commands.run(() => {
          try {
            const operation = this.options.store.getOperation(group.id, pending.operationId);
            if (operation?.requestHash === pending.requestHash) this.options.store.putOperation({ ...operation,
              result: { ...operation.result, state: 'completed', phase: 'cancelled', outcome: 'cancelled', error: 'permission_revoked' } }, true);
          } catch { this.markOperationUnknown(group.id, pending.operationId); }
        }).catch(() => this.markOperationUnknown(group.id, pending.operationId));
      }
      void group.commands.run(() => {
        for (const child of group.children.values()) {
          try { this.cancelFollowups(group, child, reason); }
          catch { /* Each cancelled intent retains unknown when its write fails. */ }
        }
        this.wake(group);
      }).catch(() => { /* Physical cancellation was already issued. */ });
      for (const wake of [...group.waiters]) wake();
    }
    if (this.options.stopForWorkspaceExecutionRevocation) {
      try { this.trackAuthorizationStop(this.options.stopForWorkspaceExecutionRevocation()); }
      catch (error) { this.trackAuthorizationStop(Promise.reject(error)); }
    }
  }

  private persistWorkspaceRevocation(): void {
    const domain = this.options.executionDomain!, store = this.options.store;
    let threadCursor: string | undefined;
    do {
      const threads = store.listWorkspaceThreads({ profileId: domain.profileId, workspaceId: domain.workspaceId, cursor: threadCursor, limit: 50 });
      for (const thread of threads.items) {
        let groupCursor: string | undefined;
        do {
          const groups = store.listWorkspaceGroups({ threadId: thread.threadId, bootId: store.bootId, cursor: groupCursor, limit: 50 });
          for (const row of groups.items) {
            const current = store.requireGroup(row.groupId);
            const reason = current.mutationBlockedReason && current.mutationBlockedReason !== 'group_reset_pending' ? current.mutationBlockedReason : 'permission_revoked';
            if (reason !== current.mutationBlockedReason) store.putGroup({ ...current, mutationBlockedReason: reason }, true);
          }
          groupCursor = groups.nextCursor ?? undefined;
        } while (groupCursor);
      }
      threadCursor = threads.nextCursor ?? undefined;
    } while (threadCursor);
  }

  private assertExecutionAuthorization(permissionRevision?: number): number {
    const snapshot = this.getExecutionAuthorization();
    if (snapshot.persistenceState !== 'confirmed') throw new Error('authorization_persistence_unknown');
    if (!snapshot.executionAllowed || permissionRevision !== undefined && permissionRevision !== snapshot.permissionRevision) throw new Error('permission_revoked');
    return snapshot.permissionRevision;
  }

  private assertExecutionDomain(thread: MultiAgentThreadBinding): void {
    const domain = this.options.executionDomain;
    if (domain && (thread.profileId !== domain.profileId || thread.workspaceId !== domain.workspaceId || thread.cwd !== domain.cwd)) throw new Error('workspace_execution_domain_mismatch');
  }

  async registerThreadWithOwnership(binding: MultiAgentThreadBinding, requestSource: Source): Promise<void> {
    if (requestSource !== 'user') throw new Error('thread registration source is not permitted');
    this.assertExecutionDomain(binding);
    if (this.options.store.getThread(binding.threadId)) { this.options.store.registerThread(binding); return; }
    if (!this.initialized || this.disposed || !this.host) throw new Error('multi_agent_runtime_not_ready');
    if (this.options.store.listGroups(binding.threadId).items.length) throw new Error('multi_agent_thread_owner_unknown');
    const inspected = new Set([...this.host.inFlightTaskIds(), ...(await this.host.getActiveTasks()).map(task => task.taskId)]);
    for (const id of inspected) {
      const snapshot = await this.host.inspectTask(id);
      if (!snapshot || snapshot.context?.threadId === binding.threadId || this.options.store.getRootBinding(id)?.threadId === binding.threadId) {
        throw new Error('multi_agent_thread_owner_unknown');
      }
    }
    if (await this.options.hasUnboundHistory?.(binding.threadId)) throw new Error('multi_agent_thread_owner_unknown');
    if (this.disposed || this.host.inFlightTaskIds().some(id => !inspected.has(id))) throw new Error('multi_agent_thread_owner_unknown');
    // Another main admission may have installed a binding while IO was pending;
    // the store's synchronous owner check is the final CAS, never an overwrite.
    this.options.store.registerThread(binding);
  }

  assertThreadAdmission(threadId: string): void {
    this.assertThreadNotDeleted(this.options.store.getThread(threadId));
  }
  /** Goal and local Chat capture this revision before awaiting prepare/IO and
   * present that same revision again before making an attachment startable. */
  assertExecutionAdmission(threadId: string, expectedPermissionRevision?: number): number {
    this.assertReady();
    this.assertThreadAdmission(threadId);
    const revision = this.assertExecutionAuthorization(expectedPermissionRevision);
    const thread = this.options.store.getThread(threadId);
    if (thread) this.assertExecutionDomain(thread);
    const durable = this.options.store.activeGroup(threadId);
    if (durable && (durable.permissionRevision ?? 0) !== revision) throw new Error('permission_revoked');
    if (durable?.mutationBlockedReason) throw new Error(durable.mutationBlockedReason);
    return revision;
  }
  private assertThreadNotDeleted(thread: MultiAgentThreadBinding | null): void {
    if (thread && thread.deleteState !== 'none') throw new Error('multi_agent_thread_deletion_pending');
  }

  assertInvocation(actor: DesktopAgentActor, context?: DesktopAgentExecutionContext): void { this.requireActor(actor, 'agent', context); }

  presentation(input: { actor: DesktopAgentActor; requestSource: Source; target: string }): Pick<DesktopAgentSnapshot, 'presentationOrdinal'> {
    const state = this.requireActor(input.actor, input.requestSource);
    return { presentationOrdinal: this.resolveTarget(state, input.target).presentationOrdinal };
  }

  canResumeSummary(context: DesktopAgentExecutionContext): boolean {
    const state = this.requireActor(context.actor, 'agent', context);
    if (context.agentId !== `root_${state.group.id}` || !context.sourceTaskId) return false;
    if ([...state.group.children.values()].some(child => child.execution || child.followups.length)) return false;
    const children = this.options.store.allAgents(state.group.id).filter(agent => agent.parentId !== null
      && agent.sourceTaskId === context.sourceTaskId);
    return children.length > 0 && children.every(agent => agent.status === 'completed' && !agent.executionActive
      && agent.stopState === 'none' && Boolean(agent.resultContentId || agent.lastResult));
  }

  runtimeStatus(): { liveGroups: number; dormantGroups: number; residentSlots: number; blocked: boolean } {
    return { liveGroups: this.groups.size, dormantGroups: this.dormant.size, residentSlots: this.slots.size, blocked: Boolean(this.runtimeBlockedReason) };
  }

  goalReadiness(threadId: string): DesktopGoalChildReadiness {
    const thread = this.options.store.getThread(threadId);
    if (thread && thread.deleteState !== 'none') return 'children_need_attention';
    const durable = this.options.store.activeGroup(threadId);
    if (!durable) return 'ready';
    if (durable.mutationBlockedReason || this.runtimeBlockedReason) return 'children_need_attention';
    const state = this.options.store.goalChildReadiness(durable.groupId);
    if (state !== 'ready') return state;
    return [...(this.groups.get(durable.groupId)?.children.values() ?? [])].some(child => child.followups.length)
      ? 'waiting_children' : 'ready';
  }

  /** Seal a Goal decision in the same sequence as mailbox/status/mutations.
   * The Goal store commit runs outside this queue; the short-lived admission
   * fence prevents a new model mutation from invalidating the sealed decision. */
  async withGoalDecision<T>(taskId: string, action: (state: DesktopGoalChildReadiness | 'superseded') => Promise<T>): Promise<T> {
    const binding = this.options.store.getRootBinding(taskId);
    if (!binding) return action('ready');
    const durable = this.options.store.requireGroup(binding.groupId);
    if (durable.historicalOnly || binding.bootId !== this.options.store.bootId) return action('superseded');
    const group = this.liveGroup(binding.groupId);
    const state = await group.commands.run(() => {
      if (this.goalDecisions.has(group.id)) throw new Error('goal_decision_pending');
      const current = this.options.store.requireGroup(group.id);
      const readiness = current.currentRootEpoch !== binding.rootEpoch || group.root
        ? 'superseded' as const : this.goalReadiness(current.threadId);
      // A negative decision does not fence still-running children. They must
      // remain able to finish tools and hand results back while Goal is waiting.
      if (readiness === 'ready') this.goalDecisions.add(group.id);
      return readiness;
    });
    try { return await action(state); }
    catch (error) { this.freezeGroup(group, 'goal_settlement_failed'); throw error; }
    finally { await group.commands.run(() => { this.goalDecisions.delete(group.id); this.maybeDormant(group); }); }
  }

  async recordActivity(context: DesktopAgentExecutionContext, activity: RuntimeActivity): Promise<void> {
    const state = this.requireActor(context.actor, 'agent', context);
    await state.group.commands.run(() => {
      this.requireActor(context.actor, 'agent', context);
      this.applyActivity(state.group, context.agentId, context.turnId, activity, Date.now(), true);
    });
  }

  /** Actual run boundary, not prepared/queued admission. Duplicate begins must
   * reject before resetting a previously recorded turn. */
  async recordRunStarted(context: DesktopAgentExecutionContext, message: string): Promise<void> {
    const state = this.requireActor(context.actor, 'agent', context);
    await state.group.commands.run(() => {
      this.requireActor(context.actor, 'agent', context);
      const operationId = `run_started:${createHash('sha256').update(`${context.agentId}:${context.turnId}`).digest('hex')}`;
      if (this.persistenceIO(state.group, () => this.options.store.getOperation(context.groupId, operationId))) throw new Error('desktop_agent_turn_already_started');
      try {
        this.options.store.transaction(() => {
          const previous = this.requireAgent(context.groupId, context.agentId);
          const agent = this.options.store.putAgent(context.groupId, { ...previous, taskSummary: desktopSubAgentSummary(message),
            toolsCompleted: 0, toolsFailed: 0, toolCounts: {}, otherToolCount: 0, toolStatisticsComplete: false,
            resultSummary: undefined, lastResult: undefined, resultContentId: undefined, startedAt: Date.now(), endedAt: undefined });
          this.options.store.appendEvent(context.groupId, { kind: 'status', agentId: context.agentId, turnId: context.turnId, payload: { agent } });
          this.options.store.putOperation({ groupId: context.groupId, operationId, command: 'run_started', requestHash: this.requestHash(operationId, { turnId: context.turnId }),
            applyState: 'applied', result: { state: 'completed' } });
        });
      } catch (error) { this.freezeGroup(state.group, 'multi_agent_presentation_persistence_failed'); throw error; }
    });
  }

  async recordToolFinished(context: DesktopAgentExecutionContext, fact: { executionEventId: string; toolName: string; ok: boolean }): Promise<void> {
    const state = this.requireActor(context.actor, 'agent', context);
    if (!fact.executionEventId || fact.executionEventId.length > 96 || typeof fact.toolName !== 'string' || typeof fact.ok !== 'boolean') throw new Error('invalid tool settlement');
    await state.group.commands.run(() => {
      this.requireActor(context.actor, 'agent', context);
      const operationId = `tool_finished:${createHash('sha256').update(`${context.agentId}:${context.turnId}:${fact.executionEventId}`).digest('hex')}`;
      const requestHash = this.requestHash(operationId, fact);
      const existing = this.persistenceIO(state.group, () => this.options.store.getOperation(context.groupId, operationId));
      if (existing) { if (existing.requestHash !== requestHash) throw new Error('tool_settlement_id_conflict'); return; }
      try {
        this.options.store.transaction(() => {
          const previous = this.requireAgent(context.groupId, context.agentId);
          if (previous.turnId !== context.turnId || previous.toolsCompleted === undefined) throw new Error('stale or unstarted tool settlement');
          const name = desktopSubAgentSummary(fact.toolName, 60);
          const counts = { ...previous.toolCounts };
          const knownName = name && name === fact.toolName && (Object.hasOwn(counts, name) || Object.keys(counts).length < 32);
          if (knownName) Object.defineProperty(counts, name, { value: (Object.hasOwn(counts, name) ? counts[name] : 0) + 1, enumerable: true, configurable: true, writable: true });
          const total = previous.toolsCompleted + 1;
          if (!Number.isSafeInteger(total)) throw new Error('tool count overflow');
          const agent = this.options.store.putAgent(context.groupId, { ...previous, toolsCompleted: total,
            toolsFailed: (previous.toolsFailed ?? 0) + (fact.ok ? 0 : 1), toolCounts: counts,
            otherToolCount: (previous.otherToolCount ?? 0) + (knownName ? 0 : 1) });
          this.options.store.appendEvent(context.groupId, { kind: 'tool_finished', agentId: context.agentId, turnId: context.turnId,
            payload: { executionEventId: fact.executionEventId, toolName: name, ok: fact.ok, agent } });
          this.options.store.putOperation({ groupId: context.groupId, operationId, command: 'tool_finished', requestHash, applyState: 'applied', result: { state: 'completed' } });
        });
      } catch (error) { this.freezeGroup(state.group, 'multi_agent_tool_settlement_persistence_failed'); throw error; }
    });
  }

  getApprovalDeadline(actor: DesktopAgentActor): number {
    const state = this.requireActor(actor, 'agent'); const context = state.context;
    return context.effectiveDeadline;
  }

  bindApprovalTransport(transport: DesktopMultiAgentApprovalTransport): DesktopApprovalOwner {
    if (this.disposed || this.options.store.isClosed() || !transport || typeof transport !== 'object') throw new Error('invalid_approval_owner');
    if (this.approvalTransport && this.approvalTransport !== transport) throw new Error('approval_transport_already_bound');
    this.approvalTransport = transport;
    return this.approvalOwner ??= Object.freeze({ ownerId: randomUUID() });
  }

  private requireApprovalOwner(owner: DesktopApprovalOwner): void {
    if (!this.approvalOwner || owner !== this.approvalOwner || this.disposed || this.options.store.isClosed()) throw new Error('invalid_approval_owner');
  }

  async runApprovalCommand<T>(owner: DesktopApprovalOwner, groupId: string, action: () => T): Promise<T> {
    this.requireApprovalOwner(owner);
    const group = this.groups.get(groupId);
    if (group) this.persistenceIO(group, () => this.options.store.requireGroup(groupId));
    else this.options.store.requireGroup(groupId);
    // Reuse the live group's queue, or its existing retained command owner for
    // readback/finalization after dormancy. Never activate a historical runtime.
    const record = this.resourceCommands.get(groupId) ?? { commands: group?.commands ?? new MultiAgentCommandSequencer(), users: 0 };
    record.users++; this.resourceCommands.set(groupId, record);
    try { return await record.commands.run(() => { this.requireApprovalOwner(owner); return action(); }); }
    finally {
      if (--record.users === 0 && this.resourceCommands.get(groupId) === record) this.resourceCommands.delete(groupId);
      this.tryShutdownQuiescence();
    }
  }

  assertApprovalUserAccess(access: DesktopMultiAgentUserAccess, requestSource: Source, groupId: string): { actorId: string; threadId: string; profileId: string; workspaceId: string } {
    if (requestSource !== 'user') throw new Error('approval_user_source_required');
    const user = this.requireUserAccess(access, groupId);
    this.assertExecutionDomain(this.options.store.getThread(user.threadId)!);
    return { actorId: user.actorId, threadId: user.threadId, profileId: user.profileId, workspaceId: user.workspaceId };
  }

  /** Catch an already-passed original actor deadline before its timer gets a
   * turn. Signal the existing owner now; its original physical drain stays held. */
  expireApprovalActor(owner: DesktopApprovalOwner, context: DesktopAgentExecutionContext): void {
    this.requireApprovalOwner(owner);
    const state = this.actors.get(context.actor);
    if (!state || state.context !== context || !state.active || state.sealed) throw new Error('invalid_approval_actor_context');
    if (context.signal.aborted) return;
    const deadline = this.getApprovalDeadline(context.actor);
    if (Date.now() < deadline) return;
    const group = state.group;
    if (group.lease?.deadlineAt !== undefined && Date.now() >= group.lease.deadlineAt) {
      const reason = new Error('multi_agent_lease_expired');
      group.leaseController?.abort(reason);
      if (group.root?.context && !this.actors.get(group.root.context.actor)?.sealed) {
        group.root.controller.abort(reason); this.markRootStopping(group, group.root);
      }
      for (const child of group.children.values()) if (child.execution && child.context.memberTicket.epoch === group.lease.epoch) this.markStopping(group, child, reason);
      this.trackAuthorizationStop(this.expireLease({ requestSource: 'scheduler', groupId: group.id, leaseEpoch: group.lease.epoch }));
      return;
    }
    const child = group.children.get(context.agentId);
    const reason = new Error(Date.now() >= context.effectiveDeadline ? 'MULTI_AGENT_TURN_TIMEOUT' : 'MULTI_AGENT_IDLE_TIMEOUT');
    if (child?.context === context) {
      this.markStopping(group, child, reason);
      this.trackAuthorizationStop(group.commands.run(() => {
        try { this.cancelFollowups(group, child, reason); }
        catch { this.freezeGroup(group, 'multi_agent_followup_cancellation_persistence_failed'); }
        this.wake(group);
      }));
    } else if (group.root?.context === context) {
      group.root.controller.abort(reason); this.markRootStopping(group, group.root);
      this.trackAuthorizationStop(Promise.resolve(this.host?.cancelTask(group.root.binding.sourceTaskId, reason.message)).then(() => undefined));
    } else throw new Error('invalid_approval_actor_context');
  }

  getApprovalPersistenceFailure(owner: DesktopApprovalOwner, groupId: string): DesktopApprovalFailure | undefined {
    this.requireApprovalOwner(owner);
    const live = this.groups.get(groupId);
    if (live?.approvalFailure) return { ...live.approvalFailure };
    if (live?.persistenceFailed) return { groupId, bootId: this.options.store.bootId, code: 'multi_agent_approval_persistence_failed' };
    if (live) return undefined;
    const durable = this.options.store.requireGroup(groupId);
    return durable.mutationBlockedReason === 'multi_agent_approval_persistence_failed'
      ? { groupId, bootId: durable.bootId, code: 'multi_agent_approval_persistence_failed' } : undefined;
  }

  freezeApprovalPersistence(owner: DesktopApprovalOwner, groupId: string): void {
    this.requireApprovalOwner(owner);
    const group = this.groups.get(groupId);
    if (!group) throw new Error('approval_live_group_unavailable');
    group.approvalFailure ??= { groupId, bootId: this.options.store.bootId, code: 'multi_agent_approval_persistence_failed' };
    try { this.freezeGroup(group, 'multi_agent_approval_persistence_failed'); }
    catch { /* The lifetime/actor fences precede wake's secondary database read. */ }
    this.publishApprovalFailure(group);
  }

  private publishApprovalFailure(group: LiveGroup): void {
    const envelope: MultiAgentEnvelope = { channel: 'runtime_error', groupId: group.id, threadId: group.threadId,
      bootId: group.approvalFailure!.bootId, code: 'multi_agent_approval_persistence_failed', approvalPersistenceState: 'unknown' };
    // Only this fixed negative fact can use already authenticated, immutable
    // thread ownership while SQLite is unreadable. Ordinary publish stays gated
    // by its original database checks; the IPC listener still authenticates its
    // current sender/frame before delivering this event.
    const domain = this.options.executionDomain;
    for (const subscription of [...this.listeners]) {
      const scope = this.userAccess.get(subscription.access);
      if (this.disposed || !scope?.active || scope.threadId !== group.threadId
        || domain && (scope.profileId !== domain.profileId || scope.workspaceId !== domain.workspaceId)) continue;
      try { subscription.listener(envelope); } catch { /* A viewer cannot undo the failure fence. */ }
    }
  }

  publishApprovalChange(owner: DesktopApprovalOwner, groupId: string): void {
    this.requireApprovalOwner(owner);
    const durable = this.options.store.requireGroup(groupId), thread = this.options.store.getThread(durable.threadId)!;
    this.publishGroupChanged(thread.threadId, thread.activeGroupId ?? null, thread.activeGroupId ?? null);
  }

  getApproval(input: Parameters<DesktopMultiAgentApprovalTransport['getApproval']>[0]) {
    this.assertApprovalUserAccess(input.access, input.requestSource, input.groupId);
    if (!this.approvalTransport) throw new Error('approval_transport_unavailable');
    return this.approvalTransport.getApproval(input);
  }
  decideApproval(input: Parameters<DesktopMultiAgentApprovalTransport['decideApproval']>[0]) {
    this.assertApprovalUserAccess(input.access, input.requestSource, input.groupId);
    if (!this.approvalTransport) throw new Error('approval_transport_unavailable');
    return this.approvalTransport.decideApproval(input);
  }

  private applyActivity(group: LiveGroup, agentId: string, turnId: string, activity: RuntimeActivity, timestamp: number, guardImmediateIO = false): void {
    const readAgent = (guard: boolean) => guard ? this.requireOwnedAgent(group, agentId) : this.requireAgent(group.id, agentId);
    const agent = readAgent(guardImmediateIO);
    if (agent.status !== 'running' || agent.turnId && agent.turnId !== turnId) return;
    let record = group.activities.get(agentId);
    if (record && record.turnId !== turnId) this.finishActivity(group, agentId);
    record = group.activities.get(agentId) ?? { turnId, phase: activity.phase, lastActivityAt: timestamp,
      revision: agent.activityRevision ?? 0, lastPublishedAt: Number.NEGATIVE_INFINITY, lastCheckpointAt: timestamp };
    record.phase = activity.phase; record.currentTool = activity.toolName ? truncateMultiAgentText(activity.toolName, 256).text : undefined;
    record.lastActivityAt = timestamp; group.activities.set(agentId, record);
    const publish = (guard = false) => {
      if (group.activities.get(agentId) !== record || this.disposed) return;
      const current = readAgent(guard); if (current.status !== 'running') return;
      clearTimeout(record.publishTimer); record.publishTimer = undefined;
      record.lastPublishedAt = Date.now(); record.revision++;
      this.publish({ schemaVersion: 1, channel: 'activity', groupId: group.id, agentId, turnId,
        activityRevision: record.revision, timestamp: record.lastActivityAt, phase: record.phase,
        ...(record.currentTool ? { currentTool: record.currentTool } : {}) });
    };
    if (timestamp - record.lastPublishedAt >= 1000) publish(guardImmediateIO);
    else if (!record.publishTimer) {
      record.publishTimer = setTimeout(() => { void group.commands.run(publish).catch(() => this.freezeGroup(group, 'multi_agent_activity_failed')); }, Math.max(1, 1000 - (timestamp - record.lastPublishedAt)));
      record.publishTimer.unref?.();
    }
    if (timestamp - record.lastCheckpointAt >= 5000) {
      if (guardImmediateIO) this.persistenceIO(group, () => this.checkpointActivity(group, agentId, record));
      else this.checkpointActivity(group, agentId, record);
    }
    else if (!record.checkpointTimer) {
      record.checkpointTimer = setTimeout(() => { void group.commands.run(() => {
        if (group.activities.get(agentId) === record && !this.disposed) this.checkpointActivity(group, agentId, record);
      }).catch(() => this.freezeGroup(group, 'multi_agent_activity_persistence_failed')); }, Math.max(1, 5000 - (timestamp - record.lastCheckpointAt)));
      record.checkpointTimer.unref?.();
    }
  }

  private checkpointActivity(group: LiveGroup, agentId: string, record: ActivityRecord): void {
    const agent = this.requireAgent(group.id, agentId);
    this.options.store.putAgent(group.id, { ...agent, phase: record.phase, currentTool: record.currentTool,
      lastActivityAt: record.lastActivityAt, activityRevision: record.revision }, true);
    clearTimeout(record.checkpointTimer); record.checkpointTimer = undefined; record.lastCheckpointAt = Date.now();
  }
  private finishActivity(group: LiveGroup, agentId: string): void {
    const record = group.activities.get(agentId); if (!record) return;
    try { this.checkpointActivity(group, agentId, record); }
    catch (error) { this.freezeGroup(group, 'multi_agent_activity_persistence_failed'); throw error; }
    finally { clearTimeout(record.publishTimer); clearTimeout(record.checkpointTimer); group.activities.delete(agentId); }
  }

  async recordRuntimeEvent(context: DesktopAgentExecutionContext, event: RuntimeEvent): Promise<void> {
    const state = this.requireActor(context.actor, 'agent', context);
    if ('turnId' in event && event.turnId !== context.turnId) throw new Error('stale runtime event turn');
    if (event.type !== 'assistant_delta' && event.type !== 'artifact_recorded') return;
    await state.group.commands.run(() => {
      this.requireActor(context.actor, 'agent', context);
      try {
        if (event.type === 'assistant_delta') {
          const existing = state.group.outputs.get(context.agentId);
          if (existing && existing.turnId !== context.turnId) this.flushOutput(state.group, context.agentId);
          const pending = state.group.outputs.get(context.agentId) ?? { turnId: context.turnId, text: '' };
          state.group.outputs.set(context.agentId, pending);
          let remaining = event.delta;
          while (remaining) {
            const part = truncateMultiAgentText(remaining, 8 * 1024 - Buffer.byteLength(pending.text));
            if (!part.text) { this.flushOutput(state.group, context.agentId); state.group.outputs.set(context.agentId, pending); continue; }
            pending.text += part.text; remaining = remaining.slice(part.text.length);
            if (remaining) { this.flushOutput(state.group, context.agentId); state.group.outputs.set(context.agentId, pending); }
          }
          if (!pending.timer && pending.text) {
            pending.timer = setTimeout(() => { void state.group.commands.run(() => this.flushOutput(state.group, context.agentId)).catch(() => this.freezeGroup(state.group, 'multi_agent_output_persistence_failed')); }, 80);
            pending.timer.unref?.();
          }
        } else {
          this.options.store.appendEvent(state.group.id, { kind: 'artifact', agentId: context.agentId, turnId: context.turnId,
            payload: { artifactId: event.artifactId, label: truncateMultiAgentText(event.label, 512).text, kind: event.kind,
              path: event.path, mimeType: event.mimeType, sourceTaskId: context.sourceTaskId, creator: 'agent' } });
        }
      } catch (error) { this.freezeGroup(state.group, 'multi_agent_output_persistence_failed'); throw error; }
    });
  }

  async recordUsage(context: DesktopAgentExecutionContext, usage: { usageId: string; inputTokens: number; outputTokens: number }): Promise<void> {
    const state = this.requireActor(context.actor, 'agent', context);
    if (!usage.usageId || usage.usageId.length > 96 || !Number.isSafeInteger(usage.inputTokens) || usage.inputTokens < 0
      || !Number.isSafeInteger(usage.outputTokens) || usage.outputTokens < 0) throw new Error('invalid usage');
    await state.group.commands.run(() => {
      this.requireActor(context.actor, 'agent', context);
      const operationId = `usage:${createHash('sha256').update(`${context.agentId}:${context.turnId}:${usage.usageId}`).digest('hex')}`;
      const requestHash = this.requestHash(operationId, usage);
      const previous = this.persistenceIO(state.group, () => this.options.store.getOperation(state.group.id, operationId));
      if (previous) { if (previous.requestHash !== requestHash) throw new Error('usage_id_conflict'); return; }
      try {
        this.options.store.transaction(() => {
          const agent = this.requireAgent(state.group.id, context.agentId);
          const total = { inputTokens: (agent.usage?.inputTokens ?? 0) + usage.inputTokens, outputTokens: (agent.usage?.outputTokens ?? 0) + usage.outputTokens };
          this.options.store.putAgent(state.group.id, { ...agent, usage: total });
          this.options.store.appendEvent(state.group.id, { kind: 'usage', agentId: context.agentId, turnId: context.turnId, payload: { ...usage, total } });
          this.options.store.putOperation({ groupId: state.group.id, operationId, command: 'usage', requestHash, applyState: 'applied', result: { state: 'completed' } });
        });
      } catch (error) { this.freezeGroup(state.group, 'multi_agent_usage_persistence_failed'); throw error; }
    });
  }

  private flushOutput(group: LiveGroup, agentId: string): void {
    const pending = group.outputs.get(agentId);
    if (!pending?.text) return;
    try {
      this.options.store.appendEvent(group.id, { kind: 'output', agentId, turnId: pending.turnId, payload: { text: pending.text } });
      pending.text = ''; clearTimeout(pending.timer); pending.timer = undefined; group.outputs.delete(agentId);
    } catch (error) { this.freezeGroup(group, 'multi_agent_output_persistence_failed'); throw error; }
  }

  /** Only the authenticated main-frame adapter may issue this opaque user access. */
  createUserAccess(input: { requestSource: Source; actorId: string; threadId: string; profileId: string; workspaceId: string }): DesktopMultiAgentUserAccess {
    if (input.requestSource !== 'user' || !input.actorId) throw new Error('user scope is not permitted');
    const thread = this.options.store.getThread(input.threadId);
    if (!thread || thread.profileId !== input.profileId || thread.workspaceId !== input.workspaceId) throw new Error('thread scope ownership mismatch');
    const access = Object.freeze({ accessId: randomUUID() });
    this.userAccess.set(access, { actorId: input.actorId, threadId: input.threadId, profileId: input.profileId, workspaceId: input.workspaceId, active: true });
    return access;
  }

  getSnapshot(input: { access: DesktopMultiAgentUserAccess; groupId?: string }): MultiAgentGroupSnapshot {
    const scope = this.requireUserAccess(input.access, input.groupId);
    const thread = this.options.store.getThread(scope.threadId)!;
    const groupId = input.groupId ?? thread.activeGroupId;
    const storedGroup = groupId ? this.options.store.requireGroup(groupId) : null;
    const live = groupId ? this.groups.get(groupId) : undefined;
    const group = storedGroup ? { ...storedGroup, mutationBlockedReason: live?.frozen ?? storedGroup.mutationBlockedReason } : null;
    let page = group ? this.options.store.listAgents(group.groupId, undefined, 50, 24 * 1024) : { items: [], nextCursor: null };
    const selectedApprovals = group && this.approvalTransport ? this.approvalTransport.getGroupProjection(group.groupId) : undefined;
    const selectedFailure = group && this.approvalOwner ? this.getApprovalPersistenceFailure(this.approvalOwner, group.groupId) : undefined;
    const pendingApprovals = selectedApprovals?.pendingApprovals.map(item => selectedFailure
      ? { ...item, canDecide: false, persistenceState: 'unknown' as const, reason: 'approval_persistence_failed' as const } : item);
    const activeFailure = thread.activeGroupId && this.approvalOwner ? this.getApprovalPersistenceFailure(this.approvalOwner, thread.activeGroupId) : undefined;
    const activeApprovals = thread.activeGroupId === groupId ? selectedApprovals
      : thread.activeGroupId && this.approvalTransport ? this.approvalTransport.getGroupProjection(thread.activeGroupId) : undefined;
    const snapshot: MultiAgentGroupSnapshot = {
      threadId: thread.threadId, activeGroupId: thread.activeGroupId ?? null, threadRevision: thread.threadRevision ?? 0,
      threadDeleteState: thread.deleteState ?? 'none',
      hasAgentHistory: this.options.store.threadHasAgentHistory(thread.threadId),
      group, root: group ? this.projectAgentForRead(group, this.options.store.getAgent(group.groupId, `root_${group.groupId}`)) : null,
      agents: group ? page.items.map(agent => this.projectAgentForRead(group, agent)!) : [],
      residentAgents: group && !group.historicalOnly ? this.options.store.residentAgents(group.groupId).map(agent => this.projectAgentForRead(group, agent)!) : [],
      nextAgentCursor: page.nextCursor, lastSeq: group?.lastSeq ?? 0,
      counts: group ? this.options.store.agentCounts(group.groupId) : { total: 0, running: 0, completed: 0, failed: 0, unread: 0 },
      ...(this.runtimeBlockedReason ? { runtimeError: this.runtimeBlockedReason } : {}),
      ...(pendingApprovals?.length ? { pendingApprovals } : {}),
      pendingApprovalCount: activeFailure || thread.deleteState === 'deleted' ? 0 : activeApprovals?.pendingApprovalCount ?? 0,
      ...(activeFailure ? { approvalFailure: activeFailure } : {}),
    };
    // The exact worst legal subscription envelope adds 1,569 bytes. Only
    // approval-bearing snapshots shrink their old agent page; every identity,
    // pending item, root and resident remains intact. Cursor stays store-owned.
    if (group && pendingApprovals?.length) {
      let limit = 50;
      while (Buffer.byteLength(encodeMultiAgentRow(snapshot)) > 65_536 - 1_569 && page.items.length > 1) {
        limit = Math.min(limit - 1, page.items.length - 1);
        page = this.options.store.listAgents(group.groupId, undefined, limit, 24 * 1024);
        snapshot.agents = page.items.map(agent => this.projectAgentForRead(group, agent)!);
        snapshot.nextAgentCursor = page.nextCursor;
      }
      if (Buffer.byteLength(encodeMultiAgentRow(snapshot)) > 65_536 - 1_569) throw new Error('multi_agent_wire_limit_exceeded');
    }
    this.assertWire(snapshot); return snapshot;
  }

  readAgents(input: { access: DesktopMultiAgentUserAccess; groupId: string; cursor?: string }): MultiAgentPage<DesktopAgentSnapshot> {
    this.requireUserAccess(input.access, input.groupId);
    const group = this.options.store.requireGroup(input.groupId), page = this.options.store.listAgents(input.groupId, input.cursor);
    const result = { ...page, items: page.items.map(agent => this.projectAgentForRead(group, agent)!) }; this.assertWire(result); return result;
  }

  private projectAgentForRead(group: DesktopMultiAgentGroup, agent: DesktopAgentSnapshot | null): DesktopAgentSnapshot | null {
    if (!agent) return null;
    const live = this.groups.get(group.groupId), activity = live?.activities.get(agent.id), thread = this.options.store.getThread(group.threadId);
    const writable = !this.disposed && !this.runtimeBlockedReason && !group.historicalOnly && !group.mutationBlockedReason
      && !live?.frozen && !live?.lifetime.signal.aborted && thread && (thread.deleteState ?? 'none') === 'none';
    return { ...agent, resumable: Boolean(agent.resumable && writable),
      ...(agent.status === 'running' && activity && activity.turnId === agent.turnId ? { phase: activity.phase, currentTool: activity.currentTool,
        activityRevision: activity.revision, lastActivityAt: activity.lastActivityAt } : {}) };
  }

  listGroups(input: { access: DesktopMultiAgentUserAccess; cursor?: string }) {
    const scope = this.requireUserAccess(input.access);
    const page = this.options.store.listGroups(scope.threadId, input.cursor, 50, { onlyWithChildren: true }); this.assertWire(page); return page;
  }
  readEvents(input: { access: DesktopMultiAgentUserAccess; groupId: string; afterSeq: number; limit?: number }) {
    this.requireUserAccess(input.access, input.groupId);
    if (!Number.isSafeInteger(input.afterSeq) || input.afterSeq < 0) throw new Error('invalid event cursor');
    const candidates = this.options.store.readEvents(input.groupId, input.afterSeq, input.limit ?? 100);
    const items: typeof candidates = []; let bytes = 0;
    for (const event of candidates) {
      const size = Buffer.byteLength(JSON.stringify(event));
      if (bytes + size > 60 * 1024) break;
      items.push(event); bytes += size;
    }
    if (candidates.length && !items.length) throw new Error('multi_agent_event_wire_limit_exceeded');
    const nextAfterSeq = items.at(-1)?.seq ?? input.afterSeq;
    const headSeq = this.options.store.requireGroup(input.groupId).lastSeq;
    const page = { items, nextAfterSeq, headSeq, hasMore: nextAfterSeq < headSeq }; this.assertWire(page); return page;
  }
  readContent(input: { access: DesktopMultiAgentUserAccess; groupId: string; contentId: string; offset: number }) {
    this.requireUserAccess(input.access, input.groupId);
    // Leave space for base64 expansion and the transport/subscription envelope.
    const page = this.options.store.readContent(input.groupId, input.contentId, input.offset, 44 * 1024); this.assertWire(page); return page;
  }
  readOperation(input: { access: DesktopMultiAgentUserAccess; groupId: string; operationId: string }) {
    this.requireUserAccess(input.access, input.groupId);
    let operation = this.options.store.getOperation(input.groupId, input.operationId);
    if (operation && (operation.applyState === 'unknown' || this.uncertainOperations.has(`${input.groupId}:${input.operationId}`))) operation = { ...operation, applyState: 'unknown', result: { ...operation.result, state: 'unknown' } };
    this.assertWire(operation); return operation;
  }
  readResources(input: { access: DesktopMultiAgentUserAccess; groupId: string; cursor?: string }) {
    this.requireUserAccess(input.access, input.groupId);
    const page = this.options.store.listResources(input.groupId, input.cursor); this.assertWire(page); return page;
  }

  subscribe(access: DesktopMultiAgentUserAccess, listener: (envelope: MultiAgentEnvelope) => void): () => void {
    this.requireUserAccess(access);
    const subscription = { access, listener }; this.listeners.add(subscription);
    return () => { this.listeners.delete(subscription); };
  }

  userSend(input: DesktopMultiAgentUserControl & { message: string }): Promise<MultiAgentControlResult> { return this.userCommand(input, 'send', input.message); }
  userFollowup(input: DesktopMultiAgentUserControl & { message: string }): Promise<MultiAgentControlResult> { return this.userCommand(input, 'followup', input.message); }
  userInterrupt(input: DesktopMultiAgentUserControl): Promise<MultiAgentControlResult> { return this.userCommand(input, 'interrupt'); }
  userClose(input: DesktopMultiAgentUserControl): Promise<MultiAgentControlResult> { return this.userCommand(input, 'close'); }

  readThreadDeletion(input: { access: DesktopMultiAgentUserAccess }): MultiAgentThreadDeletionSnapshot {
    const scope = this.requireUserAccess(input.access), thread = this.options.store.getThread(scope.threadId)!;
    const receipt = thread.deletionReceipt;
    return { threadId: scope.threadId, threadRevision: thread.threadRevision!, deleteState: thread.deleteState ?? 'none',
      operation: receipt ? { ...receipt.result, ...(receipt.bootId !== this.options.store.bootId && thread.deleteState !== 'deleted' ? { state: 'unknown' as const } : {}) } : null };
  }

  async deleteThread(input: { access: DesktopMultiAgentUserAccess; requestSource: Source; operationId: string; expectedThreadRevision: number; confirmTerminate: true }): Promise<MultiAgentControlResult> {
    if (input.requestSource !== 'user') throw new Error('thread deletion source is not permitted');
    if (input.confirmTerminate !== true) throw new Error('thread deletion requires explicit confirmation');
    if (!Number.isSafeInteger(input.expectedThreadRevision) || input.expectedThreadRevision < 0) throw new Error('invalid thread revision');
    const prefix = `delete:${input.expectedThreadRevision}:`;
    if (typeof input.operationId !== 'string' || !input.operationId.startsWith(prefix) || !/^[a-zA-Z0-9_-]{1,80}$/.test(input.operationId.slice(prefix.length))) throw new Error('invalid thread deletion revision identifier');
    const scope = this.requireUserAccess(input.access);
    if (!this.initialized || this.disposed) throw new Error('multi_agent_runtime_not_ready');
    const threadId = scope.threadId;
    const commands = this.threadCommands.get(threadId) ?? this.groups.get(this.options.store.getThread(threadId)?.activeGroupId ?? '')?.commands ?? new MultiAgentCommandSequencer();
    const token = Symbol('thread deletion');
    try {
    const admitted = await commands.run(() => {
      this.requireUserAccess(input.access);
      const thread = this.options.store.getThread(threadId)!;
      const requestHash = this.requestHash(input.operationId, { actorId: scope.actorId, threadId, expectedRevision: input.expectedThreadRevision });
      if (thread.deletionReceipt?.operationId === input.operationId) {
        if (thread.deletionReceipt.requestHash !== requestHash) throw new Error('operation_id_conflict');
        return this.readThreadDeletion({ access: input.access }).operation!;
      }
      if (thread.threadRevision !== input.expectedThreadRevision || thread.deleteState === 'deleted') throw new Error('stale thread deletion revision');
      if (this.deletionAttempts.has(threadId)) return this.readThreadDeletion({ access: input.access }).operation!;
      this.options.store.transaction(() => {
        this.options.store.beginThreadDeletion(threadId, { operationId: input.operationId, actorId: scope.actorId, bootId: this.options.store.bootId,
          expectedRevision: input.expectedThreadRevision, requestHash, startedAt: Date.now(), result: { operationId: input.operationId, state: 'cleanup_pending' } });
        const reset = this.pendingResets.get(threadId);
        if (reset) { this.markOperationUnknown(reset.journalGroupId, reset.operationId); this.pendingResets.delete(threadId); }
      });
      this.deletionAttempts.set(threadId, token); this.threadCommands.set(threadId, commands);
      for (const group of this.groups.values()) {
        if (this.options.store.requireGroup(group.id).threadId !== threadId) continue;
        const reason = new Error('multi_agent_thread_deletion_pending');
        group.lifetime.abort(reason); group.root?.controller.abort(reason);
        if (group.root?.context) this.markRootStopping(group, group.root);
        for (const child of group.children.values()) if (child.parentId === `root_${group.id}`) this.beginClose(group, child.id, 'user');
      }
      this.publishGroupChanged(threadId, thread.activeGroupId ?? null, thread.activeGroupId ?? null);
      return null;
    });
    if (admitted) return admitted;
      this.requireUserAccess(input.access);
      if (this.deletionAttempts.get(threadId) !== token || this.disposed) throw new Error('stale thread deletion attempt');
      const deadline = performance.now() + Math.min(this.grace, 500);
      let stops = this.deletionStops.get(threadId);
      if (!stops || stops.goalFailed) {
        const previousTasks = stops?.tasks;
        const created = { goal: Promise.resolve(), goalConfirmed: false, goalFailed: false, tasks: previousTasks ?? new Map<string, { promise: Promise<void>; executionObserved: boolean; state: 'pending' | 'confirmed' | 'failed' }>() };
        created.goal = this.trackDeletionStop(Promise.resolve().then(() => this.options.beforeThreadDeletion?.(threadId)).then(() => { created.goalConfirmed = true; }, () => { created.goalFailed = true; }));
        stops = created; this.deletionStops.set(threadId, stops);
      }
      let scan = this.deletionScans.get(threadId);
      if (scan && !scan.facts) return this.readThreadDeletion({ access: input.access }).operation!;
      if (!scan) {
        const created: ThreadDeletionScan = { promise: Promise.resolve().then(() => this.collectThreadDeletionScan(threadId, [...stops!.tasks.keys()])) };
        // The tracked promise covers every host IO, not merely this request's
        // bounded wait. A late callback only settles memory ownership/cache.
        created.promise = this.trackDeletionStop(created.promise.then(facts => { created.facts = facts; return facts; }, error => {
          if (this.deletionScans.get(threadId) === created) this.deletionScans.delete(threadId);
          throw error;
        }));
        scan = created; this.deletionScans.set(threadId, scan);
        if (!await this.waitForDeletionDeadline(scan.promise, deadline)) return this.readThreadDeletion({ access: input.access }).operation!;
      }
      this.requireUserAccess(input.access);
      if (this.deletionAttempts.get(threadId) !== token || this.disposed) throw new Error('stale thread deletion attempt');
      const { initialInFlight, inspected, targetTasks, terminalTasks, cancellableTasks, unknownAttribution } = scan.facts!;
      for (const taskId of targetTasks) {
        const previous = stops.tasks.get(taskId);
        if (previous && initialInFlight.has(taskId)) previous.executionObserved = true;
        if (cancellableTasks.has(taskId) && (!previous || previous.state === 'failed')) {
          // Only a fresh admitted user attempt retries a settled failure. A
          // pending stop remains owned even after the bounded request returns.
          const cancellation = { promise: Promise.resolve(), executionObserved: previous?.executionObserved || initialInFlight.has(taskId), state: 'pending' as 'pending' | 'confirmed' | 'failed' };
          cancellation.promise = this.trackDeletionStop(Promise.resolve().then(() => this.host!.cancelTask(taskId, 'multi_agent_thread_deleted'))
            .then(() => { cancellation.state = 'confirmed'; }, () => { cancellation.state = 'failed'; }));
          stops.tasks.set(taskId, cancellation);
        }
      }
      await this.waitForDeletionDeadline(Promise.all([stops.goal, ...[...stops.tasks.values()].map(stop => stop.promise)]), deadline);
      await commands.run(() => {
        this.requireUserAccess(input.access);
        if (this.deletionAttempts.get(threadId) !== token || this.disposed) throw new Error('stale thread deletion attempt');
        if (stops!.goalFailed) throw new Error('multi_agent_thread_goal_cancellation_failed');
        if (unknownAttribution) { this.deletionScans.delete(threadId); return; }
        if (!stops!.goalConfirmed) return;
        const currentInFlight = this.host!.inFlightTaskIds();
        if (currentInFlight.some(id => !inspected.has(id))) { this.deletionScans.delete(threadId); return; }
        if (currentInFlight.some(id => targetTasks.has(id))) return;
        // Prepared tasks never registered an execution, so an empty execution
        // map cannot prove they were stopped. Actual terminal history or a
        // confirmed stop is required; late audit ACKs of exited runs are not.
        for (const [taskId, stop] of stops!.tasks) {
          if (stop.executionObserved || terminalTasks.has(taskId)) continue;
          if (stop.state === 'failed') throw new Error('multi_agent_thread_task_cancellation_failed');
          if (stop.state !== 'confirmed') return;
        }
        const groups = [...this.groups.values()].filter(group => this.options.store.requireGroup(group.id).threadId === threadId);
        if (groups.some(group => group.root || group.lease && !group.lease.released || this.goalDecisions.has(group.id)
          || [...group.children.values()].some(child => child.execution || child.followups.length || child.sessionResident))) return;
        if ([...this.resourceCommands].some(([id, owner]) => owner.users > 0 && this.options.store.getGroup(id)?.threadId === threadId)) return;
        if (this.options.store.threadHasUnreleasedResources(threadId)) return;
        const oldGroupId = this.options.store.getThread(threadId)!.activeGroupId ?? null;
        this.options.store.deleteThreadHistory(threadId, input.operationId);
        for (const group of groups) {
          group.deactivating = true; clearTimeout(group.deadlineTimer);
          for (const child of group.children.values()) { clearTimeout(child.ttl); clearTimeout(child.stopTimer); }
          for (const activity of group.activities.values()) { clearTimeout(activity.publishTimer); clearTimeout(activity.checkpointTimer); }
          this.groups.delete(group.id); void group.core.dispose().catch(() => {});
        }
        for (const id of this.dormant.keys()) if (!this.options.store.getGroup(id)) this.dormant.delete(id);
        this.deletionStops.delete(threadId);
        this.deletionScans.delete(threadId);
        this.publishGroupChanged(threadId, oldGroupId, null);
      });
    } catch (error) {
      if (this.deletionAttempts.get(threadId) !== token) throw error;
      if (this.disposed) return { operationId: input.operationId, state: 'unknown' };
      if (this.deletionAttempts.get(threadId) === token) {
        try { this.options.store.updateThreadDeletion(threadId, input.operationId, { operationId: input.operationId, state: 'unknown', error: truncateMultiAgentText(String(error), 512).text }); }
        catch { return { operationId: input.operationId, state: 'unknown' }; }
      }
    } finally {
      if (this.deletionAttempts.get(threadId) === token) { this.deletionAttempts.delete(threadId); if (this.threadCommands.get(threadId) === commands) this.threadCommands.delete(threadId); }
    }
    return this.readThreadDeletion({ access: input.access }).operation!;
  }

  private async collectThreadDeletionScan(threadId: string, previousTasks: string[]): Promise<ThreadDeletionScanFacts> {
    if (this.disposed) throw new Error('multi_agent_runtime_not_ready');
    const initialInFlight = new Set(this.host!.inFlightTaskIds());
    const active = await this.host!.getActiveTasks();
    if (this.disposed) throw new Error('multi_agent_runtime_not_ready');
    const facts: ThreadDeletionScanFacts = { initialInFlight, inspected: new Set([...initialInFlight, ...active.map(task => task.taskId), ...previousTasks]),
      targetTasks: new Set(), terminalTasks: new Set(), cancellableTasks: new Set(), unknownAttribution: false };
    // Serial by design: a rejected inspect leaves no hidden sibling Promise.
    // Each next host call needs a still-live owner, including after disposal.
    for (const taskId of facts.inspected) {
      if (this.disposed) throw new Error('multi_agent_runtime_not_ready');
      const snapshot = await this.host!.inspectTask(taskId);
      if (this.disposed) throw new Error('multi_agent_runtime_not_ready');
      const attributedThread = this.options.store.getRootBinding(taskId)?.threadId ?? snapshot?.context?.threadId;
      if (!attributedThread) { facts.unknownAttribution = true; continue; }
      if (attributedThread !== threadId) continue;
      facts.targetTasks.add(taskId);
      if (snapshot && ['completed', 'failed', 'cancelled'].includes(snapshot.status)) facts.terminalTasks.add(taskId);
      else if (snapshot) facts.cancellableTasks.add(taskId);
    }
    return facts;
  }

  private async waitForDeletionDeadline(promise: Promise<unknown>, deadline: number): Promise<boolean> {
    const remaining = deadline - performance.now();
    if (remaining <= 0) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([promise.then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), remaining); })]); }
    finally { clearTimeout(timer); }
  }

  private trackDeletionStop<T>(promise: Promise<T>): Promise<T> {
    this.pendingDeletionStops.add(promise);
    void promise.then(() => this.pendingDeletionStops.delete(promise), () => this.pendingDeletionStops.delete(promise));
    return promise;
  }

  async resetGroup(input: { access: DesktopMultiAgentUserAccess; requestSource: Source; expectedGroupId: string | null;
    operationId: string; confirmTerminate: true }): Promise<MultiAgentControlResult> {
    if (input.requestSource !== 'user') throw new Error('group reset source is not permitted');
    if (input.confirmTerminate !== true) throw new Error('group reset requires explicit confirmation');
    const scope = this.requireUserAccess(input.access, input.expectedGroupId ?? undefined);
    this.assertReady();
    const permissionRevision = this.assertExecutionAuthorization();
    const current = this.options.store.activeGroup(scope.threadId);
    const group = current ? this.liveGroup(current.groupId) : undefined;
    const commands = group?.commands ?? this.threadCommands.get(scope.threadId) ?? new MultiAgentCommandSequencer();
    this.threadCommands.set(scope.threadId, commands);
    return commands.run(() => {
      this.requireUserAccess(input.access, input.expectedGroupId ?? undefined); this.assertReady();
      this.assertExecutionAuthorization(permissionRevision);
      this.assertThreadAdmission(scope.threadId);
      if (group && this.goalDecisions.has(group.id)) throw new Error('goal_decision_pending');
      const store = this.options.store; const thread = store.getThread(scope.threadId)!;
      const requestHash = this.requestHash(input.operationId, { command: 'reset', actorId: scope.actorId, threadId: scope.threadId, expectedGroupId: input.expectedGroupId });
      const previous = store.findThreadOperation(scope.threadId, input.operationId, 'reset');
      if (previous) {
        if (previous.requestHash !== requestHash) throw new Error('operation_id_conflict');
        return { ...previous.result, ...(previous.applyState === 'unknown' || this.uncertainOperations.has(`${previous.groupId}:${input.operationId}`) ? { state: 'unknown' } : {}) } as unknown as MultiAgentControlResult;
      }
      if ((thread.activeGroupId ?? null) !== input.expectedGroupId) throw new Error('stale expected group');
      if (this.pendingResets.has(scope.threadId)) throw new Error('group_reset_pending');
      // No historical execution is reactivated to reset an empty thread.
      if (!thread.activeGroupId) {
        if (store.threadHasUnreleasedResources(scope.threadId)) throw new Error('multi_agent_thread_cleanup_pending');
        let createdId = '';
        store.transaction(() => {
          createdId = store.createGroup(scope.threadId, permissionRevision).groupId;
          store.putOperation({ groupId: createdId, operationId: input.operationId, command: 'reset', requestHash, applyState: 'applied',
            result: { operationId: input.operationId, state: 'completed', phase: 'completed', groupId: createdId } });
        });
        this.publishGroupChanged(scope.threadId, null, createdId);
        return { operationId: input.operationId, state: 'completed' as const, phase: 'completed', groupId: createdId };
      }
      const active = this.groups.get(thread.activeGroupId);
      if (!active || active !== group) throw new Error('stale group reset owner');
      const pending: PendingReset = { access: input.access, threadId: scope.threadId, expectedGroupId: thread.activeGroupId,
        journalGroupId: thread.activeGroupId, operationId: input.operationId, requestHash, permissionRevision };
      store.transaction(() => {
        store.putOperation({ groupId: active.id, operationId: input.operationId, command: 'reset', requestHash, applyState: 'applied',
          result: { operationId: input.operationId, state: 'cleanup_pending', phase: 'cleanup_pending', groupId: active.id, actorId: scope.actorId } }, true);
        const current = store.requireGroup(active.id);
        store.putGroup({ ...current, mutationBlockedReason: current.mutationBlockedReason ?? 'group_reset_pending' }, true);
      });
      this.pendingResets.set(scope.threadId, pending);
      const reason = new Error('group_reset_pending');
      active.lifetime.abort(reason);
      let failed = false;
      if (active.root) {
        const root = active.root;
        root.controller.abort(reason);
        if (root.context) this.markRootStopping(active, root);
        // Host's real cancellation decision and physical root finally retain
        // their ownership. Never await host disk IO in this command queue.
        void Promise.resolve().then(() => this.host?.cancelTask(root.binding.sourceTaskId, 'multi_agent_group_reset')).catch(error => {
          void commands.run(() => {
            if (this.disposed) return;
            try {
              const operation = store.getOperation(active.id, input.operationId);
              if (!operation || operation.requestHash !== pending.requestHash) return;
              store.putOperation({ ...operation, result: { ...operation.result, cancellationError: truncateMultiAgentText(error instanceof Error ? error.message : String(error), 512).text } }, true);
              // The root has already received lifetime abort. Host ACK failure
              // is not evidence of a live execution; its real finally decides.
              this.tryCompleteReset(scope.threadId);
            } catch { this.failReset(pending, 'multi_agent_reset_cancellation_persistence_failed'); }
          }).catch(() => this.failReset(pending, 'multi_agent_reset_cancellation_failed'));
        });
      } else {
        try {
          const root = this.requireAgent(active.id, `root_${active.id}`);
          if (!root.turn) store.putAgent(active.id, { ...root, status: 'closed', resourcesReleased: true, activationState: 'settled' }, true);
        } catch { failed = true; }
      }
      for (const child of active.children.values()) if (child.parentId === `root_${active.id}`) {
        try { if (!this.beginClose(active, child.id, 'user')) failed = true; } catch { failed = true; }
      }
      if (failed) { this.failReset(pending, 'multi_agent_reset_persistence_failed'); return { operationId: input.operationId, state: 'unknown' as const }; }
      this.tryCompleteReset(scope.threadId);
      return store.getOperation(pending.journalGroupId, input.operationId)!.result as unknown as MultiAgentControlResult;
    }).finally(() => { if (!this.pendingResets.has(scope.threadId) && this.threadCommands.get(scope.threadId) === commands) this.threadCommands.delete(scope.threadId); });
  }

  private publishGroupChanged(threadId: string, oldGroupId: string | null, newGroupId: string | null): void {
    const thread = this.options.store.getThread(threadId)!;
    const failure = thread.activeGroupId && this.approvalOwner ? this.getApprovalPersistenceFailure(this.approvalOwner, thread.activeGroupId) : undefined;
    const count = thread.activeGroupId && this.approvalTransport && !failure && thread.deleteState !== 'deleted'
      ? this.approvalTransport.getGroupProjection(thread.activeGroupId).pendingApprovalCount : 0;
    this.publish({ channel: 'group_changed', threadId, oldGroupId, newGroupId, threadRevision: thread.threadRevision!,
      threadDeleteState: thread.deleteState ?? 'none', hasAgentHistory: this.options.store.threadHasAgentHistory(threadId), pendingApprovalCount: count });
  }

  private failReset(pending: PendingReset, reason: string): void {
    if (this.pendingResets.get(pending.threadId) !== pending) return;
    this.pendingResets.delete(pending.threadId);
    this.markOperationUnknown(pending.journalGroupId, pending.operationId);
    const group = this.groups.get(pending.journalGroupId); if (group) this.freezeGroup(group, reason);
  }

  private markOperationUnknown(groupId: string, operationId: string): void {
    this.uncertainOperations.add(`${groupId}:${operationId}`);
    try {
      const operation = this.options.store.getOperation(groupId, operationId);
      if (operation) this.options.store.putOperation({ ...operation, applyState: 'unknown', result: { ...operation.result, state: 'unknown' } }, true);
    } catch { /* Never invent a successful acknowledgement. */ }
  }

  private tryCompleteReset(threadId: string): void {
    const pending = this.pendingResets.get(threadId);
    if (!pending || this.disposed || this.runtimeBlockedReason || this.options.store.getThread(threadId)?.deleteState !== 'none') return;
    const group = this.groups.get(pending.journalGroupId);
    if (group?.root || group?.lease && !group.lease.released || group && [...group.children.values()].some(child => child.execution || child.followups.length)) return;
    try {
      this.assertExecutionAuthorization(pending.permissionRevision);
      this.requireUserAccess(pending.access, pending.journalGroupId);
      const store = this.options.store;
      if (store.threadHasUnreleasedResources(threadId)) return;
      let nextId = '';
      store.transaction(() => {
        const operation = store.getOperation(pending.journalGroupId, pending.operationId);
        if (!operation || operation.applyState !== 'applied' || operation.requestHash !== pending.requestHash
          || operation.result.phase !== 'cleanup_pending' || store.getThread(threadId)?.activeGroupId !== pending.expectedGroupId) throw new Error('stale reset completion');
        const previous = store.requireGroup(pending.journalGroupId);
        store.putGroup({ ...previous, historicalOnly: true, mutationBlockedReason: previous.mutationBlockedReason === 'group_reset_pending' ? null : previous.mutationBlockedReason }, true);
        store.clearActiveGroup(threadId, pending.journalGroupId);
        nextId = store.createGroup(threadId, pending.permissionRevision).groupId;
        store.putOperation({ ...operation, result: { ...operation.result, state: 'completed', phase: 'completed', groupId: nextId } }, true);
      });
      this.pendingResets.delete(threadId); this.threadCommands.delete(threadId);
      if (group) {
        group.deactivating = true; clearTimeout(group.deadlineTimer);
        for (const child of group.children.values()) { clearTimeout(child.ttl); clearTimeout(child.stopTimer); }
        this.groups.delete(group.id); void group.core.dispose().catch(() => {});
      }
      this.publishGroupChanged(threadId, pending.expectedGroupId, nextId);
    } catch { this.failReset(pending, 'multi_agent_reset_persistence_failed'); }
  }

  async resolveResource(input: { access: DesktopMultiAgentUserAccess; requestSource: Source; groupId: string;
    resourceId: string; action: 'keep' | 'retryCleanup'; operationId: string }): Promise<MultiAgentControlResult> {
    if (input.requestSource !== 'user') throw new Error('resource resolution source is not permitted');
    this.requireUserAccess(input.access, input.groupId);
    if (!this.options.worktrees || !['keep', 'retryCleanup'].includes(input.action)) throw new Error('unsupported resource resolution');
    const owner = this.resourceCommands.get(input.groupId) ?? { commands: this.groups.get(input.groupId)?.commands ?? new MultiAgentCommandSequencer(), users: 0 };
    owner.users++; this.resourceCommands.set(input.groupId, owner); const commands = owner.commands;
    try {
    const admitted = await commands.run(() => {
      const scope = this.requireUserAccess(input.access, input.groupId);
      const resource = this.options.store.resources(input.groupId).find(item => item.resourceId === input.resourceId);
      if (!resource) throw new Error('unknown managed resource');
      const requestHash = this.requestHash(input.operationId, { actorId: scope.actorId, command: 'resolve_resource', resourceId: input.resourceId, action: input.action });
      const previous = this.options.store.getOperation(input.groupId, input.operationId);
      if (previous) {
        if (previous.requestHash !== requestHash) throw new Error('operation_id_conflict');
        return { previous: previous.applyState === 'unknown' || this.uncertainOperations.has(`${input.groupId}:${input.operationId}`) ? { ...previous.result, state: 'unknown' as const } : previous.result };
      }
      if (this.requireAgent(input.groupId, resource.agentId).executionActive) throw new Error('resource still has a live execution');
      this.options.store.putOperation({ groupId: input.groupId, operationId: input.operationId, command: 'resolve_resource', requestHash,
        applyState: 'applied', result: { operationId: input.operationId, state: 'cleanup_pending', resourceId: input.resourceId, action: input.action, actorId: scope.actorId } }, true);
      return { agentId: resource.agentId };
    });
    if ('previous' in admitted) return admitted.previous as unknown as MultiAgentControlResult;
    let error: unknown;
    try { await this.options.worktrees.resolve({ requestSource: 'user', groupId: input.groupId, resourceId: input.resourceId, action: input.action }); }
    catch (failure) { error = failure; }
    return await commands.run(() => {
      const result: MultiAgentControlResult = { operationId: input.operationId, state: 'completed',
        ...(error ? { outcome: 'rejected', error: truncateMultiAgentText(error instanceof Error ? error.message : String(error), 512).text } : {}) };
      try {
        if (error instanceof DesktopWorktreeJournalError) throw error;
        this.options.store.transaction(() => {
          const previous = this.options.store.getOperation(input.groupId, input.operationId)!;
          this.options.store.putOperation({ ...previous, result: { ...previous.result, ...result } }, true);
          this.refreshResourceProjection(input.groupId, admitted.agentId!);
        });
        const group = this.groups.get(input.groupId); if (group) { this.wake(group); this.maybeDormant(group); }
        return result;
      } catch {
        this.markOperationUnknown(input.groupId, input.operationId);
        const group = this.groups.get(input.groupId); if (group) this.freezeGroup(group, 'multi_agent_resource_persistence_failed');
        return { operationId: input.operationId, state: 'unknown' };
      }
    });
    } finally { if (--owner.users === 0 && this.resourceCommands.get(input.groupId) === owner) this.resourceCommands.delete(input.groupId); }
  }

  private async userCommand(input: DesktopMultiAgentUserControl, command: 'send' | 'followup' | 'interrupt' | 'close', message?: string): Promise<MultiAgentControlResult> {
    if (input.requestSource !== 'user') throw new Error('user control source is not permitted');
    this.requireUserAccess(input.access, input.groupId);
    if (!Number.isSafeInteger(input.expectedTurn) || input.expectedTurn < 0) throw new Error('invalid expected turn');
    if (typeof input.agentId !== 'string' || !input.agentId || input.agentId.length > 128) throw new Error('invalid agentId');
    if (message !== undefined) this.validateText(message);
    const group = this.liveGroup(input.groupId);
    return group.commands.run(() => {
      const scope = this.requireUserAccess(input.access, input.groupId);
      if (command === 'send' || command === 'followup') this.assertWritable(group);
      const target = this.options.store.getAgent(group.id, input.agentId);
      if (target && command !== 'send' && !target.parentId) throw new Error('root lifecycle control is not permitted');
      const existing = this.options.store.getOperation(group.id, input.operationId);
      const child = target ? group.children.get(target.id) : undefined;
      const request = { actor: { kind: 'user', actorId: scope.actorId }, operationId: input.operationId };
      const result = this.mutate(group, request, command, { target: input.agentId, expectedTurn: input.expectedTurn, message }, () => {
        // Known, side-effect-free refusals need the same durable receipt as an
        // accepted command. A failed receipt write still freezes and throws.
        const reject = (error: string): MultiAgentControlResult => ({ operationId: input.operationId,
          state: 'completed', outcome: 'rejected', error, targetAgentId: input.agentId });
        if (!target) return reject('unknown_target');
        if (target.turn !== input.expectedTurn) return reject('stale_expected_turn');
        if (command === 'send' && target.status === 'closed') return reject('target_closed');
        if (command === 'followup') {
          if (!child || !target.resumable || target.cleanupError || child.stopRequested && child.execution) return reject('agent_not_resumable');
          if (child.followups.length >= 4) return reject('multi_agent_followup_queue_full');
        }
        if (command === 'send') {
          const sent = this.options.store.sendMessage(group.id, { sender: { kind: 'user', actorId: scope.actorId }, receiverId: target.id, text: message! });
          return { operationId: input.operationId, state: 'applied', targetAgentId: target.id, messageId: sent.messageId };
        }
        if (command === 'followup') return { operationId: input.operationId, state: 'queued_next_admission', targetAgentId: target.id, expectedTurn: child!.context.turn + child!.followups.length + 1 };
        if (command === 'close') return { operationId: input.operationId, state: target.resourcesReleased ? 'completed' : 'cleanup_pending', targetAgentId: target.id,
          resourcesReleased: target.resourcesReleased, cleanupPending: !target.resourcesReleased };
        return { operationId: input.operationId, state: 'applied', targetAgentId: target.id };
      });
      if (existing || result.outcome === 'rejected' || !target) return result;
      if (command === 'followup') {
        clearTimeout(child!.ttl);
        child!.followups.push({ operationId: input.operationId, callerId: `root_${group.id}`, requestSource: 'user', message: message!,
          lane: group.lease && !group.lease.released ? group.lease.lane : 'foreground',
          sourceTaskId: child!.context.sourceTaskId,
          expectedTurn: result.expectedTurn!, forceNewEpoch: true, controller: new AbortController() });
        this.enqueueNextFollowup(group, child!);
      } else if (command === 'interrupt' && child) {
        let failed = false;
        try { this.cancelFollowups(group, child, new Error('user_interrupted')); } catch { failed = true; }
        if (target.status !== 'closed') group.core.interruptAgent({ requestSource: 'user', callerId: 'main', target: target.id });
        if (child.execution) this.markStopping(group, child, new Error('user_interrupted'));
        if (failed) { this.freezeGroup(group, 'multi_agent_cancellation_persistence_failed'); return { ...result, state: 'unknown' }; }
      } else if (command === 'close' && !target.resourcesReleased && !this.beginClose(group, target.id, 'user', input.operationId)) return { ...result, state: 'unknown' };
      this.wake(group); this.maybeDormant(group); return result;
    });
  }

  private requireUserAccess(access: DesktopMultiAgentUserAccess, groupId?: string): UserAccessState {
    const scope = this.userAccess.get(access);
    if (!scope?.active || this.disposed) throw new Error('invalid user access authority');
    const thread = this.options.store.getThread(scope.threadId);
    if (!thread || thread.profileId !== scope.profileId || thread.workspaceId !== scope.workspaceId
      || groupId && this.options.store.requireGroup(groupId).threadId !== scope.threadId) throw new Error('user access scope mismatch');
    return scope;
  }

  private publish(envelope: MultiAgentEnvelope): void {
    for (const subscription of [...this.listeners]) {
      try {
        const scope = this.requireUserAccess(subscription.access, 'groupId' in envelope ? envelope.groupId : undefined);
        if ('threadId' in envelope && envelope.threadId !== scope.threadId) continue;
        subscription.listener(envelope);
      } catch { /* A failed or foreign subscriber cannot affect live execution. */ }
    }
  }
  private assertWire(value: unknown): void {
    if (Buffer.byteLength(JSON.stringify(value)) > 64 * 1024) throw new Error('multi_agent_wire_limit_exceeded');
  }

  initialize(host: InProcessTaskRuntimeHost): Promise<void> {
    if (this.host && this.host !== host) return Promise.reject(new Error('multi_agent_host_owner_mismatch'));
    this.host = host;
    if (!this.initialization) {
      this.initialization = Promise.resolve().then(() => this.reconcileStartup(host)).catch(error => {
        this.runtimeBlockedReason = error instanceof Error ? error.message : 'multi_agent_recovery_failed';
        this.options.coordinator.block(this.runtimeBlockedReason); throw error;
      });
      host.bindMultiAgentRecovery(this.initialization);
    }
    return this.initialization;
  }

  bindHostDeliveryOwner(host: InProcessTaskRuntimeHost): DesktopHostDeliveryAuthority {
    if (host !== this.host || this.disposed || this.options.store.isClosed()) throw new Error('invalid_host_delivery_owner');
    if (this.hostDeliveryAuthority) return this.hostDeliveryAuthority;
    const authority = Object.freeze({ ownerId: randomUUID() });
    this.hostDeliveryOwners.set(authority, { host, bootId: this.options.store.bootId, active: true });
    this.hostDeliveryAuthority = authority;
    return authority;
  }

  /** Only the fixed host adapter may project delivery. User/agent tools cannot
   * gain this authority from requestSource, a copied handle or source strings. */
  async recordHostDelivery(input: { requestSource: Source; authority: DesktopHostDeliveryAuthority; report: HostDeliveryReport }): Promise<HostDeliveryReport> {
    this.requireHostDeliveryOwner(input.requestSource, input.authority);
    const report = captureHostDeliveryReport(input.report);
    const { source, delivery } = report;
    const binding = this.options.store.getRootBinding(source.sourceTaskId);
    if (!binding || source.bootId !== this.options.store.bootId
      || Object.entries(source).some(([key, value]) => binding[key as keyof MultiAgentRootBinding] !== value)) throw new Error('host_delivery_source_mismatch');
    const group = this.groups.get(source.groupId);
    // Sealed groups can be dormant. Reuse their existing command owner when
    // present; no new runtime or task is activated by a delivery report.
    const owner = this.resourceCommands.get(source.groupId) ?? { commands: group?.commands ?? new MultiAgentCommandSequencer(), users: 0 };
    owner.users++; this.resourceCommands.set(source.groupId, owner);
    try { await owner.commands.run(() => {
      this.requireHostDeliveryOwner(input.requestSource, input.authority);
      const current = this.options.store.getRootBinding(source.sourceTaskId);
      const durable = this.options.store.requireGroup(source.groupId);
      if (!current || source.bootId !== durable.bootId || durable.historicalOnly
        || Object.entries(source).some(([key, value]) => current[key as keyof MultiAgentRootBinding] !== value)) throw new Error('host_delivery_source_mismatch');
      if (current.phase !== 'settled') throw new Error('host_delivery_root_not_settled');
      // Recovery has a separate boot-scoped adapter; a live host handle never
      // authorizes the recovery-only unknown/committed reconciliation shape.
      if (delivery.guardFailure?.code === 'recovery_unconfirmed') throw new Error('host_delivery_recovery_not_allowed');
      if (this.disposed && !current.delivery) throw new Error('host_delivery_shutdown');
      if (current.delivery) captureHostDeliveryReport({ source, delivery: current.delivery });
      if (current.delivery && encodeMultiAgentRow(current.delivery) === encodeMultiAgentRow(delivery)) return;
      assertHostDeliveryAdvance(current.delivery, delivery);
      try {
        this.options.store.transaction(() => {
          this.options.store.putRootBinding({ ...current, delivery }, true);
          const root = this.requireAgent(source.groupId, `root_${source.groupId}`);
          if (root.sourceTaskId === source.sourceTaskId && root.turnId === source.rootTurnId && root.turn === source.rootEpoch) {
            this.options.store.putAgent(source.groupId, { ...root, hostDeliveryStatus: delivery.status,
              guardFailure: delivery.guardFailure, hostDeliveryCleanupPending: delivery.readerCleanup === 'pending' || delivery.storeCleanup === 'pending' }, true);
          }
          this.options.store.appendEvent(source.groupId, { kind: 'delivery', agentId: root.id, turnId: source.rootTurnId,
            payload: { source, delivery } });
        });
        if ((delivery.hostSettlement === 'committed' || delivery.stage === 'cleanup')
          && delivery.readerCleanup !== 'pending' && delivery.storeCleanup !== 'pending') {
          this.pendingHostDeliveries.delete(source.sourceTaskId);
        } else this.pendingHostDeliveries.add(source.sourceTaskId);
      } catch (error) {
        if (group) this.freezeGroup(group, 'host_delivery_persistence_failed');
        throw error;
      }
    }); } finally {
      if (--owner.users === 0 && this.resourceCommands.get(source.groupId) === owner) this.resourceCommands.delete(source.groupId);
    }
    return report;
  }

  private requireHostDeliveryOwner(source: Source, authority: DesktopHostDeliveryAuthority): HostDeliveryOwner {
    const owner = this.hostDeliveryOwners.get(authority);
    if (this.options.store.isClosed()) { if (owner) owner.active = false; throw new Error('host_delivery_store_closed'); }
    if (source !== 'scheduler' || !owner?.active || owner.host !== this.host || owner.bootId !== this.options.store.bootId) throw new Error('invalid_host_delivery_owner');
    return owner;
  }

  private async reconcileStartup(host: InProcessTaskRuntimeHost): Promise<void> {
    this.options.store.claimBootOwnership();
    if (this.options.executionDomain) {
      const { profileId, workspaceId } = this.options.executionDomain;
      const row = this.options.store.initializeWorkspaceAuthorization({ profileId, workspaceId });
      this.authorizationReceipt(row);
      this.authorization = { bootId: this.options.store.bootId, permissionRevision: row.permissionRevision,
        executionAllowed: row.executionAllowed, persistenceState: 'confirmed' };
      this.options.onExecutionAuthorizationChanged?.({ ...this.authorization });
    }
    // Cross-check both sources: a checkpoint can exist before its active index,
    // and an active host marker can survive a missing journal row.
    const activeIds = (await this.trackRecovery(host.inspectActiveTasks())).map(task => task.taskId);
    const recoveryIds = function* (store: DesktopMultiAgentStore): Generator<string> {
      for (const binding of store.previousRootBindings()) yield binding.sourceTaskId;
      for (const taskId of activeIds) if (!store.getRootBinding(taskId)) yield taskId;
    };
    const inspectRecoveryMarker = async (taskId: string): Promise<TaskMultiAgentPreparation | undefined> => {
      const snapshot = await this.trackRecovery(host.inspectTask(taskId, { trackPending: this.trackRecovery }));
      const marker = snapshot?.multiAgentPreparation;
      const binding = this.options.store.getRootBinding(taskId);
      if (snapshot && binding && (!marker || encodeMultiAgentRow(marker) !== encodeMultiAgentRow(this.marker(binding)))) {
        throw new Error('multi_agent_preparation_identity_mismatch');
      }
      if (binding?.delivery && !snapshot) throw new Error('host_delivery_snapshot_missing');
      if (binding && snapshot) {
        reconcileHostDeliveryRecords(this.deliverySource(binding), snapshot.hostDelivery, binding.delivery);
        if (snapshot.hostDelivery?.hostSettlement === 'committed' && snapshot.hostDelivery.hostTerminalStatus !== snapshot.status) throw new Error('host_delivery_terminal_mismatch');
      }
      if (!marker || marker.bootId === this.options.store.bootId) return undefined;
      // Host-only checkpoints also carry a physical ownership obligation. A
      // missing MA journal is not proof that their former executor has exited.
      this.options.store.assertResourceOwnerSettled(marker.bootId);
      return marker;
    };
    // Validate both sources before changing either one. Re-inspect on the
    // compensation pass and let the host's marker CAS guard the awaited gap.
    for (const taskId of recoveryIds(this.options.store)) await inspectRecoveryMarker(taskId);
    this.options.store.recoverPreviousBoot();
    for (const taskId of recoveryIds(this.options.store)) {
      const marker = await inspectRecoveryMarker(taskId);
      if (marker) await this.reconcileHostDelivery(host, taskId, marker);
    }
    for (const group of this.options.store.previousGroups()) {
      for (const resource of this.options.store.resources(group.groupId)) {
        if (!['released', 'retained_by_policy'].includes(resource.state)) this.options.store.assertResourceOwnerSettled(resource.ownerBootId);
      }
      await this.options.worktrees?.reconcile(group.groupId);
      this.options.store.reconcileAgentResources(group.groupId);
    }
    if (this.disposed) throw new Error('multi_agent_disposed_during_recovery');
    this.initialized = true;
    this.options.coordinator.setReady(true);
  }

  private trackRecovery = <T>(raw: Promise<T>): Promise<T> => {
    if (!this.recoveryPending.has(raw)) {
      this.recoveryPending.add(raw);
      void raw.then(() => this.recoveryPending.delete(raw), () => this.recoveryPending.delete(raw));
    }
    return raw;
  };

  private deliverySource(binding: MultiAgentRootBinding): HostDeliverySource {
    return { sourceTaskId: binding.sourceTaskId, ...this.marker(binding) };
  }

  /** No source string, copied handle or live report authority grants recovery. */
  assertDeliveryRecovery(input: HostDeliveryRecoveryInvocation): void {
    const owner = input && this.deliveryRecoveryOwners.get(input.authority);
    if (!owner || owner.host !== this.host || !this.initialization || this.initialized || this.disposed || this.options.store.isClosed()) throw new Error('invalid_delivery_recovery_owner');
    const source = owner.source, binding = this.options.store.getRootBinding(source.sourceTaskId);
    if (!binding || !isDeepStrictEqual(this.deliverySource(binding), source) || source.bootId === this.options.store.bootId
      || input.taskId !== source.sourceTaskId || input.snapshot?.taskId !== source.sourceTaskId
      || !isDeepStrictEqual(input.snapshot.multiAgentPreparation, this.marker(binding))) throw new Error('delivery_recovery_source_mismatch');
    this.options.store.assertResourceOwnerSettled(source.bootId);
    if (owner.host.inFlightTaskIds().includes(input.taskId)) throw new Error('delivery_recovery_live_execution');
    if (owner.phase === 'host') {
      if (Object.keys(input).some(key => !['authority', 'taskId', 'snapshot', 'delivery'].includes(key))
        || binding.phase !== 'settled' || !owner.delivery || owner.delivery.revision !== owner.expectedDeliveryRevision
        || !isDeepStrictEqual(input.delivery, owner.delivery)) throw new Error('delivery_recovery_host_mismatch');
    } else {
      const { authority: _authority, ...receipt } = input;
      if (!owner.receipt || !isDeepStrictEqual(receipt, owner.receipt)
        || (input.snapshot.hostDelivery?.revision ?? 0) !== owner.expectedDeliveryRevision) throw new Error('delivery_recovery_receipt_mismatch');
    }
  }

  private async reconcileHostDelivery(host: InProcessTaskRuntimeHost, taskId: string, marker: TaskMultiAgentPreparation): Promise<void> {
    let snapshot = await this.trackRecovery(host.inspectTask(taskId, { trackPending: this.trackRecovery }));
    const binding = this.options.store.getRootBinding(taskId);
    if (!snapshot || !binding) {
      await this.trackRecovery(host.abandonMultiAgentPreparation({ requestSource: 'scheduler', taskId, expectedMarker: marker, trackPending: this.trackRecovery }));
      return;
    }
    const source = this.deliverySource(binding);
    const observation = reconcileHostDeliveryRecords(source, snapshot.hostDelivery, binding.delivery);
    const authority = Object.freeze({ ownerId: randomUUID() });
    const owner: DeliveryRecoveryOwner = { host, source, phase: 'host', expectedDeliveryRevision: observation?.revision ?? 0, delivery: observation };
    this.deliveryRecoveryOwners.set(authority, owner);
    try {
      if (!['completed', 'failed', 'cancelled'].includes(snapshot.status)) {
        await this.trackRecovery(host.abandonMultiAgentPreparation({ requestSource: 'scheduler', taskId, expectedMarker: marker,
          ...(binding.phase === 'settled' && observation ? { delivery: { authority, record: observation } } : {}), trackPending: this.trackRecovery }));
        snapshot = await this.trackRecovery(host.inspectTask(taskId, { trackPending: this.trackRecovery }));
      }
      if (!snapshot || !['completed', 'failed', 'cancelled'].includes(snapshot.status) || !isDeepStrictEqual(snapshot.multiAgentPreparation, marker)) throw new Error('delivery_recovery_terminal_missing');
      let eventIndex = snapshot.events.length - 1;
      while (eventIndex >= 0 && snapshot.events[eventIndex].type !== 'task_terminal') eventIndex -= 1;
      const event = snapshot.events[eventIndex];
      if (!event || event.type !== 'task_terminal' || event.status !== snapshot.status) throw new Error('delivery_recovery_terminal_mismatch');
      const delivery = snapshot.hostDelivery;
      if (delivery) {
        captureHostDeliveryReport({ source, delivery });
        if (delivery.hostSettlement !== 'committed' || delivery.hostTerminalStatus !== snapshot.status) throw new Error('delivery_recovery_uncommitted_terminal');
        const current = this.options.store.getRootBinding(taskId)!;
        const latest = reconcileHostDeliveryRecords(source, delivery, current.delivery)!;
        // Preserve the committed host snapshot. Cleanup observation is a new
        // service recovery projection only; it never appends a host terminal.
        const recovered: HostDeliveryRecord = { ...delivery,
          readerCleanup: delivery.readerCleanup === 'pending' ? 'settled' : delivery.readerCleanup,
          storeCleanup: 'settled' };
        const equal = current.delivery && isDeepStrictEqual({ ...current.delivery, revision: recovered.revision }, recovered);
        if (!equal) {
          recovered.revision = Math.max(latest.revision, delivery.revision) + 1;
          captureHostDeliveryReport({ source, delivery: recovered });
          this.options.store.transaction(() => {
            const currentBinding = this.options.store.getRootBinding(taskId);
            if (!currentBinding || !isDeepStrictEqual(this.deliverySource(currentBinding), source)) throw new Error('delivery_recovery_source_mismatch');
            this.options.store.putRootBinding({ ...currentBinding, delivery: recovered }, true);
            const root = this.requireAgent(source.groupId, `root_${source.groupId}`);
            if (root.sourceTaskId === taskId && root.turnId === source.rootTurnId && root.turn === source.rootEpoch) this.options.store.putAgent(source.groupId, {
              ...root, hostDeliveryStatus: recovered.status, guardFailure: recovered.guardFailure, hostDeliveryCleanupPending: false,
            }, true);
            this.options.store.appendEvent(source.groupId, { kind: 'delivery', agentId: root.id, turnId: source.rootTurnId, payload: { source, delivery: recovered } });
          });
        }
      }
      owner.phase = 'consumers'; owner.expectedDeliveryRevision = snapshot.hostDelivery?.revision ?? 0;
      owner.receipt = structuredClone({ taskId, snapshot, eventIndex, event });
      const receipt = { ...structuredClone(owner.receipt), authority };
      this.assertDeliveryRecovery(receipt);
      if (snapshot.executionScope?.kind === 'goal_turn' && !this.options.onRecoveredHostTerminal) throw new Error('delivery_recovery_consumer_unavailable');
      if (this.options.onRecoveredHostTerminal) await this.trackRecovery(this.options.onRecoveredHostTerminal(receipt));
    } finally { this.deliveryRecoveryOwners.delete(authority); }
  }

  async prepareRoot(host: InProcessTaskRuntimeHost, threadId: string, input: TaskCreateInput): Promise<{ taskId: string }> {
    const lane = currentExecutionLane();
    this.assertReady();
    const permissionRevision = this.assertExecutionAuthorization();
    this.assertThreadAdmission(threadId);
    if (this.pendingResets.has(threadId)) throw new Error('group_reset_pending');
    const store = this.options.store;
    const previousGroup = store.activeGroup(threadId);
    if (!previousGroup && store.threadHasUnreleasedResources(threadId)) throw new Error('multi_agent_thread_cleanup_pending');
    const thread = store.getThread(threadId);
    if (!thread) throw new Error('unknown multi-agent thread binding');
    this.assertExecutionDomain(thread);
    const durable = previousGroup ?? store.createGroup(threadId, permissionRevision);
    if (!previousGroup) this.publishGroupChanged(threadId, null, durable.groupId);
    const group = this.liveGroup(durable.groupId);
    const reservation = host.reserveTaskIdentity();
    const preparation = await group.commands.run(() => {
      this.assertWritable(group);
      if (group.root) throw new Error('multi_agent_root_busy');
      const latest = store.requireGroup(group.id);
      const binding: MultiAgentRootBinding = {
        sourceTaskId: reservation.taskId, groupId: group.id, threadId, rootTurnId: randomUUID(),
        rootEpoch: latest.nextRootEpoch + 1, preparationId: randomUUID(), bootId: store.bootId,
        phase: 'preparing', status: 'pending',
      };
      store.transaction(() => {
        store.putGroup({ ...latest, nextRootEpoch: binding.rootEpoch });
        store.putRootBinding(binding);
        const previous = this.requireAgent(group.id, `root_${group.id}`);
        const rootAgent = store.putAgent(group.id, { ...previous, status: 'pending', turn: binding.rootEpoch, turnId: binding.rootTurnId,
          hostDeliveryStatus: undefined, guardFailure: undefined, hostDeliveryCleanupPending: undefined,
          sourceTaskId: binding.sourceTaskId, executionActive: false, runtimeResident: false, sessionResident: false,
          resourcesReleased: false, cleanupPending: false, stopState: 'none', activationState: 'prepared', error: undefined, endedAt: undefined });
        store.appendEvent(group.id, { kind: 'status', agentId: rootAgent.id, turnId: binding.rootTurnId, payload: { agent: rootAgent } });
      });
      const root: RootPreparation = { binding, controller: new AbortController(), started: false, preparing: true };
      group.root = root;
      return root;
    });
    try {
      await host.prepareTask(input, { reservation, marker: this.marker(preparation.binding) });
      await group.commands.run(() => {
        this.assertWritable(group);
        if (group.root !== preparation || preparation.controller.signal.aborted) throw new Error('multi_agent_preparation_cancelled');
        preparation.binding = { ...preparation.binding, phase: 'queued' };
        store.putRootBinding(preparation.binding);
        preparation.request = group.lease && !group.lease.released
          ? this.options.coordinator.joinOrEnqueue(group.id, group.lease.epoch, 'root', preparation.controller.signal)
          : this.options.coordinator.acquireLease({ groupId: group.id, policy: 'multiAgent', signal: preparation.controller.signal, lane });
        // Own the synchronous grant even if the host is cancelled before startTask.
        preparation.ticket = preparation.request.ticket;
        void preparation.request.then(ticket => { preparation.ticket = ticket; }, () => {});
      });
      return { taskId: reservation.taskId };
    } catch (error) {
      preparation.controller.abort(error);
      preparation.ticket?.release();
      try {
        await group.commands.run(() => {
          store.transaction(() => {
            store.putRootBinding({ ...preparation.binding, phase: 'abandoned', status: 'interrupted' }, true);
            const rootAgent = this.requireAgent(group.id, `root_${group.id}`);
            store.putAgent(group.id, { ...rootAgent, status: 'interrupted', resourcesReleased: false, cleanupPending: true, activationState: 'prepared' }, true);
          });
        });
      } catch { this.freezeGroup(group, 'multi_agent_preparation_compensation_failed'); }
      try {
        const checkpoint = await host.inspectTask(reservation.taskId);
        if (checkpoint?.multiAgentPreparation) await host.abandonMultiAgentPreparation({ requestSource: 'scheduler', taskId: reservation.taskId, expectedMarker: this.marker(preparation.binding) });
      } catch { this.freezeGroup(group, 'multi_agent_host_compensation_failed'); }
      throw error;
    } finally {
      await group.commands.run(() => {
        preparation.preparing = false;
        if (group.root !== preparation || !preparation.controller.signal.aborted) return;
        try {
          const rootAgent = this.requireAgent(group.id, `root_${group.id}`);
          store.putAgent(group.id, { ...rootAgent, resourcesReleased: true, cleanupPending: false, activationState: 'settled' }, true);
          group.root = undefined;
        } catch { this.freezeGroup(group, 'multi_agent_preparation_compensation_failed'); }
      });
    }
  }

  assertHostPreparation(taskId: string, marker: TaskMultiAgentPreparation): void {
    this.assertReady();
    const binding = this.options.store.getRootBinding(taskId);
    if (!binding || binding.phase !== 'preparing' || binding.bootId !== this.options.store.bootId
      || encodeMultiAgentRow(this.marker(binding)) !== encodeMultiAgentRow(marker)) throw new Error('multi_agent_binding_missing_or_mismatched');
    this.assertExecutionAuthorization(this.options.store.requireGroup(binding.groupId).permissionRevision ?? 0);
  }

  assertHostAdmission(snapshot: TaskSnapshot): void {
    this.assertReady();
    if (snapshot.context?.threadId) this.assertThreadAdmission(snapshot.context.threadId);
    const binding = this.options.store.getRootBinding(snapshot.taskId);
    if (!snapshot.multiAgentPreparation && !binding) return;
    if (!binding || !snapshot.multiAgentPreparation || binding.bootId !== this.options.store.bootId
      || binding.phase !== 'queued' || encodeMultiAgentRow(this.marker(binding)) !== encodeMultiAgentRow(snapshot.multiAgentPreparation)) {
      throw new Error('multi_agent_prepare_interrupted');
    }
    this.assertWritable(this.liveGroup(binding.groupId));
  }

  /** Main-only host adapter. Agent controls cannot call this root cancellation path. */
  async decideHostCancellation(snapshot: TaskSnapshot, reason: string): Promise<TaskCancellationDecision> {
    const binding = this.options.store.getRootBinding(snapshot.taskId);
    if (!binding && !snapshot.multiAgentPreparation) return { hostAbortAllowed: true };
    if (!binding || !snapshot.multiAgentPreparation || encodeMultiAgentRow(this.marker(binding)) !== encodeMultiAgentRow(snapshot.multiAgentPreparation)) return { hostAbortAllowed: false };
    const root = this.groups.get(binding.groupId)?.root;
    // Only the main lease timer can create this decision. A late seal may already
    // have recorded interrupted, but cannot revoke the winning physical abort.
    if (reason === 'multi_agent_lease_expired' && root?.binding.sourceTaskId === snapshot.taskId && root.leaseExpiryDecision) return root.leaseExpiryDecision;
    return this.cancelRootTurn({ requestSource: 'scheduler', sourceTaskId: snapshot.taskId, expectedRootEpoch: binding.rootEpoch, reason });
  }

  async cancelRootTurn(input: { requestSource: Source; sourceTaskId: string; expectedRootEpoch: number; reason: string }): Promise<TaskCancellationDecision> {
    // Scheduler here means the authenticated main host adapter, never model input.
    // User IPC goes through that adapter after its window/profile authorization.
    if (input.requestSource !== 'scheduler') return { hostAbortAllowed: false };
    const binding = this.options.store.getRootBinding(input.sourceTaskId);
    if (!binding || binding.rootEpoch !== input.expectedRootEpoch || binding.bootId !== this.options.store.bootId) return { hostAbortAllowed: false };
    const group = this.groups.get(binding.groupId);
    if (!group || this.disposed) return { hostAbortAllowed: false };
    return group.commands.run(() => {
      const current = this.options.store.getRootBinding(input.sourceTaskId);
      const root = group.root;
      if (!current || !root || root.binding.sourceTaskId !== input.sourceTaskId || current.rootEpoch !== input.expectedRootEpoch
        || current.phase === 'settled' || current.phase === 'abandoned' || root.context && this.actors.get(root.context.actor)?.sealed) {
        return { hostAbortAllowed: false };
      }
      let failed = false;
      try {
        this.options.store.transaction(() => {
          this.options.store.putRootBinding({ ...current, phase: 'abandoned', status: 'interrupted' }, true);
          const before = this.requireAgent(group.id, `root_${group.id}`);
          const agent = this.options.store.putAgent(group.id, { ...before, status: 'interrupted', stopState: root.context ? 'requested' : 'none',
            ...(root.context ? {} : root.preparing ? { resourcesReleased: false, cleanupPending: true, activationState: 'prepared' as const }
              : { resourcesReleased: true, activationState: 'settled' as const }) }, true);
          this.options.store.appendEvent(group.id, { kind: 'status', agentId: agent.id, payload: { agent } });
        });
      } catch { failed = true; }
      // A failed authorized intent write still permits physical abort. Denied or
      // stale decisions never reach this block and never authorize host cancel.
      const reason = new Error(input.reason);
      root.controller.abort(reason);
      for (const child of group.children.values()) {
        try { this.cancelFollowups(group, child, reason); } catch { failed = true; }
      }
      if (!root.started) {
        (root.ticket ?? root.request?.ticket)?.release();
        if (group.root === root && !root.preparing) group.root = undefined;
      }
      if (root.context) this.markRootStopping(group, root);
      if (root.context && group.lease?.epoch === root.context.memberTicket.epoch) {
        group.leaseController?.abort(reason);
        for (const child of group.children.values()) {
          if (child.execution && child.context.memberTicket.epoch === group.lease.epoch) this.markStopping(group, child, reason);
        }
      }
      if (failed) this.freezeGroup(group, 'multi_agent_cancellation_persistence_failed');
      this.wake(group);
      return { hostAbortAllowed: true, ack: failed ? 'unknown' : 'applied' };
    });
  }

  async runRoot<T>(input: TaskRunnerInput, action: (context: DesktopAgentExecutionContext) => Promise<T>): Promise<T> {
    this.assertReady();
    const binding = this.options.store.getRootBinding(input.taskId);
    if (!binding) throw new Error('multi_agent_root_not_prepared');
    const group = this.liveGroup(binding.groupId);
    const root = group.root;
    if (!root || root.binding.sourceTaskId !== input.taskId || root.started || !root.request) throw new Error('multi_agent_root_not_admitted');
    root.started = true;
    const abortQueued = () => root.controller.abort(input.signal.reason);
    input.signal.addEventListener('abort', abortQueued, { once: true });
    if (input.signal.aborted) abortQueued();
    let context: DesktopAgentExecutionContext | undefined;
    try {
      root.ticket = await root.request;
      if (root.controller.signal.aborted) throw root.controller.signal.reason ?? new DOMException('aborted', 'AbortError');
      context = await group.commands.run(() => {
        this.assertWritable(group);
        if (group.root !== root) throw new Error('stale root preparation');
        this.installLease(group, root.ticket!);
        const context = this.createContext(group, `root_${group.id}`, root.binding.rootTurnId, root.binding.rootEpoch, root.ticket!, root.controller.signal);
        root.context = context;
        root.binding = { ...root.binding, phase: 'active', status: 'running' };
        this.options.store.transaction(() => {
          this.options.store.putRootBinding(root.binding);
          this.options.store.putGroup({ ...this.options.store.requireGroup(group.id), currentRootEpoch: root.binding.rootEpoch });
          const previous = this.requireAgent(group.id, context.agentId);
          const agent = this.options.store.putAgent(group.id, { ...previous, status: 'running', turn: context.turn, turnId: context.turnId, sourceTaskId: input.taskId,
            hostDeliveryStatus: undefined, guardFailure: undefined, hostDeliveryCleanupPending: undefined,
            executionActive: true, runtimeResident: true, sessionResident: true, resourcesReleased: false, startedAt: Date.now(), activationState: 'active' });
          this.options.store.appendEvent(group.id, { kind: 'status', agentId: context.agentId, payload: { agent } });
        });
        return context;
      });
      const result = await action(context);
      if (context.signal.aborted && this.actors.get(context.actor)?.outcome !== 'completed') throw context.signal.reason;
      // The production loop normally seals first. This also fences unexpected
      // early returns by a runner without silently discarding pending input.
      const seal = await context.mailbox.trySealTurn({ limitReached: true });
      if (seal.kind === 'limit_reached') throw new Error('multi_agent_iteration_limit');
      return result;
    } catch (error) {
      if (context) {
        try { await context.mailbox.trySealTurn({ outcome: context.signal.aborted ? 'interrupted' : 'failed' }); }
        catch { this.freezeGroup(group, 'multi_agent_persistence_failed'); }
      }
      throw error;
    } finally {
      input.signal.removeEventListener('abort', abortQueued);
      clearTimeout(root.stopTimer);
      try {
        await group.commands.run(() => {
          if (context) {
            const actor = this.actors.get(context.actor); if (actor) actor.active = false;
            const previous = this.requireAgent(group.id, context.agentId);
            this.options.store.putAgent(group.id, { ...previous, executionActive: false, runtimeResident: false, sessionResident: false, resourcesReleased: true,
              cleanupPending: false, stopState: 'none', activationState: 'settled' }, true);
          }
          if (group.root === root) group.root = undefined;
          this.wake(group);
        });
      } finally { root.ticket?.release(); this.clearReleasedLease(group); }
    }
  }

  async spawn(input: AgentRequest & { taskName: string; message: string; sessionSeed?: DesktopAgentSessionSeed }): Promise<MultiAgentControlResult> {
    const state = this.requireActor(input.actor, input.requestSource);
    return state.group.commands.run(() => {
      this.requireActor(input.actor, input.requestSource);
      this.validateText(input.message);
      if (!/^[a-z0-9_]{1,64}$/.test(input.taskName)) throw new Error('invalid task_name');
      const group = state.group;
      const requestHash = this.requestHash(input.operationId, { command: 'spawn', actor: input.actor, taskName: input.taskName, message: input.message, seedId: input.sessionSeed?.seedId });
      const previous = this.persistenceIO(group, () => this.options.store.getOperation(group.id, input.operationId));
      if (previous) {
        if (previous.requestHash !== requestHash) throw new Error('operation_id_conflict');
        return previous.result as unknown as MultiAgentControlResult;
      }
      if (this.slots.size >= MAX_RESIDENT_CHILDREN) {
        const reclaiming = this.requestCapacityReclaim();
        throw new Error(reclaiming ? 'multi_agent_capacity_reclaiming' : 'multi_agent_capacity_exceeded');
      }
      // This retained member exists before prepared/applied and survives root seal.
      const ticket = state.context.memberTicket.retain();
      let prepared: PreparedAgentHandle | undefined;
      let child: LiveChild | undefined;
      let phase: 'journal' | 'prepare' | 'apply' | 'activate' = 'journal';
      try {
        this.options.store.putOperation({ groupId: group.id, operationId: input.operationId, command: 'spawn', requestHash, applyState: 'prepared', result: { operationId: input.operationId, state: 'unknown' } });
        phase = 'prepare';
        prepared = group.core.prepareSpawn({ requestSource: 'agent', callerId: this.coreId(group, state.context.agentId), taskName: input.taskName, message: input.message,
          createSession: async (identity, signal) => {
            const session = await this.options.createSession({ groupId: group.id, identity, parent: state.context, signal, sessionSeed: input.sessionSeed,
              bindWorkingDirectory: cwd => {
                if (!child || signal.aborted) throw new Error('multi_agent_child_not_activated');
                this.requireActor(child.context.actor, 'agent');
                child.cwd = cwd; child.context.cwd = cwd;
              },
              getTurnContext: () => {
                if (!child) throw new Error('multi_agent_child_not_activated');
                this.requireActor(child.context.actor, 'agent'); return child.context;
              } });
            child!.sessionResident = true;
            return {
              run: async (message, runSignal, runContext) => {
                const context = child!.context;
                await this.recordRunStarted(context, message);
                const result = await session.run(message, runSignal, runContext);
                if (child!.context === context) child!.fullResult = result;
                return result;
              },
              ...(session.suspend ? { suspend: () => session.suspend!() } : {}),
              ...(session.deactivate ? { deactivate: () => session.deactivate!() } : {}),
              dispose: async () => { await session.dispose(); child!.sessionResident = false; },
            };
          } });
        const controller = new AbortController();
        const context = this.createContext(group, prepared.agentId, randomUUID(), prepared.expectedTurn, ticket, controller.signal);
        child = { id: prepared.agentId, parentId: state.context.agentId, context, prepared, sessionResident: false, stopRequested: false, controller, followups: [] };
        group.children.set(child.id, child); this.slots.add(child.id);
        const result: MultiAgentControlResult = { operationId: input.operationId, state: 'applied', targetAgentId: child.id, expectedTurn: prepared.expectedTurn };
        phase = 'apply';
        this.options.store.transaction(() => {
          this.persistCoreSnapshot(group, prepared!.snapshot);
          this.options.store.putOperation({ groupId: group.id, operationId: input.operationId, command: 'spawn', requestHash, applyState: 'applied', result: { ...result } });
        });
        phase = 'activate'; child.execution = group.core.activatePreparedTurn(prepared, { signal: context.signal });
        this.observeSettlement(group, child);
        return result;
      } catch (error) {
        if (prepared && !child?.execution) group.core.rollbackPrepared(prepared);
        if (child && !child.execution) { this.slots.delete(child.id); group.children.delete(child.id); this.actors.get(child.context.actor)!.active = false; }
        if (!child?.execution) ticket.release();
        if (phase === 'prepare' && !prepared) {
          // A canonical-name/depth validation rejection is not a database fault.
          try {
            this.options.store.putOperation({ groupId: group.id, operationId: input.operationId, command: 'spawn', requestHash, applyState: 'applied',
              result: { operationId: input.operationId, state: 'completed', outcome: 'rejected', error: truncateMultiAgentText(String(error), 512).text } }, true);
          } catch { this.freezeGroup(group, 'multi_agent_persistence_failed'); }
        } else this.freezeGroup(group, 'multi_agent_persistence_failed');
        throw error;
      }
    });
  }

  async send(input: AgentRequest & { target: string; message: string }): Promise<MultiAgentControlResult> {
    const state = this.requireActor(input.actor, input.requestSource);
    return state.group.commands.run(() => {
      this.requireActor(input.actor, input.requestSource); this.validateText(input.message);
      const target = this.resolveTarget(state, input.target);
      if (target.status === 'closed') throw new Error('target is closed');
      return this.mutate(state.group, input, 'send', { target: target.id, message: input.message }, () => {
        const message = this.options.store.sendMessage(state.group.id, { sender: { kind: 'agent', agentId: state.context.agentId }, receiverId: target.id, text: input.message });
        return { operationId: input.operationId, state: 'applied', targetAgentId: target.id, messageId: message.messageId };
      });
    });
  }

  async interrupt(input: AgentRequest & { target: string }): Promise<MultiAgentControlResult> {
    const state = this.requireActor(input.actor, input.requestSource);
    return state.group.commands.run(() => {
      this.requireActor(input.actor, input.requestSource);
      const target = this.resolveTarget(state, input.target); this.assertDescendant(state, target);
      const existing = this.persistenceIO(state.group, () => this.options.store.getOperation(state.group.id, input.operationId));
      const result = this.mutate(state.group, input, 'interrupt', { target: target.id }, () => {
        return { operationId: input.operationId, state: 'applied', targetAgentId: target.id };
      });
      if (existing) return result;
      const child = state.group.children.get(target.id)!;
      let failed = false;
      try { this.cancelFollowups(state.group, child, new Error('multi_agent_interrupted')); } catch { failed = true; }
      state.group.core.interruptAgent({ requestSource: 'agent', callerId: this.coreId(state.group, state.context.agentId), target: target.id });
      if (child.execution) this.markStopping(state.group, child, new Error('multi_agent_interrupted'));
      if (failed) { this.freezeGroup(state.group, 'multi_agent_cancellation_persistence_failed'); return { ...result, state: 'unknown' }; }
      this.wake(state.group);
      return result;
    });
  }

  async followup(input: AgentRequest & { target: string; message: string }): Promise<MultiAgentControlResult> {
    const state = this.requireActor(input.actor, input.requestSource);
    return state.group.commands.run(() => {
      this.requireActor(input.actor, input.requestSource); this.validateText(input.message);
      const target = this.resolveTarget(state, input.target); this.assertDescendant(state, target);
      const child = state.group.children.get(target.id);
      if (!child || !target.resumable || target.cleanupError || child.stopRequested && child.execution) throw new Error('agent is not resumable');
      const existing = this.persistenceIO(state.group, () => this.options.store.getOperation(state.group.id, input.operationId));
      if (child.followups.length >= 4 && !existing) throw new Error('multi_agent_followup_queue_full');
      const expectedTurn = child.context.turn + child.followups.length + 1;
      const result = this.mutate(state.group, input, 'followup', { target: target.id, message: input.message }, () => child.followups.some(pending => pending.requestSource === 'user')
        ? { operationId: input.operationId, state: 'completed', outcome: 'rejected', targetAgentId: target.id, error: 'multi_agent_followup_user_barrier' }
        : { operationId: input.operationId, state: 'queued_next_admission', targetAgentId: target.id, expectedTurn });
      if (existing || result.outcome === 'rejected') return result;
      clearTimeout(child.ttl);
      child.followups.push({ operationId: input.operationId, callerId: state.context.agentId, message: input.message, expectedTurn,
        lane: state.context.memberTicket.lane,
        sourceTaskId: state.context.sourceTaskId,
        acceptedEpoch: state.context.memberTicket.epoch,
        forceNewEpoch: false, controller: new AbortController(), requestSource: 'agent' });
      this.enqueueNextFollowup(state.group, child);
      return result;
    });
  }

  async wait(input: { actor: DesktopAgentActor; requestSource: Source; targets: string[]; timeoutMs: number; operationId?: string; expectedTurn?: number }): Promise<DesktopAgentWaitResult> {
    const state = this.requireActor(input.actor, input.requestSource);
    if (!input.targets.length || input.targets.length > 8) throw new Error('invalid wait targets');
    const targets = input.targets.map(target => this.resolveTarget(state, target).id);
    if (input.expectedTurn !== undefined && (!Number.isSafeInteger(input.expectedTurn) || input.expectedTurn < 1)) throw new Error('multi_agent_wait_invalid_turn');
    let expectedTurn = input.expectedTurn;
    if (input.operationId) {
      const operation = this.persistenceIO(state.group, () => this.options.store.getOperation(state.group.id, input.operationId!));
      if (!operation || !['spawn', 'followup'].includes(operation.command) || targets.length !== 1
        || operation.result.targetAgentId !== targets[0] || operation.result.outcome === 'rejected'
        || expectedTurn !== undefined && operation.result.expectedTurn !== expectedTurn) throw new Error('multi_agent_wait_invalid_operation');
      const operationTurn = operation.result.expectedTurn;
      if (operationTurn !== undefined && (typeof operationTurn !== 'number' || !Number.isSafeInteger(operationTurn) || operationTurn < 1)) throw new Error('multi_agent_wait_invalid_operation');
      expectedTurn ??= operationTurn;
    }
    const deadline = Date.now() + Math.max(1, Math.min(30_000, input.timeoutMs));
    const inspect = (): DesktopAgentWaitResult | undefined => {
      this.requireActor(input.actor, input.requestSource);
      const agents = targets.map(id => this.requireOwnedAgent(state.group, id));
      let future = false;
      for (const agent of agents) {
        const pending = state.group.children.get(agent.id)?.followups ?? [];
        const requestedTurn = expectedTurn ?? pending.filter(item => item.callerId === state.context.agentId && item.requestSource === 'agent').at(-1)?.expectedTurn;
        if (requestedTurn !== undefined && agent.turn > requestedTurn) throw new Error('multi_agent_wait_turn_superseded');
        if (requestedTurn !== undefined && agent.turn < requestedTurn) {
          const next = pending.find(item => item.expectedTurn === requestedTurn);
          if (!next) throw new Error('multi_agent_wait_invalid_turn');
          if (pending.some(item => item.expectedTurn <= requestedTurn && item.forceNewEpoch)) throw new Error('multi_agent_wait_user_barrier');
          if (pending.some(item => item.expectedTurn <= requestedTurn && item.acceptedEpoch !== state.context.memberTicket.epoch)) throw new Error('multi_agent_wait_epoch_barrier');
          future = true;
        }
      }
      if (!future && agents.every(agent => TERMINAL.has(agent.status) && !agent.executionActive)) return { reason: 'settled_terminal', settled: true, agents };
      if (agents.some(agent => agent.executionActive && (agent.status === 'interrupted' || agent.stopState !== 'none'))) return { reason: 'stopping', settled: false, agents };
      const messages = this.persistenceIO(state.group, () => this.options.store.unreadMessageIds(state.group.id, state.context.agentId, targets));
      if (messages.length) return { reason: 'message', settled: false, agents, messageIds: messages };
      if (Date.now() >= deadline) return { reason: 'timeout', settled: false, agents };
      return undefined;
    };
    for (;;) {
      const result = await state.group.commands.run(inspect);
      if (result) return result;
      await new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout>;
        const done = () => { clearTimeout(timer); state.group.waiters.delete(done); resolve(); };
        state.group.waiters.add(done);
        timer = setTimeout(done, Math.max(1, deadline - Date.now()));
        // Register and inspect in one JS turn; do not lose a settled event.
        try { if (inspect()) done(); }
        catch (error) { clearTimeout(timer); state.group.waiters.delete(done); reject(error); }
      });
    }
  }

  list(input: { actor: DesktopAgentActor; requestSource: Source; cursor?: string }): MultiAgentPage<DesktopAgentSnapshot> {
    const state = this.requireActor(input.actor, input.requestSource);
    return this.options.store.listAgents(state.group.id, input.cursor, undefined, undefined, query => this.persistenceIO(state.group, query));
  }

  async close(input: AgentRequest & { target: string }): Promise<MultiAgentControlResult> {
    const state = this.requireActor(input.actor, input.requestSource);
    return state.group.commands.run(() => {
      this.requireActor(input.actor, input.requestSource);
      const target = this.resolveTarget(state, input.target); this.assertDescendant(state, target);
      const existing = this.persistenceIO(state.group, () => this.options.store.getOperation(state.group.id, input.operationId));
      const result = this.mutate(state.group, input, 'close', { target: target.id }, () => ({
        operationId: input.operationId, state: target.resourcesReleased ? 'completed' : 'cleanup_pending', targetAgentId: target.id,
        resourcesReleased: target.resourcesReleased, cleanupPending: !target.resourcesReleased,
      }));
      if (existing || target.resourcesReleased) return result;
      return this.beginClose(state.group, target.id, 'user', input.operationId) ? result : { ...result, state: 'unknown' };
    });
  }

  private beginClose(group: LiveGroup, targetId: string, reason: 'user' | 'ttl' | 'capacity', operationId?: string): boolean {
    const affected = [...group.children.values()].filter(child => child.id === targetId || this.isDescendant(group, child.id, targetId));
    let failed = false;
    for (const child of affected) {
      clearTimeout(child.ttl);
      try { this.cancelFollowups(group, child, new Error('multi_agent_closed')); } catch { failed = true; }
    }
    // Start abort synchronously, but never await cleanup in the group sequencer.
    const close = group.core.closeAgent({ requestSource: 'user', callerId: 'main', target: targetId });
    for (const child of affected) {
      if (child.execution) this.markStopping(group, child, new Error('multi_agent_closed'));
      try {
        const snapshot = group.core.listAgents({ requestSource: 'user', callerId: 'main' }).find(agent => agent.id === child.id)!;
        const agent = this.persistCoreSnapshot(group, snapshot);
        this.options.store.putAgent(group.id, { ...agent, closeReason: reason }, true);
      } catch { failed = true; }
    }
    void close.then(result => group.commands.run(() => {
      for (const core of result.agents) this.persistCoreSnapshot(group, core);
      if (operationId) {
        const operation = this.options.store.getOperation(group.id, operationId);
        const released = affected.every(child => this.requireAgent(group.id, child.id).resourcesReleased);
        if (operation) this.options.store.putOperation({ ...operation, result: { ...operation.result,
          state: released ? 'completed' : 'cleanup_pending', resourcesReleased: released, cleanupPending: !released } }, true);
      }
      this.wake(group);
      this.maybeDormant(group);
    })).catch(() => this.freezeGroup(group, 'multi_agent_cleanup_failed'));
    if (failed) this.freezeGroup(group, 'multi_agent_cancellation_persistence_failed');
    return !failed;
  }

  private requestCapacityReclaim(): boolean {
    const candidates: Array<{ group: LiveGroup; child: LiveChild; idleAt: number }> = [];
    let pending = false;
    for (const group of this.groups.values()) for (const child of group.children.values()) {
      const snapshot = this.requireAgent(group.id, child.id);
      if (snapshot.cleanupPending || snapshot.cleanupError || snapshot.status === 'closed' && !snapshot.resourcesReleased) pending = true;
      if (group.deactivating || group.frozen || child.execution || child.followups.length || snapshot.status === 'closed' || snapshot.cleanupError || snapshot.resourcesReleased) continue;
      const busyDescendant = [...group.children.values()].some(other => this.isDescendant(group, other.id, child.id) && (other.execution || other.followups.length));
      if (!busyDescendant) candidates.push({ group, child, idleAt: snapshot.endedAt ?? snapshot.lastActivityAt ?? snapshot.createdAt });
    }
    const victim = candidates.sort((left, right) => left.idleAt - right.idleAt)[0];
    if (!victim) return pending;
    // Never wait for another group's sequencer or session.dispose under a lock.
    queueMicrotask(() => {
      void victim.group.commands.run(() => {
        const current = this.requireAgent(victim.group.id, victim.child.id);
        if (victim.child.execution || victim.child.followups.length || current.resourcesReleased || current.status === 'closed') return;
        if ([...victim.group.children.values()].some(other => this.isDescendant(victim.group, other.id, victim.child.id) && (other.execution || other.followups.length))) return;
        this.beginClose(victim.group, victim.child.id, 'capacity');
      }).catch(() => this.freezeGroup(victim.group, 'multi_agent_reclaim_failed'));
    });
    return true;
  }

  private maybeDormant(group: LiveGroup): void {
    if (this.disposed) { this.tryShutdownQuiescence(); return; }
    this.tryCompleteReset(this.options.store.requireGroup(group.id).threadId);
    if (this.disposed || group.deactivating || group.frozen || group.root || group.lease && !group.lease.released
      || [...group.children.values()].some(child => child.execution || child.followups.length || !this.requireAgent(group.id, child.id).resourcesReleased)
      || this.options.store.resources(group.id).some(resource => !['released', 'retained_by_policy'].includes(resource.state))) return;
    group.deactivating = true;
    clearTimeout(group.deadlineTimer);
    for (const activity of group.activities.values()) { clearTimeout(activity.publishTimer); clearTimeout(activity.checkpointTimer); }
    for (const child of group.children.values()) { clearTimeout(child.ttl); clearTimeout(child.stopTimer); }
    this.groups.delete(group.id);
    this.dormant.delete(group.id); this.dormant.set(group.id, Date.now());
    while (this.dormant.size > 8) this.dormant.delete(this.dormant.keys().next().value!);
    // All real sessions are already released; suppress this old core's internal
    // root close event so it cannot overwrite the durable completed root row.
    void group.core.dispose().catch(() => { this.runtimeBlockedReason = 'runtime_blocked'; this.options.coordinator.block('runtime_blocked'); });
  }

  private cancelFollowups(group: LiveGroup, child: LiveChild, reason: Error): void {
    const pending = child.followups.splice(0);
    let writeFailed = false;
    for (const item of pending) {
      item.controller.abort(reason); (item.ticket ?? item.request?.ticket)?.release();
      try {
        this.options.store.transaction(() => {
          const operation = this.options.store.getOperation(group.id, item.operationId);
          if (!operation) throw new Error('missing_followup_operation');
          if (operation.result.outcome === 'cancelled' && operation.result.messageId) return;
          let receiver = this.requireAgent(group.id, item.callerId);
          while (receiver.status === 'closed' && receiver.parentId) receiver = this.requireAgent(group.id, receiver.parentId);
          const message = receiver.status !== 'closed' ? this.options.store.sendMessage(group.id, {
            sender: { kind: 'agent', agentId: child.id }, receiverId: receiver.id, kind: 'error',
            text: JSON.stringify({ code: 'followup_cancelled', agentId: child.id, operationId: item.operationId,
              expectedTurn: item.expectedTurn, reason: truncateMultiAgentText(reason.message, 512).text }),
          }, true) : undefined;
          this.options.store.putOperation({ ...operation, result: { ...operation.result, state: 'completed', outcome: 'cancelled', messageId: message?.messageId } }, true);
        });
      } catch {
        writeFailed = true;
        this.markOperationUnknown(group.id, item.operationId);
      }
    }
    if (writeFailed) throw new Error('multi_agent_followup_cancellation_persistence_failed');
  }

  private isDescendant(group: LiveGroup, id: string, ancestor: string): boolean {
    let parentId = this.requireAgent(group.id, id).parentId;
    while (parentId) { if (parentId === ancestor) return true; parentId = this.requireAgent(group.id, parentId).parentId; }
    return false;
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    this.disposal = Promise.resolve().then(() => this.disposeOwned());
    return this.disposal;
  }

  private async disposeOwned(): Promise<void> {
    this.unsubscribeStore(); this.listeners.clear(); this.authorizationListeners.clear();
    this.dormant.clear();
    this.pendingResets.clear();
    this.uncertainOperations.clear();
    for (const group of this.groups.values()) {
      group.lifetime.abort(new Error('app_shutdown')); group.root?.controller.abort(new Error('app_shutdown'));
      if (group.root && !group.root.started) (group.root.ticket ?? group.root.request?.ticket)?.release();
      clearTimeout(group.deadlineTimer);
      clearTimeout(group.root?.stopTimer);
      for (const activity of group.activities.values()) { clearTimeout(activity.publishTimer); clearTimeout(activity.checkpointTimer); }
      for (const [agentId, output] of group.outputs) { clearTimeout(output.timer); try { this.flushOutput(group, agentId); } catch { /* Preserve persisted shutdown history. */ } }
      group.lifetime.abort(new Error('app_shutdown'));
      group.root?.controller.abort(new Error('app_shutdown'));
      if (group.root && !group.root.started) group.root.ticket?.release();
      for (const child of group.children.values()) {
        clearTimeout(child.ttl); clearTimeout(child.stopTimer);
        for (const pending of child.followups) { pending.controller.abort(new Error('app_shutdown')); pending.ticket?.release(); }
      }
    }
    await Promise.all([...this.groups.values()].map(group => group.core.dispose()));
    this.shutdownOwnerChecksReady = true;
    for (const group of this.groups.values()) {
      if ([...group.children.values()].some(child => child.execution)) this.options.coordinator.block('runtime_blocked');
    }
    if (!this.tryShutdownQuiescence()) {
      this.runtimeBlockedReason = 'runtime_blocked'; this.options.coordinator.block('runtime_blocked');
      // A single observer of the real host owner, never a timer or a race
      // receipt. Late child/resource settlement also rechecks this predicate.
      void this.host?.drain().then(() => this.tryShutdownQuiescence()).catch(() => {
        this.runtimeBlockedReason = 'runtime_blocked'; this.options.coordinator.block('runtime_blocked');
      });
    }
  }

  private tryShutdownQuiescence(): boolean {
    if (this.bootQuiesced) return true;
    if (!this.disposed || !this.shutdownOwnerChecksReady || this.options.store.isClosed()) return false;
    const quiesced = this.initialized && this.slots.size === 0 && (!this.options.worktrees || this.options.worktrees.isIdle())
      && !this.host?.inFlightTaskIds().length && !this.pendingHostDeliveries.size
      && !this.recoveryPending.size && !this.authorizationStops.size
      && !this.deletionAttempts.size && !this.pendingDeletionStops.size && !this.goalDecisions.size
      && [...this.resourceCommands.values()].every(owner => owner.users === 0)
      && [...this.groups.values()].every(group => !group.root?.started && !group.root?.preparing && [...group.children.values()].every(child => !child.execution && !child.sessionResident));
    if (quiesced) {
      this.threadCommands.clear(); this.resourceCommands.clear(); this.options.store.settleBootOwnership();
      this.bootQuiesced = true;
      if (this.hostDeliveryAuthority) this.hostDeliveryOwners.get(this.hostDeliveryAuthority)!.active = false;
    }
    return quiesced;
  }

  private liveGroup(groupId: string): LiveGroup {
    const existing = this.groups.get(groupId); if (existing) return existing;
    this.dormant.delete(groupId);
    const durable = this.options.store.requireGroup(groupId);
    if (durable.historicalOnly || durable.bootId !== this.options.store.bootId) throw new Error('historical group is read-only');
    const group = { id: groupId, threadId: durable.threadId, commands: this.resourceCommands.get(groupId)?.commands ?? new MultiAgentCommandSequencer(), children: new Map(), lifetime: new AbortController(), waiters: new Set(), outputs: new Map(), activities: new Map() } as LiveGroup;
    group.core = new MultiAgentCoordinator({ executionMode: 'externally_activated', maxResidentAgents: MAX_RESIDENT_CHILDREN + 1, maxDepth: 3, maxMessageChars: 16 * 1024,
      idleTimeoutMs: 0, turnTimeoutMs: 0,
      closeSettlementTimeoutMs: this.grace, onEvent: event => this.captureCoreEvent(group, event) });
    this.groups.set(groupId, group); return group;
  }

  private createContext(group: LiveGroup, agentId: string, turnId: string, turn: number, memberTicket: ExecutionLease, signal?: AbortSignal,
    provenance?: { sourceTaskId: string | undefined }): DesktopAgentExecutionContext {
    const actor = Object.freeze({ groupId: group.id, agentId, turnId });
    const combined = AbortSignal.any([group.lifetime.signal, group.leaseController!.signal, ...(signal ? [signal] : [])]);
    const context: DesktopAgentExecutionContext = { actor, groupId: group.id, agentId, turnId, turn,
      permissionRevision: this.options.store.requireGroup(group.id).permissionRevision ?? 0,
      // A queued turn's accepted origin is independent of whichever root is now
      // active or prepared. Explicit unknown provenance must remain unknown.
      sourceTaskId: provenance ? provenance.sourceTaskId : group.root?.binding.sourceTaskId ?? this.options.store.getAgent(group.id, agentId)?.sourceTaskId,
      rootEpoch: group.root?.binding.rootEpoch ?? this.options.store.requireGroup(group.id).currentRootEpoch,
      memberTicket, signal: combined, effectiveDeadline: memberTicket.deadlineAt ?? Number.POSITIVE_INFINITY,
      cwd: group.children.get(agentId)?.cwd ?? this.options.store.getThread(this.options.store.requireGroup(group.id).threadId)!.cwd,
      mailbox: undefined as unknown as DesktopMailboxPort,
    };
    Object.defineProperty(context, 'permissionRevision', { writable: false, configurable: false });
    const state: ActorState = { context, group, active: true, sealed: false };
    this.actors.set(actor, state);
    context.mailbox = new DesktopMultiAgentTurnMailbox({ store: this.options.store, groupId: group.id, agentId, turnId, commands: group.commands,
      beforeSeal: () => { this.flushOutput(group, agentId); this.finishActivity(group, agentId); },
      assertCurrent: () => {
        const current = agentId === `root_${group.id}` ? group.root?.context : group.children.get(agentId)?.context;
        if (current !== context || this.disposed) throw new Error('stale multi-agent authority');
      },
      onSeal: outcome => {
        const old = this.requireAgent(group.id, agentId);
        // Cancellation/close may win after the last signal check but before this
        // queued seal. Never let a late pure-text response undo that decision.
        const resultStatus = TERMINAL.has(old.status) ? old.status : context.signal.aborted && outcome === 'completed' ? 'interrupted' : outcome;
        const agent = this.options.store.putAgent(group.id, { ...old, status: resultStatus, endedAt: Date.now(),
          ...(old.toolsCompleted !== undefined ? { toolStatisticsComplete: resultStatus === 'completed' && !group.frozen && !context.signal.aborted } : {}) }, true);
        this.options.store.appendEvent(group.id, { kind: 'status', agentId, turnId, payload: { agent } });
        if (group.root?.context === context) {
          const binding = this.options.store.getRootBinding(group.root.binding.sourceTaskId) ?? group.root.binding;
          group.root.binding = { ...binding, phase: binding.phase === 'abandoned' ? 'abandoned' : 'settled', status: resultStatus };
          this.options.store.putRootBinding(group.root.binding, true);
        }
        state.sealed = true;
        state.outcome = resultStatus;
        this.wake(group);
      },
    });
    return context;
  }

  private installLease(group: LiveGroup, ticket: ExecutionLease): void {
    if (group.lease?.epoch === ticket.epoch) return;
    group.lease = ticket; group.leaseController = new AbortController();
    clearTimeout(group.deadlineTimer);
    if (ticket.deadlineAt === undefined) return;
    const arm = () => {
      if (group.lease !== ticket || ticket.released) return;
      group.deadlineTimer = setTimeout(() => {
        if (Date.now() < ticket.deadlineAt!) { arm(); return; }
        void this.expireLease({ requestSource: 'scheduler', groupId: group.id, leaseEpoch: ticket.epoch })
          .catch(() => this.freezeGroup(group, 'multi_agent_lease_expiry_failed'));
      }, Math.min(2 ** 31 - 1, Math.max(1, ticket.deadlineAt! - Date.now())));
      group.deadlineTimer.unref?.();
    };
    arm();
  }

  /** Main timer command. Never translates expiry into cancellation of an old root. */
  async expireLease(input: { requestSource: Source; groupId: string; leaseEpoch: number }): Promise<void> {
    if (input.requestSource !== 'scheduler') throw new Error('lease expiry source is not permitted');
    const group = this.groups.get(input.groupId); if (!group || this.disposed) return;
    const sourceTaskId = await group.commands.run(() => {
      const lease = group.lease;
      if (!lease || lease.epoch !== input.leaseEpoch || lease.released || lease.deadlineAt === undefined || Date.now() < lease.deadlineAt) return;
      const reason = new Error('multi_agent_lease_expired'); let failed = false;
      const root = group.root;
      const activeRoot = root?.context && root.context.memberTicket.epoch === lease.epoch && !this.actors.get(root.context.actor)?.sealed ? root : undefined;
      if (activeRoot) {
        try {
          this.options.store.transaction(() => {
            const binding = this.options.store.getRootBinding(activeRoot.binding.sourceTaskId)!;
            this.options.store.putRootBinding({ ...binding, phase: 'abandoned', status: 'interrupted' }, true);
            const before = this.requireAgent(group.id, `root_${group.id}`);
            const agent = this.options.store.putAgent(group.id, { ...before, status: 'interrupted', stopState: 'requested' }, true);
            this.options.store.appendEvent(group.id, { kind: 'status', agentId: agent.id, turnId: agent.turnId, payload: { agent } });
          });
        } catch { failed = true; }
        activeRoot.controller.abort(reason); this.markRootStopping(group, activeRoot);
      }
      group.leaseController?.abort(reason);
      for (const child of group.children.values()) {
        try { this.cancelFollowups(group, child, reason); } catch { failed = true; }
        if (child.execution && child.context.memberTicket.epoch === lease.epoch) this.markStopping(group, child, reason);
      }
      if (activeRoot) activeRoot.leaseExpiryDecision = { hostAbortAllowed: true, ack: failed ? 'unknown' : 'applied' };
      if (failed) this.freezeGroup(group, 'multi_agent_lease_expiry_persistence_failed');
      this.wake(group);
      return activeRoot?.binding.sourceTaskId;
    });
    // Disk-backed host mutations must not hold the group's synchronous sequencer.
    if (sourceTaskId) await this.host?.cancelTask(sourceTaskId, 'multi_agent_lease_expired');
  }

  private observeSettlement(group: LiveGroup, child: LiveChild): void {
    const execution = child.execution!;
    void execution.settled.then(() => group.commands.run(() => {
      if (child.execution !== execution) return;
      child.execution = undefined;
      clearTimeout(child.stopTimer);
      this.actors.get(child.context.actor)!.active = false;
      child.context.memberTicket.release(); this.clearReleasedLease(group);
      if (!this.disposed && !group.deactivating) {
        const snapshot = group.core.listAgents({ requestSource: 'user', callerId: 'main' }).find(agent => agent.id === child.id)!;
        this.persistCoreSnapshot(group, snapshot);
        if (child.followups.length && !snapshot.cleanupError && snapshot.status !== 'closed') this.enqueueNextFollowup(group, child);
        else if (!snapshot.resourcesReleased) {
          child.ttl = setTimeout(() => { void this.closeIdleChild(group, child); }, 15 * 60_000);
          child.ttl.unref?.();
        }
      }
      this.wake(group);
      this.maybeDormant(group);
    })).catch(() => this.freezeGroup(group, 'multi_agent_persistence_failed'));
  }

  private async closeIdleChild(group: LiveGroup, child: LiveChild): Promise<void> {
    await group.commands.run(() => {
      if (child.execution || child.followups.length || this.disposed) return;
      this.beginClose(group, child.id, 'ttl');
    }).catch(() => this.freezeGroup(group, 'multi_agent_cleanup_failed'));
  }

  private enqueueNextFollowup(group: LiveGroup, child: LiveChild): void {
    const pending = child.followups[0];
    if (!pending || pending.request || child.execution || this.disposed || group.frozen) return;
    const signal = AbortSignal.any([pending.controller.signal, group.lifetime.signal]);
    pending.request = pending.forceNewEpoch || pending.acceptedEpoch !== undefined && pending.acceptedEpoch !== group.lease?.epoch
      ? this.options.coordinator.enqueueGroupTurn(group.id, signal, pending.lane)
      : group.lease && !group.lease.released
        ? this.options.coordinator.joinOrEnqueue(group.id, group.lease.epoch, 'agent_work', signal)
        : this.options.coordinator.acquireLease({ groupId: group.id, policy: 'multiAgent', signal, lane: pending.lane });
    pending.ticket = pending.request.ticket;
    void pending.request.then(ticket => {
      pending.ticket = ticket;
      return group.commands.run(() => {
        // A grant may be delivered after cancellation already won this queue.
        // Its cancelled receipt is authoritative; this is not a storage failure.
        if (pending.controller.signal.aborted || child.followups[0] !== pending) { ticket.release(); return; }
        let prepared: PreparedAgentHandle | undefined;
        let activated = false;
        try {
          this.assertWritable(group, 'multi_agent_followup_admission_failed');
          if (pending.controller.signal.aborted || child.followups[0] !== pending || child.execution) throw new Error('stale followup admission');
          this.installLease(group, ticket);
          prepared = group.core.prepareFollowup({ requestSource: pending.requestSource, callerId: this.coreId(group, pending.callerId), target: child.id, message: pending.message });
          if (prepared.expectedTurn !== pending.expectedTurn) throw new Error('followup turn mismatch');
          child.controller = new AbortController();
          child.context = this.createContext(group, child.id, randomUUID(), prepared.expectedTurn, ticket, child.controller.signal,
            { sourceTaskId: pending.sourceTaskId });
          child.prepared = prepared; child.stopRequested = false;
          this.options.store.transaction(() => {
            this.persistCoreSnapshot(group, prepared!.snapshot);
            const operation = this.options.store.getOperation(group.id, pending.operationId)!;
            this.options.store.putOperation({ ...operation, result: { ...operation.result, state: 'applied' } });
          });
          child.followups.shift();
          child.execution = group.core.activatePreparedTurn(prepared, { signal: child.context.signal });
          activated = true;
          this.observeSettlement(group, child);
        } catch (error) {
          if (prepared && !activated) group.core.rollbackPrepared(prepared);
          if (!activated) ticket.release();
          this.freezeGroup(group, 'multi_agent_followup_admission_failed');
          throw error;
        }
      });
    }).catch(() => {
      pending.ticket?.release();
      this.wake(group);
    });
  }

  private captureCoreEvent(group: LiveGroup, event: MultiAgentEvent): void {
    if (this.disposed || group.deactivating || event.kind !== 'status' && event.kind !== 'activity') return;
    const captured = structuredClone(event);
    void group.commands.run(() => {
      if (this.disposed || group.deactivating) return;
      const activeChild = group.children.get(captured.agent.id);
      if (activeChild && activeChild.context.turn !== captured.agent.turn) return;
      if (captured.kind === 'activity') {
        const child = group.children.get(captured.agent.id);
        if (child && child.context.turn === captured.agent.turn) this.applyActivity(group, child.id, child.context.turnId,
          { phase: captured.agent.phase ?? 'model', toolName: captured.agent.currentTool }, captured.agent.lastActivityAt ?? captured.timestamp);
        return;
      }
      if (TERMINAL.has(captured.agent.status)) this.finishActivity(group, captured.agent.id);
      this.options.store.transaction(() => {
        const agent = this.persistCoreSnapshot(group, captured.agent);
        if (agent.status === 'closed') this.options.store.rerouteClosedHandoffs(group.id, agent.id);
        const child = group.children.get(agent.id);
        const operationId = child ? `child_result:${createHash('sha256').update(`${child.id}:${child.context.turnId}`).digest('hex')}` : '';
        if (child && agent.turn > 0 && TERMINAL.has(agent.status) && !this.options.store.getOperation(group.id, operationId)) {
          const full = agent.status === 'completed' ? child.fullResult ?? captured.agent.lastResult ?? '' : captured.agent.error ?? `agent_${agent.status}`;
          const content = this.options.store.putContent(group.id, child.id, full, true);
          const preview = truncateMultiAgentText(content.utf8Text, 8 * 1024);
          this.options.store.putAgent(group.id, { ...agent, resultContentId: content.contentId }, true);
          this.options.store.appendEvent(group.id, { kind: 'result', agentId: child.id, turnId: child.context.turnId,
            payload: { contentId: content.contentId, preview: preview.text, truncated: preview.truncated || content.truncated } });
          let parent = this.requireAgent(group.id, child.parentId);
          while (parent.status === 'closed' && parent.parentId) parent = this.requireAgent(group.id, parent.parentId);
          if (parent.status !== 'closed') this.options.store.sendMessage(group.id, {
            sender: { kind: 'agent', agentId: child.id }, receiverId: parent.id, kind: agent.status === 'completed' ? 'result' : 'error',
            text: preview.text || '(empty result)', contentId: content.contentId, truncated: preview.truncated || content.truncated,
          }, true);
          this.options.store.putOperation({ groupId: group.id, operationId, command: 'child_result',
            requestHash: this.requestHash(operationId, { agentId: child.id, turnId: child.context.turnId }), applyState: 'applied',
            result: { state: 'completed', status: agent.status, contentId: content.contentId } }, true);
        }
      });
      const child = group.children.get(captured.agent.id);
      if (child && TERMINAL.has(captured.agent.status)) child.fullResult = undefined;
      if (child && child.execution && captured.agent.executionActive && ['failed', 'interrupted', 'closed'].includes(captured.agent.status)) {
        try { this.cancelFollowups(group, child, new Error(captured.agent.error ?? 'multi_agent_stopped')); }
        finally { this.markStopping(group, child, new Error(captured.agent.error ?? 'multi_agent_stopped')); }
      }
      this.wake(group);
      this.maybeDormant(group);
    }).catch(() => this.freezeGroup(group, 'multi_agent_persistence_failed'));
  }

  private persistCoreSnapshot(group: LiveGroup, core: MultiAgentSnapshot): DesktopAgentSnapshot {
    const child = group.children.get(core.id);
    const id = core.id === 'main' ? `root_${group.id}` : core.id;
    const previous = this.options.store.getAgent(group.id, id);
    if (previous && core.turn < previous.turn) return previous;
    const sameTurn = previous?.turn === core.turn;
    const diskPending = this.pendingResources(group.id, id);
    const agent = this.options.store.putAgent(group.id, {
      ...previous, ...core, id, parentId: core.parentId === 'main' ? `root_${group.id}` : core.parentId,
      ...(!sameTurn ? { taskSummary: undefined, resultSummary: undefined, toolsCompleted: undefined, toolsFailed: undefined,
        toolCounts: undefined, otherToolCount: undefined, toolStatisticsComplete: undefined, resultContentId: undefined } : {}),
      turnId: child?.context.turnId ?? group.root?.context?.turnId,
      sourceTaskId: child ? child.context.sourceTaskId : group.root?.binding.sourceTaskId ?? previous?.sourceTaskId,
      lastResult: core.lastResult ? truncateMultiAgentText(core.lastResult, 1024).text : sameTurn ? previous?.lastResult : undefined,
      resultSummary: core.lastResult ? desktopSubAgentSummary(core.lastResult) : sameTurn ? previous?.resultSummary : undefined,
      error: core.error ? truncateMultiAgentText(core.error, 1024).text : undefined,
      resourcesReleased: core.resourcesReleased && diskPending.length === 0,
      cleanupError: core.cleanupError ? truncateMultiAgentText(core.cleanupError, 512).text : core.resourcesReleased ? diskPending[0]?.lastError : undefined,
      // Initializing turns accept queued followups before session residency;
      // terminal turns require an actually retained session, never cleanup alone.
      sessionResident: child?.sessionResident ?? false, resumable: Boolean(child
        && (child.sessionResident || core.status === 'pending' || core.status === 'running') && !(child.stopRequested && child.execution)
        && !core.resourcesReleased && !core.cleanupError && core.status !== 'closed'
        && !(core.executionActive && (core.status === 'failed' || core.status === 'interrupted'))),
      cleanupPending: Boolean((core.status === 'closed' || previous?.stopState === 'stalled' || child?.stopRequested && core.executionActive) && !core.resourcesReleased || core.resourcesReleased && diskPending.length),
      stopState: previous?.stopState === 'stalled' && core.executionActive ? 'stalled' : child?.stopRequested && core.executionActive ? 'requested' : 'none',
      activationState: core.executionActive ? 'active' : core.preparedReservation ? 'prepared' : 'settled',
    }, true);
    this.options.store.appendEvent(group.id, { kind: 'status', agentId: id, payload: { agent } });
    if (core.resourcesReleased) this.slots.delete(id);
    return agent;
  }

  private pendingResources(groupId: string, agentId: string) {
    return this.options.store.resources(groupId).filter(resource => resource.agentId === agentId && !['released', 'retained_by_policy'].includes(resource.state));
  }

  private refreshResourceProjection(groupId: string, agentId: string): void {
    const previous = this.requireAgent(groupId, agentId);
    const resources = this.pendingResources(groupId, agentId);
    const executionReleased = !previous.executionActive && !previous.sessionResident && !previous.runtimeResident
      && previous.activationState === 'settled';
    const agent = this.options.store.putAgent(groupId, { ...previous,
      resourcesReleased: executionReleased && !resources.length,
      cleanupPending: !executionReleased || Boolean(resources.length),
      cleanupError: executionReleased ? resources[0]?.lastError : previous.cleanupError,
    }, true);
    this.options.store.appendEvent(groupId, { kind: 'cleanup', agentId, payload: { agent } });
    for (const operation of this.options.store.pendingCloseOperations(groupId)) {
      const target = String(operation.result.targetAgentId ?? '');
      const agents = this.options.store.allAgents(groupId);
      const descendants = new Set([target]);
      for (let changed = true; changed;) { changed = false; for (const item of agents) if (item.parentId && descendants.has(item.parentId) && !descendants.has(item.id)) { descendants.add(item.id); changed = true; } }
      if (agents.some(item => descendants.has(item.id)) && agents.filter(item => descendants.has(item.id)).every(item => item.resourcesReleased)) {
        this.options.store.putOperation({ ...operation, result: { ...operation.result, state: 'completed', resourcesReleased: true, cleanupPending: false } }, true);
      }
    }
  }

  private mutate(group: LiveGroup, input: { actor: unknown; operationId: string }, command: string, payload: unknown, action: () => MultiAgentControlResult): MultiAgentControlResult {
    const requestHash = this.requestHash(input.operationId, { command, actor: input.actor, payload });
    const existing = this.persistenceIO(group, () => this.options.store.getOperation(group.id, input.operationId));
    if (existing) {
      if (existing.requestHash !== requestHash) throw new Error('operation_id_conflict');
      return existing.result as unknown as MultiAgentControlResult;
    }
    try {
      const result = this.options.store.transaction(() => {
        const result = action();
        this.options.store.putOperation({ groupId: group.id, operationId: input.operationId, command, requestHash, applyState: 'applied', result: { ...result } }, command === 'interrupt');
        return result;
      });
      this.wake(group); return result;
    } catch (error) { this.freezeGroup(group, 'multi_agent_persistence_failed'); throw error; }
  }

  private requireActor(actor: DesktopAgentActor, source: Source, context?: DesktopAgentExecutionContext): ActorState {
    if (source !== 'agent') throw new Error('request source is not permitted for agent authority');
    const state = this.actors.get(actor);
    if (!state || !state.active || state.sealed || state.context.signal.aborted) throw new Error('stale or invalid multi-agent authority');
    if (context && context !== state.context) throw new Error('invalid runtime context');
    this.assertExecutionAuthorization(state.context.permissionRevision);
    this.assertWritable(state.group); return state;
  }
  private resolveTarget(state: ActorState, target: string): DesktopAgentSnapshot {
    if (target === 'main') return this.requireOwnedAgent(state.group, `root_${state.group.id}`);
    if (target === 'parent') {
      const parent = this.requireOwnedAgent(state.group, state.context.agentId).parentId;
      if (!parent) throw new Error('root has no parent');
      return this.requireOwnedAgent(state.group, parent);
    }
    const direct = this.persistenceIO(state.group, () => this.options.store.getAgent(state.group.id, target));
    if (direct) return direct;
    const found = state.group.core.listAgents({ requestSource: 'user', callerId: 'main' }).find(agent => agent.canonicalName === target);
    if (!found) throw new Error('unknown agent or group mismatch');
    return this.requireOwnedAgent(state.group, found.id === 'main' ? `root_${state.group.id}` : found.id);
  }
  private assertDescendant(state: ActorState, target: DesktopAgentSnapshot): void {
    if (!target.parentId || target.id === state.context.agentId) throw new Error('root or self control is not permitted');
    let parentId: string | null = target.parentId;
    while (parentId) {
      if (parentId === state.context.agentId) return;
      parentId = this.requireOwnedAgent(state.group, parentId).parentId;
    }
    throw new Error('non-descendant control is not permitted');
  }
  private requireAgent(groupId: string, id: string): DesktopAgentSnapshot {
    const agent = this.options.store.getAgent(groupId, id); if (!agent) throw new Error('unknown agent or group mismatch'); return agent;
  }
  private requireOwnedAgent(group: LiveGroup, id: string): DesktopAgentSnapshot {
    return this.persistenceIO(group, () => this.requireAgent(group.id, id));
  }
  /** Only trusted owners enter this synchronous, actual-IO boundary. */
  private persistenceIO<T>(group: LiveGroup, action: () => T, reason = 'multi_agent_persistence_failed'): T {
    try { return action(); }
    catch (error) { group.persistenceFailed = true; this.freezeGroup(group, reason); throw error; }
  }
  private requestHash(operationId: string, input: unknown): string {
    if (typeof operationId !== 'string' || !operationId || operationId.length > 128) throw new Error('invalid operationId');
    return createHash('sha256').update(encodeMultiAgentRow(input)).digest('hex');
  }
  private validateText(text: string): void {
    if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 16 * 1024) throw new Error('invalid message or 16KiB limit');
  }
  private assertReady(): void {
    if (!this.initialized || this.disposed) throw new Error('multi_agent_runtime_not_ready');
    if (this.runtimeBlockedReason) throw new Error(this.runtimeBlockedReason);
  }
  private assertWritable(group: LiveGroup, reason = 'multi_agent_persistence_failed'): void {
    this.assertReady();
    if (this.goalDecisions.has(group.id)) throw new Error('goal_decision_pending');
    const durable = this.persistenceIO(group, () => this.options.store.requireGroup(group.id), reason);
    const thread = this.persistenceIO(group, () => {
      const binding = this.options.store.getThread(durable.threadId);
      if (!binding) throw new Error('unknown multi-agent thread binding');
      return binding;
    }, reason);
    this.assertExecutionDomain(thread);
    this.assertExecutionAuthorization(durable.permissionRevision ?? 0);
    this.assertThreadNotDeleted(thread);
    if (this.pendingResets.has(durable.threadId)) throw new Error('group_reset_pending');
    if (group.frozen || durable.mutationBlockedReason || durable.historicalOnly) throw new Error(group.frozen ?? durable.mutationBlockedReason ?? 'historical group is read-only');
  }
  private freezeGroup(group: LiveGroup, reason: string): void {
    if (group.frozen || this.disposed) return;
    group.frozen = reason;
    try { this.options.store.putGroup({ ...this.options.store.requireGroup(group.id), mutationBlockedReason: reason }, true); } catch { /* No false durable ACK. */ }
    group.lifetime.abort(new Error(reason)); group.root?.controller.abort(new Error(reason));
    if (group.root?.context) this.markRootStopping(group, group.root);
    for (const child of group.children.values()) {
      try { this.cancelFollowups(group, child, new Error(reason)); } catch { /* Physical stop still proceeds. */ }
      if (child.execution) this.markStopping(group, child, new Error(reason));
    }
    this.wake(group);
  }

  private markStopping(group: LiveGroup, child: LiveChild, reason: Error): void {
    child.stopRequested = true;
    child.controller.abort(reason);
    const actor = this.actors.get(child.context.actor); if (actor) actor.active = false;
    const execution = child.execution;
    if (!execution || child.stopTimer) return;
    child.stopTimer = setTimeout(() => {
      if (child.execution !== execution || this.disposed) return;
      void group.commands.run(() => {
        if (child.execution !== execution || this.disposed) return;
        this.blockRuntime(group, child.id);
      }).catch(() => { this.runtimeBlockedReason = 'runtime_blocked'; this.options.coordinator.block('runtime_blocked'); });
    }, this.grace);
    child.stopTimer.unref?.();
  }
  private markRootStopping(group: LiveGroup, root: RootPreparation): void {
    if (!root.context || root.stopTimer || this.actors.get(root.context.actor)?.sealed) return;
    root.stopTimer = setTimeout(() => {
      void group.commands.run(() => {
        if (group.root !== root || this.disposed || !root.context) return;
        this.blockRuntime(group, root.context.agentId);
      }).catch(() => { this.runtimeBlockedReason = 'runtime_blocked'; this.options.coordinator.block('runtime_blocked'); });
    }, this.grace);
    root.stopTimer.unref?.();
  }
  private blockRuntime(group: LiveGroup, agentId: string): void {
    this.runtimeBlockedReason = 'runtime_blocked'; this.options.coordinator.block('runtime_blocked');
    for (const current of this.groups.values()) {
      current.lifetime.abort(new Error('runtime_blocked'));
      for (const live of current.children.values()) {
        try { this.cancelFollowups(current, live, new Error('runtime_blocked')); } catch { /* Fail closed even when the audit reserve is full. */ }
        if (!live.execution) continue;
        live.controller.abort(new Error('runtime_blocked'));
        const state = this.actors.get(live.context.actor); if (state) state.active = false;
      }
      this.wake(current);
      this.publish({ channel: 'runtime_error', groupId: current.id, code: 'runtime_blocked' });
    }
    const agent = this.requireAgent(group.id, agentId);
    try {
      const stalled = this.options.store.putAgent(group.id, { ...agent, stopState: 'stalled', cleanupPending: true }, true);
      this.options.store.appendEvent(group.id, { kind: 'cleanup', agentId, payload: { agent: stalled } });
    } catch { /* Physical blocking remains in force even with a full database. */ }
  }
  private clearReleasedLease(group: LiveGroup): void {
    if (group.lease?.released) { clearTimeout(group.deadlineTimer); group.lease = undefined; group.leaseController = undefined; }
    this.maybeDormant(group);
  }
  private wake(group: LiveGroup): void {
    for (const wake of [...group.waiters]) wake();
    this.tryCompleteReset(this.options.store.requireGroup(group.id).threadId);
  }
  private coreId(group: LiveGroup, id: string): string { return id === `root_${group.id}` ? 'main' : id; }
  private marker(binding: MultiAgentRootBinding): TaskMultiAgentPreparation {
    const { groupId, rootEpoch, rootTurnId, preparationId, bootId } = binding; return { groupId, rootEpoch, rootTurnId, preparationId, bootId };
  }
}
