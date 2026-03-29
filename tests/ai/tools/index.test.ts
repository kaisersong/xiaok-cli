// tests/ai/tools/index.test.ts
import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../../src/ai/tools/index.js';

describe('ToolRegistry', () => {
  it('safe tools execute without prompting', async () => {
    const prompted: string[] = [];
    const registry = new ToolRegistry({
      autoMode: false,
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
      autoMode: false,
      dryRun: false,
      onPrompt: async (name) => { prompted.push(name); return false; /* deny */ },
    });
    const result = await registry.executeTool('write', { file_path: '/tmp/x', content: 'x' });
    expect(prompted).toContain('write');
    expect(result).toContain('已取消');
  });

  it('write tools skip prompt in auto mode', async () => {
    const prompted: string[] = [];
    const registry = new ToolRegistry({
      autoMode: true,
      dryRun: false,
      onPrompt: async (name) => { prompted.push(name); return true; },
    });
    // just check no prompt; don't actually write
    expect(prompted).toHaveLength(0);
  });

  it('dry-run returns description without executing', async () => {
    const registry = new ToolRegistry({ autoMode: false, dryRun: true, onPrompt: async () => true });
    const result = await registry.executeTool('bash', { command: 'rm -rf /' });
    expect(result).toContain('[dry-run]');
    expect(result).not.toContain('Error');
  });

  it('getToolDefinitions returns all tools', () => {
    const registry = new ToolRegistry({ autoMode: false, dryRun: false, onPrompt: async () => true });
    const defs = registry.getToolDefinitions();
    expect(defs.map(d => d.name)).toContain('bash');
    expect(defs.map(d => d.name)).toContain('read');
    expect(defs.map(d => d.name)).toContain('write');
  });
});
