import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadSkills } from '../../../src/ai/skills/loader.js';
import { installSkillFromLocalPath } from '../../../src/ai/skills/install.js';

describe('installSkillFromLocalPath', () => {
  let configDir: string;
  let sourceRoot: string;

  beforeEach(() => {
    configDir = join(tmpdir(), `xiaok-skill-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    sourceRoot = join(tmpdir(), `xiaok-skill-source-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(configDir, { recursive: true });
    mkdirSync(sourceRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    rmSync(sourceRoot, { recursive: true, force: true });
  });

  it('installs a directory-based skill into the canonical target', async () => {
    const sourceDir = join(sourceRoot, 'skill-installer');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, 'SKILL.md'), `---
name: skill-installer
description: 安装技能
---
Install skill.`);

    mkdirSync(join(sourceDir, 'scripts'));
    writeFileSync(join(sourceDir, 'scripts', 'run.sh'), 'echo ok');
    const result = await installSkillFromLocalPath(sourceDir, configDir);
    expect(readFileSync(join(result.destinationDir, 'scripts', 'run.sh'), 'utf8')).toBe('echo ok');
    expect((await loadSkills(configDir, join(sourceRoot, 'empty'), { builtinRoots: [] })).some(skill => skill.name === 'skill-installer')).toBe(true);

    expect(result.name).toBe('skill-installer');
    expect(result.destinationDir).toBe(join(configDir, 'skills', 'skill-installer'));
    expect(result.destinationSkillPath).toBe(join(configDir, 'skills', 'skill-installer', 'SKILL.md'));
    expect(existsSync(result.destinationSkillPath)).toBe(true);
    expect(readFileSync(result.destinationSkillPath, 'utf-8')).toContain('Install skill');
  });

  it('installs a single markdown file as SKILL.md', async () => {
    const filePath = join(sourceRoot, 'single.md');
    writeFileSync(filePath, `---
name: single-skill
description: 单文件技能
---
Single file content.`);

    const result = await installSkillFromLocalPath(filePath, configDir);

    expect(result.destinationSkillPath).toBe(join(configDir, 'skills', 'single-skill', 'SKILL.md'));
    expect(readFileSync(result.destinationSkillPath, 'utf-8')).toContain('Single file content');
  });

  it('rejects a directory without SKILL.md', async () => {
    const brokenDir = join(sourceRoot, 'broken');
    mkdirSync(brokenDir, { recursive: true });

    await expect(installSkillFromLocalPath(brokenDir, configDir)).rejects.toThrow('SKILL.md');
  });

  it('rejects a skill when destination already exists', async () => {
    const filePath = join(sourceRoot, 'dup.md');
    writeFileSync(filePath, `---
name: duplicate
description: 重复
---
content`);
    mkdirSync(join(configDir, 'skills', 'duplicate'), { recursive: true });

    await expect(installSkillFromLocalPath(filePath, configDir)).rejects.toThrow('Destination already exists');
  });
  it.each(['../outside', '..', '/tmp/outside', 'C:\\outside', 'bad/name'])('rejects unsafe name %s before writing', async name => {
    const source = join(sourceRoot, 'unsafe.md');
    writeFileSync(source, `---\nname: ${name}\ndescription: unsafe\n---\nbody`);
    await expect(installSkillFromLocalPath(source, configDir)).rejects.toThrow('Invalid skill name');
    expect(existsSync(join(configDir, 'skills'))).toBe(false);
  });

});
