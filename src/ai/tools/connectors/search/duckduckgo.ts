import { SearchProviderError, type SearchHit, type SearchProvider, type SearchRunInput } from './types.js';

// DuckDuckGo HTML scraper. Free fallback. Migrated from the original
// web-search.ts implementation; preserved verbatim for parser stability and
// to keep the existing snapshot-style test working.

export interface DuckDuckGoOptions {
  fetchFn?: typeof fetch;
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

function readAttribute(attributes: string, name: string): string {
  const matches = attributes.matchAll(/([^\s=]+)\s*=\s*(["'])(.*?)\2/g);
  for (const match of matches) if (match[1].toLowerCase() === name) return decodeHtml(match[3]);
  return '';
}

function normalizeResultUrl(raw: string): string | null {
  try {
    let url = new URL(raw, 'https://duckduckgo.com');
    if ((url.hostname === 'duckduckgo.com' || url.hostname.endsWith('.duckduckgo.com')) && url.pathname === '/l/') {
      const target = url.searchParams.get('uddg');
      if (!target) return null;
      url = new URL(target);
    }
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch { return null; }
}

function parseDuckDuckGoResults(html: string): SearchHit[] {
  const results: SearchHit[] = [];
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  for (const anchor of anchors) {
    if (!readAttribute(anchor[1], 'class').split(/\s+/).includes('result__a')) continue;
    const url = normalizeResultUrl(readAttribute(anchor[1], 'href'));
    if (!url) continue;
    const tail = html.slice((anchor.index ?? 0) + anchor[0].length);
    const snippet = tail.match(/<(?:a|div)\b([^>]*)>([\s\S]*?)<\/(?:a|div)>/gi)?.find(block => /class\s*=\s*["'][^"']*result__snippet/.test(block));
    const content = snippet?.replace(/^<[^>]+>|<\/[^>]+>$/g, '') || '';
    results.push({title:decodeHtml(anchor[2].replace(/<[^>]+>/g,' ')),url,snippet:decodeHtml(content.replace(/<[^>]+>/g,' '))});
  }
  return results;
}

export function createDuckDuckGoSearchProvider(options: DuckDuckGoOptions = {}): SearchProvider {
  const fetchFn = options.fetchFn ?? fetch;
  return {
    name: 'web_search.duckduckgo',
    displayName: 'DuckDuckGo',
    async search(input: SearchRunInput): Promise<SearchHit[]> {
      const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(input.query)}`;
      let response: Response;
      try {
        response = await fetchFn(url, {
          signal: input.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });
      } catch (error) {
        throw new SearchProviderError(toMessage(error), { kind: 'network' });
      }
      if (!response.ok) {
        throw new SearchProviderError(`${response.status} ${response.statusText}`.trim(), {
          kind: 'http',
          status: response.status,
        });
      }
      const html = await response.text();
      if (/<form\b[^>]*(?:id=["'](?:challenge|img)-form|action=["'][^"']*anomaly\.js)|class=["'][^"']*anomaly-modal/i.test(html)) {
        throw new SearchProviderError('DuckDuckGo bot challenge; search results unavailable', {kind:'rate_limit'});
      }
      const results = parseDuckDuckGoResults(html).slice(0, Math.max(1, input.count));
      return results;
    },
  };
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
