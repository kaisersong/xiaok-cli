import { findSkillByCommandName, type SkillCatalog, type SkillMeta } from './loader.js';
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

function toPlanStep(skill: SkillMeta): SkillPlanStep {
  return {
    name: skill.name,
    description: skill.description,
    path: skill.path,
    rootDir: skill.rootDir,
    source: skill.source,
    tier: skill.tier,
    executionContext: skill.executionContext,
    allowedTools: [...skill.allowedTools],
    agent: skill.agent,
    model: skill.model,
    effort: skill.effort,
    dependsOn: [...skill.dependsOn],
    content: skill.content,
    referencesManifest: skill.referencesManifest.map((entry) => ({ ...entry })),
    scriptsManifest: skill.scriptsManifest.map((entry) => ({ ...entry })),
    assetsManifest: skill.assetsManifest.map((entry) => ({ ...entry })),
    requiredReferences: [...skill.requiredReferences],
    requiredScripts: [...skill.requiredScripts],
    requiredSteps: [...skill.requiredSteps],
    successChecks: skill.successChecks.map((check) => ({ ...check, terms: [...check.terms] })),
    strict: skill.strict,
  };
}

export function buildSkillExecutionPlan(
  names: string[],
  source: SkillCatalog | SkillMeta[],
): SkillExecutionPlan {
  const requested = names.filter(Boolean);
  const resolvedSkills = Array.isArray(source)
    ? resolveFromArray(requested, source)
    : source.resolve(requested);

  if (resolvedSkills.length === 0) {
    throw new Error(`找不到 skill: ${requested.join(', ') || '（空）'}`);
  }

  const primarySkill = resolvedSkills[resolvedSkills.length - 1]!;
  return {
    type: 'skill_plan',
    requested,
    resolved: resolvedSkills.map(toPlanStep),
    strategy: primarySkill.executionContext,
    primarySkill: primarySkill.name,
    strict: primarySkill.strict,
  };
}

function resolveFromArray(names: string[], skills: SkillMeta[]): SkillMeta[] {
  const ordered: SkillMeta[] = [];
  const seen = new Set<string>();
  const stack = new Set<string>();

  const visit = (name: string) => {
    if (seen.has(name)) return;
    if (stack.has(name)) {
      throw new Error(`skill dependency cycle detected: ${name}`);
    }

    const skill = findSkillByCommandName(skills, name);
    if (!skill) return;

    stack.add(name);
    for (const dependency of skill.dependsOn) {
      visit(dependency);
    }
    stack.delete(name);
    seen.add(name);
    ordered.push(skill);
  };

  for (const name of names) {
    visit(name);
  }

  return ordered;
}
