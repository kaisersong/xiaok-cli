import { createDesktopModelPhysicalScope, closeDesktopModelPhysicalScope, type DesktopModelPhysicalScope } from './desktop-task-stream.js';
import type {ManagedCompoundFollowupFacts,PreparedManagedCompoundFollowup} from '../../src/runtime/sol-pi/compound-managed-followup.js';
import {getCompoundFinalPublicationBinding,openCompoundFollowupPublicationWindow,type CompoundFinalPublicationTicket} from '../../src/runtime/sol-pi/compound-publication-producer.js';
import {computeSessionHistoryDigest} from '../../src/ai/runtime/session-store/store.js';
import {AsyncLocalStorage} from 'node:async_hooks';
import {getManagedCompoundAdmissionBinding,type ManagedCompoundAdmission} from '../../src/runtime/sol-pi/compound-managed-admission.js';
import { agentDisplayNames } from '../shared/subagent-presentation.js';
import { assertDelegatedObservationOwner } from '../../src/runtime/sol-pi/delegated-session-owner.js';
import { getObservationMessagePublicationBinding, withPublishedObservationMessages, type ObservationMessagePublication } from '../../src/runtime/sol-pi/observation-message-publication.js';
import type { ToolRegistry } from '../../src/ai/tools/index.js';
import { capturePublishedClosureRead,restorePublishedClosureRead,getPublishedClosureReadBinding,type PublishedClosureReadFacts,type PublishedClosureReadAnchor,getObservationSessionOwnerHostBinding, getObservationClosedReadAnchor, type ObservationClosedReadAnchor, type ObservationSessionOwner } from '../../src/runtime/sol-pi/observation-session-owner.js';
import { desktopObservationSessionId, DesktopTaskObservationStore } from '../../src/runtime/task-host/protected-observation-store.js';
import { mergeProtectedObservationClosures, type ProtectedObservationClosure } from '../../src/ai/runtime/protected-observation-closure.js';
import type { GroupObservationReferenceTicket } from '../../src/runtime/task-host/task-runtime-host.js';
import { createHash, randomUUID } from 'node:crypto';
import { reportDiagnosticSafely } from './diagnostic-isolation.js';
import { isDeepStrictEqual } from 'node:util';
import { MultiAgentCoordinator, type AgentExecutionHandle, type AgentIdentity, type ManagedAgentSession, type MultiAgentEvent, type MultiAgentSnapshot, type PreparedAgentHandle } from '../../src/ai/agents/multi-agent-coordinator.js';
import type { InProcessTaskRuntimeHost, TaskIdentityReservation, TaskCancellationDecision, TaskRunnerInput } from '../../src/runtime/task-host/task-runtime-host.js';
import type { GoalTurnExecutionScope, TaskCreateInput, TaskMultiAgentPreparation, TaskSnapshot } from '../../src/runtime/task-host/types.js';
import type { MultiAgentMessage,DesktopAgentSnapshot, DesktopMultiAgentGroup, DesktopMailboxPort, MultiAgentControlResult, MultiAgentRootBinding, MultiAgentPage, MultiAgentGroupSnapshot, MultiAgentEnvelope, MultiAgentThreadDeletionSnapshot } from '../shared/multi-agent-types.js';
import { DesktopExecutionCoordinator, currentExecutionLane, type ExecutionLane, type ExecutionLease, type ExecutionLeaseRequest } from './desktop-execution-coordinator.js';
import { DesktopMultiAgentStore, type DesktopMultiAgentMutationPort, encodeMultiAgentRow, truncateMultiAgentText, type MultiAgentThreadBinding } from './desktop-multi-agent-store.js';
import { DesktopMultiAgentTurnMailbox, MultiAgentCommandSequencer, bindDesktopMailboxSemanticAlias } from './desktop-multi-agent-mailbox.js';
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
interface ManagedReleaseOwner {parentSession:import('../../src/ai/runtime/session.js').AgentSessionState;physical?:{core:MultiAgentCoordinator;witness:object};childSessionId:string;nativeInvocationId:string;admission:ManagedCompoundAdmission;group:LiveGroup;child:LiveChild;sourceOwner:ObservationSessionOwner;permissionRevision:number;ackBytes:string;requestHash:string;notify:(receipt:object)=>Promise<void>;receipt?:object;pending?:Promise<void>;delivered:boolean}
interface PendingAuthorization {
  request: ExecutionAuthorizationRetry; requestHash: string; actorId: string;
  originalAllowed: boolean; candidate: number;
}
/** Main factory only. The opaque identity, not this diagnostic id, authorizes reports. */
export interface DesktopHostDeliveryAuthority { readonly ownerId: string }
interface HostDeliveryOwner { host: InProcessTaskRuntimeHost; bootId: string; active: boolean }
interface GoalContinuationDecision {
  host: InProcessTaskRuntimeHost; binding: MultiAgentRootBinding;
  originalInput: TaskCreateInput; input: TaskCreateInput; sourceScope: GoalTurnExecutionScope;
  permissionRevision: number; live: boolean; taskId?: string;
}
interface DeliveryRecoveryOwner {
  host: InProcessTaskRuntimeHost; source: HostDeliverySource; phase: 'host' | 'consumers';
  expectedDeliveryRevision: number; delivery?: HostDeliveryRecord; receipt?: Omit<HostDeliveryRecoveryReceipt, 'authority'>;
}
interface UserAccessState { actorId: string; threadId: string; profileId: string; workspaceId: string; active: boolean; historicalDomain?: boolean }
export interface DesktopMultiAgentUserControl {
  access: DesktopMultiAgentUserAccess; requestSource: Source; groupId: string; agentId: string; operationId: string; expectedTurn: number;
}
export interface DesktopAgentExecutionContext {
  readonly activityRunId?: string;
  readonly activityMemberId?: string;
  actor: DesktopAgentActor; groupId: string; agentId: string; turnId: string; turn: number;
  rootEpoch: number; cwd: string; effectiveDeadline: number; signal: AbortSignal;
  readonly permissionRevision: number;
  memberTicket: ExecutionLease; mailbox: DesktopMailboxPort;
  sourceTaskId?: string;
}
export interface DesktopObservationChildPreparation { readonly opaqueDesktopObservationChildPreparation: never }
export interface DesktopPreparedObservationSession {
 session: ManagedAgentSession; owner: ObservationSessionOwner; registry: ToolRegistry; publication: ObservationMessagePublication; observationStore: DesktopTaskObservationStore;
 releasePreparation?():void;
}
/** Main-only observation DATA: no actor, lease, ticket, error body, or callable capability. */
export interface ThreadDeletionDiagnostic {
  readonly reason: 'same_operation_replay' | 'another_attempt_in_progress' | 'admitted_existing_receipt_return' | 'before_thread_stop_started' | 'before_thread_stop_confirmed' | 'before_thread_stop_failed' | 'scan_already_pending' | 'scan_deadline_elapsed' | 'scan_facts_ready' | 'stop_deadline_elapsed' | 'goal_stop_failed' | 'unknown_task_attribution' | 'goal_stop_not_confirmed' | 'new_uninspected_inflight' | 'target_task_still_inflight' | 'task_stop_failed' | 'prepared_task_stop_not_confirmed' | 'live_group_resources' | 'resource_commands_in_use' | 'persisted_agent_or_disk_resources' | 'observation_group_resources' | 'before_commit' | 'before_commit_returned' | 'history_deleted' | 'observation_commit_returned' | 'committed' | 'caught_error' | 'disposed_unknown' | 'receipt_update_failed_unknown' | 'return_receipt';
  readonly threadHash: string;
  readonly operationHash: string;
  readonly facts?: Readonly<{
    goalConfirmed?: boolean; goalFailed?: boolean; initialInFlight?: number; inspected?: number; targetTasks?: number;
    roots?: number; leases?: number; goalDecisions?: number; childExecutions?: number; followups?: number; residentSessions?: number;
    receiptState?: MultiAgentControlResult['state'];
  }>;
}

export interface DesktopMultiAgentServiceOptions {
  store: DesktopMultiAgentStore;
  coordinator: DesktopExecutionCoordinator;
  worktrees?: DesktopMultiAgentWorktrees;
  /** One immutable main-owned execution domain; never renderer supplied. */
  executionDomain?: { profileId: string; workspaceId: string; cwd: string; actorId: string };
  /** Main-only restoration of an already-persisted, independently authorized launch workspace. */
  authorizeHistoricalThreadDomain?(thread: MultiAgentThreadBinding): boolean;
  onExecutionAuthorizationChanged?(snapshot: ExecutionAuthorizationSnapshot): void;
  stopForWorkspaceExecutionRevocation?(): Promise<void>;
  createSession(input: {
    groupId: string; identity: AgentIdentity; parent: DesktopAgentExecutionContext; signal: AbortSignal;
    getTurnContext(): DesktopAgentExecutionContext;
    bindWorkingDirectory?(cwd: string): void;
    sessionSeed?: DesktopAgentSessionSeed;
  }): Promise<ManagedAgentSession>;
  prepareObservationSession?(input: {
    preparation: DesktopObservationChildPreparation; identity: AgentIdentity; parent: DesktopAgentExecutionContext;
    context: DesktopAgentExecutionContext; message: string; operationId: string; signal: AbortSignal;
    sessionSeed?: DesktopAgentSessionSeed;
  }): Promise<DesktopPreparedObservationSession>;
  prepareObservationFollowup?(preparation:object):Promise<PreparedManagedCompoundFollowup>;
  prepareObservationMessage?(input: { context: DesktopAgentExecutionContext; sourceOwner: ObservationSessionOwner; recipientOwner: ObservationSessionOwner; operationId: string; text: string; assertCurrent(): void }): Promise<ObservationMessagePublication>;
  closeGraceMs?: number;
  /** Optional main-only diagnostics; return/throw never governs deletion. */
  onThreadDeletionDiagnostic?(fact: ThreadDeletionDiagnostic): void;
  /** Main Goal owner cancellation. Never an agent tool or renderer callback. */
  beforeThreadDeletion?(threadId: string): Promise<void>;
  /** Synchronous journal prepared after physical cleanup; returned callback follows durable thread deletion. */
  beforeThreadDeletionCommit?(threadId:string,operationId:string):()=>void;
  /** Main Goal and host history lookup, including terminal legacy records. */
  hasUnboundHistory?(threadId: string): Promise<boolean>;
  /** Fixed main adapter; rejection keeps startup unavailable, never warn-and-swallow. */
  onRecoveredHostTerminal?(input: HostDeliveryRecoveryReceipt): Promise<void>;
}
type Source = 'user' | 'agent' | 'scheduler';
export type DesktopGoalChildReadiness = 'ready' | 'waiting_children' | 'children_need_attention';
interface AgentRequest { actor: DesktopAgentActor; requestSource: Source; operationId: string }
interface ActorState { context: DesktopAgentExecutionContext; group: LiveGroup; active: boolean; sealed: boolean; preparing?: boolean; outcome?: DesktopAgentSnapshot['status'] }
interface LiveChild {
  id: string; parentId: string; context: DesktopAgentExecutionContext; prepared: PreparedAgentHandle;
  execution?: AgentExecutionHandle; sessionResident: boolean; fullResult?: string;
  semanticBoundaryTurnId?: string;
  stopRequested: boolean; ttl?: ReturnType<typeof setTimeout>;
  controller: AbortController;
  stopTimer?: ReturnType<typeof setTimeout>;
  followups: PendingFollowup[];
  cwd?: string;
}
interface ManagedFinalPublication {
 ticket:CompoundFinalPublicationTicket;facts:ReturnType<typeof getCompoundFinalPublicationBinding>;
 group:LiveGroup;child:LiveChild;context:DesktopAgentExecutionContext;execution:AgentExecutionHandle;
 notify(receipt:unknown):Promise<void>;settled:boolean;
 publication?:{operationId:string;operationDigest:string;snapshotRevision:number;status:string};
 pending?:Promise<void>;
}
interface ManagedFollowupPreparationState {
  facts:Readonly<ManagedCompoundFollowupFacts>;group:LiveGroup;child:LiveChild;oldContext:DesktopAgentExecutionContext;
  pending:PendingFollowup;requestHash:string;phase:'prepared'|'applied'|'cancelled';
  appliedDigest?:string;cancelledDigest?:string;
}
interface PendingFollowup {
  readonly origin?:ManagedCompoundFollowupFacts['origin'];
  readonly activityRunId?: string;
  readonly activityMemberId?: string;
  lane: ExecutionLane;
  acceptedEpoch?: number;
  operationId: string; callerId: string; message: string; expectedTurn: number;
  readonly sourceTaskId: string | undefined;
  forceNewEpoch: boolean; controller: AbortController; request?: ExecutionLeaseRequest; ticket?: ExecutionLease;
  requestSource: 'agent' | 'user';
}
interface RootPreparation {
  modelPhysicalScope: DesktopModelPhysicalScope;
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
  private readonly observationPreparationDrains = new Set<Promise<void>>();
  private readonly groupObservationPreparationDrains = new WeakMap<LiveGroup,Set<Promise<void>>>();
  private readonly managedFollowupPreparations=new WeakMap<object,ManagedFollowupPreparationState>();
  private readonly followupInvocationScope=new AsyncLocalStorage<Readonly<{context:DesktopAgentExecutionContext;operationId:string;origin:NonNullable<ManagedCompoundFollowupFacts['origin']>}>>();
  private readonly managedFollowupReceipts=new WeakMap<object,{preparation:object;kind:'applied'|'cancelled'}>();
  private readonly managedRuntimeBindings=new WeakMap<object,Readonly<{sessionId:string;nativeInvocationId:string}>>();
  private readonly managedReleaseReceipts=new WeakMap<object,Readonly<{admission:ManagedCompoundAdmission;closedSnapshotDigest:string}>>();
  private readonly managedReleaseOwners=new Map<string,ManagedReleaseOwner>();
  private readonly completedManagedReleaseOwners=new WeakMap<LiveChild,ManagedReleaseOwner>();
  private readonly unsubscribeManagedResources:()=>void;
  private readonly fixedObservationAcks = new WeakMap<object,string>();
  private readonly observationChildPreparations = new WeakMap<object, { group: LiveGroup; child: LiveChild; parent: DesktopAgentExecutionContext; operationId: string; requestHash: string; message: string; active: boolean; ackBytes?: string }>();
  private readonly observationChildOwners = new Map<string, ObservationSessionOwner>();
  private readonly managedFinalPublications=new Map<LiveChild,ManagedFinalPublication>();
  private readonly managedFinalCommittedFacts=new WeakMap<DesktopAgentExecutionContext,NonNullable<ManagedFinalPublication['publication']>>();
  private readonly managedFinalReceipts=new WeakMap<object,Readonly<{ticket:CompoundFinalPublicationTicket;sessionId:string;turnId:string;historyDigest:string;snapshotRevision:number}>>();
  private readonly managedFinalDrains=new Set<Promise<void>>();
  private readonly observationOwners = new Map<string, { owner: WeakRef<ObservationSessionOwner>; canonicalTaskId: string }>();
  private readonly observationReferences = new WeakMap<GroupObservationReferenceTicket, { actor: DesktopAgentActor; groupId: string; taskId: string; canonicalTaskId: string; owner: ObservationSessionOwner; closure: ProtectedObservationClosure; operationId: string; consumed: boolean; applied: boolean }>();
  private readonly observationPublished = new Map<string, string>();
  private readonly cancellationScope=new AsyncLocalStorage<object>();
  private readonly cancellationTickets=new WeakMap<object,{context:DesktopAgentExecutionContext;rootEpoch:number;operationId:string;kind:'close'|'interrupt';targetId:string;members:Array<{child:LiveChild;context:DesktopAgentExecutionContext;turnId:string;admission:ManagedCompoundAdmission}>;state:'prepared'|'running'|'consumed'|'spent'}>();
  private readonly physicalSessionFailures = new Map<LiveGroup,unknown[]>();
  private readonly physicalSessionClosures = new Map<LiveGroup,Set<Promise<void>>>();
  private readonly observationResourceClosures = new WeakMap<LiveGroup,Promise<void>>();
  private readonly observationResources = new Map<string, { token: object; subtaskBoundaryPending?: boolean; close?: () => Promise<void> }>();
  readonly approvalCapacity = MAX_RESIDENT_CHILDREN + 1;
  private approvalOwner?: DesktopApprovalOwner;
  private approvalTransport?: DesktopMultiAgentApprovalTransport;
  private readonly groups = new Map<string, LiveGroup>();
  private readonly observationInitializationIncarnations = new WeakMap<LiveGroup, object>();
  private readonly observationInitializationScopes = new WeakMap<object, { group: LiveGroup; rootEpoch: number }>();
  private readonly failedObservationInitializationGroups = new WeakSet<LiveGroup>();
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
  private readonly goalDecisionContext = new AsyncLocalStorage<object>();
  private readonly goalContinuationDecisions = new WeakMap<object, GoalContinuationDecision>();
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
  private activityReconcileTimer?: ReturnType<typeof setInterval>;
  private activityReconcilePending?: Promise<void>;

  constructor(private readonly options: DesktopMultiAgentServiceOptions) {
    this.grace = options.closeGraceMs ?? 500;
    options.coordinator.setReady(false);
    this.unsubscribeStore = options.store.subscribe(event => this.publish(event));
    this.unsubscribeManagedResources=options.store.subscribe(event=>{if('groupId' in event)this.publishManagedResources(event.groupId);});
  }

  assertFreshObservationGroup(context: DesktopAgentExecutionContext): void {
    const state=this.requireActor(context.actor,'agent',context);
    if(context.agentId!==`root_${state.group.id}`||context.turn!==1||state.group.children.size||this.observationOwners.has(state.group.id))throw Error('SOL_PI_DESKTOP_FRESH_GROUP_REQUIRED');
  }

  registerGroupObservationOwner(input: { actor: DesktopAgentActor; requestSource: Source; owner: ObservationSessionOwner; canonicalTaskId: string }): void {
    const state = this.requireActor(input.actor, input.requestSource);
    const binding = this.options.store.getRootBinding(input.canonicalTaskId);
    const owner = getObservationSessionOwnerHostBinding(input.owner);
    if (!binding || binding.groupId !== state.group.id || state.context.agentId !== `root_${state.group.id}`
      || state.context.sourceTaskId !== input.canonicalTaskId
      || owner.session.exportSnapshot().sessionId !== desktopObservationSessionId(input.canonicalTaskId))
      throw new Error('SOL_PI_GROUP_REFERENCE_AUTHORIZATION_MISMATCH');
    const previous = this.observationOwners.get(state.group.id);
    if (previous && (previous.owner.deref() !== input.owner || previous.canonicalTaskId !== input.canonicalTaskId))
      throw new Error('SOL_PI_GROUP_REFERENCE_AUTHORIZATION_REBIND');
    if (previous) return;
    // Preserve the incarnation tombstone after dispose/GC: another native session
    // cannot silently become this existing group's owner. No strong owner leak.
    this.observationOwners.set(state.group.id, { owner: new WeakRef(input.owner), canonicalTaskId: input.canonicalTaskId });
    const group = state.group;
    owner.onDispose(() => queueMicrotask(() => this.maybeDormant(group)));
  }

  /** Fixed main lifetime for a registered native group owner, independent of any root turn signal. */
  bindObservationGroupLifetime(actor: DesktopAgentActor, owner: ObservationSessionOwner) {
    const state = this.requireActor(actor, 'agent'), registered = this.observationOwners.get(state.group.id);
    if (registered?.owner.deref() !== owner || this.observationResources.has(state.group.id)) throw Error('SOL_PI_GROUP_REFERENCE_AUTHORIZATION_MISMATCH');
    const group = state.group, token = Object.freeze({});
    const resource: { token: object; subtaskBoundaryPending?: boolean; close?: () => Promise<void> } = { token };
    this.observationResources.set(group.id, resource);
    const assertIdentity = () => {
      if (this.observationResources.get(group.id)?.token !== token || this.observationOwners.get(group.id)?.owner.deref() !== owner
        || this.groups.get(group.id) !== group) throw Error('SOL_PI_GROUP_REFERENCE_AUTHORIZATION_STALE');
    };
    const assertCurrent = () => {
      assertIdentity();
      if (group.lifetime.signal.aborted || group.frozen || group.deactivating) throw Error('SOL_PI_GROUP_REFERENCE_AUTHORIZATION_STALE');
      this.assertExecutionAuthorization(this.options.store.requireGroup(group.id).permissionRevision ?? 0);
      getObservationSessionOwnerHostBinding(owner);
    };
    assertCurrent();
    return Object.freeze({ groupId: group.id, signal: group.lifetime.signal, assertCurrent, assertIdentity,
      requestClose: () => { const existing=this.observationResourceClosures.get(group);if(existing)return existing;assertIdentity();return this.closeObservationResources(group); },
      onClose: (close: () => Promise<void>) => {
        assertIdentity(); if (resource.close || typeof close !== 'function') throw Error('SOL_PI_GROUP_RESOURCE_ALREADY_BOUND');
        resource.close = close;
      },
      release: () => {
        if (this.observationResources.get(group.id)?.token !== token) return;
        this.observationResources.delete(group.id); this.tryCompleteReset(this.options.store.requireGroup(group.id).threadId);this.maybeDormant(group);
      },
    });
  }

  private closeManagedSession(group:LiveGroup,child:LiveChild,close:()=>Promise<void>):Promise<void>{
    const entries=this.physicalSessionClosures.get(group)??new Set<Promise<void>>();this.physicalSessionClosures.set(group,entries);
    const pending=Promise.resolve().then(close).then(()=>{child.sessionResident=false;},error=>{const failures=this.physicalSessionFailures.get(group)??[];failures.push(error);this.physicalSessionFailures.set(group,failures);throw error;});entries.add(pending);
    void pending.finally(()=>{entries.delete(pending);if(!entries.size)this.physicalSessionClosures.delete(group);}).catch(()=>{});
    return pending;
  }

  private closeObservationResources(group:LiveGroup):Promise<void>{
    const previous=this.observationResourceClosures.get(group);if(previous)return previous;
    // Publish the single promise before abort callbacks or any asynchronous work.
    let resolve!:()=>void,reject!:(error:unknown)=>void;
    const pending=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});this.observationResourceClosures.set(group,pending);
    void pending.catch(()=>{});
    this.abortExecutionSignal(group, group.lifetime, new Error('observation_group_closing'));
    void Promise.resolve().then(async()=>{
      await Promise.all([...(this.groupObservationPreparationDrains.get(group)??[])]);
      await group.core.dispose();
      await group.core.waitForDisposedResources();
      while(this.physicalSessionClosures.get(group)?.size)await Promise.all([...this.physicalSessionClosures.get(group)!]);
      if(this.physicalSessionFailures.get(group)?.length)throw new AggregateError(this.physicalSessionFailures.get(group)!,'SOL_PI_GROUP_PHYSICAL_CLOSE_FAILED:'+this.physicalSessionFailures.get(group)!.map(String).join(';'));
      await group.commands.run(()=>{});
      const finalPublications=[...this.managedFinalPublications.values()].filter(entry=>entry.group===group);
      await Promise.all(finalPublications.flatMap(entry=>entry.pending?[entry.pending]:[]));
      if([...this.managedFinalPublications.values()].some(entry=>entry.group===group))throw Error('SOL_PI_MANAGED_FINAL_PUBLICATION_UNCONFIRMED');
      this.publishManagedResources(group.id);
      await Promise.all([...this.managedReleaseOwners.values()].filter(owner=>owner.group===group).flatMap(owner=>owner.pending?[owner.pending]:[]));
      if([...this.managedReleaseOwners.values()].some(owner=>owner.group===group&&!owner.delivered))throw Error('SOL_PI_GROUP_MANAGED_FACTS_UNCONFIRMED');
      for(const child of group.children.values()){
        const fact=this.options.store.getAgent(group.id,child.id);
        if(child.execution||child.sessionResident||!fact||!fact.resourcesReleased||fact.cleanupPending)throw Error('SOL_PI_GROUP_CHILD_RESOURCES_UNCONFIRMED:'+JSON.stringify({execution:!!child.execution,resident:child.sessionResident,status:fact?.status,released:fact?.resourcesReleased,cleanup:fact?.cleanupPending}));
      }
      const resource=this.observationResources.get(group.id);if(!resource?.close)throw Error('SOL_PI_GROUP_RESOURCE_CLEANUP_UNBOUND');
      await resource.close();
    }).then(resolve,reject);
    return pending;
  }

  prepareGroupObservationReference(input: { actor: DesktopAgentActor; requestSource: Source; taskId: string; operationId: string }): GroupObservationReferenceTicket {
    const state = this.requireActor(input.actor, input.requestSource), registered = this.observationOwners.get(state.group.id);
    const target = this.options.store.getRootBinding(input.taskId);
    if (!registered || !target || target.groupId !== state.group.id || target.bootId !== this.options.store.bootId)
      throw new Error('SOL_PI_GROUP_REFERENCE_AUTHORIZATION_MISMATCH');
    const registeredOwner = registered.owner.deref();
    if (!registeredOwner) throw new Error('SOL_PI_GROUP_REFERENCE_AUTHORIZATION_EXPIRED');
    const owner = getObservationSessionOwnerHostBinding(registeredOwner);
    const closure = mergeProtectedObservationClosures(undefined, owner.session.getProtectedObservationClosure());
    if (!closure) throw new Error('SOL_PI_GROUP_REFERENCE_EMPTY');
    this.requestHash(input.operationId, { taskId: input.taskId, closure });
    if (this.options.store.getOperation(state.group.id, input.operationId)) throw new Error('SOL_PI_GROUP_REFERENCE_AUTHORIZATION_REPLAY');
    const ticket = Object.freeze({ id: randomUUID() });
    this.observationReferences.set(ticket, { actor: input.actor, groupId: state.group.id, taskId: input.taskId,
      canonicalTaskId: registered.canonicalTaskId, owner: registeredOwner, closure, operationId: input.operationId, consumed: false, applied: false });
    return ticket;
  }

  inspectGroupObservationReference(ticket: GroupObservationReferenceTicket) {
    const facts = this.observationReferences.get(ticket);
    if (!facts || facts.consumed) throw new Error('SOL_PI_GROUP_REFERENCE_AUTHORIZATION_UNKNOWN');
    const state = this.requireActor(facts.actor, 'agent'), registered = this.observationOwners.get(facts.groupId);
    const target = this.options.store.getRootBinding(facts.taskId);
    const owner = getObservationSessionOwnerHostBinding(facts.owner);
    if (state.group.id !== facts.groupId || registered?.owner.deref() !== facts.owner || !target
      || target.groupId !== facts.groupId || target.bootId !== this.options.store.bootId
      || !isDeepStrictEqual(owner.session.getProtectedObservationClosure(), facts.closure))
      throw new Error('SOL_PI_GROUP_REFERENCE_AUTHORIZATION_STALE');
    return { taskId: facts.taskId, canonicalTaskId: facts.canonicalTaskId, closure: structuredClone(facts.closure) };
  }

  /** An applied private ticket establishes identity; the latest durable closure
   * must still cover today's native history before every provider preparation. */
  requirePublishedGroupObservationReference(ticket: GroupObservationReferenceTicket) {
    const facts = this.observationReferences.get(ticket);
    if (!facts?.applied) throw new Error('SOL_PI_GROUP_REFERENCE_AUTHORIZATION_NOT_APPLIED');
    const state = this.requireActor(facts.actor, 'agent');
    const registered = this.observationOwners.get(facts.groupId), target = this.options.store.getRootBinding(facts.taskId);
    const owner = getObservationSessionOwnerHostBinding(facts.owner);
    if (state.group.id !== facts.groupId || registered?.owner.deref() !== facts.owner
      || !target || target.groupId !== facts.groupId || target.bootId !== this.options.store.bootId)
      throw new Error('SOL_PI_GROUP_REFERENCE_AUTHORIZATION_STALE');
    const closure = mergeProtectedObservationClosures(undefined, owner.session.getProtectedObservationClosure());
    const digest = createHash('sha256').update(JSON.stringify(closure)).digest('hex');
    if (this.observationPublished.get(facts.taskId) !== digest) throw new Error('SOL_PI_GROUP_REFERENCE_NOT_PUBLISHED');
    return { taskId: facts.taskId, canonicalTaskId: facts.canonicalTaskId, owner: facts.owner, session: owner.session, context: state.context };
  }

  /** Main-only consumption of a real completed child event; never a completion proof. */
  takeGroupSubtaskBoundary(input:{actor:DesktopAgentActor;requestSource:Source;ticket:GroupObservationReferenceTicket}):boolean {
    const state=this.requireActor(input.actor,input.requestSource);
    if(input.requestSource!=='agent'||state.context.agentId!==`root_${state.group.id}`)throw Error('SOL_PI_GROUP_REFERENCE_AUTHORIZATION_MISMATCH');
    const facts=this.requirePublishedGroupObservationReference(input.ticket),resource=this.observationResources.get(state.group.id);
    if(facts.context!==state.context||!resource||this.observationOwners.get(state.group.id)?.owner.deref()!==facts.owner)throw Error('SOL_PI_GROUP_REFERENCE_AUTHORIZATION_STALE');
    const pending=resource.subtaskBoundaryPending===true;resource.subtaskBoundaryPending=false;return pending;
  }

  async commitGroupObservationReference(ticket: GroupObservationReferenceTicket): Promise<void> {
    this.inspectGroupObservationReference(ticket);
    const facts = this.observationReferences.get(ticket)!, state = this.requireActor(facts.actor, 'agent');
    await state.group.commands.run(() => {
      this.inspectGroupObservationReference(ticket);
      facts.consumed = true;
      this.persistenceIO(state.group, () => {
        if (this.options.store.getOperation(facts.groupId, facts.operationId)) throw new Error('SOL_PI_GROUP_REFERENCE_AUTHORIZATION_REPLAY');
        this.options.store.putOperation({ groupId: facts.groupId, operationId: facts.operationId, command: 'observation_reference',
          requestHash: this.requestHash(facts.operationId, { taskId: facts.taskId, closure: facts.closure }), applyState: 'applied',
          result: { state: 'completed', targetTaskId: facts.taskId, canonicalTaskId: facts.canonicalTaskId,
            closureDigest: createHash('sha256').update(JSON.stringify(facts.closure)).digest('hex') } });
        facts.applied = true;
        this.observationPublished.set(facts.taskId, createHash('sha256').update(JSON.stringify(facts.closure)).digest('hex'));
      });
    });
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
        this.options.store.transaction((acceptedPort) => {
          if (!acceptedPort.compareAndSetWorkspaceAuthorization({ profileId: row.profileId, workspaceId: row.workspaceId,
            expectedPermissionRevision: pending.request.expectedPermissionRevision, next })) throw new Error('authorization_cas_failed');
          if (!pending.request.executionAllowed) this.persistWorkspaceRevocation(acceptedPort);
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
      this.abortExecutionSignal(group, group.lifetime, reason);
      const root = group.root;
      if (root && !this.actors.get(root.context?.actor as DesktopAgentActor)?.sealed) {
        this.abortExecutionSignal(group, root.controller, reason, root.context);
        if (!root.started) (root.ticket ?? root.request?.ticket)?.release();
        if (root.context) this.markRootStopping(group, root);
        this.trackAuthorizationStop(Promise.resolve().then(() => this.host?.cancelTask(root.binding.sourceTaskId, 'permission_revoked')));
      }
      for (const child of group.children.values()) {
        this.abortExecutionSignal(group, child.controller, reason, child.context);
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

  private persistWorkspaceRevocation(acceptedPort?: DesktopMultiAgentMutationPort): void {
    const domain = this.options.executionDomain!, store = this.options.store;
    let threadCursor: string | undefined;
    do {
      const threads = (acceptedPort ?? this.options.store).listWorkspaceThreads({ profileId: domain.profileId, workspaceId: domain.workspaceId, cursor: threadCursor, limit: 50 });
      for (const thread of threads.items) {
        let groupCursor: string | undefined;
        do {
          const groups = (acceptedPort ?? this.options.store).listWorkspaceGroups({ threadId: thread.threadId, bootId: store.bootId, cursor: groupCursor, limit: 50 });
          for (const row of groups.items) {
            const current = (acceptedPort ?? this.options.store).requireGroup(row.groupId);
            const reason = current.mutationBlockedReason && current.mutationBlockedReason !== 'group_reset_pending' ? current.mutationBlockedReason : 'permission_revoked';
            if (reason !== current.mutationBlockedReason) (acceptedPort ?? this.options.store).putGroup({ ...current, mutationBlockedReason: reason }, true);
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
    if (domain && (thread.profileId !== domain.profileId || thread.workspaceId !== domain.workspaceId || thread.cwd !== domain.cwd)
      && !(thread.profileId === domain.profileId && this.options.authorizeHistoricalThreadDomain?.(thread))) throw new Error('workspace_execution_domain_mismatch');
  }

  async registerThreadWithOwnership(binding: MultiAgentThreadBinding, requestSource: Source): Promise<void> {
    if (requestSource !== 'user') throw new Error('thread registration source is not permitted');
    this.assertExecutionDomain(binding);
    const previous = this.options.store.getThread(binding.threadId);
    if (previous) {
      this.assertExecutionDomain(previous);
      // An authorized legacy launch domain stays immutable; never rebind history.
      const exactBinding = previous.profileId === binding.profileId && previous.workspaceId === binding.workspaceId && previous.cwd === binding.cwd;
      const domain = this.options.executionDomain;
      // assertExecutionDomain(previous) above has already verified the real
      // historical grant. Only the fixed current launch domain may reuse it.
      const restoringHistorical = domain && binding.profileId === domain.profileId
        && binding.workspaceId === domain.workspaceId && binding.cwd === domain.cwd
        && previous.profileId === domain.profileId
        && (previous.workspaceId !== domain.workspaceId || previous.cwd !== domain.cwd);
      if (!exactBinding && !restoringHistorical) throw new Error('thread ownership mismatch');
      this.options.store.registerThread(previous); return;
    }
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

  /** Main-only identity for inheriting an initialization restriction, never an execution grant. */
  captureObservationInitializationScope(context: DesktopAgentExecutionContext): Readonly<{ incarnation: object; rootEpoch: number }> {
    const state = this.requireActor(context.actor, 'agent', context);
    if (context.agentId !== `root_${state.group.id}` || !context.sourceTaskId
      || !Number.isSafeInteger(context.rootEpoch) || context.rootEpoch < 1) throw Error('SOL_PI_DESKTOP_OBSERVATION_NOT_READY');
    let incarnation = this.observationInitializationIncarnations.get(state.group);
    if (!incarnation) { incarnation = Object.freeze(Object.create(null)); this.observationInitializationIncarnations.set(state.group, incarnation!); }
    const scope = Object.freeze({ incarnation: incarnation!, rootEpoch: context.rootEpoch });
    this.observationInitializationScopes.set(scope, { group: state.group, rootEpoch: context.rootEpoch });
    return scope;
  }

  /** A failed attempt retains only its issued incarnation; reset/dispose retire it normally. */
  retainFailedObservationInitializationScope(scope: Readonly<{ incarnation: object; rootEpoch: number }>): void {
    const binding = this.observationInitializationScopes.get(scope);
    if (!binding || binding.rootEpoch !== scope.rootEpoch
      || this.observationInitializationIncarnations.get(binding.group) !== scope.incarnation) throw Error('SOL_PI_DESKTOP_OBSERVATION_SCOPE');
    if (this.groups.get(binding.group.id) === binding.group && !this.disposed && !binding.group.deactivating) {
      this.failedObservationInitializationGroups.add(binding.group);
    }
  }

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
  async withGoalDecision<T>(taskId: string, action: (state: DesktopGoalChildReadiness | 'superseded') => Promise<T>, continuationInput?: TaskCreateInput): Promise<T> {
    // Only the coordinator's second, concrete continuation action supplies this
    // request. Settlement listeners never receive a preparation capability.
    const capturedInput = continuationInput && this.captureGoalDecisionInput(continuationInput);
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
    let token: object | undefined;
    try {
      if (state === 'ready' && continuationInput && capturedInput && this.host) {
        const snapshot = await this.trackRecovery(this.host.inspectTask(taskId, { trackPending: this.trackRecovery }));
        if (snapshot?.taskId === taskId && snapshot.executionScope?.kind === 'goal_turn'
          && snapshot.context?.threadId === binding.threadId
          && snapshot.executionScope.threadId === binding.threadId && snapshot.multiAgentPreparation
          && encodeMultiAgentRow(snapshot.multiAgentPreparation) === encodeMultiAgentRow(this.marker(binding))) {
          const permissionRevision = await group.commands.run(() => {
            const latest = this.options.store.requireGroup(group.id);
            if (!this.goalDecisions.has(group.id) || latest.currentRootEpoch !== binding.rootEpoch
              || !isDeepStrictEqual(this.options.store.getRootBinding(taskId), binding)) throw Error('goal_decision_pending');
            return this.assertExecutionAuthorization(latest.permissionRevision ?? 0);
          });
          token = {};
          this.goalContinuationDecisions.set(token, { host: this.host, binding: structuredClone(binding),
            originalInput: continuationInput, input: capturedInput, sourceScope: structuredClone(snapshot.executionScope),
            permissionRevision, live: true });
          return await this.goalDecisionContext.run(token, () => action(state));
        }
      }
      return await action(state);
    }
    catch (error) { this.freezeGroup(group, 'goal_settlement_failed'); throw error; }
    finally {
      if (token) {
        const decision = this.goalContinuationDecisions.get(token);
        if (decision) decision.live = false;
        this.goalContinuationDecisions.delete(token);
      }
      // A waiting action owns no fence and must not clear a later ready action.
      if (state === 'ready') await group.commands.run(() => { this.goalDecisions.delete(group.id); this.maybeDormant(group); });
    }
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
        this.options.store.transaction((acceptedPort) => {
          const previous = this.requireAgent(context.groupId, context.agentId);
          const agent = acceptedPort.putAgent(context.groupId, { ...previous, taskSummary: desktopSubAgentSummary(message),
            toolsCompleted: 0, toolsFailed: 0, toolCounts: {}, otherToolCount: 0, toolStatisticsComplete: false,
            resultSummary: undefined, lastResult: undefined, resultContentId: undefined, startedAt: Date.now(), endedAt: undefined });
          acceptedPort.appendEvent(context.groupId, { kind: 'status', agentId: context.agentId, turnId: context.turnId, payload: { agent } });
          acceptedPort.putOperation({ groupId: context.groupId, operationId, command: 'run_started', requestHash: this.requestHash(operationId, { turnId: context.turnId }),
            applyState: 'applied', result: { state: 'completed' } });
          this.updateActivityMember(context, 'running', false, undefined, acceptedPort);
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
        this.options.store.transaction((acceptedPort) => {
          const previous = this.requireAgent(context.groupId, context.agentId);
          if (previous.turnId !== context.turnId || previous.toolsCompleted === undefined) throw new Error('stale or unstarted tool settlement');
          const name = desktopSubAgentSummary(fact.toolName, 60);
          const counts = { ...previous.toolCounts };
          const knownName = name && name === fact.toolName && (Object.hasOwn(counts, name) || Object.keys(counts).length < 32);
          if (knownName) Object.defineProperty(counts, name, { value: (Object.hasOwn(counts, name) ? counts[name] : 0) + 1, enumerable: true, configurable: true, writable: true });
          const total = previous.toolsCompleted + 1;
          if (!Number.isSafeInteger(total)) throw new Error('tool count overflow');
          const agent = acceptedPort.putAgent(context.groupId, { ...previous, toolsCompleted: total,
            toolsFailed: (previous.toolsFailed ?? 0) + (fact.ok ? 0 : 1), toolCounts: counts,
            otherToolCount: (previous.otherToolCount ?? 0) + (knownName ? 0 : 1) });
          acceptedPort.appendEvent(context.groupId, { kind: 'tool_finished', agentId: context.agentId, turnId: context.turnId,
            payload: { executionEventId: fact.executionEventId, toolName: name, ok: fact.ok, agent } });
          acceptedPort.putOperation({ groupId: context.groupId, operationId, command: 'tool_finished', requestHash, applyState: 'applied', result: { state: 'completed' } });
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
      if(group.leaseController)this.abortExecutionSignal(group, group.leaseController, reason);
      if (group.root?.context && !this.actors.get(group.root.context.actor)?.sealed) {
        this.abortExecutionSignal(group, group.root.controller, reason, group.root.context); this.markRootStopping(group, group.root);
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
      this.abortExecutionSignal(group, group.root.controller, reason, group.root.context); this.markRootStopping(group, group.root);
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
        || domain && (scope.profileId !== domain.profileId || scope.workspaceId !== domain.workspaceId && !scope.historicalDomain)) continue;
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
        this.options.store.transaction((acceptedPort) => {
          const agent = this.requireAgent(state.group.id, context.agentId);
          const total = { inputTokens: (agent.usage?.inputTokens ?? 0) + usage.inputTokens, outputTokens: (agent.usage?.outputTokens ?? 0) + usage.outputTokens };
          acceptedPort.putAgent(state.group.id, { ...agent, usage: total });
          acceptedPort.appendEvent(state.group.id, { kind: 'usage', agentId: context.agentId, turnId: context.turnId, payload: { ...usage, total } });
          acceptedPort.putOperation({ groupId: state.group.id, operationId, command: 'usage', requestHash, applyState: 'applied', result: { state: 'completed' } });
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
    if (!thread || thread.profileId !== input.profileId) throw new Error('thread scope ownership mismatch');
    const domain = this.options.executionDomain;
    const historicalDomain = thread.workspaceId !== input.workspaceId;
    if (historicalDomain) {
      if (!domain || input.workspaceId !== domain.workspaceId || input.actorId !== domain.actorId) throw new Error('thread scope ownership mismatch');
      this.assertExecutionDomain(thread);
    }
    const access = Object.freeze({ accessId: randomUUID() });
    this.userAccess.set(access, { actorId: input.actorId, threadId: input.threadId, profileId: thread.profileId, workspaceId: thread.workspaceId, active: true, ...(historicalDomain ? { historicalDomain: true } : {}) });
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
    const diagnosticState = { active: false };
    const reportDeletion = (reason: ThreadDeletionDiagnostic['reason'], facts?: ThreadDeletionDiagnostic['facts'] | (() => ThreadDeletionDiagnostic['facts'])) => {
      reportDiagnosticSafely<ThreadDeletionDiagnostic>(diagnosticState,
        () => this.options.onThreadDeletionDiagnostic,
        () => {
          const values = typeof facts === 'function' ? facts() : facts;
          return Object.freeze({ reason,
            threadHash: createHash('sha256').update(threadId).digest('hex'),
            operationHash: createHash('sha256').update(input.operationId).digest('hex'),
            ...(values ? { facts: Object.freeze({ ...values }) } : {}),
          });
        });
    };
    const commands = this.threadCommands.get(threadId) ?? this.groups.get(this.options.store.getThread(threadId)?.activeGroupId ?? '')?.commands ?? new MultiAgentCommandSequencer();
    const token = Symbol('thread deletion');
    try {
    const admitted = await commands.run(() => {
      this.requireUserAccess(input.access);
      const thread = this.options.store.getThread(threadId)!;
      const requestHash = this.requestHash(input.operationId, { actorId: scope.actorId, threadId, expectedRevision: input.expectedThreadRevision });
      if (thread.deletionReceipt?.operationId === input.operationId) {
        if (thread.deletionReceipt.requestHash !== requestHash) throw new Error('operation_id_conflict');
        reportDeletion('same_operation_replay');
        return this.readThreadDeletion({ access: input.access }).operation!;
      }
      if (thread.threadRevision !== input.expectedThreadRevision || thread.deleteState === 'deleted') throw new Error('stale thread deletion revision');
      if (this.deletionAttempts.has(threadId)) { reportDeletion('another_attempt_in_progress'); return this.readThreadDeletion({ access: input.access }).operation!; }
      this.options.store.transaction((acceptedPort) => {
        acceptedPort.beginThreadDeletion(threadId, { operationId: input.operationId, actorId: scope.actorId, bootId: this.options.store.bootId,
          expectedRevision: input.expectedThreadRevision, requestHash, startedAt: Date.now(), result: { operationId: input.operationId, state: 'cleanup_pending' } });
        const reset = this.pendingResets.get(threadId);
        if (reset) { this.markOperationUnknown(reset.journalGroupId, reset.operationId, acceptedPort); this.pendingResets.delete(threadId); }
      });
      this.deletionAttempts.set(threadId, token); this.threadCommands.set(threadId, commands);
      for (const group of this.groups.values()) {
        if (this.options.store.requireGroup(group.id).threadId !== threadId) continue;
        const reason = new Error('multi_agent_thread_deletion_pending');
        this.abortExecutionSignal(group, group.lifetime, reason); group.root && this.abortExecutionSignal(group, group.root.controller, reason);
        if (group.root?.context) this.markRootStopping(group, group.root);
        for (const child of group.children.values()) if (child.parentId === `root_${group.id}`) this.beginClose(group, child.id, 'user');
      }
      this.publishGroupChanged(threadId, thread.activeGroupId ?? null, thread.activeGroupId ?? null);
      return null;
    });
    if (admitted) { reportDeletion('admitted_existing_receipt_return', { receiptState: admitted.state }); return admitted; }
      this.requireUserAccess(input.access);
      if (this.deletionAttempts.get(threadId) !== token || this.disposed) throw new Error('stale thread deletion attempt');
      const deadline = performance.now() + Math.min(this.grace, 500);
      let stops = this.deletionStops.get(threadId);
      if (!stops || stops.goalFailed) {
        const previousTasks = stops?.tasks;
        const created = { goal: Promise.resolve(), goalConfirmed: false, goalFailed: false, tasks: previousTasks ?? new Map<string, { promise: Promise<void>; executionObserved: boolean; state: 'pending' | 'confirmed' | 'failed' }>() };
        created.goal = this.trackDeletionStop(Promise.resolve().then(() => { reportDeletion('before_thread_stop_started'); return this.options.beforeThreadDeletion?.(threadId); }).then(() => { created.goalConfirmed = true; reportDeletion('before_thread_stop_confirmed'); }, () => { created.goalFailed = true; reportDeletion('before_thread_stop_failed'); }));
        stops = created; this.deletionStops.set(threadId, stops);
      }
      let scan = this.deletionScans.get(threadId);
      if (scan && !scan.facts) { reportDeletion('scan_already_pending'); return this.readThreadDeletion({ access: input.access }).operation!; }
      if (!scan) {
        const created: ThreadDeletionScan = { promise: Promise.resolve().then(() => this.collectThreadDeletionScan(threadId, [...stops!.tasks.keys()])) };
        // The tracked promise covers every host IO, not merely this request's
        // bounded wait. A late callback only settles memory ownership/cache.
        created.promise = this.trackDeletionStop(created.promise.then(facts => { created.facts = facts; return facts; }, error => {
          if (this.deletionScans.get(threadId) === created) this.deletionScans.delete(threadId);
          throw error;
        }));
        scan = created; this.deletionScans.set(threadId, scan);
        if (!await this.waitForDeletionDeadline(scan.promise, deadline)) { reportDeletion('scan_deadline_elapsed'); return this.readThreadDeletion({ access: input.access }).operation!; }
      }
      this.requireUserAccess(input.access);
      if (this.deletionAttempts.get(threadId) !== token || this.disposed) throw new Error('stale thread deletion attempt');
      const { initialInFlight, inspected, targetTasks, terminalTasks, cancellableTasks, unknownAttribution } = scan.facts!;
      reportDeletion('scan_facts_ready', { initialInFlight: initialInFlight.size, inspected: inspected.size, targetTasks: targetTasks.size });
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
      const stopsReady = await this.waitForDeletionDeadline(Promise.all([stops.goal, ...[...stops.tasks.values()].map(stop => stop.promise)]), deadline);
      if (!stopsReady) reportDeletion('stop_deadline_elapsed', { goalConfirmed: stops.goalConfirmed, goalFailed: stops.goalFailed });
      await commands.run(() => {
        this.requireUserAccess(input.access);
        if (this.deletionAttempts.get(threadId) !== token || this.disposed) throw new Error('stale thread deletion attempt');
        if (stops!.goalFailed) { reportDeletion('goal_stop_failed'); throw new Error('multi_agent_thread_goal_cancellation_failed'); }
        if (unknownAttribution) { reportDeletion('unknown_task_attribution'); this.deletionScans.delete(threadId); return; }
        if (!stops!.goalConfirmed) { reportDeletion('goal_stop_not_confirmed'); return; }
        const currentInFlight = this.host!.inFlightTaskIds();
        if (currentInFlight.some(id => !inspected.has(id))) { reportDeletion('new_uninspected_inflight'); this.deletionScans.delete(threadId); return; }
        if (currentInFlight.some(id => targetTasks.has(id))) { reportDeletion('target_task_still_inflight'); return; }
        // Prepared tasks never registered an execution, so an empty execution
        // map cannot prove they were stopped. Actual terminal history or a
        // confirmed stop is required; late audit ACKs of exited runs are not.
        for (const [taskId, stop] of stops!.tasks) {
          if (stop.executionObserved || terminalTasks.has(taskId)) continue;
          if (stop.state === 'failed') { reportDeletion('task_stop_failed'); throw new Error('multi_agent_thread_task_cancellation_failed'); }
          if (stop.state !== 'confirmed') { reportDeletion('prepared_task_stop_not_confirmed'); return; }
        }
        const groups = [...this.groups.values()].filter(group => this.options.store.requireGroup(group.id).threadId === threadId);
        if (groups.some(group => group.root || group.lease && !group.lease.released || this.goalDecisions.has(group.id)
          || [...group.children.values()].some(child => child.execution || child.followups.length || child.sessionResident))) {
          reportDeletion('live_group_resources', () => ({
            roots: groups.filter(group => !!group.root).length, leases: groups.filter(group => !!group.lease && !group.lease.released).length,
            goalDecisions: groups.filter(group => this.goalDecisions.has(group.id)).length,
            childExecutions: groups.reduce((n, group) => n + [...group.children.values()].filter(child => !!child.execution).length, 0),
            followups: groups.reduce((n, group) => n + [...group.children.values()].reduce((n, child) => n + child.followups.length, 0), 0),
            residentSessions: groups.reduce((n, group) => n + [...group.children.values()].filter(child => child.sessionResident).length, 0),
          }));
          return;
        }
        if ([...this.resourceCommands].some(([id, owner]) => owner.users > 0 && this.options.store.getGroup(id)?.threadId === threadId)) { reportDeletion('resource_commands_in_use'); return; }
        let persistedResourcesPending = false;
        if ((persistedResourcesPending = this.options.store.threadHasUnreleasedResources(threadId))||groups.some(group=>this.observationResources.has(group.id))) {
          reportDeletion(persistedResourcesPending ? 'persisted_agent_or_disk_resources' : 'observation_group_resources');
          return;
        }
        const oldGroupId = this.options.store.getThread(threadId)!.activeGroupId ?? null;
        reportDeletion('before_commit');
        const commitObservationDeletion=this.options.beforeThreadDeletionCommit?.(threadId,input.operationId);
        reportDeletion('before_commit_returned');
        this.options.store.deleteThreadHistory(threadId, input.operationId);
        reportDeletion('history_deleted');
        commitObservationDeletion?.();
        reportDeletion('observation_commit_returned');
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
        reportDeletion('committed');
      });
    } catch (error) {
      reportDeletion('caught_error');
      if (this.deletionAttempts.get(threadId) !== token) throw error;
      if (this.disposed) { reportDeletion('disposed_unknown'); return { operationId: input.operationId, state: 'unknown' }; }
      if (this.deletionAttempts.get(threadId) === token) {
        try { this.options.store.updateThreadDeletion(threadId, input.operationId, { operationId: input.operationId, state: 'unknown', error: truncateMultiAgentText(String(error), 512).text }); }
        catch { reportDeletion('receipt_update_failed_unknown'); return { operationId: input.operationId, state: 'unknown' }; }
      }
    } finally {
      if (this.deletionAttempts.get(threadId) === token) { this.deletionAttempts.delete(threadId); if (this.threadCommands.get(threadId) === commands) this.threadCommands.delete(threadId); }
    }
    const result = this.readThreadDeletion({ access: input.access }).operation!;
    reportDeletion('return_receipt', { receiptState: result.state });
    return result;
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
        store.transaction((acceptedPort) => {
          createdId = acceptedPort.createGroup(scope.threadId, permissionRevision).groupId;
          acceptedPort.putOperation({ groupId: createdId, operationId: input.operationId, command: 'reset', requestHash, applyState: 'applied',
            result: { operationId: input.operationId, state: 'completed', phase: 'completed', groupId: createdId } });
        });
        this.publishGroupChanged(scope.threadId, null, createdId);
        return { operationId: input.operationId, state: 'completed' as const, phase: 'completed', groupId: createdId };
      }
      const active = this.groups.get(thread.activeGroupId);
      if (!active || active !== group) throw new Error('stale group reset owner');
      const pending: PendingReset = { access: input.access, threadId: scope.threadId, expectedGroupId: thread.activeGroupId,
        journalGroupId: thread.activeGroupId, operationId: input.operationId, requestHash, permissionRevision };
      store.transaction((acceptedPort) => {
        acceptedPort.putOperation({ groupId: active.id, operationId: input.operationId, command: 'reset', requestHash, applyState: 'applied',
          result: { operationId: input.operationId, state: 'cleanup_pending', phase: 'cleanup_pending', groupId: active.id, actorId: scope.actorId } }, true);
        const current = acceptedPort.requireGroup(active.id);
        acceptedPort.putGroup({ ...current, mutationBlockedReason: current.mutationBlockedReason ?? 'group_reset_pending' }, true);
      });
      this.pendingResets.set(scope.threadId, pending);
      const reason = new Error('group_reset_pending');
      this.abortExecutionSignal(active, active.lifetime, reason);
      let failed = false;
      if (active.root) {
        const root = active.root;
        this.abortExecutionSignal(active, root.controller, reason, root.context);
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

  private markOperationUnknown(groupId: string, operationId: string, acceptedPort?: DesktopMultiAgentMutationPort): void {
    this.uncertainOperations.add(`${groupId}:${operationId}`);
    try {
      const operation = (acceptedPort ?? this.options.store).getOperation(groupId, operationId);
      if (operation) (acceptedPort ?? this.options.store).putOperation({ ...operation, applyState: 'unknown', result: { ...operation.result, state: 'unknown' } }, true);
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
      if (store.threadHasUnreleasedResources(threadId)||group&&this.observationResources.has(group.id)) return;
      let nextId = '';
      store.transaction((acceptedPort) => {
        const operation = acceptedPort.getOperation(pending.journalGroupId, pending.operationId);
        if (!operation || operation.applyState !== 'applied' || operation.requestHash !== pending.requestHash
          || operation.result.phase !== 'cleanup_pending' || acceptedPort.getThread(threadId)?.activeGroupId !== pending.expectedGroupId) throw new Error('stale reset completion');
        const previous = acceptedPort.requireGroup(pending.journalGroupId);
        acceptedPort.putGroup({ ...previous, historicalOnly: true, mutationBlockedReason: previous.mutationBlockedReason === 'group_reset_pending' ? null : previous.mutationBlockedReason }, true);
        acceptedPort.clearActiveGroup(threadId, pending.journalGroupId);
        nextId = acceptedPort.createGroup(threadId, pending.permissionRevision).groupId;
        acceptedPort.putOperation({ ...operation, result: { ...operation.result, state: 'completed', phase: 'completed', groupId: nextId } }, true);
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
        this.options.store.transaction((acceptedPort) => {
          const previous = acceptedPort.getOperation(input.groupId, input.operationId)!;
          acceptedPort.putOperation({ ...previous, result: { ...previous.result, ...result } }, true);
          this.refreshResourceProjection(input.groupId, admitted.agentId!, acceptedPort);
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
      const result = this.mutate(group, request, command, { target: input.agentId, expectedTurn: input.expectedTurn, message }, (acceptedPort) => {
        // Known, side-effect-free refusals need the same durable receipt as an
        // accepted command. A failed receipt write still freezes and throws.
        const reject = (error: string): MultiAgentControlResult => ({ operationId: input.operationId,
          state: 'completed', outcome: 'rejected', error, targetAgentId: input.agentId });
        if (!target) return reject('unknown_target');
        if (target.turn !== input.expectedTurn) return reject('stale_expected_turn');
        if (command === 'send' && target.status === 'closed') return reject('target_closed');
        if (command === 'followup') {
          if (this.managedReleaseOwners.has(target.id)&&!this.options.prepareObservationFollowup) return reject('SOL_PI_MANAGED_FOLLOWUP_NOT_READY');
          if (!child || !target.resumable || target.cleanupError || child.stopRequested && child.execution) return reject('agent_not_resumable');
          if (child.followups.length >= 4) return reject('multi_agent_followup_queue_full');
        }
        if (command === 'send') {
          const sent = acceptedPort.sendMessage(group.id, { sender: { kind: 'user', actorId: scope.actorId }, receiverId: target.id, text: message! });
          return { operationId: input.operationId, state: 'applied', targetAgentId: target.id, messageId: sent.messageId };
        }
        if (command === 'followup') {
          const runId = `user:${group.id}:${input.operationId}`;
          acceptedPort.createActivityRun({ runId, groupId: group.id, kind: 'user_followup', originId: input.operationId });
          acceptedPort.putActivityMember({ runId, groupId: group.id, memberId: input.operationId, operationId: input.operationId,
            agentId: target.id, state: 'accepted', physicalSettled: false });
          return { operationId: input.operationId, state: 'queued_next_admission', targetAgentId: target.id, expectedTurn: child!.context.turn + child!.followups.length + 1 };
        }
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
          activityRunId: `user:${group.id}:${input.operationId}`, activityMemberId: input.operationId,
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
    if (scope.historicalDomain) this.assertExecutionDomain(thread);
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
    this.activityReconcileTimer = setInterval(() => {
      void this.reconcileActivityRuns({ requestSource: 'scheduler', authority }).catch(() => { /* Durable runs remain pending; retry reads never dispatch work. */ });
    }, 30_000);
    this.activityReconcileTimer.unref?.();
    return authority;
  }

  /** Reconcile from committed host snapshots; the hook is only a wake hint. */
  reconcileActivityRuns(input: { requestSource: Source; authority: DesktopHostDeliveryAuthority; taskId?: string }): Promise<void> {
    const owner = this.requireHostDeliveryOwner(input.requestSource, input.authority);
    if (!input.taskId && this.activityReconcilePending) return this.activityReconcilePending;
    const pending = (async () => {
      for (const run of this.options.store.pendingActivityRuns()) {
        if (this.disposed) return;
        if (input.taskId && run.rootTaskId !== input.taskId) continue;
        const live = this.groups.get(run.groupId);
        const queueOwner = this.resourceCommands.get(run.groupId) ?? { commands: live?.commands ?? new MultiAgentCommandSequencer(), users: 0 };
        queueOwner.users++; this.resourceCommands.set(run.groupId, queueOwner);
        try {
          const snapshot = run.rootTaskId ? await owner.host.inspectTask(run.rootTaskId) : null;
          await queueOwner.commands.run(() => {
          this.requireHostDeliveryOwner(input.requestSource, input.authority);
          const current = this.options.store.getActivityRun(run.runId);
          if (!current || current.terminalEventId) return;
          this.options.store.transaction((acceptedPort) => {
            if (run.bootId !== this.options.store.bootId) {
              acceptedPort.assertResourceOwnerSettled(run.bootId);
              for (const member of acceptedPort.getActivityMembers(run.runId)) {
                if (!member.physicalSettled) acceptedPort.putActivityMember({ ...member, state: 'settled', physicalSettled: true, outcome: 'cancelled' });
              }
            }
            if (snapshot && ['completed', 'failed', 'cancelled'].includes(snapshot.status)) {
              const binding = acceptedPort.getRootBinding(snapshot.taskId);
              if (!binding || binding.groupId !== run.groupId || binding.rootTurnId !== run.originId
                || !isDeepStrictEqual(snapshot.multiAgentPreparation, this.marker(binding))) throw new Error('activity_root_identity_mismatch');
              let eventIndex = snapshot.events.length - 1;
              while (eventIndex >= 0 && snapshot.events[eventIndex].type !== 'task_terminal') eventIndex--;
              const event = snapshot.events[eventIndex];
              if (event?.type === 'task_terminal' && event.status === snapshot.status) {
                acceptedPort.confirmActivityRootTerminal(run.runId, {
                  taskId: snapshot.taskId, sessionId: snapshot.sessionId, eventIndex, outcome: event.status,
                });
                // A preparation abandoned before activation has no runRoot
                // finally block. Confirm that both execution owners are idle.
                if (binding.phase === 'abandoned' && !live?.root && !owner.host.inFlightTaskIds().includes(snapshot.taskId)) {
                  const member = acceptedPort.getActivityMembers(run.runId).find(item => item.memberId === binding.rootTurnId);
                  if (member && !member.physicalSettled) acceptedPort.putActivityMember({ ...member, state: 'settled', physicalSettled: true, outcome: event.status });
                }
              }
            }
            acceptedPort.finalizeActivityRun(run.runId);
          });
        }); } catch (error) {
          // A corrupt/missing proof for one run must not starve every later run.
          // Keep its outcome unknown; never dispatch or synthesize a terminal.
          try { await queueOwner.commands.run(() => this.options.store.markActivityRunUnknown(run.runId,
            error instanceof Error && error.message === 'activity_root_identity_mismatch' ? 'host_identity_mismatch' : 'host_proof_unavailable')); }
          catch { /* Preserve previous durable truth on storage failure. */ }
        } finally {
          if (--queueOwner.users === 0 && this.resourceCommands.get(run.groupId) === queueOwner) this.resourceCommands.delete(run.groupId);
        }
      }
    })();
    if (!input.taskId) {
      this.activityReconcilePending = pending;
      void pending.finally(() => { if (this.activityReconcilePending === pending) this.activityReconcilePending = undefined; }).catch(() => {});
    }
    return pending;
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
        this.options.store.transaction((acceptedPort) => {
          acceptedPort.putRootBinding({ ...current, delivery }, true);
          const root = this.requireAgent(source.groupId, `root_${source.groupId}`);
          if (root.sourceTaskId === source.sourceTaskId && root.turnId === source.rootTurnId && root.turn === source.rootEpoch) {
            acceptedPort.putAgent(source.groupId, { ...root, hostDeliveryStatus: delivery.status,
              guardFailure: delivery.guardFailure, hostDeliveryCleanupPending: delivery.readerCleanup === 'pending' || delivery.storeCleanup === 'pending' }, true);
          }
          acceptedPort.appendEvent(source.groupId, { kind: 'delivery', agentId: root.id, turnId: source.rootTurnId,
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
          this.options.store.transaction((acceptedPort) => {
            const currentBinding = acceptedPort.getRootBinding(taskId);
            if (!currentBinding || !isDeepStrictEqual(this.deliverySource(currentBinding), source)) throw new Error('delivery_recovery_source_mismatch');
            acceptedPort.putRootBinding({ ...currentBinding, delivery: recovered }, true);
            const root = this.requireAgent(source.groupId, `root_${source.groupId}`);
            if (root.sourceTaskId === taskId && root.turnId === source.rootTurnId && root.turn === source.rootEpoch) acceptedPort.putAgent(source.groupId, {
              ...root, hostDeliveryStatus: recovered.status, guardFailure: recovered.guardFailure, hostDeliveryCleanupPending: false,
            }, true);
            acceptedPort.appendEvent(source.groupId, { kind: 'delivery', agentId: root.id, turnId: source.rootTurnId, payload: { source, delivery: recovered } });
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

  async prepareRoot(host: InProcessTaskRuntimeHost, threadId: string, input: TaskCreateInput, originalReservation?:TaskIdentityReservation): Promise<{ taskId: string }> {
    const decisionToken = this.goalDecisionContext.getStore();
    const decision = decisionToken && this.goalContinuationDecisions.get(decisionToken);
    if (decisionToken && (!decision?.live || decision.host !== host || decision.originalInput !== input
      || !isDeepStrictEqual(input, decision.input))) throw Error('goal_decision_pending');
    if (decision) input = decision.input;
    const lane = currentExecutionLane();
    if(originalReservation)host.assertTaskIdentityReservation(originalReservation);
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
    const reservation = originalReservation ?? host.reserveTaskIdentity();
    const preparation = await group.commands.run(() => {
      this.assertWritable(group, 'multi_agent_persistence_failed', decisionToken);
      if (decision) {
        if (decision.taskId) throw Error('goal_decision_pending');
        decision.taskId = reservation.taskId;
      }
      if (group.root) throw new Error('multi_agent_root_busy');
      const latest = store.requireGroup(group.id);
      const binding: MultiAgentRootBinding = {
        sourceTaskId: reservation.taskId, groupId: group.id, threadId, rootTurnId: randomUUID(),
        rootEpoch: latest.nextRootEpoch + 1, preparationId: randomUUID(), bootId: store.bootId,
        phase: 'preparing', status: 'pending',
      };
      store.transaction((acceptedPort) => {
        acceptedPort.putGroup({ ...latest, nextRootEpoch: binding.rootEpoch });
        acceptedPort.putRootBinding(binding);
        const runId = `root:${binding.sourceTaskId}`;
        acceptedPort.createActivityRun({ runId, groupId: group.id, kind: 'root', originId: binding.rootTurnId, rootTaskId: binding.sourceTaskId });
        acceptedPort.putActivityMember({ runId, groupId: group.id, memberId: binding.rootTurnId, operationId: binding.rootTurnId,
          agentId: `root_${group.id}`, turnId: binding.rootTurnId, state: 'accepted', physicalSettled: false });
        const previous = this.requireAgent(group.id, `root_${group.id}`);
        const rootAgent = acceptedPort.putAgent(group.id, { ...previous, status: 'pending', turn: binding.rootEpoch, turnId: binding.rootTurnId,
          hostDeliveryStatus: undefined, guardFailure: undefined, hostDeliveryCleanupPending: undefined,
          sourceTaskId: binding.sourceTaskId, executionActive: false, runtimeResident: false, sessionResident: false,
          resourcesReleased: false, cleanupPending: false, stopState: 'none', activationState: 'prepared', error: undefined, endedAt: undefined });
        acceptedPort.appendEvent(group.id, { kind: 'status', agentId: rootAgent.id, turnId: binding.rootTurnId, payload: { agent: rootAgent } });
      });
      const root: RootPreparation = { binding, controller: new AbortController(), started: false, preparing: true,
        modelPhysicalScope: createDesktopModelPhysicalScope(() => {
          const context = root.context;
          if (this.disposed || this.options.store.isClosed() || group.root !== root || !root.started || !context
            || context.sourceTaskId !== root.binding.sourceTaskId || context.rootEpoch !== root.binding.rootEpoch
            || context.signal.aborted || group.frozen || group.deactivating) throw Error('desktop_root_model_scope_expired');
        }) };
      group.root = root;
      return root;
    });
    try {
      await host.prepareTask(input, { reservation, marker: this.marker(preparation.binding) });
      await group.commands.run(() => {
        this.assertWritable(group, 'multi_agent_persistence_failed', decisionToken);
        if (decision && decision.taskId !== reservation.taskId) throw Error('goal_decision_pending');
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
      this.abortExecutionSignal(group, preparation.controller, error, preparation.context);
      preparation.ticket?.release();
      try {
        await group.commands.run(() => {
          store.transaction((acceptedPort) => {
            acceptedPort.putRootBinding({ ...preparation.binding, phase: 'abandoned', status: 'interrupted' }, true);
            const rootAgent = this.requireAgent(group.id, `root_${group.id}`);
            acceptedPort.putAgent(group.id, { ...rootAgent, status: 'interrupted', resourcesReleased: false, cleanupPending: true, activationState: 'prepared' }, true);
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
          store.transaction((acceptedPort) => {
            const runId = `root:${preparation.binding.sourceTaskId}`;
            const member = acceptedPort.getActivityMembers(runId).find(item => item.memberId === preparation.binding.rootTurnId);
            if (member && !member.physicalSettled) acceptedPort.putActivityMember({ ...member, state: 'settled', physicalSettled: true, outcome: 'cancelled' });
            acceptedPort.markActivityRunUnknown(runId, 'preparation_abandoned');
          });
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
        this.options.store.transaction((acceptedPort) => {
          acceptedPort.putRootBinding({ ...current, phase: 'abandoned', status: 'interrupted' }, true);
          const before = this.requireAgent(group.id, `root_${group.id}`);
          const agent = acceptedPort.putAgent(group.id, { ...before, status: 'interrupted', stopState: root.context ? 'requested' : 'none', cleanupPending: Boolean(root.context),
            ...(root.context ? {} : root.preparing ? { resourcesReleased: false, cleanupPending: true, activationState: 'prepared' as const }
              : { resourcesReleased: true, activationState: 'settled' as const }) }, true);
          acceptedPort.appendEvent(group.id, { kind: 'status', agentId: agent.id, payload: { agent } });
        });
      } catch { failed = true; }
      // A failed authorized intent write still permits physical abort. Denied or
      // stale decisions never reach this block and never authorize host cancel.
      const reason = new Error(input.reason);
      this.abortExecutionSignal(group, root.controller, reason, root.context);
      // The registered observation group owns its independent child lifetime.
      // Stopping one root turn is not user revocation of that group authority.
      const retainGroupChildren = this.observationResources.has(group.id) && !failed
        && !group.lifetime.signal.aborted && !group.deactivating && !group.frozen;
      for (const child of retainGroupChildren ? [] : group.children.values()) {
        try { this.cancelFollowups(group, child, reason); } catch { failed = true; }
      }
      if (!root.started) {
        (root.ticket ?? root.request?.ticket)?.release();
        if (group.root === root && !root.preparing) group.root = undefined;
      }
      if (root.context) this.markRootStopping(group, root);
      if (!retainGroupChildren && root.context && group.lease?.epoch === root.context.memberTicket.epoch) {
        if(group.leaseController)this.abortExecutionSignal(group, group.leaseController, reason);
        for (const child of group.children.values()) {
          if (child.execution && child.context.memberTicket.epoch === group.lease.epoch) this.markStopping(group, child, reason);
        }
      }
      if (failed) this.freezeGroup(group, 'multi_agent_cancellation_persistence_failed');
      this.wake(group);
      return { hostAbortAllowed: true, ack: failed ? 'unknown' : 'applied' };
    });
  }

  /** Fixed Main model runtime only; a sealed mutation actor may still summarize. */
  captureRootModelPhysicalScope(context: DesktopAgentExecutionContext): DesktopModelPhysicalScope {
    const root = this.groups.get(context.groupId)?.root;
    if (!root || root.context !== context || !root.started || root.binding.sourceTaskId !== context.sourceTaskId
      || root.binding.rootEpoch !== context.rootEpoch) throw Error('desktop_root_model_scope_invalid');
    return root.modelPhysicalScope;
  }

  async runRoot<T>(input: TaskRunnerInput, action: (context: DesktopAgentExecutionContext) => Promise<T>): Promise<T> {
    this.assertReady();
    const binding = this.options.store.getRootBinding(input.taskId);
    if (!binding) throw new Error('multi_agent_root_not_prepared');
    const group = this.liveGroup(binding.groupId);
    const root = group.root;
    if (!root || root.binding.sourceTaskId !== input.taskId || root.started || !root.request) throw new Error('multi_agent_root_not_admitted');
    root.started = true;
    const abortQueued = () => this.abortExecutionSignal(group, root.controller, input.signal.reason, root.context);
    input.signal.addEventListener('abort', abortQueued, { once: true });
    if (input.signal.aborted) abortQueued();
    let context: DesktopAgentExecutionContext | undefined;
    let modelBodyFailure: { error: unknown } | undefined;
    let modelResult: T | undefined;
    try {
      root.ticket = await root.request;
      if (root.controller.signal.aborted) throw root.controller.signal.reason ?? new DOMException('aborted', 'AbortError');
      context = await group.commands.run(() => {
        this.assertWritable(group);
        if (group.root !== root) throw new Error('stale root preparation');
        this.installLease(group, root.ticket!);
        const context = this.createContext(group, `root_${group.id}`, root.binding.rootTurnId, root.binding.rootEpoch, root.ticket!, root.controller.signal,
          { sourceTaskId: root.binding.sourceTaskId, activityRunId: `root:${root.binding.sourceTaskId}`, activityMemberId: root.binding.rootTurnId });
        root.context = context;
        root.binding = { ...root.binding, phase: 'active', status: 'running' };
        this.options.store.transaction((acceptedPort) => {
          acceptedPort.putRootBinding(root.binding);
          this.updateActivityMember(context, 'running', false, undefined, acceptedPort);
          acceptedPort.putGroup({ ...acceptedPort.requireGroup(group.id), currentRootEpoch: root.binding.rootEpoch });
          const previous = this.requireAgent(group.id, context.agentId);
          const agent = acceptedPort.putAgent(group.id, { ...previous, status: 'running', turn: context.turn, turnId: context.turnId, sourceTaskId: input.taskId,
            hostDeliveryStatus: undefined, guardFailure: undefined, hostDeliveryCleanupPending: undefined,
            executionActive: true, runtimeResident: true, sessionResident: true, resourcesReleased: false, startedAt: Date.now(), activationState: 'active' });
          acceptedPort.appendEvent(group.id, { kind: 'status', agentId: context.agentId, payload: { agent } });
        });
        return context;
      });
      const result = await action(context);
      if (context.signal.aborted && this.actors.get(context.actor)?.outcome !== 'completed') throw context.signal.reason;
      // The production loop normally seals first. This also fences unexpected
      // early returns by a runner without silently discarding pending input.
      const seal = await context.mailbox.trySealTurn({ limitReached: true });
      if (seal.kind === 'limit_reached') throw new Error('multi_agent_iteration_limit');
      modelResult = result;
    } catch (error) {
      modelBodyFailure = { error };
      if (context) {
        try { await context.mailbox.trySealTurn({ outcome: context.signal.aborted ? 'interrupted' : 'failed' }); }
        catch { this.freezeGroup(group, 'multi_agent_persistence_failed'); }
      }
    }
    {
      // No transaction or command queue is held while the original model IO drains.
      try { await closeDesktopModelPhysicalScope(root.modelPhysicalScope, root.controller.signal.reason); }
      catch (physicalError) {
        // Admission closes before any best-effort SQLite unknown receipt.
        this.runtimeBlockedReason = 'runtime_blocked'; this.options.coordinator.block('runtime_blocked');
        let persistenceFailure: { error: unknown } | undefined;
        try { await group.commands.run(() => {
          if (context) {
            const actor = this.actors.get(context.actor); if (actor) actor.active = false;
            const previous = this.requireAgent(group.id, context.agentId);
            this.options.store.putAgent(group.id, { ...previous, executionActive: false, resourcesReleased: false, cleanupPending: true }, true);
          }
        }); } catch (error) { persistenceFailure = { error }; }
        const failures: unknown[] = modelBodyFailure ? [modelBodyFailure.error, physicalError] : [physicalError];
        if (persistenceFailure) failures.push(persistenceFailure.error);
        if (failures.length > 1) throw new AggregateError(failures, 'desktop_root_business_model_and_persistence_failed', { cause: modelBodyFailure?.error ?? physicalError });
        throw physicalError;
      }
      input.signal.removeEventListener('abort', abortQueued);
      clearTimeout(root.stopTimer);
      try {
        await group.commands.run(() => {
          if (context) {
            const actor = this.actors.get(context.actor); if (actor) actor.active = false;
            const previous = this.requireAgent(group.id, context.agentId);
            this.options.store.putAgent(group.id, { ...previous, executionActive: false, runtimeResident: false, sessionResident: false, resourcesReleased: true,
              cleanupPending: false, stopState: 'none', activationState: 'settled' }, true);
            this.updateActivityMember(context, 'settled', true, previous.status === 'completed' ? 'completed' : previous.status === 'failed' ? 'failed' : 'cancelled');
          }
          if (group.root === root) group.root = undefined;
          this.wake(group);
        });
      } finally { root.ticket?.release(); this.clearReleasedLease(group); }
    }
    if (modelBodyFailure) throw modelBodyFailure.error;
    return modelResult!;
  }

  /** Actual Runtime only: binds the immutable seed invocation and child session before installation. */
  bindObservationChildRuntime(preparation:DesktopObservationChildPreparation,input:{session:import('../../src/ai/runtime/session.js').AgentSessionState;nativeInvocationId:string}):void {
    const facts=this.assertObservationChildPreparation(preparation),sessionId=input.session.exportSnapshot().sessionId;
    if(this.managedRuntimeBindings.has(preparation)||sessionId!==desktopObservationSessionId(facts.context.agentId)||!input.nativeInvocationId)throw Error('SOL_PI_DESKTOP_CHILD_RUNTIME_BINDING');
    this.managedRuntimeBindings.set(preparation,Object.freeze({sessionId,nativeInvocationId:input.nativeInvocationId}));
  }
  bindManagedObservationAdmission(preparation:DesktopObservationChildPreparation,input:{admission:ManagedCompoundAdmission;onResourcesReleased:(receipt:object)=>Promise<void>}):Readonly<{assertCurrent():void}> {
    const {admission,onResourcesReleased}=input,binding=getManagedCompoundAdmissionBinding(admission),facts=this.assertObservationChildPreparation(preparation),runtime=this.managedRuntimeBindings.get(preparation),entry=this.observationChildPreparations.get(preparation)!;
    if(!runtime||typeof onResourcesReleased!=='function'||binding.groupId!==facts.context.groupId||binding.agentId!==facts.context.agentId||binding.rootEpoch!==facts.context.rootEpoch||binding.operationId!==facts.operationId||binding.parentOperationId!==runtime.nativeInvocationId||binding.childSessionId!==runtime.sessionId||binding.parentSessionId!==getObservationSessionOwnerHostBinding(facts.sourceOwner).session.exportSnapshot().sessionId||this.managedReleaseOwners.has(binding.agentId))throw Error('SOL_PI_DESKTOP_MANAGED_ADMISSION_MISMATCH');
    const operation=this.options.store.getOperation(binding.groupId,binding.operationId);
    if(!operation||operation.command!=='spawn'||operation.applyState!=='prepared'||operation.fixedAckBytes!==facts.ackBytes)throw Error('SOL_PI_DESKTOP_MANAGED_ADMISSION_MISMATCH');
    const owner={admission,parentSession:getObservationSessionOwnerHostBinding(facts.sourceOwner).session,childSessionId:runtime.sessionId,nativeInvocationId:runtime.nativeInvocationId,group:entry.group,child:entry.child,sourceOwner:facts.sourceOwner,permissionRevision:entry.child.context.permissionRevision,ackBytes:facts.ackBytes,requestHash:operation.requestHash,notify:onResourcesReleased,delivered:false};this.managedReleaseOwners.set(binding.agentId,owner);
    return Object.freeze({assertCurrent:()=>{
      if(this.managedReleaseOwners.get(binding.agentId)!==owner||this.groups.get(binding.groupId)!==entry.group||entry.group.children.get(binding.agentId)!==entry.child||entry.child.context.rootEpoch!==binding.rootEpoch||entry.child.context.signal.aborted||entry.group.lifetime.signal.aborted||entry.group.frozen||entry.group.deactivating)throw Error('SOL_PI_DESKTOP_MANAGED_SUPERVISION_STALE');
      this.requireActor(entry.child.context.actor,'agent',entry.child.context);
      const actor=this.options.store.getAgent(binding.groupId,binding.agentId);
      if(!actor||actor.status==='closed'||actor.resourcesReleased)throw Error('SOL_PI_DESKTOP_MANAGED_SUPERVISION_STALE');
    }});
  }
  assertManagedObservationAdmissionCurrent(admission:ManagedCompoundAdmission,actor:DesktopAgentActor):void {
    const binding=getManagedCompoundAdmissionBinding(admission),owner=this.managedReleaseOwners.get(binding.agentId),caller=this.requireActor(actor,'agent');
    if(!owner||owner.admission!==admission||caller.group!==owner.group||getObservationSessionOwnerHostBinding(this.getObservationExecutionOwner(actor)).session.exportSnapshot().sessionId!==binding.parentSessionId||this.groups.get(binding.groupId)!==owner.group||owner.group.children.get(binding.agentId)!==owner.child||owner.child.context.rootEpoch!==binding.rootEpoch||owner.child.context.signal.aborted||owner.group.lifetime.signal.aborted||owner.group.frozen||owner.group.deactivating)throw Error('SOL_PI_DESKTOP_MANAGED_SUPERVISION_STALE');
    this.requireActor(owner.child.context.actor,'agent',owner.child.context);
    const operation=this.options.store.getOperation(binding.groupId,binding.operationId);
    if(!operation||operation.command!=='spawn'||operation.applyState!=='applied'||operation.result.state!=='applied'||operation.result.targetAgentId!==binding.agentId||operation.requestHash!==owner.requestHash||operation.fixedAckBytes!==owner.ackBytes)throw Error('SOL_PI_DESKTOP_MANAGED_SUPERVISION_STALE');
    const current=this.options.store.getAgent(binding.groupId,binding.agentId);
    if(!current||current.status==='closed'||current.resourcesReleased)throw Error('SOL_PI_DESKTOP_MANAGED_SUPERVISION_STALE');
  }
  /** Long-lived resource supervision, independent of the original root turn actor. */
  assertManagedResourceCurrent(admission:ManagedCompoundAdmission):void {
    const binding=getManagedCompoundAdmissionBinding(admission),owner=this.managedReleaseOwners.get(binding.agentId);
    if(!owner||owner.admission!==admission||this.disposed||this.groups.get(binding.groupId)!==owner.group||owner.group.children.get(binding.agentId)!==owner.child||owner.child.context.rootEpoch!==binding.rootEpoch||owner.group.lifetime.signal.aborted||owner.group.frozen||owner.group.deactivating)throw Error('SOL_PI_DESKTOP_MANAGED_SUPERVISION_STALE');
    this.assertExecutionAuthorization(owner.permissionRevision);
    const source=getObservationSessionOwnerHostBinding(owner.sourceOwner);
    if(source.session.exportSnapshot().sessionId!==binding.parentSessionId)throw Error('SOL_PI_DESKTOP_MANAGED_SUPERVISION_STALE');
    const operation=this.options.store.getOperation(binding.groupId,binding.operationId),current=this.options.store.getAgent(binding.groupId,binding.agentId);
    if(!operation||operation.command!=='spawn'||operation.applyState!=='applied'||operation.result.state!=='applied'||operation.result.targetAgentId!==binding.agentId||operation.requestHash!==owner.requestHash||operation.fixedAckBytes!==owner.ackBytes||!current||current.status==='closed'||current.resourcesReleased)throw Error('SOL_PI_DESKTOP_MANAGED_SUPERVISION_STALE');
  }
  inspectManagedFollowupPreparation(preparation:unknown):Readonly<ManagedCompoundFollowupFacts> {
    const entry=preparation&&typeof preparation==='object'?this.managedFollowupPreparations.get(preparation):undefined;
    if(!entry||entry.phase==='cancelled')throw Error('SOL_PI_DESKTOP_FOLLOWUP_PREPARATION');
    this.assertManagedResourceCurrent(entry.facts.admission);
    const operation=this.options.store.getOperation(entry.group.id,entry.facts.operationId),reservation=operation?.managedTurnReservation;
    if(!operation||operation.requestHash!==entry.requestHash||operation.followupInput?.targetId!==entry.child.id||operation.followupInput.message.trim()!==entry.facts.message||!reservation||reservation.nextTurnId!==entry.facts.nextTurnId||reservation.previousTurnId!==entry.facts.previousTurnId||reservation.agentId!==entry.child.id||reservation.rootEpoch!==entry.facts.rootEpoch||reservation.messageHash!==createHash('sha256').update(entry.facts.message).digest('hex')||reservation.closureHash!==createHash('sha256').update(JSON.stringify(entry.facts.closure??null)).digest('hex')||entry.phase==='prepared'&&(entry.child.context!==entry.oldContext||entry.child.followups[0]!==entry.pending||entry.pending.controller.signal.aborted))throw Error('SOL_PI_DESKTOP_FOLLOWUP_STALE');
    if(!isDeepStrictEqual(entry.facts.childSession.getProtectedObservationClosure(),entry.facts.closure))throw Error('SOL_PI_DESKTOP_FOLLOWUP_CLOSURE_CHANGED');
    return Object.freeze({...entry.facts,closure:structuredClone(entry.facts.closure)});
  }
  inspectManagedFollowupApplied(receipt:unknown) {
    const known=receipt&&typeof receipt==='object'?this.managedFollowupReceipts.get(receipt):undefined;
    const entry=known&&this.managedFollowupPreparations.get(known.preparation);
    if(!known||known.kind!=='applied'||!entry||entry.phase!=='applied'||!entry.appliedDigest)throw Error('SOL_PI_DESKTOP_FOLLOWUP_RECEIPT');
    this.inspectManagedFollowupPreparation(known.preparation);
    const operation=this.options.store.getOperation(entry.group.id,entry.facts.operationId);
    if(operation?.result.state!=='applied'||operation.applyState!=='applied'||entry.child.context.turnId!==entry.facts.nextTurnId)throw Error('SOL_PI_DESKTOP_FOLLOWUP_RECEIPT');
    return Object.freeze({preparation:known.preparation,operationId:entry.facts.operationId,nextTurnId:entry.facts.nextTurnId,appliedDigest:entry.appliedDigest});
  }
  inspectManagedFollowupCancelled(receipt:unknown) {
    const known=receipt&&typeof receipt==='object'?this.managedFollowupReceipts.get(receipt):undefined;
    const entry=known&&this.managedFollowupPreparations.get(known.preparation);
    if(!known||known.kind!=='cancelled'||!entry||entry.phase!=='cancelled'||!entry.cancelledDigest)throw Error('SOL_PI_DESKTOP_FOLLOWUP_RECEIPT');
    const operation=this.options.store.getOperation(entry.group.id,entry.facts.operationId);
    if(operation?.result.outcome!=='cancelled'||operation.managedTurnReservation?.nextTurnId!==entry.facts.nextTurnId)throw Error('SOL_PI_DESKTOP_FOLLOWUP_RECEIPT');
    return Object.freeze({preparation:known.preparation,operationId:entry.facts.operationId,nextTurnId:entry.facts.nextTurnId,cancelledDigest:entry.cancelledDigest});
  }
  inspectManagedResourcesReleased(receipt:unknown):Readonly<{admission:ManagedCompoundAdmission;closedSnapshotDigest:string}> {
    const facts=receipt&&typeof receipt==='object'?this.managedReleaseReceipts.get(receipt):undefined;
    if(!facts)throw Error('SOL_PI_DESKTOP_MANAGED_RESOURCE_RECEIPT_INVALID');return facts;
  }
  private publishManagedResources(groupId:string):void {
    for(const owner of this.managedReleaseOwners.values()){
      const binding=getManagedCompoundAdmissionBinding(owner.admission);
      if(binding.groupId!==groupId||owner.delivered||owner.pending||!owner.physical)continue;
      if(!owner.receipt){
        const actor=this.options.store.getAgent(groupId,binding.agentId);
        if(this.groups.get(groupId)!==owner.group||owner.group.children.get(binding.agentId)!==owner.child||owner.child.context.rootEpoch!==binding.rootEpoch||!actor||!(actor.status==='closed'||owner.physical&&['failed','interrupted'].includes(actor.status))||actor.executionActive||actor.sessionResident||actor.runtimeResident||!actor.resourcesReleased||actor.cleanupPending)continue;
        if(owner.physical){
          const actual=owner.physical.core.inspectPhysicalCloseWitness(owner.physical.witness);
          if(owner.group.core!==owner.physical.core||actual.id!==owner.child.id||actual.turn!==actor.turn||owner.child.context.turn!==actual.turn)continue;
        }
        const receipt=Object.freeze({});owner.receipt=receipt;
        this.managedReleaseReceipts.set(receipt,Object.freeze({admission:owner.admission,closedSnapshotDigest:createHash('sha256').update(JSON.stringify(actor)).digest('hex')}));
      }
      const receipt=owner.receipt;
      let resolve!:()=>void,reject!:(error:unknown)=>void;
      owner.pending=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
      // Background subscriptions observe separately; the original promise keeps rejection sticky.
      void owner.pending.catch(()=>{});
      void Promise.resolve().then(()=>owner.notify(receipt)).then(()=>{
        owner.delivered=true;this.completedManagedReleaseOwners.set(owner.child,owner);
        if(this.managedReleaseOwners.get(binding.agentId)===owner)this.managedReleaseOwners.delete(binding.agentId);
        resolve();
      },reject);
    }
  }

  private async completeCorePhysicalPublication(group:LiveGroup,core:MultiAgentCoordinator,witness:object):Promise<void> {
    const owner=await group.commands.run(()=>{
      const snapshot=core.inspectPhysicalCloseWitness(witness);
      if(this.groups.get(group.id)!==group||group.core!==core)throw Error('SOL_PI_DESKTOP_PHYSICAL_CLOSE_STALE');
      const child=group.children.get(snapshot.id);
      if(!child||child.context.turn!==snapshot.turn)throw Error('SOL_PI_DESKTOP_PHYSICAL_CLOSE_STALE');
      const release=this.managedReleaseOwners.get(child.id)??this.completedManagedReleaseOwners.get(child);
      if(release){
        const binding=getManagedCompoundAdmissionBinding(release.admission);
        const operation=this.options.store.getOperation(group.id,binding.operationId);
        if(release.group!==group||release.child!==child||binding.groupId!==group.id||binding.agentId!==child.id
          ||binding.rootEpoch!==child.context.rootEpoch||!operation||operation.command!=='spawn'||operation.applyState!=='applied'
          ||operation.result.state!=='applied'||operation.result.targetAgentId!==child.id||operation.requestHash!==release.requestHash
          ||operation.fixedAckBytes!==release.ackBytes
          ||release.parentSession.exportSnapshot().sessionId!==binding.parentSessionId
          ||release.childSessionId!==binding.childSessionId||release.nativeInvocationId!==binding.parentOperationId)
          throw Error('SOL_PI_DESKTOP_MANAGED_RESOURCE_RECEIPT_INVALID');
      }
      this.options.store.transaction(()=>this.persistCoreSnapshot(group,snapshot));
      if(release)release.physical={core,witness};
      return release;
    });
    // Never await publication inside the SQLite callback or this group's command queue.
    if(!owner)return;
    this.publishManagedResources(group.id);
    if(!owner.pending)throw Error('SOL_PI_DESKTOP_PHYSICAL_PUBLICATION_UNCONFIRMED');
    await owner.pending;
    if(!owner.delivered||this.completedManagedReleaseOwners.get(owner.child)!==owner)
      throw Error('SOL_PI_DESKTOP_PHYSICAL_PUBLICATION_UNCONFIRMED');
  }

  getFixedObservationAck(value:unknown):string|undefined {
    return value&&typeof value==='object'?this.fixedObservationAcks.get(value):undefined;
  }

  getObservationExecutionOwner(actor: DesktopAgentActor): ObservationSessionOwner {
    const state = this.requireActor(actor, 'agent');
    const owner = state.context.agentId === `root_${state.group.id}` ? this.observationOwners.get(state.group.id)?.owner.deref() : this.observationChildOwners.get(state.context.agentId);
    if (!owner) throw Error('SOL_PI_DESKTOP_OBSERVATION_OWNER_UNKNOWN');
    getObservationSessionOwnerHostBinding(owner); return owner;
  }

  /** Persistence of an already authorized message can outlive a recipient turn.
   * This does not return a live execution context or authorize a new tool. */
  assertObservationChildPersistence(preparation:DesktopObservationChildPreparation,admission?:ManagedCompoundAdmission):void {
    const entry=this.observationChildPreparations.get(preparation);
    if(!entry||this.groups.get(entry.group.id)!==entry.group||entry.group.children.get(entry.child.id)!==entry.child)throw Error('SOL_PI_DESKTOP_CHILD_PREPARATION_STALE');
    const resource=this.managedReleaseOwners.get(entry.child.id);
    if(admission&&(!resource||resource.admission!==admission||resource.child!==entry.child))throw Error('SOL_PI_DESKTOP_MANAGED_SUPERVISION_STALE');
    if(entry.active){this.assertObservationChildPreparation(preparation);return;}
    if(!admission)throw Error('SOL_PI_DESKTOP_MANAGED_SUPERVISION_STALE');
    this.assertManagedResourceCurrent(admission);
  }

  getObservationChildContext(preparation: DesktopObservationChildPreparation): DesktopAgentExecutionContext {
    const entry=this.observationChildPreparations.get(preparation);
    if(!entry||this.groups.get(entry.group.id)!==entry.group||entry.group.children.get(entry.child.id)!==entry.child)throw Error('SOL_PI_DESKTOP_CHILD_PREPARATION_STALE');
    if(entry.active)this.assertObservationChildPreparation(preparation);
    else this.requireActor(entry.child.context.actor,'agent',entry.child.context);
    return entry.child.context;
  }

  /** Host-only preparation identity. It never authorizes an agent tool, list or preview. */
  assertObservationChildPreparation(preparation: DesktopObservationChildPreparation) {
    const entry = this.observationChildPreparations.get(preparation);
    if (!entry?.active || this.groups.get(entry.group.id) !== entry.group || entry.group.children.get(entry.child.id) !== entry.child
      || !this.actors.get(entry.child.context.actor)?.preparing || !this.observationResources.has(entry.group.id))
      throw Error('SOL_PI_DESKTOP_CHILD_PREPARATION_STALE');
    entry.child.context.signal.throwIfAborted(); this.assertWritable(entry.group);
    this.assertExecutionAuthorization(entry.child.context.permissionRevision);
    const sourceOwner = entry.parent.agentId === `root_${entry.group.id}` ? this.observationOwners.get(entry.group.id)?.owner.deref()
      : this.observationChildOwners.get(entry.parent.agentId);
    if (!sourceOwner) throw Error('SOL_PI_DESKTOP_CHILD_SOURCE_UNKNOWN');
    getObservationSessionOwnerHostBinding(sourceOwner);
    return Object.freeze({ sourceOwner, context: entry.child.context, parent: entry.parent, operationId: entry.operationId, message: entry.message, ackBytes: entry.ackBytes! });
  }

  private async spawnObservation(input: AgentRequest & { taskName: string; message: string; sessionSeed?: DesktopAgentSessionSeed }, state: ActorState): Promise<MultiAgentControlResult> {
    const group = state.group, prepareSession = this.options.prepareObservationSession;
    if (!prepareSession) throw Error('SOL_PI_DESKTOP_CHILD_FACTORY_NOT_READY');
    let preparedSession: DesktopPreparedObservationSession | undefined;
    const staged = await group.commands.run(() => {
      this.requireActor(input.actor, input.requestSource); this.validateText(input.message);
      if (!/^[a-z0-9_]{1,64}$/.test(input.taskName)) throw Error('invalid task_name');
      const requestHash = this.requestHash(input.operationId, { command: 'spawn', actor: input.actor, taskName: input.taskName, message: input.message, seedId: input.sessionSeed?.seedId });
      const previous = this.persistenceIO(group, () => this.options.store.getOperation(group.id, input.operationId));
      if (previous) { if (previous.requestHash !== requestHash) throw Error('operation_id_conflict'); const result=previous.result as unknown as MultiAgentControlResult;if(previous.applyState==='applied'&&result.state==='applied'&&previous.fixedAckBytes)this.fixedObservationAcks.set(result,previous.fixedAckBytes);return { previous: result }; }
      if (this.slots.size >= MAX_RESIDENT_CHILDREN) throw Error('multi_agent_capacity_exceeded');
      const ticket = state.context.memberTicket.retain(); let prepared: PreparedAgentHandle | undefined; let reservedChild: LiveChild | undefined;
      try {
        this.options.store.putOperation({ groupId: group.id, operationId: input.operationId, command: 'spawn', requestHash,
          applyState: 'prepared', result: { operationId: input.operationId, state: 'unknown', preparation: 'observation', bootId: this.options.store.bootId } });
        prepared = group.core.prepareSpawn({ requestSource: 'agent', callerId: this.coreId(group, state.context.agentId), taskName: input.taskName, message: input.message,
          createSession: async identity => {
            if (!preparedSession || identity.id !== prepared!.agentId) throw Error('SOL_PI_DESKTOP_CHILD_NOT_PREPARED');
            const current = group.children.get(identity.id)!; this.requireActor(current.context.actor, 'agent'); current.sessionResident = true;
            const session = preparedSession.session;
            return { run: async (message, signal, activity) => {
              const context = current.context; await this.recordRunStarted(context, message);
              const result = await session.run(message, signal, activity); if (current.context === context) current.fullResult = result; return result;
            }, ...(session.suspend ? { suspend: () => session.suspend!() } : {}), ...(session.deactivate ? { deactivate: () => session.deactivate!() } : {}),
              dispose: () => this.closeManagedSession(group,current,()=>session.dispose()) };
          } });
        const controller = new AbortController(), context = this.createContext(group, prepared.agentId, randomUUID(), prepared.expectedTurn, ticket, controller.signal);
        this.actors.get(context.actor)!.preparing = true;
        const child: LiveChild = { id: prepared.agentId, parentId: state.context.agentId, context, prepared, sessionResident: false, stopRequested: false, controller, followups: [] };
        reservedChild=child;group.children.set(child.id, child); this.slots.add(child.id);
        const preparation = Object.freeze(Object.create(null)) as DesktopObservationChildPreparation;
        this.observationChildPreparations.set(preparation, { group, child, parent: state.context, operationId: input.operationId, requestHash, message: input.message, active: true });
        // Persist only the reserved identity. A restart retains unknown and never recreates a session from text absence.
        this.options.store.putOperation({ groupId: group.id, operationId: input.operationId, command: 'spawn', requestHash, applyState: 'prepared',
          result: { operationId: input.operationId, state: 'unknown', preparation: 'observation', bootId: this.options.store.bootId, targetAgentId: child.id, expectedTurn: prepared.expectedTurn } });
        const ordinal=this.options.store.reservePresentationOrdinal({groupId:group.id,operationId:input.operationId,requestHash,agentId:child.id});
        const ackBytes=JSON.stringify({operationId:input.operationId,state:'applied',targetAgentId:child.id,expectedTurn:prepared.expectedTurn,displayNames:agentDisplayNames(ordinal)});
        if(Buffer.byteLength(ackBytes)>8192)throw Error('fixed ACK capacity exceeded');
        this.options.store.putOperation({...this.options.store.getOperation(group.id,input.operationId)!,fixedAckBytes:ackBytes});
        this.observationChildPreparations.get(preparation)!.ackBytes=ackBytes;
        const parent = this.requireAgent(group.id, state.context.agentId);
        const identity: AgentIdentity = { id: child.id, taskName: prepared.snapshot.taskName, canonicalName: prepared.snapshot.canonicalName,
          parentId: this.coreId(group, state.context.agentId), parentCanonicalName: parent.canonicalName, depth: prepared.snapshot.depth };
        return { preparation, child, prepared, requestHash, identity, ticket };
      } catch (error) {
        // No callback/provider can have run before this short reservation finishes.
        // Persist failure still freezes the group: the disk may contain either row.
        try {
          if(prepared)group.core.rollbackPrepared(prepared);
          if(reservedChild){this.abortExecutionSignal(group, reservedChild.controller, error, reservedChild.context);const actor=this.actors.get(reservedChild.context.actor);if(actor)actor.active=false;group.children.delete(reservedChild.id);this.slots.delete(reservedChild.id);}
          ticket.release();
        } finally { this.freezeGroup(group,'multi_agent_preparation_persistence_unknown'); }
        throw error;
      }
    });
    if ('previous' in staged) return staged.previous!;
    const { preparation, child, prepared, requestHash, identity, ticket } = staged;
    let activationEntered = false, preparationDrained = true;
    try {
      // Deliberately outside commands: publication may itself require the same real journal sequencer.
      preparedSession = await prepareSession({ preparation, identity, parent: state.context, context: child.context,
        message: input.message, operationId: input.operationId, signal: child.context.signal, sessionSeed: input.sessionSeed });
      if (!(preparedSession.observationStore instanceof DesktopTaskObservationStore)) throw Error('SOL_PI_DESKTOP_CHILD_STORE_REQUIRED');
      const durable = await preparedSession.observationStore.loadSessionSnapshot(child.id);
      const native = getObservationSessionOwnerHostBinding(preparedSession.owner).session.exportSnapshot();
      if (!durable || durable.sessionId !== native.sessionId || !isDeepStrictEqual(durable.messages, native.messages)
        || !isDeepStrictEqual(durable.protectedObservationClosure, native.protectedObservationClosure)) throw Error('SOL_PI_DESKTOP_CHILD_DURABILITY_REQUIRED');
      return await group.commands.run(() => {
        const facts = this.assertObservationChildPreparation(preparation);
        this.requireActor(input.actor, input.requestSource);
        const target = getObservationSessionOwnerHostBinding(preparedSession!.owner);
        assertDelegatedObservationOwner(preparedSession!.owner, target.session, preparedSession!.registry);
        if (target.session.exportSnapshot().sessionId !== desktopObservationSessionId(child.id)) throw Error('SOL_PI_DESKTOP_CHILD_SESSION_MISMATCH');
        const publication = getObservationMessagePublicationBinding(preparedSession!.publication);
        if (publication.sourceOwner !== facts.sourceOwner || publication.recipientOwner !== preparedSession!.owner
          || publication.operationId !== input.operationId || publication.text !== input.message) throw Error('SOL_PI_DESKTOP_CHILD_PUBLICATION_MISMATCH');
        const result: MultiAgentControlResult = { operationId: input.operationId, state: 'applied', targetAgentId: child.id, expectedTurn: prepared.expectedTurn };
        publication.commit(input.operationId, input.message, () => this.options.store.transaction((acceptedPort) => {
          this.persistCoreSnapshot(group, prepared.snapshot, undefined, acceptedPort);
          acceptedPort.putOperation({ groupId: group.id, operationId: input.operationId, command: 'spawn', requestHash, applyState: 'applied', result: { ...result } });
        }));
        this.observationChildPreparations.get(preparation)!.active = false;
        this.actors.get(child.context.actor)!.preparing = false;
        this.observationChildOwners.set(child.id, preparedSession!.owner);
        activationEntered = true; child.execution = group.core.activatePreparedTurn(prepared, { signal: child.context.signal });
        this.fixedObservationAcks.set(result,facts.ackBytes);
        this.observeSettlement(group, child); return result;
      });
    } catch (error) {
      this.abortExecutionSignal(group, child.controller, error, child.context);
      if (activationEntered) {
        this.freezeGroup(group, 'multi_agent_activation_unknown');
        try {
          await group.core.closeAgent({requestSource:'user',callerId:'main',target:child.id});
          await preparedSession?.session.dispose();
        } catch { preparationDrained=false; }
        throw error;
      }
      this.observationChildPreparations.get(preparation)!.active = false;
      let cleanupFailed = false;
      try { preparedSession?.publication.dispose(); await preparedSession?.session.dispose(); }
      catch { cleanupFailed = true; preparationDrained=false; }
      finally { preparedSession?.owner.dispose(); }
      await group.commands.run(() => {
        this.actors.get(child.context.actor)!.active = false;
        if (cleanupFailed) { this.freezeGroup(group, 'multi_agent_preparation_cleanup_unknown'); return; }
        group.core.rollbackPrepared(prepared); this.slots.delete(child.id); group.children.delete(child.id); ticket.release();
        this.options.store.putOperation({ groupId: group.id, operationId: input.operationId, command: 'spawn', requestHash, applyState: 'applied',
          result: { operationId: input.operationId, state: 'completed', outcome: 'rejected', targetAgentId: child.id } }, true);
      });
      throw error;
    } finally { preparedSession?.publication.dispose(); if(preparationDrained)preparedSession?.releasePreparation?.(); }
  }

  async spawn(input: AgentRequest & { taskName: string; message: string; sessionSeed?: DesktopAgentSessionSeed }): Promise<MultiAgentControlResult> {
    const state = this.requireActor(input.actor, input.requestSource);
    if (this.observationResources.has(state.group.id)) {
      const pending = this.spawnObservation(input, state);
      const drain = pending.then(() => {}, () => {});
      this.observationPreparationDrains.add(drain);
      const groupDrains=this.groupObservationPreparationDrains.get(state.group)??new Set<Promise<void>>();
      this.groupObservationPreparationDrains.set(state.group,groupDrains);groupDrains.add(drain);
      void drain.then(() => {this.observationPreparationDrains.delete(drain);groupDrains.delete(drain);if(!groupDrains.size)this.groupObservationPreparationDrains.delete(state.group);});
      return pending;
    }
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
              dispose: () => this.closeManagedSession(group,child!,()=>session.dispose()),
            };
          } });
        const controller = new AbortController();
        const context = this.createContext(group, prepared.agentId, randomUUID(), prepared.expectedTurn, ticket, controller.signal,
          { sourceTaskId: state.context.sourceTaskId, activityRunId: state.context.activityRunId, activityMemberId: input.operationId });
        child = { id: prepared.agentId, parentId: state.context.agentId, context, prepared, sessionResident: false, stopRequested: false, controller, followups: [] };
        group.children.set(child.id, child); this.slots.add(child.id);
        const result: MultiAgentControlResult = { operationId: input.operationId, state: 'applied', targetAgentId: child.id, expectedTurn: prepared.expectedTurn };
        phase = 'apply';
        this.options.store.transaction((acceptedPort) => {
          this.persistCoreSnapshot(group, prepared!.snapshot, undefined, acceptedPort);
          acceptedPort.putOperation({ groupId: group.id, operationId: input.operationId, command: 'spawn', requestHash, applyState: 'applied', result: { ...result } });
          this.updateActivityMember(context, 'accepted', false, undefined, acceptedPort);
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

  private observationOwnerFor(group: LiveGroup, agentId: string): ObservationSessionOwner {
    const owner = agentId === `root_${group.id}` ? this.observationOwners.get(group.id)?.owner.deref() : this.observationChildOwners.get(agentId);
    if (!owner) throw Error('SOL_PI_DESKTOP_OBSERVATION_OWNER_UNKNOWN');
    getObservationSessionOwnerHostBinding(owner); return owner;
  }

  private async prepareProtectedMessage(state: ActorState, sourceId: string, recipientId: string, operationId: string, text: string) {
    if (!this.observationResources.has(state.group.id) || sourceId === recipientId) return undefined;
    const prepare = this.options.prepareObservationMessage;
    if (!prepare) throw Error('SOL_PI_DESKTOP_MESSAGE_FACTORY_REQUIRED');
    const sourceOwner = this.observationOwnerFor(state.group, sourceId), recipientOwner = this.observationOwnerFor(state.group, recipientId);
    const assertCurrent = () => {
      this.requireActor(state.context.actor, 'agent', state.context);
      if (this.observationOwnerFor(state.group, sourceId) !== sourceOwner || this.observationOwnerFor(state.group, recipientId) !== recipientOwner) throw Error('SOL_PI_DESKTOP_MESSAGE_PARTICIPANT_CHANGED');
    };
    assertCurrent();
    const publication = await prepare({ context: state.context, sourceOwner, recipientOwner, operationId, text, assertCurrent });
    try {
    assertCurrent();
    const facts = getObservationMessagePublicationBinding(publication);
    if (facts.sourceOwner !== sourceOwner || facts.recipientOwner !== recipientOwner || facts.operationId !== operationId || facts.text !== text) { publication.dispose(); throw Error('SOL_PI_DESKTOP_MESSAGE_PUBLICATION_MISMATCH'); }
    return facts;
    } catch(error) { publication.dispose(); throw error; }
  }

  private publishedMessageDigest(message:MultiAgentMessage):string {
    const {groupId,messageId,sender,receiverId,kind,preview,contentId,truncated,createdAt,bodyUnavailable}=message;
    return createHash('sha256').update(encodeMultiAgentRow({groupId,messageId,sender,receiverId,kind,preview,contentId,truncated,createdAt,bodyUnavailable})).digest('hex');
  }
  /** Called only in the original message writer transaction after actual source
   * publication, before the row and its exact closure become visible together. */
  private recordPublishedMessage(group:LiveGroup,message:MultiAgentMessage,preparedAnchor?:PublishedClosureReadAnchor, acceptedPort?: DesktopMultiAgentMutationPort):void {
    if(!this.observationResources.has(group.id)||message.sender.kind!=='agent'||message.sender.agentId===message.receiverId)return;
    const source=this.observationOwnerFor(group,message.sender.agentId),recipient=this.observationOwnerFor(group,message.receiverId);
    const anchor=preparedAnchor??capturePublishedClosureRead(source,recipient),facts=getPublishedClosureReadBinding(anchor).facts;
    const operationId=`published_message:${message.messageId}`,digest=this.publishedMessageDigest(message);
    if((acceptedPort ?? this.options.store).getOperation(group.id,operationId))throw Error('SOL_PI_MESSAGE_ANCHOR_ALREADY_EXISTS');
    (acceptedPort ?? this.options.store).putOperation({groupId:group.id,operationId,command:'published_message',requestHash:digest,applyState:'applied',result:{messageId:message.messageId,messageSeq:(acceptedPort ?? this.options.store).getGroup(group.id)!.lastSeq,facts}},true);
  }
  private protectPublishedMailbox(state:ActorState,messages:readonly MultiAgentMessage[]):PublishedClosureReadAnchor[]|undefined {
    if(!this.observationResources.has(state.group.id))return [];
    const anchors:PublishedClosureReadAnchor[]=[];
    for(const message of messages){
      if(message.sender.kind!=='agent'||message.sender.agentId===state.context.agentId)continue;
      const row=this.options.store.getOperation(state.group.id,`published_message:${message.messageId}`);
      if(!row)return undefined; // Legacy rows retain their existing complete authorization path.
      const durable=this.options.store.listMessages(state.group.id,message.receiverId).find(item=>item.messageId===message.messageId);
      if(!durable||message.receiverId!==state.context.agentId||!['published_message','published_message_unavailable'].includes(row.command)||row.applyState!=='applied'||row.requestHash!==this.publishedMessageDigest(message)||row.requestHash!==this.publishedMessageDigest(durable)||row.result.messageId!==message.messageId||!Number.isSafeInteger(row.result.messageSeq))throw Error('SOL_PI_MESSAGE_ANCHOR_CHANGED');
      const event=this.options.store.readEvents(state.group.id,Number(row.result.messageSeq)-1,1)[0];
      if(!event||event.seq!==row.result.messageSeq||event.kind!=='message_sent'||this.publishedMessageDigest(event.payload.message as MultiAgentMessage)!==row.requestHash)throw Error('SOL_PI_MESSAGE_ANCHOR_EVENT_CHANGED');
      if(row.command==='published_message_unavailable'){if(!message.bodyUnavailable||message.preview!=='FINAL_CONTENT_NOT_PERSISTED'||row.result.bodyUnavailable!==true)throw Error('SOL_PI_MESSAGE_ANCHOR_CHANGED');continue;}
      const source=message.sender.agentId===`root_${state.group.id}`?this.observationOwners.get(state.group.id)?.owner.deref():this.observationChildOwners.get(message.sender.agentId);
      if(!source)throw Error('SOL_PI_DESKTOP_OBSERVATION_OWNER_UNKNOWN');
      anchors.push(restorePublishedClosureRead(source,this.observationOwnerFor(state.group,message.receiverId),row.result.facts as PublishedClosureReadFacts));
    }
    return anchors;
  }

  private async protectObservationRead<T>(state: ActorState, sourceIds: readonly string[], value: T): Promise<T> {
    if (!this.observationResources.has(state.group.id)) return value;
    const frozen = structuredClone(value), text = JSON.stringify(frozen);
    const retained: ObservationMessagePublication[] = [];
    const closedSources: {anchor:ObservationClosedReadAnchor;recipientOwner:ObservationSessionOwner}[]=[];
    try {
      for (const sourceId of new Set(sourceIds)) {
        if(sourceId!==state.context.agentId){
          const storedSource=this.requireAgent(state.group.id,sourceId);
          const sourceOwner=this.observationChildOwners.get(sourceId);
          if(storedSource.status==='closed' && !storedSource.executionActive && storedSource.resourcesReleased && sourceOwner){
            closedSources.push({anchor:getObservationClosedReadAnchor(sourceOwner),recipientOwner:this.observationOwnerFor(state.group,state.context.agentId)});
            continue;
          }
        }
        const operationId = randomUUID();
        const publication = await this.prepareProtectedMessage(state, sourceId, state.context.agentId, operationId, text);
        if (publication) { retained.push(publication); publication.commit(operationId, text, () => {}); }
      }
      return withPublishedObservationMessages(retained, () => { this.requireActor(state.context.actor, 'agent', state.context); return frozen; }, closedSources);
    } finally { for (const publication of retained) publication.dispose(); }
  }

  prepareManagedCancellation(context:DesktopAgentExecutionContext,kind:'close'|'interrupt',input:Readonly<{nativeInvocationId:string;finalInput:Readonly<Record<string,unknown>>}>):object{
    const state=this.requireActor(context.actor,'agent',context);
    if(Object.keys(input.finalInput).join(',')!=='target'||typeof input.finalInput.target!=='string'||typeof input.nativeInvocationId!=='string'||!input.nativeInvocationId)throw Error('SOL_PI_DESKTOP_CANCEL_INPUT');
    const target=this.resolveTarget(state,input.finalInput.target);this.assertDescendant(state,target);
    const children=[...state.group.children.values()].filter(child=>child.id===target.id||kind==='close'&&this.isDescendant(state.group,child.id,target.id));
    const members=children.map(child=>{const owner=this.managedReleaseOwners.get(child.id);if(!owner||owner.group!==state.group||owner.child!==child)throw Error('SOL_PI_DESKTOP_CANCEL_ADMISSION');return {child,context:child.context,turnId:child.context.turnId,admission:owner.admission};});
    if(!members.length)throw Error('SOL_PI_DESKTOP_CANCEL_ADMISSION');
    const ticket=Object.freeze(Object.create(null)) as object;
    this.cancellationTickets.set(ticket,{context,rootEpoch:context.rootEpoch,operationId:`${context.turnId}:${input.nativeInvocationId}`,kind,targetId:target.id,members,state:'prepared'});return ticket;
  }
  async runManagedCancellation(ticket:unknown,work:()=>Promise<string>):Promise<string>{
    const known=typeof ticket==='object'&&ticket?this.cancellationTickets.get(ticket):undefined;
    if(!known||known.state!=='prepared'||typeof work!=='function')throw Error('SOL_PI_DESKTOP_CANCEL_TICKET');
    known.state='running';
    try{const result=await this.cancellationScope.run(ticket as object,work);if((known.state as string)!=='consumed')throw Error('SOL_PI_DESKTOP_CANCEL_NOT_APPLIED');return result;}finally{known.state='spent';}
  }
  private consumeManagedCancellation(state:ActorState,input:AgentRequest,kind:'close'|'interrupt',targetId:string):void{
    const ticket=this.cancellationScope.getStore();if(!ticket)return;
    const known=this.cancellationTickets.get(ticket);
    if(!known||known.state!=='running'||known.context!==state.context||known.rootEpoch!==state.context.rootEpoch||known.operationId!==input.operationId||known.kind!==kind||known.targetId!==targetId)throw Error('SOL_PI_DESKTOP_CANCEL_STALE');
    const members=[...state.group.children.values()].filter(child=>child.id===targetId||kind==='close'&&this.isDescendant(state.group,child.id,targetId));
    if(members.length!==known.members.length||known.members.some(member=>!members.includes(member.child)||member.child.context!==member.context||member.context.turnId!==member.turnId||this.managedReleaseOwners.get(member.child.id)?.admission!==member.admission))throw Error('SOL_PI_DESKTOP_CANCEL_STALE');
    known.state='consumed';
  }

  inspectCommittedManagedMessage(context:DesktopAgentExecutionContext,input:Readonly<{nativeInvocationId:string;finalInput:Readonly<Record<string,unknown>>;result:string}>){
    const state=this.actors.get(context.actor);
    if(!state||state.context!==context||this.groups.get(context.groupId)!==state.group||typeof input.nativeInvocationId!=='string'||!input.nativeInvocationId)throw Error('SOL_PI_DESKTOP_MESSAGE_FACT_IDENTITY');
    const operationId=`${context.turnId}:${input.nativeInvocationId}`,operation=this.options.store.getOperation(state.group.id,operationId);
    if(!operation||operation.command!=='send'||operation.applyState!=='applied'||Object.keys(input.finalInput).sort().join(',')!=='message,target'||typeof input.finalInput.target!=='string'||typeof input.finalInput.message!=='string')throw Error('SOL_PI_DESKTOP_MESSAGE_FACT_UNKNOWN');
    this.validateText(input.finalInput.message);
    const target=this.resolveTarget(state,input.finalInput.target),requestHash=this.requestHash(operationId,{command:'send',actor:context.actor,payload:{target:target.id,message:input.finalInput.message}});
    if(operation.requestHash!==requestHash||operation.result.targetAgentId!==target.id||operation.result.operationId!==operationId||operation.result.state!=='applied')throw Error('SOL_PI_DESKTOP_MESSAGE_FACT_MISMATCH');
    const displayNames=agentDisplayNames(target.presentationOrdinal),expected={...operation.result,...(displayNames?{displayNames}:{})};
    if(!isDeepStrictEqual(JSON.parse(input.result),expected))throw Error('SOL_PI_DESKTOP_MESSAGE_FACT_RESULT');
    return Object.freeze({adapter:'desktop-service-metadata-v1' as const,kind:'send' as const,operationId,requestHash,resultHash:createHash('sha256').update(input.result).digest('hex'),groupId:state.group.id,actorId:context.agentId,epoch:context.rootEpoch});
  }

  inspectCommittedManagedFollowup(context:DesktopAgentExecutionContext,input:Readonly<{nativeInvocationId:string;finalInput:Readonly<Record<string,unknown>>;result:string}>){
    const state=this.actors.get(context.actor);
    if(!state||state.context!==context||this.groups.get(context.groupId)!==state.group||typeof input.nativeInvocationId!=='string'||!input.nativeInvocationId)throw Error('SOL_PI_DESKTOP_MESSAGE_FACT_IDENTITY');
    const operationId=`${context.turnId}:${input.nativeInvocationId}`,operation=this.options.store.getOperation(state.group.id,operationId);
    if(!operation||operation.command!=='followup'||!operation.followupAcceptedResult||Object.keys(input.finalInput).sort().join(',')!=='message,target'||typeof input.finalInput.target!=='string'||typeof input.finalInput.message!=='string')throw Error('SOL_PI_DESKTOP_MESSAGE_FACT_UNKNOWN');
    const target=this.resolveTarget(state,input.finalInput.target),requestHash=this.requestHash(operationId,{command:'followup',actor:context.actor,payload:{target:target.id,message:input.finalInput.message}}),accepted=operation.followupAcceptedResult;
    if(operation.requestHash!==requestHash||accepted.targetAgentId!==target.id||accepted.operationId!==operationId||accepted.state!=='queued_next_admission')throw Error('SOL_PI_DESKTOP_MESSAGE_FACT_MISMATCH');
    const displayNames=agentDisplayNames(target.presentationOrdinal),expected={...accepted,...(displayNames?{displayNames}:{})};
    if(!isDeepStrictEqual(JSON.parse(input.result),expected))throw Error('SOL_PI_DESKTOP_MESSAGE_FACT_RESULT');
    // Freeze the actual final wrapper bytes before reporting a committed metadata fact.
    this.options.store.putOperation({...operation,followupAckBytes:input.result});
    return Object.freeze({adapter:'desktop-service-metadata-v1' as const,kind:'followup' as const,operationId,requestHash,resultHash:createHash('sha256').update(input.result).digest('hex'),groupId:state.group.id,actorId:context.agentId,epoch:context.rootEpoch});
  }

  async send(input: AgentRequest & { target: string; message: string }): Promise<MultiAgentControlResult> {
    const state = this.requireActor(input.actor, input.requestSource);
    const targetId = this.resolveTarget(state, input.target).id;
    const publication = this.observationResources.has(state.group.id) ? await this.prepareProtectedMessage(state, state.context.agentId, targetId, input.operationId, input.message) : undefined;
    try { return await state.group.commands.run(() => {
      const commit = <T>(work: () => T): T => publication ? publication.commit(input.operationId, input.message, work) : work();
      return commit(() => {
      this.requireActor(input.actor, input.requestSource); this.validateText(input.message);
      const target = this.resolveTarget(state, input.target); if(target.id!==targetId)throw Error('SOL_PI_DESKTOP_MESSAGE_TARGET_CHANGED');
      if (target.status === 'closed') throw new Error('target is closed');
      return this.mutate(state.group, input, 'send', { target: target.id, message: input.message }, (acceptedPort) => {
        const message = acceptedPort.sendMessage(state.group.id, { sender: { kind: 'agent', agentId: state.context.agentId }, receiverId: target.id, text: input.message });
        this.recordPublishedMessage(state.group,message, undefined, acceptedPort);
        return { operationId: input.operationId, state: 'applied', targetAgentId: target.id, messageId: message.messageId };
      });
      });
    }); } finally { publication?.dispose(); }
  }

  async interrupt(input: AgentRequest & { target: string }): Promise<MultiAgentControlResult> {
    const state = this.requireActor(input.actor, input.requestSource);
    return state.group.commands.run(() => {
      this.requireActor(input.actor, input.requestSource);
      const target = this.resolveTarget(state, input.target); this.assertDescendant(state, target);
      this.consumeManagedCancellation(state,input,'interrupt',target.id);
      const existing = this.persistenceIO(state.group, () => this.options.store.getOperation(state.group.id, input.operationId));
      const result = this.mutate(state.group, input, 'interrupt', { target: target.id }, (acceptedPort) => {
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

  runManagedFollowupInvocation(context:DesktopAgentExecutionContext,nativeInvocationId:string,work:()=>Promise<string>):Promise<string> {
    this.assertInvocation(context.actor,context);
    if(!this.observationResources.has(context.groupId))return work();
    if(typeof nativeInvocationId!=='string'||!nativeInvocationId||nativeInvocationId.length>256)throw Error('SOL_PI_DESKTOP_FOLLOWUP_INVOCATION');
    const owner=this.getObservationExecutionOwner(context.actor),session=getObservationSessionOwnerHostBinding(owner).session;
    return this.followupInvocationScope.run(Object.freeze({context,operationId:`${context.turnId}:${nativeInvocationId}`,origin:Object.freeze({session,nativeInvocationId})}),work);
  }

  async followup(input: AgentRequest & { target: string; message: string }): Promise<MultiAgentControlResult> {
    const state = this.requireActor(input.actor, input.requestSource);
    const invocation=this.followupInvocationScope.getStore();
    if(invocation&&(invocation.context!==state.context||invocation.operationId!==input.operationId))throw Error('SOL_PI_DESKTOP_FOLLOWUP_INVOCATION');
    const origin=invocation?.origin;
    const targetId = this.resolveTarget(state, input.target).id;
    if (this.managedReleaseOwners.has(targetId)&&!this.options.prepareObservationFollowup) throw Error('SOL_PI_MANAGED_FOLLOWUP_NOT_READY');
    const publication = this.observationResources.has(state.group.id) ? await this.prepareProtectedMessage(state, state.context.agentId, targetId, input.operationId, input.message) : undefined;
    try { return await state.group.commands.run(() => {
      const commit = <T>(work: () => T): T => publication ? publication.commit(input.operationId, input.message, work) : work();
      return commit(() => {
      this.requireActor(input.actor, input.requestSource); this.validateText(input.message);
      const target = this.resolveTarget(state, input.target); if(target.id!==targetId)throw Error('SOL_PI_DESKTOP_MESSAGE_TARGET_CHANGED'); this.assertDescendant(state, target);
      const child = state.group.children.get(target.id);
      if (this.managedReleaseOwners.has(target.id)&&!this.options.prepareObservationFollowup) throw Error('SOL_PI_MANAGED_FOLLOWUP_NOT_READY');
      if (!child || !target.resumable || target.cleanupError || child.stopRequested && child.execution) throw new Error('agent is not resumable');
      const existing = this.persistenceIO(state.group, () => this.options.store.getOperation(state.group.id, input.operationId));
      if (child.followups.length >= 4 && !existing) throw new Error('multi_agent_followup_queue_full');
      const expectedTurn = child.context.turn + child.followups.length + 1;
      const result = this.mutate(state.group, input, 'followup', { target: target.id, message: input.message }, (acceptedPort) => {
        if (child.followups.some(pending => pending.requestSource === 'user')) return { operationId: input.operationId, state: 'completed', outcome: 'rejected', targetAgentId: target.id, error: 'multi_agent_followup_user_barrier' };
        if (state.context.activityRunId) acceptedPort.putActivityMember({ runId: state.context.activityRunId, groupId: state.group.id,
          memberId: input.operationId, operationId: input.operationId, agentId: target.id, state: 'accepted', physicalSettled: false });
        return { operationId: input.operationId, state: 'queued_next_admission', targetAgentId: target.id, expectedTurn };
      });
      if (existing || result.outcome === 'rejected') return result;
      clearTimeout(child.ttl);
      child.followups.push({ origin, operationId: input.operationId, callerId: state.context.agentId, message: input.message, expectedTurn,
        lane: state.context.memberTicket.lane,
        sourceTaskId: state.context.sourceTaskId,
        activityRunId: state.context.activityRunId, activityMemberId: input.operationId,
        acceptedEpoch: state.context.memberTicket.epoch,
        forceNewEpoch: false, controller: new AbortController(), requestSource: 'agent' });
      this.enqueueNextFollowup(state.group, child);
      return result;
      });
    }); } finally { publication?.dispose(); }
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
      if (result) return this.protectObservationRead(state, result.agents.map(agent=>agent.id), result);
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
    if (this.observationResources.has(state.group.id)) throw Error('SOL_PI_DESKTOP_PROTECTED_LIST_REQUIRES_PUBLICATION');
    return this.options.store.listAgents(state.group.id, input.cursor, undefined, undefined, query => this.persistenceIO(state.group, query));
  }

  async listForModel(input: { actor: DesktopAgentActor; requestSource: Source; cursor?: string }): Promise<MultiAgentPage<DesktopAgentSnapshot>> {
    const state=this.requireActor(input.actor,input.requestSource);
    const page=this.options.store.listAgents(state.group.id,input.cursor,undefined,undefined,query=>this.persistenceIO(state.group,query));
    return this.protectObservationRead(state,page.items.map(agent=>agent.id),page);
  }

  async close(input: AgentRequest & { target: string }): Promise<MultiAgentControlResult> {
    const state = this.requireActor(input.actor, input.requestSource);
    return state.group.commands.run(() => {
      this.requireActor(input.actor, input.requestSource);
      const target = this.resolveTarget(state, input.target); this.assertDescendant(state, target);
      this.consumeManagedCancellation(state,input,'close',target.id);
      const existing = this.persistenceIO(state.group, () => this.options.store.getOperation(state.group.id, input.operationId));
      const result = this.mutate(state.group, input, 'close', { target: target.id }, (acceptedPort) => ({
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
    if (this.failedObservationInitializationGroups.has(group)) return;
    // A registered native group session is still a live resource even when no
    // child exists. Root-turn completion must not discard its incarnation.
    if (this.observationResources.has(group.id)) return;
    const observationOwner = this.observationOwners.get(group.id)?.owner.deref();
    if (observationOwner) {
      try { getObservationSessionOwnerHostBinding(observationOwner); return; }
      catch { /* Revoked/closed owner no longer retains this live group. */ }
    }
    if (this.disposed || group.deactivating || group.frozen || group.root || group.lease && !group.lease.released
      || [...group.children.values()].some(child => child.execution || child.followups.length || !this.requireAgent(group.id, child.id).resourcesReleased)
      || this.options.store.resources(group.id).some(resource => !['released', 'retained_by_policy'].includes(resource.state))) return;
    if(this.observationResources.has(group.id)){void this.closeObservationResources(group).catch(()=>{this.runtimeBlockedReason='runtime_blocked';this.options.coordinator.block('runtime_blocked');});return;}
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
        this.options.store.transaction((acceptedPort) => {
          const operation = acceptedPort.getOperation(group.id, item.operationId);
          if (!operation) throw new Error('missing_followup_operation');
          if (operation.result.outcome === 'cancelled' && operation.result.messageId) return;
          let receiver = this.requireAgent(group.id, item.callerId);
          while (receiver.status === 'closed' && receiver.parentId) receiver = this.requireAgent(group.id, receiver.parentId);
          const message = receiver.status !== 'closed' ? acceptedPort.sendMessage(group.id, {
            sender: { kind: 'agent', agentId: child.id }, receiverId: receiver.id, kind: 'error',
            text: JSON.stringify({ code: 'followup_cancelled', agentId: child.id, operationId: item.operationId,
              expectedTurn: item.expectedTurn, reason: truncateMultiAgentText(reason.message, 512).text }),
          }, true) : undefined;
          acceptedPort.putOperation({ ...operation, result: { ...operation.result, state: 'completed', outcome: 'cancelled', messageId: message?.messageId } }, true);
          if (item.activityRunId && item.activityMemberId) {
            acceptedPort.putActivityMember({ runId: item.activityRunId, groupId: group.id, memberId: item.activityMemberId,
              operationId: item.activityMemberId, agentId: child.id, state: 'settled', physicalSettled: true, outcome: 'cancelled' });
            acceptedPort.finalizeActivityRun(item.activityRunId);
          }
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
    if (this.activityReconcileTimer) clearInterval(this.activityReconcileTimer);
    this.unsubscribeStore(); this.listeners.clear(); this.authorizationListeners.clear();
    this.dormant.clear();
    this.pendingResets.clear();
    this.uncertainOperations.clear();
    for (const group of this.groups.values()) {
      this.abortExecutionSignal(group, group.lifetime, new Error('app_shutdown')); group.root && this.abortExecutionSignal(group, group.root.controller, new Error('app_shutdown'));
      if (group.root && !group.root.started) (group.root.ticket ?? group.root.request?.ticket)?.release();
      clearTimeout(group.deadlineTimer);
      clearTimeout(group.root?.stopTimer);
      for (const activity of group.activities.values()) { clearTimeout(activity.publishTimer); clearTimeout(activity.checkpointTimer); }
      for (const [agentId, output] of group.outputs) { clearTimeout(output.timer); try { this.flushOutput(group, agentId); } catch { /* Preserve persisted shutdown history. */ } }
      this.abortExecutionSignal(group, group.lifetime, new Error('app_shutdown'));
      group.root && this.abortExecutionSignal(group, group.root.controller, new Error('app_shutdown'));
      if (group.root && !group.root.started) group.root.ticket?.release();
      for (const child of group.children.values()) {
        clearTimeout(child.ttl); clearTimeout(child.stopTimer); this.abortExecutionSignal(group, child.controller, new Error('app_shutdown'), child.context);
        for (const pending of child.followups) { pending.controller.abort(new Error('app_shutdown')); pending.ticket?.release(); }
      }
    }
    // A prepared actor is not adopted by core yet. Its real factory and cleanup
    // must finish before the archive authority or OS resources are closed.
    await Promise.all([...this.groups.values()].flatMap(group => group.root ? [closeDesktopModelPhysicalScope(group.root.modelPhysicalScope, group.root.controller.signal.reason)] : []));
    await Promise.all([...this.observationPreparationDrains]);
    await Promise.all([...this.groups.values()].map(group => group.core.dispose()));
    for(const group of this.groups.values())this.publishManagedResources(group.id);
    await Promise.all([...this.managedReleaseOwners.values()].flatMap(owner=>owner.pending?[owner.pending]:[]));
    this.unsubscribeManagedResources();
    await Promise.all([...this.observationResources.keys()].map(id=>{const group=this.groups.get(id);if(!group)throw Error('SOL_PI_GROUP_RESOURCE_IDENTITY_LOST');return this.closeObservationResources(group);}));
    await Promise.all([...this.managedFinalDrains]);
    if(this.managedFinalPublications.size)throw Error('SOL_PI_MANAGED_FINAL_PUBLICATION_UNCONFIRMED');
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
    const core:MultiAgentCoordinator = new MultiAgentCoordinator({ executionMode: 'externally_activated', maxResidentAgents: MAX_RESIDENT_CHILDREN + 1, maxDepth: 3, maxMessageChars: 16 * 1024,
      idleTimeoutMs: 0, turnTimeoutMs: 0,
      closeSettlementTimeoutMs: this.grace, onEvent: event => this.captureCoreEvent(group, event),
      onPhysicalResourcesClosed: witness => this.completeCorePhysicalPublication(group,core,witness) });
    group.core=core;
    this.groups.set(groupId, group); return group;
  }

  private createContext(group: LiveGroup, agentId: string, turnId: string, turn: number, memberTicket: ExecutionLease, signal?: AbortSignal,
    provenance?: { sourceTaskId: string | undefined; resourceRootEpoch?:number; activityRunId?: string; activityMemberId?: string }): DesktopAgentExecutionContext {
    const actor = Object.freeze({ groupId: group.id, agentId, turnId });
    const combined = AbortSignal.any([group.lifetime.signal, group.leaseController!.signal, ...(signal ? [signal] : [])]);
    const context: DesktopAgentExecutionContext = { actor, groupId: group.id, agentId, turnId, turn,
      permissionRevision: this.options.store.requireGroup(group.id).permissionRevision ?? 0,
      // A queued turn's accepted origin is independent of whichever root is now
      // active or prepared. Explicit unknown provenance must remain unknown.
      sourceTaskId: provenance ? provenance.sourceTaskId : group.root?.binding.sourceTaskId ?? this.options.store.getAgent(group.id, agentId)?.sourceTaskId,
      activityRunId: provenance?.activityRunId,
      activityMemberId: provenance?.activityMemberId,
      rootEpoch: provenance?.resourceRootEpoch ?? group.root?.binding.rootEpoch ?? this.options.store.requireGroup(group.id).currentRootEpoch,
      memberTicket, signal: combined, effectiveDeadline: memberTicket.deadlineAt ?? Number.POSITIVE_INFINITY,
      cwd: group.children.get(agentId)?.cwd ?? this.options.store.getThread(this.options.store.requireGroup(group.id).threadId)!.cwd,
      mailbox: undefined as unknown as DesktopMailboxPort,
    };
    Object.defineProperty(context, 'permissionRevision', { writable: false, configurable: false });
    const state: ActorState = { context, group, active: true, sealed: false };
    this.actors.set(actor, state);
    const nativeMailbox = new DesktopMultiAgentTurnMailbox({ store: this.options.store, groupId: group.id, agentId, turnId, commands: group.commands,
      assertSemanticCurrent: () => { context.signal.throwIfAborted(); this.assertInvocation(actor, context); },
      beforeSeal: () => { this.flushOutput(group, agentId); this.finishActivity(group, agentId); },
      assertCurrent: () => {
        const current = agentId === `root_${group.id}` ? group.root?.context : group.children.get(agentId)?.context;
        if (current !== context || this.disposed) throw new Error('stale multi-agent authority');
      },
      onSeal: (outcome, acceptedPort) => {
        const old = this.requireAgent(group.id, agentId);
        // Cancellation/close may win after the last signal check but before this
        // queued seal. Never let a late pure-text response undo that decision.
        const resultStatus = TERMINAL.has(old.status) ? old.status : context.signal.aborted && outcome === 'completed' ? 'interrupted' : outcome;
        const agent = acceptedPort.putAgent(group.id, { ...old, status: resultStatus, endedAt: Date.now(),
          ...(old.toolsCompleted !== undefined ? { toolStatisticsComplete: resultStatus === 'completed' && !group.frozen && !context.signal.aborted } : {}) }, true);
        acceptedPort.appendEvent(group.id, { kind: 'status', agentId, turnId, payload: { agent } });
        if (group.root?.context === context) {
          const binding = acceptedPort.getRootBinding(group.root.binding.sourceTaskId) ?? group.root.binding;
          group.root.binding = { ...binding, phase: binding.phase === 'abandoned' ? 'abandoned' : 'settled', status: resultStatus };
          acceptedPort.putRootBinding(group.root.binding, true);
        }
        state.sealed = true;
        state.outcome = resultStatus;
        this.wake(group);
      },
    });
    context.mailbox = {
      drainInput: async () => {
        const batch = await nativeMailbox.drainInput();
        try {
          const anchors=this.protectPublishedMailbox(state,batch.messages);
          if(anchors)return withPublishedObservationMessages([],()=>{this.requireActor(state.context.actor,'agent',state.context);return batch;},[],anchors);
          return await this.protectObservationRead(state,batch.messages.flatMap(message=>message.sender.kind==='agent'?[message.sender.agentId]:[]),batch);
        } catch(error) { if(batch.claimId)await nativeMailbox.returnClaim(batch.claimId);throw error; }
      },
      confirmApplied: claimId=>nativeMailbox.confirmApplied(claimId),
      returnClaim: claimId=>nativeMailbox.returnClaim(claimId),
      trySealTurn: input=>nativeMailbox.trySealTurn(input),
    };
    bindDesktopMailboxSemanticAlias(context.mailbox, nativeMailbox);
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
          this.options.store.transaction((acceptedPort) => {
            const binding = acceptedPort.getRootBinding(activeRoot.binding.sourceTaskId)!;
            acceptedPort.putRootBinding({ ...binding, phase: 'abandoned', status: 'interrupted' }, true);
            const before = this.requireAgent(group.id, `root_${group.id}`);
            const agent = acceptedPort.putAgent(group.id, { ...before, status: 'interrupted', stopState: 'requested' }, true);
            acceptedPort.appendEvent(group.id, { kind: 'status', agentId: agent.id, turnId: agent.turnId, payload: { agent } });
          });
        } catch { failed = true; }
        this.abortExecutionSignal(group, activeRoot.controller, reason, activeRoot.context); this.markRootStopping(group, activeRoot);
      }
      if(group.leaseController)this.abortExecutionSignal(group, group.leaseController, reason);
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

  async registerManagedFinalPublication(context:DesktopAgentExecutionContext,ticket:CompoundFinalPublicationTicket,notify:(receipt:unknown)=>Promise<void>):Promise<void>{
    const facts=getCompoundFinalPublicationBinding(ticket),actor=this.actors.get(context.actor);
    if(!actor||actor.context!==context||this.groups.get(context.groupId)!==actor.group)throw Error('SOL_PI_MANAGED_FINAL_PUBLICATION_BINDING');
    const group=actor.group,child=group.children.get(context.agentId);
    if(!child||child.context!==context||!child.execution||facts.role!=='child'||facts.turnId!==context.turnId||this.managedFinalPublications.has(child)||typeof notify!=='function')throw Error('SOL_PI_MANAGED_FINAL_PUBLICATION_BINDING');
    const owner=this.observationChildOwners.get(child.id);
    if(!owner||getObservationSessionOwnerHostBinding(owner).session!==facts.session||facts.sessionId!==facts.session.exportSnapshot().sessionId)throw Error('SOL_PI_MANAGED_FINAL_PUBLICATION_BINDING');
    this.managedFinalPublications.set(child,{ticket,facts,group,child,context,execution:child.execution,notify,settled:false,publication:this.managedFinalCommittedFacts.get(context)});
  }
  inspectManagedFinalPublicationReceipt(receipt:unknown){
    const facts=receipt&&typeof receipt==='object'?this.managedFinalReceipts.get(receipt):undefined;
    if(!facts)throw Error('SOL_PI_MANAGED_FINAL_PUBLICATION_RECEIPT');return facts;
  }
  private recordManagedFinalPublication(group:LiveGroup,child:LiveChild):void{
    const context=child.context,entry=this.managedFinalPublications.get(child);
    const agent=this.options.store.getAgent(group.id,child.id),operationId=`child_result:${createHash('sha256').update(`${child.id}:${context.turnId}`).digest('hex')}`,operation=this.options.store.getOperation(group.id,operationId);
    if(!agent||agent.turn!==context.turn||!TERMINAL.has(agent.status)||!operation||operation.command!=='child_result'||operation.applyState!=='applied'||!TERMINAL.has(String(operation.result.status))||operation.requestHash!==this.requestHash(operationId,{agentId:child.id,turnId:context.turnId}))return;
    const publication={operationId,operationDigest:createHash('sha256').update(JSON.stringify(operation)).digest('hex'),snapshotRevision:this.options.store.requireGroup(group.id).lastSeq,status:agent.status};
    this.managedFinalCommittedFacts.set(context,publication);
    if(!entry||entry.group!==group||entry.context!==context)return;
    entry.publication=publication;
    this.finishManagedFinalPublication(entry);
  }
  private finishManagedFinalPublication(entry:ManagedFinalPublication):void{
    if(!entry.settled||!entry.publication||entry.pending)return;
    const {group,child,context,facts,publication}=entry;
    if(this.managedFinalPublications.get(child)!==entry||child.context!==context||this.groups.get(group.id)!==group)throw Error('SOL_PI_MANAGED_FINAL_PUBLICATION_STALE');
    const operation=this.options.store.getOperation(group.id,publication.operationId),agent=this.options.store.getAgent(group.id,child.id);
    if(!operation||createHash('sha256').update(JSON.stringify(operation)).digest('hex')!==publication.operationDigest||agent?.turn!==context.turn||agent.status!==publication.status||computeSessionHistoryDigest(facts.session.exportSnapshot())!==facts.historyDigest||facts.session.getPublishedHistoryBasis()!==facts.historyDigest)throw Error('SOL_PI_MANAGED_FINAL_PUBLICATION_STALE');
    const receipt=Object.freeze({});this.managedFinalReceipts.set(receipt,Object.freeze({ticket:entry.ticket,sessionId:facts.sessionId,turnId:facts.turnId,historyDigest:facts.historyDigest,snapshotRevision:publication.snapshotRevision}));
    const pending=Promise.resolve().then(()=>entry.notify(receipt));entry.pending=pending;this.managedFinalDrains.add(pending);
    void pending.then(()=>{this.managedFinalDrains.delete(pending);if(this.managedFinalPublications.get(child)===entry)this.managedFinalPublications.delete(child);},()=>{this.freezeGroup(group,'multi_agent_final_publication_unconfirmed');});
  }
  private observeSettlement(group: LiveGroup, child: LiveChild): void {
    const execution = child.execution!;
    void execution.settled.then(() => group.commands.run(() => {
      if (child.execution !== execution) return;
      const finalPublication=this.managedFinalPublications.get(child);
      if(finalPublication?.execution===execution){finalPublication.settled=true;this.finishManagedFinalPublication(finalPublication);}
      child.execution = undefined;
      clearTimeout(child.stopTimer);
      this.actors.get(child.context.actor)!.active = false;
      child.context.memberTicket.release(); this.clearReleasedLease(group);
      if (!this.disposed && !group.deactivating) {
        const snapshot = group.core.listAgents({ requestSource: 'user', callerId: 'main' }).find(agent => agent.id === child.id)!;
        this.persistCoreSnapshot(group, snapshot);
        this.updateActivityMember(child.context, 'settled', true, snapshot.status === 'completed' ? 'completed' : snapshot.status === 'failed' ? 'failed' : 'cancelled');
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

  private updateActivityMember(context: DesktopAgentExecutionContext, state: 'accepted' | 'running' | 'settled', physicalSettled: boolean,
    outcome?: 'completed' | 'failed' | 'cancelled', acceptedPort?: DesktopMultiAgentMutationPort): void {
    if (!context.activityRunId || !context.activityMemberId) return;
    const store = this.options.store;
    (acceptedPort ?? this.options.store).transaction((acceptedPort) => {
      acceptedPort.putActivityMember({ groupId: context.groupId, runId: context.activityRunId!, memberId: context.activityMemberId!,
        operationId: context.activityMemberId!, agentId: context.agentId, turnId: context.turnId, state, physicalSettled, ...(outcome ? { outcome } : {}) });
      acceptedPort.finalizeActivityRun(context.activityRunId!);
    });
  }

  private async closeIdleChild(group: LiveGroup, child: LiveChild): Promise<void> {
    await group.commands.run(() => {
      if (child.execution || child.followups.length || this.disposed) return;
      this.beginClose(group, child.id, 'ttl');
    }).catch(() => this.freezeGroup(group, 'multi_agent_cleanup_failed'));
  }

  private beginManagedFollowup(group:LiveGroup,child:LiveChild,pending:PendingFollowup,ticket:ExecutionLease):Promise<void> {
    const work=Promise.resolve().then(()=>this.activateManagedFollowup(group,child,pending,ticket));
    let owned=this.groupObservationPreparationDrains.get(group);if(!owned){owned=new Set();this.groupObservationPreparationDrains.set(group,owned);}
    this.observationPreparationDrains.add(work);owned.add(work);
    const release=()=>{this.observationPreparationDrains.delete(work);owned!.delete(work);};void work.then(release,release);
    return work;
  }

  private async activateManagedFollowup(group:LiveGroup,child:LiveChild,pending:PendingFollowup,ticket:ExecutionLease):Promise<void> {
    let preparation:object|undefined,installed:PreparedManagedCompoundFollowup|undefined,corePrepared:PreparedAgentHandle|undefined,applied=false;
    let publicationWindow:ReturnType<typeof openCompoundFollowupPublicationWindow>|undefined;
    try {
      const publicationOwner=this.observationChildOwners.get(child.id);
      if(!publicationOwner)throw Error('SOL_PI_DESKTOP_FOLLOWUP_SESSION_REQUIRED');
      publicationWindow=openCompoundFollowupPublicationWindow(publicationOwner,AbortSignal.any([pending.controller.signal,group.lifetime.signal]),child.context.effectiveDeadline,pending.origin);
      await publicationWindow.drained;
      preparation=await group.commands.run(()=>{
        const resource=this.managedReleaseOwners.get(child.id);
        if(!resource||resource.group!==group||resource.child!==child||!this.options.prepareObservationFollowup||pending.controller.signal.aborted||child.followups[0]!==pending||child.execution)throw Error('SOL_PI_DESKTOP_FOLLOWUP_STALE');
        this.assertManagedResourceCurrent(resource.admission);this.assertWritable(group);
        const owner=this.observationChildOwners.get(child.id);if(!owner)throw Error('SOL_PI_DESKTOP_FOLLOWUP_SESSION_REQUIRED');
        const session=getObservationSessionOwnerHostBinding(owner).session,closure=structuredClone(session.getProtectedObservationClosure()),message=pending.message.trim();
        const operation=this.options.store.getOperation(group.id,pending.operationId);if(!operation)throw Error('SOL_PI_DESKTOP_FOLLOWUP_OPERATION');
        const binding=getManagedCompoundAdmissionBinding(resource.admission);
        const reservation=this.options.store.reserveManagedFollowupTurn({groupId:group.id,operationId:pending.operationId,requestHash:operation.requestHash,agentId:child.id,previousTurnId:child.context.turnId,expectedTurn:pending.expectedTurn,rootEpoch:binding.rootEpoch,messageHash:createHash('sha256').update(message).digest('hex'),closureHash:createHash('sha256').update(JSON.stringify(closure??null)).digest('hex')});
        const token=Object.freeze({});
        this.managedFollowupPreparations.set(token,{facts:Object.freeze({admission:resource.admission,childSession:session,operationId:pending.operationId,previousTurnId:child.context.turnId,nextTurnId:reservation.nextTurnId,rootEpoch:binding.rootEpoch,message,closure,requestSource:pending.requestSource,...(pending.origin?{origin:pending.origin}:{})}),group,child,oldContext:child.context,pending,requestHash:operation.requestHash,phase:'prepared'});
        return token;
      });
      // Old runtime/provider/native drain can publish facts through the command queue.
      installed=await this.options.prepareObservationFollowup!(preparation);
      const receipt=await group.commands.run(()=>{
        const facts=this.inspectManagedFollowupPreparation(preparation),entry=this.managedFollowupPreparations.get(preparation!)!;
        this.assertWritable(group);if(child.execution||pending.controller.signal.aborted)throw Error('SOL_PI_DESKTOP_FOLLOWUP_STALE');
        this.installLease(group,ticket);
        corePrepared=group.core.prepareFollowup({requestSource:pending.requestSource,callerId:this.coreId(group,pending.callerId),target:child.id,message:facts.message});
        if(corePrepared.expectedTurn!==pending.expectedTurn)throw Error('followup turn mismatch');
        const controller=new AbortController(),context=this.createContext(group,child.id,facts.nextTurnId,corePrepared.expectedTurn,ticket,controller.signal,{sourceTaskId:pending.sourceTaskId,resourceRootEpoch:facts.rootEpoch,activityRunId:pending.activityRunId,activityMemberId:pending.activityMemberId});
        this.options.store.transaction((acceptedPort) => {
          this.persistCoreSnapshot(group,corePrepared!.snapshot, undefined, acceptedPort);
          const operation=acceptedPort.getOperation(group.id,pending.operationId)!;
          if(operation.requestHash!==entry.requestHash||operation.managedTurnReservation?.nextTurnId!==facts.nextTurnId)throw Error('SOL_PI_DESKTOP_FOLLOWUP_OPERATION');
          acceptedPort.putOperation({...operation,applyState:'applied',result:{...operation.result,state:'applied'}});
        });
        const oldActor=this.actors.get(child.context.actor);if(oldActor)oldActor.active=false;
        child.controller=controller;child.context=context;child.prepared=corePrepared;child.stopRequested=false;child.followups.shift();
        entry.phase='applied';entry.appliedDigest=createHash('sha256').update(JSON.stringify({operation:this.options.store.getOperation(group.id,pending.operationId),turnId:facts.nextTurnId,message:facts.message,closure:facts.closure})).digest('hex');applied=true;
        const token=Object.freeze({});this.managedFollowupReceipts.set(token,{preparation:preparation!,kind:'applied'});return token;
      });
      await installed.commitApplied(receipt);
      publicationWindow.prepareTurn(this.inspectManagedFollowupPreparation(preparation).nextTurnId);
      await group.commands.run(()=>{
        const facts=this.inspectManagedFollowupApplied(receipt);
        if(group.frozen||group.deactivating||child.context.turnId!==facts.nextTurnId||child.execution||!corePrepared)throw Error('SOL_PI_DESKTOP_FOLLOWUP_STALE');
        child.execution=group.core.activatePreparedTurn(corePrepared,{signal:child.context.signal});this.observeSettlement(group,child);
      });
    } catch(error) {
      let cancelledConfirmed=false;
      if(!applied){
        if(corePrepared)group.core.rollbackPrepared(corePrepared);
        if(preparation&&installed){
          try{const receipt=await group.commands.run(()=>{
            const entry=this.managedFollowupPreparations.get(preparation!)!,operation=this.options.store.getOperation(group.id,pending.operationId)!;
            this.options.store.putOperation({...operation,result:{...operation.result,state:'completed',outcome:'cancelled'}});
            entry.phase='cancelled';entry.cancelledDigest=createHash('sha256').update(JSON.stringify(this.options.store.getOperation(group.id,pending.operationId))).digest('hex');
            const token=Object.freeze({});this.managedFollowupReceipts.set(token,{preparation:preparation!,kind:'cancelled'});return token;
          });await installed.cancelBeforeApplied(receipt);cancelledConfirmed=true;}catch{/* Original prepared state remains unavailable for replay. */}
        }
        ticket.release();
        if(cancelledConfirmed&&pending.controller.signal.aborted){publicationWindow?.cancelBeforeActivation(error);return;}
      }
      publicationWindow?.fail(error);
      this.freezeGroup(group,'multi_agent_followup_admission_failed');throw error;
    }
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
      if(this.managedReleaseOwners.has(child.id))return this.beginManagedFollowup(group,child,pending,ticket);
      return group.commands.run(() => {
        // A grant may be delivered after cancellation already won this queue.
        // Its cancelled receipt is authoritative; this is not a storage failure.
        if (pending.controller.signal.aborted || child.followups[0] !== pending) { ticket.release(); return; }
        let prepared: PreparedAgentHandle | undefined;
        let activated = false;
        try {
          this.assertWritable(group, 'multi_agent_followup_admission_failed');
          if (this.managedReleaseOwners.has(child.id)) throw Error('SOL_PI_MANAGED_FOLLOWUP_NOT_READY');
          if (pending.controller.signal.aborted || child.followups[0] !== pending || child.execution) throw new Error('stale followup admission');
          this.installLease(group, ticket);
          prepared = group.core.prepareFollowup({ requestSource: pending.requestSource, callerId: this.coreId(group, pending.callerId), target: child.id, message: pending.message });
          if (prepared.expectedTurn !== pending.expectedTurn) throw new Error('followup turn mismatch');
          child.controller = new AbortController();
          child.context = this.createContext(group, child.id, randomUUID(), prepared.expectedTurn, ticket, child.controller.signal,
            { sourceTaskId: pending.sourceTaskId, activityRunId: pending.activityRunId, activityMemberId: pending.activityMemberId });
          child.prepared = prepared; child.stopRequested = false;
          this.options.store.transaction((acceptedPort) => {
            this.persistCoreSnapshot(group, prepared!.snapshot, undefined, acceptedPort);
            const operation = acceptedPort.getOperation(group.id, pending.operationId)!;
            acceptedPort.putOperation({ ...operation, result: { ...operation.result, state: 'applied' } });
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
    if (event.kind !== 'status' && event.kind !== 'activity') return;
    const captured = structuredClone(event);
    void group.commands.run(() => {
      if (this.disposed || group.deactivating) {
        const child=group.children.get(captured.agent.id);
        if(captured.kind==='status'&&child&&child.context.turn===captured.agent.turn&&TERMINAL.has(captured.agent.status)){
          // Factual finalization only: no new message, task, grant, or root status.
          this.options.store.transaction((acceptedPort) => {this.persistCoreSnapshot(group,captured.agent, undefined, acceptedPort);});
          this.recordManagedFinalPublication(group,child);
        }
        return;
      }
      const activeChild = group.children.get(captured.agent.id);
      if (activeChild && activeChild.context.turn !== captured.agent.turn) return;
      if (captured.kind === 'activity') {
        const child = group.children.get(captured.agent.id);
        if (child && child.context.turn === captured.agent.turn) this.applyActivity(group, child.id, child.context.turnId,
          { phase: captured.agent.phase ?? 'model', toolName: captured.agent.currentTool }, captured.agent.lastActivityAt ?? captured.timestamp);
        return;
      }
      if (TERMINAL.has(captured.agent.status)) this.finishActivity(group, captured.agent.id);
      this.options.store.transaction((acceptedPort) => {
        const child = group.children.get(captured.agent.id);
        const operationId = child ? `child_result:${createHash('sha256').update(`${child.id}:${child.context.turnId}`).digest('hex')}` : '';
        const publishResult = child && captured.agent.turn > 0 && TERMINAL.has(captured.agent.status)
          && !acceptedPort.getOperation(group.id, operationId);
        let parent:DesktopAgentSnapshot|undefined,resultAnchor:PublishedClosureReadAnchor|undefined,bodyUnavailable=false;
        if (publishResult) {
          parent = this.requireAgent(group.id, child.parentId);
          while (parent.status === 'closed' && parent.parentId) parent = this.requireAgent(group.id, parent.parentId);
          if (this.observationResources.has(group.id)) {
            try {
              if (parent.status === 'closed') throw Error('published_result_recipient_closed');
              resultAnchor = capturePublishedClosureRead(this.observationOwnerFor(group,child.id),this.observationOwnerFor(group,parent.id));
            } catch { bodyUnavailable = true; }
          }
        }
        // The first appended status event must already have the body decision.
        // A later putAgent cannot erase bytes in that immutable event.
        const agent = this.persistCoreSnapshot(group, captured.agent, resultAnchor, acceptedPort);
        if (agent.status === 'closed') acceptedPort.rerouteClosedHandoffs(group.id, agent.id);
        if (publishResult && child && parent) {
          const full = bodyUnavailable?'FINAL_CONTENT_NOT_PERSISTED':agent.status === 'completed' ? child.fullResult ?? captured.agent.lastResult ?? '' : captured.agent.error ?? `agent_${agent.status}`;
          const content = acceptedPort.putContent(group.id, child.id, full, true,bodyUnavailable?{status:agent.status}:undefined);
          const preview = truncateMultiAgentText(content.utf8Text, 8 * 1024);
          acceptedPort.putAgent(group.id, { ...agent, resultContentId: content.contentId,...(bodyUnavailable?{bodyUnavailable:true as const,lastResult:undefined,resultSummary:undefined,error:undefined}:{}) }, true);
          acceptedPort.appendEvent(group.id, { kind: 'result', agentId: child.id, turnId: child.context.turnId,
            payload: { contentId: content.contentId, preview: preview.text, truncated: preview.truncated || content.truncated,...(bodyUnavailable?{bodyUnavailable:true}:{}) } });
          if (parent.status !== 'closed') {const message=acceptedPort.sendMessage(group.id, {
            sender: { kind: 'agent', agentId: child.id }, receiverId: parent.id, kind: agent.status === 'completed' ? 'result' : 'error',
            text: preview.text || '(empty result)', contentId: content.contentId, truncated: preview.truncated || content.truncated,...(bodyUnavailable?{bodyUnavailable:true as const}:{}),
          }, true);if(bodyUnavailable)acceptedPort.putOperation({groupId:group.id,operationId:`published_message:${message.messageId}`,command:'published_message_unavailable',requestHash:this.publishedMessageDigest(message),applyState:'applied',result:{messageId:message.messageId,messageSeq:acceptedPort.getGroup(group.id)!.lastSeq,status:agent.status,bodyUnavailable:true}},true);else this.recordPublishedMessage(group,message,resultAnchor, acceptedPort);}
          acceptedPort.putOperation({ groupId: group.id, operationId, command: 'child_result',
            requestHash: this.requestHash(operationId, { agentId: child.id, turnId: child.context.turnId }), applyState: 'applied',
            result: { state: 'completed', status: agent.status, contentId: content.contentId,...(bodyUnavailable?{bodyUnavailable:true}:{}) } }, true);
        }
      });
      const child = group.children.get(captured.agent.id);
      if(child)this.recordManagedFinalPublication(group,child);
      // The result can be persisted while execution is still active. Notify only
      // after the later real core settlement, outside the successful transaction.
      const resource=this.observationResources.get(group.id);
      if(resource&&child&&captured.agent.status==='completed'&&!captured.agent.executionActive
        &&child.context.turn===captured.agent.turn&&child.semanticBoundaryTurnId!==child.context.turnId){
        const operationId=`child_result:${createHash('sha256').update(`${child.id}:${child.context.turnId}`).digest('hex')}`;
        const result=this.options.store.getOperation(group.id,operationId);
        if(result?.applyState==='applied'&&result.result.status==='completed'){
          resource.subtaskBoundaryPending=true;child.semanticBoundaryTurnId=child.context.turnId;
        }
      }
      if (child && TERMINAL.has(captured.agent.status)) child.fullResult = undefined;
      if (child && child.execution && captured.agent.executionActive && ['failed', 'interrupted', 'closed'].includes(captured.agent.status)) {
        try { this.cancelFollowups(group, child, new Error(captured.agent.error ?? 'multi_agent_stopped')); }
        finally { this.markStopping(group, child, new Error(captured.agent.error ?? 'multi_agent_stopped')); }
      }
      this.wake(group);
      this.maybeDormant(group);
    }).catch(() => this.freezeGroup(group, 'multi_agent_persistence_failed'));
  }

  private persistCoreSnapshot(group: LiveGroup, core: MultiAgentSnapshot, publishedResult?: PublishedClosureReadAnchor, acceptedPort?: DesktopMultiAgentMutationPort): DesktopAgentSnapshot {
    const child = group.children.get(core.id);
    const id = core.id === 'main' ? `root_${group.id}` : core.id;
    const previous = (acceptedPort ?? this.options.store).getAgent(group.id, id);
    if (previous && core.turn < previous.turn) return previous;
    const sameTurn = previous?.turn === core.turn;
    if (publishedResult) getPublishedClosureReadBinding(publishedResult).validate();
    const protectedTerminal = !!child && core.turn > 0 && TERMINAL.has(core.status) && this.observationResources.has(group.id);
    // Factual shutdown/cleanup snapshots can repeat an already published body,
    // but may never introduce later free text without its original publication.
    const priorBody = sameTurn && previous?.resultContentId && !previous.bodyUnavailable ? previous : undefined;
    const bodyProjection = protectedTerminal && !publishedResult
      ? priorBody ? { lastResult: priorBody.lastResult, resultSummary: priorBody.resultSummary, error: priorBody.error }
        : { bodyUnavailable: true as const, lastResult: undefined, resultSummary: undefined, error: undefined }
      : publishedResult ? { bodyUnavailable: undefined } : {};
    const diskPending = this.pendingResources(group.id, id);
    const agent = (acceptedPort ?? this.options.store).putAgent(group.id, {
      ...previous, ...core, id, parentId: core.parentId === 'main' ? `root_${group.id}` : core.parentId,
      ...(!sameTurn ? { taskSummary: undefined, resultSummary: undefined, toolsCompleted: undefined, toolsFailed: undefined,
        toolCounts: undefined, otherToolCount: undefined, toolStatisticsComplete: undefined, resultContentId: undefined, bodyUnavailable:undefined } : {}),
      turnId: child?.context.turnId ?? group.root?.context?.turnId,
      sourceTaskId: child ? child.context.sourceTaskId : group.root?.binding.sourceTaskId ?? previous?.sourceTaskId,
      lastResult: core.lastResult ? truncateMultiAgentText(core.lastResult, 1024).text : sameTurn ? previous?.lastResult : undefined,
      resultSummary: core.lastResult ? desktopSubAgentSummary(core.lastResult) : sameTurn ? previous?.resultSummary : undefined,
      error: core.error ? truncateMultiAgentText(core.error, 1024).text : undefined,
      ...(sameTurn&&previous?.bodyUnavailable&&!publishedResult?{lastResult:undefined,resultSummary:undefined,error:undefined}:{}),
      ...bodyProjection,
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
    (acceptedPort ?? this.options.store).appendEvent(group.id, { kind: 'status', agentId: id, payload: { agent } });
    if (core.resourcesReleased) this.slots.delete(id);
    return agent;
  }

  private pendingResources(groupId: string, agentId: string) {
    return this.options.store.resources(groupId).filter(resource => resource.agentId === agentId && !['released', 'retained_by_policy'].includes(resource.state));
  }

  private refreshResourceProjection(groupId: string, agentId: string, acceptedPort?: DesktopMultiAgentMutationPort): void {
    const previous = this.requireAgent(groupId, agentId);
    const resources = this.pendingResources(groupId, agentId);
    const executionReleased = !previous.executionActive && !previous.sessionResident && !previous.runtimeResident
      && previous.activationState === 'settled';
    const agent = (acceptedPort ?? this.options.store).putAgent(groupId, { ...previous,
      resourcesReleased: executionReleased && !resources.length,
      cleanupPending: !executionReleased || Boolean(resources.length),
      cleanupError: executionReleased ? resources[0]?.lastError : previous.cleanupError,
    }, true);
    (acceptedPort ?? this.options.store).appendEvent(groupId, { kind: 'cleanup', agentId, payload: { agent } });
    for (const operation of (acceptedPort ?? this.options.store).pendingCloseOperations(groupId)) {
      const target = String(operation.result.targetAgentId ?? '');
      const agents = (acceptedPort ?? this.options.store).allAgents(groupId);
      const descendants = new Set([target]);
      for (let changed = true; changed;) { changed = false; for (const item of agents) if (item.parentId && descendants.has(item.parentId) && !descendants.has(item.id)) { descendants.add(item.id); changed = true; } }
      if (agents.some(item => descendants.has(item.id)) && agents.filter(item => descendants.has(item.id)).every(item => item.resourcesReleased)) {
        (acceptedPort ?? this.options.store).putOperation({ ...operation, result: { ...operation.result, state: 'completed', resourcesReleased: true, cleanupPending: false } }, true);
      }
    }
  }

  private mutate(group: LiveGroup, input: { actor: unknown; operationId: string }, command: string, payload: unknown, action: (acceptedPort: DesktopMultiAgentMutationPort) => MultiAgentControlResult): MultiAgentControlResult {
    const requestHash = this.requestHash(input.operationId, { command, actor: input.actor, payload });
    const existing = this.persistenceIO(group, () => this.options.store.getOperation(group.id, input.operationId));
    if (existing) {
      if (existing.requestHash !== requestHash) throw new Error('operation_id_conflict');
      return existing.result as unknown as MultiAgentControlResult;
    }
    try {
      const result = this.options.store.transaction((acceptedPort) => {
        const result = action(acceptedPort);
        acceptedPort.putOperation({ groupId: group.id, operationId: input.operationId, command, requestHash, applyState: 'applied', result: { ...result },...(command==='followup'&&result.state==='queued_next_admission'?{followupAcceptedResult:{...result},followupInput:{targetId:(payload as {target:string}).target,message:(payload as {message:string}).message}}:{}) }, command === 'interrupt');
        return result;
      });
      this.wake(group); return result;
    } catch (error) { this.freezeGroup(group, 'multi_agent_persistence_failed'); throw error; }
  }

  private requireActor(actor: DesktopAgentActor, source: Source, context?: DesktopAgentExecutionContext): ActorState {
    if (source !== 'agent') throw new Error('request source is not permitted for agent authority');
    const state = this.actors.get(actor);
    if (!state || !state.active || state.preparing || state.sealed || state.context.signal.aborted) throw new Error('stale or invalid multi-agent authority');
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
  private captureGoalDecisionInput(input: TaskCreateInput): TaskCreateInput {
    const captured = structuredClone(input);
    const freeze = (value: unknown): void => {
      if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
      for (const field of Object.values(value)) freeze(field);
      Object.freeze(value);
    };
    freeze(captured);
    return captured;
  }
  private assertWritable(group: LiveGroup, reason = 'multi_agent_persistence_failed', decisionToken?: object): void {
    this.assertReady();
    if (decisionToken) {
      const decision = this.goalContinuationDecisions.get(decisionToken);
      const scope = decision?.input.executionScope;
      const current = this.options.store.requireGroup(group.id);
      if (!decision?.live || !this.goalDecisions.has(group.id) || decision.binding.groupId !== group.id
        || decision.binding.bootId !== this.options.store.bootId || current.currentRootEpoch !== decision.binding.rootEpoch
        || !isDeepStrictEqual(this.options.store.getRootBinding(decision.binding.sourceTaskId), decision.binding)
        || current.permissionRevision !== decision.permissionRevision
        || decision.input.context?.threadId !== decision.binding.threadId || scope?.kind !== 'goal_turn'
        || scope.origin !== 'continuation' || scope.threadId !== decision.binding.threadId
        || scope.goalId !== decision.sourceScope.goalId || scope.epoch !== decision.sourceScope.epoch
        || !scope.goalTurnId || scope.goalTurnId === decision.sourceScope.goalTurnId) throw Error('goal_decision_pending');
    } else if (this.goalDecisions.has(group.id)) throw new Error('goal_decision_pending');
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
    this.abortExecutionSignal(group, group.lifetime, new Error(reason)); group.root && this.abortExecutionSignal(group, group.root.controller, new Error(reason));
    if (group.root?.context) this.markRootStopping(group, group.root);
    for (const child of group.children.values()) {
      try { this.cancelFollowups(group, child, new Error(reason)); } catch { /* Physical stop still proceeds. */ }
      if (child.execution) this.markStopping(group, child, new Error(reason));
    }
    this.wake(group);
  }

  private abortExecutionSignal(group: LiveGroup, controller: AbortController, reason: unknown,
    extraContext?: DesktopAgentExecutionContext): void {
    const signals = new Set([group.root?.context?.signal, extraContext?.signal,
      ...[...group.children.values()].map(child => child.context.signal)].filter((signal): signal is AbortSignal => !!signal));
    // Native composite signals can refresh lazily. Observe previous causes before
    // aborting another source, then freeze this cause before a later grace block.
    for (const signal of signals) void signal.aborted;
    try { controller.abort(reason); }
    finally { for (const signal of signals) void signal.aborted; }
  }

  private markStopping(group: LiveGroup, child: LiveChild, reason: Error): void {
    child.stopRequested = true;
    this.abortExecutionSignal(group, child.controller, reason, child.context);
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
      this.abortExecutionSignal(current, current.lifetime, new Error('runtime_blocked'));
      for (const live of current.children.values()) {
        try { this.cancelFollowups(current, live, new Error('runtime_blocked')); } catch { /* Fail closed even when the audit reserve is full. */ }
        if (!live.execution) continue;
        this.abortExecutionSignal(current, live.controller, new Error('runtime_blocked'), live.context);
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
    // A registered native group session is still a live resource even when no
    // child exists. Root-turn completion must not discard its incarnation.
    if (this.observationResources.has(group.id)) return;
    const observationOwner = this.observationOwners.get(group.id)?.owner.deref();
    if (observationOwner) {
      try { getObservationSessionOwnerHostBinding(observationOwner); return; }
      catch { /* Revoked/closed owner no longer retains this live group. */ }
    }
  }
  private coreId(group: LiveGroup, id: string): string { return id === `root_${group.id}` ? 'main' : id; }
  private marker(binding: MultiAgentRootBinding): TaskMultiAgentPreparation {
    const { groupId, rootEpoch, rootTurnId, preparationId, bootId } = binding; return { groupId, rootEpoch, rootTurnId, preparationId, bootId };
  }
}
