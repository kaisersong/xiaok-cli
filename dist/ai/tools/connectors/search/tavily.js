import { SearchProviderError } from './types.js';
export function createTavilySearchProvider(options) {
    if (!options.apiKey) {
        // Surface as auth so the registry can mark runtime_state = invalid_config
        throw new SearchProviderError('missing tavily api key', { kind: 'auth' });
    }
    const endpoint = options.endpoint ?? 'https://api.tavily.com/search';
    const fetchFn = options.fetchFn ?? fetch;
    return {
        name: 'web_search.tavily',
        displayName: 'Tavily',
        async search(input) {
            const body = JSON.stringify({
                api_key: options.apiKey,
                query: input.query,
                max_results: Math.max(1, Math.min(10, input.count)),
                include_answer: false,
                include_raw_content: false,
            });
            let response;
            try {
                response = await fetchFn(endpoint, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', accept: 'application/json' },
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
            const rawResults = Array.isArray(parsed.results)
                ? parsed.results
                : [];
            const hits = [];
            for (const item of rawResults.slice(0, Math.max(1, input.count))) {
                const url = typeof item.url === 'string' ? item.url : '';
                if (!url)
                    continue;
                hits.push({
                    title: typeof item.title === 'string' ? item.title : url,
                    url,
                    snippet: pickString(item.content) ?? pickString(item.snippet) ?? '',
                    publishedAt: pickString(item.published_date),
                    score: typeof item.score === 'number' ? item.score : undefined,
                });
            }
            return hits;
        },
    };
}
function pickString(value) {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
}
function toMessage(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
