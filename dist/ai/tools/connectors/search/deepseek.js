import { SearchProviderError } from './types.js';
export function createDeepSeekSearchProvider(options) {
    if (!options.apiKey) {
        // Surface as auth so the registry can mark runtime_state = invalid_config
        throw new SearchProviderError('missing deepseek api key', { kind: 'auth' });
    }
    const endpoint = options.endpoint ?? 'https://api.deepseek.com/v1/tools/search';
    const fetchFn = options.fetchFn ?? fetch;
    return {
        name: 'web_search.deepseek',
        displayName: 'DeepSeek',
        async search(input) {
            const body = JSON.stringify({
                query: input.query,
                // DeepSeek 允许 1-50；输入侧 count 已被工具夹到 ≤10，这里再夹一次防御性。
                count: Math.max(1, Math.min(50, input.count)),
                // summary/snippet 已足够；need_content 会显著放大回包，默认关。
                need_content: false,
            });
            let response;
            try {
                response = await fetchFn(endpoint, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        accept: 'application/json',
                        authorization: `Bearer ${options.apiKey}`,
                    },
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
                    // snippet 面向 UI 展示（100-200 字），summary 面向模型（600-800 字）；
                    // 工具回包进入模型上下文，因此优先 summary。
                    snippet: pickString(item.summary) ?? pickString(item.snippet) ?? '',
                    publishedAt: pickString(item.date),
                    score: typeof item.rerank_score === 'number' ? item.rerank_score : undefined,
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
