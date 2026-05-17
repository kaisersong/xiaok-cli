import type { ActiveIntentContext, CreateIntentPlanInput } from './planner.js';
import type { IntentPlanDraft, IntentType } from './types.js';
export type AmbiguityType = 'verb_no_output' | 'material_no_directive' | 'implicit_workflow';
export type BoundarySource = 'rule' | 'llm' | 'validator' | 'compat_legacy';
export type LlmClassifierMode = 'off' | 'shadow' | 'ambiguous_only';
export type AmbiguousFallbackMode = 'legacy_validator' | 'answer_directly' | 'ask_clarification';
export interface IntentBoundaryConfig {
    llmClassifier: LlmClassifierMode;
    ambiguousFallback: AmbiguousFallbackMode;
    confidenceThreshold: number;
    falseNegativeClarifyThreshold: number;
    timeoutMs: number;
    maxInputTokens: number;
    maxOutputTokens: number;
}
export interface PlannerHint {
    intentType?: IntentType;
    deliverables?: string[];
    providedSourcePaths?: string[];
    prefersIntent?: boolean;
    reason: string;
}
export type RuleBoundaryDecision = {
    kind: 'definite_non_intent';
    reason: string;
    plannerHint?: PlannerHint;
} | {
    kind: 'definite_intent';
    reason: string;
    plannerHint: PlannerHint;
} | {
    kind: 'ambiguous';
    ambiguityType: AmbiguityType;
    reason: string;
    plannerHint?: PlannerHint;
};
export interface IntentBoundaryInput {
    input: string;
    instanceId: string;
    sessionId: string;
    cwd: string;
    skills: CreateIntentPlanInput['skills'];
    activeIntent?: ActiveIntentContext;
    skillScoreLookup?: CreateIntentPlanInput['skillScoreLookup'];
}
export type LlmBoundaryDecision = {
    kind: 'answer_directly';
    confidence: number;
    reason: string;
} | {
    kind: 'create_intent';
    confidence: number;
    intentType: IntentType;
    deliverables: string[];
    constraints: string[];
    reason: string;
} | {
    kind: 'ask_clarification';
    confidence: number;
    question: string;
    reason: string;
};
export type ValidatedBoundaryDecision = {
    kind: 'non_intent';
    reason: string;
    source: BoundarySource;
} | {
    kind: 'intent';
    plan: IntentPlanDraft;
    source: BoundarySource;
} | {
    kind: 'clarify';
    question: string;
    reason: string;
    source: BoundarySource;
};
export interface IntentBoundaryDebugEvent {
    type: 'intent_boundary_decision';
    source: BoundarySource;
    decision: ValidatedBoundaryDecision['kind'];
    reason: string;
    ambiguityType?: AmbiguityType;
    confidence?: number;
    shadowDecision?: LlmBoundaryDecision['kind'];
    divergence?: boolean;
}
