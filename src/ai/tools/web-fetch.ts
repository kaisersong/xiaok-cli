import type { Tool } from '../../types.js';
import { truncateText } from './truncation.js';
import { ConnectorRegistry } from './connectors/registry.js';
import { cloneDefaultConnectorsConfig, resolveCliConnectorsConfig } from './connectors/config.js';
import type { FetchProvider } from './connectors/fetch/types.js';
import { createBasicFetchProvider } from './connectors/fetch/basic.js';

export interface WebFetchOptions {
  /** Legacy fetch override; kept so the existing tests keep working. */
  fetchFn?: typeof fetch;
  registry?: ConnectorRegistry;
  resolveProvider?: () => FetchProvider;
}

export function createWebFetchTool(options: WebFetchOptions = {}): Tool {
  if (options.registry) return buildRegistryTool(options.registry);
  if (options.resolveProvider) return buildResolverTool(options.resolveProvider);
  return buildLegacyTool(options.fetchFn);
}

function buildRegistryTool(registry: ConnectorRegistry): Tool {
  return {
    permission: 'safe',
    definition: FETCH_DEFINITION,
    async execute(input) {
      const { url, max_chars } = normalizeInput(input);
      try {
        const outcome = await registry.runFetch({ url, maxChars: max_chars });
        const truncated = truncateText(outcome.result.content, max_chars);
        const lines = [`URL: ${outcome.result.url}`, `Content-Type: ${outcome.result.contentType}`, '', truncated.text];
        if (outcome.fallback) {
          lines.push(`(fallback: ${outcome.fallback.to} after ${outcome.fallback.from} error: ${outcome.fallback.reason})`);
        }
        return lines.join('\n');
      } catch (error) {
        return `Error: ${formatErrorMessage(error)}`;
      }
    },
  };
}

function buildResolverTool(resolve: () => FetchProvider): Tool {
  return {
    permission: 'safe',
    definition: FETCH_DEFINITION,
    async execute(input) {
      const { url, max_chars } = normalizeInput(input);
      try {
        const provider = resolve();
        const result = await provider.fetch({ url, maxChars: max_chars });
        const truncated = truncateText(result.content, max_chars);
        return [`URL: ${result.url}`, `Content-Type: ${result.contentType}`, '', truncated.text].join('\n');
      } catch (error) {
        return `Error: ${formatErrorMessage(error)}`;
      }
    },
  };
}

function buildLegacyTool(fetchFn?: typeof fetch): Tool {
  // Match the legacy tool's shape: status text on HTTP errors comes from Response,
  // not from the Basic provider's wrapped error message.
  const fn = fetchFn ?? fetch;
  return {
    permission: 'safe',
    definition: FETCH_DEFINITION,
    async execute(input) {
      const { url, max_chars } = normalizeInput(input);
      try {
        const response = await fn(url);
        if (!response.ok) {
          return `Error: 请求失败 (${response.status} ${response.statusText})`;
        }
        const provider = createBasicFetchProvider({
          fetchFn: async () => response,
        });
        const result = await provider.fetch({ url, maxChars: max_chars });
        const truncated = truncateText(result.content, max_chars);
        return [`URL: ${url}`, `Content-Type: ${result.contentType}`, '', truncated.text].join('\n');
      } catch (error) {
        return `Error: ${String(error)}`;
      }
    },
  };
}

function normalizeInput(input: Record<string, unknown>): { url: string; max_chars: number } {
  const url = typeof input.url === 'string' ? input.url : '';
  const maxRaw = typeof input.max_chars === 'number' ? input.max_chars : 12_000;
  return {
    url,
    max_chars: Math.max(1, Math.floor(maxRaw)),
  };
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

const FETCH_DEFINITION = {
  name: 'web_fetch',
  description: '抓取网页或文本内容，并返回适合模型阅读的纯文本摘要',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '要抓取的 URL' },
      max_chars: { type: 'number', description: '输出字符上限（默认 12000）' },
    },
    required: ['url'],
  },
} as const;

const defaultCliRegistry = new ConnectorRegistry(
  resolveCliConnectorsConfig(cloneDefaultConnectorsConfig()),
);

export const webFetchTool: Tool = createWebFetchTool({ registry: defaultCliRegistry });
