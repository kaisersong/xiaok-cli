import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIResponsesAdapter } from '../../../src/ai/adapters/openai-responses.js';

describe('Desktop shared OpenAI Responses adapter contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves a Gemini-compatible image and multi-tool loop without OpenAI-only fields', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn().mockImplementation(async (_url: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return {
        ok: true,
        json: async () => ({
          output: [
            { type: 'message', content: [{ type: 'output_text', text: 'before' }] },
            { type: 'function_call', call_id: 'call_2', name: 'write', arguments: '{"path":"b"}' },
            { type: 'message', content: [{ type: 'output_text', text: 'after' }] },
          ],
          usage: { input_tokens: 8, output_tokens: 3 },
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new OpenAIResponsesAdapter(
      'test-key',
      'gemini-2.5-pro',
      'https://generativelanguage.googleapis.com/v1beta/openai',
    );
    const chunks = [];

    for await (const chunk of adapter.stream(
      [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'call_1', name: 'read', input: { path: 'a' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'call_1', content: 'A' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'aGVsbG8=',
              },
            },
          ],
        },
      ],
      [
        { name: 'read', description: 'Read', inputSchema: { type: 'object' } },
        { name: 'write', description: 'Write', inputSchema: { type: 'object' } },
      ],
      'system',
    )) {
      chunks.push(chunk);
    }

    expect(requests[0]).not.toHaveProperty('store');
    expect(requests[0]?.input).toEqual([
      { role: 'system', content: [{ type: 'input_text', text: 'system' }] },
      { type: 'function_call', call_id: 'call_1', name: 'read', arguments: '{"path":"a"}' },
      { type: 'function_call_output', call_id: 'call_1', output: 'A' },
      {
        role: 'user',
        content: [{ type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=' }],
      },
    ]);
    expect(chunks.slice(0, 3)).toEqual([
      { type: 'text', delta: 'before' },
      { type: 'tool_use', id: 'call_2', name: 'write', input: { path: 'b' } },
      { type: 'text', delta: 'after' },
    ]);
  });
});
