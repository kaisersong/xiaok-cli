import { describe, it, expect, vi } from 'vitest';
import { bashTool, createInteractiveBashTool } from '../../../src/ai/tools/bash.js';
import { classifyBashCommand } from '../../../src/ai/tools/bash-safety.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shellNodeFixture } from '../../support/shell-node-fixture.js';

describe('interactive sudo Bash', () => {
  it('classifies sudo as warn while keeping destructive commands blocked', () => {
    expect(classifyBashCommand('sudo id -u').level).toBe('warn');
    expect(classifyBashCommand('sudo rm -rf /').level).toBe('block');
  });
  it('uses the host callback only for sudo and checks safety first', async () => {
    const run = vi.fn().mockResolvedValue('0');
    const tool = createInteractiveBashTool(run);
    expect(await tool.execute({ command: 'sudo id -u' })).toBe('0');
    expect(run).toHaveBeenCalledTimes(1);
    expect(await tool.execute({ command: 'sudo rm -rf /' })).toContain('拦截');
    expect(run).toHaveBeenCalledTimes(1);
    const root = mkdtempSync(join(tmpdir(), 'plain-host-shell-'));
    try {
      const command = process.platform === 'win32'
        ? shellNodeFixture(root, "process.stdout.write('plain');")
        : 'printf plain';
      expect(await tool.execute({ command })).toBe('plain');
    } finally { rmSync(root, { recursive: true, force: true }); }
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('does not expose interactive input when no host is present', async () => {
    expect(await bashTool.execute({ command: 'sudo id' })).toContain('交互终端');
  });
  it('does not enter the terminal after an abort or a denied permission', async () => {
    const run = vi.fn();
    const tool = createInteractiveBashTool(run);
    const signal = AbortSignal.abort();
    await expect(tool.execute({ command: 'sudo id' }, { signal } as any)).rejects.toThrow();
    const registry = new ToolRegistry({ onPrompt: async () => false, permissionManager: new PermissionManager({ mode: 'default', denyRules: ['bash(*)'] }) }, [tool]);
    await registry.executeTool('bash', { command: 'sudo id' });
    expect(run).not.toHaveBeenCalled();
  });
});
