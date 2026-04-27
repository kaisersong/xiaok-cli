import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUninstallSkillTool } from '../../../src/ai/tools/uninstall-skill.js';

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('uninstallSkillTool', () => {
  it('removes a project skill by name', async () => {
    const cwd = createTempDir('xiaok-uninstall-skill-project-');
    const configDir = createTempDir('xiaok-uninstall-skill-config-');
    tempDirs.push(cwd, configDir);

    const skillDir = join(cwd, '.xiaok', 'skills');
    mkdirSync(skillDir, { recursive: true });
    const skillPath = join(skillDir, 'demo-skill.md');
    writeFileSync(skillPath, `---
name: demo-skill
description: Demo installer skill
---
Do the thing.
`, 'utf8');

    const onUninstall = vi.fn();
    const tool = createUninstallSkillTool({ cwd, configDir, onUninstall });
    const result = await tool.execute({ name: 'demo-skill', scope: 'project' });

    expect(existsSync(skillPath)).toBe(false);
    expect(result).toContain('已卸载 skill "demo-skill"');
    expect(result).toContain(skillPath);
    expect(onUninstall).toHaveBeenCalledWith({
      name: 'demo-skill',
      path: skillPath,
      scope: 'project',
    });
  });

  it('falls back to global scope when scope is omitted', async () => {
    const cwd = createTempDir('xiaok-uninstall-skill-project-');
    const configDir = createTempDir('xiaok-uninstall-skill-config-');
    tempDirs.push(cwd, configDir);

    const skillDir = join(configDir, 'skills');
    mkdirSync(skillDir, { recursive: true });
    const skillPath = join(skillDir, 'report.md');
    writeFileSync(skillPath, `---
name: report
description: Generate reports
---
Generate reports.
`, 'utf8');

    const tool = createUninstallSkillTool({ cwd, configDir });
    const result = await tool.execute({ name: 'report' });

    expect(existsSync(skillPath)).toBe(false);
    expect(result).toContain('范围: global');
  });

  it('returns a clear error for missing skills', async () => {
    const cwd = createTempDir('xiaok-uninstall-skill-project-');
    const configDir = createTempDir('xiaok-uninstall-skill-config-');
    tempDirs.push(cwd, configDir);

    const tool = createUninstallSkillTool({ cwd, configDir });
    const result = await tool.execute({ name: 'missing-skill' });

    expect(result).toContain('未找到 skill "missing-skill"');
  });

  it('removes a directory-style project skill by name', async () => {
    const cwd = createTempDir('xiaok-uninstall-skill-project-');
    const configDir = createTempDir('xiaok-uninstall-skill-config-');
    tempDirs.push(cwd, configDir);

    const skillDir = join(cwd, '.xiaok', 'skills', 'release-checklist');
    mkdirSync(skillDir, { recursive: true });
    const skillPath = join(skillDir, 'SKILL.md');
    writeFileSync(skillPath, `---
name: release-checklist
description: Release checklist skill
---
Verify release readiness.
`, 'utf8');

    const tool = createUninstallSkillTool({ cwd, configDir });
    const result = await tool.execute({ name: 'release-checklist', scope: 'project' });

    expect(existsSync(skillDir)).toBe(false);
    expect(result).toContain('已卸载 skill "release-checklist"');
    expect(result).toContain(skillPath);
  });
});
