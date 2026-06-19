import { SearchProviderError } from './types.js';
export function createFirecrawlSearchProvider(options = {}) {
    const endpoint = options.endpoint ?? 'https://api.firecrawl.dev/v2/search';
    const fetchFn = options.fetchFn ?? fetch;
    return {
        name: 'web_search.firecrawl',
        displayName: 'Firecrawl',
        async search(input) {
            const headers = {
                'content-type': 'application/json',
                accept: 'application/json',
            };
            if (options.apiKey) {
                headers.authorization = `Bearer ${options.apiKey}`;
            }
            const body = JSON.stringify({
                query: input.query,
                limit: Math.max(1, Math.min(10, input.count)),
            });
            let response;
            try {
                response = await fetchFn(endpoint, {
                    method: 'POST',
                    headers,
                    body,
                    signal: input.signal,
                });
            }
            catch (error) {
                throw new SearchProviderError(toMessage(error), { kind: 'network' });
            }
            if (response.status === 401 || response.status === 403) {
                throw new SearchProviderError(`${response.status} unauthorized`, {
                    kind: 'auth',
                    status: response.status,
                });
            }
            if (response.status === 429) {
                throw new SearchProviderError('429 rate limited', { kind: 'rate_limit', status: 429 });
            }
            if (!response.ok) {
                throw new SearchProviderError(`${response.status} ${response.statusText}`.trim(), {
                    kind: 'http',
                    status: response.status,
                });
            }
            let parsed;
            try {
                parsed = (await response.json());
            }
            catch (error) {
                throw new SearchProviderError(`invalid json: ${toMessage(error)}`, { kind: 'parse' });
            }
            const webResults = Array.isArray(parsed.data?.web)
                ? parsed.data.web
                : [];
            const hits = [];
            for (const item of webResults.slice(0, Math.max(1, input.count))) {
                const url = typeof item.url === 'string' ? item.url : '';
                if (!url)
                    continue;
                hits.push({
                    title: typeof item.title === 'string' ? item.title : url,
                    url,
                    snippet: typeof item.description === 'string' ? item.description : '',
                });
            }
            return hits;
        },
    };
}
function toMessage(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
