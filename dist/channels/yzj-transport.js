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
            const response = await fetch(this.options.sendMsgUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                const body = await response.text();
                throw new Error(`YZJ send failed: HTTP ${response.status} ${body}`);
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
