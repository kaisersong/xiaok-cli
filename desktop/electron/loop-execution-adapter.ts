import {ASSISTANT_CHECK_LOOP_ID} from './assistant-types.js';
import {
  ASSISTANT_EVENING_LOOP_ID,
  ASSISTANT_MORNING_LOOP_ID,
} from './assistant-types.js';
import type { AssistantRuntime } from './assistant-runtime.js';
import { createLoopExecutor, type LoopRunner } from './loop-executor.js';
import type {
  ExecutorRecoveryDecision,
  OverdueRecoveryContext,
  TimedActionExecutorHandler,
  TimedActionRecord,
} from './timed-action-types.js';

export function createLoopExecutionAdapter(options: {
  genericRunner: LoopRunner;
  assistantRuntime: AssistantRuntime;
  periodicRuntime?:LoopRunner;
}): LoopRunner {
  return {
    runLoopNow(loopId, trigger, signal, context) {
      if(loopId===ASSISTANT_CHECK_LOOP_ID)return options.periodicRuntime?.runLoopNow(loopId,trigger,signal,context)??Promise.resolve({status:'skipped' as const,reason:'missing_loop' as const});
      if (isAssistantLoopId(loopId)) {
        return options.assistantRuntime.runLoopNow(loopId, trigger, signal, context);
      }
      return options.genericRunner.runLoopNow(loopId, trigger, signal, context);
    },
  };
}

export function createAssistantAwareLoopTimedActionExecutor(options: {
  genericExecutor: TimedActionExecutorHandler;
  assistantRuntime: AssistantRuntime;
  periodicRuntime?:LoopRunner;
}): TimedActionExecutorHandler {
  const assistantExecutor = createLoopExecutor({
    runLoop: (loopId, trigger, signal, context) => loopId===ASSISTANT_CHECK_LOOP_ID?(options.periodicRuntime?.runLoopNow(loopId,trigger,signal,context)??Promise.resolve({status:'skipped' as const,reason:'missing_loop' as const})):options.assistantRuntime.runLoopNow(loopId, trigger, signal, context),
  });
  return {
    kind: 'loop',
    decideRecovery(action, context) {
      if (isAssistantAction(action)) return assistantRecoveryDecision(action, context);
      return options.genericExecutor.decideRecovery?.(action, context)
        ?? { action: 'execute', reason: 'due loop' };
    },
    execute(action, context, runtimeContext) {
      if (isAssistantAction(action)) {
        return assistantExecutor.execute(action, context, runtimeContext);
      }
      return options.genericExecutor.execute(action, context, runtimeContext);
    },
  };
}

export function isAssistantLoopId(loopId: string): boolean {
  return loopId===ASSISTANT_CHECK_LOOP_ID||loopId === ASSISTANT_EVENING_LOOP_ID || loopId === ASSISTANT_MORNING_LOOP_ID;
}

function isAssistantAction(action: TimedActionRecord): boolean {
  return action.executor.kind === 'loop' && isAssistantLoopId(action.executor.loopId);
}

function assistantRecoveryDecision(
  action: TimedActionRecord,
  context: OverdueRecoveryContext,
): ExecutorRecoveryDecision {
  if (action.executor.kind !== 'loop') return { action: 'execute', reason: 'due loop' };
  if(action.executor.loopId===ASSISTANT_CHECK_LOOP_ID)return {action:'execute',reason:'assistant_check_coalesced_current'};
  const timeZone = action.trigger.kind === 'daily' && action.trigger.timeZone
    ? action.trigger.timeZone
    : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const due = localClock(context.scheduledDueAt, timeZone);
  const claimed = localClock(context.claimedAt, timeZone);
  const dueDay = Date.UTC(due.year, due.month - 1, due.day) / 86_400_000;
  const claimedDay = Date.UTC(claimed.year, claimed.month - 1, claimed.day) / 86_400_000;
  const dayDelta = claimedDay - dueDay;
  const claimedMinute = claimed.hour * 60 + claimed.minute;

  if (action.executor.loopId === ASSISTANT_EVENING_LOOP_ID) {
    const expired = dayDelta > 1 || (dayDelta === 1 && claimedMinute >= 4 * 60);
    return expired
      ? { action: 'skip', reason: 'assistant_evening_overdue_cutoff' }
      : { action: 'execute', reason: 'assistant_evening_within_overdue_window' };
  }
  const expired = dayDelta > 0 || (dayDelta === 0 && claimedMinute >= 12 * 60);
  return expired
    ? { action: 'skip', reason: 'assistant_morning_overdue_cutoff' }
    : { action: 'execute', reason: 'assistant_morning_within_overdue_window' };
}

function localClock(instant: number, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const value = (kind: string) => Number(parts.find(part => part.type === kind)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  };
}
