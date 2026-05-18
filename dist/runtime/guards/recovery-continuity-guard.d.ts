import { type GuardDecision } from './policy.js';
export declare function evaluateRecoveryContinuityGuard(input: {
    taskId: string;
    recovering: boolean;
    hasSnapshot: boolean;
    hasTraceReference: boolean;
}): GuardDecision;
