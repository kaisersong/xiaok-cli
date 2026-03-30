// tests/ai/adapters/claude.test.ts
import { describe, it, expect, vi } from 'vitest';

// Mock @anthropic-ai/sdk
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class Anthropic {
      messages = {
        stream: vi.fn(),
      };
    },
  };
});

describe('ClaudeAdapter', () => {
  it('emits text chunks from streaming response', async () => {
    const { ClaudeAdapter } = await import('../../../src/ai/adapters/claude.js');

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } };
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } };
        yield { type: 'message_stop' };
      },
    };

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const instance = new Anthropic({ apiKey: 'test' });
    vi.spyOn(instance.messages, 'stream').mockReturnValue(mockStream as never);

    const adapter = new ClaudeAdapter('test-key', 'claude-opus-4-6');
    // Replace internal client
    (adapter as unknown as { client: typeof instance }).client = instance;

    const chunks: string[] = [];
    for await (const chunk of adapter.stream([], [], 'system')) {
      if (chunk.type === 'text') chunks.push(chunk.delta);
    }
    expect(chunks).toEqual(['Hello ', 'world']);
  });

  it('buffers tool_use input_json_delta and emits single tool_use chunk', async () => {
    const { ClaudeAdapter } = await import('../../../src/ai/adapters/claude.js');

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_1', name: 'bash' } };
        yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"cmd":' } };
        yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"ls"}' } };
        yield { type: 'content_block_stop', index: 0 };
        yield { type: 'message_stop' };
      },
    };

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const instance = new Anthropic({ apiKey: 'test' });
    vi.spyOn(instance.messages, 'stream').mockReturnValue(mockStream as never);

    const adapter = new ClaudeAdapter('test-key', 'claude-opus-4-6');
    (adapter as unknown as { client: typeof instance }).client = instance;

    const chunks = [];
    for await (const chunk of adapter.stream([], [], 'system')) {
      chunks.push(chunk);
    }

    const toolChunk = chunks.find(c => c.type === 'tool_use');
    expect(toolChunk).toMatchObject({ type: 'tool_use', id: 'tu_1', name: 'bash', input: { cmd: 'ls' } });
  });

  it('serializes block-based assistant and tool_result history', async () => {
    const { ClaudeAdapter } = await import('../../../src/ai/adapters/claude.js');

    let capturedMessages: unknown[] = [];
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { type: 'message_stop' };
      },
    };

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const instance = new Anthropic({ apiKey: 'test' });
    vi.spyOn(instance.messages, 'stream').mockImplementation((params: unknown) => {
      capturedMessages = (params as { messages: unknown[] }).messages;
      return mockStream as never;
    });

    const adapter = new ClaudeAdapter('test-key', 'claude-opus-4-6');
    (adapter as unknown as { client: typeof instance }).client = instance;

    const messages = [
      {
        role: 'assistant' as const,
        content: [
          { type: 'text' as const, text: 'running tools' },
        ],
      },
      {
        role: 'user' as const,
        content: [
          { type: 'tool_result' as const, tool_use_id: 'tu_1', content: 'done', is_error: false },
        ],
      },
    ];

    for await (const _ of adapter.stream(messages, [], 'system')) { /* consume */ }

    expect(capturedMessages).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'running tools' }] },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'done', is_error: false }],
      },
    ]);
  });

  it('maps prompt cache metadata onto Anthropic request payloads', async () => {
    const { ClaudeAdapter } = await import('../../../src/ai/adapters/claude.js');

    let capturedParams: Record<string, unknown> | null = null;
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { type: 'message_stop' };
      },
    };

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const instance = new Anthropic({ apiKey: 'test' });
    vi.spyOn(instance.messages, 'stream').mockImplementation((params: unknown) => {
      capturedParams = params as Record<string, unknown>;
      return mockStream as never;
    });

    const adapter = new ClaudeAdapter('test-key', 'claude-opus-4-6');
    (adapter as unknown as { client: typeof instance }).client = instance;

    for await (const _ of adapter.stream(
      [
        {
          role: 'user',
          content: [{ type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } }],
        },
      ],
      [
        {
          name: 'read',
          description: 'Read a file',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
      'system',
      {
        promptCache: {
          systemPrompt: [{ type: 'text', text: 'cached system', cache_control: { type: 'ephemeral' } }],
          tools: [
            {
              name: 'read',
              description: 'Read a file',
              inputSchema: { type: 'object', properties: {} },
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } }],
            },
          ],
        },
      },
    )) { /* consume */ }

    expect(capturedParams).toMatchObject({
      system: [{ type: 'text', text: 'cached system', cache_control: { type: 'ephemeral' } }],
      tools: [{ name: 'read', cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } }],
        },
      ],
    });
  });

  it('serializes image blocks for Claude-compatible payloads', async () => {
    const { ClaudeAdapter } = await import('../../../src/ai/adapters/claude.js');

    let capturedMessages: unknown[] = [];
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { type: 'message_stop' };
      },
    };

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const instance = new Anthropic({ apiKey: 'test' });
    vi.spyOn(instance.messages, 'stream').mockImplementation((params: unknown) => {
      capturedMessages = (params as { messages: unknown[] }).messages;
      return mockStream as never;
    });

    const adapter = new ClaudeAdapter('test-key', 'claude-opus-4-6');
    (adapter as unknown as { client: typeof instance }).client = instance;

    for await (const _ of adapter.stream([
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'YWJj',
            },
          },
        ],
      },
    ], [], 'system')) { /* consume */ }

    expect(capturedMessages).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'YWJj',
            },
          },
        ],
      },
    ]);
  });
});
