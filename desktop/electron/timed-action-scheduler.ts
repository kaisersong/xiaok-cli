import type {LoopTimedCompletionHost} from './loop-timed-completion.js';
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
  loopCompletion?:LoopTimedCompletionHost;
  /** Fixed Main shutdown-gate port; covers actual writers, not timeout races. */
  acquireWriter?: (label: string) => { release(): void };
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
    status: 'success' | 'failed' | 'skipped' | 'publication_pending';
    finishedAt: number;
    runtimeTaskId?: string;
    error?: string;
  }) => void;
}

export class TimedActionScheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking:Promise<void>|undefined;
  private readonly now: () => number;
  private readonly acquireWriter: TimedActionSchedulerOptions['acquireWriter'];
  private readonly scanIntervalMs: number;
  private readonly resolveExecutorTimeoutMs: (kind: TimedActionExecutorKind) => number;
  private readonly maxClaimPerTick: number;
  private readonly maxAgentConcurrent: number;
  private readonly maxLoopConcurrent: number;
  private readonly staleAfterMs: number;
  private readonly inFlight = new Map<string, TimedActionExecutorKind>();
  private accepting = true;
  private readonly activeControllers = new Set<AbortController>();
  private lastTickAt: number | null = null;
  private lastTickError: string | null = null;

  constructor(
    private readonly store: TimedActionStore,
    private readonly options: TimedActionSchedulerOptions
  ) {
    this.acquireWriter = options.acquireWriter?.bind(options);
    this.now = options.now ?? (() => Date.now());
    this.scanIntervalMs = options.scanIntervalMs ?? 10_000;
    this.resolveExecutorTimeoutMs = resolveExecutorTimeoutMsFromOptions(options);
    this.maxClaimPerTick = options.maxClaimPerTick ?? 20;
    this.maxAgentConcurrent = options.maxAgentConcurrent ?? 2;
    this.maxLoopConcurrent = options.maxLoopConcurrent ?? 1;
    this.staleAfterMs = options.staleAfterMs ?? 75 * 60_000;
  }

  start(): void {
    if (!this.accepting || this.timer) return;
    void this.runOnce('startup_recovery');
    if (!this.accepting) return;
    this.timer = setInterval(() => {
      void this.runOnce('normal_tick');
    }, this.scanIntervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  stopAccepting(): void { this.accepting = false; this.stop(); }

  abortAllActive(reason: string = 'app_shutdown'): void {
    for (const controller of this.activeControllers) controller.abort(new Error(reason));
  }

  getStatus(): { lastTickAt: number | null; lastTickError: string | null; activeLocks: number } {
    return {
      lastTickAt: this.lastTickAt,
      lastTickError: this.lastTickError,
      activeLocks: this.inFlight.size,
    };
  }

  runOnce(recoveryReason: TimedActionRecoveryReason = 'normal_tick'): Promise<void> {
    if(this.ticking)return this.ticking;
    const work=this.tick(recoveryReason);this.ticking=work;const clear=()=>{if(this.ticking===work)this.ticking=undefined;};void work.then(clear,clear);return work;
  }

  private async tick(recoveryReason:TimedActionRecoveryReason):Promise<void> {
    if (!this.accepting) return;
    let writer: { release(): void } | undefined;
    const recoveryController=new AbortController();this.activeControllers.add(recoveryController);
    try {
      writer = this.acquireWriter?.('timed-action:tick');
      const now = this.now();
      if (!this.accepting) return;
      this.lastTickAt = now;
      await this.options.loopCompletion?.reconcile(recoveryController.signal);
      if(!this.accepting||recoveryController.signal.aborted)return;
      this.store.releaseStaleLocks(now, this.staleAfterMs);
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
    } finally { this.activeControllers.delete(recoveryController);writer?.release(); }
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
    if (!this.accepting) return;
    const writer = this.acquireWriter?.('timed-action:executor:' + claimed.runId);
    let handedOff = false;
    try {
      if (!this.accepting) return;
      const handler = this.options.executors[claimed.action.executor.kind];
      if (!handler) {
        this.store.finishRunFailure(claimed.action.id, claimed.runId, this.now(), `missing executor: ${claimed.action.executor.kind}`);
        return;
      }
      const decision = handler.decideRecovery?.(claimed.action, claimed.context) ?? defaultRecoveryDecision(claimed);
      if (decision.action !== 'execute') {
        const finishedAt = this.now();
        this.store.finishRunSkipped(claimed.action.id, claimed.runId, finishedAt, decision);
        this.notifyRunComplete(claimed, 'skipped', finishedAt, undefined, decision.reason);
        return;
      }
      if (!this.accepting) return;
      this.store.markRunRunning(claimed.action.id, claimed.runId, this.now());
      this.inFlight.set(claimed.action.id, claimed.action.executor.kind);
      const work = this.executeClaimed(claimed, handler, decision, () => writer?.release());
      handedOff = true;
      void work.catch(error => console.error('[timed-action] executor finalization failed:', error));
    } finally { if (!handedOff) writer?.release(); }
  }

  private async executeClaimed(
    claimed: ClaimedTimedAction,
    handler: TimedActionExecutorHandler,
    decision: Extract<ExecutorRecoveryDecision, { action: 'execute' }>,
    releaseWriter: () => void
  ): Promise<void> {
    const controller = new AbortController();
    this.activeControllers.add(controller);
    let actual: Promise<Awaited<ReturnType<TimedActionExecutorHandler['execute']>>> | undefined;
    let removeAbortListener: (() => void) | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutMs = this.resolveExecutorTimeoutMs(claimed.action.executor.kind);
      timeoutTimer = setTimeout(() => controller.abort(new Error('executor_timeout')), timeoutMs);
      timeoutTimer.unref?.();
      const runtimeContext: TimedActionExecutorRuntimeContext = {
        timedActionRunId: claimed.runId,
        signal: controller.signal,
      };
      actual = Promise.resolve().then(() => {
        if (!this.accepting) throw new Error('app_shutdown');
        return handler.execute(claimed.action, claimed.context, runtimeContext);
      });
      const result = await Promise.race([
        actual,
        new Promise<never>((_, reject) => {
          const abort = () => {
            reject(controller.signal.reason instanceof Error
              ? controller.signal.reason
              : new Error('executor_timeout'));
          };
          if (controller.signal.aborted) abort();
          else { controller.signal.addEventListener('abort', abort, { once: true }); removeAbortListener = () => controller.signal.removeEventListener('abort', abort); }
        }),
      ]);
      const finishedAt = this.now();
      if(claimed.action.executor.kind==='loop'&&(!result.skip||result.decision?.reused===true)){
        const loopRunId=result.awaitingLoopRunId??parseLoopTimedActionDecision(result.decision).loopRunId;
        if(!this.options.loopCompletion)throw Error('loop_timed_host_required');
        const completion=await this.options.loopCompletion.finalize({actionId:claimed.action.id,timedRunId:claimed.runId,loopRunId,mode:result.decision?.reused===true?'reused':'normal',requestSource:'scheduler',signal:controller.signal});
        if(completion.status==='retry_pending')return;
        const status=completion.outcome==='success'?(result.skip?'skipped':'success'):completion.outcome==='publication_pending'?'publication_pending':completion.outcome==='blocked'||completion.outcome==='rejected'?'skipped':'failed';
        this.notifyRunComplete(claimed,status,finishedAt,result.runtimeTaskId,completion.receipt.after.run.error??undefined);return;
      }
      if (result.skip) {
        this.store.finishRunSkipped(claimed.action.id, claimed.runId, finishedAt, result.skip);
        this.notifyRunComplete(claimed, 'skipped', finishedAt, result.runtimeTaskId, result.skip.reason);
        return;
      }
      if (claimed.action.executor.kind === 'loop') {
        const loopDecision = parseLoopTimedActionDecision(result.decision);
        if(loopDecision.loopStatus==='publication_pending'){this.store.finishRunPublicationPending(claimed.action.id,claimed.runId,finishedAt,loopDecision);this.notifyRunComplete(claimed,'publication_pending',finishedAt,result.runtimeTaskId);return;}
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
      if(claimed.action.executor.kind==='loop'&&this.options.loopCompletion)return;
      this.store.finishRunFailure(claimed.action.id, claimed.runId, finishedAt, message);
      this.notifyRunComplete(claimed, 'failed', finishedAt, undefined, message);
    } finally {
      clearTimeout(timeoutTimer);
      this.inFlight.delete(claimed.action.id);
      removeAbortListener?.();
      const release = () => { this.activeControllers.delete(controller); releaseWriter(); };
      // A timeout settles this wrapper, not the underlying writer.
      if (actual) void actual.then(release, release); else release();
    }
  }

  private notifyRunComplete(
    claimed: ClaimedTimedAction,
    status: 'success' | 'failed' | 'skipped' | 'publication_pending',
    finishedAt: number,
    runtimeTaskId?: string,
    error?: string
  ): void {
    // Notification is after the durable outcome. Its failure must not enter
    // executeClaimed's failure finalizer and overwrite that committed history.
    const failed=(error:unknown)=>console.warn('[timed-action] completion notification failed:',error);
    try {
      const action = this.store.getAction(claimed.action.id) ?? claimed.action;
      const notification:unknown=this.options.onRunComplete?.({action,runId:claimed.runId,status,finishedAt,runtimeTaskId,error});
      void Promise.resolve(notification).catch(failed);
    } catch (notificationError) { failed(notificationError); }
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
  if (decision.loopStatus !== 'success' && decision.loopStatus !== 'failed' && decision.loopStatus !== 'blocked' && decision.loopStatus !== 'publication_pending') {
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
