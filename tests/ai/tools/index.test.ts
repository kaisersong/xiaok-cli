// tests/ai/tools/index.test.ts
import { describe, it, expect, vi } from 'vitest';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import type { Tool } from '../../../src/types.js';
import { CapabilityRegistry } from '../../../src/platform/runtime/capability-registry.js';

describe('ToolRegistry', () => {
  it('safe tools execute without prompting', async () => {
    const prompted: string[] = [];
    const registry = new ToolRegistry({
      permissionManager: new PermissionManager({ mode: 'default' }),
      dryRun: false,
      onPrompt: async (name) => { prompted.push(name); return true; },
    });
    const result = await registry.executeTool('glob', { pattern: '*.nonexistent' });
    expect(prompted).toHaveLength(0);
    expect(result).toBeTruthy();
  });

  it('custom safe tools do not prompt in default mode', async () => {
    const prompted: string[] = [];
    const registry = new ToolRegistry({
      permissionManager: new PermissionManager({ mode: 'default' }),
      onPrompt: async (name) => { prompted.push(name); return false; },
    }, [{
      permission: 'safe',
      definition: {
        name: 'team_create',
        description: 'create a team',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      execute: async () => 'team created: team_1 (platform)',
    }]);

    await expect(registry.executeTool('team_create', {})).resolves.toContain('team created');
    expect(prompted).toEqual([]);
  });

  it('write tools prompt in default mode', async () => {
    const prompted: string[] = [];
    const registry = new ToolRegistry({
      permissionManager: new PermissionManager({ mode: 'default' }),
      dryRun: false,
      onPrompt: async (name) => { prompted.push(name); return false; /* deny */ },
    });
    const result = await registry.executeTool('write', { file_path: '/tmp/x', content: 'x' });
    expect(prompted).toContain('write');
    expect(result).toContain('已取消');
  });

  it('falls back to the default prompt handler when onPrompt is omitted', async () => {
    const registry = new ToolRegistry({
      permissionManager: new PermissionManager({ mode: 'default' }),
    }, [{
      permission: 'write',
      definition: {
        name: 'write',
        description: 'mock write',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      execute: async () => 'should not run',
    }]);

    await expect(registry.executeTool('write', { file_path: '/tmp/x', content: 'x' }))
      .resolves.toContain('已取消');
  });

  it('write tools skip prompt in auto mode', async () => {
    const prompted: string[] = [];
    const mockWriteTool: Tool = {
      permission: 'write',
      definition: {
        name: 'write',
        description: 'mock write',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      execute: async () => '已写入: /tmp/x',
    };
    const registry = new ToolRegistry({
      permissionManager: new PermissionManager({ mode: 'auto' }),
      dryRun: false,
      onPrompt: async (name) => { prompted.push(name); return true; },
    }, [mockWriteTool]);
    const result = await registry.executeTool('write', { file_path: '/tmp/x', content: 'x' });
    expect(prompted).toHaveLength(0);
    expect(result).toContain('已写入');
  });

  it('dry-run returns description without executing', async () => {
    const registry = new ToolRegistry({
      permissionManager: new PermissionManager({ mode: 'default' }),
      dryRun: true,
      onPrompt: async () => true,
    });
    const result = await registry.executeTool('bash', { command: 'rm -rf /' });
    expect(result).toContain('[dry-run]');
    expect(result).not.toContain('Error');
  });

  it('getToolDefinitions returns all tools', () => {
    const registry = new ToolRegistry({
      permissionManager: new PermissionManager({ mode: 'default' }),
      dryRun: false,
      onPrompt: async () => true,
    });
    const defs = registry.getToolDefinitions();
    expect(defs.map(d => d.name)).toContain('bash');
    expect(defs.map(d => d.name)).toContain('read');
    expect(defs.map(d => d.name)).toContain('write');
    expect(defs.map(d => d.name)).toContain('web_fetch');
    expect(defs.map(d => d.name)).toContain('web_search');
    expect(defs.map(d => d.name)).toContain('install_skill');
    expect(defs.map(d => d.name)).toContain('uninstall_skill');
    expect(defs.map(d => d.name)).toContain('validate_skill');
  });

  it('denies write tools in plan mode without prompting', async () => {
    const prompted: string[] = [];
    const mockWriteTool: Tool = {
      permission: 'write',
      definition: {
        name: 'write',
        description: 'mock write',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      execute: async () => 'should not run',
    };
    const registry = new ToolRegistry({
      permissionManager: new PermissionManager({ mode: 'plan' }),
      dryRun: false,
      onPrompt: async (name) => { prompted.push(name); return true; },
    }, [mockWriteTool]);

    const result = await registry.executeTool('write', { file_path: '/tmp/x', content: 'x' });

    expect(prompted).toHaveLength(0);
    expect(result).toContain('权限');
  });

  it('supports custom registration', async () => {
    const registry = new ToolRegistry({
      permissionManager: new PermissionManager({ mode: 'default' }),
      dryRun: false,
      onPrompt: async () => true,
    }, []);

    registry.registerTool({
      permission: 'safe',
      definition: {
        name: 'echo_tool',
        description: 'echo',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      execute: async () => 'ok',
    });

    expect(await registry.executeTool('echo_tool', {})).toBe('ok');
  });

  it('normalizes thrown tool errors without duplicating the Error prefix', async () => {
    const registry = new ToolRegistry({
      permissionManager: new PermissionManager({ mode: 'auto' }),
    }, [{
      permission: 'safe',
      definition: {
        name: 'broken_tool',
        description: 'broken',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      execute: async () => {
        throw new Error('boom');
      },
    }]);

    await expect(registry.executeTool('broken_tool', {})).resolves.toBe('Error: boom');
  });

  it('blocks execution when a pre hook denies the tool call', async () => {
    const registry = new ToolRegistry({
      permissionManager: new PermissionManager({ mode: 'auto' }),
      hooksRunner: {
        runPreHooks: async () => ({ ok: false, message: 'blocked by hook' }),
        runPostHooks: async () => [],
      },
    }, [{
      permission: 'write',
      definition: {
        name: 'write',
        description: 'mock write',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      execute: async () => 'should not run',
    }]);

    const result = await registry.executeTool('write', { file_path: '/tmp/x', content: 'x' });

    expect(result).toContain('blocked by hook');
  });

  it('appends post hook warnings without failing the tool result', async () => {
    const registry = new ToolRegistry({
      permissionManager: new PermissionManager({ mode: 'auto' }),
      hooksRunner: {
        runPreHooks: async () => ({ ok: true }),
        runPostHooks: async () => ['post hook warning'],
      },
    }, [{
      permission: 'safe',
      definition: {
        name: 'echo_tool',
        description: 'echo',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      execute: async () => 'ok',
    }]);

    const result = await registry.executeTool('echo_tool', {});

    expect(result).toContain('ok');
    expect(result).toContain('Warning: post hook warning');
  });

  it('skips native tool execution when a pre hook requests preventContinuation', async () => {
    const execute = vi.fn(async () => 'native ask menu should not run');
    const registry = new ToolRegistry({
      permissionManager: new PermissionManager({ mode: 'auto' }),
      hooksRunner: {
        runPreHooks: async () => ({
          ok: true,
          preventContinuation: true,
          additionalContext: 'AskUserQuestion has been mirrored to HexDeck.'
        }),
        runPostHooks: async () => [],
      },
    }, [{
      permission: 'safe',
      definition: {
        name: 'AskUserQuestion',
        description: 'mock ask',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      execute,
    }]);

    const result = await registry.executeTool('AskUserQuestion', {
      questions: [{ question: '继续还是停止？', options: [{ label: '继续' }, { label: '停止' }] }]
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result).toContain('AskUserQuestion has been mirrored to HexDeck.');
  });

  it('merges capability registry matches into tool search results', () => {
    const capabilityRegistry = new CapabilityRegistry();
    capabilityRegistry.register({
      kind: 'skill',
      name: 'cognitive-coach',
      description: 'think deeper',
      execute: async () => 'ok',
    });

    const registry = new ToolRegistry({
      permissionManager: new PermissionManager({ mode: 'default' }),
      capabilityRegistry,
    }, []);

    expect(registry.searchTools('cognitive')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'cognitive-coach' }),
    ]));
  });

  it('accepts legacy allowedTools aliases for the same logical built-in tool', async () => {
    const registry = new ToolRegistry({
      permissionManager: new PermissionManager({ mode: 'auto' }),
    });

    registry.setAllowedTools(['Read']);

    const result = await registry.executeTool('read', { file_path: 'src/ai/tools/read.ts', limit: 1 });

    expect(result).toContain('import { readFileSync, existsSync } from \'fs\';');
    expect(result).not.toContain('is not allowed');
  });

  it('runs PermissionRequest hooks before prompt fallback and skips the UI prompt when the hook allows', async () => {
    const onPrompt = vi.fn(async () => false);
    const runHooks = vi.fn(async (eventName: string) => {
      if (eventName === 'PermissionRequest') {
        return { ok: true, decision: 'allow' as const };
      }
      return { ok: true };
    });

    const registry = new ToolRegistry({
      permissionManager: new PermissionManager({ mode: 'default' }),
      onPrompt,
      hooksRunner: {
        runHooks,
        runPreHooks: async () => ({ ok: true }),
        runPostHooks: async () => [],
      },
    }, [{
      permission: 'write',
      definition: {
        name: 'write',
        description: 'mock write',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      execute: async () => 'written by hook-approved path',
    }]);

    const result = await registry.executeTool('write', { file_path: '/tmp/x', content: 'x' });

    expect(runHooks).toHaveBeenCalledWith('PermissionRequest', expect.objectContaining({
      tool_name: 'write',
    }));
    expect(onPrompt).not.toHaveBeenCalled();
    expect(result).toContain('written by hook-approved path');
  });

  it('emits PermissionDenied hooks when policy blocks a tool before any prompt', async () => {
    const runHooks = vi.fn(async () => ({ ok: true }));

    const registry = new ToolRegistry({
      permissionManager: new PermissionManager({ mode: 'plan' }),
      hooksRunner: {
        runHooks,
        runPreHooks: async () => ({ ok: true }),
        runPostHooks: async () => [],
      },
    }, [{
      permission: 'write',
      definition: {
        name: 'write',
        description: 'mock write',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      execute: async () => 'should not run',
    }]);

    const result = await registry.executeTool('write', { file_path: '/tmp/x', content: 'x' });

    expect(result).toContain('权限');
    expect(runHooks).toHaveBeenCalledWith('PermissionDenied', expect.objectContaining({
      tool_name: 'write',
    }));
  });

  it('emits PermissionDenied hooks when the fallback prompt declines the tool call', async () => {
    const runHooks = vi.fn(async () => ({ ok: true }));
    const onPrompt = vi.fn(async () => false);

    const registry = new ToolRegistry({
      permissionManager: new PermissionManager({ mode: 'default' }),
      onPrompt,
      hooksRunner: {
        runHooks,
        runPreHooks: async () => ({ ok: true }),
        runPostHooks: async () => [],
      },
    }, [{
      permission: 'write',
      definition: {
        name: 'write',
        description: 'mock write',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      execute: async () => 'should not run',
    }]);

    const result = await registry.executeTool('write', { file_path: '/tmp/x', content: 'x' });

    expect(onPrompt).toHaveBeenCalled();
    expect(result).toContain('已取消');
    expect(runHooks).toHaveBeenCalledWith('PermissionRequest', expect.objectContaining({
      tool_name: 'write',
    }));
    expect(runHooks).toHaveBeenCalledWith('PermissionDenied', expect.objectContaining({
      tool_name: 'write',
    }));
  });
});
