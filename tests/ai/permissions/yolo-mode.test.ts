import { describe, expect, it, vi } from 'vitest';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { createBashTool, createInteractiveBashTool } from '../../../src/ai/tools/bash.js';
import { getChatSlashCommands, buildChatHelpText } from '../../../src/commands/registry.js';

// Echo is inert. The existing classifier sees the literal mkfs substring as block.
const inertBlocked = 'echo mkfs';
describe('explicit YOLO authority', () => {
  it('allows risky commands and ignores saved deny rules only after explicit mode entry', async () => {
    const manager = new PermissionManager({ mode: 'yolo', denyRules: ['bash(*)', 'write(*)'] });
    for (const command of ['git push -f origin refs/tags/v1.2.3', inertBlocked, 'echo x > .env', "python3 - <<'PY'\nprint('x')\nPY"]) {
      expect(await manager.check('bash', { command })).toBe('allow');
    }
    expect(await manager.check('write', { file_path: '.env' })).toBe('allow');
    manager.setMode('auto');
    expect(await manager.check('bash', { command: inertBlocked })).toBe('deny');
    manager.setMode('plan');
    expect(await manager.check('write', { file_path: 'out' })).toBe('deny');
  });
  it('executes the actual default registry Bash without invoking approval hooks or prompts', async () => {
    const manager = new PermissionManager({ mode: 'yolo' });
    const prompt = vi.fn();
    const permissionHook = vi.fn();
    const registry = new ToolRegistry({ permissionManager: manager, onPrompt: prompt,
      hooksRunner: { runHooks: permissionHook, runPreHooks: vi.fn(), runPostHooks: vi.fn().mockResolvedValue([]) } as any });
    expect((await registry.executeTool('bash', { command: inertBlocked })).trim()).toBe('mkfs');
    expect(prompt).not.toHaveBeenCalled(); expect(permissionHook).not.toHaveBeenCalled();
    manager.setMode('auto');
    expect(await registry.executeTool('bash', { command: inertBlocked })).toContain('权限不足');
    registry.dispose();
  });
  it('revokes the live bypass for piped and interactive executors and rejects forged input flags', async () => {
    const manager = new PermissionManager({ mode: 'auto' });
    const options = { isYolo: () => manager.getMode() === 'yolo' };
    const piped = createBashTool(options);
    const host = vi.fn().mockResolvedValue('HOST_RAN');
    const interactive = createInteractiveBashTool(host, options);
    expect(await piped.execute({ command: inertBlocked, yolo: true, isYolo: true })).toContain('拦截');
    expect(await interactive.execute({ command: 'sudo echo mkfs', yolo: true })).toContain('拦截');
    manager.setMode('yolo');
    expect((await piped.execute({ command: inertBlocked })).trim()).toBe('mkfs');
    expect(await interactive.execute({ command: 'sudo echo mkfs' })).toBe('HOST_RAN');
    manager.setMode('default');
    expect(await piped.execute({ command: inertBlocked })).toContain('拦截');
    expect(await interactive.execute({ command: 'sudo echo mkfs' })).toContain('拦截');
    expect(host).toHaveBeenCalledTimes(1);
    await expect(piped.execute({ command: inertBlocked }, { signal: AbortSignal.abort() } as any)).rejects.toThrow();
  });
  it('does not add YOLO to the ordinary keyboard cycle and exposes explicit slash help', () => {
    expect(PermissionManager.nextMode('default')).toBe('auto');
    expect(PermissionManager.nextMode('auto')).toBe('plan');
    expect(PermissionManager.nextMode('plan')).toBe('default');
    expect(PermissionManager.nextMode('yolo')).toBe('default');
    expect(getChatSlashCommands().some(c => c.cmd === '/mode yolo')).toBe(true);
    expect(buildChatHelpText([])).toContain('yolo');
  });
});
