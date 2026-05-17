const STREAM_TIMEOUT_MS = 5 * 60_000;
const MAX_RETRIES = 2;
function isRetryableError(error) {
    if (error instanceof Error) {
        if (error.name === 'AbortError' || error.name === 'TimeoutError')
            return true;
        if (/ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(error.message))
            return true;
    }
    return false;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export class OpenAIResponsesAdapter {
    apiKey;
    baseUrl;
    defaultHeaders;
    model;
    constructor(apiKey, model = 'gpt-4.1', baseUrl, defaultHeaders) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
        this.defaultHeaders = defaultHeaders;
        this.model = model;
    }
    getModelName() {
        return this.model;
    }
    cloneWithModel(model) {
        return new OpenAIResponsesAdapter(this.apiKey, model, this.baseUrl, this.defaultHeaders);
    }
    async *stream(messages, tools, systemPrompt) {
        let attempt = 0;
        while (true) {
            try {
                yield* this.streamOnce(messages, tools, systemPrompt);
                return;
            }
            catch (error) {
                if (!isRetryableError(error) || attempt >= MAX_RETRIES)
                    throw error;
                const delayMs = Math.min(2000 * 2 ** attempt, 10000);
                await sleep(delayMs);
                attempt++;
            }
        }
    }
    async *streamOnce(messages, tools, systemPrompt) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);
        const endpoint = new URL('responses', ensureTrailingSlash(this.baseUrl)).toString();
        let response;
        try {
            response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    ...(this.defaultHeaders ?? {}),
                },
                body: JSON.stringify({
                    model: this.model,
                    input: buildResponsesInput(messages, systemPrompt),
                    tools: tools.length > 0
                        ? tools.map((tool) => ({
                            type: 'function',
                            name: tool.name,
                            description: tool.description,
                            parameters: tool.inputSchema,
                        }))
                        : undefined,
                }),
                signal: controller.signal,
            });
        }
        catch (error) {
            clearTimeout(timer);
            throw error;
        }
        clearTimeout(timer);
        if (!response.ok) {
            throw new Error(`${response.status} ${await response.text()}`);
        }
        const result = await response.json();
        const textChunks = [];
        for (const item of result.output ?? []) {
            if (item.type === 'message') {
                for (const content of item.content ?? []) {
                    if (content.type === 'output_text' && content.text) {
                        textChunks.push(content.text);
                    }
                }
                continue;
            }
            if (item.type === 'function_call') {
                let input = {};
                try {
                    input = JSON.parse(item.arguments ?? '{}');
                }
                catch {
                    input = { _raw: item.arguments ?? '' };
                }
                yield {
                    type: 'tool_use',
                    id: item.call_id ?? `${item.name ?? 'function'}_call`,
                    name: item.name ?? 'function',
                    input,
                };
            }
        }
        if (textChunks.length > 0) {
            yield { type: 'text', delta: textChunks.join('') };
        }
        yield {
            type: 'usage',
            usage: {
                inputTokens: result.usage?.input_tokens ?? 0,
                outputTokens: result.usage?.output_tokens ?? 0,
            },
        };
        yield { type: 'done' };
    }
}
function ensureTrailingSlash(baseUrl) {
    if (!baseUrl) {
        throw new Error('openai_responses 协议需要配置 baseUrl');
    }
    return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}
function buildResponsesInput(messages, systemPrompt) {
    const items = [
        {
            role: 'system',
            content: [{ type: 'input_text', text: systemPrompt }],
        },
    ];
    for (const message of messages) {
        const content = [];
        for (const block of message.content) {
            if (block.type === 'text') {
                content.push({ type: 'input_text', text: block.text });
                continue;
            }
            if (block.type === 'tool_result') {
                content.push({
                    type: 'input_text',
                    text: block.content,
                });
            }
        }
        if (content.length > 0) {
            items.push({
                role: message.role,
                content,
            });
        }
    }
    return items;
}
