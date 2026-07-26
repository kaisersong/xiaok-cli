import { describe, expect, it, vi } from 'vitest';
import { Agent } from '../../../src/ai/agent.js';
import { RuntimeFacade } from '../../../src/ai/runtime/runtime-facade.js';
import { createPromptCacheAffinity } from '../../../src/ai/runtime/prompt-cache-affinity.js';
import type { StreamOptions } from '../../../src/ai/runtime/model-capabilities.js';
import type { ModelAdapter, StreamChunk } from '../../../src/types.js';

async function* streamChunks(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function createRealFacade(
  adapter: ModelAdapter,
  registry: {
    getToolDefinitions(): [];
    executeTool(name: string, input: Record<string, unknown>): Promise<string>;
  } = {
    getToolDefinitions: () => [],
    executeTool: async () => 'ok',
  },
): { facade: RuntimeFacade; agent: Agent } {
  const agent = new Agent(adapter, registry as never, 'system');
  return {
    agent,
    facade: new RuntimeFacade({
      promptBuilder: {
        build: async ({ cwd, channel }) => ({
          id: 'prompt_runtime_facade_integration',
          rendered: 'system',
          memoryRefs: [],
          segments: [],
          createdAt: 1,
          cwd,
          channel,
        }),
      },
      getPromptInput: async () => ({
        enterpriseId: null,
        devApp: null,
        budget: 2000,
        skills: [],
        deferredTools: [],
        agents: [],
        pluginCommands: [],
        lspDiagnostics: '',
      }),
      agent,
    }),
  };
}

describe('RuntimeFacade', () => {
  it('passes the same cache affinity through the real Agent runtime on two turns of one UUID session', async () => {
    const captured: Array<StreamOptions | undefined> = [];
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: (_messages, _tools, _systemPrompt, options) => {
        captured.push(options);
        return streamChunks([{ type: 'text', delta: 'ok' }, { type: 'done' }]);
      },
    };
    const { facade } = createRealFacade(adapter);
    const sessionId = 'sess_11111111-1111-4111-8111-111111111111';

    await facade.runTurn({ sessionId, cwd: '/repo', source: 'chat', input: 'first' }, () => {});
    await facade.runTurn({ sessionId, cwd: '/repo', source: 'chat', input: 'second' }, () => {});

    expect(captured).toHaveLength(2);
    expect(captured.map((options) => options?.cacheKey)).toEqual([
      createPromptCacheAffinity(sessionId),
      createPromptCacheAffinity(sessionId),
    ]);
  });

  it('keeps one cache affinity and effective signal across a real tool-use continuation', async () => {
    const captured: Array<StreamOptions | undefined> = [];
    let callCount = 0;
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: (_messages, _tools, _systemPrompt, options) => {
        captured.push(options);
        callCount += 1;
        return callCount === 1
          ? streamChunks([
              { type: 'tool_use', id: 'tool_1', name: 'fixture_tool', input: {} },
              { type: 'done' },
            ])
          : streamChunks([{ type: 'text', delta: 'finished' }, { type: 'done' }]);
      },
    };
    const { facade } = createRealFacade(adapter, {
      getToolDefinitions: () => [],
      executeTool: async () => 'fixture result',
    });
    const controller = new AbortController();
    const sessionId = 'sess_22222222-2222-4222-8222-222222222222';

    await facade.runTurn(
      { sessionId, cwd: '/repo', source: 'chat', input: 'use a tool' },
      () => {},
      controller.signal,
    );

    expect(captured).toHaveLength(2);
    expect(captured[0]?.cacheKey).toBe(createPromptCacheAffinity(sessionId));
    expect(captured[1]?.cacheKey).toBe(captured[0]?.cacheKey);
    expect(captured[1]?.signal).toBe(captured[0]?.signal);
    expect(captured[0]?.signal?.aborted).toBe(false);
    controller.abort();
    expect(captured[0]?.signal?.aborted).toBe(true);
  });

  it('leaves new-chat identity to the caller: clearHistory retains affinity while new and fork IDs change it', async () => {
    const capturedKeys: Array<string | undefined> = [];
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: (_messages, _tools, _systemPrompt, options) => {
        capturedKeys.push(options?.cacheKey);
        return streamChunks([{ type: 'text', delta: 'ok' }, { type: 'done' }]);
      },
    };
    const { facade, agent } = createRealFacade(adapter);
    const sourceId = 'sess_33333333-3333-4333-8333-333333333333';
    const newId = 'sess_44444444-4444-4444-8444-444444444444';
    const forkId = 'sess_55555555-5555-4555-8555-555555555555';

    await facade.runTurn({ sessionId: sourceId, cwd: '/repo', source: 'chat', input: 'source' }, () => {});
    agent.clearHistory();
    await facade.runTurn({ sessionId: sourceId, cwd: '/repo', source: 'chat', input: 'fresh context' }, () => {});
    await facade.runTurn({ sessionId: newId, cwd: '/repo', source: 'chat', input: 'new chat' }, () => {});
    await facade.runTurn({ sessionId: forkId, cwd: '/repo', source: 'chat', input: 'fork' }, () => {});

    expect(capturedKeys[1]).toBe(capturedKeys[0]);
    expect(new Set(capturedKeys).size).toBe(3);
    expect(capturedKeys[2]).not.toBe(capturedKeys[0]);
    expect(capturedKeys[3]).not.toBe(capturedKeys[0]);
    expect(capturedKeys[3]).not.toBe(capturedKeys[2]);
  });

  it('derives cache affinity only from the RuntimeTurnRequest session ID', async () => {
    const promptBuilder = {
      build: vi.fn().mockResolvedValue({
        id: 'prompt_1',
        rendered: 'system',
        memoryRefs: [],
        segments: [],
        createdAt: 1,
        cwd: '/repo',
        channel: 'chat',
      }),
    };
    const agent = {
      getSessionState: vi.fn(() => ({ attachPromptSnapshot: vi.fn() })),
      setPromptSnapshot: vi.fn(),
      setSystemPrompt: vi.fn(),
      runTurn: vi.fn().mockResolvedValue(undefined),
    };
    const facade = new RuntimeFacade({
      promptBuilder,
      getPromptInput: async () => ({
        enterpriseId: null,
        devApp: null,
        budget: 2000,
        skills: [],
        deferredTools: [],
        agents: [],
        pluginCommands: [],
        lspDiagnostics: '',
      }),
      agent,
    });
    const sessionId = 'sess_ffffffff-ffff-4fff-8fff-ffffffffffff';

    await facade.runTurn({
      sessionId,
      cwd: '/repo',
      source: 'chat',
      input: 'hello',
    }, () => {});

    expect(agent.runTurn).toHaveBeenCalledWith(
      'hello',
      expect.any(Function),
      undefined,
      { cacheKey: createPromptCacheAffinity(sessionId) },
    );
  });

  it('does not invent cache affinity for a legacy session ID', async () => {
    const agent = {
      getSessionState: vi.fn(() => ({ attachPromptSnapshot: vi.fn() })),
      setPromptSnapshot: vi.fn(),
      setSystemPrompt: vi.fn(),
      runTurn: vi.fn().mockResolvedValue(undefined),
    };
    const facade = new RuntimeFacade({
      promptBuilder: {
        build: vi.fn().mockResolvedValue({
          id: 'prompt_1',
          rendered: 'system',
          memoryRefs: [],
          segments: [],
          createdAt: 1,
          cwd: '/repo',
          channel: 'chat',
        }),
      },
      getPromptInput: async () => ({
        enterpriseId: null,
        devApp: null,
        budget: 2000,
        skills: [],
        deferredTools: [],
        agents: [],
        pluginCommands: [],
        lspDiagnostics: '',
      }),
      agent,
    });

    await facade.runTurn({
      sessionId: 'sess_1',
      cwd: '/repo',
      source: 'chat',
      input: 'legacy',
    }, () => {});

    expect(agent.runTurn).toHaveBeenCalledWith(
      'legacy',
      expect.any(Function),
      undefined,
    );
  });

  it('builds a prompt snapshot once and attaches it to the session before running the turn', async () => {
    const promptBuilder = {
      build: vi.fn().mockResolvedValue({
        id: 'prompt_1',
        rendered: 'system',
        memoryRefs: ['mem_1'],
        segments: [],
        createdAt: 1,
        cwd: '/repo',
        channel: 'chat',
      }),
    };
    const sessionState = {
      attachPromptSnapshot: vi.fn(),
    };
    const agent = {
      getSessionState: vi.fn(() => sessionState),
      setPromptSnapshot: vi.fn(),
      setSystemPrompt: vi.fn(),
      runTurn: vi.fn().mockResolvedValue(undefined),
    };

    const facade = new RuntimeFacade({
      promptBuilder,
      getPromptInput: async (cwd) => ({
        cwd,
        enterpriseId: null,
        devApp: null,
        budget: 2000,
        skills: [],
        deferredTools: [],
        agents: [],
        pluginCommands: [],
        lspDiagnostics: '',
      }),
      agent,
    });

    await facade.runTurn({ sessionId: 'sess_1', cwd: '/repo', source: 'chat', input: 'hello' }, () => {});

    expect(promptBuilder.build).toHaveBeenCalledOnce();
    expect(sessionState.attachPromptSnapshot).toHaveBeenCalledWith('prompt_1', ['mem_1'], '/repo');
    expect(agent.setPromptSnapshot).toHaveBeenCalledWith(expect.objectContaining({ id: 'prompt_1' }));
  });

  it('prepends an intent reminder and run-contract block before the user input', async () => {
    const promptBuilder = {
      build: vi.fn().mockResolvedValue({
        id: 'prompt_1',
        rendered: 'system',
        memoryRefs: [],
        segments: [],
        createdAt: 1,
        cwd: '/repo',
        channel: 'chat',
      }),
    };
    const sessionState = { attachPromptSnapshot: vi.fn() };
    const agent = {
      getSessionState: vi.fn(() => sessionState),
      setPromptSnapshot: vi.fn(),
      setSystemPrompt: vi.fn(),
      runTurn: vi.fn().mockResolvedValue(undefined),
    };

    const facade = new RuntimeFacade({
      promptBuilder,
      getPromptInput: async () => ({
        enterpriseId: null,
        devApp: null,
        budget: 2000,
        skills: [],
        deferredTools: [],
        agents: [],
        pluginCommands: [],
        lspDiagnostics: '',
      }),
      agent,
      getIntentReminderBlock: () => ({
        type: 'text',
        text: '<system-reminder>Intent run contract: proposal_draft via generate_v1</system-reminder>',
      }),
    });

    await facade.runTurn({ sessionId: 'sess_1', cwd: '/repo', source: 'chat', input: 'hello' }, () => {});

    expect(agent.runTurn).toHaveBeenCalledWith(
      [
        { type: 'text', text: '<system-reminder>Intent run contract: proposal_draft via generate_v1</system-reminder>' },
        { type: 'text', text: 'hello' },
      ],
      expect.any(Function),
      undefined,
    );
  });

  it('does not inject a reminder block when no intent reminder hook is provided', async () => {
    const promptBuilder = {
      build: vi.fn().mockResolvedValue({
        id: 'prompt_1',
        rendered: 'system',
        memoryRefs: [],
        segments: [],
        createdAt: 1,
        cwd: '/repo',
        channel: 'chat',
      }),
    };
    const sessionState = { attachPromptSnapshot: vi.fn() };
    const agent = {
      getSessionState: vi.fn(() => sessionState),
      setPromptSnapshot: vi.fn(),
      setSystemPrompt: vi.fn(),
      runTurn: vi.fn().mockResolvedValue(undefined),
    };

    const facade = new RuntimeFacade({
      promptBuilder,
      getPromptInput: async () => ({
        enterpriseId: null,
        devApp: null,
        budget: 2000,
        skills: [],
        deferredTools: [],
        agents: [],
        pluginCommands: [],
        lspDiagnostics: '',
      }),
      agent,
    });

    await facade.runTurn({ sessionId: 'sess_1', cwd: '/repo', source: 'chat', input: 'hello' }, () => {});

    expect(agent.runTurn).toHaveBeenCalledWith('hello', expect.any(Function), undefined);
  });

  it('rethrows abort errors and rolls back skill dedupe for the next turn', async () => {
    const promptBuilder = {
      build: vi.fn().mockResolvedValue({
        id: 'prompt_1',
        rendered: 'system',
        memoryRefs: [],
        segments: [],
        createdAt: 1,
        cwd: '/repo',
        channel: 'chat',
      }),
    };
    const sessionState = { attachPromptSnapshot: vi.fn() };
    const abortError = new DOMException('agent aborted', 'AbortError');
    const agent = {
      getSessionState: vi.fn(() => sessionState),
      setPromptSnapshot: vi.fn(),
      setSystemPrompt: vi.fn(),
      runTurn: vi.fn()
        .mockRejectedValueOnce(abortError)
        .mockResolvedValueOnce(undefined),
    };

    const facade = new RuntimeFacade({
      promptBuilder,
      getPromptInput: async () => ({
        enterpriseId: null,
        devApp: null,
        budget: 2000,
        skills: [],
        deferredTools: [],
        agents: [],
        pluginCommands: [],
        lspDiagnostics: '',
      }),
      agent,
      getSkillEntries: () => [
        { name: 'review', listing: '- review: inspect changes' },
      ],
    });

    await expect(facade.runTurn({ sessionId: 'sess_1', cwd: '/repo', source: 'chat', input: 'hello' }, () => {}))
      .rejects.toBe(abortError);

    await facade.runTurn({ sessionId: 'sess_1', cwd: '/repo', source: 'chat', input: 'hello again' }, () => {});

    expect(agent.runTurn).toHaveBeenNthCalledWith(
      2,
      [
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('- review: inspect changes'),
        }),
        { type: 'text', text: 'hello again' },
      ],
      expect.any(Function),
      undefined,
    );
  });
});
