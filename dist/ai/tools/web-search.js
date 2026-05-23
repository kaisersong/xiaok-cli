import { truncateText } from './truncation.js';
import { ConnectorRegistry } from './connectors/registry.js';
import { cloneDefaultConnectorsConfig, resolveCliConnectorsConfig } from './connectors/config.js';
import { createDuckDuckGoSearchProvider } from './connectors/search/duckduckgo.js';
function stripHtml(text) {
    return text
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function decodeHtml(text) {
    return text
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&#39;/gi, "'")
        .replace(/&quot;/gi, '"')
        .replace(/\s+/g, ' ')
        .trim();
}
function normalizeProviderErrorMessage(error) {
    const raw = error instanceof Error ? error.message : String(error);
    const status = raw.match(/\b([45]\d{2})\b/)?.[1];
    const stripped = decodeHtml(stripHtml(raw)).replace(/^Error:\s*/i, '').trim();
    const looksLikeHtml = /<!doctype html>|<html\b|<body\b|<head\b/i.test(raw);
    const summary = status ? `搜索请求失败 (${status})` : '搜索请求失败';
    if (looksLikeHtml)
        return `Error: ${summary}`;
    if (stripped.length === 0)
        return `Error: ${summary}`;
    return `Error: ${summary}: ${stripped}`;
}
function formatHits(hits, maxChars) {
    if (hits.length === 0)
        return '（无搜索结果）';
    const lines = hits.map((hit, index) => {
        return `${index + 1}. ${hit.title}\nURL: ${hit.url}\nSnippet: ${hit.snippet}`;
    });
    return truncateText(lines.join('\n\n'), maxChars).text;
}
export function createWebSearchTool(options = {}) {
    // Mode A (legacy): caller supplied just a fetchFn → behave exactly like the
    // pre-provider tool, talking to DuckDuckGo. This preserves the existing
    // tests verbatim (mocked fetch → DuckDuckGo HTML response).
    // Mode B: caller supplied a registry → use it (config-driven, with fallback).
    // Mode C: caller supplied resolveProvider → use it directly without fallback.
    if (options.registry) {
        return buildRegistryTool(options.registry);
    }
    if (options.resolveProvider) {
        return buildResolverTool(options.resolveProvider);
    }
    return buildLegacyTool(options.fetchFn);
}
function buildRegistryTool(registry) {
    return {
        permission: 'safe',
        definition: SEARCH_DEFINITION,
        async execute(input) {
            const { query, count, max_chars } = normalizeInput(input);
            try {
                const outcome = await registry.runSearch({ query, count });
                const text = formatHits(outcome.hits, max_chars);
                if (outcome.fallback) {
                    const tag = `(fallback: ${outcome.fallback.to} after ${outcome.fallback.from} error: ${outcome.fallback.reason})`;
                    return `${text}\n${tag}`;
                }
                return text;
            }
            catch (error) {
                return normalizeProviderErrorMessage(error);
            }
        },
    };
}
function buildResolverTool(resolve) {
    return {
        permission: 'safe',
        definition: SEARCH_DEFINITION,
        async execute(input) {
            const { query, count, max_chars } = normalizeInput(input);
            try {
                const provider = resolve();
                const hits = await provider.search({ query, count });
                return formatHits(hits, max_chars);
            }
            catch (error) {
                return normalizeProviderErrorMessage(error);
            }
        },
    };
}
function buildLegacyTool(fetchFn) {
    const provider = createDuckDuckGoSearchProvider({ fetchFn });
    return {
        permission: 'safe',
        definition: SEARCH_DEFINITION,
        async execute(input) {
            const { query, count, max_chars } = normalizeInput(input);
            try {
                const hits = await provider.search({ query, count });
                return formatHits(hits, max_chars);
            }
            catch (error) {
                return normalizeProviderErrorMessage(error);
            }
        },
    };
}
function normalizeInput(input) {
    const query = typeof input.query === 'string' ? input.query : '';
    const countRaw = typeof input.count === 'number' ? input.count : 5;
    const maxRaw = typeof input.max_chars === 'number' ? input.max_chars : 12_000;
    return {
        query,
        count: Math.max(1, Math.min(10, Math.floor(countRaw))),
        max_chars: Math.max(200, Math.floor(maxRaw)),
    };
}
const SEARCH_DEFINITION = {
    name: 'web_search',
    description: '执行网页搜索并返回标题、链接和摘要',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: '搜索关键词' },
            count: { type: 'number', description: '返回结果数量（默认 5，最大 10）' },
            max_chars: { type: 'number', description: '输出字符上限（默认 12000）' },
        },
        required: ['query'],
    },
};
// Default singleton: CLI uses env-based config so users can set
// XIAOK_SEARCH_PROVIDER / TAVILY_API_KEY / BRAVE_API_KEY without touching code.
// Desktop main process should construct its own ConnectorRegistry from the
// encrypted store and pass it via createWebSearchTool({ registry }).
const defaultCliRegistry = new ConnectorRegistry(resolveCliConnectorsConfig(cloneDefaultConnectorsConfig()));
export const webSearchTool = createWebSearchTool({ registry: defaultCliRegistry });
