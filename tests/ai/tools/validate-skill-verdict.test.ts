import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createValidateSkillTool } from '../../../src/ai/tools/validate-skill.js';
import { isSuccessfulModelToolResult } from '../../../src/ai/tools/index.js';

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

function writeSkill(body: string): { skillPath: string; configDir: string; projectDir: string } {
  const configDir = createTempDir('xiaok-validate-skill-config');
  const projectDir = createTempDir('xiaok-validate-skill-project');
  const skillDir = join(projectDir, '.xiaok', 'skills', 'broken-skill');
  mkdirSync(skillDir, { recursive: true });
  const skillPath = join(skillDir, 'SKILL.md');
  writeFileSync(skillPath, body, 'utf8');
  return { skillPath, configDir, projectDir };
}

describe('validate_skill result is a verdict, not an operation status', () => {
  // `validateSkillFile` returns `ok: errors === 0`, meaning "the validated file
  // is clean". Once a top-level ok:false marks a tool result as failed, exposing
  // that field name would make a skill with errors look like a failed call, so
  // the model would retry the call instead of fixing the skill.
  it('reports a failing skill under `valid` and keeps the call successful', async () => {
    const { skillPath, configDir, projectDir } = writeSkill('# no frontmatter at all\n');
    const tool = createValidateSkillTool({ cwd: projectDir, configDir });

    const raw = await tool.execute({ path: skillPath });

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.valid).toBe(false);
    expect('ok' in parsed).toBe(false);
    expect(isSuccessfulModelToolResult(raw)).toBe(true);
  });

  it('still reports a clean skill as valid', async () => {
    const { skillPath, configDir, projectDir } = writeSkill(`---
name: broken-skill
description: Validate whether a single repository change is ready to ship
when-to-use: Use when a user asks whether one code change or branch is ready for release.
task-goals:
  - verify release readiness for one change
input-kinds:
  - branch diff
output-kinds:
  - release readiness summary
examples:
  - check whether this branch is ready to ship
---
# Goal

Run a single release-readiness pass for one code change.

## Workflow

1. Review the stated release candidate.
2. Check the required verification signals.
3. Summarize blockers and ready-to-ship confidence.

## Non-Goals

- Do not write release notes.
- Do not deploy anything.

## Success Criteria

- The result says whether the change is ready to ship.
- Missing verification is called out explicitly.
`);
    const tool = createValidateSkillTool({ cwd: projectDir, configDir });

    const raw = await tool.execute({ path: skillPath });

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.valid).toBe(true);
    expect(isSuccessfulModelToolResult(raw)).toBe(true);
  });

  it('reports advisory metadata gaps without making a runnable skill invalid', async () => {
    const { skillPath, configDir, projectDir } = writeSkill(`---
name: broken-skill
description: A runnable helper with only the loader-required metadata
---
# Notes

Help with the requested task.
`);
    const tool = createValidateSkillTool({ cwd: projectDir, configDir });

    const raw = await tool.execute({ path: skillPath });

    const parsed = JSON.parse(raw) as {
      valid: boolean;
      summary: { errors: number; warnings: number };
      issues: Array<{ severity: string; code: string }>;
    };
    expect(parsed.valid).toBe(true);
    expect(parsed.summary.errors).toBe(0);
    expect(parsed.summary.warnings).toBeGreaterThan(0);
    expect(parsed.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'warning', code: 'missing_when_to_use' }),
      expect.objectContaining({ severity: 'warning', code: 'missing_task_goals' }),
      expect.objectContaining({ severity: 'warning', code: 'missing_success_criteria' }),
    ]));
    expect(isSuccessfulModelToolResult(raw)).toBe(true);
  });
});
