import type { Tool } from '../../types.js';
import { truncateText } from './truncation.js';

export interface WebSearchOptions {
  fetchFn?: typeof fetch;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function decodeHtml(text: string): string {
  return text
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDuckDuckGoResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
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

export function createWebSearchTool(options: WebSearchOptions = {}): Tool {
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
      const { query, count = 5, max_chars = 12_000 } = input as {
        query: string;
        count?: number;
        max_chars?: number;
      };

      try {
        const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const response = await fetchFn(url);
        if (!response.ok) {
          return `Error: 搜索失败 (${response.status} ${response.statusText})`;
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
      } catch (error) {
        return `Error: ${String(error)}`;
      }
    },
  };
}

export const webSearchTool = createWebSearchTool();
