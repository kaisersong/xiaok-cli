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
      return request('initialize', {});
    },

    async listTools(): Promise<McpToolSchema[]> {
      const result = await request('tools/list', {}) as { tools?: McpToolSchema[] };
      return result.tools ?? [];
    },

    async callTool(name: string, input: Record<string, unknown>): Promise<string> {
      const result = await request('tools/call', { name, input }) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const text = result.content?.find((entry) => entry.type === 'text')?.text;
      return text ?? '';
    },
  };
}
