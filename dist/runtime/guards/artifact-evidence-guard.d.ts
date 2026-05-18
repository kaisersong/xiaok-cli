import { type GuardDecision } from './policy.js';
export declare function evaluateArtifactEvidenceGuard(input: {
    taskId: string;
    status: string;
    artifacts?: unknown[];
}): GuardDecision;
