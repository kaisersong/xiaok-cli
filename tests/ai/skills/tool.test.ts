// tests/ai/skills/tool.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createSkillTool } from '../../../src/ai/skills/tool.js';
import { createSkillCatalog, loadSkills } from '../../../src/ai/skills/loader.js';

describe('skillTool', () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `xiaok-skills-${Date.now()}`);
    mkdirSync(join(dir, 'skills', 'greet', 'references'), { recursive: true });
    mkdirSync(join(dir, 'skills', 'greet', 'scripts'), { recursive: true });
    writeFileSync(join(dir, 'skills', 'greet', 'references', 'principles.md'), '# principles');
    writeFileSync(join(dir, 'skills', 'greet', 'scripts', 'check_release.py'), 'print("ok")');
    writeFileSync(join(dir, 'skills', 'greet', 'SKILL.md'), `---
name: greet
description: 打招呼技能
task-goals:
  - greet the user warmly
input-kinds:
  - greeting
output-kinds:
  - friendly reply
examples:
  - hello there
required-references:
  - references/principles.md
required-scripts:
  - python scripts/check_release.py --mode smoke
required-steps:
  - read_skill
  - read_required_references
success-checks:
  - must_mention_all: 中文, 友好
strict: true
---
请用中文打招呼，保持友好。`);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns skill content for known skill', async () => {
    const skills = await loadSkills(dir, dir, { builtinRoots: [] });
    const tool = createSkillTool(skills);
    const result = await tool.execute({ name: 'greet' });
    const payload = JSON.parse(result) as {
      type: string;
      requested: string[];
      strategy: string;
      primarySkill: string;
      resolved: Array<{
        name: string;
        description: string;
        executionContext: string;
        strict: boolean;
        requiredReferences: string[];
        requiredScripts: string[];
        requiredSteps: string[];
        manifestsAvailable: { references: number; scripts: number; assets: number };
        contentBytes: number;
        successChecks: Array<{ type: string; terms: string[] }>;
        taskHints: {
          taskGoals: string[];
          inputKinds: string[];
          outputKinds: string[];
          examples: string[];
        };
        content: string;
      }>;
    };

    expect(payload.type).toBe('skill_plan');
    expect(payload.requested).toEqual(['greet']);
    expect(payload.primarySkill).toBe('greet');
    expect(payload.strategy).toBe('inline');
    expect(payload.resolved[0]?.name).toBe('greet');
    expect(payload.resolved[0]?.description).toContain('打招呼');
    expect(payload.resolved[0]?.strict).toBe(true);
    expect(payload.resolved[0]?.requiredReferences).toEqual(['references/principles.md']);
    expect(payload.resolved[0]?.requiredScripts).toEqual(['python scripts/check_release.py --mode smoke']);
    expect(payload.resolved[0]?.requiredSteps).toEqual(['read_skill', 'read_required_references']);
    // P4: manifests are no longer inlined; only counts are exposed via manifestsAvailable.
    expect(payload.resolved[0]).not.toHaveProperty('referencesManifest');
    expect(payload.resolved[0]).not.toHaveProperty('scriptsManifest');
    expect(payload.resolved[0]).not.toHaveProperty('assetsManifest');
    expect(payload.resolved[0]?.manifestsAvailable).toEqual({
      references: 1,
      scripts: 1,
      assets: 0,
    });
    expect(payload.resolved[0]?.contentBytes).toBeGreaterThan(0);
    expect(payload.resolved[0]?.successChecks).toEqual([
      { type: 'must_mention_all', terms: ['中文', '友好'] },
    ]);
    expect(payload.resolved[0]?.taskHints).toEqual({
      taskGoals: ['greet the user warmly'],
      inputKinds: ['greeting'],
      outputKinds: ['friendly reply'],
      examples: ['hello there'],
    });
    expect(payload.resolved[0]?.content).toContain('中文');
  });

  it('returns error message for unknown skill', async () => {
    const skills = await loadSkills(dir, dir, { builtinRoots: [] });
    const tool = createSkillTool(skills);
    const result = await tool.execute({ name: 'nonexistent' });
    expect(result).toContain('Error');
    expect(result).toContain('nonexistent');
  });

  it('tool definition has correct name and inputSchema', async () => {
    const skills = await loadSkills(dir, dir, { builtinRoots: [] });
    const tool = createSkillTool(skills);
    expect(tool.definition.name).toBe('skill');
    expect(tool.definition.inputSchema).toHaveProperty('properties.name');
  });

  it('reads a newly installed skill after the catalog reloads', async () => {
    const catalog = createSkillCatalog(dir, dir, { builtinRoots: [] });
    await catalog.reload();
    const tool = createSkillTool(catalog);

    let result = await tool.execute({ name: 'deploy' });
    expect(result).toContain('Error');

    writeFileSync(join(dir, 'skills', 'deploy.md'), `---
name: deploy
description: 发布技能
---
请先检查 CI，再执行发布。`);

    await catalog.reload();
    result = await tool.execute({ name: 'deploy' });

    const payload = JSON.parse(result) as { primarySkill: string; resolved: Array<{ content: string }> };
    expect(payload.primarySkill).toBe('deploy');
    expect(payload.resolved[0]?.content).toContain('检查 CI');
  });
});

describe('formatSkillPayload (legacy compat)', () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `xiaok-skills-legacy-${Date.now()}`);
    mkdirSync(join(dir, 'skills', 'greet', 'references'), { recursive: true });
    writeFileSync(join(dir, 'skills', 'greet', 'references', 'principles.md'), '# legacy');
    writeFileSync(join(dir, 'skills', 'greet', 'SKILL.md'), `---
name: greet
description: 旧调用方仍内联 manifests
---
hello`);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('still emits referencesManifest for legacy callers (e.g. yzj)', async () => {
    const { formatSkillPayload } = await import('../../../src/ai/skills/tool.js');
    const skills = await loadSkills(dir, dir, { builtinRoots: [] });
    const payload = JSON.parse(formatSkillPayload(skills[0]!)) as {
      referencesManifest: Array<{ relativePath: string }>;
      content: string;
    };
    expect(payload.referencesManifest).toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: 'references/principles.md' }),
    ]));
    expect(payload.content).toContain('hello');
  });
});

describe('createSkillFetchAssetsTool', () => {
  let dir: string;
  let outsideDir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `xiaok-skills-fetch-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    outsideDir = join(tmpdir(), `xiaok-outside-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    mkdirSync(join(dir, 'skills', 'demo', 'references'), { recursive: true });
    mkdirSync(join(dir, 'skills', 'demo', 'scripts'), { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(dir, 'skills', 'demo', 'references', 'a.md'), 'AAA');
    writeFileSync(join(dir, 'skills', 'demo', 'references', 'b.md'), 'BBB');
    writeFileSync(join(dir, 'skills', 'demo', 'scripts', 'run.sh'), '#!/bin/sh\necho hi');
    writeFileSync(join(outsideDir, 'secret.txt'), 'TOPSECRET');
    writeFileSync(join(dir, 'skills', 'demo', 'SKILL.md'), `---
name: demo
description: fetch assets demo
---
body`);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  });

  it('returns manifest summary when paths is omitted', async () => {
    const { createSkillFetchAssetsTool } = await import('../../../src/ai/skills/tool.js');
    const skills = await loadSkills(dir, dir, { builtinRoots: [] });
    const tool = createSkillFetchAssetsTool(skills);
    const result = await tool.execute({ skillName: 'demo', kind: 'references' });
    const payload = JSON.parse(result) as {
      type: string;
      kind: string;
      totalCount: number;
      entries: Array<{ relativePath: string; size: number }>;
    };
    expect(payload.type).toBe('skill_assets_summary');
    expect(payload.kind).toBe('references');
    expect(payload.totalCount).toBe(2);
    expect(payload.entries.map((e) => e.relativePath).sort()).toEqual([
      'references/a.md',
      'references/b.md',
    ]);
  });

  it('reads file content for legitimate manifest paths', async () => {
    const { createSkillFetchAssetsTool } = await import('../../../src/ai/skills/tool.js');
    const skills = await loadSkills(dir, dir, { builtinRoots: [] });
    const tool = createSkillFetchAssetsTool(skills);
    const result = await tool.execute({
      skillName: 'demo',
      kind: 'references',
      paths: ['references/a.md'],
    });
    const payload = JSON.parse(result) as {
      type: string;
      truncated: boolean;
      bytesReturned: number;
      files: Array<{ relativePath: string; content?: string; error?: string }>;
    };
    expect(payload.type).toBe('skill_assets');
    expect(payload.truncated).toBe(false);
    expect(payload.bytesReturned).toBe(3);
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0]?.content).toBe('AAA');
    expect(payload.files[0]?.error).toBeUndefined();
  });

  it('rejects paths not present in the manifest', async () => {
    const { createSkillFetchAssetsTool } = await import('../../../src/ai/skills/tool.js');
    const skills = await loadSkills(dir, dir, { builtinRoots: [] });
    const tool = createSkillFetchAssetsTool(skills);
    const result = await tool.execute({
      skillName: 'demo',
      kind: 'references',
      paths: ['references/does-not-exist.md', '../../etc/passwd', 'references/a.md'],
    });
    const payload = JSON.parse(result) as {
      files: Array<{ relativePath: string; error?: string; content?: string }>;
    };
    const byPath = new Map(payload.files.map((f) => [f.relativePath, f]));
    expect(byPath.get('references/does-not-exist.md')?.error).toBe('not_in_manifest');
    expect(byPath.get('../../etc/passwd')?.error).toBe('not_in_manifest');
    expect(byPath.get('references/a.md')?.content).toBe('AAA');
  });

  it('rejects symlink escapes outside skill root', async () => {
    const { createSkillFetchAssetsTool } = await import('../../../src/ai/skills/tool.js');
    const fs = await import('fs');
    if (process.platform === 'win32') {
      // Windows symlink creation requires elevated privileges; skip there.
      return;
    }
    const skills = await loadSkills(dir, dir, { builtinRoots: [] });
    // After loadSkills picks a.md up into the manifest, replace it with a symlink
    // pointing outside skillRoot. The manifest entry remains valid, but realpath
    // resolves outside skill root and must be rejected.
    const aPath = join(dir, 'skills', 'demo', 'references', 'a.md');
    fs.rmSync(aPath);
    fs.symlinkSync(join(outsideDir, 'secret.txt'), aPath);
    const tool = createSkillFetchAssetsTool(skills);
    const result = await tool.execute({
      skillName: 'demo',
      kind: 'references',
      paths: ['references/a.md'],
    });
    const payload = JSON.parse(result) as {
      files: Array<{ relativePath: string; error?: string; content?: string }>;
    };
    expect(payload.files[0]?.error).toBe('path_escapes_skill_root');
    expect(payload.files[0]?.content).toBeUndefined();
  });

  it('truncates when cumulative bytes exceed 64KB cap', async () => {
    const { createSkillFetchAssetsTool } = await import('../../../src/ai/skills/tool.js');
    // overwrite a.md and b.md with 40KB each so two reads would exceed 64KB
    const big = 'x'.repeat(40 * 1024);
    writeFileSync(join(dir, 'skills', 'demo', 'references', 'a.md'), big);
    writeFileSync(join(dir, 'skills', 'demo', 'references', 'b.md'), big);
    const skills = await loadSkills(dir, dir, { builtinRoots: [] });
    const tool = createSkillFetchAssetsTool(skills);
    const result = await tool.execute({
      skillName: 'demo',
      kind: 'references',
      paths: ['references/a.md', 'references/b.md'],
    });
    const payload = JSON.parse(result) as {
      truncated: boolean;
      bytesReturned: number;
      files: Array<{ relativePath: string; content?: string; truncated?: boolean }>;
    };
    expect(payload.truncated).toBe(true);
    expect(payload.bytesReturned).toBeLessThanOrEqual(64 * 1024);
    expect(payload.files[0]?.content).toBe(big);
    expect(payload.files[1]?.truncated).toBe(true);
    expect(payload.files[1]?.content).toBeUndefined();
  });

  it('rejects unknown skillName', async () => {
    const { createSkillFetchAssetsTool } = await import('../../../src/ai/skills/tool.js');
    const skills = await loadSkills(dir, dir, { builtinRoots: [] });
    const tool = createSkillFetchAssetsTool(skills);
    const result = await tool.execute({ skillName: 'nope', kind: 'references' });
    expect(result).toContain('找不到 skill');
  });

  it('rejects invalid kind', async () => {
    const { createSkillFetchAssetsTool } = await import('../../../src/ai/skills/tool.js');
    const skills = await loadSkills(dir, dir, { builtinRoots: [] });
    const tool = createSkillFetchAssetsTool(skills);
    const result = await tool.execute({ skillName: 'demo', kind: 'bogus' as never });
    expect(result).toContain('kind 只支持');
  });
});
