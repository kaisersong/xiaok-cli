import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlatformRegistryFactory } from '../../../src/platform/runtime/registry-factory.js';
import type { PlatformRuntimeContext } from '../../../src/platform/runtime/context.js';
import type { Message, ModelAdapter, ToolExecutionContext } from '../../../src/types.js';
import { CapabilityRegistry } from '../../../src/platform/runtime/capability-registry.js';

function textFromMessages(messages: Message[]): string {
  return messages.flatMap((message) => message.content).map((block) => {
    if (block.type === 'text') return block.text;
    if (block.type === 'tool_result') return block.content;
    return '';
  }).join('\n');
}

describe('multi-agent registry integration', () => {
  const factories: Array<ReturnType<typeof createPlatformRegistryFactory>> = [];

  afterEach(async () => {
    await Promise.all(factories.splice(0).map((factory) => factory.dispose()));
  });

  it('requires explicit orchestration tools and lets an authorized child spawn and follow up its grandchild', async () => {
    const requests: Array<{ messages: Message[]; tools: string[] }> = [];
    const adapter: ModelAdapter = {
      async *stream(messages, tools) {
        const names = tools.map((tool) => tool.name);
        requests.push({ messages: structuredClone(messages), tools: names });
        if (names.includes('spawn_agent')) {
          const results = messages.flatMap((message) => message.content)
            .filter((block) => block.type === 'tool_result');
          if (results.length === 0) {
            yield { type: 'tool_use', id: 'spawn_grandchild', name: 'spawn_agent',
              input: { task_name: 'grandchild', message: 'grandchild initial', tools: ['read'], fork_context: false } } as const;
          } else if (results.length === 1) {
            const grandchild = JSON.parse(results[0].content) as { id: string };
            yield { type: 'tool_use', id: 'followup_grandchild', name: 'followup_task',
              input: { target: grandchild.id, message: 'grandchild followup' } } as const;
          } else {
            yield { type: 'text', delta: 'parent complete' } as const;
          }
        } else {
          yield { type: 'text', delta: 'grandchild complete' } as const;
        }
        yield { type: 'done' } as const;
      },
    };
    const platform = {
      customAgents: [], pluginRuntime: { hookConfigs: [], agentDirs: [] }, mcpTools: [],
      capabilityRegistry: new CapabilityRegistry(),
      createBackgroundRunner: () => ({ dispose: async () => ({ settled: true, pendingJobs: [] }) }),
      createReminderApi: () => undefined,
      onMcpToolsChanged: () => () => undefined,
    } as unknown as PlatformRuntimeContext;
    const factory = createPlatformRegistryFactory({ platform, source: 'chat', sessionId: 'explicit_tools',
      adapter: () => adapter, buildSystemPrompt: async () => 'test' });
    factories.push(factory);
    const root = factory.createRegistry(process.cwd());
    const restricted = factory.createRegistry(process.cwd(), ['read'], 'restricted', { parentDepth: 1 });
    const restrictedNames = restricted.getToolDefinitions().map((tool) => tool.name);
    expect(restrictedNames).toEqual(['read', 'tool_search']);
    for (const name of ['spawn_agent', 'followup_task', 'interrupt_agent', 'close_agent', 'send_message', 'wait_agent', 'list_agents']) {
      expect(restrictedNames).not.toContain(name);
      expect(await restricted.executeTool(name, {})).toContain('未知工具');
    }

    await root.executeTool('spawn_agent', { task_name: 'parent', message: 'parent orchestration',
      tools: ['spawn_agent', 'followup_task'], fork_context: false });
    await vi.waitFor(async () => {
      const agents = JSON.parse(await root.executeTool('list_agents', {}));
      expect(agents).toEqual(expect.arrayContaining([
        expect.objectContaining({ canonicalName: '/root/parent', status: 'completed', executionActive: false }),
        expect.objectContaining({ canonicalName: '/root/parent/grandchild', status: 'completed', turn: 2, executionActive: false }),
      ]));
    });
    const parentRequests = requests.filter((request) => request.tools.includes('spawn_agent'));
    expect(parentRequests.length).toBeGreaterThanOrEqual(3);
    expect(parentRequests[0].tools).toEqual(expect.arrayContaining(['spawn_agent', 'followup_task', 'send_message']));
    expect(parentRequests[0].tools).not.toContain('close_agent');
    expect(textFromMessages(parentRequests.at(-1)!.messages)).toContain('"queued":true');
    expect(requests.some((request) => {
      const text = textFromMessages(request.messages);
      return !request.tools.includes('spawn_agent') && text.includes('grandchild initial') && text.includes('grandchild followup');
    })).toBe(true);
  });

  it('runs a persistent child that can message main and receive a follow-up turn', async () => {
    const providerRequests: Message[][] = [];
    const adapter: ModelAdapter = {
      getModelName: () => 'test-model',
      async *stream(messages, tools) {
        providerRequests.push(structuredClone(messages));
        const last = messages.at(-1);
        const hasToolResult = last?.content.some((block) => block.type === 'tool_result');
        if (!hasToolResult && tools.some((tool) => tool.name === 'send_message')) {
          yield {
            type: 'tool_use',
            id: `tool_${providerRequests.length}`,
            name: 'send_message',
            input: { target: 'main', message: `progress_${providerRequests.length}` },
          } as const;
          yield { type: 'done' } as const;
          return;
        }
        yield { type: 'text', delta: 'child complete' } as const;
        yield { type: 'done' } as const;
      },
    };
    const platform = {
      customAgents: [],
      pluginRuntime: { hookConfigs: [], agentDirs: [] },
      mcpTools: [],
      sandboxEnforcer: undefined,
      sandboxPolicy: { expandAllowedPaths: vi.fn() },
      capabilityRegistry: new CapabilityRegistry(),
      worktreeManager: undefined,
      lspClient: undefined,
      lspManager: undefined,
      teamService: undefined,
      createBackgroundRunner: vi.fn(() => ({
        dispose: vi.fn(async () => ({ settled: true, pendingJobs: [] })),
        start: vi.fn(), get: vi.fn(), listBySession: vi.fn(() => []), listByTask: vi.fn(() => []),
      })),
      createReminderApi: vi.fn(() => undefined),
      mcpReady: Promise.resolve(),
      onMcpToolsChanged: vi.fn(() => () => undefined),
    } as unknown as PlatformRuntimeContext;
    const factory = createPlatformRegistryFactory({
      platform,
      source: 'chat',
      sessionId: 'sess_multi_agent',
      adapter: () => adapter,
      buildSystemPrompt: async () => 'system prompt',
    });
    factories.push(factory);
    const registry = factory.createRegistry('/test/cwd');
    const context = {
      taskId: 'task_main',
      session: {},
      messages: [],
      systemPrompt: 'system prompt',
      toolDefinitions: registry.getToolDefinitions(),
    } as ToolExecutionContext;

    const spawnResult = JSON.parse(await registry.executeTool('spawn_agent', {
      task_name: 'research',
      message: 'first task',
      fork_context: false,
    }, context)) as { id: string };
    expect(spawnResult.id).toMatch(/^agent_/);

    const firstUpdate = JSON.parse(await registry.executeTool('wait_agent', {
      targets: [spawnResult.id], timeout_ms: 10_000,
    }, context)) as { messages: Array<{ senderId: string; text: string }>; agents: Array<{ status: string }> };
    expect(firstUpdate.messages).toContainEqual(expect.objectContaining({
      senderId: spawnResult.id,
      text: expect.stringContaining('progress_'),
    }));

    let firstTerminal = firstUpdate;
    for (let attempt = 0; attempt < 3 && firstTerminal.agents[0]?.status !== 'completed'; attempt++) {
      firstTerminal = JSON.parse(await registry.executeTool('wait_agent', {
        targets: [spawnResult.id], timeout_ms: 10_000,
      }, context));
    }
    expect(firstTerminal.agents[0]?.status).toBe('completed');

    expect(JSON.parse(await registry.executeTool('followup_task', {
      target: spawnResult.id,
      message: 'second task',
    }, context))).toEqual({ queued: true });

    let secondTerminal = JSON.parse(await registry.executeTool('wait_agent', {
      targets: [spawnResult.id], timeout_ms: 10_000,
    }, context));
    for (let attempt = 0; attempt < 3 && secondTerminal.agents[0]?.status !== 'completed'; attempt++) {
      secondTerminal = JSON.parse(await registry.executeTool('wait_agent', {
        targets: [spawnResult.id], timeout_ms: 10_000,
      }, context));
    }
    expect(secondTerminal.agents[0]?.status).toBe('completed');

    expect(providerRequests.some((messages) => {
      const text = textFromMessages(messages);
      return text.includes('first task') && text.includes('second task');
    })).toBe(true);
  });
});
