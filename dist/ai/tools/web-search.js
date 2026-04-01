import { truncateText } from './truncation.js';
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
function normalizeSearchError(error) {
    const raw = error instanceof Error ? error.message : String(error);
    const status = raw.match(/\b([45]\d{2})\b/)?.[1];
    const stripped = decodeHtml(stripHtml(raw)).replace(/^Error:\s*/i, '').trim();
    const looksLikeHtml = /<!doctype html>|<html\b|<body\b|<head\b/i.test(raw);
    const summary = status
        ? `搜索请求失败 (${status})`
        : '搜索请求失败';
    if (looksLikeHtml) {
        return `Error: ${summary}`;
    }
    if (stripped.length === 0) {
        return `Error: ${summary}`;
    }
    return `Error: ${summary}: ${stripped}`;
}
function parseDuckDuckGoResults(html) {
    const results = [];
    const regex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>|<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>)([\s\S]*?)<\/(?:a|div)>/gi;
    for (const match of html.matchAll(regex)) {
        const [, url, title, snippet] = match;
        results.push({
            title: decodeHtml(title.replace(/<[^>]+>/g, ' ')),
            url: decodeHtml(url),
            snippet: decodeHtml(snippet.replace(/<[^>]+>/g, ' ')),
        });
    }
    return results;
}
export function createWebSearchTool(options = {}) {
    const fetchFn = options.fetchFn ?? fetch;
    return {
        permission: 'safe',
        definition: {
            name: 'web_search',
            description: '执行网页搜索并返回标题、链接和摘要',
            inputSchema: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: '搜索关键词' },
                    count: { type: 'number', description: '返回结果数量（默认 5）' },
                    max_chars: { type: 'number', description: '输出字符上限（默认 12000）' },
                },
                required: ['query'],
            },
        },
        async execute(input) {
            const { query, count = 5, max_chars = 12_000 } = input;
            try {
                const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
                const response = await fetchFn(url);
                if (!response.ok) {
                    return `Error: 搜索请求失败 (${response.status} ${response.statusText})`;
                }
                const html = await response.text();
                const results = parseDuckDuckGoResults(html).slice(0, Math.max(1, count));
                if (results.length === 0) {
                    return '（无搜索结果）';
                }
                const formatted = results.map((result, index) => {
                    return `${index + 1}. ${result.title}\nURL: ${result.url}\nSnippet: ${result.snippet}`;
                }).join('\n\n');
                return truncateText(formatted, max_chars).text;
            }
            catch (error) {
                return normalizeSearchError(error);
            }
        },
    };
}
export const webSearchTool = createWebSearchTool();
