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

  it('preserves text, image content, structuredContent, and isError in a tool result envelope', async () => {
    const client = createMcpRuntimeClient({
      send: async (message) => ({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          isError: true,
          structuredContent: {
            windows: [{ app: 'Safari', window_id: 'win-1' }],
          },
          content: [
            { type: 'text', text: 'captured Safari' },
            { type: 'image', mimeType: 'image/png', data: 'base64-png' },
          ],
        },
      }),
    });

    const result = await client.callToolResult('capture', { app: 'Safari' });

    expect(result).toEqual({
      text: 'captured Safari',
      images: [{ mimeType: 'image/png', data: 'base64-png' }],
      structuredContent: {
        windows: [{ app: 'Safari', window_id: 'win-1' }],
      },
      isError: true,
      summary: 'captured Safari',
    });
  });
});
