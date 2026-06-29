import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';
import type { SkillCatalog, SkillMeta } from '../../src/ai/skills/loader.js';
import { buildSkillExecutionPlan, type SkillExecutionPlan, type SkillPlanStep } from '../../src/ai/skills/planner.js';

/**
 * Returns true when a skill-relative reference path would escape the skill root.
 *
 * The check is cross-platform and does not rely on string heuristics alone:
 * - rejects absolute paths on any host — POSIX (`/x`), Windows drive (`C:\x`,
 *   `C:/x`) and UNC (`\\server`, `//server`), including Windows-style paths even
 *   when the runtime is POSIX;
 * - resolves the path against the root and uses path.relative to reject any
 *   `..` traversal regardless of separator.
 *
 * Historically this only checked `startsWith('/')` / `..\\`, which let Windows
 * absolute paths like `C:\Windows\System32` slip through on Windows hosts.
 */
export function referenceEscapesSkillRoot(rootDir: string, p: string): boolean {
  if (!p) return true;
  if (isAbsolute(p)) return true;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return true;
  if (p.startsWith('\\\\') || p.startsWith('//')) return true;
  const root = resolve(rootDir);
  const target = resolve(root, p);
  const rel = relative(root, target);
  if (rel === '') return false;
  return rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('../') || isAbsolute(rel);
}

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

// ---- Budget Guard ----

export interface SkillBudget {
  maxIterations: number;
  maxToolCalls: number;
  maxReferenceReads: number;
  maxRepairAttempts: number;
  maxTotalInputTokens: number;
}

const DEFAULT_BUDGET: SkillBudget = {
  maxIterations: 25,
  maxToolCalls: 40,
  maxReferenceReads: 8,
  maxRepairAttempts: 1,
  maxTotalInputTokens: 1_000_000,
};

function getBudget(): SkillBudget {
  return DEFAULT_BUDGET;
}

export function checkBudget(
  invocation: SkillInvocation,
  currentIteration: number,
  totalToolCalls: number,
  referenceReads: number,
  totalInputTokens: number,
  dataRoot: string,
): { ok: true } | { ok: false; reason: string } {
  const budget = getBudget();

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
      description: 'Bundle multiple skill files into one response. Use instead of individual Read calls. Paths must be within the skill root directory (e.g., "SKILL.md", "stages/plan.md", "references/html-template.md").',
      inputSchema: {
        type: 'object',
        properties: {
          skillName: { type: 'string', description: 'Skill name (e.g., "kai-report-creator")' },
          paths: { type: 'array', items: { type: 'string' }, description: 'File paths relative to skill root (e.g., "SKILL.md", "stages/plan.md", "references/template.md")' },
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

      // Validate all paths are within skill root directory (not outside)
      // Allow: references/*, stages/*, SKILL.md, scripts/* etc.
      const validPaths: string[] = [];
      const errors: string[] = [];

      for (const p of paths) {
        // Reject paths that escape skill root (cross-platform; see referenceEscapesSkillRoot)
        if (referenceEscapesSkillRoot(skill.rootDir, p)) {
          errors.push(`"${p}" escapes skill root directory`);
        } else {
          validPaths.push(p);
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
      stageId: 'default',
      stageStartIteration: 1,
      traceId: taskId,
    };
  } catch {
    return null;
  }
}

export { DEFAULT_BUDGET, appendTrace, getSkillTracePath };
export type { SkillTraceEvent };
