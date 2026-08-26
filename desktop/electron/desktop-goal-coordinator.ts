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
import type {
  GoalTurnExecutionScope,
  TaskCreateInput,
  TaskSnapshot,
  TaskUnderstanding,
} from '../../src/runtime/task-host/types.js';
import { SqliteGoalStore, type GoalTaskBinding } from './goal-store-sqlite.js';

interface GoalTaskHost {
  prepareTask(input: TaskCreateInput): Promise<{ taskId: string; understanding?: TaskUnderstanding }>;
  startTask(taskId: string): Promise<void>;
  cancelTask(taskId: string, reason?: string): Promise<void>;
}

export interface DesktopGoalProjection {
  state: GoalState;
  activation: GoalActivation;
}

export interface PreparedGoalTask {
  attachmentId: string;
  threadId: string;
  taskId: string;
  executionScope: GoalTurnExecutionScope;
  goalRef: { goalId: string; revision: number };
  expiresAt: number;
}

interface PendingAttachment extends PreparedGoalTask {
  timeout: ReturnType<typeof setTimeout>;
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
}

export class DesktopGoalCoordinator {
  private readonly now: () => number;
  private readonly service: GoalService;
  private readonly activation = new Map<string, { goalId: string; armed: boolean }>();
  private readonly pendingByThread = new Map<string, PendingAttachment>();
  private readonly runningByThread = new Map<string, string>();
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
    };
  }

  async createGoal(input: { threadId: string } & GoalInput): Promise<{
    goal: DesktopGoalProjection;
    preparedTask: PreparedGoalTask;
  }> {
    return this.withThread(input.threadId, async () => {
      const state = await this.service.create(this.context(input.threadId, 'user', null), input);
      this.activation.set(input.threadId, { goalId: state.goalId, armed: true });
      const preparedTask = await this.prepareGoalTask(input.threadId, state, 'user', state.objective);
      const goal = { state, activation: 'armed' as const };
      this.options.publishGoalChanged?.({ threadId: input.threadId, goal });
      return { goal, preparedTask };
    });
  }

  async pauseGoal(input: { threadId: string }): Promise<DesktopGoalProjection> {
    return this.withThread(input.threadId, async () => {
      const document = await this.requireDocument(input.threadId);
      await this.cancelPending(input.threadId, 'goal_paused');
      const running = this.runningByThread.get(input.threadId);
      if (running) await this.options.taskHost.cancelTask(running, 'goal_paused');
      const state = await this.service.pause(
        this.context(input.threadId, 'user', document.state.revision),
        'user_paused',
      );
      this.activation.delete(input.threadId);
      return this.publishProjection(input.threadId, state);
    });
  }

  async resumeGoal(input: { threadId: string; turnLimit?: number }): Promise<{
    goal: DesktopGoalProjection;
    preparedTask: PreparedGoalTask;
  }> {
    return this.withThread(input.threadId, async () => {
      const document = await this.requireDocument(input.threadId);
      const state = await this.service.resume(
        this.context(input.threadId, 'user', document.state.revision),
        input.turnLimit === undefined ? {} : { turnLimit: input.turnLimit },
      );
      this.activation.set(input.threadId, { goalId: state.goalId, armed: true });
      const preparedTask = await this.prepareGoalTask(input.threadId, state, 'continuation');
      return { goal: this.publishProjection(input.threadId, state), preparedTask };
    });
  }

  async cancelGoal(input: { threadId: string }): Promise<DesktopGoalProjection> {
    return this.withThread(input.threadId, async () => {
      const document = await this.requireDocument(input.threadId);
      await this.cancelPending(input.threadId, 'goal_cancelled');
      const running = this.runningByThread.get(input.threadId);
      if (running) await this.options.taskHost.cancelTask(running, 'goal_cancelled');
      const state = await this.service.cancel(
        this.context(input.threadId, 'user', document.state.revision),
        'user_cancelled',
      );
      this.activation.delete(input.threadId);
      return this.publishProjection(input.threadId, state);
    });
  }

  async replaceGoal(input: { threadId: string } & GoalInput): Promise<{
    goal: DesktopGoalProjection;
    preparedTask: PreparedGoalTask;
  }> {
    return this.withThread(input.threadId, async () => {
      if (this.pendingByThread.has(input.threadId) || this.runningByThread.has(input.threadId)) {
        throw new Error('Cannot replace a Goal while a Goal task is pending or running');
      }
      const document = await this.requireDocument(input.threadId);
      const state = await this.service.replace(
        this.context(input.threadId, 'user', document.state.revision),
        input,
      );
      this.activation.set(input.threadId, { goalId: state.goalId, armed: true });
      const preparedTask = await this.prepareGoalTask(input.threadId, state, 'user', state.objective);
      return { goal: this.publishProjection(input.threadId, state), preparedTask };
    });
  }

  async admitUserTask(input: TaskCreateInput): Promise<{ taskId: string; understanding?: TaskUnderstanding }> {
    const threadId = input.context?.threadId;
    if (!threadId) return this.prepareBindStart(input);
    return this.withThread(threadId, async () => {
      const document = await this.service.load(threadId);
      if (!document || !this.isArmed(threadId, document.state.goalId) || document.state.status !== 'active') {
        if (!document) this.activation.delete(threadId);
        this.userQueuePending.delete(threadId);
        return this.prepareBindStart(input);
      }
      await this.cancelPending(threadId, 'superseded_by_user');
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
      this.options.store.bindTask({ ...scopeToBinding(scope, prepared.taskId), attachedAt: this.now() });
      this.runningByThread.set(threadId, prepared.taskId);
      this.userQueuePending.delete(threadId);
      await this.options.taskHost.startTask(prepared.taskId);
      return prepared;
    });
  }

  async ackGoalTaskAttached(input: { threadId: string; attachmentId: string }): Promise<void> {
    await this.withThread(input.threadId, async () => {
      const pending = this.pendingByThread.get(input.threadId);
      if (!pending || pending.attachmentId !== input.attachmentId) {
        throw new Error('Goal task attachment is missing, stale, or belongs to another thread');
      }
      const document = await this.requireDocument(input.threadId);
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
      await this.options.taskHost.startTask(pending.taskId);
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
    const terminalEvent = input.event;
    const binding = this.options.store.getTaskBinding(input.taskId);
    if (!binding) return;
    await this.withThread(binding.threadId, async () => {
      const document = await this.requireDocument(binding.threadId);
      if (document.turns.some(turn => turn.turnId === binding.goalTurnId)) return;
      const cancelReason = findCancellationReason(input.snapshot);
      const completeSummary = this.pendingComplete.get(input.taskId);
      this.pendingComplete.delete(input.taskId);
      const blockerClaim = this.pendingBlocked.get(input.taskId);
      this.pendingBlocked.delete(input.taskId);
      this.runningByThread.delete(binding.threadId);
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
      let terminalDecision: Parameters<GoalService['settleTurn']>[1]['terminalDecision'] = { kind: 'none' };
      if (terminalEvent.status === 'completed' && completeSummary) {
        const evaluation = new GoalCompletionEvaluator().evaluate(
          document.state,
          [...document.evidence, ...proposed],
        );
        if (evaluation.ok) terminalDecision = { kind: 'complete', reason: completeSummary };
      } else if (terminalEvent.status === 'completed' && blockerClaim) {
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
      ) {
        await this.prepareGoalTask(binding.threadId, state, 'continuation');
      }
    });
  }

  getPendingAttachmentForTest(threadId: string): PreparedGoalTask | null {
    const pending = this.pendingByThread.get(threadId);
    return pending ? stripTimeout(pending) : null;
  }

  disarmAll(): void {
    this.activation.clear();
    for (const pending of this.pendingByThread.values()) clearTimeout(pending.timeout);
    this.pendingByThread.clear();
  }

  private async prepareGoalTask(
    threadId: string,
    state: GoalState,
    origin: GoalTurnExecutionScope['origin'],
    prompt?: string,
  ): Promise<PreparedGoalTask> {
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
      expiresAt, timeout,
    };
    this.pendingByThread.set(threadId, pending);
    const published = stripTimeout(pending);
    this.options.publishGoalTaskPrepared?.(published);
    return published;
  }

  private async expireAttachment(threadId: string, attachmentId: string): Promise<void> {
    await this.withThread(threadId, async () => {
      const pending = this.pendingByThread.get(threadId);
      if (!pending || pending.attachmentId !== attachmentId) return;
      this.pendingByThread.delete(threadId);
      await this.options.taskHost.cancelTask(pending.taskId, 'thread_attachment_timeout');
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
    await this.options.taskHost.cancelTask(pending.taskId, reason);
  }

  private async prepareBindStart(input: TaskCreateInput): Promise<{ taskId: string; understanding?: TaskUnderstanding }> {
    const prepared = await this.options.taskHost.prepareTask(input);
    await this.options.taskHost.startTask(prepared.taskId);
    return prepared;
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
      taskIds: this.options.store.listTaskBindings(threadId).map(binding => binding.taskId),
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
    };
    this.options.publishGoalChanged?.({ threadId, goal });
    return goal;
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
  const { timeout: _timeout, ...result } = pending;
  return result;
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
