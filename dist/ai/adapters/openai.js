import OpenAI from 'openai';
import { estimateTokens } from '../runtime/usage.js';
const MAX_RETRIES = 3;
export class OpenAIAdapter {
    client;
    apiKey;
    baseUrl;
    model;
    constructor(apiKey, model = 'gpt-4o', baseUrl) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
        this.client = new OpenAI({ apiKey, baseURL: baseUrl, maxRetries: MAX_RETRIES });
        this.model = model;
    }
    getModelName() {
        return this.model;
    }
    cloneWithModel(model) {
        return new OpenAIAdapter(this.apiKey, model, this.baseUrl);
    }
    async *stream(messages, tools, systemPrompt, _options) {
        const openaiMessages = [
            { role: 'system', content: systemPrompt },
        ];
        for (const m of messages) {
            if (m.role === 'assistant') {
                const textBlocks = m.content.filter((block) => block.type === 'text');
                const toolUseBlocks = m.content.filter((block) => block.type === 'tool_use');
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
            if (delta.content) {
                outputChars += delta.content.length;
                yield { type: 'text', delta: delta.content };
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
