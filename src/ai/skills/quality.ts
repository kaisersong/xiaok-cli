import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import {
  discoverSkills,
  parseFrontmatter,
  type ParsedFrontmatter,
  type SkillLoadOptions,
} from './loader.js';
import { getConfigDir } from '../../utils/config.js';

export type SkillIssueSeverity = 'error' | 'warning';

export interface SkillValidationIssue {
  severity: SkillIssueSeverity;
  code: string;
  message: string;
}

export interface SkillValidationResult {
  ok: boolean;
  path: string;
  skillName?: string;
  issues: SkillValidationIssue[];
  summary: {
    errors: number;
    warnings: number;
  };
}

export interface ValidateSkillFileOptions extends SkillLoadOptions {
  cwd?: string;
  xiaokConfigDir?: string;
}

const MULTI_GOAL_WARNING_THRESHOLD = 1;
const PROGRESSIVE_DISCLOSURE_LINE_THRESHOLD = 80;
const PROGRESSIVE_DISCLOSURE_CHAR_THRESHOLD = 2000;

function issue(
  severity: SkillIssueSeverity,
  code: string,
  message: string,
): SkillValidationIssue {
  return { severity, code, message };
}

function inferAliases(filePath: string): string[] {
  const resolved = resolve(filePath);
  const fileName = basename(resolved);
  if (fileName === 'SKILL.md') {
    return [basename(dirname(resolved))];
  }
  if (fileName.endsWith('.md')) {
    return [basename(fileName, '.md')];
  }
  return [];
}

function hasGoalSection(content: string): boolean {
  return /(^|\n)#{1,3}\s*(goal|目标)\b/i.test(content);
}

function hasSuccessCriteria(content: string): boolean {
  return /(^|\n)#{1,3}\s*(success criteria|成功标准)\b/i.test(content);
}

function hasNonGoals(content: string): boolean {
  return /(^|\n)#{1,3}\s*(non-goals?|非目标|不做什么)\b/i.test(content);
}

function shouldWarnProgressiveDisclosure(content: string, filePath: string): boolean {
  const lineCount = content.split(/\r?\n/).length;
  const isLong = content.length >= PROGRESSIVE_DISCLOSURE_CHAR_THRESHOLD
    || lineCount >= PROGRESSIVE_DISCLOSURE_LINE_THRESHOLD;
  if (!isLong) {
    return false;
  }

  const skillDir = dirname(filePath);
  if (basename(filePath) !== 'SKILL.md') {
    return false;
  }

  if (!existsSync(skillDir)) {
    return true;
  }

  const entries = new Set(readdirSync(skillDir));
  return !entries.has('references') && !entries.has('scripts') && !entries.has('assets');
}

function validateParsedFrontmatter(
  parsed: ParsedFrontmatter,
  filePath: string,
): SkillValidationIssue[] {
  const issues: SkillValidationIssue[] = [];
  const normalizedName = parsed.name.trim();

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(normalizedName)) {
    issues.push(issue('error', 'invalid_name', 'Skill name must use lowercase hyphen-case.'));
  }

  if (!parsed.whenToUse?.trim()) {
    issues.push(issue('error', 'missing_when_to_use', 'Add when-to-use so the skill has a clear trigger contract.'));
  }

  if (parsed.taskGoals.length === 0) {
    issues.push(issue('error', 'missing_task_goals', 'Add at least one task-goals entry for the primary job.'));
  } else if (parsed.taskGoals.length > MULTI_GOAL_WARNING_THRESHOLD) {
    issues.push(issue('warning', 'multiple_primary_goals', 'This skill lists multiple primary jobs and should probably be split.'));
  }

  if (parsed.examples.length === 0) {
    issues.push(issue('error', 'missing_examples', 'Add examples so the skill can be routed and evaluated.'));
  }

  if (!hasGoalSection(parsed.content)) {
    issues.push(issue('warning', 'missing_goal_section', 'Add a Goal section so the primary outcome is explicit.'));
  }

  if (!hasSuccessCriteria(parsed.content)) {
    issues.push(issue('error', 'missing_success_criteria', 'Add Success Criteria so completion is observable.'));
  }

  if (!hasNonGoals(parsed.content)) {
    issues.push(issue('warning', 'missing_non_goals', 'Add Non-Goals or an equivalent section to prevent over-broad routing.'));
  }

  if (shouldWarnProgressiveDisclosure(parsed.content, filePath)) {
    issues.push(issue('warning', 'progressive_disclosure_missing', 'This skill is long and should move detail into references/, scripts/, or assets/.'));
  }

  return issues;
}

function findConflicts(
  filePath: string,
  parsed: ParsedFrontmatter,
  catalog: Awaited<ReturnType<typeof discoverSkills>>,
): SkillValidationIssue[] {
  const currentPath = resolve(filePath);
  const currentTokens = new Set([parsed.name, ...inferAliases(filePath)]);

  for (const skill of catalog) {
    if (resolve(skill.path) === currentPath) {
      continue;
    }

    const tokens = new Set([skill.name, ...(skill.aliases ?? [])]);
    for (const token of currentTokens) {
      if (!tokens.has(token)) {
        continue;
      }

      return [
        issue(
          'error',
          'name_conflict',
          `Skill command "${token}" already exists at ${skill.path}. Choose a different name or alias.`,
        ),
      ];
    }
  }

  return [];
}

export async function validateSkillFile(
  filePath: string,
  options: ValidateSkillFileOptions = {},
): Promise<SkillValidationResult> {
  const resolvedPath = resolve(filePath);
  const issues: SkillValidationIssue[] = [];
  let parsed: ParsedFrontmatter | null = null;

  try {
    parsed = parseFrontmatter(readFileSync(resolvedPath, 'utf8'));
  } catch {
    parsed = null;
  }

  if (!parsed) {
    issues.push(issue('error', 'invalid_frontmatter', 'Skill file must contain valid YAML frontmatter with name and description.'));
    return {
      ok: false,
      path: resolvedPath,
      issues,
      summary: { errors: 1, warnings: 0 },
    };
  }

  issues.push(...validateParsedFrontmatter(parsed, resolvedPath));

  const catalog = await discoverSkills(
    options.xiaokConfigDir ?? getConfigDir(),
    options.cwd ?? process.cwd(),
    options,
  );
  issues.push(...findConflicts(resolvedPath, parsed, catalog));

  const errors = issues.filter((entry) => entry.severity === 'error').length;
  const warnings = issues.length - errors;

  return {
    ok: errors === 0,
    path: resolvedPath,
    skillName: parsed.name,
    issues,
    summary: { errors, warnings },
  };
}
