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
});
