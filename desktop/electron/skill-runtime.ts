import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { SkillCatalog, SkillMeta } from '../../src/ai/skills/loader.js';
import { buildSkillExecutionPlan, type SkillExecutionPlan, type SkillPlanStep } from '../../src/ai/skills/planner.js';

// ---- Skill Trace ----

interface SkillTraceEvent {
  ts: number;
  taskId: string;
  skillName: string;
  stageId?: string;
  iteration?: number;
  event:
    | 'skill_invoked'
    | 'model_turn_start'
    | 'model_turn_end'
    | 'tool_start'
    | 'tool_end'
    | 'stage_start'
    | 'stage_end'
    | 'budget_warning';
  toolName?: string;
  inputBytes?: number;
  outputBytes?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  details?: string;
}

function getSkillTracePath(dataRoot: string): string {
  return join(dataRoot, 'skill-trace.jsonl');
}

function appendTrace(dataRoot: string, event: SkillTraceEvent): void {
  try {
    const path = getSkillTracePath(dataRoot);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(event) + '\n', { flag: 'a' });
  } catch { /* trace failure is non-critical */ }
}

// ---- Skill Invocation ----

export interface SkillInvocation {
  plan: SkillExecutionPlan;
  primarySkill: string;
  stageId: string;
  stageStartIteration: number;
  traceId: string;
}

// ---- Stage Policy ----

interface SkillStageDef {
  id: string;
  goal: string;
  allowedReferenceGlobs: string[];
  forbiddenReferenceGlobs: string[];
  exitArtifacts: string[];
  maxModelTurns: number;
}

export interface SkillStagePolicy {
  skillName: string;
  stages: SkillStageDef[];
}

const STAGE_POLICIES: SkillStagePolicy[] = [
  {
    skillName: 'kai-report-creator',
    stages: [
      {
        id: 'plan_ir',
        goal: 'Create .report.md IR only',
        allowedReferenceGlobs: [
          'references/spec-loading-matrix.md',
          'references/design-quality.md',
          'references/regular-report-content-rules.md',
          'references/regular-report-template.md',
        ],
        forbiddenReferenceGlobs: [
          'references/html-shell/**',
          'references/rendering/**',
          'references/theme-css.md',
          'themes/**',
          'references/html-shell-template.md',
          'references/review-checklist.md',
          'references/anti-patterns.md',
          'references/rendering-rules.md',
        ],
        exitArtifacts: ['*.report.md'],
        maxModelTurns: 5,
      },
      {
        id: 'generate_html',
        goal: 'Render HTML from the .report.md IR',
        allowedReferenceGlobs: [
          'references/html-shell-template.md',
          'references/html-shell/**',
          'references/theme-css.md',
          'references/rendering-rules.md',
          'references/rendering/**',
          'references/review-checklist.md',
          'references/anti-patterns.md',
          'references/design-quality.md',
        ],
        forbiddenReferenceGlobs: [],
        exitArtifacts: ['*.html'],
        maxModelTurns: 10,
      },
      {
        id: 'validate',
        goal: 'Run validation and at most one targeted repair',
        allowedReferenceGlobs: ['references/review-checklist.md'],
        forbiddenReferenceGlobs: [],
        exitArtifacts: [],
        maxModelTurns: 3,
      },
    ],
  },
  {
    skillName: 'kai-slide-creator',
    stages: [
      {
        id: 'plan_outline',
        goal: 'Create slide outline in markdown',
        allowedReferenceGlobs: ['references/**'],
        forbiddenReferenceGlobs: [],
        exitArtifacts: ['*.md'],
        maxModelTurns: 4,
      },
      {
        id: 'generate_pptx',
        goal: 'Generate PPTX from outline',
        allowedReferenceGlobs: ['references/**'],
        forbiddenReferenceGlobs: [],
        exitArtifacts: ['*.pptx'],
        maxModelTurns: 8,
      },
    ],
  },
];

function getStagePolicy(skillName: string): SkillStagePolicy | undefined {
  return STAGE_POLICIES.find(p => p.skillName === skillName);
}

function matchesGlob(filePath: string, glob: string): boolean {
  // Simple glob matching: * = any chars except /, ** = any path
  const pattern = glob
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '__DOUBLESTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__DOUBLESTAR__/g, '.*');
  const re = new RegExp(`^${pattern}$`);
  return re.test(filePath);
}

function isPathInSkillRefs(filePath: string, planStep: SkillPlanStep): boolean {
  const skillRoot = planStep.rootDir;
  return filePath.startsWith(skillRoot);
}

function getRefPathInSkill(filePath: string, planStep: SkillPlanStep): string {
  if (!filePath.startsWith(planStep.rootDir)) return filePath;
  return filePath.slice(planStep.rootDir.length + 1); // relative path within skill root
}

export function checkStagePolicyViolation(
  toolName: string,
  toolInput: Record<string, unknown>,
  invocation: SkillInvocation,
): { violation: true; message: string } | { violation: false } {
  if (toolName !== 'Read') return { violation: false };
  const filePath = toolInput.file_path as string | undefined;
  if (!filePath) return { violation: false };

  const policy = getStagePolicy(invocation.primarySkill);
  if (!policy) return { violation: false };

  const stage = policy.stages.find(s => s.id === invocation.stageId);
  if (!stage) return { violation: false };

  // Check if the file is within the primary skill's references
  const primaryStep = invocation.plan.resolved.find(s => s.name === invocation.primarySkill);
  if (!primaryStep) return { violation: false };

  const relPath = getRefPathInSkill(filePath, primaryStep);
  if (!isPathInSkillRefs(filePath, primaryStep)) return { violation: false };

  // Check forbidden globs first
  for (const glob of stage.forbiddenReferenceGlobs) {
    if (matchesGlob(relPath, glob)) {
      return { violation: true, message: `Stage "${invocation.stageId}": forbidden reference "${relPath}"` };
    }
  }

  // Check allowed globs (if any are specified, file must match at least one)
  if (stage.allowedReferenceGlobs.length > 0) {
    const isAllowed = stage.allowedReferenceGlobs.some(g => matchesGlob(relPath, g));
    if (!isAllowed) {
      return { violation: true, message: `Stage "${invocation.stageId}": reference "${relPath}" not in allowed list` };
    }
  }

  return { violation: false };
}

// ---- Budget Guard ----

export interface SkillBudget {
  maxIterations: number;
  maxToolCalls: number;
  maxReferenceReads: number;
  maxRepairAttempts: number;
  maxTotalInputTokens: number;
}

const DEFAULT_BUDGET: SkillBudget = {
  maxIterations: 12,
  maxToolCalls: 16,
  maxReferenceReads: 8,
  maxRepairAttempts: 1,
  maxTotalInputTokens: 180_000,
};

function getBudget(policy?: SkillStagePolicy): SkillBudget {
  if (!policy) return DEFAULT_BUDGET;
  return { ...DEFAULT_BUDGET }; // Can customize per-policy later
}

export function checkBudget(
  invocation: SkillInvocation,
  currentIteration: number,
  totalToolCalls: number,
  referenceReads: number,
  totalInputTokens: number,
  dataRoot: string,
): { ok: true } | { ok: false; reason: string } {
  const budget = getBudget(getStagePolicy(invocation.primarySkill));

  if (currentIteration >= budget.maxIterations) {
    appendTrace(dataRoot, {
      ts: Date.now(), taskId: invocation.traceId, skillName: invocation.primarySkill,
      event: 'budget_warning', details: `maxIterations ${budget.maxIterations} reached`,
    });
    return { ok: false, reason: 'max_iterations_exceeded' };
  }
  if (totalToolCalls >= budget.maxToolCalls) {
    appendTrace(dataRoot, {
      ts: Date.now(), taskId: invocation.traceId, skillName: invocation.primarySkill,
      event: 'budget_warning', details: `maxToolCalls ${budget.maxToolCalls} reached`,
    });
    return { ok: false, reason: 'max_tool_calls_exceeded' };
  }
  if (referenceReads >= budget.maxReferenceReads) {
    appendTrace(dataRoot, {
      ts: Date.now(), taskId: invocation.traceId, skillName: invocation.primarySkill,
      event: 'budget_warning', details: `maxReferenceReads ${budget.maxReferenceReads} reached`,
    });
    return { ok: false, reason: 'max_reference_reads_exceeded' };
  }
  if (totalInputTokens >= budget.maxTotalInputTokens) {
    appendTrace(dataRoot, {
      ts: Date.now(), taskId: invocation.traceId, skillName: invocation.primarySkill,
      event: 'budget_warning', details: `maxTotalInputTokens ${budget.maxTotalInputTokens} reached`,
    });
    return { ok: false, reason: 'input_token_budget_exceeded' };
  }
  return { ok: true };
}

// ---- Skill Bundle Refs Tool ----

export function createSkillBundleRefsTool(skillCatalog: SkillCatalog) {
  return {
    permission: 'safe' as const,
    definition: {
      name: 'skill_bundle_refs',
      description: 'Bundle multiple skill reference files into one response. Use this instead of individual Read calls for skill references. Only paths listed in the skill\'s referencesManifest are allowed.',
      inputSchema: {
        type: 'object',
        properties: {
          skillName: { type: 'string', description: 'Skill name (e.g., "kai-report-creator")' },
          paths: { type: 'array', items: { type: 'string' }, description: 'Reference file paths relative to skill root (from referencesManifest)' },
          maxBytes: { type: 'number', description: 'Maximum total bytes (default 80000)' },
        },
        required: ['skillName', 'paths'],
      },
    },
    async execute(input: Record<string, unknown>) {
      const skillName = input.skillName as string;
      const paths = (input.paths as string[]) || [];
      const maxBytes = (input.maxBytes as number) ?? 80_000;

      if (!skillName) return 'Error: skillName required';
      if (paths.length === 0) return 'Error: at least one path required';

      const skills = skillCatalog.list();
      const skill = skills.find(s => s.name === skillName);
      if (!skill) return `Error: skill "${skillName}" not found`;

      // Validate all paths are in referencesManifest
      const allowedPaths = new Set(skill.referencesManifest.map(e => e.relativePath));
      const validPaths: string[] = [];
      const errors: string[] = [];

      for (const p of paths) {
        if (allowedPaths.has(p)) {
          validPaths.push(p);
        } else {
          errors.push(`"${p}" not in ${skillName} referencesManifest`);
        }
      }

      if (errors.length > 0) {
        return `Error: invalid reference paths:\n${errors.join('\n')}`;
      }

      // Deduplicate
      const uniquePaths = [...new Set(validPaths)];

      // Read and bundle
      let totalBytes = 0;
      const parts: string[] = [];

      for (const p of uniquePaths) {
        const absPath = join(skill.rootDir, p);
        try {
          const content = readFileSync(absPath, 'utf-8');
          if (totalBytes + content.length > maxBytes) {
            parts.push(`\n## ${p}\n...[truncated, exceeded maxBytes]`);
            break;
          }
          parts.push(`\n## ${p}\n\n${content}`);
          totalBytes += content.length;
        } catch {
          parts.push(`\n## ${p}\n...[failed to read]`);
        }
      }

      return parts.join('\n');
    },
  };
}

// ---- Skill Invocation Builder ----

export function buildSkillInvocation(
  skillName: string,
  skillCatalog: SkillCatalog,
  taskId: string,
): SkillInvocation | null {
  try {
    const plan = buildSkillExecutionPlan([skillName], skillCatalog);
    return {
      plan,
      primarySkill: plan.primarySkill,
      stageId: plan.resolved[0]?.name ? 'plan_ir' : 'default',
      stageStartIteration: 1,
      traceId: taskId,
    };
  } catch {
    return null;
  }
}

export { getStagePolicy, STAGE_POLICIES, DEFAULT_BUDGET, appendTrace, getSkillTracePath };
export type { SkillTraceEvent };
