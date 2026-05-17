import type { IntentType, StepRole } from '../../ai/intent-delegation/types.js';
import { type ContextualSkillScoreRecord, type SkillFeedbackRecord, type SkillRoutingObservation } from './skill-eval.js';
export declare class FileSkillScoreStore {
    private readonly filePath;
    constructor(filePath?: string);
    loadAll(): ContextualSkillScoreRecord[];
    getBoost(input: {
        skillName: string;
        intentType: IntentType;
        stageRole: StepRole;
        deliverableFamily: string;
    }): number;
    recordRuntimeObservation(observation: SkillRoutingObservation): void;
    recordFeedback(feedback: SkillFeedbackRecord, observations: SkillRoutingObservation[]): void;
    private mutate;
}
