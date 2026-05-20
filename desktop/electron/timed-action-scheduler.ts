import type { TimedActionStore } from './timed-action-store.js';
import type {
  ClaimedTimedAction,
  ExecutorRecoveryDecision,
  TimedActionExecutorHandler,
  TimedActionExecutorKind,
  TimedActionRecoveryReason,
} from './timed-action-types.js';

export interface TimedActionSchedulerOptions {
  executors: Partial<Record<TimedActionExecutorKind, TimedActionExecutorHandler>>;
  now?: () => number;
  scanIntervalMs?: number;
  executorTimeoutMs?: number;
  maxClaimPerTick?: number;
  maxAgentConcurrent?: number;
  staleAfterMs?: number;
}

export class TimedActionScheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly now: () => number;
  private readonly scanIntervalMs: number;
  private readonly executorTimeoutMs: number;
  private readonly maxClaimPerTick: number;
  private readonly maxAgentConcurrent: number;
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
    this.executorTimeoutMs = options.executorTimeoutMs ?? 5 * 60_000;
    this.maxClaimPerTick = options.maxClaimPerTick ?? 20;
    this.maxAgentConcurrent = options.maxAgentConcurrent ?? 2;
    this.staleAfterMs = options.staleAfterMs ?? this.executorTimeoutMs;
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
      this.store.releaseStaleLocks(now, this.staleAfterMs);
      const notify = this.store.claimDueActions(now, this.maxClaimPerTick, {
        executorKinds: ['notify'],
        recoveryReason,
      });
      const agentCapacity = Math.max(0, this.maxAgentConcurrent - this.countInFlight('agent_task'));
      const remainingCapacity = Math.max(0, this.maxClaimPerTick - notify.length);
      const agentLimit = Math.min(agentCapacity, remainingCapacity);
      const agent = agentLimit > 0
        ? this.store.claimDueActions(now, agentLimit, {
          executorKinds: ['agent_task'],
          recoveryReason,
        })
        : [];

      for (const claimed of [...notify, ...agent]) {
        this.dispatch(claimed);
      }
      this.lastTickError = null;
    } catch (error) {
      this.lastTickError = (error as Error).message;
      console.error('[timed-action] tick failed:', error);
    }
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
      this.store.finishRunSkipped(claimed.action.id, claimed.runId, this.now(), decision);
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
    try {
      const result = await this.withTimeout(Promise.resolve(handler.execute(claimed.action, claimed.context)));
      this.store.finishRunSuccess(claimed.action.id, claimed.runId, this.now(), {
        runtimeTaskId: result.runtimeTaskId,
        decision: { recoveryDecision: decision, ...(result.decision ?? {}) },
      });
    } catch (error) {
      this.store.finishRunFailure(claimed.action.id, claimed.runId, this.now(), (error as Error).message);
    } finally {
      this.inFlight.delete(claimed.action.id);
    }
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('executor timeout')), this.executorTimeoutMs);
      timer.unref?.();
    });
    return Promise.race([promise, timeout]).finally(() => {
      clearTimeout(timer);
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

function defaultRecoveryDecision(claimed: ClaimedTimedAction): ExecutorRecoveryDecision {
  const { action, context } = claimed;
  if (action.policy.expiresAt !== undefined && action.policy.expiresAt <= context.claimedAt) {
    return { action: action.trigger.kind === 'once' ? 'complete' : 'pause', reason: 'action expired' };
  }
  return { action: 'execute', reason: 'due' };
}

