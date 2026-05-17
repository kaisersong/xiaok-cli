import type { SkillExecutionPlan } from './planner.js';
import type { SkillSuccessCheck } from './loader.js';
export interface SkillComplianceCheckResult {
    type: SkillSuccessCheck['type'];
    terms: string[];
    passed: boolean;
}
export interface SkillComplianceResult {
    passed: boolean;
    missingReferences: string[];
    missingScripts: string[];
    missingSteps: string[];
    failedChecks: SkillComplianceCheckResult[];
    checkedAt: number;
}
export interface SkillComplianceEvidenceView {
    readReferences: string[];
    runScripts: string[];
    completedSteps: string[];
}
export declare function evaluateSkillCompliance(input: {
    plan: SkillExecutionPlan;
    evidence: SkillComplianceEvidenceView;
    finalAnswer: string;
    checkedAt?: number;
}): SkillComplianceResult;
export declare function buildComplianceReminder(result: SkillComplianceResult): string;
