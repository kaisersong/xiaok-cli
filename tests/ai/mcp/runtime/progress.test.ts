import { describe, expect, it, vi } from 'vitest';
import { buildMcpRuntimeTools } from '../../../../src/ai/mcp/runtime/tools.js';

describe('MCP runtime activity forwarding', () => {
  it('opts into per-call progress and forwards it to the existing activity sink', async () => {
    const progress = vi.fn();
    const tools = buildMcpRuntimeTools({ name: 'render', command: '' }, {
      listTools: async () => [], dispose() {},
      callTool: async (_name, _input, options) => { options?.onProgress?.(); return 'done'; },
    }, [{ name: 'render', inputSchema: { type: 'object' } }]);
    await expect(tools[0]!.execute({}, { executionProgress: { progress, wait() {}, resume() {} } } as any)).resolves.toBe('done');
    expect(progress).toHaveBeenCalledOnce();
  });
});
