import type { CompletionKind } from '../guards/completion-evidence.js';
import type { GoalEvidenceEnvelope, GoalState } from './types.js';
export interface GoalCompletionEvaluation {
    ok: boolean;
    missingKinds: CompletionKind[];
    message?: string;
}
export declare class GoalCompletionEvaluator {
    evaluate(goal: GoalState, evidence: GoalEvidenceEnvelope[]): GoalCompletionEvaluation;
}
