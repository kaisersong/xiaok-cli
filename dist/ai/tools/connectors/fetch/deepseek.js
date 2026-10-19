import { FetchProviderError } from './types.js';
export function createDeepSeekFetchProvider(options) {
    if (!options.apiKey) {
        throw new FetchProviderError('missing deepseek api key', { kind: 'auth' });
    }
    const endpoint = options.endpoint ?? 'https://api.deepseek.com/v1/tools/fetch';
    const fetchFn = options.fetchFn ?? fetch;
    return {
        name: 'web_fetch.deepseek',
        displayName: 'DeepSeek',
        async fetch(input) {
            let response;
            try {
                response = await fetchFn(endpoint, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        accept: 'application/json',
                        authorization: `Bearer ${options.apiKey}`,
                    },
                    body: JSON.stringify({ url: input.url }),
                    signal: input.signal,
                });
            }
            catch (error) {
                throw new FetchProviderError(toMessage(error), { kind: 'network' });
            }
            if (response.status === 401 || response.status === 403) {
                throw new FetchProviderError(`${response.status} unauthorized`, {
                    kind: 'auth',
                    status: response.status,
                });
            }
            if (response.status === 429) {
                throw new FetchProviderError('429 rate limited', { kind: 'rate_limit', status: 429 });
            }
            if (!response.ok) {
                throw new FetchProviderError(`${response.status} ${response.statusText}`.trim(), {
                    kind: 'http',
                    status: response.status,
                });
            }
            let parsed;
            try {
                parsed = (await response.json());
            }
            catch (error) {
                throw new FetchProviderError(`invalid json: ${toMessage(error)}`, { kind: 'parse' });
            }
            const content = typeof parsed.content === 'string' && parsed.content.trim()
                ? parsed.content.trim()
                : '';
            if (!content) {
                // 官方语义：无可用 Markdown 正文即不可用；不返回空内容伪装成功。
                throw new FetchProviderError('no extractable content', { kind: 'parse' });
            }
            const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
            return {
                url: input.url,
                contentType: 'text/markdown',
                // 不截断——web_fetch 工具入口负责按 max_chars 截断（与 jina/basic 一致）。
                content: title ? `# ${title}\n\n${content}` : content,
                source: 'web_fetch.deepseek',
            };
        },
    };
}
function toMessage(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
