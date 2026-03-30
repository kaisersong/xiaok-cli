import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { registerSkillCommands } from '../../src/commands/skill.js';

describe('registerSkillCommands', () => {
  let configDir: string;
  let sourceDir: string;

  beforeEach(() => {
    configDir = join(tmpdir(), `xiaok-skill-cmd-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    sourceDir = join(tmpdir(), `xiaok-skill-cmd-source-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(configDir, { recursive: true });
    mkdirSync(sourceDir, { recursive: true });
    process.env.XIAOK_CONFIG_DIR = configDir;
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
    delete process.env.XIAOK_CONFIG_DIR;
    vi.restoreAllMocks();
  });

  it('installs a skill from the CLI command', async () => {
    const skillDir = join(sourceDir, 'demo');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), `---
name: demo
description: 演示技能
---
Demo content.`);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command();
    registerSkillCommands(program);

    await program.parseAsync(['node', 'xiaok', 'skill', 'install', skillDir], { from: 'node' });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('已安装 skill: demo'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(join(configDir, 'skills', 'demo', 'SKILL.md')));
  });
});
