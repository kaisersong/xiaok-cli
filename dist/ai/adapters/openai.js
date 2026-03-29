import OpenAI from 'openai';
const MAX_RETRIES = 3;
export class OpenAIAdapter {
    client;
    model;
    constructor(apiKey, model = 'gpt-4o', baseUrl) {
        this.client = new OpenAI({ apiKey, baseURL: baseUrl, maxRetries: MAX_RETRIES });
        this.model = model;
    }
    async *stream(messages, tools, systemPrompt) {
        const openaiMessages = [
            { role: 'system', content: systemPrompt },
        ];
        for (const m of messages) {
            if (m.role === 'tool_result') {
                // 每条 ToolResultContent 展开为独立的 tool 消息
                const items = Array.isArray(m.content) ? m.content : [];
                for (const item of items) {
                    openaiMessages.push({
                        role: 'tool',
                        tool_call_id: item.tool_use_id,
                        content: item.content,
                    });
                }
            }
            else if (m.role === 'assistant') {
                const msg = {
                    role: 'assistant',
                    content: m.content || null,
                };
                // 如果 assistant 消息携带 tool_calls，必须传给 OpenAI
                if (m.toolCalls && m.toolCalls.length > 0) {
                    msg.tool_calls = m.toolCalls.map(tc => ({
                        id: tc.id,
                        type: 'function',
                        function: { name: tc.name, arguments: JSON.stringify(tc.input) },
                    }));
                }
                openaiMessages.push(msg);
            }
            else {
                openaiMessages.push({ role: 'user', content: m.content });
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
        });
        const rawChunks = [];
        for await (const chunk of stream) {
            rawChunks.push(chunk);
        }
        // Buffer for tool_calls arguments
        const toolBuffers = new Map();
        let gotFinishReason = false;
        for (const chunk of rawChunks) {
            const delta = chunk.choices[0]?.delta;
            if (!delta)
                continue;
            if (delta.content) {
                yield { type: 'text', delta: delta.content };
            }
            if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                    if (!toolBuffers.has(tc.index)) {
                        toolBuffers.set(tc.index, { id: tc.id ?? '', name: tc.function?.name ?? '', argsBuffer: '' });
                    }
                    const buf = toolBuffers.get(tc.index);
                    if (tc.function?.arguments)
                        buf.argsBuffer += tc.function.arguments;
                    if (tc.id)
                        buf.id = tc.id;
                    if (tc.function?.name)
                        buf.name = tc.function.name;
                }
            }
            const finishReason = chunk.choices[0]?.finish_reason;
            if (finishReason) {
                gotFinishReason = true;
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
                yield { type: 'done' };
            }
        }
        // 防御：部分 provider 不发 finish_reason，确保 done 总会发出
        if (!gotFinishReason) {
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
            yield { type: 'done' };
        }
    }
}
