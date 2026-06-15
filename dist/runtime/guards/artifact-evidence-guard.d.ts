import { type GuardDecision } from './policy.js';
import { type CompletionEvidenceRecord, type CompletionExpectation } from './completion-evidence.js';
export declare function evaluateArtifactEvidenceGuard(input: {
    taskId: string;
    status: string;
    artifacts?: unknown[];
    expectation?: CompletionExpectation;
    evidence?: CompletionEvidenceRecord[];
}): GuardDecision;
