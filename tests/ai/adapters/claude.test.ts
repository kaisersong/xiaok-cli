// tests/ai/adapters/claude.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { Message, ToolDefinition } from '../../../src/types.js';

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
});
