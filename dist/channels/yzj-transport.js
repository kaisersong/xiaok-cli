export class YZJTransportError extends Error {
    status;
    retryable;
    constructor(message, status, retryable) {
        super(message);
        this.status = status;
        this.retryable = retryable;
        this.name = 'YZJTransportError';
    }
}
function classifyHttpError(status, body) {
    switch (status) {
        case 401:
            return new YZJTransportError(`认证失败 (401): token 无效或已过期，请检查 webhookUrl 配置。${body}`, 401, false);
        case 403:
            return new YZJTransportError(`权限不足 (403): 当前应用无此 API 调用权限。${body}`, 403, false);
        case 429:
            return new YZJTransportError(`请求频率超限 (429): 请稍后重试。${body}`, 429, true);
        default:
            if (status >= 500) {
                return new YZJTransportError(`服务端错误 (${status}): ${body}`, status, true);
            }
            return new YZJTransportError(`YZJ send failed: HTTP ${status} ${body}`, status, false);
    }
}
async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export class YZJTransport {
    options;
    constructor(options) {
        this.options = options;
    }
    async deliver(message) {
        await this.deliverWithMetrics(message);
    }
    async deliverWithMetrics(message) {
        if (message.channel !== 'yzj') {
            throw new Error(`YZJ transport cannot deliver channel ${message.channel}`);
        }
        const maxRetries = this.options.maxRetries ?? 3;
        const startAt = Date.now();
        const operatorName = typeof message.target.metadata?.operatorName === 'string'
            ? message.target.metadata.operatorName
            : '';
        const replySummary = typeof message.target.metadata?.replySummary === 'string'
            ? message.target.metadata.replySummary
            : '';
        const chunks = splitText(message.text, this.options.chunkLimit ?? 20_000);
        for (let index = 0; index < chunks.length; index += 1) {
            const chunk = chunks[index];
            const payload = {
                msgtype: 2,
                content: chunk,
                notifyParams: [],
            };
            if (message.target.userId) {
                payload.notifyParams.push({
                    type: 'openIds',
                    values: [message.target.userId],
                });
            }
            if (message.target.messageId) {
                payload.param = {
                    replyMsgId: message.target.messageId,
                    replyTitle: '',
                    isReference: true,
                    replySummary,
                    replyPersonName: operatorName,
                };
                payload.paramType = 3;
            }
            const chunkStartedAt = Date.now();
            let lastError;
            for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
                const response = await fetch(this.options.webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                if (response.ok) {
                    lastError = undefined;
                    break;
                }
                const body = await response.text();
                lastError = classifyHttpError(response.status, body);
                if (!lastError.retryable || attempt >= maxRetries) {
                    throw lastError;
                }
                const delayMs = Math.min(1000 * 2 ** attempt, 16000);
                this.options.logger?.info?.(`[yzj] retryable error ${response.status}, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);
                await sleep(delayMs);
            }
            this.options.logger?.info?.(`[yzj] outbound delivered chunk ${index + 1}/${chunks.length} chars=${chunk.length} in ${Date.now() - chunkStartedAt}ms`);
        }
        return {
            chunks: chunks.length,
            durationMs: Date.now() - startAt,
        };
    }
}
function splitText(text, limit) {
    if (text.length <= limit)
        return [text];
    const chunks = [];
    let remaining = text;
    while (remaining.length > limit) {
        const slice = remaining.slice(0, limit);
        const breakIndex = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'));
        const chunkEnd = breakIndex >= Math.floor(limit * 0.4) ? breakIndex + (slice[breakIndex] === '\n' && slice[breakIndex + 1] === '\n' ? 2 : 1) : limit;
        chunks.push(remaining.slice(0, chunkEnd).trimEnd());
        remaining = remaining.slice(chunkEnd).trimStart();
    }
    if (remaining)
        chunks.push(remaining);
    return chunks.filter(Boolean);
}
