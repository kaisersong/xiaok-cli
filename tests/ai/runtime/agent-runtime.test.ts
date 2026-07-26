import { describe, expect, it, vi } from 'vitest';
import type { ModelAdapter, StreamChunk, ToolDefinition } from '../../../src/types.js';
import { AgentRunController } from '../../../src/ai/runtime/controller.js';
import { AgentRuntime } from '../../../src/ai/runtime/agent-runtime.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { estimateTokens } from '../../../src/ai/runtime/usage.js';

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

  it('stores thinking chunks in session before tool-use turns', async () => {
    const session = new AgentSessionState();
    let streamCalls = 0;
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: () => {
        streamCalls += 1;
        if (streamCalls === 1) {
          return mockStream([
            { type: 'thinking', delta: 'reasoned step', signature: 'reasoning_content' } as unknown as StreamChunk,
            { type: 'tool_use', id: 'tu_1', name: 'read', input: { file: 'a.ts' } },
            { type: 'done' },
          ]);
        }
        return mockStream([
          { type: 'text', delta: 'done' },
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

    const assistantMsg = session.getMessages().find((message) => message.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg?.content[0]).toMatchObject({
      type: 'thinking',
      thinking: 'reasoned step',
    });
    expect(assistantMsg?.content[1]).toMatchObject({
      type: 'tool_use',
      id: 'tu_1',
    });
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

  it('summarizes only the frozen prefix and applies the exact LLM summary once', async () => {
    const session = new AgentSessionState();
    session.appendUserText(`old prefix ${'a'.repeat(10_000)}`);
    session.appendAssistantBlocks([{ type: 'text', text: `retained answer ${'b'.repeat(10_000)}` }]);

    const compactInputs: string[][] = [];
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: (messages, _tools, systemPrompt) => {
        if (systemPrompt.includes('TEXT ONLY')) {
          compactInputs.push(messages.map((message) =>
            message.content
              .filter((block) => block.type === 'text')
              .map((block) => (block as { text: string }).text)
          ).flat());
          return mockStream([
            { type: 'text', delta: 'LLM summary: retain /tmp/report.html' },
            { type: 'done' },
          ]);
        }
        return mockStream([{ type: 'text', delta: 'final answer' }, { type: 'done' }]);
      },
    };
    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session,
      controller: new AgentRunController(),
      systemPrompt: 'system',
      contextLimit: 100,
    });
    const compactEvents: Array<{ summary: string }> = [];

    await runtime.run('current user prompt', (event) => {
      if (event.type === 'compact_triggered') compactEvents.push({ summary: event.summary });
    });

    expect(compactInputs).toHaveLength(1);
    expect(compactInputs[0]!.join('\n')).toContain('old prefix');
    expect(compactInputs[0]!.join('\n')).not.toContain('retained answer');
    expect(compactInputs[0]!.join('\n')).not.toContain('current user prompt');
    expect(session.getCompactions().at(-1)?.summary)
      .toBe('LLM summary: retain /tmp/report.html');
    expect(compactEvents).toEqual([{ summary: 'LLM summary: retain /tmp/report.html' }]);
    expect((session.getMessages()[0]!.content[0] as { text: string }).text)
      .toBe('LLM summary: retain /tmp/report.html');
    expect(JSON.stringify(session.getMessages()).match(/current user prompt/g)).toHaveLength(1);
  });

  it('does not call the compact adapter or emit compact_triggered without a replaceable prefix', async () => {
    const session = new AgentSessionState();
    session.appendUserText('a'.repeat(10_000));
    let compactCalls = 0;
    let mainCalls = 0;
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: (_messages, _tools, systemPrompt) => {
        if (systemPrompt.includes('TEXT ONLY')) compactCalls += 1;
        else mainCalls += 1;
        return mockStream([{ type: 'text', delta: 'final' }, { type: 'done' }]);
      },
    };
    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session,
      controller: new AgentRunController(),
      systemPrompt: 'system',
      contextLimit: 100,
    });
    const events: string[] = [];

    await runtime.run('current', (event) => events.push(event.type));

    expect(compactCalls).toBe(0);
    expect(mainCalls).toBe(1);
    expect(events).not.toContain('compact_triggered');
    expect(session.getCompactions()).toHaveLength(0);
  });

  it('replans compaction after tool history grows beyond a no-prefix revision', async () => {
    const session = new AgentSessionState();
    session.appendUserText('a'.repeat(10_000));
    let compactCalls = 0;
    let mainCalls = 0;
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: (_messages, _tools, systemPrompt) => {
        if (systemPrompt.includes('TEXT ONLY')) {
          compactCalls += 1;
          return mockStream([
            { type: 'text', delta: 'summary after tool history growth' },
            { type: 'done' },
          ]);
        }
        mainCalls += 1;
        if (mainCalls === 1) {
          return mockStream([
            { type: 'tool_use', id: 'tu_grow', name: 'read', input: { path: 'a.ts' } },
            { type: 'done' },
          ]);
        }
        return mockStream([{ type: 'text', delta: 'final' }, { type: 'done' }]);
      },
    };
    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session,
      controller: new AgentRunController(),
      systemPrompt: 'system',
      contextLimit: 100,
    });
    const events: string[] = [];

    await runtime.run('current', (event) => events.push(event.type));

    expect(mainCalls).toBe(2);
    expect(compactCalls).toBe(1);
    expect(events.filter((event) => event === 'compact_triggered')).toHaveLength(1);
    expect(session.getCompactions()).toHaveLength(1);
  });

  it('rejects a stale compaction plan and does not retry it within the same run', async () => {
    const session = new AgentSessionState();
    session.appendUserText(`old prefix ${'a'.repeat(10_000)}`);
    session.appendAssistantBlocks([{ type: 'text', text: `retained answer ${'b'.repeat(10_000)}` }]);
    let compactCalls = 0;
    let mainCalls = 0;
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: (_messages, _tools, systemPrompt) => {
        if (systemPrompt.includes('TEXT ONLY')) {
          compactCalls += 1;
          session.appendUserText('concurrent session mutation');
          return mockStream([{ type: 'text', delta: 'stale summary' }, { type: 'done' }]);
        }
        mainCalls += 1;
        return mockStream([{ type: 'text', delta: 'final' }, { type: 'done' }]);
      },
    };
    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session,
      controller: new AgentRunController(),
      systemPrompt: 'system',
      contextLimit: 100,
    });
    const events: string[] = [];

    await runtime.run('current', (event) => events.push(event.type));

    expect(compactCalls).toBe(1);
    expect(mainCalls).toBe(1);
    expect(events).not.toContain('compact_triggered');
    expect(session.getCompactions()).toHaveLength(0);
    expect(JSON.stringify(session.getMessages())).toContain('concurrent session mutation');
  });

  it('emits compact_failed before compact_triggered when deterministic fallback succeeds', async () => {
    const session = new AgentSessionState();
    session.appendUserText(`old prefix ${'a'.repeat(10_000)}`);
    session.appendAssistantBlocks([{ type: 'text', text: `retained answer ${'b'.repeat(10_000)}` }]);
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: (_messages, _tools, systemPrompt) => {
        if (systemPrompt.includes('TEXT ONLY')) {
          return (async function* failingCompactStream(): AsyncIterable<StreamChunk> {
            throw new Error('compact model unavailable');
          })();
        }
        return mockStream([{ type: 'text', delta: 'final' }, { type: 'done' }]);
      },
    };
    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session,
      controller: new AgentRunController(),
      systemPrompt: 'system',
      contextLimit: 100,
    });
    const events: string[] = [];

    await runtime.run('current', (event) => events.push(event.type));

    expect(events.filter((event) =>
      event === 'compact_failed' || event === 'compact_triggered'
    )).toEqual(['compact_failed', 'compact_triggered']);
    expect(session.getCompactions()).toHaveLength(1);
    expect(session.getCompactions()[0]!.summary).toContain('[context compacted summary]');
    expect(JSON.stringify(session.getMessages())).not.toContain('[Previous context compacted]');
  });

  it('does not expose compact summary error details in runtime events', async () => {
    const session = new AgentSessionState();
    session.appendUserText(`old prefix ${'a'.repeat(10_000)}`);
    session.appendAssistantBlocks([{
      type: 'text',
      text: `retained answer ${'b'.repeat(10_000)}`,
    }]);
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: (_messages, _tools, systemPrompt) => {
        if (systemPrompt.includes('TEXT ONLY')) {
          return (async function* failingCompactStream(): AsyncIterable<StreamChunk> {
            throw new Error(
              '500 Authorization: Bearer sk-secret RAW_RESPONSE_BODY',
            );
          })();
        }
        return mockStream([
          { type: 'text', delta: 'final' },
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
      contextLimit: 100,
    });
    const compactEvents: Array<{ type: string; error?: string }> = [];

    await runtime.run('current', (event) => {
      if (
        event.type === 'compact_failed'
        || event.type === 'compact_triggered'
      ) {
        compactEvents.push(event);
      }
    });

    expect(compactEvents.map((event) => event.type)).toEqual([
      'compact_failed',
      'compact_triggered',
    ]);
    expect(compactEvents[0]).toEqual({
      type: 'compact_failed',
      runId: expect.any(String),
      error: 'portable compaction summary failed',
    });
    expect(JSON.stringify(compactEvents)).not.toContain('sk-secret');
    expect(JSON.stringify(compactEvents)).not.toContain('RAW_RESPONSE_BODY');
    expect(session.getCompactions()).toHaveLength(1);
  });

  it('uses the replacement adapter for compaction after setAdapter', async () => {
    const session = new AgentSessionState();
    session.appendUserText(`old prefix ${'a'.repeat(10_000)}`);
    session.appendAssistantBlocks([{
      type: 'text',
      text: `retained answer ${'b'.repeat(10_000)}`,
    }]);
    let oldCompactCalls = 0;
    let newCompactCalls = 0;
    const oldAdapter: ModelAdapter = {
      getModelName: () => 'old',
      stream: (_messages, _tools, systemPrompt) => {
        if (systemPrompt.includes('TEXT ONLY')) oldCompactCalls += 1;
        return mockStream([
          { type: 'text', delta: 'old result' },
          { type: 'done' },
        ]);
      },
    };
    const newAdapter: ModelAdapter = {
      getModelName: () => 'new',
      stream: (_messages, _tools, systemPrompt) => {
        if (systemPrompt.includes('TEXT ONLY')) {
          newCompactCalls += 1;
          return mockStream([
            { type: 'text', delta: 'summary from replacement adapter' },
            { type: 'done' },
          ]);
        }
        return mockStream([
          { type: 'text', delta: 'new result' },
          { type: 'done' },
        ]);
      },
    };
    const runtime = new AgentRuntime({
      adapter: oldAdapter,
      registry: createRegistryMock() as never,
      session,
      controller: new AgentRunController(),
      systemPrompt: 'system',
      contextLimit: 100,
    });
    runtime.setAdapter(newAdapter);

    await runtime.run('current', () => {});

    expect(oldCompactCalls).toBe(0);
    expect(newCompactCalls).toBe(1);
    expect(session.getCompactions().at(-1)?.summary)
      .toBe('summary from replacement adapter');
  });

  it('does not emit success or inject memory when compaction has no net gain', async () => {
    const session = new AgentSessionState();
    session.appendUserText('a');
    session.appendAssistantBlocks([{ type: 'text', text: 'b' }]);
    session.attachPromptSnapshot('snap_1', ['mem_1'], '/repo');
    const listRelevant = vi.fn(async () => [{
      id: 'mem_1',
      scope: 'global' as const,
      title: 'Rule',
      summary: 'Must not be injected on a no-op.',
      tags: [],
      updatedAt: 1,
    }]);
    let compactCalls = 0;
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: (_messages, _tools, systemPrompt) => {
        if (systemPrompt.includes('TEXT ONLY')) {
          compactCalls += 1;
          return mockStream([
            { type: 'text', delta: 'an expansion rather than a summary' },
            { type: 'done' },
          ]);
        }
        return mockStream([{ type: 'text', delta: 'final' }, { type: 'done' }]);
      },
    };
    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session,
      controller: new AgentRunController(),
      systemPrompt: 'system',
      contextLimit: 1,
      memoryStore: {
        save: async () => {},
        listRelevant,
      },
    });
    const events: string[] = [];

    await runtime.run('c', (event) => events.push(event.type));

    expect(compactCalls).toBe(1);
    expect(events).not.toContain('compact_triggered');
    expect(session.getCompactions()).toHaveLength(0);
    expect(listRelevant).not.toHaveBeenCalled();
    expect(JSON.stringify(session.getMessages())).not.toContain('Must not be injected on a no-op.');
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
    session.appendUserText(`old prefix ${'a'.repeat(10_000)}`);
    session.appendAssistantBlocks([{ type: 'text', text: 'retained answer' }]);

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
        systemPrompt: [{ type: 'text', text: 'system' }],
        tools: [{ name: 'read', cache_control: { type: 'ephemeral' } }],
      },
    });
    const promptCache = (captured[0] as { promptCache: { systemPrompt: Array<Record<string, unknown>> } }).promptCache;
    expect(promptCache.systemPrompt[0]).not.toHaveProperty('cache_control');
  });

  it('passes external abort signal into model invocation options', async () => {
    let capturedSignal: AbortSignal | undefined;
    const adapter: ModelAdapter & {
      stream: (
        messages: Parameters<ModelAdapter['stream']>[0],
        tools: Parameters<ModelAdapter['stream']>[1],
        systemPrompt: Parameters<ModelAdapter['stream']>[2],
        options?: { signal?: AbortSignal },
      ) => AsyncIterable<StreamChunk>;
    } = {
      getModelName: () => 'mock',
      stream: (_messages, _tools, _systemPrompt, options) => {
        capturedSignal = options?.signal;
        return mockStream([{ type: 'text', delta: 'ok' }, { type: 'done' }]);
      },
    };
    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session: new AgentSessionState(),
      controller: new AgentRunController(),
      systemPrompt: 'system',
    });

    const controller = new AbortController();
    await runtime.run('hi', () => {}, controller.signal);

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);
    controller.abort();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('does not start a run when the external signal is already aborted', async () => {
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: () => mockStream([{ type: 'text', delta: 'ignored' }, { type: 'done' }]),
    };
    const controller = new AgentRunController();
    const startRun = vi.spyOn(controller, 'startRun');
    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session: new AgentSessionState(),
      controller,
      systemPrompt: 'system',
    });
    const abortController = new AbortController();
    abortController.abort();

    await expect(runtime.run('hi', () => {}, abortController.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(startRun).not.toHaveBeenCalled();
  });

  it('applies usage before pulling and rethrowing the same abort error without completion', async () => {
    const controller = new AbortController();
    const sentinel = new DOMException('adapter aborted after usage', 'AbortError');
    const usage = {
      inputTokens: 17,
      outputTokens: 6,
      cacheReadInputTokens: 4,
    };
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: async function* () {
        controller.abort(sentinel);
        yield { type: 'usage', usage };
        throw sentinel;
      },
    };
    const session = new AgentSessionState();
    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session,
      controller: new AgentRunController(),
      systemPrompt: 'system',
    });
    const events: string[] = [];

    await expect(runtime.run('hi', (event) => {
      events.push(event.type);
    }, controller.signal)).rejects.toBe(sentinel);

    expect(session.getUsage()).toEqual(usage);
    expect(events.filter((type) => type === 'usage_updated')).toHaveLength(1);
    expect(events).not.toContain('run_completed');
  });

  it('applies final usage before a consumer-triggered timeout and never reports completion', async () => {
    const controller = new AbortController();
    const sentinel = new DOMException('consumer timeout after usage', 'TimeoutError');
    const usage = {
      inputTokens: 23,
      outputTokens: 7,
      cacheReadInputTokens: 5,
    };
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: async function* (_messages, _tools, _systemPrompt, options) {
        yield { type: 'text', delta: 'answer' };
        yield { type: 'usage', usage };
        if (options?.signal?.aborted) {
          throw options.signal.reason;
        }
        yield { type: 'done' };
      },
    };
    const session = new AgentSessionState();
    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session,
      controller: new AgentRunController(),
      systemPrompt: 'system',
    });
    const events: string[] = [];

    await expect(runtime.run('hi', (event) => {
      events.push(event.type);
      if (event.type === 'usage_updated') {
        controller.abort(sentinel);
      }
    }, controller.signal)).rejects.toBe(sentinel);

    expect(session.getUsage()).toEqual(usage);
    expect(events.filter((type) => type === 'usage_updated')).toHaveLength(1);
    expect(events).toContain('assistant_text');
    expect(events).not.toContain('run_completed');
  });

  it('checks abort after clean stream exhaustion before reporting completion', async () => {
    const controller = new AbortController();
    const sentinel = new DOMException('aborted at clean exhaustion', 'AbortError');
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: async function* () {
        yield { type: 'text', delta: 'visible before exhaustion' };
        controller.abort(sentinel);
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

    await expect(runtime.run('hi', (event) => {
      events.push(event.type);
    }, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });

    expect(events).not.toContain('run_completed');
  });

  it('persists partial assistant text with sentinel and emits partialText when aborted mid-stream', async () => {
    const controller = new AbortController();
    const session = new AgentSessionState();
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: async function* () {
        yield { type: 'text', delta: 'partial answer' };
        controller.abort();
        yield { type: 'done' };
      },
    };
    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session,
      controller: new AgentRunController(),
      systemPrompt: 'system',
    });

    const events: Array<{ type: string; partialText?: string }> = [];
    await expect(runtime.run('hi', (event) => {
      events.push(event);
    }, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });

    const abortEvent = events.findLast((event) => event.type === 'run_aborted');
    expect(abortEvent?.partialText).toContain('partial answer');
    expect(abortEvent?.partialText).toContain('[partial');
    const assistant = session.getMessages().find((message) => message.role === 'assistant');
    expect(assistant?.content).toContainEqual(expect.objectContaining({
      type: 'text',
      text: expect.stringContaining('partial answer'),
    }));
    expect(JSON.stringify(assistant?.content)).toContain('[partial');
  });

  it('adds synthetic cancelled tool results for unexecuted tool calls when aborted before tool execution', async () => {
    const controller = new AbortController();
    const session = new AgentSessionState();
    const executeTool = vi.fn(async () => 'should not run');
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: async function* () {
        yield { type: 'tool_use', id: 'tu_pending', name: 'read', input: { file: 'a.ts' } };
        controller.abort();
        yield { type: 'done' };
      },
    };
    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock({ executeTool }) as never,
      session,
      controller: new AgentRunController(),
      systemPrompt: 'system',
    });

    await expect(runtime.run('hi', () => {}, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });

    expect(executeTool).not.toHaveBeenCalled();
    const messages = session.getMessages();
    expect(messages.some((message) => message.content.some((block) =>
      block.type === 'tool_use' && block.id === 'tu_pending'
    ))).toBe(true);
    expect(messages.some((message) => message.content.some((block) =>
      block.type === 'tool_result'
      && block.tool_use_id === 'tu_pending'
      && block.content === '[user-cancelled]'
    ))).toBe(true);
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

  it('retries on empty response and succeeds on second attempt', async () => {
    let streamCalls = 0;
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: () => {
        streamCalls++;
        // 第一次返回空响应，第二次返回正常响应
        if (streamCalls === 1) {
          return mockStream([{ type: 'done' }]);
        }
        return mockStream([{ type: 'text', delta: 'hello' }, { type: 'done' }]);
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
    await runtime.run('hi', (event) => {
      events.push(event.type);
    });

    // 应该成功，因为第二次返回了正常响应
    expect(streamCalls).toBe(2);
    expect(events).toContain('assistant_text');
    expect(events.at(-1)).toBe('run_completed');
  });

  it('fails after max retries on persistent empty responses', async () => {
    let streamCalls = 0;
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: () => {
        streamCalls++;
        // 总是返回空响应
        return mockStream([{ type: 'done' }]);
      },
    };
    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session: new AgentSessionState(),
      controller: new AgentRunController(),
      systemPrompt: 'system',
    });

    await expect(runtime.run('hi', () => {})).rejects.toThrow(/已重试 2 次/);

    // 应该尝试了 1 + 2 = 3 次（初次 + 2 次重试）
    expect(streamCalls).toBe(3);
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

  it('passes abort signal into tool execution context', async () => {
    let capturedContext: { signal?: AbortSignal } | undefined;
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
          capturedContext = context as { signal?: AbortSignal };
          return 'ok';
        },
      }) as never,
      session: new AgentSessionState(),
      controller: new AgentRunController(),
      systemPrompt: 'system',
    });

    const controller = new AbortController();
    await runtime.run('hi', () => {}, controller.signal);

    expect(capturedContext?.signal).toBeDefined();
    expect(capturedContext?.signal?.aborted).toBe(false);
    controller.abort();
    expect(capturedContext?.signal?.aborted).toBe(true);
  });

  it('emits a verification guard warning when a code task finishes after edits without tests', async () => {
    let streamCalls = 0;
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: () => {
        streamCalls += 1;
        if (streamCalls === 1) {
          return mockStream([
            { type: 'tool_use', id: 'tu_1', name: 'edit', input: { file_path: '/repo/src/app.ts', old_string: 'a', new_string: 'b' } },
            { type: 'done' },
          ]);
        }
        return mockStream([{ type: 'text', delta: 'done' }, { type: 'done' }]);
      },
    };
    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock({
        executeTool: async () => 'edited file',
      }) as never,
      session: new AgentSessionState(),
      controller: new AgentRunController(),
      systemPrompt: 'system',
    });

    const events: string[] = [];
    await runtime.run('修改 TypeScript 代码里的 bug', (event) => {
      events.push(event.type);
    });

    expect(events).toContain('guard_evaluated');
    expect(events[events.length - 2]).toBe('guard_evaluated');
    expect(events.at(-1)).toBe('run_completed');
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
      contextLimit: 1_000,
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

  it('compacts and restores memory at most once during a multi-tool run', async () => {
    const session = new AgentSessionState();
    session.appendUserText(`old prefix ${'a'.repeat(10_000)}`);
    session.appendAssistantBlocks([{ type: 'text', text: `retained answer ${'b'.repeat(10_000)}` }]);
    session.attachPromptSnapshot('snap_1', ['mem_1'], '/repo');

    const listRelevant = vi.fn(async () => [{
      id: 'mem_1',
      scope: 'global' as const,
      title: 'Large Rule',
      summary: 'm'.repeat(12_000),
      tags: [],
      updatedAt: 1,
    }]);
    let compactCalls = 0;
    let mainCalls = 0;
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: (_messages, _tools, systemPrompt) => {
        if (systemPrompt.includes('TEXT ONLY')) {
          compactCalls += 1;
          return mockStream([{ type: 'text', delta: 'compact summary' }, { type: 'done' }]);
        }
        mainCalls += 1;
        if (mainCalls <= 3) {
          return mockStream([
            {
              type: 'tool_use',
              id: `tu_${mainCalls}`,
              name: 'read',
              input: { path: `${mainCalls}.ts` },
            },
            { type: 'done' },
          ]);
        }
        return mockStream([{ type: 'text', delta: 'final' }, { type: 'done' }]);
      },
    };
    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session,
      controller: new AgentRunController(),
      systemPrompt: 'system',
      contextLimit: 5_000,
      memoryStore: {
        save: async () => {},
        listRelevant,
      },
    });
    const events: string[] = [];

    await runtime.run('current', (event) => events.push(event.type));

    expect(mainCalls).toBe(4);
    expect(compactCalls).toBe(1);
    expect(listRelevant).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event === 'compact_triggered')).toHaveLength(1);
  });

  it.each([
    {
      name: 'remaining threshold headroom',
      contextLimit: 1_000,
      oldChars: 10_000,
      retainedChars: 1_000,
    },
    {
      name: 'the global 8000 character cap',
      contextLimit: 10_000,
      oldChars: 40_000,
      retainedChars: 100,
    },
  ])('bounds restored memory by $name', async ({
    contextLimit,
    oldChars,
    retainedChars,
  }) => {
    const session = new AgentSessionState();
    session.appendUserText(`old prefix ${'a'.repeat(oldChars)}`);
    session.appendAssistantBlocks([{ type: 'text', text: `retained ${'b'.repeat(retainedChars)}` }]);
    session.attachPromptSnapshot('snap_1', ['mem_1'], '/repo');

    let mainMessages = session.getMessages();
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: (messages, _tools, systemPrompt) => {
        if (systemPrompt.includes('TEXT ONLY')) {
          return mockStream([{ type: 'text', delta: 'compact summary' }, { type: 'done' }]);
        }
        mainMessages = messages;
        return mockStream([{ type: 'text', delta: 'final' }, { type: 'done' }]);
      },
    };
    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session,
      controller: new AgentRunController(),
      systemPrompt: 'system',
      contextLimit,
      compactThreshold: 0.85,
      memoryStore: {
        save: async () => {},
        listRelevant: async () => [{
          id: 'mem_1',
          scope: 'global',
          title: 'Large Rule',
          summary: 'm'.repeat(20_000),
          tags: [],
          updatedAt: 1,
        }],
      },
    });

    await runtime.run('current', () => {});

    const reminder = mainMessages
      .flatMap((message) => message.content)
      .find((block) =>
        block.type === 'text' && block.text.includes('[Memory restored after compact]')
      );
    expect(reminder?.type).toBe('text');
    if (reminder?.type !== 'text') throw new Error('memory reminder missing');
    expect(reminder.text.length).toBeLessThanOrEqual(8_000);
    expect(estimateTokens(mainMessages)).toBeLessThanOrEqual(Math.floor(contextLimit * 0.85));
  });
});
