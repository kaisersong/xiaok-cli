import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'child_process';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { createBashTool, createInteractiveBashTool } from '../../../src/ai/tools/bash.js';
import type { HooksRunner } from '../../../src/runtime/hooks-runner.js';
import { getChatSlashCommands, buildChatHelpText } from '../../../src/commands/registry.js';

// Exercise real policy/registry/Bash guards, but never execute a shell command.
vi.mock('child_process', async loadOriginal => {
  const original = await loadOriginal<typeof import('child_process')>();
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  return { ...original, spawn: vi.fn(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
    });
    queueMicrotask(() => {
      child.stdout.end('SHELL_RAN');
      child.stderr.end();
      child.emit('exit', 0, null);
      child.emit('close', 0, null);
    });
    return child;
  }) };
});

// Echo is inert, but the classifier intentionally blocks its literal mkfs token.
const inertBlocked = 'echo mkfs';
const warnedCommand = 'git push -f origin refs/tags/v1.2.3';
beforeEach(() => { vi.mocked(spawn).mockClear(); });
describe('explicit YOLO authority', () => {
  it('allows non-blocked requests in YOLO while preserving saved deny rules and hard blocks', async () => {
    const manager = new PermissionManager({ mode: 'yolo', denyRules: ['bash(*)', 'write(*)'] });
    for (const command of [warnedCommand, inertBlocked, 'echo x > .env', "python3 - <<'PY'\nprint('x')\nPY"]) {
      expect(await manager.check('bash', { command })).toBe('deny');
    }
    expect(await manager.check('write', { file_path: '.env' })).toBe('deny');
    const explicit = new PermissionManager({ mode: 'yolo' });
    expect(await explicit.check('bash', { command: warnedCommand })).toBe('allow');
    expect(await explicit.check('bash', { command: inertBlocked })).toBe('deny');
    expect(await explicit.check('write', { file_path: 'out' })).toBe('allow');
    expect(await explicit.check('write', { file_path: '.env' })).toBe('deny');
    manager.setMode('auto');
    expect(await manager.check('bash', { command: inertBlocked })).toBe('deny');
    manager.setMode('plan');
    expect(await manager.check('write', { file_path: 'out' })).toBe('deny');
  });
  it('executes actual default registry Bash through a fake shell without approval hooks or prompts', async () => {
    const manager = new PermissionManager({ mode: 'yolo' });
    const prompt = vi.fn().mockResolvedValue(false);
    const permissionHook = vi.fn<HooksRunner['runHooks']>().mockResolvedValue({ ok: true });
    const hooksRunner: HooksRunner = {
      runHooks: permissionHook,
      runPreHooks: vi.fn<HooksRunner['runPreHooks']>().mockResolvedValue({ ok: true }),
      runPostHooks: vi.fn<HooksRunner['runPostHooks']>().mockResolvedValue([]),
      closeAndDrain: vi.fn<HooksRunner['closeAndDrain']>().mockResolvedValue(undefined),
    };
    const registry = new ToolRegistry({ permissionManager: manager, onPrompt: prompt, hooksRunner });
    try {
      expect(await registry.executeTool('bash', { command: warnedCommand })).toBe('SHELL_RAN');
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(prompt).not.toHaveBeenCalled(); expect(permissionHook).not.toHaveBeenCalled();
      expect(await registry.executeTool('bash', { command: inertBlocked })).toContain('权限不足');
      expect(permissionHook).toHaveBeenCalledWith('PermissionDenied', expect.objectContaining({ reason: 'policy_denied' }));
      manager.setMode('auto');
      expect(await registry.executeTool('bash', { command: inertBlocked })).toContain('权限不足');
      expect(spawn).toHaveBeenCalledTimes(1);
    } finally { registry.dispose(); }
  });
  it('revokes registry admission for piped and interactive executors without bypassing hard blocks or trusting input flags', async () => {
    const manager = new PermissionManager({ mode: 'auto' });
    const options = { isYolo: () => manager.getMode() === 'yolo' };
    const piped = createBashTool(options);
    const host = vi.fn().mockResolvedValue('HOST_RAN');
    const interactive = createInteractiveBashTool(host, options);
    const prompt = vi.fn().mockResolvedValue(false);
    const pipedRegistry = new ToolRegistry({ permissionManager: manager, onPrompt: prompt }, [piped]);
    const interactiveRegistry = new ToolRegistry({ permissionManager: manager, onPrompt: prompt }, [interactive]);
    try {
      expect(await piped.execute({ command: inertBlocked, yolo: true, isYolo: true })).toContain('拦截');
      expect(await interactive.execute({ command: 'sudo echo mkfs', yolo: true })).toContain('拦截');
      expect(await pipedRegistry.executeTool('bash', { command: warnedCommand, yolo: true, isYolo: true })).toContain('已取消');
      expect(await interactiveRegistry.executeTool('bash', { command: `sudo ${warnedCommand}`, yolo: true })).toContain('已取消');
      expect(spawn).not.toHaveBeenCalled(); expect(host).not.toHaveBeenCalled();
      expect(prompt).toHaveBeenCalledTimes(2);
      manager.setMode('yolo');
      expect(await piped.execute({ command: inertBlocked })).toContain('拦截');
      expect(await interactive.execute({ command: 'sudo echo mkfs' })).toContain('拦截');
      expect(await pipedRegistry.executeTool('bash', { command: warnedCommand })).toBe('SHELL_RAN');
      expect(await interactiveRegistry.executeTool('bash', { command: `sudo ${warnedCommand}` })).toBe('HOST_RAN');
      expect(host).toHaveBeenCalledWith(expect.objectContaining({ command: `sudo ${warnedCommand}` }), undefined);
      expect(prompt).toHaveBeenCalledTimes(2);
      manager.setMode('default');
      expect(await piped.execute({ command: inertBlocked })).toContain('拦截');
      expect(await interactive.execute({ command: 'sudo echo mkfs' })).toContain('拦截');
      expect(await pipedRegistry.executeTool('bash', { command: warnedCommand, yolo: true })).toContain('已取消');
      expect(await interactiveRegistry.executeTool('bash', { command: `sudo ${warnedCommand}`, isYolo: true })).toContain('已取消');
      expect(prompt).toHaveBeenCalledTimes(4);
      expect(host).toHaveBeenCalledTimes(1); expect(spawn).toHaveBeenCalledTimes(1);
      await expect(piped.execute({ command: inertBlocked }, { signal: AbortSignal.abort() })).rejects.toThrow();
      expect(host).toHaveBeenCalledTimes(1); expect(spawn).toHaveBeenCalledTimes(1);
    } finally { pipedRegistry.dispose(); interactiveRegistry.dispose(); }
  });
  it('keeps the ordinary keyboard cycle and exposes one explicit mode selector', () => {
    expect(PermissionManager.nextMode('default')).toBe('auto');
    expect(PermissionManager.nextMode('auto')).toBe('plan');
    expect(PermissionManager.nextMode('plan')).toBe('default');
    expect(PermissionManager.nextMode('yolo')).toBe('default');
    expect(getChatSlashCommands().filter(c => c.cmd === '/mode')).toHaveLength(1);
    expect(getChatSlashCommands().some(c => c.cmd.startsWith('/mode '))).toBe(false);
    expect(buildChatHelpText([])).toContain('/mode');
    expect(buildChatHelpText([])).not.toContain('/mode yolo');
  });
});
