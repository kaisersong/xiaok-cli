import { describe, it, expect, vi } from 'vitest';
import type { Message, ModelAdapter, StreamChunk, ToolDefinition } from '../../src/types.js';
import type { StreamOptions } from '../../src/ai/runtime/model-capabilities.js';
import { ToolRegistry } from '../../src/ai/tools/index.js';

async function* mockStream(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const c of chunks) yield c;
}

interface RunInvocationContext {
  cacheKey?: string;
}

function createRegistryMock(overrides?: {
  getToolDefinitions?: () => ToolDefinition[];
  executeTool?: (name: string, input: Record<string, unknown>, context?: Record<string, unknown>) => Promise<string>;
}) {
  return {
    getToolDefinitions: overrides?.getToolDefinitions ?? (() => []),
    executeTool: overrides?.executeTool ?? (async () => 'ok'),
  };
}

describe('Agent', () => {
  it('forwards an immutable per-run invocation context to the adapter', async () => {
    const captured: Array<StreamOptions | undefined> = [];
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: (_messages, _tools, _systemPrompt, options) => {
        captured.push(options);
        return mockStream([{ type: 'text', delta: 'ok' }, { type: 'done' }]);
      },
    };
    const registry = createRegistryMock();
    const agent = new (await import('../../src/ai/agent.js')).Agent(
      adapter,
      registry as never,
      'system',
    );
    const invocationContext = Object.freeze({
      cacheKey: `pc1_${'a'.repeat(64)}`,
    }) satisfies RunInvocationContext;
    const runTurn = agent.runTurn.bind(agent) as (
      input: string,
      onChunk: (chunk: StreamChunk) => void,
      signal?: AbortSignal,
      context?: RunInvocationContext,
    ) => Promise<void>;

    await runTurn('hi', () => {}, undefined, invocationContext);

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ cacheKey: invocationContext.cacheKey });
  });

  it('keeps direct Agent calls without invocation context cache-key free', async () => {
    const captured: Array<StreamOptions | undefined> = [];
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: (_messages, _tools, _systemPrompt, options) => {
        captured.push(options);
        return mockStream([{ type: 'text', delta: 'ok' }, { type: 'done' }]);
      },
    };
    const agent = new (await import('../../src/ai/agent.js')).Agent(
      adapter,
      createRegistryMock() as never,
      'system',
    );

    await agent.runTurn('classifier-style call', () => {});

    expect(captured).toHaveLength(1);
    expect(captured[0]).not.toHaveProperty('cacheKey');
  });

  it('returns text response without tool calls', async () => {
    const { Agent } = await import('../../src/ai/agent.js');
    const adapter: ModelAdapter = {
      stream: () => mockStream([
        { type: 'text', delta: 'Hello ' },
        { type: 'text', delta: 'world' },
        { type: 'done' },
      ]),
    };
    const registry = new ToolRegistry({ autoMode: true, dryRun: false, onPrompt: async () => true });
    const agent = new Agent(adapter, registry, 'system');

    const outputs: string[] = [];
    await agent.runTurn('hi', (chunk) => { if (chunk.type === 'text') outputs.push(chunk.delta); });
    expect(outputs.join('')).toBe('Hello world');
  });

  it('reports runtime activity events to an optional observer', async () => {
    const { Agent } = await import('../../src/ai/agent.js');
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: () => mockStream([
        { type: 'text', delta: 'done' },
        { type: 'done' },
      ]),
    };
    const agent = new Agent(adapter, createRegistryMock() as never, 'system');
    const eventTypes: string[] = [];

    await agent.runTurn(
      'hi',
      () => {},
      undefined,
      undefined,
      (event) => eventTypes.push(event.type),
    );

    expect(eventTypes).toContain('run_started');
    expect(eventTypes).toContain('assistant_text');
    expect(eventTypes).toContain('run_completed');
  });

  it('executes a tool call and loops back', async () => {
    const { Agent } = await import('../../src/ai/agent.js');
    let callCount = 0;
    const adapter: ModelAdapter = {
      stream: () => {
        callCount++;
        if (callCount === 1) {
          return mockStream([
            { type: 'tool_use', id: 'tu_1', name: 'glob', input: { pattern: '*.nonexistent' } },
            { type: 'done' },
          ]);
        }
        return mockStream([{ type: 'text', delta: 'Done' }, { type: 'done' }]);
      },
    };
    const registry = new ToolRegistry({ autoMode: true, dryRun: false, onPrompt: async () => true });
    const agent = new Agent(adapter, registry, 'system');

    const outputs: string[] = [];
    await agent.runTurn('list files', (chunk) => { if (chunk.type === 'text') outputs.push(chunk.delta); });
    expect(callCount).toBe(2);
    expect(outputs.join('')).toBe('Done');
  });

  it('dry-run emits tool description without executing', async () => {
    const { Agent } = await import('../../src/ai/agent.js');
    let callCount = 0;
    const adapter: ModelAdapter = {
      stream: () => {
        callCount++;
        if (callCount === 1) {
          return mockStream([
            { type: 'tool_use', id: 'tu_1', name: 'bash', input: { command: 'rm -rf /' } },
            { type: 'done' },
          ]);
        }
        // 第二轮：模型收到 dry-run 结果后返回纯文本（无工具调用），循环结束
        return mockStream([{ type: 'text', delta: 'done' }, { type: 'done' }]);
      },
    };
    const registry = new ToolRegistry({ autoMode: false, dryRun: true, onPrompt: async () => true });
    vi.spyOn(registry, 'executeTool').mockResolvedValue('[dry-run] bash({"command":"rm -rf /"})');
    const agent = new Agent(adapter, registry, 'system');
    await agent.runTurn('bad', () => {});
    expect(registry.executeTool).toHaveBeenCalledWith('bash', { command: 'rm -rf /' }, expect.any(Object));
  });

  it('stops when max iterations is reached', async () => {
    const { Agent } = await import('../../src/ai/agent.js');
    let streamCalls = 0;
    const adapter: ModelAdapter = {
      stream: () => {
        streamCalls += 1;
        if (streamCalls > 3) {
          throw new Error('loop sentinel');
        }

        return mockStream([
          { type: 'tool_use', id: '1', name: 'read', input: { file_path: 'x' } },
          { type: 'done' },
        ]);
      },
    };
    const registry = createRegistryMock();
    const agent = new Agent(adapter, registry as never, 'system', { maxIterations: 2 });

    const chunks: StreamChunk[] = [];
    await agent.runTurn('loop', (chunk) => { chunks.push(chunk); });

    // max_iterations_reached emits an event but does not throw; the turn completes gracefully.
    expect(streamCalls).toBeLessThanOrEqual(3); // 2 iterations + possibly 1 compact call
  });

  it('aborts when signal is cancelled before execution', async () => {
    const { Agent } = await import('../../src/ai/agent.js');
    const adapter: ModelAdapter = {
      stream: () => mockStream([{ type: 'text', delta: 'ignored' }, { type: 'done' }]),
    };
    const registry = createRegistryMock();
    const agent = new Agent(adapter, registry as never, 'system');
    const controller = new AbortController();
    controller.abort();

    await expect(agent.runTurn('hi', () => {}, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('emits turn_aborted with partial text and turn_stop when a run is interrupted', async () => {
    const { Agent } = await import('../../src/ai/agent.js');
    const controller = new AbortController();
    const adapter: ModelAdapter = {
      stream: async function* () {
        yield { type: 'text', delta: 'partial answer' };
        controller.abort();
        yield { type: 'done' };
      },
    };
    const registry = createRegistryMock();
    const events: unknown[] = [];
    const agent = new Agent(adapter, registry as never, 'system', {
      hooks: {
        emit: (event) => {
          events.push(event);
        },
      },
    });

    await expect(agent.runTurn('hi', () => {}, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });

    expect(events).toContainEqual(expect.objectContaining({
      type: 'turn_aborted',
      partialText: expect.stringContaining('partial answer'),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'turn_stop',
      reason: 'user_aborted',
    }));
  });

  it('forwards usage chunks while streaming', async () => {
    const { Agent } = await import('../../src/ai/agent.js');
    const adapter: ModelAdapter = {
      stream: () => mockStream([
        { type: 'text', delta: 'hello' },
        { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
        { type: 'done' },
      ]),
    };
    const registry = createRegistryMock();
    const agent = new Agent(adapter, registry as never, 'system');

    const chunks: StreamChunk[] = [];
    await agent.runTurn('hi', (chunk) => { chunks.push(chunk); });

    expect(chunks).toContainEqual({
      type: 'usage',
      usage: { inputTokens: 10, outputTokens: 5 },
    });
  });

  it('compacts older history before streaming when context threshold is exceeded', async () => {
    const { Agent } = await import('../../src/ai/agent.js');
    const seenMessages: Message[][] = [];
    const adapter: ModelAdapter = {
      stream: (messages, _tools, systemPrompt) => {
        seenMessages.push(messages.map((message) => ({
          role: message.role,
          content: message.content.map((block) => ({ ...block })),
        })));

        if (systemPrompt.includes('TEXT ONLY')) {
          return mockStream([
            { type: 'text', delta: 'LLM summary: preserve the first request' },
            { type: 'done' },
          ]);
        }
        return mockStream([{ type: 'text', delta: 'ok' }, { type: 'done' }]);
      },
    };
    const registry = createRegistryMock();
    const agent = new Agent(adapter, registry as never, 'system', { contextLimit: 8 });

    await agent.runTurn(`first request ${'a'.repeat(10_000)}`, () => {});
    await agent.runTurn('abcdefghijklmnopqrstuvwxyz', () => {});

    // CompactRunner makes an extra stream call for AI summarization.
    // Find any turn that received a compacted history.
    const turnWithCompaction = seenMessages.find((msgs) =>
      msgs.some((m) => m.content.some((b) =>
        b.type === 'text'
        && (b as { type: 'text'; text: string }).text === 'LLM summary: preserve the first request'
      ))
    );
    expect(turnWithCompaction).toBeDefined();
  });

  it('emits turn lifecycle events through runtime hooks', async () => {
    const { Agent } = await import('../../src/ai/agent.js');
    const events: unknown[] = [];
    const adapter: ModelAdapter = {
      stream: () => mockStream([{ type: 'text', delta: 'ok' }, { type: 'done' }]),
    };
    const registry = createRegistryMock();
    const agent = new Agent(adapter, registry as never, 'system', {
      hooks: {
        emit: (event) => {
          events.push(event);
        },
      },
    });

    await agent.runTurn('hi', () => {});

    expect(events.map((event) => (event as { type: string }).type)).toEqual([
      'turn_started',
      'turn_completed',
      'turn_stop',
    ]);
    expect(events.at(-1)).toMatchObject({
      type: 'turn_stop',
      reason: 'completed',
    });
  });

  it('emits tool lifecycle events through runtime hooks', async () => {
    const { Agent } = await import('../../src/ai/agent.js');
    let streamCalls = 0;
    const events: string[] = [];
    const adapter: ModelAdapter = {
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
    const registry = createRegistryMock();
    const agent = new Agent(adapter, registry as never, 'system', {
      hooks: {
        emit: (event) => {
          events.push(event.type);
        },
      },
    });

    await agent.runTurn('find ts files', () => {});

    expect(events).toContain('tool_started');
    expect(events).toContain('tool_finished');
  });

  it('emits failure lifecycle events through runtime hooks', async () => {
    const { Agent } = await import('../../src/ai/agent.js');
    const events: unknown[] = [];
    const adapter: ModelAdapter = {
      stream: () => {
        throw new Error('tool_failed');
      },
    };
    const registry = createRegistryMock();
    const agent = new Agent(adapter, registry as never, 'system', {
      hooks: {
        emit: (event) => {
          events.push(event);
        },
      },
    });

    await expect(agent.runTurn('hi', () => {})).rejects.toThrow('tool_failed');

    expect(events.map((event) => (event as { type: string }).type)).toEqual([
      'turn_started',
      'turn_failed',
      'turn_stop',
    ]);
    expect(events.at(-1)).toMatchObject({
      type: 'turn_stop',
      reason: 'error',
    });
  });

  it('uses an updated system prompt for subsequent turns', async () => {
    const { Agent } = await import('../../src/ai/agent.js');
    const prompts: string[] = [];
    const adapter: ModelAdapter = {
      stream: (_messages, _tools, systemPrompt) => {
        prompts.push(systemPrompt);
        return mockStream([{ type: 'text', delta: 'ok' }, { type: 'done' }]);
      },
    };
    const registry = createRegistryMock();
    const agent = new Agent(adapter, registry as never, 'system');

    await agent.runTurn('first', () => {});
    agent.setSystemPrompt('updated system');
    await agent.runTurn('second', () => {});

    expect(prompts).toEqual(['system', 'updated system']);
  });

  it('exports and restores session state for later resume', async () => {
    const { Agent } = await import('../../src/ai/agent.js');
    const seenMessages: Message[][] = [];
    let streamCalls = 0;
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: (messages) => {
        streamCalls += 1;
        seenMessages.push(messages.map((message) => ({
          role: message.role,
          content: message.content.map((block) => ({ ...block })),
        })));

        if (streamCalls === 1) {
          return mockStream([
            { type: 'text', delta: 'first answer' },
            { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
            { type: 'done' },
          ]);
        }

        return mockStream([{ type: 'text', delta: 'second answer' }, { type: 'done' }]);
      },
    };
    const registry = createRegistryMock();
    const agent = new Agent(adapter, registry as never, 'system');

    await agent.runTurn('first', () => {});
    const snapshot = agent.exportSession();

    const resumed = new Agent(adapter, registry as never, 'system');
    resumed.restoreSession(snapshot);
    await resumed.runTurn('second', () => {});

    expect(snapshot.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(seenMessages[1]).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'first' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'first answer' }] },
      { role: 'user', content: [{ type: 'text', text: 'second' }] },
    ]);
  });
});

describe('declined tool calls are reported as failures', () => {
  function twoRoundAdapter(
    toolCall: { id: string; name: string; input: Record<string, unknown> },
    seenMessages: Message[][],
  ): ModelAdapter {
    let streamCalls = 0;
    return {
      stream: (messages) => {
        seenMessages.push(messages.map((message) => ({
          role: message.role,
          content: message.content.map((block) => ({ ...block })),
        })));
        streamCalls += 1;
        if (streamCalls === 1) {
          return mockStream([
            { type: 'tool_use', ...toolCall },
            { type: 'done' },
          ]);
        }
        return mockStream([{ type: 'text', delta: 'done' }, { type: 'done' }]);
      },
    };
  }

  it('marks tool_finished not-ok and sets is_error on the replayed tool result', async () => {
    const { Agent } = await import('../../src/ai/agent.js');
    const seenMessages: Message[][] = [];
    const events: unknown[] = [];
    const adapter = twoRoundAdapter(
      { id: 'tu_1', name: 'bash', input: { command: 'rm -rf ./build' } },
      seenMessages,
    );
    const registry = createRegistryMock({
      executeTool: async () => '（已取消: bash）',
    });
    const agent = new Agent(adapter, registry as never, 'system', {
      hooks: { emit: (event) => { events.push(event); } },
    });

    await agent.runTurn('清理构建产物', () => {});

    expect(events).toContainEqual(expect.objectContaining({
      type: 'tool_finished',
      ok: false,
    }));

    const replayed = seenMessages.at(-1) ?? [];
    const toolResult = replayed
      .flatMap((message) => message.content)
      .find((block) => block.type === 'tool_result');
    expect(toolResult).toMatchObject({ type: 'tool_result', is_error: true });
  });

  it('no longer accepts a declined verification command as verification evidence', async () => {
    const { Agent } = await import('../../src/ai/agent.js');
    const seenMessages: Message[][] = [];
    const events: unknown[] = [];
    // `npm run build` is the only single call that satisfies both the
    // code-mutating classifier and the verification patterns.
    const adapter = twoRoundAdapter(
      { id: 'tu_1', name: 'bash', input: { command: 'npm run build' } },
      seenMessages,
    );
    const registry = createRegistryMock({
      executeTool: async () => '（已取消: bash）',
    });
    const agent = new Agent(adapter, registry as never, 'system', {
      hooks: { emit: (event) => { events.push(event); } },
    });

    await agent.runTurn('修复代码里的类型错误', () => {});

    expect(events).toContainEqual(expect.objectContaining({
      type: 'guard_evaluated',
      guardId: 'verification-before-completion',
      category: 'missing_verification',
    }));
  });
});
