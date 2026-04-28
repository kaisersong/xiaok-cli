import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateSkillFile } from '../../../src/ai/skills/quality.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const path = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(path, { recursive: true });
  tempDirs.push(path);
  return path;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('validateSkillFile', () => {
  it('accepts a single-purpose skill with clear triggers and success criteria', async () => {
    const configDir = createTempDir('xiaok-skill-quality-config');
    const projectDir = createTempDir('xiaok-skill-quality-project');
    const skillDir = join(projectDir, '.xiaok', 'skills', 'release-checklist');
    mkdirSync(skillDir, { recursive: true });

    const skillPath = join(skillDir, 'SKILL.md');
    writeFileSync(skillPath, `---
name: release-checklist
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
`, 'utf8');

    const result = await validateSkillFile(skillPath, {
      xiaokConfigDir: configDir,
      cwd: projectDir,
      builtinRoots: [],
    });

    expect(result.ok).toBe(true);
    expect(result.summary.errors).toBe(0);
    expect(result.issues.filter((issue) => issue.severity === 'warning')).toHaveLength(0);
  });

  it('fails skills that are missing trigger guidance, examples, and completion criteria', async () => {
    const configDir = createTempDir('xiaok-skill-quality-config');
    const projectDir = createTempDir('xiaok-skill-quality-project');
    const skillDir = join(projectDir, '.xiaok', 'skills', 'bad-skill');
    mkdirSync(skillDir, { recursive: true });

    const skillPath = join(skillDir, 'SKILL.md');
    writeFileSync(skillPath, `---
name: bad-skill
description: misc helper
---
# Notes

Do a bunch of useful things for the team.
`, 'utf8');

    const result = await validateSkillFile(skillPath, {
      xiaokConfigDir: configDir,
      cwd: projectDir,
      builtinRoots: [],
    });

    const codes = result.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => issue.code);

    expect(result.ok).toBe(false);
    expect(codes).toContain('missing_when_to_use');
    expect(codes).toContain('missing_task_goals');
    expect(codes).toContain('missing_examples');
    expect(codes).toContain('missing_success_criteria');
  });

  it('warns when a skill tries to own multiple primary jobs without progressive disclosure', async () => {
    const configDir = createTempDir('xiaok-skill-quality-config');
    const projectDir = createTempDir('xiaok-skill-quality-project');
    const skillDir = join(projectDir, '.xiaok', 'skills', 'overloaded-skill');
    mkdirSync(skillDir, { recursive: true });

    const longBody = Array.from({ length: 120 }, (_, index) => `- detail ${index + 1}`).join('\n');
    const skillPath = join(skillDir, 'SKILL.md');
    writeFileSync(skillPath, `---
name: overloaded-skill
description: Handle launch plans, write reports, and review release risk
when-to-use: Use when a user asks for launch planning, report generation, or release review in one request.
task-goals:
  - plan a launch
  - write a report
examples:
  - launch this feature and write the follow-up summary
---
# Goal

Try to do many things in one skill.

## Workflow

${longBody}

## Success Criteria

- A response is produced.
`, 'utf8');

    const result = await validateSkillFile(skillPath, {
      xiaokConfigDir: configDir,
      cwd: projectDir,
      builtinRoots: [],
    });

    const warningCodes = result.issues
      .filter((issue) => issue.severity === 'warning')
      .map((issue) => issue.code);

    expect(result.ok).toBe(true);
    expect(warningCodes).toContain('multiple_primary_goals');
    expect(warningCodes).toContain('progressive_disclosure_missing');
  });

  it('blocks skills whose name collides with an existing catalog entry', async () => {
    const configDir = createTempDir('xiaok-skill-quality-config');
    const projectDir = createTempDir('xiaok-skill-quality-project');
    const builtinDir = createTempDir('xiaok-skill-quality-builtin');
    mkdirSync(builtinDir, { recursive: true });
    writeFileSync(join(builtinDir, 'review.md'), `---
name: review
description: builtin review skill
---
Builtin review.
`, 'utf8');

    const skillDir = join(projectDir, '.xiaok', 'skills', 'review');
    mkdirSync(skillDir, { recursive: true });
    const skillPath = join(skillDir, 'SKILL.md');
    writeFileSync(skillPath, `---
name: review
description: project review helper
when-to-use: Use when a user asks for project-local release review.
task-goals:
  - review one release candidate
examples:
  - review this release candidate
---
# Goal

Review one release candidate.

## Success Criteria

- A release review summary is produced.
`, 'utf8');

    const result = await validateSkillFile(skillPath, {
      xiaokConfigDir: configDir,
      cwd: projectDir,
      builtinRoots: [builtinDir],
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        code: 'name_conflict',
      }),
    ]));
  });

  it('fails strict skills when required references or scripts are missing', async () => {
    const configDir = createTempDir('xiaok-skill-quality-config');
    const projectDir = createTempDir('xiaok-skill-quality-project');
    const skillDir = join(projectDir, '.xiaok', 'skills', 'strict-missing');
    mkdirSync(skillDir, { recursive: true });

    const skillPath = join(skillDir, 'SKILL.md');
    writeFileSync(skillPath, `---
name: strict-missing
description: strict helper
when-to-use: Use when a user asks for a strict release readiness pass.
task-goals:
  - verify one release candidate
examples:
  - run the strict release checklist
required-references:
  - references/principles.md
required-scripts:
  - python scripts/check_release.py --mode smoke
success-checks:
  - must_mention_all: ready, blockers
strict: true
---
# Goal

Read references and run scripts before answering.

## Success Criteria

- A release decision is produced.
`, 'utf8');

    const result = await validateSkillFile(skillPath, {
      xiaokConfigDir: configDir,
      cwd: projectDir,
      builtinRoots: [],
    });

    const errorCodes = result.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => issue.code);

    expect(result.ok).toBe(false);
    expect(errorCodes).toContain('references_declared_but_missing');
    expect(errorCodes).toContain('scripts_declared_but_missing');
  });

  it('fails invalid strict success checks and undeclared body requirements', async () => {
    const configDir = createTempDir('xiaok-skill-quality-config');
    const projectDir = createTempDir('xiaok-skill-quality-project');
    const skillDir = join(projectDir, '.xiaok', 'skills', 'strict-invalid');
    mkdirSync(skillDir, { recursive: true });

    const skillPath = join(skillDir, 'SKILL.md');
    writeFileSync(skillPath, `---
name: strict-invalid
description: strict helper
when-to-use: Use when a user asks for a strict workflow.
task-goals:
  - complete one strict workflow
examples:
  - run the strict workflow
success-checks:
  - maybe_say: something
strict: true
---
# Goal

Read references/ and run scripts/ before answering.

## Success Criteria

- A response is produced.
`, 'utf8');

    const result = await validateSkillFile(skillPath, {
      xiaokConfigDir: configDir,
      cwd: projectDir,
      builtinRoots: [],
    });

    const errorCodes = result.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => issue.code);

    expect(result.ok).toBe(false);
    expect(errorCodes).toContain('invalid_success_check');
    expect(errorCodes).toContain('strict_skill_missing_success_checks');
    expect(errorCodes).toContain('body_mentions_references_without_contract');
    expect(errorCodes).toContain('body_mentions_scripts_without_contract');
  });
});
