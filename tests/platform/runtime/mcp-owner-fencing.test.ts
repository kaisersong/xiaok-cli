import { describe, expect, it, vi } from 'vitest';
import { createPlatformRegistryFactory } from '../../../src/platform/runtime/registry-factory.js';
import { CapabilityRegistry } from '../../../src/platform/runtime/capability-registry.js';
import type { PlatformRuntimeContext } from '../../../src/platform/runtime/context.js';
import type { Tool } from '../../../src/types.js';

function tool(name: string, label = name): Tool {
  return { definition: { name, description: label, inputSchema: { type: 'object', properties: {} } },
    permission: 'safe', execute: vi.fn(async () => label) };
}

function fixture(mcpTools: Tool[], workflowTools: Tool[] = [], check = async () => 'allow' as const) {
  let update!: (tools: Tool[]) => void;
  const platform = { customAgents: [], pluginRuntime: { hookConfigs: [] }, mcpTools,
    capabilityRegistry: new CapabilityRegistry(),
    createBackgroundRunner: () => ({ dispose: async () => ({ settled: true, pendingJobs: [] }) }),
    createReminderApi: () => undefined,
    onMcpToolsChanged: (listener: typeof update) => { update = listener; return () => {}; },
  } as unknown as PlatformRuntimeContext;
  const factory = createPlatformRegistryFactory({ platform, workflowTools, source: 'review', sessionId: 'owner-fence',
    adapter: () => ({ async *stream() {} }), buildSystemPrompt: async () => 'test',
    permissionManager: { getMode: () => 'auto', check } as any,
  });
  return { factory, update: (tools: Tool[]) => update(tools), capabilities: platform.capabilityRegistry };
}

describe('MCP registration instance fencing', () => {
  it('preserves both built-in and workflow merge winners when colliding MCP tools are updated or withdrawn', async () => {
    const workflow = tool('mcp__fixture__shared', 'workflow');
    const f = fixture([tool('read', 'mcp read'), tool(workflow.definition.name, 'mcp workflow')], [workflow]);
    try {
      const registry = f.factory.createRegistry(process.cwd());
      const originalRead = registry.getToolDefinitions().find((t) => t.name === 'read');
      expect(originalRead?.description).not.toBe('mcp read');
      expect(await registry.executeTool(workflow.definition.name, {})).toBe('workflow');
      f.update([tool('read', 'replacement read'), tool(workflow.definition.name, 'replacement workflow')]);
      expect(registry.getToolDefinitions().find((t) => t.name === 'read')).toEqual(originalRead);
      expect(await registry.executeTool(workflow.definition.name, {})).toBe('workflow');
      f.update([]);
      expect(registry.getToolDefinitions().find((t) => t.name === 'read')).toEqual(originalRead);
      expect(await registry.executeTool(workflow.definition.name, {})).toBe('workflow');
    } finally { await f.factory.dispose(); }
  });

  it('does not replace or remove an external owner that took over the same registry name', async () => {
    const name = 'mcp__fixture__shared';
    const f = fixture([tool(name, 'mcp')]);
    try {
      const registry = f.factory.createRegistry(process.cwd());
      const external = tool(name, 'external');
      registry.registerTool(external);
      f.update([tool(name, 'mcp replacement')]);
      expect(await registry.executeTool(name, {})).toBe('external');
      f.update([]);
      expect(await registry.executeTool(name, {})).toBe('external');
      expect(f.capabilities.get(name)?.description).toBe('external');
    } finally { await f.factory.dispose(); }
  });

  it('rejects late permission results for the old MCP instance after same-name replacement', async () => {
    let approve!: () => void;
    const gate = new Promise<void>((resolve) => { approve = resolve; });
    const old = tool('mcp__fixture__replace', 'old');
    const next = tool(old.definition.name, 'next');
    const f = fixture([old], [], async () => { await gate; return 'allow'; });
    try {
      const registry = f.factory.createRegistry(process.cwd());
      const pending = registry.executeTool(old.definition.name, {});
      f.update([next]);
      approve();
      expect(await pending).toContain('no longer registered');
      expect(old.execute).not.toHaveBeenCalled();
      expect(await registry.executeTool(next.definition.name, {})).toBe('next');
      f.update([]);
      expect(await registry.executeTool(next.definition.name, {})).toContain('Error:');
    } finally { approve(); await f.factory.dispose(); }
  });

  it('tracks companion ownership and does not let implicit registration bypass restricted catalogs', async () => {
    const parent = tool('mcp__fixture__parent');
    const companion = tool('mcp__fixture__companion');
    parent.companionTools = [companion];
    companion.companionTools = [parent]; // expanding a catalog must terminate even with a cycle
    const f = fixture([parent]);
    try {
      const main = f.factory.createRegistry(process.cwd());
      const restricted = f.factory.createRegistry(process.cwd(), [parent.definition.name], 'restricted');
      expect(main.getToolDefinitions().map((t) => t.name)).toContain(companion.definition.name);
      expect(restricted.getToolDefinitions().map((t) => t.name)).not.toContain(companion.definition.name);
      f.update([]);
      expect(main.getToolDefinitions().map((t) => t.name)).not.toContain(companion.definition.name);
    } finally { await f.factory.dispose(); }
  });
});
