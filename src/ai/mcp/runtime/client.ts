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

export interface McpRuntimeToolImage {
  mimeType: string;
  data?: string;
  filePath?: string;
  description?: string;
}

export interface McpRuntimeToolResult {
  text: string;
  images: McpRuntimeToolImage[];
  structuredContent?: unknown;
  isError: boolean;
  summary: string;
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

    async callToolResult(name: string, input: Record<string, unknown>): Promise<McpRuntimeToolResult> {
      const result = await request('tools/call', { name, arguments: input });
      return normalizeMcpRuntimeToolResult(result);
    },

    async callTool(name: string, input: Record<string, unknown>): Promise<string> {
      const result = await request('tools/call', { name, arguments: input });
      return normalizeMcpRuntimeToolResult(result).text;
    },
  };
}

export function normalizeMcpRuntimeToolResult(result: unknown): McpRuntimeToolResult {
  const value = isRecord(result) ? result : {};
  const content = Array.isArray(value.content) ? value.content : [];
  const textParts: string[] = [];
  const images: McpRuntimeToolImage[] = [];

  for (const entry of content) {
    if (!isRecord(entry)) continue;
    if (entry.type === 'text' && typeof entry.text === 'string') {
      textParts.push(entry.text);
      continue;
    }
    if (entry.type === 'image') {
      const mimeType = typeof entry.mimeType === 'string'
        ? entry.mimeType
        : typeof entry.mime_type === 'string'
          ? entry.mime_type
          : 'image/png';
      images.push({
        mimeType,
        ...(typeof entry.data === 'string' ? { data: entry.data } : {}),
        ...(typeof entry.filePath === 'string' ? { filePath: entry.filePath } : {}),
        ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
      });
    }
  }

  const text = textParts.join('\n');
  return {
    text,
    images,
    ...(Object.prototype.hasOwnProperty.call(value, 'structuredContent')
      ? { structuredContent: value.structuredContent }
      : {}),
    isError: value.isError === true,
    summary: text || (images.length > 0 ? `[${images.length} image${images.length === 1 ? '' : 's'}]` : ''),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
