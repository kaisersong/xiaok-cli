import Anthropic from '@anthropic-ai/sdk';
const MAX_RETRIES = 3;
export class ClaudeAdapter {
    client;
    model;
    constructor(apiKey, model = 'claude-opus-4-6', baseUrl) {
        this.client = new Anthropic({ apiKey, baseURL: baseUrl, maxRetries: MAX_RETRIES });
        this.model = model;
    }
    async *stream(messages, tools, systemPrompt) {
        const anthropicMessages = messages.map(m => ({
            role: m.role === 'tool_result' ? 'user' : m.role,
            content: typeof m.content === 'string'
                ? m.content
                : m.content.map(tc => ({
                    type: 'tool_result',
                    tool_use_id: tc.tool_use_id,
                    content: tc.content,
                    is_error: tc.is_error,
                })),
        }));
        const anthropicTools = tools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema,
        }));
        const stream = this.client.messages.stream({
            model: this.model,
            max_tokens: 8192,
            system: systemPrompt,
            messages: anthropicMessages,
            tools: anthropicTools.length > 0 ? anthropicTools : undefined,
        });
        // Buffer for tool_use arguments
        const toolBuffers = new Map();
        for await (const event of stream) {
            if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
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
            else if (event.type === 'message_stop') {
                yield { type: 'done' };
            }
        }
    }
}
