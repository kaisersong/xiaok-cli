import { type SkillCatalog, type SkillMeta } from './loader.js';
import type { SkillResourceEntry, SkillSuccessCheck } from './loader.js';
export interface SkillPlanStep {
    name: string;
    description: string;
    path: string;
    rootDir: string;
    source: SkillMeta['source'];
    tier: SkillMeta['tier'];
    executionContext: SkillMeta['executionContext'];
    allowedTools: string[];
    agent?: string;
    model?: string;
    effort?: string;
    dependsOn: string[];
    content: string;
    referencesManifest: SkillResourceEntry[];
    scriptsManifest: SkillResourceEntry[];
    assetsManifest: SkillResourceEntry[];
    requiredReferences: string[];
    requiredScripts: string[];
    requiredSteps: string[];
    successChecks: SkillSuccessCheck[];
    strict: boolean;
}
export interface SkillExecutionPlan {
    type: 'skill_plan';
    requested: string[];
    resolved: SkillPlanStep[];
    strategy: 'inline' | 'fork';
    primarySkill: string;
    strict: boolean;
}
export declare function buildSkillExecutionPlan(names: string[], source: SkillCatalog | SkillMeta[]): SkillExecutionPlan;
