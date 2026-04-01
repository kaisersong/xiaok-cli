import { describe, it, expect } from 'vitest';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { createToolSearchTool } from '../../../src/ai/tools/search.js';

describe('tool_search', () => {
  it('returns active tool schemas by name', async () => {
    const registry = new ToolRegistry({
      permissionManager: new PermissionManager({ mode: 'default' }),
      dryRun: false,
      onPrompt: async () => true,
    });

    const toolSearchTool = createToolSearchTool(registry);
    const result = await toolSearchTool.execute({ query: 'select:uninstall_skill' });

    expect(result).toContain('uninstall_skill');
  });

  it('returns deferred tool schemas by name', async () => {
    const registry = new ToolRegistry({
      permissionManager: new PermissionManager({ mode: 'default' }),
      dryRun: false,
      onPrompt: async () => true,
    }, []);

    registry.registerDeferredTool({
      name: 'mcp_add',
      description: 'add an mcp server',
      inputSchema: { type: 'object', properties: {}, required: [] },
    });

    const toolSearchTool = createToolSearchTool(registry);
    const result = await toolSearchTool.execute({ query: 'select:mcp_add' });

    expect(result).toContain('mcp_add');
  });
});
