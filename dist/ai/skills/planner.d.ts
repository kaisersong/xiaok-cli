import type { SkillCatalog, SkillMeta } from './loader.js';
export interface SkillPlanStep {
    name: string;
    description: string;
    path: string;
    source: SkillMeta['source'];
    tier: SkillMeta['tier'];
    executionContext: SkillMeta['executionContext'];
    allowedTools: string[];
    agent?: string;
    model?: string;
    effort?: string;
    dependsOn: string[];
    content: string;
}
export interface SkillExecutionPlan {
    type: 'skill_plan';
    requested: string[];
    resolved: SkillPlanStep[];
    strategy: 'inline' | 'fork';
    primarySkill: string;
}
export declare function buildSkillExecutionPlan(names: string[], source: SkillCatalog | SkillMeta[]): SkillExecutionPlan;
