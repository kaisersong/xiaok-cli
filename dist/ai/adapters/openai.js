import OpenAI from 'openai';
import { estimateTokens } from '../runtime/usage.js';
const MAX_RETRIES = 3;
const KIMI_CODING_COMPAT_USER_AGENT = 'claude-code/1.0';
const RAW_THINK_OPEN_TAG = '<think>';
const RAW_THINK_CLOSE_TAG = '</think>';
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
function collectReasoningText(blocks) {
    const reasoning = blocks
        .filter((block) => block.type === 'thinking')
        .map((block) => block.thinking.trim())
        .filter(Boolean)
        .join('\n\n');
    return reasoning || undefined;
}
function extractReasoningDeltas(delta) {
    const chunks = [];
    const reasoningDetails = delta.reasoning_details;
    let usedReasoningDetails = false;
    if (Array.isArray(reasoningDetails)) {
        for (const item of reasoningDetails) {
            const detail = item;
            if (detail.type === 'reasoning.text' && typeof detail.text === 'string' && detail.text.length > 0) {
                chunks.push({ signature: 'reasoning_details', text: detail.text });
                usedReasoningDetails = true;
            }
        }
    }
    if (!usedReasoningDetails) {
        for (const field of ['reasoning_content', 'reasoning', 'reasoning_text']) {
            const value = delta[field];
            if (typeof value === 'string' && value.length > 0) {
                chunks.push({ signature: field, text: value });
                break;
            }
        }
    }
    return chunks;
}
function getTrailingTagPrefixLength(value, tag) {
    const maxLength = Math.min(value.length, tag.length - 1);
    for (let length = maxLength; length > 0; length -= 1) {
        if (tag.startsWith(value.slice(-length))) {
            return length;
        }
    }
    return 0;
}
function drainLeadingRawThinkSegments(state, chunk, force = false) {
    state.buffer += chunk;
    const segments = [];
    while (state.buffer.length > 0) {
        if (!state.active) {
            segments.push({ type: 'text', delta: state.buffer });
            state.buffer = '';
            break;
        }
        if (state.mode === 'inside') {
            const closeIndex = state.buffer.indexOf(RAW_THINK_CLOSE_TAG);
            if (closeIndex >= 0) {
                const reasoning = state.buffer.slice(0, closeIndex);
                if (reasoning.length > 0) {
                    segments.push({ type: 'thinking', delta: reasoning, signature: 'raw_think_tag' });
                }
                state.buffer = state.buffer.slice(closeIndex + RAW_THINK_CLOSE_TAG.length);
                state.mode = 'outside';
                continue;
            }
            if (force) {
                segments.push({ type: 'text', delta: `${RAW_THINK_OPEN_TAG}${state.buffer}` });
                state.buffer = '';
                state.mode = 'outside';
                state.active = false;
                break;
            }
            const carryLength = getTrailingTagPrefixLength(state.buffer, RAW_THINK_CLOSE_TAG);
            const stableReasoning = state.buffer.slice(0, state.buffer.length - carryLength);
            if (stableReasoning.length > 0) {
                segments.push({ type: 'thinking', delta: stableReasoning, signature: 'raw_think_tag' });
                state.buffer = state.buffer.slice(state.buffer.length - carryLength);
            }
            break;
        }
        const leadingWhitespace = state.buffer.match(/^\s+/)?.[0] ?? '';
        if (leadingWhitespace.length > 0) {
            state.buffer = state.buffer.slice(leadingWhitespace.length);
            if (state.buffer.length === 0) {
                break;
            }
            continue;
        }
        if (state.buffer.startsWith(RAW_THINK_OPEN_TAG)) {
            state.buffer = state.buffer.slice(RAW_THINK_OPEN_TAG.length);
            state.mode = 'inside';
            continue;
        }
        if (!force && RAW_THINK_OPEN_TAG.startsWith(state.buffer)) {
            break;
        }
        state.active = false;
        segments.push({ type: 'text', delta: state.buffer });
        state.buffer = '';
        break;
    }
    return segments;
}
export class OpenAIAdapter {
    client;
    apiKey;
    baseUrl;
    defaultHeaders;
    model;
    constructor(apiKey, model = 'gpt-4o', baseUrl, defaultHeaders) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
        this.defaultHeaders = defaultHeaders;
        this.client = new OpenAI({
            apiKey,
            baseURL: baseUrl,
            maxRetries: MAX_RETRIES,
            defaultHeaders: {
                ...(defaultHeaders ?? {}),
                ...(isKimiCodingEndpoint(baseUrl)
                    ? { 'User-Agent': KIMI_CODING_COMPAT_USER_AGENT }
                    : {}),
            },
        });
        this.model = model;
    }
    getModelName() {
        return this.model;
    }
    cloneWithModel(model) {
        return new OpenAIAdapter(this.apiKey, model, this.baseUrl, this.defaultHeaders);
    }
    async *stream(messages, tools, systemPrompt, _options) {
        const openaiMessages = [
            { role: 'system', content: systemPrompt },
        ];
        for (const m of messages) {
            if (m.role === 'assistant') {
                const textBlocks = m.content.filter((block) => block.type === 'text');
                const toolUseBlocks = m.content.filter((block) => block.type === 'tool_use');
                const reasoningContent = collectReasoningText(m.content);
                const msg = {
                    role: 'assistant',
                    content: textBlocks.length > 0 ? textBlocks.map((block) => block.text).join('') : null,
                };
                if (toolUseBlocks.length > 0) {
                    msg.tool_calls = toolUseBlocks.map((block) => ({
                        id: block.id,
                        type: 'function',
                        function: {
                            name: block.name,
                            arguments: JSON.stringify(block.input),
                        },
                    }));
                }
                if (reasoningContent) {
                    msg.reasoning_content = reasoningContent;
                }
                openaiMessages.push(msg);
                continue;
            }
            const textBlocks = m.content.filter((block) => block.type === 'text');
            const imageBlocks = m.content.filter((block) => block.type === 'image');
            if (imageBlocks.length > 0) {
                const contentParts = [
                    ...textBlocks.map((block) => ({
                        type: 'text',
                        text: block.text,
                    })),
                    ...imageBlocks.map((block) => ({
                        type: 'image_url',
                        image_url: {
                            url: `data:${block.source.media_type};base64,${block.source.data}`,
                        },
                    })),
                ];
                openaiMessages.push({
                    role: 'user',
                    content: contentParts,
                });
            }
            else if (textBlocks.length > 0) {
                openaiMessages.push({
                    role: 'user',
                    content: textBlocks.map((block) => block.text).join(''),
                });
            }
            const toolResults = m.content.filter((block) => block.type === 'tool_result');
            for (const item of toolResults) {
                openaiMessages.push({
                    role: 'tool',
                    tool_call_id: item.tool_use_id,
                    content: item.content,
                });
            }
        }
        const openaiTools = tools.map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: t.inputSchema,
            },
        }));
        const stream = await this.client.chat.completions.create({
            model: this.model,
            messages: openaiMessages,
            tools: openaiTools.length > 0 ? openaiTools : undefined,
            stream: true,
            stream_options: { include_usage: true },
        });
        const toolBuffers = new Map();
        const rawThinkParser = {
            active: true,
            mode: 'outside',
            buffer: '',
        };
        let emittedDone = false;
        let outputChars = 0;
        let usageReceived = false;
        for await (const chunk of stream) {
            // Extract usage from chunk (include_usage: true)
            if (chunk.usage) {
                usageReceived = true;
                yield {
                    type: 'usage',
                    usage: {
                        inputTokens: chunk.usage.prompt_tokens ?? 0,
                        outputTokens: chunk.usage.completion_tokens ?? 0,
                    },
                };
            }
            const choice = chunk.choices[0];
            if (!choice)
                continue;
            const delta = choice.delta;
            if (!delta)
                continue;
            for (const reasoning of extractReasoningDeltas(delta)) {
                yield { type: 'thinking', delta: reasoning.text, signature: reasoning.signature };
            }
            if (delta.content) {
                for (const segment of drainLeadingRawThinkSegments(rawThinkParser, delta.content)) {
                    if (segment.type === 'thinking') {
                        yield segment;
                        continue;
                    }
                    outputChars += segment.delta.length;
                    yield segment;
                }
            }
            if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                    const current = toolBuffers.get(tc.index) ?? { id: '', name: '', argsBuffer: '' };
                    if (tc.id)
                        current.id = tc.id;
                    if (tc.function?.name)
                        current.name = tc.function.name;
                    if (tc.function?.arguments)
                        current.argsBuffer += tc.function.arguments;
                    toolBuffers.set(tc.index, current);
                }
            }
            if (choice?.finish_reason) {
                for (const segment of drainLeadingRawThinkSegments(rawThinkParser, '', true)) {
                    if (segment.type === 'thinking') {
                        yield segment;
                        continue;
                    }
                    outputChars += segment.delta.length;
                    yield segment;
                }
                for (const buf of toolBuffers.values()) {
                    let input = {};
                    try {
                        input = JSON.parse(buf.argsBuffer || '{}');
                    }
                    catch {
                        input = { _raw: buf.argsBuffer };
                    }
                    yield { type: 'tool_use', id: buf.id, name: buf.name, input };
                }
                toolBuffers.clear();
                // If the API didn't return usage, estimate locally
                if (!usageReceived) {
                    const allInputMessages = [
                        { role: 'user', content: [{ type: 'text', text: systemPrompt }] },
                        ...messages.map(m => ({
                            role: m.role,
                            content: m.content.map(b => {
                                if (b.type === 'text')
                                    return { type: 'text', text: b.text };
                                if (b.type === 'tool_use')
                                    return { type: 'text', text: JSON.stringify(b.input) };
                                if (b.type === 'tool_result')
                                    return { type: 'text', text: b.content };
                                if (b.type === 'image')
                                    return { type: 'text', text: '[image]' };
                                return { type: 'text', text: '' };
                            }),
                        })),
                    ];
                    const inputTokens = estimateTokens(allInputMessages);
                    yield {
                        type: 'usage',
                        usage: {
                            inputTokens,
                            outputTokens: Math.ceil(outputChars / 4),
                        },
                    };
                }
                emittedDone = true;
                yield { type: 'done' };
                return;
            }
        }
        if (!emittedDone) {
            for (const segment of drainLeadingRawThinkSegments(rawThinkParser, '', true)) {
                if (segment.type === 'thinking') {
                    yield segment;
                    continue;
                }
                outputChars += segment.delta.length;
                yield segment;
            }
            for (const buf of toolBuffers.values()) {
                let input = {};
                try {
                    input = JSON.parse(buf.argsBuffer || '{}');
                }
                catch {
                    input = { _raw: buf.argsBuffer };
                }
                yield { type: 'tool_use', id: buf.id, name: buf.name, input };
            }
            if (!usageReceived) {
                const allInputMessages = [
                    { role: 'user', content: [{ type: 'text', text: systemPrompt }] },
                    ...messages.map(m => ({
                        role: m.role,
                        content: m.content.map(b => {
                            if (b.type === 'text')
                                return { type: 'text', text: b.text };
                            if (b.type === 'tool_use')
                                return { type: 'text', text: JSON.stringify(b.input) };
                            if (b.type === 'tool_result')
                                return { type: 'text', text: b.content };
                            if (b.type === 'image')
                                return { type: 'text', text: '[image]' };
                            return { type: 'text', text: '' };
                        }),
                    })),
                ];
                const inputTokens = estimateTokens(allInputMessages);
                yield {
                    type: 'usage',
                    usage: {
                        inputTokens,
                        outputTokens: Math.ceil(outputChars / 4),
                    },
                };
            }
            yield { type: 'done' };
        }
    }
}
