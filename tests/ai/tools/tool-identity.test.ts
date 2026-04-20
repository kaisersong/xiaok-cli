import { describe, expect, it } from 'vitest';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { CapabilityRegistry } from '../../../src/platform/runtime/capability-registry.js';

describe('tool identity contracts', () => {
  it('resolves legacy select aliases to the same built-in tool identity used by execution', () => {
    const registry = new ToolRegistry({
      permissionManager: new PermissionManager({ mode: 'default' }),
    });

    const selected = registry.searchTools('select:Read');

    expect(selected).toHaveLength(1);
    expect(selected[0]?.name).toBe('read');
  });

  it('deduplicates built-in, deferred, and capability search entries that share one logical tool identity', () => {
    const capabilityRegistry = new CapabilityRegistry();
    capabilityRegistry.register({
      kind: 'tool',
      name: 'READ',
      description: 'legacy read alias from a capability registry',
    });

    const registry = new ToolRegistry({
      permissionManager: new PermissionManager({ mode: 'default' }),
      capabilityRegistry,
    });

    registry.registerDeferredTool({
      name: 'Read',
      description: 'legacy deferred alias for read',
      inputSchema: { type: 'object', properties: {}, required: [] },
    });

    const readEntries = registry.searchTools('read').filter((tool) => tool.name.toLowerCase() === 'read');

    expect(readEntries).toHaveLength(1);
    expect(readEntries[0]?.name).toBe('read');
  });
});
