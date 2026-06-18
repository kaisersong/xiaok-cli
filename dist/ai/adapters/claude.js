import { isAbortError } from '../runtime/abort-utils.js';
const MAX_RETRIES = 3;
const STREAM_TIMEOUT_MS = 5 * 60_000; // 5 min per stream call
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 529]);
const KIMI_CODING_COMPAT_USER_AGENT = 'claude-cli/1.0.0 (external, cli)';
function isKimiCodingEndpoint(baseUrl) {
    if (!baseUrl)
        return false;
    try {
        const url = new URL(baseUrl);
        return url.hostname === 'api.kimi.com' && url.pathname.startsWith('/coding');
    }
    catch {
        return false;
    }
}
function buildKimiCompatHeaders() {
    return {
        'User-Agent': KIMI_CODING_COMPAT_USER_AGENT,
        'X-Stainless-Lang': null,
        'X-Stainless-Package-Version': null,
        'X-Stainless-OS': null,
        'X-Stainless-Arch': null,
        'X-Stainless-Runtime': null,
        'X-Stainless-Runtime-Version': null,
        'X-Stainless-Retry-Count': null,
        'X-Stainless-Timeout': null,
    };
}
function isRetryableError(error) {
    if (isAbortError(error))
        return false;
    if (error instanceof Error) {
        const record = error;
        const status = record.status;
        if (typeof status === 'number' && RETRYABLE_STATUS.has(status))
            return true;
        const code = typeof record.code === 'string' ? record.code : '';
        if (/ERR_STREAM_PREMATURE_CLOSE|ECONNRESET|ETIMEDOUT|EPIPE|UND_ERR/i.test(code))
            return true;
        if (/overload|502|503|timeout|ECONNRESET|ETIMEDOUT|EPIPE|Bad gateway|Premature close|terminated|socket hang up|network|fetch failed/i.test(error.message))
            return true;
    }
    return false;
}
async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export class ClaudeAdapter {
    client;
    apiKey;
    baseUrl;
    capabilityOverrides;
    model;
    clientPromise = null;
    constructor(apiKey, model = 'claude-opus-4-6', baseUrl, capabilityOverrides) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
        this.capabilityOverrides = capabilityOverrides;
        this.model = model;
    }
    getModelName() {
        return this.model;
    }
    getCapabilities() {
        return this.capabilityOverrides ?? {};
    }
    cloneWithModel(model) {
        return new ClaudeAdapter(this.apiKey, model, this.baseUrl, this.capabilityOverrides);
    }
    async getClient() {
        if (this.client) {
            return this.client;
        }
        if (!this.clientPromise) {
            this.clientPromise = import('@anthropic-ai/sdk').then(({ default: AnthropicSdk }) => {
                const client = new AnthropicSdk({
                    apiKey: this.apiKey,
                    baseURL: this.baseUrl,
                    maxRetries: MAX_RETRIES,
                    ...(isKimiCodingEndpoint(this.baseUrl)
                        ? { defaultHeaders: buildKimiCompatHeaders() }
                        : {}),
                });
                this.client = client;
                return client;
            });
        }
        return this.clientPromise;
    }
    async *stream(messages, tools, systemPrompt, options) {
        let attempt = 0;
        while (true) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);
            const signal = options?.signal
                ? AbortSignal.any([controller.signal, options.signal])
                : controller.signal;
            let emittedAny = false;
            try {
                for await (const chunk of this.streamOnce(messages, tools, systemPrompt, options, signal)) {
                    emittedAny = true;
                    yield chunk;
                }
                return;
            }
            catch (error) {
                clearTimeout(timer);
                // 一旦本次尝试已产出 chunk（消费端已实时落地/上屏），重试会重复输出，必须放弃重试
                if (emittedAny || !isRetryableError(error) || attempt >= MAX_RETRIES) {
                    throw error;
                }
                const delayMs = Math.min(1000 * 2 ** attempt, 16000);
                await sleep(delayMs);
                attempt += 1;
            }
            finally {
                clearTimeout(timer);
            }
        }
    }
    async *streamOnce(messages, tools, systemPrompt, options, signal) {
        const sourceMessages = options?.promptCache?.messages ?? messages;
        const anthropicMessages = sourceMessages.map((message) => {
            const content = [];
            for (const block of message.content) {
                if (block.type === 'text') {
                    content.push({
                        type: 'text',
                        text: block.text,
                        cache_control: block.cache_control,
                    });
                    continue;
                }
                if (block.type === 'image') {
                    content.push({
                        type: 'image',
                        source: block.source,
                        cache_control: block.cache_control,
                    });
                    continue;
                }
                if (block.type === 'tool_use') {
                    content.push({
                        type: 'tool_use',
                        id: block.id,
                        name: block.name,
                        input: block.input,
                        cache_control: block.cache_control,
                    });
                    continue;
                }
                if (block.type === 'tool_result') {
                    content.push({
                        type: 'tool_result',
                        tool_use_id: block.tool_use_id,
                        content: block.content,
                        is_error: block.is_error,
                        cache_control: block.cache_control,
                    });
                    continue;
                }
            }
            return {
                role: message.role,
                content,
            };
        });
        const sourceTools = options?.promptCache?.tools ?? tools;
        const anthropicTools = sourceTools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema,
            cache_control: t.cache_control,
        }));
        const client = await this.getClient();
        const stream = client.messages.stream({
            model: this.model,
            max_tokens: 8192,
            system: (options?.promptCache?.systemPrompt ?? systemPrompt),
            messages: anthropicMessages,
            tools: anthropicTools.length > 0 ? anthropicTools : undefined,
        }, { signal });
        // Buffer for tool_use arguments
        const toolBuffers = new Map();
        for await (const event of stream) {
            if (event.type === 'message_start') {
                // 输出 usage 信息
                const usage = event.message.usage;
                if (usage) {
                    yield {
                        type: 'usage',
                        usage: {
                            inputTokens: usage.input_tokens ?? 0,
                            outputTokens: usage.output_tokens ?? 0,
                            cacheCreationInputTokens: usage.cache_creation_input_tokens ?? undefined,
                            cacheReadInputTokens: usage.cache_read_input_tokens ?? undefined,
                        },
                    };
                }
            }
            else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
                toolBuffers.set(event.index, {
                    id: event.content_block.id,
                    name: event.content_block.name,
                    jsonBuffer: '',
                });
            }
            else if (event.type === 'content_block_delta') {
                const delta = event.delta;
                if (delta.type === 'text_delta') {
                    yield { type: 'text', delta: delta.text };
                }
                else if (delta.type === 'input_json_delta') {
                    const buf = toolBuffers.get(event.index);
                    if (buf)
                        buf.jsonBuffer += delta.partial_json;
                }
            }
            else if (event.type === 'content_block_stop') {
                const buf = toolBuffers.get(event.index);
                if (buf) {
                    let input = {};
                    try {
                        input = JSON.parse(buf.jsonBuffer || '{}');
                    }
                    catch {
                        input = { _raw: buf.jsonBuffer };
                    }
                    yield { type: 'tool_use', id: buf.id, name: buf.name, input };
                    toolBuffers.delete(event.index);
                }
            }
            else if (event.type === 'message_delta') {
                // 更新 usage 信息
                const usage = event.usage;
                if (usage) {
                    yield {
                        type: 'usage',
                        usage: {
                            inputTokens: 0, // message_delta 只包含 output tokens
                            outputTokens: usage.output_tokens ?? 0,
                        },
                    };
                }
            }
            else if (event.type === 'message_stop') {
                yield { type: 'done' };
            }
        }
    }
}
