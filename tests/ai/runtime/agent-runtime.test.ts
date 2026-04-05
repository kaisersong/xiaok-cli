import { describe, expect, it } from 'vitest';
import type { ModelAdapter, StreamChunk, ToolDefinition } from '../../../src/types.js';
import { AgentRunController } from '../../../src/ai/runtime/controller.js';
import { AgentRuntime } from '../../../src/ai/runtime/agent-runtime.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';

async function* mockStream(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function createRegistryMock(overrides?: {
  getToolDefinitions?: () => ToolDefinition[];
  executeTool?: (name: string, input: Record<string, unknown>) => Promise<string>;
}) {
  return {
    getToolDefinitions: overrides?.getToolDefinitions ?? (() => []),
    executeTool: overrides?.executeTool ?? (async () => 'ok'),
  };
}

describe('AgentRuntime', () => {
  it('emits run_started, assistant_text and run_completed for a pure text response', async () => {
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: () => mockStream([{ type: 'text', delta: 'hello' }, { type: 'done' }]),
    };
    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session: new AgentSessionState(),
      controller: new AgentRunController(),
      systemPrompt: 'system',
    });

    const events: string[] = [];
    await runtime.run('hi', (event) => {
      events.push(event.type);
    });

    expect(events).toEqual(['run_started', 'assistant_text', 'run_completed']);
  });

  it('merges consecutive text chunks into a single text block in session', async () => {
    const session = new AgentSessionState();
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: () => mockStream([
        { type: 'text', delta: 'Hello' },
        { type: 'text', delta: ' ' },
        { type: 'text', delta: 'world' },
        { type: 'text', delta: '!' },
        { type: 'done' },
      ]),
    };
    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session,
      controller: new AgentRunController(),
      systemPrompt: 'system',
    });

    await runtime.run('hi', () => {});

    // Should have exactly one assistant message with one merged text block
    const messages = session.getMessages();
    const assistantMsg = messages.find((m) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();

    const textBlocks = assistantMsg!.content.filter((b) => b.type === 'text');
    expect(textBlocks).toHaveLength(1);

    const textBlock = textBlocks[0] as { type: 'text'; text: string };
    expect(textBlock.text).toBe('Hello world!');
  });

  it('does not merge text blocks separated by tool_use', async () => {
    let streamCalls = 0;
    const session = new AgentSessionState();
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: () => {
        streamCalls += 1;
        if (streamCalls === 1) {
          return mockStream([
            { type: 'text', delta: 'Before ' },
            { type: 'text', delta: 'tool' },
            { type: 'tool_use', id: 'tu_1', name: 'read', input: { file: 'a.ts' } },
            { type: 'done' },
          ]);
        }
        return mockStream([
          { type: 'text', delta: 'After ' },
          { type: 'text', delta: 'tool' },
          { type: 'done' },
        ]);
      },
    };
    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session,
      controller: new AgentRunController(),
      systemPrompt: 'system',
    });

    await runtime.run('hi', () => {});

    const messages = session.getMessages();
    // Should have: user msg, assistant msg (with text + tool_use), user msg (tool_result), assistant msg (with text)
    expect(messages.length).toBe(4);

    // First assistant message: one merged text block + one tool_use
    const firstAssistant = messages[1];
    expect(firstAssistant.role).toBe('assistant');
    expect(firstAssistant.content).toHaveLength(2);
    const firstText = firstAssistant.content[0] as { type: 'text'; text: string };
    expect(firstText.type).toBe('text');
    expect(firstText.text).toBe('Before tool');

    // Second assistant message: one merged text block
    const secondAssistant = messages[3];
    expect(secondAssistant.role).toBe('assistant');
    expect(secondAssistant.content).toHaveLength(1);
    const secondText = secondAssistant.content[0] as { type: 'text'; text: string };
    expect(secondText.type).toBe('text');
    expect(secondText.text).toBe('After tool');
  });

  it('executes tool calls and continues the loop', async () => {
    let streamCalls = 0;
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: () => {
        streamCalls += 1;
        if (streamCalls === 1) {
          return mockStream([
            { type: 'tool_use', id: 'tu_1', name: 'glob', input: { pattern: '*.ts' } },
            { type: 'done' },
          ]);
        }

        return mockStream([{ type: 'text', delta: 'done' }, { type: 'done' }]);
      },
    };
    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session: new AgentSessionState(),
      controller: new AgentRunController(),
      systemPrompt: 'system',
    });

    const events: string[] = [];
    await runtime.run('list files', (event) => {
      events.push(event.type);
    });

    expect(streamCalls).toBe(2);
    expect(events).toContain('tool_started');
    expect(events).toContain('tool_finished');
    expect(events.at(-1)).toBe('run_completed');
  });

  it('emits usage_updated and compact_triggered when applicable', async () => {
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: () =>
        mockStream([
          { type: 'usage', usage: { inputTokens: 12, outputTokens: 4 } },
          { type: 'text', delta: 'ok' },
          { type: 'done' },
        ]),
    };
    const session = new AgentSessionState();
    session.appendUserText('12345678901234567890');
    session.appendAssistantBlocks([{ type: 'text', text: 'abcdefghijklmnopqrstuvwxyz' }]);
    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session,
      controller: new AgentRunController(),
      systemPrompt: 'system',
      maxIterations: 2,
      contextLimit: 8,
    });

    const events: string[] = [];
    await runtime.run('next', (event) => {
      events.push(event.type);
    });

    expect(events).toContain('compact_triggered');
    expect(events).toContain('usage_updated');
  });

  it('derives compact policy from model capabilities when explicit overrides are absent', async () => {
    const adapter: ModelAdapter & {
      getCapabilities: () => { contextLimit: number; compactThreshold: number; supportsPromptCaching: boolean };
    } = {
      getModelName: () => 'mock-model',
      getCapabilities: () => ({
        contextLimit: 8,
        compactThreshold: 0.5,
        supportsPromptCaching: false,
      }),
      stream: () => mockStream([{ type: 'text', delta: 'ok' }, { type: 'done' }]),
    };
    const session = new AgentSessionState();
    session.appendUserText('12345678901234567890');

    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session,
      controller: new AgentRunController(),
      systemPrompt: 'system',
    });

    const events: string[] = [];
    await runtime.run('next', (event) => {
      events.push(event.type);
    });

    expect(events).toContain('compact_triggered');
  });

  it('passes prompt cache segments to cache-capable adapters', async () => {
    const captured: unknown[] = [];
    const adapter: ModelAdapter & {
      getCapabilities: () => { supportsPromptCaching: boolean };
      stream: (
        messages: Parameters<ModelAdapter['stream']>[0],
        tools: Parameters<ModelAdapter['stream']>[1],
        systemPrompt: Parameters<ModelAdapter['stream']>[2],
        options?: unknown,
      ) => AsyncIterable<StreamChunk>;
    } = {
      getModelName: () => 'claude-opus-4-6',
      getCapabilities: () => ({ supportsPromptCaching: true }),
      stream: (_messages, _tools, _systemPrompt, options) => {
        captured.push(options);
        return mockStream([{ type: 'text', delta: 'ok' }, { type: 'done' }]);
      },
    };
    const session = new AgentSessionState();
    session.appendUserText('previous turn');
    session.appendAssistantBlocks([{ type: 'text', text: 'previous answer' }]);

    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock({
        getToolDefinitions: () => [
          {
            name: 'read',
            description: 'Read a file',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      }) as never,
      session,
      controller: new AgentRunController(),
      systemPrompt: 'system',
    });

    await runtime.run('next', () => {});

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      promptCache: {
        systemPrompt: [{ text: 'system', cache_control: { type: 'ephemeral' } }],
        tools: [{ name: 'read', cache_control: { type: 'ephemeral' } }],
      },
    });
  });

  it('fails explicitly when the model returns no text, tool call, or usage', async () => {
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: () => mockStream([{ type: 'done' }]),
    };
    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session: new AgentSessionState(),
      controller: new AgentRunController(),
      systemPrompt: 'system',
    });

    await expect(runtime.run('hi', () => {})).rejects.toThrow(/未返回任何文本或工具调用/);
  });

  it('passes the active prompt snapshot into tool execution context', async () => {
    let capturedContext: unknown;
    let streamCalls = 0;
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: () => {
        streamCalls += 1;
        if (streamCalls === 1) {
          return mockStream([
            { type: 'tool_use', id: 'tu_1', name: 'read', input: { file: 'a.ts' } },
            { type: 'done' },
          ]);
        }
        return mockStream([{ type: 'text', delta: 'done' }, { type: 'done' }]);
      },
    };
    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock({
        executeTool: async (_name, _input, context) => {
          capturedContext = context;
          return 'ok';
        },
      }) as never,
      session: new AgentSessionState(),
      controller: new AgentRunController(),
      systemPrompt: 'system',
      promptSnapshot: {
        id: 'prompt_1',
        createdAt: 1,
        cwd: '/repo',
        channel: 'chat',
        rendered: 'system',
        segments: [],
        memoryRefs: ['mem_1'],
      },
    });

    await runtime.run('hi', () => {});

    expect(capturedContext).toMatchObject({
      promptSnapshot: {
        id: 'prompt_1',
        memoryRefs: ['mem_1'],
      },
    });
  });
});

import { FileMemoryStore } from '../../../src/ai/memory/store.js';
import { tmpdir } from 'os';
import { join } from 'path';

describe('AgentRuntime compact memory injection', () => {
  it('appends memory summary message after compact', async () => {
    const memDir = join(tmpdir(), `xiaok-compact-mem-${Date.now()}`);
    const store = new FileMemoryStore(memDir);
    await store.save({
      id: 'mem_1',
      scope: 'global',
      title: 'Test Rule',
      summary: 'Always write tests first.',
      tags: [],
      updatedAt: 1,
    });

    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: () => mockStream([{ type: 'text', delta: 'ok' }, { type: 'done' }]),
    };

    const session = new AgentSessionState();
    for (let i = 0; i < 5; i++) {
      session.appendUserText('a'.repeat(500));
      session.appendAssistantBlocks([{ type: 'text', text: 'b'.repeat(500) }]);
    }
    session.attachPromptSnapshot('snap_1', ['mem_1'], '/any');

    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session,
      controller: new AgentRunController(),
      systemPrompt: 'system',
      contextLimit: 100,
      memoryStore: store,
    });

    const events: string[] = [];
    await runtime.run('next', (event) => events.push(event.type));

    expect(events).toContain('compact_triggered');
    const msgs = session.getMessages();
    const memMsg = msgs.find((m) =>
      m.content.some((b) => b.type === 'text' && (b as { type: 'text'; text: string }).text.includes('Always write tests first.'))
    );
    expect(memMsg).toBeDefined();
  });
});
