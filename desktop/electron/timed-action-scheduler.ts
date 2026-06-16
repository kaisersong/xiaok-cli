import type { TimedActionStore } from './timed-action-store.js';
import type {
  ClaimedTimedAction,
  ExecutorRecoveryDecision,
  LoopTimedActionDecision,
  TimedActionExecutorRuntimeContext,
  TimedActionExecutorHandler,
  TimedActionExecutorKind,
  TimedActionRecoveryReason,
  TimedActionRecord,
} from './timed-action-types.js';

export interface TimedActionSchedulerOptions {
  executors: Partial<Record<TimedActionExecutorKind, TimedActionExecutorHandler>>;
  now?: () => number;
  isGlobalBackgroundAutoRunEnabled?: () => boolean;
  resolveLinkedLoopRun?: (input: {
    action: TimedActionRecord;
    actionId: string;
    timedActionRunId: string;
  }) => LoopTimedActionDecision | undefined;
  scanIntervalMs?: number;
  /**
   * @deprecated Use executorTimeoutForKind for per-kind dispatch. Retained for
   * backwards compatibility — when set, applies to every executor kind.
   */
  executorTimeoutMs?: number;
  /**
   * Returns the executor timeout in milliseconds for a given action kind.
   * Defaults to 5 min for notify (short fail-fast) and 70 min for loop /
   * agent_task (must exceed the host watchdog so the underlying task
   * terminates first via its own watchdog/cancel path instead of being
   * orphaned as a zombie when the scheduler stops waiting).
   */
  executorTimeoutForKind?: (kind: TimedActionExecutorKind) => number;
  maxClaimPerTick?: number;
  maxAgentConcurrent?: number;
  maxLoopConcurrent?: number;
  /**
   * DB-lock release deadline. Defaults to 75 minutes — slightly larger than
   * the longest expected per-kind executor timeout (70 min for long tasks)
   * so it only kicks in when the executor itself crashed or wedged.
   */
  staleAfterMs?: number;
  onRunComplete?: (event: {
    action: TimedActionRecord;
    runId: string;
    status: 'success' | 'failed' | 'skipped';
    finishedAt: number;
    runtimeTaskId?: string;
    error?: string;
  }) => void;
}

export class TimedActionScheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly now: () => number;
  private readonly scanIntervalMs: number;
  private readonly resolveExecutorTimeoutMs: (kind: TimedActionExecutorKind) => number;
  private readonly maxClaimPerTick: number;
  private readonly maxAgentConcurrent: number;
  private readonly maxLoopConcurrent: number;
  private readonly staleAfterMs: number;
  private readonly inFlight = new Map<string, TimedActionExecutorKind>();
  private lastTickAt: number | null = null;
  private lastTickError: string | null = null;

  constructor(
    private readonly store: TimedActionStore,
    private readonly options: TimedActionSchedulerOptions
  ) {
    this.now = options.now ?? (() => Date.now());
    this.scanIntervalMs = options.scanIntervalMs ?? 30_000;
    this.resolveExecutorTimeoutMs = resolveExecutorTimeoutMsFromOptions(options);
    this.maxClaimPerTick = options.maxClaimPerTick ?? 20;
    this.maxAgentConcurrent = options.maxAgentConcurrent ?? 2;
    this.maxLoopConcurrent = options.maxLoopConcurrent ?? 1;
    this.staleAfterMs = options.staleAfterMs ?? 75 * 60_000;
  }

  start(): void {
    if (this.timer) return;
    void this.runOnce('startup_recovery');
    this.timer = setInterval(() => {
      void this.runOnce('normal_tick');
    }, this.scanIntervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  getStatus(): { lastTickAt: number | null; lastTickError: string | null; activeLocks: number } {
    return {
      lastTickAt: this.lastTickAt,
      lastTickError: this.lastTickError,
      activeLocks: this.inFlight.size,
    };
  }

  async runOnce(recoveryReason: TimedActionRecoveryReason = 'normal_tick'): Promise<void> {
    const now = this.now();
    this.lastTickAt = now;
    try {
      this.store.releaseStaleLocks(now, this.staleAfterMs, {
        resolveLinkedLoopRun: this.options.resolveLinkedLoopRun,
      });
      const notify = this.store.claimDueActions(now, this.maxClaimPerTick, {
        executorKinds: ['notify'],
        recoveryReason,
      });
      const remainingCapacity = Math.max(0, this.maxClaimPerTick - notify.length);
      if (this.options.isGlobalBackgroundAutoRunEnabled?.() === false) {
        const skipped = this.store.claimDueActions(now, remainingCapacity, {
          executorKinds: ['loop', 'agent_task'],
          recoveryReason,
        });
        for (const claimed of [...notify, ...skipped]) {
          if (claimed.action.executor.kind === 'notify') {
            this.dispatch(claimed);
          } else {
            this.skipAutoRunDisabled(claimed);
          }
        }
        this.lastTickError = null;
        return;
      }
      const loopCapacity = Math.max(0, this.maxLoopConcurrent - this.countInFlight('loop'));
      const loopLimit = Math.min(loopCapacity, remainingCapacity);
      const loop = loopLimit > 0
        ? this.store.claimDueActions(now, loopLimit, {
          executorKinds: ['loop'],
          recoveryReason,
        })
        : [];
      const agentCapacity = Math.max(0, this.maxAgentConcurrent - this.countInFlight('agent_task'));
      const remainingAgentCapacity = Math.max(0, this.maxClaimPerTick - notify.length - loop.length);
      const agentLimit = Math.min(agentCapacity, remainingAgentCapacity);
      const agent = agentLimit > 0
        ? this.store.claimDueActions(now, agentLimit, {
          executorKinds: ['agent_task'],
          recoveryReason,
        })
        : [];

      for (const claimed of [...notify, ...loop, ...agent]) {
        this.dispatch(claimed);
      }
      this.lastTickError = null;
    } catch (error) {
      this.lastTickError = (error as Error).message;
      console.error('[timed-action] tick failed:', error);
    }
  }

  private skipAutoRunDisabled(claimed: ClaimedTimedAction): void {
    const finishedAt = this.now();
    const decision: Extract<ExecutorRecoveryDecision, { action: 'skip' }> = {
      action: 'skip',
      reason: 'skipped_auto_run_disabled',
    };
    this.store.finishRunSkipped(claimed.action.id, claimed.runId, finishedAt, decision);
    this.notifyRunComplete(claimed, 'skipped', finishedAt, undefined, decision.reason);
  }

  private dispatch(claimed: ClaimedTimedAction): void {
    const handler = this.options.executors[claimed.action.executor.kind];
    if (!handler) {
      this.store.finishRunFailure(
        claimed.action.id,
        claimed.runId,
        this.now(),
        `missing executor: ${claimed.action.executor.kind}`
      );
      return;
    }

    const decision = handler.decideRecovery?.(claimed.action, claimed.context) ?? defaultRecoveryDecision(claimed);
    if (decision.action !== 'execute') {
      const finishedAt = this.now();
      this.store.finishRunSkipped(claimed.action.id, claimed.runId, finishedAt, decision);
      this.notifyRunComplete(claimed, 'skipped', finishedAt, undefined, decision.reason);
      return;
    }

    this.inFlight.set(claimed.action.id, claimed.action.executor.kind);
    this.store.markRunRunning(claimed.action.id, claimed.runId, this.now());
    void this.executeClaimed(claimed, handler, decision);
  }

  private async executeClaimed(
    claimed: ClaimedTimedAction,
    handler: TimedActionExecutorHandler,
    decision: Extract<ExecutorRecoveryDecision, { action: 'execute' }>
  ): Promise<void> {
    const controller = new AbortController();
    const timeoutMs = this.resolveExecutorTimeoutMs(claimed.action.executor.kind);
    const timeoutTimer = setTimeout(() => {
      controller.abort(new Error('executor_timeout'));
    }, timeoutMs);
    timeoutTimer.unref?.();
    try {
      const runtimeContext: TimedActionExecutorRuntimeContext = {
        timedActionRunId: claimed.runId,
        signal: controller.signal,
      };
      const result = await Promise.race([
        Promise.resolve(handler.execute(claimed.action, claimed.context, runtimeContext)),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(controller.signal.reason instanceof Error
              ? controller.signal.reason
              : new Error('executor_timeout'));
          }, { once: true });
        }),
      ]);
      const finishedAt = this.now();
      if (result.skip) {
        this.store.finishRunSkipped(claimed.action.id, claimed.runId, finishedAt, result.skip);
        this.notifyRunComplete(claimed, 'skipped', finishedAt, result.runtimeTaskId, result.skip.reason);
        return;
      }
      if (claimed.action.executor.kind === 'loop') {
        const loopDecision = parseLoopTimedActionDecision(result.decision);
        if (loopDecision.loopStatus === 'failed') {
          throw new Error(`loop failed: ${loopDecision.nextActionSummary ?? loopDecision.loopRunId}`);
        }
        if (loopDecision.loopStatus === 'blocked') {
          const pauseDecision: Extract<ExecutorRecoveryDecision, { action: 'pause' }> = {
            action: 'pause',
            reason: 'blocked_requires_user_action',
          };
          this.store.finishRunSkipped(claimed.action.id, claimed.runId, finishedAt, pauseDecision, {
            ...loopDecision,
          });
          this.notifyRunComplete(claimed, 'skipped', finishedAt, result.runtimeTaskId, pauseDecision.reason);
          return;
        }
      }
      this.store.finishRunSuccess(claimed.action.id, claimed.runId, finishedAt, {
        runtimeTaskId: result.runtimeTaskId,
        decision: { recoveryDecision: decision, ...(result.decision ?? {}) },
      });
      this.notifyRunComplete(claimed, 'success', finishedAt, result.runtimeTaskId);
    } catch (error) {
      const finishedAt = this.now();
      const message = (error as Error).message;
      this.store.finishRunFailure(claimed.action.id, claimed.runId, finishedAt, message);
      this.notifyRunComplete(claimed, 'failed', finishedAt, undefined, message);
    } finally {
      clearTimeout(timeoutTimer);
      this.inFlight.delete(claimed.action.id);
    }
  }

  private notifyRunComplete(
    claimed: ClaimedTimedAction,
    status: 'success' | 'failed' | 'skipped',
    finishedAt: number,
    runtimeTaskId?: string,
    error?: string
  ): void {
    const action = this.store.getAction(claimed.action.id) ?? claimed.action;
    this.options.onRunComplete?.({
      action,
      runId: claimed.runId,
      status,
      finishedAt,
      runtimeTaskId,
      error,
    });
  }

  private countInFlight(kind: TimedActionExecutorKind): number {
    let count = 0;
    for (const current of this.inFlight.values()) {
      if (current === kind) count++;
    }
    return count;
  }
}

function parseLoopTimedActionDecision(decision: Record<string, unknown> | undefined): LoopTimedActionDecision {
  if (!decision || typeof decision.loopRunId !== 'string' || decision.loopRunId.length === 0) {
    throw new Error('loop executor decision missing loopRunId');
  }
  if (decision.loopStatus !== 'success' && decision.loopStatus !== 'failed' && decision.loopStatus !== 'blocked') {
    throw new Error('loop executor decision missing loopStatus');
  }
  return {
    ...decision,
    loopRunId: decision.loopRunId,
    loopStatus: decision.loopStatus,
    nextActionKind: typeof decision.nextActionKind === 'string' ? decision.nextActionKind : undefined,
    nextActionSummary: typeof decision.nextActionSummary === 'string' ? decision.nextActionSummary : undefined,
  };
}

function defaultRecoveryDecision(claimed: ClaimedTimedAction): ExecutorRecoveryDecision {
  const { action, context } = claimed;
  if (action.policy.expiresAt !== undefined && action.policy.expiresAt <= context.claimedAt) {
    return { action: action.trigger.kind === 'once' ? 'complete' : 'pause', reason: 'action expired' };
  }
  return { action: 'execute', reason: 'due' };
}

function resolveExecutorTimeoutMsFromOptions(
  options: TimedActionSchedulerOptions
): (kind: TimedActionExecutorKind) => number {
  if (options.executorTimeoutForKind) {
    const explicit = options.executorTimeoutForKind;
    return (kind) => explicit(kind);
  }
  if (options.executorTimeoutMs !== undefined) {
    const fixed = options.executorTimeoutMs;
    return () => fixed;
  }
  return (kind) => kind === 'notify' ? 5 * 60_000 : 70 * 60_000;
}
