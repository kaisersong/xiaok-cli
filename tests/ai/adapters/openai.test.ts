// tests/ai/adapters/openai.test.ts
import { describe, it, expect, vi } from 'vitest';

const openAIConstructorCalls: unknown[] = [];

vi.mock('openai', () => {
  return {
    default: class OpenAI {
      constructor(opts?: unknown) {
        openAIConstructorCalls.push(opts);
      }

      chat = {
        completions: {
          create: vi.fn(),
        },
      };
    },
  };
});

describe('OpenAIAdapter', () => {
  it('spoofs a supported coding-agent user agent for kimi coding endpoints', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    openAIConstructorCalls.length = 0;
    new OpenAIAdapter('test-key', 'kimi-for-coding', 'https://api.kimi.com/coding/v1');

    expect(openAIConstructorCalls).toHaveLength(1);
    expect(openAIConstructorCalls[0]).toMatchObject({
      apiKey: 'test-key',
      baseURL: 'https://api.kimi.com/coding/v1',
      defaultHeaders: {
        'User-Agent': 'claude-code/1.0',
      },
    });
  });

  it('keeps the default openai sdk user agent for non-kimi endpoints', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    openAIConstructorCalls.length = 0;
    new OpenAIAdapter('test-key', 'gpt-4o', 'https://api.openai.com/v1');

    expect(openAIConstructorCalls).toHaveLength(1);
    expect(openAIConstructorCalls[0]).toMatchObject({
      apiKey: 'test-key',
      baseURL: 'https://api.openai.com/v1',
    });
    expect(openAIConstructorCalls[0]).not.toMatchObject({
      defaultHeaders: {
        'User-Agent': 'claude-code/1.0',
      },
    });
  });

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

  it('preserves assistant thinking as reasoning_content on tool-call replay', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    let capturedMessages: unknown[] = [];
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockImplementation(async (params: unknown) => {
      capturedMessages = (params as { messages: unknown[] }).messages;
      return mockStream as never;
    });

    const adapter = new OpenAIAdapter('test-key', 'kimi-k2-thinking');
    (adapter as unknown as { client: typeof instance }).client = instance;

    const messages = [
      {
        role: 'assistant' as const,
        content: [
          { type: 'thinking' as const, thinking: 'first reasoned step' },
          { type: 'tool_use' as const, id: 'tu_1', name: 'search', input: { q: 'slash commands' } },
        ],
      },
      {
        role: 'user' as const,
        content: [
          { type: 'tool_result' as const, tool_use_id: 'tu_1', content: 'search result' },
        ],
      },
    ];

    for await (const _ of adapter.stream(messages, [], 'system')) { /* consume */ }

    const assistantMessage = capturedMessages.find((m: unknown) => (m as { role: string }).role === 'assistant') as
      | { reasoning_content?: string; tool_calls?: unknown[] }
      | undefined;
    expect(assistantMessage).toBeDefined();
    expect(assistantMessage?.reasoning_content).toBe('first reasoned step');
    expect(assistantMessage?.tool_calls).toHaveLength(1);
  });

  it('emits thinking chunks from reasoning_content streaming deltas', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { reasoning_content: 'step 1' }, finish_reason: null }] };
        yield { choices: [{ delta: { reasoning_content: ' + step 2' }, finish_reason: null }] };
        yield { choices: [{ delta: { content: 'answer' }, finish_reason: null }] };
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue(mockStream as never);

    const adapter = new OpenAIAdapter('test-key', 'kimi-k2-thinking');
    (adapter as unknown as { client: typeof instance }).client = instance;

    const chunks = [];
    for await (const chunk of adapter.stream([], [], 'system')) {
      chunks.push(chunk);
    }

    expect(chunks.filter((chunk) => chunk.type === 'thinking')).toEqual([
      { type: 'thinking', delta: 'step 1', signature: 'reasoning_content' },
      { type: 'thinking', delta: ' + step 2', signature: 'reasoning_content' },
    ]);
    expect(chunks).toContainEqual({ type: 'text', delta: 'answer' });
  });

  it('emits thinking chunks from reasoning_details streaming deltas', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [{
            delta: {
              reasoning_details: [
                { type: 'reasoning.text', text: 'step A' },
                { type: 'reasoning.text', text: ' + step B' },
              ],
            },
            finish_reason: null,
          }],
        };
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue(mockStream as never);

    const adapter = new OpenAIAdapter('test-key', 'kimi-k2-thinking');
    (adapter as unknown as { client: typeof instance }).client = instance;

    const chunks = [];
    for await (const chunk of adapter.stream([], [], 'system')) {
      chunks.push(chunk);
    }

    expect(chunks.filter((chunk) => chunk.type === 'thinking')).toEqual([
      { type: 'thinking', delta: 'step A', signature: 'reasoning_details' },
      { type: 'thinking', delta: ' + step B', signature: 'reasoning_details' },
    ]);
  });

  it('reclassifies leading raw <think> content blocks into hidden thinking chunks', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: '<thi' }, finish_reason: null }] };
        yield { choices: [{ delta: { content: 'nk>step 1' }, finish_reason: null }] };
        yield { choices: [{ delta: { content: '\nstep 2</th' }, finish_reason: null }] };
        yield { choices: [{ delta: { content: 'ink>\n\n正式回答' }, finish_reason: null }] };
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue(mockStream as never);

    const adapter = new OpenAIAdapter('test-key', 'kimi-k2-thinking');
    (adapter as unknown as { client: typeof instance }).client = instance;

    const chunks = [];
    for await (const chunk of adapter.stream([], [], 'system')) {
      chunks.push(chunk);
    }

    expect(chunks.filter((chunk) => chunk.type === 'thinking')).toEqual([
      { type: 'thinking', delta: 'step 1', signature: 'raw_think_tag' },
      { type: 'thinking', delta: '\nstep 2', signature: 'raw_think_tag' },
    ]);
    expect(chunks.filter((chunk) => chunk.type === 'text')).toEqual([
      { type: 'text', delta: '正式回答' },
    ]);
  });

  it('keeps literal <think> text once visible assistant prose has already started', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: '请输出字面量 <think> 标签' }, finish_reason: null }] };
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue(mockStream as never);

    const adapter = new OpenAIAdapter('test-key', 'kimi-k2-thinking');
    (adapter as unknown as { client: typeof instance }).client = instance;

    const chunks = [];
    for await (const chunk of adapter.stream([], [], 'system')) {
      chunks.push(chunk);
    }

    expect(chunks.filter((chunk) => chunk.type === 'thinking')).toEqual([]);
    expect(chunks.filter((chunk) => chunk.type === 'text')).toEqual([
      { type: 'text', delta: '请输出字面量 <think> 标签' },
    ]);
  });

  it('joins multiple assistant thinking blocks into one reasoning_content replay payload', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    let capturedMessages: unknown[] = [];
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockImplementation(async (params: unknown) => {
      capturedMessages = (params as { messages: unknown[] }).messages;
      return mockStream as never;
    });

    const adapter = new OpenAIAdapter('test-key', 'kimi-k2-thinking');
    (adapter as unknown as { client: typeof instance }).client = instance;

    const messages = [
      {
        role: 'assistant' as const,
        content: [
          { type: 'thinking' as const, thinking: 'first reasoned step' },
          { type: 'text' as const, text: 'working...' },
          { type: 'thinking' as const, thinking: 'second reasoned step' },
          { type: 'tool_use' as const, id: 'tu_1', name: 'search', input: { q: 'daemon isolation' } },
        ],
      },
      {
        role: 'user' as const,
        content: [
          { type: 'tool_result' as const, tool_use_id: 'tu_1', content: 'search result' },
        ],
      },
    ];

    for await (const _ of adapter.stream(messages, [], 'system')) { /* consume */ }

    const assistantMessage = capturedMessages.find((m: unknown) => (m as { role: string }).role === 'assistant') as
      | { content?: string | null; reasoning_content?: string; tool_calls?: unknown[] }
      | undefined;
    expect(assistantMessage).toBeDefined();
    expect(assistantMessage?.content).toBe('working...');
    expect(assistantMessage?.reasoning_content).toBe('first reasoned step\n\nsecond reasoned step');
    expect(assistantMessage?.tool_calls).toHaveLength(1);
  });

  it('ignores prompt cache metadata for OpenAI-compatible payloads', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    let capturedParams: Record<string, unknown> | null = null;
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockImplementation(async (params: unknown) => {
      capturedParams = params as Record<string, unknown>;
      return mockStream as never;
    });

    const adapter = new OpenAIAdapter('test-key', 'gpt-4o');
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
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'hello' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'read',
            description: 'Read a file',
          },
        },
      ],
    });
    expect(JSON.stringify(capturedParams)).not.toContain('cache_control');
    expect(JSON.stringify(capturedParams)).not.toContain('cached system');
  });

  it('serializes image blocks into OpenAI image_url content parts', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    let capturedMessages: unknown[] = [];
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
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
      { role: 'system', content: 'system' },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: 'data:image/png;base64,YWJj',
            },
          },
        ],
      },
    ]);
  });
});
