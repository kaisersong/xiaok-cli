import type { TaskSnapshot } from './types.js';
export interface DeliverableGateResult {
    complete: boolean;
    missing?: string[];
}
export interface DeliverableGateInput {
    prompt: string;
    artifacts: Array<{
        kind?: string;
        label?: string;
    }>;
    signal: AbortSignal;
}
export type DeliverableGateFunction = (input: DeliverableGateInput) => Promise<DeliverableGateResult>;
/**
 * Checks if a user prompt likely requests multiple deliverables.
 * Uses alternation patterns (not character classes) to match deliverable terms.
 */
export declare function looksLikeMultiDeliverable(prompt: string): boolean;
/**
 * Runs the deliverable completeness gate.
 * Returns true (pass) if:
 * - prompt doesn't look like multi-deliverable
 * - gate function says complete (if provided)
 * - built-in plan check passes (all progress steps completed)
 * - gate function throws (fail-open: don't block task completion)
 *
 * Built-in check: examines the last progress_plan_reported event.
 * If there are planned/running steps remaining, the task is incomplete.
 */
export declare function runDeliverableGate(snapshot: TaskSnapshot, gateFunction: DeliverableGateFunction | undefined, signal: AbortSignal): Promise<boolean>;
