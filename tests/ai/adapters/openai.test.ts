// tests/ai/adapters/openai.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('openai', () => {
  return {
    default: class OpenAI {
      chat = {
        completions: {
          create: vi.fn(),
        },
      };
    },
  };
});

describe('OpenAIAdapter', () => {
  it('emits text chunks from streaming response', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'Hello ' }, finish_reason: null }] };
        yield { choices: [{ delta: { content: 'world' }, finish_reason: null }] };
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue(mockStream as never);

    const adapter = new OpenAIAdapter('test-key', 'gpt-4o');
    (adapter as unknown as { client: typeof instance }).client = instance;

    const chunks: string[] = [];
    for await (const chunk of adapter.stream([], [], 'system')) {
      if (chunk.type === 'text') chunks.push(chunk.delta);
    }
    expect(chunks).toEqual(['Hello ', 'world']);
  });

  it('buffers tool_calls arguments and emits single tool_use chunk', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'bash', arguments: '' } }] }, finish_reason: null }] };
        yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"cmd":"ls"}' } }] }, finish_reason: null }] };
        yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }] };
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue(mockStream as never);

    const adapter = new OpenAIAdapter('test-key', 'gpt-4o');
    (adapter as unknown as { client: typeof instance }).client = instance;

    const chunks = [];
    for await (const chunk of adapter.stream([], [], 'system')) {
      chunks.push(chunk);
    }

    const toolChunk = chunks.find(c => c.type === 'tool_use');
    expect(toolChunk).toMatchObject({ type: 'tool_use', id: 'call_1', name: 'bash', input: { cmd: 'ls' } });
    expect(chunks.at(-1)).toMatchObject({ type: 'done' });
  });

  it('emits done even when no finish_reason chunk arrives', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'hi' }, finish_reason: null }] };
        // stream ends without finish_reason
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue(mockStream as never);

    const adapter = new OpenAIAdapter('test-key', 'gpt-4o');
    (adapter as unknown as { client: typeof instance }).client = instance;

    const chunks = [];
    for await (const chunk of adapter.stream([], [], 'system')) chunks.push(chunk);
    expect(chunks.at(-1)).toMatchObject({ type: 'done' });
  });

  it('expands multiple tool results into separate OpenAI tool messages', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    // Capture the messages passed to the API
    let capturedMessages: unknown[] = [];
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] };
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockImplementation(async (params: unknown) => {
      capturedMessages = (params as { messages: unknown[] }).messages;
      return mockStream as never;
    });

    const adapter = new OpenAIAdapter('test-key', 'gpt-4o');
    (adapter as unknown as { client: typeof instance }).client = instance;

    const messages = [
      {
        role: 'assistant' as const,
        content: [
          { type: 'text' as const, text: 'running tools' },
          { type: 'tool_use' as const, id: 'tu_1', name: 'bash', input: { command: 'ls' } },
          { type: 'tool_use' as const, id: 'tu_2', name: 'glob', input: { pattern: '*.ts' } },
        ],
      },
      {
        role: 'user' as const,
        content: [
          { type: 'tool_result' as const, tool_use_id: 'tu_1', content: 'result1' },
          { type: 'tool_result' as const, tool_use_id: 'tu_2', content: 'result2' },
        ],
      },
    ];

    for await (const _ of adapter.stream(messages, [], 'system')) { /* consume */ }

    const assistantMessages = capturedMessages.filter((m: unknown) => (m as { role: string }).role === 'assistant');
    expect(assistantMessages).toHaveLength(1);
    expect((assistantMessages[0] as { tool_calls?: unknown[] }).tool_calls).toHaveLength(2);

    const toolMessages = capturedMessages.filter((m: unknown) => (m as { role: string }).role === 'tool');
    expect(toolMessages).toHaveLength(2);
    expect((toolMessages[0] as { tool_call_id: string }).tool_call_id).toBe('tu_1');
    expect((toolMessages[1] as { tool_call_id: string }).tool_call_id).toBe('tu_2');
  });
});
