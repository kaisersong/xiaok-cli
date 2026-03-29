// tests/ai/skills/loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadSkills } from '../../../src/ai/skills/loader.js';

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
    const skills = await loadSkills(globalDir, projectDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('hello');
    expect(skills[0].description).toBe('打招呼');
    expect(skills[0].content).toContain('说你好');
  });

  it('loads skills from project-local directory', async () => {
    writeFileSync(join(projectDir, '.xiaok', 'skills', 'local.md'), `---
name: local
description: 本地 skill
---
Local content.`);
    const skills = await loadSkills(globalDir, projectDir);
    expect(skills.find(s => s.name === 'local')).toBeTruthy();
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
    const skills = await loadSkills(globalDir, projectDir);
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
    const skills = await loadSkills(globalDir, projectDir);
    expect(skills.find(s => s.name === 'good')).toBeTruthy();
    expect(skills.find(s => s.name === 'bad')).toBeUndefined();
  });

  it('returns empty array when directories do not exist', async () => {
    const skills = await loadSkills('/nonexistent/path', '/also/nonexistent');
    expect(skills).toEqual([]);
  });
});
