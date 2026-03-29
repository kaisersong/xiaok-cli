import { describe, it, expect, vi } from 'vitest';
import type { Message, ModelAdapter, StreamChunk, ToolDefinition } from '../../src/types.js';
import { ToolRegistry } from '../../src/ai/tools/index.js';

async function* mockStream(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const c of chunks) yield c;
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

describe('Agent', () => {
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
        return mockStream([{ type: 'done' }]);
      },
    };
    const registry = new ToolRegistry({ autoMode: false, dryRun: true, onPrompt: async () => true });
    vi.spyOn(registry, 'executeTool').mockResolvedValue('[dry-run] bash({"command":"rm -rf /"})');
    const agent = new Agent(adapter, registry, 'system');
    await agent.runTurn('bad', () => {});
    expect(registry.executeTool).toHaveBeenCalledWith('bash', { command: 'rm -rf /' });
  });

  it('stops when max iterations is reached', async () => {
    const { Agent } = await import('../../src/ai/agent.js');
    let streamCalls = 0;
    const adapter: ModelAdapter = {
      stream: () => {
        streamCalls += 1;
        if (streamCalls > 2) {
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

    await expect(agent.runTurn('loop', () => {})).rejects.toThrow(/max iterations/i);
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

    await expect(agent.runTurn('hi', () => {}, controller.signal)).rejects.toThrow(/aborted/i);
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
      stream: (messages) => {
        seenMessages.push(messages.map((message) => ({
          role: message.role,
          content: message.content.map((block) => ({ ...block })),
        })));

        return mockStream([{ type: 'text', delta: 'ok' }, { type: 'done' }]);
      },
    };
    const registry = createRegistryMock();
    const agent = new Agent(adapter, registry as never, 'system', { contextLimit: 8 });

    await agent.runTurn('12345678901234567890', () => {});
    await agent.runTurn('abcdefghijklmnopqrstuvwxyz', () => {});

    expect(seenMessages[1]?.[0]?.content).toContainEqual({
      type: 'text',
      text: '[context compacted]',
    });
  });

  it('emits turn lifecycle events through runtime hooks', async () => {
    const { Agent } = await import('../../src/ai/agent.js');
    const events: string[] = [];
    const adapter: ModelAdapter = {
      stream: () => mockStream([{ type: 'text', delta: 'ok' }, { type: 'done' }]),
    };
    const registry = createRegistryMock();
    const agent = new Agent(adapter, registry as never, 'system', {
      hooks: {
        emit: (event) => {
          events.push(event.type);
        },
      },
    });

    await agent.runTurn('hi', () => {});

    expect(events).toEqual(['turn_started', 'turn_completed']);
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

  it('uses an updated system prompt for subsequent turns', async () => {
    const { Agent } = await import('../../src/ai/agent.js');
    const prompts: string[] = [];
    const adapter: ModelAdapter = {
      stream: (_messages, _tools, systemPrompt) => {
        prompts.push(systemPrompt);
        return mockStream([{ type: 'done' }]);
      },
    };
    const registry = createRegistryMock();
    const agent = new Agent(adapter, registry as never, 'system');

    await agent.runTurn('first', () => {});
    agent.setSystemPrompt('updated system');
    await agent.runTurn('second', () => {});

    expect(prompts).toEqual(['system', 'updated system']);
  });
});
