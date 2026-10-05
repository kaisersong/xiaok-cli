import type { Message } from '../../types.js';
import type {
  CompactionApplyOutcome,
  CompactionPlan,
} from './session.js';

export type NativeCompactionFailureClass =
  | 'http400'
  | 'http429'
  | 'http500'
  | 'network'
  | 'timeout'
  | 'corruptResponse'
  | 'providerModelMismatch'
  | 'unknown';

export type PortableCompactionTrigger =
  | { kind: 'threshold' }
  | { kind: 'semantic' }
  | {
      kind: 'native_failure';
      failureClass: NativeCompactionFailureClass;
    };

export type PortableSummaryFailureCode = 'portable_summary_failed';

export type PortableCompactionExecutionOutcome =
  | {
      status: 'no_replacement' | 'invalid_plan';
      record: null;
      trigger: PortableCompactionTrigger;
      summaryAttempted: false;
      summaryModelFailed: false;
      summaryFailureCode?: never;
    }
  | (
      CompactionApplyOutcome
      & {
          trigger: PortableCompactionTrigger;
          summaryAttempted: true;
        }
      & (
          | {
              summaryModelFailed: false;
              summaryFailureCode?: never;
            }
          | {
              summaryModelFailed: true;
              summaryFailureCode: PortableSummaryFailureCode;
            }
        )
    );

export interface PortableCompactionPorts {
  /** Semantic owner validates anchors and persists CAS before installing live history. */
  applySemanticPlan?(plan: CompactionPlan, summaryText: string): CompactionApplyOutcome | Promise<CompactionApplyOutcome>;
  summarizePrefix(
    messages: readonly Message[],
    signal: AbortSignal,
  ): Promise<string>;

  applyPlan(
    plan: CompactionPlan,
    summaryText?: string,
  ): CompactionApplyOutcome;
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason !== undefined) throw signal.reason;
  throw new DOMException('portable compaction aborted', 'AbortError');
}

function isClosedAbortError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'AbortError';
  }
  if (!(error instanceof Error)) return false;
  return error.name === 'AbortError';
}

export async function executePortableCompaction(
  request: {
    plan: CompactionPlan;
    signal: AbortSignal;
    trigger: PortableCompactionTrigger;
  },
  ports: PortableCompactionPorts,
): Promise<PortableCompactionExecutionOutcome> {
  throwIfAborted(request.signal);

  if (request.plan.invalidReason || (request.trigger.kind === 'semantic' && !ports.applySemanticPlan)) {
    return {
      status: 'invalid_plan',
      record: null,
      trigger: request.trigger,
      summaryAttempted: false,
      summaryModelFailed: false,
    };
  }

  if (request.plan.replacedMessages <= 0) {
    return {
      status: 'no_replacement',
      record: null,
      trigger: request.trigger,
      summaryAttempted: false,
      summaryModelFailed: false,
    };
  }

  let summaryText: string;
  try {
    summaryText = await ports.summarizePrefix(
      structuredClone(request.plan.messagesToSummarize),
      request.signal,
    );
    throwIfAborted(request.signal);
  } catch (error) {
    throwIfAborted(request.signal);
    if (isClosedAbortError(error)) throw error;

    return {
      ...(request.trigger.kind === 'semantic'
        ? { status: 'no_gain' as const, record: null }
        : ports.applyPlan(request.plan, undefined)),
      trigger: request.trigger,
      summaryAttempted: true,
      summaryModelFailed: true,
      summaryFailureCode: 'portable_summary_failed',
    };
  }

  if (request.trigger.kind === 'semantic') {
    return {
      ...(summaryText.trim()
        ? await ports.applySemanticPlan!(request.plan, summaryText)
        : { status: 'no_gain' as const, record: null }),
      trigger: request.trigger,
      summaryAttempted: true,
      summaryModelFailed: false,
    };
  }
  return {
    ...ports.applyPlan(request.plan, summaryText),
    trigger: request.trigger,
    summaryAttempted: true,
    summaryModelFailed: false,
  };
}
