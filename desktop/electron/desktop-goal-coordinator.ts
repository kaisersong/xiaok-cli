import { createInstalledGoalApplicationClient } from '../../src/runtime/verification/installed-goal-application.js';
import { FileGoalNativeJournal, isGoalNativeJournalId, goalNativeStateHash, type GoalNativeMutation } from '../../src/runtime/goal/native-mutation-journal.js';
import { createGoalNativeMutationWorkflow } from '../../src/runtime/goal/native-mutation-workflow.js';
import { assertGoalNativeApplicationCurrent } from '../../src/runtime/goal/native-mutation-projection.js';
import { readInstalledCurrentProfile } from '../../src/runtime/verification/migration-markers.js';
import { goalApplicationFromState } from '../../src/runtime/goal/completion-intent.js';
import { canonicalVerificationJson } from '../../src/runtime/verification/protocol.js';
import { readInstalledCurrentOwner } from '../../src/runtime/verification/installed-owner-state.js';
import { createGoalPublicationWorkflow } from '../../src/runtime/goal/publication-workflow.js';
import { observeGoalCompletion, unobservedGoalCompletion, type GoalCompletionObservation } from '../../src/runtime/goal/completion-observation.js';
import { randomUUID } from 'node:crypto';
import { GoalCompletionEvaluator } from '../../src/runtime/goal/completion-evaluator.js';
import { buildGoalContextBlock } from '../../src/runtime/goal/prompt.js';
import { GoalService } from '../../src/runtime/goal/service.js';
import type {
  GoalActivation,
  GoalDocument,
  GoalEvidenceEnvelope,
  GoalInput,
  GoalCreationInput,
  GoalState,
} from '../../src/runtime/goal/types.js';
import type { GoalToolHost } from '../../src/ai/tools/goal.js';
import type { ToolExecutionContext } from '../../src/types.js';
import type { TaskIdentityReservation, PersistedTaskEvent } from '../../src/runtime/task-host/task-runtime-host.js';
import type { HostDeliveryRecoveryReceipt } from '../../src/runtime/task-host/delivery-types.js';
import type {
  GoalTurnExecutionScope,
  TaskCreateInput,
  TaskSnapshot,
  TaskUnderstanding,
} from '../../src/runtime/task-host/types.js';
import { SqliteGoalStore, type GoalTaskBinding } from './goal-store-sqlite.js';
import type { DesktopMultiAgentService } from './desktop-multi-agent-service.js';
import { parseGoalRequestId, type GoalAttachmentRequest, type GoalAttachmentSource } from '../shared/goal-attachment.js';

interface GoalTaskHost {
  prepareTask(input: TaskCreateInput): Promise<{ taskId: string; understanding?: TaskUnderstanding }>;
  prepareReservedTask?(input:TaskCreateInput,reservation:TaskIdentityReservation):Promise<{taskId:string;understanding?:TaskUnderstanding}>;
  startTask(taskId: string): Promise<void>;
  cancelTask(taskId: string, reason?: string): Promise<void>;
}

export interface DesktopGoalProjection {
  state: GoalState;
  activation: GoalActivation;
  waitingReason?: 'waiting_children' | 'children_need_attention';
  currentCompletion?: GoalCompletionObservation;
}

export interface PreparedGoalTask {
  attachmentId: string;
  threadId: string;
  taskId: string;
  executionScope: GoalTurnExecutionScope;
  goalRef: { goalId: string; revision: number };
  expiresAt: number;
  attachmentSource: GoalAttachmentSource;
}

interface PendingAttachment extends PreparedGoalTask {
  timeout: ReturnType<typeof setTimeout>;
  permissionRevision: number | undefined;
}

export type DesktopGoalNativeMutationProjection = Pick<GoalNativeMutation, 'id' | 'kind' | 'status'> & { objective: string };

export interface DesktopGoalCoordinatorOptions {
  store: SqliteGoalStore;
  nativeJournal?: FileGoalNativeJournal;
  taskHost: GoalTaskHost;
  instanceId: string;
  now?: () => number;
  createAttachmentId?: () => string;
  publishGoalChanged?: (input: { threadId: string; goal: DesktopGoalProjection }) => void;
  publishGoalTaskPrepared?: (input: PreparedGoalTask) => void;
  attachmentTimeoutMs?: number;
  multiAgent?: Pick<DesktopMultiAgentService, 'withGoalDecision' | 'goalReadiness' | 'assertThreadAdmission'
    | 'getExecutionAuthorization' | 'assertExecutionAdmission'>;
  prepareThread?(threadId: string): Promise<void>;
  /** Fixed main-only service closure; ownerId/source strings never authorize recovery. */
  authorizeRecoveredDelivery?(input: HostDeliveryRecoveryReceipt): void;
}

export class DesktopGoalCoordinator {
  private readonly now: () => number;
  private readonly service: GoalService;
  private readonly activation = new Map<string, { goalId: string; armed: boolean; permissionRevision: number | undefined }>();
  private readonly pendingByThread = new Map<string, PendingAttachment>();
  private readonly runningByThread = new Map<string, string>();
  private readonly contextRunningByThread = new Map<string, string>();
  private readonly contextTaskThread = new Map<string, string>();
  private readonly discardedGoalTaskIds = new Set<string>();
  private readonly userQueuePending = new Set<string>();
  private readonly pendingBlocked = new Map<string, { reason: string; fingerprint: string }>();
  private readonly publicationThreads = new Map<string, number>();
  private publicationEpoch = 0;
  private readonly nativeGenerations = new Map<string, number>();
  private closed = false;
  private operations = 0;
  private readonly drainWaiters = new Set<() => void>();

  /** Permanent process-lifetime gate, unlike an ordinary disarm/regrant. */
  stopAccepting(): void {
    if (this.closed) return;
    this.closed = true;
    this.disarmAll();
    this.notifyDrain();
  }

  drainShutdown(deadlineMs: number): Promise<boolean> {
    if (!Number.isFinite(deadlineMs) || deadlineMs < 0) return Promise.reject(Error('goal_shutdown_deadline'));
    if (this.isShutdownDrained()) return Promise.resolve(true);
    return new Promise(resolve => {
      let finished = false;
      const finish = (drained: boolean) => {
        if (finished) return;
        finished = true; clearTimeout(timer); this.drainWaiters.delete(check); resolve(drained);
      };
      const check = () => { if (this.isShutdownDrained()) finish(true); };
      const timer = setTimeout(() => finish(this.isShutdownDrained()), deadlineMs);
      this.drainWaiters.add(check); check();
    });
  }

  private isShutdownDrained(): boolean {
    return this.closed && this.operations === 0 && this.threadChains.size === 0 && this.publicationThreads.size === 0;
  }

  private notifyDrain(): void { for (const waiter of this.drainWaiters) waiter(); }
  private assertOpen(): void { if (this.closed) throw Error('goal_coordinator_closed'); }
  private async withOperation<T>(work: () => Promise<T>): Promise<T> {
    this.assertOpen(); this.operations++;
    try { return await work(); }
    finally { this.operations--; this.notifyDrain(); }
  }
  private readonly threadChains = new Map<string, Promise<unknown>>();

  constructor(private readonly options: DesktopGoalCoordinatorOptions) {
    this.now = options.now ?? Date.now;
    this.service = new GoalService({
      store: options.store,
      nativeJournal: options.nativeJournal,
      ownership: { assertOwned: () => undefined },
      now: this.now,
    });
  }

  async getGoal(threadId: string): Promise<DesktopGoalProjection | null> {
    return this.withOperation(async () => {
      let document = await this.service.load(threadId);
      if (!document) {
        this.activation.delete(threadId);
        return null;
      }
      const captured = JSON.stringify(document.state);
      let currentCompletion = await observeGoalCompletion(document.state);
      const latest = await this.service.load(threadId);
      if (!latest) return null;
      if (JSON.stringify(latest.state) !== captured) currentCompletion = unobservedGoalCompletion(latest.state);
      document = latest;
      return {
        currentCompletion,
        state: document.state,
        activation: this.isArmed(threadId, document.state.goalId) ? 'armed' : 'disarmed',
        ...this.waitingProjection(threadId, document.state),
      };
      });
  }

  async createGoal(input: { threadId: string } & GoalCreationInput & GoalAttachmentRequest): Promise<{
    goal: DesktopGoalProjection;
    preparedTask: PreparedGoalTask;
  }> {
    return this.withOperation(async () => {
      input = structuredClone(input);
      if (input.verificationDefinition !== undefined) return this.beginNativeMutation('create', input);
      if (readInstalledCurrentProfile().kind !== 'ordinary') throw Error('goal_verification_definition_required');
      const attachmentSource: GoalAttachmentSource = { kind: 'request', requestId: parseGoalRequestId(input.requestId) ?? null };
      const permissionRevision = this.captureExecutionRevision();
      return this.withThread(input.threadId, async () => {
        await this.assertThreadAdmission(input.threadId, permissionRevision);
        this.assertExecutionAdmission(input.threadId, permissionRevision);
        const state = await this.service.create(this.context(input.threadId, 'user', null), input);
        this.assertExecutionAdmission(input.threadId, permissionRevision);
        this.activation.set(input.threadId, { goalId: state.goalId, armed: true, permissionRevision });
        const preparedTask = await this.prepareGoalTask(input.threadId, state, 'user', permissionRevision, attachmentSource, state.objective);
        this.assertExecutionAdmission(input.threadId, permissionRevision);
        const goal = { state, activation: 'armed' as const };
        this.options.publishGoalChanged?.({ threadId: input.threadId, goal });
        return { goal, preparedTask };
      });
      });
  }

  private invalidateNativeMutation(threadId: string): number {
    const generation = (this.nativeGenerations.get(threadId) ?? 0) + 1;
    this.nativeGenerations.set(threadId, generation);
    return generation;
  }

  private nativeJournal(): FileGoalNativeJournal {
    if (!this.options.nativeJournal) throw Error('goal_native_journal_unavailable');
    return this.options.nativeJournal;
  }

  private nativeView(row: GoalNativeMutation): DesktopGoalNativeMutationProjection {
    return { id: row.id, kind: row.kind, status: row.status, objective: row.target.objective };
  }

  private latestNative(threadId: string): GoalNativeMutation | undefined {
    return this.options.nativeJournal?.load(threadId).at(-1);
  }

  async getGoalNativeMutation(threadId: string): Promise<DesktopGoalNativeMutationProjection | null> {
    return this.withOperation(async () => { const row = this.latestNative(threadId); return row ? this.nativeView(row) : null; });
  }

  private nativeAdmission(threadId: string, permissionRevision: number | undefined, generation: number, epoch: number): () => void {
    return () => {
      this.assertOpen();
      if ((this.nativeGenerations.get(threadId) ?? 0) !== generation || this.publicationEpoch !== epoch) throw Error('goal_native_mutation_superseded');
      this.assertExecutionAdmission(threadId, permissionRevision);
    };
  }

  private async beginNativeMutation(kind: 'create' | 'replace', input: { threadId: string } & GoalCreationInput & GoalAttachmentRequest) {
    const permission = this.captureExecutionRevision(), epoch = this.publicationEpoch;
    const generation = this.invalidateNativeMutation(input.threadId);
    const admission = this.nativeAdmission(input.threadId, permission, generation, epoch);
    const original = kind === 'replace' ? await this.requireDocument(input.threadId) : null;
    admission();
    let minimumEpoch: number | undefined;
    if (original) {
      const client = createInstalledGoalApplicationClient(goalApplicationFromState(original.state), 'scheduler');
      try {
        const actual = await client.inspect();
        minimumEpoch = Math.max(original.state.epoch, actual.current?.binding.epoch ?? 0, actual.pendingTarget?.epoch ?? 0) + 1;
        if (!Number.isSafeInteger(minimumEpoch)) throw Error('goal_native_mutation_epoch');
      } finally { client.dispose(); }
      admission();
    }
    const reserved = await this.withThread(input.threadId, async () => {
      await this.assertThreadAdmission(input.threadId, permission);
      this.assertExecutionAdmission(input.threadId, permission);
      admission();
      if (this.pendingByThread.has(input.threadId) || this.runningByThread.has(input.threadId)) throw Error('goal_native_task_running');
      const previous = this.latestNative(input.threadId);
      if (previous && !['applied','retired','stale'].includes(previous.status)) throw Error('goal_native_mutation_pending');
      const document = await this.service.load(input.threadId);
      if (original && (!document || goalNativeStateHash(document.state) !== goalNativeStateHash(original.state))) throw Error('goal_native_mutation_basis_changed');
      const goalInput: GoalInput = { objective: input.objective, expectedEvidenceKinds: input.expectedEvidenceKinds,
        ...(input.completionCriterion === undefined ? {} : { completionCriterion: input.completionCriterion }),
        ...(input.turnLimit === undefined ? {} : { turnLimit: input.turnLimit }) };
      const row = await this.service.reserveNativeMutation(this.context(input.threadId, 'user', kind === 'create' ? null : document?.state.revision ?? null),
        { kind, input: goalInput, definition: input.verificationDefinition, ...(minimumEpoch === undefined ? {} : { minimumEpoch }) });
      admission();
      this.activation.delete(input.threadId);
      return { row, generation };
    });
    return this.advanceNativeMutation(input.threadId, reserved.row, permission, reserved.generation, epoch, input.requestId);
  }

  private async advanceNativeMutation(threadId: string, original: GoalNativeMutation, permission: number | undefined, generation: number, epoch: number, requestId?: string) {
    const admission = this.nativeAdmission(threadId, permission, generation, epoch);
    const workflow = createGoalNativeMutationWorkflow({ store: this.options.store, journal: this.nativeJournal(),
      ownership: { assertOwned: () => this.assertOpen() }, now: this.now, assertAdmission: admission });
    const row = await workflow.run({ sessionId: threadId, mutationId: original.id, instanceId: this.options.instanceId, requestSource: 'user', action: 'advance' });
    if (row.status !== 'ready') throw Error(`goal_native_mutation_${row.status}`);
    admission();
    const prepared = await this.service.prepareNativeMutationCommit(this.context(threadId, 'user', row.kind === 'replace' ? row.previous!.revision : null), row.id, undefined, admission);
    await assertGoalNativeApplicationCurrent(row.target);
    admission();
    return this.withThread(threadId, async () => {
      admission();
      const state = await prepared.commit();
      admission();
      this.activation.set(threadId, { goalId: state.goalId, armed: true, permissionRevision: permission });
      const attachmentSource: GoalAttachmentSource = { kind: 'request', requestId: parseGoalRequestId(requestId) ?? null };
      const preparedTask = await this.prepareGoalTask(threadId, state, 'user', permission, attachmentSource, state.objective, true);
      admission();
      return { goal: this.publishProjection(threadId, state), preparedTask };
    });
  }

  async continueGoalNativeMutation(input: { threadId: string; requestSource: 'user' | 'agent' | 'scheduler'; requestId?: string }) {
    input = structuredClone(input);
    return this.withOperation(async () => {
      if (input.requestSource !== 'user') throw Error('goal_native_mutation_source');
      const permission = this.captureExecutionRevision(), epoch = this.publicationEpoch;
      const generation = this.invalidateNativeMutation(input.threadId);
      const admission = this.nativeAdmission(input.threadId, permission, generation, epoch);
      const captured = await this.withThread(input.threadId, async () => {
        await this.assertThreadAdmission(input.threadId, permission);
        this.assertExecutionAdmission(input.threadId, permission);
        if (this.pendingByThread.has(input.threadId) || this.runningByThread.has(input.threadId)) throw Error('goal_native_task_running');
        const row = this.latestNative(input.threadId);
        if (!row || ['applied','retired','stale'].includes(row.status)) throw Error('goal_native_mutation_not_pending');
        this.activation.delete(input.threadId);
        admission();
        return { row, generation };
      });
      return this.advanceNativeMutation(input.threadId, captured.row, permission, captured.generation, epoch, input.requestId);
    });
  }

  async recoverGoalNativeMutation(input: { threadId: string; requestSource: 'user' | 'agent' | 'scheduler' }) {
    input = structuredClone(input);
    return this.withOperation(async () => {
      if (input.requestSource !== 'user') throw Error('goal_native_mutation_source');
      const row = this.latestNative(input.threadId);
      if (!row) throw Error('goal_native_mutation_missing');
      const generation = this.invalidateNativeMutation(input.threadId), epoch = this.publicationEpoch;
      this.activation.delete(input.threadId);
      const admission = this.nativeAdmission(input.threadId, this.captureExecutionRevision(), generation, epoch);
      const workflow = createGoalNativeMutationWorkflow({ store: this.options.store, journal: this.nativeJournal(),
        ownership: { assertOwned: () => this.assertOpen() }, now: this.now, assertAdmission: admission });
      const recovered = await workflow.run({ sessionId: input.threadId, mutationId: row.id, instanceId: this.options.instanceId, requestSource: 'scheduler', action: 'recover' });
      if (recovered.status === 'ready') {
        const document = await this.service.load(input.threadId);
        if (document && document.state.goalId === recovered.target.goalId && document.state.epoch === recovered.target.epoch) {
          await this.service.recoverNativeMutationCommit(this.context(input.threadId, 'user', document.state.revision), row.id);
        } else {
          admission();
          const projection = await this.service.prepareNativeMutationCommit(this.context(input.threadId, 'user', row.kind === 'replace' ? row.previous!.revision : null), row.id, undefined, admission);
          await this.withThread(input.threadId, async () => { admission(); await projection.commit(); });
        }
      }
      const latest = this.latestNative(input.threadId)!;
      const document = await this.service.load(input.threadId);
      return { mutation: this.nativeView(latest), goal: document ? this.publishProjection(input.threadId, document.state) : null };
    });
  }

  async cancelGoalNativeMutation(input: { threadId: string; requestSource: 'user' | 'agent' | 'scheduler' }) {
    input = structuredClone(input);
    return this.withOperation(async () => {
      if (input.requestSource !== 'user') throw Error('goal_native_mutation_source');
      this.invalidateNativeMutation(input.threadId); this.activation.delete(input.threadId);
      await this.withThread(input.threadId, async () => {
        await this.cancelPending(input.threadId, 'goal_native_cancelled');
        await this.cancelRunningGoalTask(input.threadId, 'goal_native_cancelled');
      });
      let row = this.latestNative(input.threadId);
      if (!row) throw Error('goal_native_mutation_missing');
      if (row.status === 'enrolling' || row.status === 'binding') {
        const workflow = createGoalNativeMutationWorkflow({ store: this.options.store, journal: this.nativeJournal(),
          ownership: { assertOwned: () => this.assertOpen() }, now: this.now, assertAdmission: () => { throw Error('goal_native_mutation_cancelled'); } });
        row = await workflow.run({ sessionId: input.threadId, mutationId: row.id, instanceId: this.options.instanceId, requestSource: 'scheduler', action: 'recover' });
      }
      if (!['applied','retired','stale'].includes(row.status)) {
        const next: GoalNativeMutation = { ...row, revision: row.revision + 1, status: row.status === 'ready' ? 'stale' : 'retired', updatedAt: Math.max(this.now(), row.updatedAt) };
        this.nativeJournal().put({ sessionId: input.threadId, requestSource: 'user', expectedRevision: row.revision, next }); row = next;
      }
      return this.nativeView(row);
    });
  }

  private assertNoNativePending(threadId: string): void {
    // Ordinary Desktop thread IDs have a wider domain; native IDs remain strict.
    if (!isGoalNativeJournalId(threadId)) return;
    const row = this.latestNative(threadId);
    if (row && !['applied','retired','stale'].includes(row.status)) throw Error('goal_native_mutation_pending');
  }

  private async observeGoalExecution(threadId: string, state: GoalState, permission: number | undefined): Promise<() => Promise<void>> {
    const admission = this.nativeAdmission(threadId, permission, this.nativeGenerations.get(threadId) ?? 0, this.publicationEpoch);
    await this.assertCurrentGoalApplication(threadId, state, permission);
    admission();
    return async () => {
      admission(); this.assertNoNativePending(threadId);
      const current = await this.service.load(threadId);
      if (!current || goalNativeStateHash(current.state) !== goalNativeStateHash(state)) throw Error('goal_application_state_changed');
      admission(); this.assertNoNativePending(threadId);
    };
  }

  private async assertCurrentGoalApplication(threadId: string, state: GoalState, permission: number | undefined): Promise<void> {
    this.assertNoNativePending(threadId);
    const route = readInstalledCurrentOwner({ ownerKind: 'goal', ownerId: state.goalId });
    if (route.kind === 'ordinary') return;
    try {
      await assertGoalNativeApplicationCurrent(goalApplicationFromState(state));
      this.assertNoNativePending(threadId);
      this.assertExecutionAdmission(threadId, permission);
      const current = await this.service.load(threadId);
      if (!current || goalNativeStateHash(current.state) !== goalNativeStateHash(state)) throw Error('goal_application_state_changed');
      this.assertExecutionAdmission(threadId, permission);
    } catch (error) { this.activation.delete(threadId); throw error; }
  }

  async pauseGoal(input: { threadId: string }): Promise<DesktopGoalProjection> {
    return this.withOperation(async () => {
      this.invalidateNativeMutation(input.threadId);
      return this.withThread(input.threadId, async () => {
        const document = await this.requireDocument(input.threadId);
        await this.cancelPending(input.threadId, 'goal_paused');
        await this.cancelRunningGoalTask(input.threadId, 'goal_paused');
        const state = await this.service.pause(
          this.context(input.threadId, 'user', document.state.revision),
          'user_paused',
        );
        this.activation.delete(input.threadId);
        return this.publishProjection(input.threadId, state);
      });
      });
  }

  async resumeGoal(input: { threadId: string; turnLimit?: number } & GoalAttachmentRequest): Promise<{
    goal: DesktopGoalProjection;
    preparedTask: PreparedGoalTask;
  }> {
    return this.withOperation(async () => {
      const attachmentSource: GoalAttachmentSource = { kind: 'request', requestId: parseGoalRequestId(input.requestId) ?? null };
      const permissionRevision = this.captureExecutionRevision();
      const original = await this.requireDocument(input.threadId);
      const assertObserved = await this.observeGoalExecution(input.threadId, original.state, permissionRevision);
      return this.withThread(input.threadId, async () => {
        await this.assertThreadAdmission(input.threadId, permissionRevision);
        this.assertExecutionAdmission(input.threadId, permissionRevision);
        if (this.contextRunningByThread.has(input.threadId)) {
          throw new Error('Cannot resume a Goal while a paused user task is still running');
        }
        const document = await this.requireDocument(input.threadId);
        this.assertExecutionAdmission(input.threadId, permissionRevision);
        await assertObserved();
        const state = await this.service.resume(
          this.context(input.threadId, 'user', document.state.revision),
          input.turnLimit === undefined ? {} : { turnLimit: input.turnLimit },
        );
        this.assertExecutionAdmission(input.threadId, permissionRevision);
        this.activation.set(input.threadId, { goalId: state.goalId, armed: true, permissionRevision });
        const preparedTask = await this.prepareGoalTask(input.threadId, state, 'continuation', permissionRevision, attachmentSource, undefined, true);
        this.assertExecutionAdmission(input.threadId, permissionRevision);
        return { goal: this.publishProjection(input.threadId, state), preparedTask };
      });
      });
  }

  async cancelGoal(input: { threadId: string }): Promise<DesktopGoalProjection> {
    return this.withOperation(async () => {
      this.invalidateNativeMutation(input.threadId);
      return this.withThread(input.threadId, async () => {
        const document = await this.requireDocument(input.threadId);
        await this.cancelPending(input.threadId, 'goal_cancelled');
        await this.cancelRunningGoalTask(input.threadId, 'goal_cancelled');
        const state = await this.service.cancel(
          this.context(input.threadId, 'user', document.state.revision),
          'user_cancelled',
        );
        this.activation.delete(input.threadId);
        return this.publishProjection(input.threadId, state);
      });
      });
  }

  async replaceGoal(input: { threadId: string } & GoalCreationInput & GoalAttachmentRequest): Promise<{
    goal: DesktopGoalProjection;
    preparedTask: PreparedGoalTask;
  }> {
    return this.withOperation(async () => {
      input = structuredClone(input);
      if (input.verificationDefinition !== undefined) return this.beginNativeMutation('replace', input);
      if (readInstalledCurrentProfile().kind !== 'ordinary') throw Error('goal_verification_definition_required');
      const attachmentSource: GoalAttachmentSource = { kind: 'request', requestId: parseGoalRequestId(input.requestId) ?? null };
      const permissionRevision = this.captureExecutionRevision();
      return this.withThread(input.threadId, async () => {
        await this.assertThreadAdmission(input.threadId, permissionRevision);
        this.assertExecutionAdmission(input.threadId, permissionRevision);
        if (this.pendingByThread.has(input.threadId) || this.runningByThread.has(input.threadId)) {
          throw new Error('Cannot replace a Goal while a Goal task is pending or running');
        }
        const document = await this.requireDocument(input.threadId);
        this.assertExecutionAdmission(input.threadId, permissionRevision);
        const state = await this.service.replace(
          this.context(input.threadId, 'user', document.state.revision),
          input,
        );
        this.assertExecutionAdmission(input.threadId, permissionRevision);
        this.activation.set(input.threadId, { goalId: state.goalId, armed: true, permissionRevision });
        const preparedTask = await this.prepareGoalTask(input.threadId, state, 'user', permissionRevision, attachmentSource, state.objective);
        this.assertExecutionAdmission(input.threadId, permissionRevision);
        return { goal: this.publishProjection(input.threadId, state), preparedTask };
      });
      });
  }

  assertBackgroundAdmission():void {this.captureExecutionRevision();}
  captureBackgroundAdmission():()=>void {const revision=this.captureExecutionRevision(),epoch=this.publicationEpoch;return()=>{this.assertOpen();if(this.publicationEpoch!==epoch||this.options.multiAgent?.getExecutionAuthorization().permissionRevision!==revision)throw Error('background_permission_changed');};}

  /** Main owns the fresh thread and the original Host reservation. */
  async admitReservedBackgroundTask(input:TaskCreateInput,reservation:TaskIdentityReservation,guard:()=>void):Promise<{taskId:string;understanding?:TaskUnderstanding}> {
    return this.withOperation(async()=>{
      guard();const threadId=input.context?.threadId;if(!threadId||input.executionScope)throw Error('background_fresh_thread_required');
      const revision=this.captureExecutionRevision();
      return this.withThread(threadId,async()=>{
        await this.assertThreadAdmission(threadId,revision);this.assertNoNativePending(threadId);
        if(await this.service.load(threadId))throw Error('background_fresh_thread_required');
        this.assertExecutionAdmission(threadId,revision);this.assertNoNativePending(threadId);
        guard();return this.prepareBindStart(input,revision,reservation,guard);
      });
    });
  }

  async admitUserTask(input: TaskCreateInput): Promise<{ taskId: string; understanding?: TaskUnderstanding }> {
    return this.withOperation(async () => {
      const threadId = input.context?.threadId;
      if (!threadId) return this.prepareBindStart(input);
      this.assertNoNativePending(threadId);
      const permissionRevision = this.captureExecutionRevision();
      const original = await this.service.load(threadId);
      const observed = original && original.state.status === 'active' && this.isArmed(threadId, original.state.goalId)
        ? await this.observeGoalExecution(threadId, original.state, permissionRevision) : null;
      const admission = this.nativeAdmission(threadId, permissionRevision, this.nativeGenerations.get(threadId) ?? 0, this.publicationEpoch);
      return this.withThread(threadId, async () => {
        await this.assertThreadAdmission(threadId, permissionRevision);
        this.assertExecutionAdmission(threadId, permissionRevision);
        const document = await this.service.load(threadId);
        this.assertExecutionAdmission(threadId, permissionRevision);
        this.assertNoNativePending(threadId);
        if (!document || !this.isArmed(threadId, document.state.goalId) || document.state.status !== 'active') {
          if (!document) this.activation.delete(threadId);
          this.userQueuePending.delete(threadId);
          if (document && document.state.status !== 'complete' && document.state.status !== 'cancelled') {
            const prepared = await this.options.taskHost.prepareTask({
              ...input,
              context: this.mainOwnedContext(threadId),
            });
            const compensation = this.assertPreparedAdmission(threadId, permissionRevision, prepared.taskId);
            if (compensation) await compensation;
            this.options.store.recordContextTask({
              goalId: document.state.goalId,
              threadId,
              taskId: prepared.taskId,
              recordedAt: this.now(),
            });
            this.contextRunningByThread.set(threadId, prepared.taskId);
            this.contextTaskThread.set(prepared.taskId, threadId);
            try {
              this.assertExecutionAdmission(threadId, permissionRevision);
              await this.options.taskHost.startTask(prepared.taskId);
              this.assertExecutionAdmission(threadId, permissionRevision);
            } catch (error) {
              this.contextRunningByThread.delete(threadId);
              this.contextTaskThread.delete(prepared.taskId);
              throw error;
            }
            return prepared;
          }
          return this.prepareBindStart(input, permissionRevision);
        }
        if (!observed) throw Error('goal_application_observation_required');
        await observed();
        await this.cancelPending(threadId, 'superseded_by_user');
        this.assertExecutionAdmission(threadId, permissionRevision);
        const runningTaskId = this.runningByThread.get(threadId);
        if (runningTaskId) {
          const binding = this.options.store.getTaskBinding(runningTaskId);
          if (binding?.origin === 'continuation') {
            await this.options.taskHost.cancelTask(runningTaskId, 'superseded_by_user');
            throw new Error('goal_user_turn_waiting_for_preemption');
          }
          throw new Error('goal_user_turn_already_running');
        }
        const scope = this.createScope(threadId, document.state, 'user');
        const prepared = await this.options.taskHost.prepareTask({
          ...input,
          context: this.mainOwnedContext(threadId),
          executionScope: scope,
        });
        const compensation = this.assertPreparedAdmission(threadId, permissionRevision, prepared.taskId);
        if (compensation) await compensation;
        this.options.store.bindTask({ ...scopeToBinding(scope, prepared.taskId), attachedAt: this.now() });
        admission();
        this.runningByThread.set(threadId, prepared.taskId);
        this.userQueuePending.delete(threadId);
        this.assertExecutionAdmission(threadId, permissionRevision);
        await this.options.taskHost.startTask(prepared.taskId);
        this.assertExecutionAdmission(threadId, permissionRevision);
        return prepared;
      });
      });
  }

  async ackGoalTaskAttached(input: { threadId: string; attachmentId: string }): Promise<void> {
    input = structuredClone(input);
    return this.withOperation(async () => {
      const permissionRevision = this.captureExecutionRevision();
      const admission = this.nativeAdmission(input.threadId, permissionRevision, this.nativeGenerations.get(input.threadId) ?? 0, this.publicationEpoch);
      const captured = await this.withThread(input.threadId, async () => {
        await this.assertThreadAdmission(input.threadId, permissionRevision); admission();
        const pending = this.pendingByThread.get(input.threadId);
        if (!pending || pending.attachmentId !== input.attachmentId) throw Error('Goal task attachment is missing, stale, or belongs to another thread');
        const document = await this.requireDocument(input.threadId); admission();
        return { pending, state: document.state };
      });
      const observed = await this.observeGoalExecution(input.threadId, captured.state, captured.pending.permissionRevision);
      await this.withThread(input.threadId, async () => {
        admission(); await observed();
        const pending = this.pendingByThread.get(input.threadId), state = captured.state;
        this.assertExecutionAdmission(input.threadId, captured.pending.permissionRevision);
        if (pending !== captured.pending || state.goalId !== pending.goalRef.goalId || state.revision !== pending.goalRef.revision
          || !this.isArmed(input.threadId, state.goalId) || this.userQueuePending.has(input.threadId) || this.runningByThread.has(input.threadId))
          throw Error('Goal task attachment is no longer admissible');
        clearTimeout(pending.timeout); this.pendingByThread.delete(input.threadId);
        this.options.store.markTaskAttached(pending.taskId, this.now());
        this.runningByThread.set(input.threadId, pending.taskId); admission();
        await this.options.taskHost.startTask(pending.taskId); admission();
      });
    });
  }

  async setUserQueuePending(input: { threadId: string; pending: boolean }): Promise<void> {
    return this.withOperation(async () => {
      await this.withThread(input.threadId, async () => {
        if (!input.pending) {
          this.userQueuePending.delete(input.threadId);
          return;
        }
        this.userQueuePending.add(input.threadId);
        await this.cancelPending(input.threadId, 'superseded_by_user');
        const running = this.runningByThread.get(input.threadId);
        const binding = running ? this.options.store.getTaskBinding(running) : null;
        if (running && binding?.origin === 'continuation') {
          await this.options.taskHost.cancelTask(running, 'superseded_by_user');
        }
      });
      });
  }

  createGoalToolHost(taskId: string): GoalToolHost {
    return {
      getGoal: async () => {
        const binding = this.requireTaskBinding(taskId);
        return this.getGoal(binding.threadId);
      },
      requestComplete: async (summary) => {
        const binding = this.requireCurrentGoalTask(taskId);
        return this.withThread(binding.threadId, async () => {
          const currentBinding = this.requireCurrentGoalTask(taskId);
          const document = await this.requireDocument(binding.threadId);
          if (document.state.goalId !== currentBinding.goalId || document.state.epoch !== currentBinding.epoch) {
            throw new Error('Goal completion claim belongs to an old Goal turn');
          }
          await this.service.requestCompletion(this.context(binding.threadId, 'runtime', document.state.revision), {
            taskId, turnId: currentBinding.goalTurnId, summary,
          });
          return { accepted: true };
        });
      },
      requestBlocked: async (claim) => {
        this.requireCurrentGoalTask(taskId);
        this.pendingBlocked.set(taskId, claim);
        return { accepted: true };
      },
    };
  }

  createRegistryGoalToolHost(): GoalToolHost {
    const forContext = (context?: ToolExecutionContext) => {
      if (!context?.taskId) throw new Error('Goal tool requires a bound desktop task context');
      return this.createGoalToolHost(context.taskId);
    };
    return {
      getGoal: context => forContext(context).getGoal(context),
      requestComplete: (summary, context) => forContext(context).requestComplete(summary, context),
      requestBlocked: (claim, context) => forContext(context).requestBlocked(claim, context),
    };
  }

  async handlePersistedTaskEvent(input: PersistedTaskEvent): Promise<void> {
    return this.withOperation(async () => {
      const publicationEpoch = this.publicationEpoch;
      if (input.event.type !== 'task_terminal') return;
      const predecessorTaskId = input.taskId;
      const terminalEvent = input.event;
      const binding = this.options.store.getTaskBinding(input.taskId);
      if (!binding) {
        const contextThreadId = this.contextTaskThread.get(input.taskId);
        if (!contextThreadId) return;
        await this.withThread(contextThreadId, async () => {
          if (this.contextRunningByThread.get(contextThreadId) === input.taskId) {
            this.contextRunningByThread.delete(contextThreadId);
          }
          this.contextTaskThread.delete(input.taskId);
        });
        return;
      }
      const permissionRevision = this.activation.get(binding.threadId)?.permissionRevision;
      const publications: Array<{ intentId: string; action: 'start' | 'recover' }> = [];
      let nextContinuation: GoalState | null = null;
      await this.withThread(binding.threadId, async () => {
        if (this.discardedGoalTaskIds.delete(input.taskId)) {
          if (this.runningByThread.get(binding.threadId) === input.taskId) {
            this.runningByThread.delete(binding.threadId);
          }
          this.pendingBlocked.delete(input.taskId);
          return;
        }
        const document = await this.requireDocument(binding.threadId);
        if (document.state.goalId !== binding.goalId || document.state.epoch !== binding.epoch) {
          return;
        }
        if (document.turns.some(turn => turn.turnId === binding.goalTurnId)) {
          const intentId = document.state.pendingCompletionIntentId;
          const intent = intentId ? await this.options.store.loadCompletionIntent(binding.threadId, intentId) : null;
          if (intent && intent.turnId === binding.goalTurnId && intent.taskId === input.taskId
            && (await this.options.store.listCompletionAttempts(binding.threadId, intent.intentId)).length) {
            publications.push({ intentId: intent.intentId, action: 'recover' });
          }
          return;
        }
        const cancelReason = findCancellationReason(input.snapshot);
        const completeClaim = document.completionIntents?.find(intent => intent.taskId === input.taskId
          && intent.turnId === binding.goalTurnId && intent.application.goalId === binding.goalId
          && intent.application.epoch === binding.epoch && intent.status === 'claimed');
        const completeSummary = completeClaim?.summary;
        const blockerClaim = this.pendingBlocked.get(input.taskId);
        this.pendingBlocked.delete(input.taskId);
        if (this.runningByThread.get(binding.threadId) === input.taskId) {
          this.runningByThread.delete(binding.threadId);
        }
        if (document.state.status !== 'active' || !this.isArmed(binding.threadId, document.state.goalId)) {
          return;
        }
        const evidence = collectEvidence(document.state, binding, input.snapshot);
        const proposed = evidence.map((record, index): GoalEvidenceEnvelope => ({
          goalId: document.state.goalId,
          epoch: document.state.epoch,
          goalTurnId: binding.goalTurnId,
          evidenceId: `pending_${binding.goalTurnId}_${index}`,
          record,
          recordedAt: this.now(),
        }));
        const settle = async (readiness: 'ready' | 'waiting_children' | 'children_need_attention' | 'superseded'): Promise<GoalState | null> => {
        let terminalDecision: Parameters<GoalService['settleTurn']>[1]['terminalDecision'] = { kind: 'none' };
        if (readiness === 'ready' && terminalEvent.status === 'completed' && completeSummary) {
          const evaluation = new GoalCompletionEvaluator().evaluate(
            document.state,
            [...document.evidence, ...proposed],
          );
          if (evaluation.ok) {
            terminalDecision = readInstalledCurrentOwner({ ownerKind: 'goal', ownerId: document.state.goalId }).kind === 'ordinary'
              ? { kind: 'complete', reason: completeSummary }
              : { kind: 'publication_pending', intentId: completeClaim!.intentId };
          }
        } else if (readiness === 'ready' && terminalEvent.status === 'completed' && blockerClaim) {
          terminalDecision = { kind: 'blocker', ...blockerClaim };
        } else if (terminalEvent.status !== 'completed' && cancelReason !== 'superseded_by_user') {
          terminalDecision = {
            kind: 'paused',
            reason: terminalEvent.status === 'cancelled' ? 'task_cancelled' : 'runtime_error',
          };
        }

        const state = await this.service.settleTurn(
          this.context(binding.threadId, 'runtime', document.state.revision),
          {
            turnId: binding.goalTurnId,
            tokensUsed: input.snapshot.usage?.known
              ? input.snapshot.usage.inputTokens + input.snapshot.usage.outputTokens
              : 0,
            activeWallClockMs: Math.max(0, input.snapshot.updatedAt - input.snapshot.createdAt),
            evidence,
            terminalDecision,
          },
        );
        if (terminalDecision.kind === 'publication_pending') {
          this.activation.delete(binding.threadId);
          publications.push({ intentId: terminalDecision.intentId, action: 'start' });
        }
        const projection = this.publishProjection(binding.threadId, state);
        if (state.status !== 'active') this.activation.delete(binding.threadId);
        if (
          projection.activation === 'armed'
          && state.status === 'active'
          && !this.userQueuePending.has(binding.threadId)
          && readiness === 'ready'
        ) {
          return state;
        }
        return null;
        };
        const continuation = this.options.multiAgent
          ? await this.options.multiAgent.withGoalDecision(input.taskId, settle) : await settle('ready');
        if (continuation && this.isArmed(binding.threadId, continuation.goalId)) {
          this.assertExecutionAdmission(binding.threadId, permissionRevision);
          nextContinuation = continuation;
        }
      });
      if (nextContinuation) {
        const continuation: GoalState = nextContinuation;
        const observed = await this.observeGoalExecution(binding.threadId, continuation, permissionRevision);
        await this.withThread(binding.threadId, async () => {
          await observed();
          if (!this.isArmed(binding.threadId, continuation.goalId) || this.userQueuePending.has(binding.threadId)) return;
          const continuationInput = this.buildGoalTaskInput(binding.threadId, continuation, 'continuation');
          const prepare = async (readiness: 'ready' | 'waiting_children' | 'children_need_attention' | 'superseded') => {
            if (readiness !== 'ready') return;
            await this.prepareGoalTask(binding.threadId, continuation, 'continuation', permissionRevision,
              { kind: 'automatic', predecessorTaskId }, undefined, true, continuationInput);
          };
          if (this.options.multiAgent) await this.options.multiAgent.withGoalDecision(input.taskId, prepare, continuationInput); else await prepare('ready');
        });
      }
      // Native authorization and receiver reads must never hold the thread queue.
      for (const publication of publications) await this.finishGoalPublication(binding.threadId, publication, publicationEpoch, permissionRevision);
      });
  }

  /** Main-only user controls; renderer cannot select a claim or forge a source. */
  async recoverGoalPublication(input: { threadId: string; requestSource: 'user' | 'agent' | 'scheduler' }): Promise<DesktopGoalProjection | null> {
    return this.withOperation(async () => {
      const publicationEpoch = this.publicationEpoch;
      if (input.requestSource !== 'user') throw Error('goal_publication_source');
      const permissionRevision = this.captureExecutionRevision();
      return this.withPublication(input.threadId, async () => {
        const document = await this.service.load(input.threadId), intentId = document?.state.pendingCompletionIntentId;
        if (intentId && (await this.options.store.listCompletionAttempts(input.threadId, intentId)).length) {
          await this.finishGoalPublication(input.threadId, { intentId, action: 'recover' }, publicationEpoch, permissionRevision, 'user');
        }
        return this.getGoal(input.threadId);
      });
      });
  }

  async continueGoalPublication(input: { threadId: string; requestSource: 'user' | 'agent' | 'scheduler' }): Promise<DesktopGoalProjection | null> {
    return this.withOperation(async () => {
      const publicationEpoch = this.publicationEpoch;
      if (input.requestSource !== 'user') throw Error('goal_publication_source');
      const permissionRevision = this.captureExecutionRevision();
      return this.withPublication(input.threadId, async () => {
        const publication = await this.withThread(input.threadId, async () => {
          this.assertPublicationEpoch(publicationEpoch);
          this.assertExecutionAdmission(input.threadId, permissionRevision);
          const document = await this.requireDocument(input.threadId), intentId = document.state.pendingCompletionIntentId;
          if (!intentId || !['active', 'paused', 'blocked'].includes(document.state.status)) throw Error('goal_publication_not_pending');
          const attempts = await this.options.store.listCompletionAttempts(input.threadId, intentId), latest = attempts.at(-1);
          this.assertPublicationEpoch(publicationEpoch);
          this.assertExecutionAdmission(input.threadId, permissionRevision);
          const state = document.state.status === 'active' ? document.state
            : await this.service.resumePublication(this.context(input.threadId, 'user', document.state.revision));
          this.assertPublicationEpoch(publicationEpoch);
          this.activation.delete(input.threadId);
          this.publishProjection(input.threadId, state);
          const action = !latest ? 'start' as const
            : ['not_prepared', 'not_approved', 'cancelled'].includes(latest.status) ? 'retry' as const : 'recover' as const;
          return { intentId, action };
        });
        await this.finishGoalPublication(input.threadId, publication, publicationEpoch, permissionRevision, 'user');
        return this.getGoal(input.threadId);
      });
      });
  }

  private assertPublicationEpoch(epoch: number): void {
    this.assertOpen();
    if (epoch !== this.publicationEpoch) throw Error('goal_publication_disarmed');
  }

  private async withPublication<T>(threadId: string, work: () => Promise<T>): Promise<T> {
    this.publicationThreads.set(threadId, (this.publicationThreads.get(threadId) ?? 0) + 1);
    try { return await work(); }
    finally {
      const remaining = this.publicationThreads.get(threadId)! - 1;
      if (remaining) this.publicationThreads.set(threadId, remaining); else this.publicationThreads.delete(threadId);
      this.notifyDrain();
    }
  }

  private async finishGoalPublication(threadId: string, publication: { intentId: string; action: 'start' | 'recover' | 'retry' }, epoch: number, permissionRevision?: number, requestSource: 'user' | 'scheduler' = 'scheduler'): Promise<void> {
    const assertAdmission = () => {
      this.assertPublicationEpoch(epoch);
      this.assertExecutionAdmission(threadId, permissionRevision);
    };
    return this.withPublication(threadId, async () => {
      this.assertPublicationEpoch(epoch);
      const attempt = await createGoalPublicationWorkflow({ store: this.options.store, now: this.now,
        assertAdmission,
      }).run({ sessionId: threadId, intentId: publication.intentId, requestSource, action: publication.action });
      if (attempt.status !== 'committed' || this.closed) return;
      const document = await this.service.load(threadId);
      if (!document || document.state.status !== 'active' || document.state.pendingCompletionIntentId !== publication.intentId) return;
      const captured = JSON.stringify(document.state);
      try {
        const prepared = await this.service.prepareClaimCompletion(this.context(threadId, 'runtime', document.state.revision), publication.intentId);
        await this.withThread(threadId, async () => {
          const current = await this.service.load(threadId);
          if (!current || JSON.stringify(current.state) !== captured) return;
          assertAdmission();
          const state = await prepared.commit();
          this.activation.delete(threadId);
          this.publishProjection(threadId, state);
        });
      } catch (error) {
        // A pause/replace wins; the original committed attempt stays historical.
        const current = await this.service.load(threadId);
        if (current && JSON.stringify(current.state) === captured) throw error;
      }
    });
  }

  /** Consume an inspected, committed recovery terminal without arming or running.
   * The service owns the recovery handle until this full persistence receipt. */
  async handleRecoveredHostTerminal(input: HostDeliveryRecoveryReceipt): Promise<void> {
    return this.withOperation(async () => {
      const authorize = this.options.authorizeRecoveredDelivery;
      if (!authorize) throw new Error('Goal delivery recovery authorization is unavailable');
      authorize(input);
      // Keep the opaque handle itself; capture every data field before the queue
      // yields so a caller cannot change the task, usage or scope after admission.
      const { authority, ...payload } = input;
      const captured: HostDeliveryRecoveryReceipt = { ...structuredClone(payload), authority };
      const { event, snapshot } = captured;
      const scope = snapshot.executionScope;
      if (event.type !== 'task_terminal' || snapshot.taskId !== captured.taskId
        || snapshot.status !== event.status || scope?.kind !== 'goal_turn') {
        throw new Error('Goal delivery recovery requires a bound committed terminal');
      }
      const binding = this.requireTaskBinding(captured.taskId);
      await this.withThread(binding.threadId, async () => {
        authorize(captured);
        const current = this.requireTaskBinding(captured.taskId);
        if (current.threadId !== binding.threadId || current.threadId !== scope.threadId
          || current.goalId !== scope.goalId || current.epoch !== scope.epoch
          || current.goalTurnId !== scope.goalTurnId || current.origin !== scope.origin) {
          throw new Error('Goal delivery recovery task scope mismatch');
        }
        const document = await this.service.load(current.threadId);
        authorize(captured);
        if (!document || document.state.goalId !== current.goalId || document.state.epoch !== current.epoch
          || document.state.status !== 'active' || document.turns.some(turn => turn.turnId === current.goalTurnId)) return;
        const evidence = collectEvidence(document.state, current, snapshot);
        let terminalDecision: Parameters<GoalService['settleTurn']>[1]['terminalDecision'] = event.status === 'completed'
          ? { kind: 'none' }
          : { kind: 'paused', reason: event.status === 'cancelled' ? 'task_cancelled' : 'runtime_error' };
        const application = canonicalVerificationJson(goalApplicationFromState(document.state));
        const claim = document.completionIntents?.find(intent => intent.status === 'claimed'
          && intent.taskId === captured.taskId && intent.turnId === current.goalTurnId
          && canonicalVerificationJson(intent.application) === application);
        if (event.status === 'completed' && claim) {
          const proposed: GoalEvidenceEnvelope[] = evidence.map((record, index) => ({
            goalId: document.state.goalId, epoch: document.state.epoch, goalTurnId: current.goalTurnId,
            evidenceId: `pending_${current.goalTurnId}_${index}`, record, recordedAt: this.now(),
          }));
          const evaluation = new GoalCompletionEvaluator().evaluate(document.state, [...document.evidence, ...proposed]);
          if (evaluation.ok) {
            terminalDecision = readInstalledCurrentOwner({ ownerKind: 'goal', ownerId: document.state.goalId }).kind === 'ordinary'
              ? { kind: 'complete', reason: claim.summary }
              : { kind: 'publication_pending', intentId: claim.intentId };
          }
        }
        // This recovery only records the original terminal and claim. Even a
        // final-budget protected completion waits for an explicit user action;
        // no attempt, prepare request or native approval starts here.
        authorize(captured);
        this.assertOpen();
        const state = await this.service.settleTurn(
          this.context(current.threadId, 'runtime', document.state.revision),
          {
            turnId: current.goalTurnId,
            tokensUsed: snapshot.usage?.known ? snapshot.usage.inputTokens + snapshot.usage.outputTokens : 0,
            activeWallClockMs: Math.max(0, snapshot.updatedAt - snapshot.createdAt),
            evidence,
            terminalDecision,
          },
        );
        this.activation.delete(current.threadId);
        this.publishProjection(current.threadId, state);
      });
      });
  }

  getPendingAttachmentForTest(threadId: string): PreparedGoalTask | null {
    const pending = this.pendingByThread.get(threadId);
    return pending ? stripTimeout(pending) : null;
  }

  /** Main-only deletion settlement; not registered as an agent tool or IPC. */
  async stopForThreadDeletion(input: { threadId: string; requestSource: 'user' | 'agent' | 'scheduler' }): Promise<void> {
    return this.withOperation(async () => {
      if (input.requestSource !== 'user') throw new Error('thread deletion source is not permitted');
      await this.withThread(input.threadId, async () => {
        const { threadId } = input;
        this.activation.delete(threadId);
        this.userQueuePending.delete(threadId);
        this.pendingBlocked.delete(threadId);
        await this.cancelPending(threadId, 'thread_deleted');
        await this.cancelRunningGoalTask(threadId, 'thread_deleted');
        const document = await this.service.load(threadId);
        if (document && !['complete', 'cancelled'].includes(document.state.status)) {
          const state = await this.service.cancel(this.context(threadId, 'user', document.state.revision), 'thread_deleted');
          this.publishProjection(threadId, state);
        }
      });
      });
  }

  disarmAll(): void {
    this.publicationEpoch++;
    this.activation.clear();
    for (const pending of this.pendingByThread.values()) clearTimeout(pending.timeout);
    this.pendingByThread.clear();
    this.contextRunningByThread.clear();
    this.contextTaskThread.clear();
    this.discardedGoalTaskIds.clear();
  }

  /** Fixed main user callback. The service has already fenced the execution
   * domain; this coordinator only withdraws Goal admission and persists pauses. */
  async stopForWorkspaceExecutionRevocation(input: { requestSource: 'user' | 'agent' | 'scheduler' }): Promise<void> {
    return this.withOperation(async () => {
      if (input.requestSource !== 'user') throw new Error('workspace Goal stop source is not permitted');
      const threads = new Set([
        ...this.activation.keys(), ...this.pendingByThread.keys(), ...this.runningByThread.keys(),
        ...this.contextRunningByThread.keys(), ...this.threadChains.keys(), ...this.publicationThreads.keys(),
      ]);
      const pending = new Map(this.pendingByThread);
      // No await before disarming. Queued/awaiting work retains its captured
      // service revision, so a later grant cannot re-arm the old invocation.
      this.activation.clear();
      for (const attachment of pending.values()) clearTimeout(attachment.timeout);
      this.pendingByThread.clear();
      this.runningByThread.clear();
      this.contextRunningByThread.clear();
      this.contextTaskThread.clear();
      this.userQueuePending.clear();
      this.pendingBlocked.clear();
      const outcomes = await Promise.allSettled([...threads].map(threadId => this.withThread(threadId, async () => {
        const attachment = pending.get(threadId);
        if (attachment) await this.cancelDiscardedGoalTask(attachment.taskId, 'permission_revoked');
        const document = await this.service.load(threadId);
        // The existing reducer only pauses active Goals. Already stopped and
        // terminal Goals keep their reason and identity, including cold history.
        if (document?.state.status !== 'active') return;
        const state = await this.service.pause(this.context(threadId, 'user', document.state.revision), 'permission_revoked');
        this.publishProjection(threadId, state);
      })));
      const failed = outcomes.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failed) throw failed.reason;
      });
  }

  private async prepareGoalTask(
    threadId: string,
    state: GoalState,
    origin: GoalTurnExecutionScope['origin'],
    permissionRevision: number | undefined,
    attachmentSource: GoalAttachmentSource,
    prompt?: string,
    applicationObserved = false,
    continuationInput?: TaskCreateInput,
  ): Promise<PreparedGoalTask> {
    this.assertNoNativePending(threadId);
    if (state.pendingCompletionIntentId) throw Error('goal_publication_pending');
    if (!applicationObserved && readInstalledCurrentOwner({ ownerKind: 'goal', ownerId: state.goalId }).kind !== 'ordinary')
      throw Error('goal_application_observation_required');
    this.assertExecutionAdmission(threadId, permissionRevision);
    if (this.pendingByThread.has(threadId) || this.runningByThread.has(threadId)) {
      throw new Error('A Goal task is already pending or running');
    }
    const taskInput = continuationInput ?? this.buildGoalTaskInput(threadId, state, origin, prompt);
    const executionScope = taskInput.executionScope;
    if (executionScope?.kind !== 'goal_turn' || executionScope.goalId !== state.goalId || executionScope.epoch !== state.epoch
      || executionScope.origin !== origin || executionScope.threadId !== threadId) throw Error('goal_continuation_source_mismatch');
    const prepared = await this.options.taskHost.prepareTask(taskInput);
    const compensation = this.assertPreparedAdmission(threadId, permissionRevision, prepared.taskId);
    if (compensation) await compensation;
    this.options.store.bindTask({ ...scopeToBinding(executionScope, prepared.taskId), attachedAt: null });
    const attachmentId = this.options.createAttachmentId?.() ?? `goal_attachment_${randomUUID()}`;
    const expiresAt = this.now() + (this.options.attachmentTimeoutMs ?? 30_000);
    const timeout = setTimeout(() => {
      if (!this.closed) void this.expireAttachment(threadId, attachmentId).catch(error => {
        if (!(error instanceof Error) || error.message !== 'goal_coordinator_closed') throw error;
      });
    }, this.options.attachmentTimeoutMs ?? 30_000);
    timeout.unref?.();
    const pending: PendingAttachment = {
      attachmentId, threadId, taskId: prepared.taskId, executionScope,
      goalRef: { goalId: state.goalId, revision: state.revision },
      expiresAt, timeout, permissionRevision,
      attachmentSource,
    };
    this.pendingByThread.set(threadId, pending);
    const published = stripTimeout(pending);
    this.assertExecutionAdmission(threadId, permissionRevision);
    this.options.publishGoalTaskPrepared?.(published);
    return stripTimeout(pending);
  }

  private buildGoalTaskInput(threadId: string, state: GoalState, origin: GoalTurnExecutionScope['origin'], prompt?: string): TaskCreateInput {
    const executionScope = this.createScope(threadId, state, origin);
    const goalContext = buildGoalContextBlock(state);
    const contextText = goalContext.type === 'text' ? goalContext.text : '';
    const continuationPrompt = [
      prompt ?? '[system_trigger: goal_continuation]',
      '[system_trigger: goal_continuation]',
      contextText,
      prompt ? 'Work on the user request as the next admitted Goal turn.'
        : 'Continue the current Goal by performing the next highest-value verifiable action.',
    ].join('\n');
    return {
      prompt: continuationPrompt,
      materials: [],
      context: this.mainOwnedContext(threadId),
      executionScope,
    };
  }

  private async expireAttachment(threadId: string, attachmentId: string): Promise<void> {
    await this.withThread(threadId, async () => {
      const pending = this.pendingByThread.get(threadId);
      if (!pending || pending.attachmentId !== attachmentId) return;
      this.pendingByThread.delete(threadId);
      await this.cancelDiscardedGoalTask(pending.taskId, 'thread_attachment_timeout');
      const document = await this.requireDocument(threadId);
      if (document.state.status === 'active') {
        const state = await this.service.pause(
          this.context(threadId, 'runtime', document.state.revision),
          'thread_attachment_timeout',
        );
        this.activation.delete(threadId);
        this.publishProjection(threadId, state);
      }
    });
  }

  private async cancelPending(threadId: string, reason: string): Promise<void> {
    const pending = this.pendingByThread.get(threadId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingByThread.delete(threadId);
    await this.cancelDiscardedGoalTask(pending.taskId, reason);
  }

  private async cancelRunningGoalTask(threadId: string, reason: string): Promise<void> {
    const taskId = this.runningByThread.get(threadId);
    if (!taskId) return;
    await this.cancelDiscardedGoalTask(taskId, reason);
    if (this.runningByThread.get(threadId) === taskId) {
      this.runningByThread.delete(threadId);
    }
  }

  private async cancelDiscardedGoalTask(taskId: string, reason: string): Promise<void> {
    this.discardedGoalTaskIds.add(taskId);
    try {
      await this.options.taskHost.cancelTask(taskId, reason);
    } catch (error) {
      this.discardedGoalTaskIds.delete(taskId);
      throw error;
    }
  }

  private async prepareBindStart(input: TaskCreateInput, permissionRevision?: number, reservation?:TaskIdentityReservation,guard?:()=>void): Promise<{ taskId: string; understanding?: TaskUnderstanding }> {
    if(reservation&&!this.options.taskHost.prepareReservedTask)throw Error('background_reserved_prepare_unavailable');
    const prepared = reservation?await this.options.taskHost.prepareReservedTask!(input,reservation):await this.options.taskHost.prepareTask(input);
    const threadId = input.context?.threadId;
    if (threadId) {
      const compensation = this.assertPreparedAdmission(threadId, permissionRevision, prepared.taskId,guard);
      if (compensation) await compensation;
    }
    await this.options.taskHost.startTask(prepared.taskId);
    if (threadId) this.assertExecutionAdmission(threadId, permissionRevision);
    return prepared;
  }

  private captureExecutionRevision(): number | undefined {
    this.assertOpen();
    return this.options.multiAgent?.getExecutionAuthorization().permissionRevision;
  }

  private assertExecutionAdmission(threadId: string, permissionRevision: number | undefined): void {
    this.assertOpen();
    this.options.multiAgent?.assertExecutionAdmission(threadId, permissionRevision);
  }

  private assertPreparedAdmission(threadId: string, permissionRevision: number | undefined, taskId: string,guard?:()=>void): Promise<never> | undefined {
    // Success remains synchronous with bind/publish/start. Await only a denied
    // task's actual cancellation, never introduce a post-check microtask gap.
    try { guard?.();this.assertExecutionAdmission(threadId, permissionRevision); this.assertNoNativePending(threadId); return undefined; }
    catch (error) {
      return this.cancelDiscardedGoalTask(taskId, 'permission_revoked').then(() => { throw error; });
    }
  }

  private async assertThreadAdmission(threadId: string, permissionRevision: number | undefined): Promise<void> {
    this.assertExecutionAdmission(threadId, permissionRevision);
    await this.options.prepareThread?.(threadId);
    this.options.multiAgent?.assertThreadAdmission(threadId);
    this.assertExecutionAdmission(threadId, permissionRevision);
  }

  private createScope(
    threadId: string,
    state: GoalState,
    origin: GoalTurnExecutionScope['origin'],
  ): GoalTurnExecutionScope {
    return {
      kind: 'goal_turn', origin, goalId: state.goalId, epoch: state.epoch,
      goalTurnId: `goal_turn_${randomUUID()}`, threadId,
    };
  }

  private mainOwnedContext(threadId: string): TaskCreateInput['context'] {
    return {
      threadId,
      taskIds: this.options.store.listThreadTaskIds(threadId),
    };
  }

  private context(threadId: string, requestSource: 'user' | 'runtime', expectedRevision: number | null) {
    return {
      sessionId: threadId,
      instanceId: this.options.instanceId,
      requestSource,
      expectedRevision,
    } as const;
  }

  private async requireDocument(threadId: string): Promise<GoalDocument> {
    const document = await this.service.load(threadId);
    if (!document) {
      this.activation.delete(threadId);
      throw new Error('Goal not found');
    }
    return document;
  }

  private requireTaskBinding(taskId: string): GoalTaskBinding {
    const binding = this.options.store.getTaskBinding(taskId);
    if (!binding) throw new Error('Task is not bound to a Goal turn');
    return binding;
  }

  private requireCurrentGoalTask(taskId: string): GoalTaskBinding {
    this.assertOpen();
    const binding = this.requireTaskBinding(taskId);
    if (this.runningByThread.get(binding.threadId) !== taskId) {
      throw new Error('Task is not the current running Goal turn');
    }
    return binding;
  }

  private isArmed(threadId: string, goalId: string): boolean {
    const activation = this.activation.get(threadId);
    return activation?.armed === true && activation.goalId === goalId;
  }

  private publishProjection(threadId: string, state: GoalState): DesktopGoalProjection {
    const goal = {
      currentCompletion: unobservedGoalCompletion(state),
      state,
      activation: this.isArmed(threadId, state.goalId) ? 'armed' as const : 'disarmed' as const,
      ...this.waitingProjection(threadId, state),
    };
    if (!this.closed) this.options.publishGoalChanged?.({ threadId, goal });
    return goal;
  }

  private waitingProjection(threadId: string, state: GoalState): Pick<DesktopGoalProjection, 'waitingReason'> {
    const readiness = state.status === 'active' ? this.options.multiAgent?.goalReadiness(threadId) : undefined;
    return readiness && readiness !== 'ready' ? { waitingReason: readiness } : {};
  }

  private withThread<T>(threadId: string, action: () => Promise<T>): Promise<T> {
    this.assertOpen();
    const previous = this.threadChains.get(threadId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => { this.assertOpen(); return action(); });
    this.threadChains.set(threadId, next);
    return next.finally(() => {
      if (this.threadChains.get(threadId) === next) this.threadChains.delete(threadId);
      this.notifyDrain();
    });
  }
}

function stripTimeout(pending: PendingAttachment): PreparedGoalTask {
  const { timeout: _timeout, permissionRevision: _permissionRevision, ...result } = pending;
  return { ...result, attachmentSource: { ...pending.attachmentSource } };
}

function scopeToBinding(scope: GoalTurnExecutionScope, taskId: string): Omit<GoalTaskBinding, 'ordinal' | 'attachedAt'> {
  return {
    goalId: scope.goalId, epoch: scope.epoch, goalTurnId: scope.goalTurnId,
    threadId: scope.threadId, taskId, origin: scope.origin,
  };
}

function collectEvidence(
  goal: GoalState,
  binding: GoalTaskBinding,
  snapshot: TaskSnapshot,
): Array<GoalEvidenceEnvelope['record']> {
  const records: Array<GoalEvidenceEnvelope['record']> = [];
  const answer = snapshot.events
    .filter((event): event is Extract<typeof event, { type: 'assistant_delta' }> => event.type === 'assistant_delta')
    .map(event => event.delta)
    .join('')
    .trim();
  if (answer) {
    records.push({
      ownerKind: 'goal', ownerId: goal.goalId, kind: 'answer',
      summary: 'Goal turn produced a non-empty final response',
      metadata: { responseId: binding.taskId },
    });
  }
  const facts = new Map<string, Extract<TaskSnapshot['events'][number], { type: 'goal_tool_fact' }>>();
  const finished = new Map<string, Extract<TaskSnapshot['events'][number], { type: 'goal_tool_finished' }>>();
  for (const event of snapshot.events) {
    if (event.type === 'goal_tool_fact') facts.set(event.invocationId, event);
    if (event.type === 'goal_tool_finished') finished.set(event.invocationId, event);
  }
  for (const [invocationId, fact] of facts) {
    if (!finished.get(invocationId)?.ok) continue;
    if (fact.factKind === 'command_result' && fact.exitCode === 0) {
      records.push({
        ownerKind: 'goal', ownerId: goal.goalId, kind: 'command_action',
        summary: `${fact.toolName} exited successfully`,
        metadata: { commands: [{ command: fact.toolName, summary: 'completed', exitCode: 0 }] },
      });
    }
    if (fact.factKind === 'file_mutation' && fact.normalizedFilePaths?.length) {
      records.push({
        ownerKind: 'goal', ownerId: goal.goalId, kind: 'file_artifact',
        summary: fact.normalizedFilePaths.join(', '), uri: fact.normalizedFilePaths[0],
        metadata: { paths: fact.normalizedFilePaths },
      });
    }
  }
  return records;
}

function findCancellationReason(snapshot: TaskSnapshot): string | undefined {
  for (let index = snapshot.events.length - 1; index >= 0; index -= 1) {
    const event = snapshot.events[index];
    if (event?.type === 'task_cancelled') return event.reason;
  }
  return undefined;
}
