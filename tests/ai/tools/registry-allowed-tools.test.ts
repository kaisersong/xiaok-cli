import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import type { Tool } from '../../../src/types.js';

function makeTool(name: string): Tool {
  return {
    permission: 'safe',
    definition: { name, description: `Tool ${name}`, inputSchema: { type: 'object', properties: {} } },
    execute: async () => `result-from-${name}`,
  };
}

describe('ToolRegistry allowed-tools filter', () => {
  it('allows all tools when no filter is set', async () => {
    const registry = new ToolRegistry({}, [makeTool('read'), makeTool('write')]);
    const result = await registry.executeTool('read', {});
    expect(result).toBe('result-from-read');
  });

  it('blocks tools not in the allowed list', async () => {
    const registry = new ToolRegistry({}, [makeTool('read'), makeTool('write')]);
    registry.setAllowedTools(['read']);
    const result = await registry.executeTool('write', {});
    expect(result).toMatch(/not allowed/i);
  });

  it('allows tools in the allowed list', async () => {
    const registry = new ToolRegistry({}, [makeTool('read'), makeTool('write')]);
    registry.setAllowedTools(['read', 'write']);
    const result = await registry.executeTool('read', {});
    expect(result).toBe('result-from-read');
  });

  it('clears filter when setAllowedTools(null) called', async () => {
    const registry = new ToolRegistry({}, [makeTool('read'), makeTool('write')]);
    registry.setAllowedTools(['read']);
    registry.setAllowedTools(null);
    const result = await registry.executeTool('write', {});
    expect(result).toBe('result-from-write');
  });
});
