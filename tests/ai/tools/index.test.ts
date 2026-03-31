// tests/ai/tools/index.test.ts
import { describe, it, expect } from 'vitest';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import type { Tool } from '../../../src/types.js';

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
});
