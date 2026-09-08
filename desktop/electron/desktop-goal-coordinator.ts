import { randomUUID } from 'node:crypto';
import { GoalCompletionEvaluator } from '../../src/runtime/goal/completion-evaluator.js';
import { buildGoalContextBlock } from '../../src/runtime/goal/prompt.js';
import { GoalService } from '../../src/runtime/goal/service.js';
import type {
  GoalActivation,
  GoalDocument,
  GoalEvidenceEnvelope,
  GoalInput,
  GoalState,
} from '../../src/runtime/goal/types.js';
import type { GoalToolHost } from '../../src/ai/tools/goal.js';
import type { ToolExecutionContext } from '../../src/types.js';
import type { PersistedTaskEvent } from '../../src/runtime/task-host/task-runtime-host.js';
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
  startTask(taskId: string): Promise<void>;
  cancelTask(taskId: string, reason?: string): Promise<void>;
}

export interface DesktopGoalProjection {
  state: GoalState;
  activation: GoalActivation;
  waitingReason?: 'waiting_children' | 'children_need_attention';
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

export interface DesktopGoalCoordinatorOptions {
  store: SqliteGoalStore;
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
  private readonly pendingComplete = new Map<string, string>();
  private readonly pendingBlocked = new Map<string, { reason: string; fingerprint: string }>();
  private readonly threadChains = new Map<string, Promise<unknown>>();

  constructor(private readonly options: DesktopGoalCoordinatorOptions) {
    this.now = options.now ?? Date.now;
    this.service = new GoalService({
      store: options.store,
      ownership: { assertOwned: () => undefined },
      now: this.now,
    });
  }

  async getGoal(threadId: string): Promise<DesktopGoalProjection | null> {
    const document = await this.service.load(threadId);
    if (!document) {
      this.activation.delete(threadId);
      return null;
    }
    return {
      state: document.state,
      activation: this.isArmed(threadId, document.state.goalId) ? 'armed' : 'disarmed',
      ...this.waitingProjection(threadId, document.state),
    };
  }

  async createGoal(input: { threadId: string } & GoalInput & GoalAttachmentRequest): Promise<{
    goal: DesktopGoalProjection;
    preparedTask: PreparedGoalTask;
  }> {
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
  }

  async pauseGoal(input: { threadId: string }): Promise<DesktopGoalProjection> {
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
  }

  async resumeGoal(input: { threadId: string; turnLimit?: number } & GoalAttachmentRequest): Promise<{
    goal: DesktopGoalProjection;
    preparedTask: PreparedGoalTask;
  }> {
    const attachmentSource: GoalAttachmentSource = { kind: 'request', requestId: parseGoalRequestId(input.requestId) ?? null };
    const permissionRevision = this.captureExecutionRevision();
    return this.withThread(input.threadId, async () => {
      await this.assertThreadAdmission(input.threadId, permissionRevision);
      this.assertExecutionAdmission(input.threadId, permissionRevision);
      if (this.contextRunningByThread.has(input.threadId)) {
        throw new Error('Cannot resume a Goal while a paused user task is still running');
      }
      const document = await this.requireDocument(input.threadId);
      this.assertExecutionAdmission(input.threadId, permissionRevision);
      const state = await this.service.resume(
        this.context(input.threadId, 'user', document.state.revision),
        input.turnLimit === undefined ? {} : { turnLimit: input.turnLimit },
      );
      this.assertExecutionAdmission(input.threadId, permissionRevision);
      this.activation.set(input.threadId, { goalId: state.goalId, armed: true, permissionRevision });
      const preparedTask = await this.prepareGoalTask(input.threadId, state, 'continuation', permissionRevision, attachmentSource);
      this.assertExecutionAdmission(input.threadId, permissionRevision);
      return { goal: this.publishProjection(input.threadId, state), preparedTask };
    });
  }

  async cancelGoal(input: { threadId: string }): Promise<DesktopGoalProjection> {
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
  }

  async replaceGoal(input: { threadId: string } & GoalInput & GoalAttachmentRequest): Promise<{
    goal: DesktopGoalProjection;
    preparedTask: PreparedGoalTask;
  }> {
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
  }

  async admitUserTask(input: TaskCreateInput): Promise<{ taskId: string; understanding?: TaskUnderstanding }> {
    const threadId = input.context?.threadId;
    if (!threadId) return this.prepareBindStart(input);
    const permissionRevision = this.captureExecutionRevision();
    return this.withThread(threadId, async () => {
      await this.assertThreadAdmission(threadId, permissionRevision);
      this.assertExecutionAdmission(threadId, permissionRevision);
      const document = await this.service.load(threadId);
      this.assertExecutionAdmission(threadId, permissionRevision);
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
      this.runningByThread.set(threadId, prepared.taskId);
      this.userQueuePending.delete(threadId);
      this.assertExecutionAdmission(threadId, permissionRevision);
      await this.options.taskHost.startTask(prepared.taskId);
      this.assertExecutionAdmission(threadId, permissionRevision);
      return prepared;
    });
  }

  async ackGoalTaskAttached(input: { threadId: string; attachmentId: string }): Promise<void> {
    const permissionRevision = this.captureExecutionRevision();
    await this.withThread(input.threadId, async () => {
      await this.assertThreadAdmission(input.threadId, permissionRevision);
      this.assertExecutionAdmission(input.threadId, permissionRevision);
      const pending = this.pendingByThread.get(input.threadId);
      if (!pending || pending.attachmentId !== input.attachmentId) {
        throw new Error('Goal task attachment is missing, stale, or belongs to another thread');
      }
      const document = await this.requireDocument(input.threadId);
      this.assertExecutionAdmission(input.threadId, permissionRevision);
      this.assertExecutionAdmission(input.threadId, pending.permissionRevision);
      if (
        document.state.goalId !== pending.goalRef.goalId
        || document.state.revision !== pending.goalRef.revision
        || !this.isArmed(input.threadId, document.state.goalId)
        || this.userQueuePending.has(input.threadId)
        || this.runningByThread.has(input.threadId)
      ) {
        throw new Error('Goal task attachment is no longer admissible');
      }
      clearTimeout(pending.timeout);
      this.pendingByThread.delete(input.threadId);
      this.options.store.markTaskAttached(pending.taskId, this.now());
      this.runningByThread.set(input.threadId, pending.taskId);
      this.assertExecutionAdmission(input.threadId, pending.permissionRevision);
      await this.options.taskHost.startTask(pending.taskId);
      this.assertExecutionAdmission(input.threadId, pending.permissionRevision);
    });
  }

  async setUserQueuePending(input: { threadId: string; pending: boolean }): Promise<void> {
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
  }

  createGoalToolHost(taskId: string): GoalToolHost {
    return {
      getGoal: async () => {
        const binding = this.requireTaskBinding(taskId);
        return this.getGoal(binding.threadId);
      },
      requestComplete: async (summary) => {
        this.requireCurrentGoalTask(taskId);
        this.pendingComplete.set(taskId, summary);
        return { accepted: true };
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
    await this.withThread(binding.threadId, async () => {
      if (this.discardedGoalTaskIds.delete(input.taskId)) {
        if (this.runningByThread.get(binding.threadId) === input.taskId) {
          this.runningByThread.delete(binding.threadId);
        }
        this.pendingComplete.delete(input.taskId);
        this.pendingBlocked.delete(input.taskId);
        return;
      }
      const document = await this.requireDocument(binding.threadId);
      if (document.state.goalId !== binding.goalId || document.state.epoch !== binding.epoch) {
        return;
      }
      if (document.turns.some(turn => turn.turnId === binding.goalTurnId)) return;
      const cancelReason = findCancellationReason(input.snapshot);
      const completeSummary = this.pendingComplete.get(input.taskId);
      this.pendingComplete.delete(input.taskId);
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
        if (evaluation.ok) terminalDecision = { kind: 'complete', reason: completeSummary };
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
        await this.prepareGoalTask(binding.threadId, continuation, 'continuation', permissionRevision,
          { kind: 'automatic', predecessorTaskId });
      }
    });
  }

  /** Consume an inspected, committed recovery terminal without arming or running.
   * The service owns the recovery handle until this full persistence receipt. */
  async handleRecoveredHostTerminal(input: HostDeliveryRecoveryReceipt): Promise<void> {
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
      // Reuse the ordinary settlement reducer for real usage, duration, evidence
      // and turn-budget precedence. No completion evaluator or pending claims.
      const state = await this.service.settleTurn(
        this.context(current.threadId, 'runtime', document.state.revision),
        {
          turnId: current.goalTurnId,
          tokensUsed: snapshot.usage?.known ? snapshot.usage.inputTokens + snapshot.usage.outputTokens : 0,
          activeWallClockMs: Math.max(0, snapshot.updatedAt - snapshot.createdAt),
          evidence: collectEvidence(document.state, current, snapshot),
          terminalDecision: event.status === 'completed' ? { kind: 'none' }
            : { kind: 'paused', reason: event.status === 'cancelled' ? 'task_cancelled' : 'runtime_error' },
        },
      );
      this.activation.delete(current.threadId);
      this.publishProjection(current.threadId, state);
    });
  }

  getPendingAttachmentForTest(threadId: string): PreparedGoalTask | null {
    const pending = this.pendingByThread.get(threadId);
    return pending ? stripTimeout(pending) : null;
  }

  /** Main-only deletion settlement; not registered as an agent tool or IPC. */
  async stopForThreadDeletion(input: { threadId: string; requestSource: 'user' | 'agent' | 'scheduler' }): Promise<void> {
    if (input.requestSource !== 'user') throw new Error('thread deletion source is not permitted');
    await this.withThread(input.threadId, async () => {
      const { threadId } = input;
      this.activation.delete(threadId);
      this.userQueuePending.delete(threadId);
      this.pendingComplete.delete(threadId);
      this.pendingBlocked.delete(threadId);
      await this.cancelPending(threadId, 'thread_deleted');
      await this.cancelRunningGoalTask(threadId, 'thread_deleted');
      const document = await this.service.load(threadId);
      if (document && !['complete', 'cancelled'].includes(document.state.status)) {
        const state = await this.service.cancel(this.context(threadId, 'user', document.state.revision), 'thread_deleted');
        this.publishProjection(threadId, state);
      }
    });
  }

  disarmAll(): void {
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
    if (input.requestSource !== 'user') throw new Error('workspace Goal stop source is not permitted');
    const threads = new Set([
      ...this.activation.keys(), ...this.pendingByThread.keys(), ...this.runningByThread.keys(),
      ...this.contextRunningByThread.keys(), ...this.threadChains.keys(),
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
    this.pendingComplete.clear();
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
  }

  private async prepareGoalTask(
    threadId: string,
    state: GoalState,
    origin: GoalTurnExecutionScope['origin'],
    permissionRevision: number | undefined,
    attachmentSource: GoalAttachmentSource,
    prompt?: string,
  ): Promise<PreparedGoalTask> {
    this.assertExecutionAdmission(threadId, permissionRevision);
    if (this.pendingByThread.has(threadId) || this.runningByThread.has(threadId)) {
      throw new Error('A Goal task is already pending or running');
    }
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
    const prepared = await this.options.taskHost.prepareTask({
      prompt: continuationPrompt,
      materials: [],
      context: this.mainOwnedContext(threadId),
      executionScope,
    });
    const compensation = this.assertPreparedAdmission(threadId, permissionRevision, prepared.taskId);
    if (compensation) await compensation;
    this.options.store.bindTask({ ...scopeToBinding(executionScope, prepared.taskId), attachedAt: null });
    const attachmentId = this.options.createAttachmentId?.() ?? `goal_attachment_${randomUUID()}`;
    const expiresAt = this.now() + (this.options.attachmentTimeoutMs ?? 30_000);
    const timeout = setTimeout(() => {
      void this.expireAttachment(threadId, attachmentId);
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

  private async prepareBindStart(input: TaskCreateInput, permissionRevision?: number): Promise<{ taskId: string; understanding?: TaskUnderstanding }> {
    const prepared = await this.options.taskHost.prepareTask(input);
    const threadId = input.context?.threadId;
    if (threadId) {
      const compensation = this.assertPreparedAdmission(threadId, permissionRevision, prepared.taskId);
      if (compensation) await compensation;
    }
    await this.options.taskHost.startTask(prepared.taskId);
    if (threadId) this.assertExecutionAdmission(threadId, permissionRevision);
    return prepared;
  }

  private captureExecutionRevision(): number | undefined {
    return this.options.multiAgent?.getExecutionAuthorization().permissionRevision;
  }

  private assertExecutionAdmission(threadId: string, permissionRevision: number | undefined): void {
    this.options.multiAgent?.assertExecutionAdmission(threadId, permissionRevision);
  }

  private assertPreparedAdmission(threadId: string, permissionRevision: number | undefined, taskId: string): Promise<never> | undefined {
    // Success remains synchronous with bind/publish/start. Await only a denied
    // task's actual cancellation, never introduce a post-check microtask gap.
    try { this.assertExecutionAdmission(threadId, permissionRevision); return undefined; }
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
      state,
      activation: this.isArmed(threadId, state.goalId) ? 'armed' as const : 'disarmed' as const,
      ...this.waitingProjection(threadId, state),
    };
    this.options.publishGoalChanged?.({ threadId, goal });
    return goal;
  }

  private waitingProjection(threadId: string, state: GoalState): Pick<DesktopGoalProjection, 'waitingReason'> {
    const readiness = state.status === 'active' ? this.options.multiAgent?.goalReadiness(threadId) : undefined;
    return readiness && readiness !== 'ready' ? { waitingReason: readiness } : {};
  }

  private withThread<T>(threadId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.threadChains.get(threadId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(action);
    this.threadChains.set(threadId, next);
    return next.finally(() => {
      if (this.threadChains.get(threadId) === next) this.threadChains.delete(threadId);
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
