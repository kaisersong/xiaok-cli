import type { McpToolSchema } from '../client.js';

export interface McpRuntimeRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpRuntimeResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { message: string };
}

export interface McpRuntimeTransport {
  send(message: McpRuntimeRequest): Promise<McpRuntimeResponse>;
  notify?(message: { jsonrpc: '2.0'; method: string; params?: Record<string, unknown> }): void;
}

export function createMcpRuntimeClient(transport: McpRuntimeTransport) {
  let nextId = 1;

  async function request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const response = await transport.send({
      jsonrpc: '2.0',
      id: nextId++,
      method,
      params,
    });
    if (response.error) {
      throw new Error(response.error.message);
    }
    return response.result;
  }

  return {
    async initialize(): Promise<unknown> {
      const result = await request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'xiaok-desktop', version: '1.0.0' },
      });
      transport.notify?.({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
      return result;
    },

    async listTools(): Promise<McpToolSchema[]> {
      const result = await request('tools/list', {}) as { tools?: McpToolSchema[] };
      return result.tools ?? [];
    },

    async callTool(name: string, input: Record<string, unknown>): Promise<string> {
      const result = await request('tools/call', { name, arguments: input }) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const text = result.content?.find((entry) => entry.type === 'text')?.text;
      return text ?? '';
    },
  };
}
