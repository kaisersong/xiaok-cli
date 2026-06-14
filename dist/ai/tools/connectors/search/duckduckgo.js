import { SearchProviderError } from './types.js';
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
export function createDuckDuckGoSearchProvider(options = {}) {
    const fetchFn = options.fetchFn ?? fetch;
    return {
        name: 'web_search.duckduckgo',
        displayName: 'DuckDuckGo',
        async search(input) {
            const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(input.query)}`;
            let response;
            try {
                response = await fetchFn(url, {
                    signal: input.signal,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                    },
                });
            }
            catch (error) {
                throw new SearchProviderError(toMessage(error), { kind: 'network' });
            }
            if (!response.ok) {
                throw new SearchProviderError(`${response.status} ${response.statusText}`.trim(), {
                    kind: 'http',
                    status: response.status,
                });
            }
            const html = await response.text();
            const results = parseDuckDuckGoResults(html).slice(0, Math.max(1, input.count));
            return results;
        },
    };
}
function toMessage(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
