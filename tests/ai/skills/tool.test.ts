// tests/ai/skills/tool.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createSkillTool } from '../../../src/ai/skills/tool.js';
import { loadSkills } from '../../../src/ai/skills/loader.js';

describe('skillTool', () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `xiaok-skills-${Date.now()}`);
    mkdirSync(join(dir, 'skills'), { recursive: true });
    writeFileSync(join(dir, 'skills', 'greet.md'), `---
name: greet
description: 打招呼技能
---
请用中文打招呼，保持友好。`);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns skill content for known skill', async () => {
    const skills = await loadSkills(dir, dir);
    const tool = createSkillTool(skills);
    const result = await tool.execute({ name: 'greet' });
    expect(result).toContain('打招呼');
    expect(result).toContain('中文');
  });

  it('returns error message for unknown skill', async () => {
    const skills = await loadSkills(dir, dir);
    const tool = createSkillTool(skills);
    const result = await tool.execute({ name: 'nonexistent' });
    expect(result).toContain('Error');
    expect(result).toContain('nonexistent');
  });

  it('tool definition has correct name and inputSchema', async () => {
    const skills = await loadSkills(dir, dir);
    const tool = createSkillTool(skills);
    expect(tool.definition.name).toBe('skill');
    expect(tool.definition.inputSchema).toHaveProperty('properties.name');
  });
});
