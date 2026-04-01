import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInstallSkillTool } from '../../../src/ai/tools/install-skill.js';

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('installSkillTool', () => {
  it('installs a remote markdown skill into project scope', async () => {
    const cwd = createTempDir('xiaok-install-skill-project-');
    const configDir = createTempDir('xiaok-install-skill-config-');
    tempDirs.push(cwd, configDir);

    const tool = createInstallSkillTool({
      cwd,
      configDir,
      fetchFn: async () => new Response(`---
name: demo-skill
description: Demo installer skill
---
Do the thing.
`, {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      }),
    });

    const result = await tool.execute({
      source: 'https://example.com/skills/demo-skill.md',
      scope: 'project',
    });

    const installedPath = join(cwd, '.xiaok', 'skills', 'demo-skill.md');
    expect(existsSync(installedPath)).toBe(true);
    expect(readFileSync(installedPath, 'utf8')).toContain('name: demo-skill');
    expect(result).toContain('已安装 skill "demo-skill"');
    expect(result).toContain(installedPath);
  });

  it('converts GitHub blob URLs to raw URLs before downloading', async () => {
    const cwd = createTempDir('xiaok-install-skill-project-');
    const configDir = createTempDir('xiaok-install-skill-config-');
    tempDirs.push(cwd, configDir);

    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('https://raw.githubusercontent.com/acme/demo/main/skills/review.md');
      return new Response(`---
name: review
description: Review code carefully
---
Review stuff.
`, {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    });

    const tool = createInstallSkillTool({ cwd, configDir, fetchFn });
    await tool.execute({
      source: 'https://github.com/acme/demo/blob/main/skills/review.md',
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('supports GitHub owner/repo/path shorthand with refs', async () => {
    const cwd = createTempDir('xiaok-install-skill-project-');
    const configDir = createTempDir('xiaok-install-skill-config-');
    tempDirs.push(cwd, configDir);

    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('https://raw.githubusercontent.com/acme/demo/release/skills/report.md');
      return new Response(`---
name: report
description: Generate reports
---
Generate reports.
`, {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    });

    const tool = createInstallSkillTool({ cwd, configDir, fetchFn });
    const result = await tool.execute({
      source: 'acme/demo/skills/report.md#release',
      scope: 'global',
    });

    const installedPath = join(configDir, 'skills', 'report.md');
    expect(existsSync(installedPath)).toBe(true);
    expect(result).toContain(installedPath);
  });

  it('rejects remote documents that are not valid skill markdown', async () => {
    const cwd = createTempDir('xiaok-install-skill-project-');
    const configDir = createTempDir('xiaok-install-skill-config-');
    tempDirs.push(cwd, configDir);

    const tool = createInstallSkillTool({
      cwd,
      configDir,
      fetchFn: async () => new Response('<html><body>not a skill</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    });

    const result = await tool.execute({
      source: 'https://example.com/not-a-skill',
    });

    expect(result).toContain('不是有效的 skill Markdown');
  });
});
