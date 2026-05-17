import type { IntentBoundaryConfig, IntentBoundaryDebugEvent, IntentBoundaryInput, LlmBoundaryDecision, RuleBoundaryDecision, ValidatedBoundaryDecision } from './boundary-types.js';
export interface IntentBoundaryResolverOptions {
    config: IntentBoundaryConfig;
    llmClassify?: (input: IntentBoundaryInput, ruleDecision: Extract<RuleBoundaryDecision, {
        kind: 'ambiguous';
    }>) => Promise<LlmBoundaryDecision>;
    emitDebug?: (event: IntentBoundaryDebugEvent) => void;
}
export declare function createIntentBoundaryResolver(options: IntentBoundaryResolverOptions): {
    resolve(input: IntentBoundaryInput): Promise<ValidatedBoundaryDecision>;
};
