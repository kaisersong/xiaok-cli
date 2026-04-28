// tests/ai/skills/loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createSkillCatalog, loadSkills } from '../../../src/ai/skills/loader.js';
import type { TaskSkillHints } from '../../../src/ai/intent-delegation/types.js';

describe('loadSkills', () => {
  let globalDir: string;
  let projectDir: string;

  beforeEach(() => {
    globalDir = join(tmpdir(), `xiaok-global-${Date.now()}`);
    projectDir = join(tmpdir(), `xiaok-project-${Date.now()}`);
    mkdirSync(join(globalDir, 'skills'), { recursive: true });
    mkdirSync(join(projectDir, '.xiaok', 'skills'), { recursive: true });
  });

  afterEach(() => {
    rmSync(globalDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('loads skills from global directory', async () => {
    writeFileSync(join(globalDir, 'skills', 'hello.md'), `---
name: hello
description: 打招呼
task-goals:
  - greet the user
input-kinds: [greeting, short prompt]
output-kinds: [warm reply]
examples: [say hello]
allowed-tools:
  - read
  - grep
context: fork
agent: researcher
depends-on:
  - common
---
# Hello Skill
说你好。`);
    writeFileSync(join(globalDir, 'skills', 'common.md'), `---
name: common
description: 通用技能
---
通用技能。`);
    const skills = await loadSkills(globalDir, projectDir, { builtinRoots: [] });
    const hello = skills.find((skill) => skill.name === 'hello');
    expect(skills).toHaveLength(2);
    expect(hello?.name).toBe('hello');
    expect(hello?.description).toBe('打招呼');
    expect(hello?.source).toBe('global');
    expect(hello?.tier).toBe('user');
    expect(hello?.path).toContain('hello.md');
    expect(hello?.content).toContain('说你好');
    expect(hello?.allowedTools).toEqual(['read', 'grep']);
    expect(hello?.executionContext).toBe('fork');
    expect(hello?.agent).toBe('researcher');
    expect(hello?.dependsOn).toEqual(['common']);
    const expectedTaskHints: TaskSkillHints = {
      taskGoals: ['greet the user'],
      inputKinds: ['greeting', 'short prompt'],
      outputKinds: ['warm reply'],
      examples: ['say hello'],
    };

    expect(hello?.taskHints).toEqual(expectedTaskHints);
  });

  it('loads directory-style skills from SKILL.md', async () => {
    mkdirSync(join(globalDir, 'skills', 'slide-creator'), { recursive: true });
    writeFileSync(join(globalDir, 'skills', 'slide-creator', 'SKILL.md'), `---
name: kai-slide-creator
description: 生成 HTML 演示文稿
---
Create slides.`);

    const skills = await loadSkills(globalDir, projectDir, { builtinRoots: [] });
    const slideCreator = skills.find((skill) => skill.name === 'kai-slide-creator');

    expect(slideCreator).toMatchObject({
      name: 'kai-slide-creator',
      aliases: ['slide-creator'],
      description: '生成 HTML 演示文稿',
      source: 'global',
      tier: 'user',
      path: join(globalDir, 'skills', 'slide-creator', 'SKILL.md'),
    });
  });

  it('loads strict contract fields and resource manifests for directory skills', async () => {
    const skillDir = join(globalDir, 'skills', 'release-checklist');
    mkdirSync(join(skillDir, 'references'), { recursive: true });
    mkdirSync(join(skillDir, 'scripts'), { recursive: true });
    mkdirSync(join(skillDir, 'assets'), { recursive: true });
    writeFileSync(join(skillDir, 'references', 'principles.md'), '# principles');
    writeFileSync(join(skillDir, 'scripts', 'check_release.py'), 'print("ok")');
    writeFileSync(join(skillDir, 'assets', 'template.txt'), 'template');
    writeFileSync(join(skillDir, 'SKILL.md'), `---
name: release-checklist
description: Validate release readiness
required-references:
  - references/principles.md
required-scripts:
  - python scripts/check_release.py --mode smoke
required-steps:
  - read_skill
  - read_required_references
  - run_required_scripts
success-checks:
  - must_mention_all: ready, blockers
  - must_answer_yes_no: ready
strict: true
---
Release content.`);

    const skills = await loadSkills(globalDir, projectDir, { builtinRoots: [] });
    const releaseChecklist = skills.find((skill) => skill.name === 'release-checklist');

    expect(releaseChecklist?.strict).toBe(true);
    expect(releaseChecklist?.requiredReferences).toEqual(['references/principles.md']);
    expect(releaseChecklist?.requiredScripts).toEqual(['python scripts/check_release.py --mode smoke']);
    expect(releaseChecklist?.requiredSteps).toEqual([
      'read_skill',
      'read_required_references',
      'run_required_scripts',
    ]);
    expect(releaseChecklist?.successChecks).toEqual([
      { type: 'must_mention_all', terms: ['ready', 'blockers'] },
      { type: 'must_answer_yes_no', terms: ['ready'] },
    ]);
    expect(releaseChecklist?.referencesManifest.map((entry) => entry.relativePath)).toEqual(['references/principles.md']);
    expect(releaseChecklist?.scriptsManifest.map((entry) => entry.relativePath)).toEqual(['scripts/check_release.py']);
    expect(releaseChecklist?.assetsManifest.map((entry) => entry.relativePath)).toEqual(['assets/template.txt']);
  });

  it('loads symlinked directory-style skills from SKILL.md', async () => {
    const externalSkillDir = join(globalDir, 'external-slide-creator');
    mkdirSync(externalSkillDir, { recursive: true });
    writeFileSync(join(externalSkillDir, 'SKILL.md'), `---
name: kai-slide-creator
description: symlinked slide skill
---
Create slides from symlink.`);
    symlinkSync(externalSkillDir, join(globalDir, 'skills', 'slide-creator'));

    const skills = await loadSkills(globalDir, projectDir, { builtinRoots: [] });
    const slideCreator = skills.find((skill) => skill.name === 'kai-slide-creator');

    expect(slideCreator).toMatchObject({
      name: 'kai-slide-creator',
      aliases: ['slide-creator'],
      description: 'symlinked slide skill',
      source: 'global',
      tier: 'user',
    });
    expect(slideCreator?.path).toBe(join(globalDir, 'skills', 'slide-creator', 'SKILL.md'));
  });

  it('parses inline lists with quoted commas as single entries', async () => {
    writeFileSync(join(globalDir, 'skills', 'summary.md'), `---
name: summary
description: 总结技能
examples: ["write proposal, then summarize"]
---
Summary content.`);

    const skills = await loadSkills(globalDir, projectDir, { builtinRoots: [] });
    const summary = skills.find((skill) => skill.name === 'summary');

    expect(summary?.taskHints.examples).toEqual(['write proposal, then summarize']);
  });

  it('preserves apostrophes in single-quoted inline list entries', async () => {
    writeFileSync(join(globalDir, 'skills', 'brief.md'), `---
name: brief
description: brief helper
examples: ['writer''s brief']
---
Brief content.`);

    const skills = await loadSkills(globalDir, projectDir, { builtinRoots: [] });
    const brief = skills.find((skill) => skill.name === 'brief');

    expect(brief?.taskHints.examples).toEqual(["writer's brief"]);
  });

  it('preserves apostrophes in single-quoted block list entries', async () => {
    writeFileSync(join(globalDir, 'skills', 'brief-block.md'), `---
name: brief-block
description: brief helper
examples:
  - 'writer''s brief'
---
Brief content.`);

    const skills = await loadSkills(globalDir, projectDir, { builtinRoots: [] });
    const brief = skills.find((skill) => skill.name === 'brief-block');

    expect(brief?.taskHints.examples).toEqual(["writer's brief"]);
  });

  it('decodes double-quoted block list escapes', async () => {
    writeFileSync(join(globalDir, 'skills', 'quote.md'), `---
name: quote
description: quote helper
examples:
  - "say \\"hello\\""
---
Quote content.`);

    const skills = await loadSkills(globalDir, projectDir, { builtinRoots: [] });
    const quote = skills.find((skill) => skill.name === 'quote');

    expect(quote?.taskHints.examples).toEqual(['say "hello"']);
  });

  it('loads skills from project-local directory', async () => {
    writeFileSync(join(projectDir, '.xiaok', 'skills', 'local.md'), `---
name: local
description: 本地 skill
---
Local content.`);
    const skills = await loadSkills(globalDir, projectDir, { builtinRoots: [] });
    expect(skills.find(s => s.name === 'local')).toMatchObject({
      source: 'project',
      tier: 'project',
    });
  });

  it('project-local skill overrides global skill with same name', async () => {
    writeFileSync(join(globalDir, 'skills', 'shared.md'), `---
name: shared
description: global version
---
Global content.`);
    writeFileSync(join(projectDir, '.xiaok', 'skills', 'shared.md'), `---
name: shared
description: project version
---
Project content.`);
    const skills = await loadSkills(globalDir, projectDir, { builtinRoots: [] });
    const shared = skills.find(s => s.name === 'shared');
    expect(shared?.description).toBe('project version');
    expect(shared?.content).toContain('Project content');
    // 不重复
    expect(skills.filter(s => s.name === 'shared')).toHaveLength(1);
  });

  it('skips files with malformed frontmatter and continues', async () => {
    writeFileSync(join(globalDir, 'skills', 'bad.md'), 'no frontmatter at all');
    writeFileSync(join(globalDir, 'skills', 'good.md'), `---
name: good
description: 正常的
---
Content.`);
    const skills = await loadSkills(globalDir, projectDir, { builtinRoots: [] });
    expect(skills.find(s => s.name === 'good')).toBeTruthy();
    expect(skills.find(s => s.name === 'bad')).toBeUndefined();
  });

  it('returns empty array when directories do not exist', async () => {
    const skills = await loadSkills('/nonexistent/path', '/also/nonexistent', { builtinRoots: [] });
    expect(skills).toEqual([]);
  });

  it('loads builtin skills before user and project overrides', async () => {
    const builtinDir = join(globalDir, 'builtin');
    mkdirSync(builtinDir, { recursive: true });

    writeFileSync(join(builtinDir, 'review.md'), `---
name: review
description: builtin review
---
Builtin review.`);

    const skills = await loadSkills(globalDir, projectDir, {
      builtinRoots: [builtinDir],
    });

    expect(skills.find((skill) => skill.name === 'review')).toMatchObject({
      source: 'builtin',
      tier: 'system',
      path: join(builtinDir, 'review.md'),
    });
  });

  it('project skill overrides builtin skill with same name', async () => {
    const builtinDir = join(globalDir, 'builtin');
    mkdirSync(builtinDir, { recursive: true });

    writeFileSync(join(builtinDir, 'review.md'), `---
name: review
description: builtin review
---
Builtin.`);

    writeFileSync(join(projectDir, '.xiaok', 'skills', 'review.md'), `---
name: review
description: project review
---
Project.`);

    const skills = await loadSkills(globalDir, projectDir, {
      builtinRoots: [builtinDir],
    });

    expect(skills.find((skill) => skill.name === 'review')).toMatchObject({
      source: 'project',
      tier: 'project',
      description: 'project review',
    });
  });

  it('loads builtin skills from the repository data directory', async () => {
    const skills = await loadSkills(globalDir, projectDir);

    expect(skills.some((skill) => skill.source === 'builtin')).toBe(true);
    expect(skills.some((skill) => skill.name === 'plan')).toBe(true);
    expect(skills.some((skill) => skill.name === 'skill-creator')).toBe(true);
  });

  it('reloads newly installed skills through a persistent catalog', async () => {
    const catalog = createSkillCatalog(globalDir, projectDir, { builtinRoots: [] });

    await catalog.reload();
    expect(catalog.list()).toEqual([]);

    writeFileSync(join(projectDir, '.xiaok', 'skills', 'deploy.md'), `---
name: deploy
description: 发布技能
---
执行发布检查。`);

    await catalog.reload();

    expect(catalog.get('deploy')).toMatchObject({
      name: 'deploy',
      description: '发布技能',
      source: 'project',
      tier: 'project',
    });
  });

  it('resolves skill dependencies in deterministic order', async () => {
    writeFileSync(join(projectDir, '.xiaok', 'skills', 'base.md'), `---
name: base
description: base
---
Base.`);
    writeFileSync(join(projectDir, '.xiaok', 'skills', 'report.md'), `---
name: report
description: report
depends-on:
  - base
---
Report.`);

    const catalog = createSkillCatalog(globalDir, projectDir, { builtinRoots: [] });
    await catalog.reload();

    expect(catalog.resolve(['report']).map((skill) => skill.name)).toEqual(['base', 'report']);
  });

  it('resolves aliases through the catalog for slash-command style lookups', async () => {
    mkdirSync(join(projectDir, '.xiaok', 'skills', 'slide-creator'), { recursive: true });
    writeFileSync(join(projectDir, '.xiaok', 'skills', 'slide-creator', 'SKILL.md'), `---
name: kai-slide-creator
description: slide creator
---
Create slides.`);

    const catalog = createSkillCatalog(globalDir, projectDir, { builtinRoots: [] });
    await catalog.reload();

    expect(catalog.get('slide-creator')).toMatchObject({
      name: 'kai-slide-creator',
      aliases: ['slide-creator'],
    });
    expect(catalog.resolve(['slide-creator']).map((skill) => skill.name)).toEqual(['kai-slide-creator']);
  });
});
