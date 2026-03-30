import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, readFile, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadSettings, mergeRules, addAllowRule, addDenyRule } from '../../../src/ai/permissions/settings.js';

describe('permissions/settings', () => {
  let testDir: string;
  let globalDir: string;
  let projectDir: string;
  const originalEnv = process.env.XIAOK_CONFIG_DIR;

  beforeEach(async () => {
    testDir = join(tmpdir(), `xiaok-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    globalDir = join(testDir, 'global');
    projectDir = join(testDir, 'project');
    await mkdir(join(globalDir, '.xiaok'), { recursive: true });
    await mkdir(join(projectDir, '.xiaok'), { recursive: true });
    // 使 loadSettings 的全局路径指向测试目录
    process.env.XIAOK_CONFIG_DIR = globalDir;
  });

  afterEach(async () => {
    process.env.XIAOK_CONFIG_DIR = originalEnv;
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it('loadSettings returns empty when no files exist', async () => {
    const emptyDir = join(testDir, 'empty');
    await mkdir(emptyDir, { recursive: true });
    const settings = await loadSettings(emptyDir);
    expect(settings.global).toEqual({});
    expect(settings.project).toEqual({});
  });

  it('loadSettings reads global settings', async () => {
    const globalSettings = {
      permissions: {
        allow: ['bash(npm *)'],
        deny: ['bash(rm *)'],
      },
    };
    await writeFile(
      join(globalDir, 'settings.json'),
      JSON.stringify(globalSettings),
    );

    const settings = await loadSettings(projectDir);
    expect(settings.global.permissions?.allow).toEqual(['bash(npm *)']);
    expect(settings.global.permissions?.deny).toEqual(['bash(rm *)']);
  });

  it('loadSettings reads project settings', async () => {
    const projectSettings = {
      permissions: {
        allow: ['write(src/*)'],
      },
    };
    await writeFile(
      join(projectDir, '.xiaok', 'settings.json'),
      JSON.stringify(projectSettings),
    );

    const settings = await loadSettings(projectDir);
    expect(settings.project.permissions?.allow).toEqual(['write(src/*)']);
  });

  it('mergeRules combines both layers', async () => {
    const settings = {
      global: { permissions: { allow: ['bash(npm *)'], deny: ['bash(rm *)'] } },
      project: { permissions: { allow: ['write(src/*)'] } },
    };

    const { allowRules, denyRules } = mergeRules(settings);
    expect(allowRules).toEqual(['bash(npm *)', 'write(src/*)']);
    expect(denyRules).toEqual(['bash(rm *)']);
  });

  it('addAllowRule writes to global settings', async () => {
    await addAllowRule('global', 'bash(git *)', projectDir);

    const raw = await readFile(join(globalDir, 'settings.json'), 'utf-8');
    const settings = JSON.parse(raw);
    expect(settings.permissions.allow).toContain('bash(git *)');
  });

  it('addAllowRule writes to project settings', async () => {
    await addAllowRule('project', 'write(src/*)', projectDir);

    const raw = await readFile(join(projectDir, '.xiaok', 'settings.json'), 'utf-8');
    const settings = JSON.parse(raw);
    expect(settings.permissions.allow).toContain('write(src/*)');
  });

  it('addAllowRule deduplicates', async () => {
    await addAllowRule('global', 'bash(git *)', projectDir);
    await addAllowRule('global', 'bash(git *)', projectDir);

    const raw = await readFile(join(globalDir, 'settings.json'), 'utf-8');
    const settings = JSON.parse(raw);
    const matches = settings.permissions.allow.filter((r: string) => r === 'bash(git *)');
    expect(matches.length).toBe(1);
  });

  it('addDenyRule writes correctly', async () => {
    await addDenyRule('project', 'bash(rm *)', projectDir);

    const raw = await readFile(join(projectDir, '.xiaok', 'settings.json'), 'utf-8');
    const settings = JSON.parse(raw);
    expect(settings.permissions.deny).toContain('bash(rm *)');
  });
});
