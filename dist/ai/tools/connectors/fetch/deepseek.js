import { FetchProviderError } from './types.js';
/**
 * 同 search 侧：构造期拒绝含空白/换行的 key（Node 头校验错误会携带完整
 * `Bearer <key>`，经 IPC/错误路径外泄），错误文本固定不回显；错误消息统一脱敏。
 * 只看字符类，无长度启发式。
 */
function isValidDeepseekKey(apiKey) {
    return /^[\x21-\x7e]+$/.test(apiKey);
}
function redact(message, apiKey) {
    return message.split(apiKey).join('[redacted]');
}
const INVALID_KEY_MESSAGE = 'invalid deepseek api key format';
export function createDeepSeekFetchProvider(options) {
    const apiKey = options.apiKey;
    if (!isValidDeepseekKey(apiKey)) {
        throw new FetchProviderError(INVALID_KEY_MESSAGE, { kind: 'auth' });
    }
    const endpoint = options.endpoint ?? 'https://api.deepseek.com/v1/tools/fetch';
    const fetchFn = options.fetchFn ?? fetch;
    const toMessage = (error) => error instanceof Error ? redact(error.message, apiKey) : redact(String(error), apiKey);
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
                        authorization: `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify({ url: input.url }),
                    signal: input.signal,
                });
            }
            catch (error) {
                throw new FetchProviderError(toMessage(error), { kind: 'network' });
            }
            if (response.status === 401) {
                throw new FetchProviderError(`${response.status} invalid api key`, {
                    kind: 'auth',
                    status: response.status,
                });
            }
            if (response.status === 403) {
                // 官方 guides/search #errors：403 = Fetch 请求被安全策略拒绝，
                // 不是凭证故障；标 auth 会误导用户更换有效 key。
                throw new FetchProviderError('403 rejected by security policy', {
                    kind: 'http',
                    status: 403,
                });
            }
            if (response.status === 429) {
                throw new FetchProviderError('429 rate limited', { kind: 'rate_limit', status: 429 });
            }
            if (!response.ok) {
                throw new FetchProviderError(redact(`${response.status} ${response.statusText}`.trim(), apiKey), {
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
// (module-level toMessage removed: the closure-scoped toMessage inside
//  createDeepSeekFetchProvider redacts the api key from error messages.)
