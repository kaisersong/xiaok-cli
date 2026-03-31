import { describe, expect, it } from 'vitest';
import { createMcpRuntimeClient } from '../../../../src/ai/mcp/runtime/client.js';

describe('mcp runtime client', () => {
  it('initializes, lists tools, and calls a tool through the transport', async () => {
    const requests: Array<{ method: string; params?: unknown }> = [];
    const client = createMcpRuntimeClient({
      send: async (message) => {
        requests.push({ method: message.method, params: message.params });
        if (message.method === 'initialize') {
          return { jsonrpc: '2.0', id: message.id, result: { serverInfo: { name: 'docs' } } };
        }
        if (message.method === 'tools/list') {
          return {
            jsonrpc: '2.0',
            id: message.id,
            result: { tools: [{ name: 'search', description: 'docs search', inputSchema: { type: 'object' } }] },
          };
        }
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: { content: [{ type: 'text', text: 'ok' }] },
        };
      },
    });

    await client.initialize();
    const tools = await client.listTools();
    const result = await client.callTool('search', { q: 'prompt cache' });

    expect(requests.map((entry) => entry.method)).toEqual(['initialize', 'tools/list', 'tools/call']);
    expect(tools[0].name).toBe('search');
    expect(result).toBe('ok');
  });
});
