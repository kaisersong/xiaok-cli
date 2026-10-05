import type { IntentType, RiskTier, IntentMode, SegmentationConfidence, StepRole } from '../../ai/intent-delegation/types.js';
import { type GoalVerificationDefinition } from '../goal/verification-definition.js';
export interface IntentContractStep {
    readonly stepId: string;
    readonly key: string;
    readonly order: number;
    readonly role: StepRole;
    readonly skillName: string | null;
    readonly dependsOn: readonly string[];
    readonly riskTier: RiskTier;
}
export interface IntentContractStage {
    readonly stageId: string;
    readonly order: number;
    readonly label: string;
    readonly intentType: IntentType;
    readonly deliverable: string;
    readonly templateId: string;
    readonly riskTier: RiskTier;
    readonly dependsOnStageIds: readonly string[];
    readonly steps: readonly Readonly<IntentContractStep>[];
    readonly verification: Readonly<GoalVerificationDefinition>;
}
export interface IntentBusinessContract {
    readonly version: 1;
    readonly sessionId: string;
    readonly intentId: string;
    readonly rawIntent: string;
    readonly normalizedIntent: string;
    readonly providedSourcePaths: readonly string[];
    readonly intentType: IntentType;
    readonly deliverable: string;
    readonly finalDeliverable: string;
    readonly explicitConstraints: readonly string[];
    readonly delegationBoundary: readonly string[];
    readonly riskTier: RiskTier;
    readonly intentMode: IntentMode;
    readonly segmentationConfidence: SegmentationConfidence;
    readonly templateId: string;
    readonly stages: readonly Readonly<IntentContractStage>[];
    readonly verification: Readonly<GoalVerificationDefinition>;
}
/** Pure immutable contract. No owner is enrolled and no result is verified here. */
export declare function parseIntentBusinessContract(raw: unknown): Readonly<IntentBusinessContract>;
export declare function intentBusinessContractHash(raw: unknown): string;
