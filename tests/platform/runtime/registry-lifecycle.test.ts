import { describe, expect, it, vi } from 'vitest';
import { CapabilityRegistry } from '../../../src/platform/runtime/capability-registry.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import type { Tool } from '../../../src/types.js';
import { createPlatformRegistryFactory } from '../../../src/platform/runtime/registry-factory.js';
import type { PlatformRuntimeContext } from '../../../src/platform/runtime/context.js';

function tool(name: string, value = name): Tool {
  return { definition: { name, description: value, inputSchema: { type: 'object', properties: {} } }, permission: 'safe', execute: vi.fn(async () => value) };
}

describe('registry lifecycle ownership', () => {
  it('restores surviving owners without reviving released owners across repeated refreshes', () => {
    const capabilities = new CapabilityRegistry();
    const parent = {};
    const child = {};
    const sibling = {};
    const record = (description: string) => ({ kind: 'tool' as const, name: 'shared', description });
    capabilities.register(record('platform'));
    capabilities.register(record('parent'), parent);
    capabilities.register(record('child'), child);
    for (let i = 0; i < 20; i++) capabilities.register(record(`sibling${i}`), sibling);
    capabilities.unregisterOwner(child);
    capabilities.unregisterOwner(sibling);
    expect(capabilities.get('shared')?.description).toBe('parent');
    capabilities.unregisterOwner(parent);
    expect(capabilities.get('shared')?.description).toBe('platform');
    capabilities.unregister('shared');
    expect(capabilities.search('')).toEqual([]);
  });

  it('disposes active, deferred and companion registrations without deleting another registry', async () => {
    const capabilities = new CapabilityRegistry();
    const parent = new ToolRegistry({ capabilityRegistry: capabilities }, [tool('shared', 'parent')]);
    const original = capabilities.get('shared');
    const childTool = tool('shared', 'child');
    childTool.companionTools = [tool('companion')];
    const child = new ToolRegistry({ capabilityRegistry: capabilities }, [childTool]);
    child.registerDeferredTool(tool('deferred').definition);
    const stale = capabilities.get('shared')!;
    child.dispose();
    child.dispose();
    expect(capabilities.get('shared')).toBe(original);
    expect(capabilities.get('companion')).toBeUndefined();
    expect(capabilities.get('deferred')).toBeUndefined();
    expect(child.getToolDefinitions()).toEqual([]);
    expect(child.searchTools('')).toEqual([]);
    expect(await child.executeTool('shared', {})).toContain('disposed');
    await expect(child.executeTool('shared', {}, { signal: AbortSignal.abort() } as any)).rejects.toMatchObject({ name: 'AbortError' });
    expect(await stale.execute!({})).toContain('disposed');
    expect(childTool.execute).not.toHaveBeenCalled();
    expect(() => child.registerTool(tool('late'))).toThrow('disposed');
    expect(() => child.registerDeferredTool(tool('late').definition)).toThrow('disposed');
    parent.dispose();
    expect(capabilities.search('')).toEqual([]);
  });

  it('does not start a tool whose permission check settled after registry disposal', async () => {
    let allow!: () => void;
    const waiting = new Promise<void>((resolve) => { allow = resolve; });
    const execute = tool('write');
    const registry = new ToolRegistry({ permissionManager: {
      getMode: () => 'auto', check: async () => { await waiting; return 'allow'; },
    } as any }, [execute]);
    const result = registry.executeTool('write', {});
    registry.dispose();
    allow();
    expect(await result).toContain('disposed');
    expect(execute.execute).not.toHaveBeenCalled();
  });

  it('restores main capabilities after repeated production factory children and destroys main on exit', async () => {
    const capabilities = new CapabilityRegistry();
    const unsubscribe = vi.fn();
    const platform = {
      customAgents: [], pluginRuntime: { hookConfigs: [] }, mcpTools: [],
      capabilityRegistry: capabilities, createBackgroundRunner: () => ({ dispose: async () => ({ settled: true, pendingJobs: [] }) }),
      createReminderApi: () => undefined, onMcpToolsChanged: () => unsubscribe,
    } as unknown as PlatformRuntimeContext;
    const factory = createPlatformRegistryFactory({ platform, source: 'chat', sessionId: 'lifecycle',
      adapter: () => ({ getModelName: () => 'fixture', async *stream() { yield { type: 'text', delta: 'done' }; yield { type: 'done' }; } }),
      buildSystemPrompt: async () => 'test',
    });
    const main = factory.createRegistry(process.cwd());
    const mainSpawn = capabilities.get('spawn_agent');
    try {
      for (let i = 0; i < 6; i++) {
        const child = JSON.parse(await main.executeTool('spawn_agent', { task_name: `child_${i}`, message: 'run', fork_context: false }));
        expect(child.id).toBeDefined();
        await vi.waitFor(async () => {
          const list = JSON.parse(await main.executeTool('list_agents', {}));
          expect(list).toContainEqual(expect.objectContaining({ id: child.id, status: 'completed', runtimeResident: false }));
        });
        expect(capabilities.get('spawn_agent')).toBe(mainSpawn);
        expect(JSON.parse(await main.executeTool('close_agent', { target: child.id }))).toMatchObject({ resourcesReleased: true });
        expect(capabilities.get('spawn_agent')).toBe(mainSpawn);
      }
    } finally {
      await factory.dispose();
    }
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(capabilities.search('')).toEqual([]);
    expect(main.getToolDefinitions()).toEqual([]);
    expect(await main.executeTool('spawn_agent', {})).toContain('disposed');
  });

  it('unregisters removed tools across factory registries without widening restricted catalogs', async () => {
    const capabilities = new CapabilityRegistry();
    const old = tool('mcp__one__old');
    const keep = tool('mcp__two__keep');
    let update!: (tools: Tool[]) => void;
    const platform = { customAgents: [], pluginRuntime: { hookConfigs: [] }, mcpTools: [old, keep],
      capabilityRegistry: capabilities, createBackgroundRunner: () => ({ dispose: async () => ({ settled: true, pendingJobs: [] }) }), createReminderApi: () => undefined,
      onMcpToolsChanged: (listener: (tools: Tool[]) => void) => { update = listener; return () => {}; },
    } as unknown as PlatformRuntimeContext;
    const factory = createPlatformRegistryFactory({ platform, source: 'chat', sessionId: 'catalog',
      adapter: () => ({ async *stream() {} }), buildSystemPrompt: async () => 'test',
    });
    const main = factory.createRegistry(process.cwd());
    const restricted = factory.createRegistry(process.cwd(), [old.definition.name], 'restricted');
    const stale = capabilities.get(old.definition.name)!;
    update([keep]);
    expect(main.getToolDefinitions().map((definition) => definition.name)).not.toContain(old.definition.name);
    expect(restricted.getToolDefinitions().map((definition) => definition.name)).not.toContain(keep.definition.name);
    expect(capabilities.get(old.definition.name)).toBeUndefined();
    expect(await stale.execute!({})).toContain('Error:');
    expect(old.execute).not.toHaveBeenCalled();
    expect(main.getToolDefinitions().map((definition) => definition.name)).toContain('read');
    update([]);
    expect(main.getToolDefinitions().map((definition) => definition.name)).not.toContain(keep.definition.name);
    await factory.dispose();
  });

  it('does not invoke an MCP tool removed during its asynchronous permission check', async () => {
    let allow!: () => void;
    const waiting = new Promise<void>((resolve) => { allow = resolve; });
    const removed = tool('mcp__one__removed');
    const registry = new ToolRegistry({ permissionManager: {
      getMode: () => 'auto', check: async () => { await waiting; return 'allow'; },
    } as any }, [removed]);
    const result = registry.executeTool(removed.definition.name, {});
    registry.unregisterTool(removed.definition.name);
    allow();
    expect(await result).toContain('no longer registered');
    expect(removed.execute).not.toHaveBeenCalled();
    registry.dispose();
  });

  it('preserves builtins and newer registrations when an MCP catalog collides or is withdrawn', async () => {
    let update!: (tools: Tool[]) => void;
    const collision = tool('read', 'wrong MCP read');
    const owned = tool('mcp__one__owned');
    const platform = { customAgents: [], pluginRuntime: { hookConfigs: [] }, mcpTools: [collision, owned],
      createBackgroundRunner: () => ({ dispose: async () => ({ settled: true, pendingJobs: [] }) }),
      createReminderApi: () => undefined,
      onMcpToolsChanged: (listener: typeof update) => { update = listener; return () => {}; },
    } as unknown as PlatformRuntimeContext;
    const factory = createPlatformRegistryFactory({ platform, source: 'chat', sessionId: 'collision',
      adapter: () => ({ async *stream() {} }), buildSystemPrompt: async () => '',
    });
    const registry = factory.createRegistry(process.cwd());
    const builtinRead = registry.getToolDefinitions().find((item) => item.name === 'read');
    expect(builtinRead).toBeDefined();
    expect(builtinRead?.description).not.toBe('wrong MCP read');
    update([collision, owned]);
    expect(registry.getToolDefinitions().find((item) => item.name === 'read')).toBe(builtinRead);
    registry.registerTool(tool(owned.definition.name, 'new owner'));
    update([]);
    expect(registry.getToolDefinitions().find((item) => item.name === 'read')).toBe(builtinRead);
    expect(await registry.executeTool(owned.definition.name, {})).toBe('new owner');
    await factory.dispose();
  });
});
