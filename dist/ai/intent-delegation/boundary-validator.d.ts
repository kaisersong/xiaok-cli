import type { BoundarySource, IntentBoundaryInput, LlmBoundaryDecision, RuleBoundaryDecision, ValidatedBoundaryDecision } from './boundary-types.js';
type RuleIntentDecision = {
    kind: 'rule_intent';
    reason: string;
};
export interface ValidateBoundaryCandidate {
    source: BoundarySource;
    decision: LlmBoundaryDecision | RuleIntentDecision;
    ruleDecision?: RuleBoundaryDecision;
}
export interface ValidateBoundaryOptions {
    confidenceThreshold?: number;
    falseNegativeClarifyThreshold?: number;
}
export declare function validateBoundaryDecision(input: IntentBoundaryInput, candidate: ValidateBoundaryCandidate, options?: ValidateBoundaryOptions): ValidatedBoundaryDecision;
export {};
