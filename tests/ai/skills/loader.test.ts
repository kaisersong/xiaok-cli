// tests/ai/skills/loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createSkillCatalog, loadSkills } from '../../../src/ai/skills/loader.js';

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
---
# Hello Skill
说你好。`);
    const skills = await loadSkills(globalDir, projectDir, { builtinRoots: [] });
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('hello');
    expect(skills[0].description).toBe('打招呼');
    expect(skills[0].source).toBe('global');
    expect(skills[0].tier).toBe('user');
    expect(skills[0].path).toContain('hello.md');
    expect(skills[0].content).toContain('说你好');
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
});
