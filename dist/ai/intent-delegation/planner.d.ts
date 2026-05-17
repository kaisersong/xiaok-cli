import type { IntentPlanDraft, IntentType, StepRole } from './types.js';
import type { SkillMeta } from '../skills/loader.js';
export interface ActiveIntentContext {
    intentId: string;
    deliverable: string;
    intentType: IntentType;
    templateId: string;
}
export interface CreateIntentPlanInput {
    instanceId: string;
    sessionId: string;
    input: string;
    skills: SkillMeta[];
    activeIntent?: ActiveIntentContext;
    skillScoreLookup?: (input: {
        skillName: string;
        intentType: IntentType;
        stageRole: StepRole;
        deliverable: string;
    }) => number;
}
export type IntentPlannerResult = {
    kind: 'plan';
    plan: IntentPlanDraft;
} | {
    kind: 'non_intent';
    reason: 'control_command' | 'non_substantial';
};
export declare function createIntentPlan(input: CreateIntentPlanInput): IntentPlannerResult;
