import { SearchProviderError } from './types.js';
/**
 * DeepSeek key 校验只看字符类：必须是连续可见 ASCII（无空白/换行/控制字符）。
 * 含 CRLF 的 key 会让 Node 的请求头校验错误消息带上完整 `Bearer <key>` 原文，
 * 并落入 IPC/会话上下文（评审 BLOCK #1）；构造期直接拒绝，错误文本固定、
 * 永不回显 key。不设长度启发式，避免误伤合法但更短/更长的 key 格式。
 */
function isValidDeepseekKey(apiKey) {
    return /^[\x21-\x7e]+$/.test(apiKey);
}
/** 错误文本统一脱敏：key 子串任何出现位置替换为 [redacted]（split/join 免正则转义）。 */
function redact(message, apiKey) {
    return message.split(apiKey).join('[redacted]');
}
const INVALID_KEY_MESSAGE = 'invalid deepseek api key format';
export function createDeepSeekSearchProvider(options) {
    const apiKey = options.apiKey;
    if (!isValidDeepseekKey(apiKey)) {
        // Surface as auth so the registry can mark runtime_state = invalid_config
        throw new SearchProviderError(INVALID_KEY_MESSAGE, { kind: 'auth' });
    }
    const endpoint = options.endpoint ?? 'https://api.deepseek.com/v1/tools/search';
    const fetchFn = options.fetchFn ?? fetch;
    const toMessage = (error) => error instanceof Error ? redact(error.message, apiKey) : redact(String(error), apiKey);
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
            if (response.status === 401) {
                throw new SearchProviderError(`${response.status} invalid api key`, {
                    kind: 'auth',
                    status: response.status,
                });
            }
            if (response.status === 403) {
                // 官方 guides/search #errors：403 = 安全策略拒绝（非凭证故障），
                // 标成 auth 会误导用户更换有效 key。
                throw new SearchProviderError('403 rejected by security policy', {
                    kind: 'http',
                    status: 403,
                });
            }
            if (response.status === 429) {
                throw new SearchProviderError('429 rate limited', { kind: 'rate_limit', status: 429 });
            }
            if (!response.ok) {
                throw new SearchProviderError(redact(`${response.status} ${response.statusText}`.trim(), apiKey), {
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
            // 200 但结构异常（{} / {error:{...}} / results 非数组）不等于“无命中”；
            // 无命中是唯一的合法空结果（官方 billing：Search 必须返回非空数组才计费）。
            if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.results)) {
                throw new SearchProviderError('unexpected search response shape', { kind: 'parse' });
            }
            const rawResults = parsed.results;
            const hits = [];
            for (const item of rawResults.slice(0, Math.max(1, input.count))) {
                if (!item || typeof item !== 'object')
                    continue;
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
