import type { IntentType, StepRole, ValidationState } from '../../ai/intent-delegation/types.js';
export type SkillEvalObservationStatus = 'planned' | 'running' | 'blocked' | 'completed' | 'failed';
export interface SkillRoutingObservation {
    observationId: string;
    sessionId: string;
    intentId: string;
    stageId: string;
    stepId: string;
    intentType: IntentType;
    stageRole: StepRole;
    deliverable: string;
    deliverableFamily: string;
    selectedSkillName: string;
    actualSkillName?: string;
    status: SkillEvalObservationStatus;
    artifactRecorded: boolean;
    structuralValidation?: ValidationState;
    semanticValidation?: ValidationState;
    createdAt: number;
    updatedAt: number;
}
export type SkillFeedbackKind = 'outcome' | 'routing' | 'intent_understanding';
export type SkillFeedbackSentiment = 'positive' | 'negative';
export interface SkillFeedbackRecord {
    feedbackId: string;
    sessionId: string;
    intentId: string;
    kind: SkillFeedbackKind;
    sentiment: SkillFeedbackSentiment;
    observationIds: string[];
    note?: string;
    createdAt: number;
}
export interface SessionSkillEvalState {
    observations: SkillRoutingObservation[];
    feedback: SkillFeedbackRecord[];
    promptedIntentIds: string[];
    updatedAt: number;
}
export interface ContextualSkillScoreRecord {
    skillName: string;
    intentType: IntentType;
    stageRole: StepRole;
    deliverableFamily: string;
    runtimeSuccessObservationIds: string[];
    runtimeFailureObservationIds: string[];
    routingPositiveFeedbackIds: string[];
    routingNegativeFeedbackIds: string[];
    outcomePositiveFeedbackIds: string[];
    outcomeNegativeFeedbackIds: string[];
    updatedAt: number;
}
export declare function createEmptySessionSkillEvalState(now?: number): SessionSkillEvalState;
export declare function cloneSessionSkillEvalState(state: SessionSkillEvalState): SessionSkillEvalState;
export declare function cloneContextualSkillScoreRecord(record: ContextualSkillScoreRecord): ContextualSkillScoreRecord;
export declare function buildSkillScoreKey(input: {
    skillName: string;
    intentType: IntentType;
    stageRole: StepRole;
    deliverableFamily: string;
}): string;
export declare function inferDeliverableFamily(value: string): string;
export declare function computeContextualSkillBoost(record?: ContextualSkillScoreRecord | null): number;
