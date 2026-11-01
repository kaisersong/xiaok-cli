import { describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerVersionCommand } from '../../src/commands/version.js';
import { getVersionInfo, formatVersionInfo } from '../../src/utils/version-info.js';

describe('version information', () => {
  it('can load without package.json and retains a truthful unknown fallback', async () => {
    vi.resetModules();
    vi.doMock('node:fs', async original => ({
      ...await original<typeof import('node:fs')>(),
      readFileSync: () => { throw new Error('package absent'); },
    }));
    try {
      const module = await import('../../src/utils/version-info.js');
      expect(module.getInstalledVersion()).toBe(getVersionInfo().build.version ?? 'unknown');
      expect(module.formatVersionInfo()).toContain('源码提交');
    } finally { vi.doUnmock('node:fs'); vi.resetModules(); }
  });
  it('reads frozen metadata and reports runtime details without consulting the cwd repository', () => {
    const before = getVersionInfo();
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue('/different/project');
    try {
      const info = getVersionInfo();
      expect(info.build).toEqual(before.build);
      expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(info.runtime.node).toBe(process.version);
      expect(info.runtime.platform).toBe(process.platform);
      expect(info.runtime.arch).toBe(process.arch);
      expect(formatVersionInfo(info)).toContain('源码提交');
      expect(formatVersionInfo(info)).toContain('构建时间');
      expect(formatVersionInfo(info)).toContain('实际入口');
    } finally { cwd.mockRestore(); }
  });

  it('offers a standalone JSON command through the real commander registration', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const program = new Command(); registerVersionCommand(program);
      await program.parseAsync(['node', 'xiaok', 'version', '--json']);
      const output = JSON.parse(String(log.mock.calls[0][0]));
      expect(output.version).toBe(getVersionInfo().version);
      expect(output.build).toHaveProperty('commit');
      expect(output.runtime).toHaveProperty('entry');
      expect(output).not.toHaveProperty('config');
    } finally { log.mockRestore(); }
  });
});
