import type { Tool } from '../../types.js';
import type { CapabilityRegistry } from '../../platform/runtime/capability-registry.js';
import type { SkillCatalog, SkillMeta } from './loader.js';
import { buildSkillExecutionPlan } from './planner.js';
import type { SkillExecutionPlan, SkillPlanStep } from './planner.js';

type SkillPlanStepWithTaskHints = SkillPlanStep & {
  taskHints: SkillMeta['taskHints'];
};

type SkillExecutionPlanWithTaskHints = Omit<SkillExecutionPlan, 'resolved'> & {
  resolved: SkillPlanStepWithTaskHints[];
};

function enrichSkillPlan(plan: SkillExecutionPlan, skills: SkillMeta[]): SkillExecutionPlanWithTaskHints {
  const byName = new Map(skills.map((skill) => [skill.name, skill]));

  return {
    ...plan,
    resolved: plan.resolved.map((step) => ({
      ...step,
      taskHints: byName.get(step.name)?.taskHints ?? {
        taskGoals: [],
        inputKinds: [],
        outputKinds: [],
        examples: [],
      },
    })),
  };
}

export function formatSkillPayload(skill: SkillMeta): string {
  return JSON.stringify({
    type: 'skill',
    name: skill.name,
    description: skill.description,
    path: skill.path,
    rootDir: skill.rootDir,
    source: skill.source,
    tier: skill.tier,
    allowedTools: skill.allowedTools,
    executionContext: skill.executionContext,
    agent: skill.agent,
    model: skill.model,
    effort: skill.effort,
    dependsOn: skill.dependsOn,
    userInvocable: skill.userInvocable,
    whenToUse: skill.whenToUse,
    taskHints: skill.taskHints,
    referencesManifest: skill.referencesManifest,
    scriptsManifest: skill.scriptsManifest,
    assetsManifest: skill.assetsManifest,
    requiredReferences: skill.requiredReferences,
    requiredScripts: skill.requiredScripts,
    requiredSteps: skill.requiredSteps,
    successChecks: skill.successChecks,
    strict: skill.strict,
    content: skill.content,
  }, null, 2);
}

function isSkillCatalog(value: SkillMeta[] | SkillCatalog): value is SkillCatalog {
  return !Array.isArray(value);
}

export function createSkillTool(skills: SkillMeta[] | SkillCatalog, capabilityRegistry?: CapabilityRegistry): Tool {
  const listSkillNames = (): string[] => {
    if (isSkillCatalog(skills)) {
      return skills.list().map((skill) => skill.name);
    }
    return skills.map((skill) => skill.name);
  };

  const listSkillRecords = (): SkillMeta[] => {
    if (isSkillCatalog(skills)) {
      return skills.list();
    }
    return skills;
  };

  const syncCapabilities = (): void => {
    for (const skill of listSkillRecords()) {
      capabilityRegistry?.register({
        kind: 'skill',
        name: skill.name,
        description: skill.description,
      });
    }
  };

  syncCapabilities();

  return {
    permission: 'safe',
    definition: {
      name: 'skill',
      description: `Execute a skill within the main conversation

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>", they are referring to a skill. Use this tool to invoke it.

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - name: "matched-skill-name" - invoke the skill that best matches the current user intent
  - name: "explicit-slash-command-name" - invoke the skill the user explicitly named

Important:
- Available skills are listed in system-reminder messages in the conversation
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- If you see skill content already loaded in the current conversation turn, follow the instructions directly instead of calling this tool again`,
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '单个 skill 名称（不含 / 前缀）',
          },
          names: {
            type: 'array',
            items: { type: 'string' },
            description: '多个 skill 名称。会自动解析依赖并去重。',
          },
        },
      },
    },
    async execute(input) {
      syncCapabilities();
      const { name, names } = input as { name?: string; names?: string[] };
      const requested = [
        ...(Array.isArray(names) ? names : []),
        ...(name ? [name] : []),
      ].filter(Boolean);

      if (requested.length === 0) {
        return 'Error: skill 工具至少需要提供 name 或 names';
      }

      try {
        const plan = buildSkillExecutionPlan(requested, skills);
        return JSON.stringify(enrichSkillPlan(plan, listSkillRecords()), null, 2);
      } catch {
        const available = listSkillNames().join(', ') || '（无）';
        return `Error: 找不到 skill "${requested.join(', ')}"。可用 skills：${available}`;
      }
    },
  };
}
