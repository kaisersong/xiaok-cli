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
    mkdirSync(join(dir, 'skills'), { recursive: true });
    writeFileSync(join(dir, 'skills', 'greet.md'), `---
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
