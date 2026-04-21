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
  taskHints: SkillMeta['taskHints'];
  content: string;
}

export interface SkillExecutionPlan {
  type: 'skill_plan';
  requested: string[];
  resolved: SkillPlanStep[];
  strategy: 'inline' | 'fork';
  primarySkill: string;
}

function toPlanStep(skill: SkillMeta): SkillPlanStep {
  return {
    name: skill.name,
    description: skill.description,
    path: skill.path,
    source: skill.source,
    tier: skill.tier,
    executionContext: skill.executionContext,
    allowedTools: [...skill.allowedTools],
    agent: skill.agent,
    model: skill.model,
    effort: skill.effort,
    dependsOn: [...skill.dependsOn],
    taskHints: skill.taskHints,
    content: skill.content,
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
  };
}

function resolveFromArray(names: string[], skills: SkillMeta[]): SkillMeta[] {
  const ordered: SkillMeta[] = [];
  const seen = new Set<string>();
  const stack = new Set<string>();
  const byName = new Map(skills.map((skill) => [skill.name, skill]));

  const visit = (name: string) => {
    if (seen.has(name)) return;
    if (stack.has(name)) {
      throw new Error(`skill dependency cycle detected: ${name}`);
    }

    const skill = byName.get(name);
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
