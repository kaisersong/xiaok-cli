import type { Message } from '../../types.js';
import type { CompactionApplyOutcome, CompactionPlan } from './session.js';
export type NativeCompactionFailureClass = 'http400' | 'http429' | 'http500' | 'network' | 'timeout' | 'corruptResponse' | 'providerModelMismatch' | 'unknown';
export type PortableCompactionTrigger = {
    kind: 'threshold';
} | {
    kind: 'native_failure';
    failureClass: NativeCompactionFailureClass;
};
export type PortableSummaryFailureCode = 'portable_summary_failed';
export type PortableCompactionExecutionOutcome = {
    status: 'no_replacement' | 'invalid_plan';
    record: null;
    trigger: PortableCompactionTrigger;
    summaryAttempted: false;
    summaryModelFailed: false;
    summaryFailureCode?: never;
} | (CompactionApplyOutcome & {
    trigger: PortableCompactionTrigger;
    summaryAttempted: true;
} & ({
    summaryModelFailed: false;
    summaryFailureCode?: never;
} | {
    summaryModelFailed: true;
    summaryFailureCode: PortableSummaryFailureCode;
}));
export interface PortableCompactionPorts {
    summarizePrefix(messages: readonly Message[], signal: AbortSignal): Promise<string>;
    applyPlan(plan: CompactionPlan, summaryText?: string): CompactionApplyOutcome;
}
export declare function executePortableCompaction(request: {
    plan: CompactionPlan;
    signal: AbortSignal;
    trigger: PortableCompactionTrigger;
}, ports: PortableCompactionPorts): Promise<PortableCompactionExecutionOutcome>;
