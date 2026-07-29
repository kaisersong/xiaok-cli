import { describe, expect, it, vi, beforeEach } from 'vitest';
import { executeNamedSubAgent } from '../../../src/ai/agents/subagent-executor.js';
import type { ModelAdapter } from '../../../src/types.js';
import type { ToolRegistry } from '../../../src/ai/tools/index.js';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { createAdapterFromBinding } from '../../../src/ai/models.js';

// Mock the Agent class
vi.mock('../../../src/ai/agent.js', () => ({
  Agent: vi.fn().mockImplementation(() => ({
    runTurn: vi.fn().mockImplementation(async (_prompt, onChunk) => {
      onChunk({ type: 'text', delta: 'agent result' });
    }),
    getSessionState: () => ({ attachPromptSnapshot: vi.fn() }),
    restoreSession: vi.fn(),
    setPromptSnapshot: vi.fn(),
  })),
}));

import { Agent } from '../../../src/ai/agent.js';

const mockAdapter = {
  name: 'test',
  generate: vi.fn(),
  stream: vi.fn(),
} as unknown as ModelAdapter;

const mockRegistry = {} as unknown as ToolRegistry;

describe('subagent-executor system prompt isolation', () => {
  let capturedSystemPrompt = '';

  beforeEach(() => {
    vi.clearAllMocks();
    capturedSystemPrompt = '';
  });

  it('ignores forkContext.systemPrompt and always uses buildSystemPrompt', async () => {
    const buildSystemPrompt = vi.fn().mockImplementation(async (cwd) => {
      capturedSystemPrompt = `xiaok prompt for ${cwd}`;
      return capturedSystemPrompt;
    });

    await executeNamedSubAgent({
      agentDef: { name: 'test', systemPrompt: '', source: 'builtin' },
      prompt: 'test task',
      sessionId: 'session-1',
      cwd: '/test/cwd',
      adapter: () => mockAdapter,
      createRegistry: () => mockRegistry,
      buildSystemPrompt,
      forkContext: { systemPrompt: 'CONTAMINATED CC SYSTEM PROMPT', session: {} } as any,
    });

    // buildSystemPrompt should be called (not the forkContext one)
    expect(buildSystemPrompt).toHaveBeenCalled();
    expect(capturedSystemPrompt).toBe('xiaok prompt for /test/cwd');
    expect(capturedSystemPrompt).not.toContain('CONTAMINATED');

    // Agent should be created with the xiaok-built prompt
    expect(Agent).toHaveBeenCalled();
    const agentCall = (Agent as any).mock.calls[0];
    expect(agentCall[2]).not.toContain('CONTAMINATED');
    expect(agentCall[2]).toContain('xiaok prompt');
  });

  it('does not include gstream environment vars in system prompt', async () => {
    const buildSystemPrompt = vi.fn().mockResolvedValue('clean xiaok prompt');

    await executeNamedSubAgent({
      agentDef: { name: 'test', systemPrompt: '', source: 'builtin' },
      prompt: 'test',
      sessionId: 'session-1',
      cwd: '/test/cwd',
      adapter: () => mockAdapter,
      createRegistry: () => mockRegistry,
      buildSystemPrompt,
      forkContext: {
        systemPrompt: 'BRANCH: main\nSPAWNED_SESSION: true\nPROACTIVE: true\n',
        session: {},
      } as any,
    });

    expect(Agent).toHaveBeenCalled();
    const agentCall = (Agent as any).mock.calls[0];
    const systemPrompt = agentCall[2];
    expect(systemPrompt).not.toContain('SPAWNED_SESSION');
    expect(systemPrompt).not.toContain('BRANCH:');
    expect(systemPrompt).not.toContain('PROACTIVE:');
  });

  it('appends agent-specific systemPrompt after base prompt', async () => {
    const buildSystemPrompt = vi.fn().mockResolvedValue('base xiaok prompt');

    await executeNamedSubAgent({
      agentDef: {
        name: 'reviewer',
        systemPrompt: 'You are a code reviewer with expertise in TypeScript.',
        source: 'builtin',
      },
      prompt: 'test',
      sessionId: 'session-1',
      adapter: () => mockAdapter,
      createRegistry: () => mockRegistry,
      buildSystemPrompt,
    });

    expect(Agent).toHaveBeenCalled();
    const agentCall = (Agent as any).mock.calls[0];
    const systemPrompt = agentCall[2];
    expect(systemPrompt).toContain('base xiaok prompt');
    expect(systemPrompt).toContain('You are a code reviewer');
  });

  it('works without forkContext', async () => {
    const buildSystemPrompt = vi.fn().mockResolvedValue('isolated prompt');

    await executeNamedSubAgent({
      agentDef: { name: 'test', systemPrompt: '', source: 'builtin' },
      prompt: 'test',
      sessionId: 'session-1',
      adapter: () => mockAdapter,
      createRegistry: () => mockRegistry,
      buildSystemPrompt,
      // No forkContext provided
    });

    expect(buildSystemPrompt).toHaveBeenCalled();
    expect(Agent).toHaveBeenCalled();
    const agentCall = (Agent as any).mock.calls[0];
    expect(agentCall[2]).toContain('isolated prompt');
  });

  it('does not restore strict K3 parent history and passes only synthesized context', async () => {
    const strictAdapter = createAdapterFromBinding({
      providerId: 'kimi',
      providerType: 'first_party',
      modelId: 'k3',
      wireModel: 'k3',
      protocol: 'openai_legacy',
      apiKey: 'sk-test',
      baseUrl: 'https://api.kimi.com/coding/v1',
      headers: {},
      capabilities: ['tools', 'thinking'],
    }) as OpenAIAdapter;

    await executeNamedSubAgent({
      agentDef: { name: 'test', systemPrompt: '', source: 'builtin' },
      prompt: 'child task',
      sessionId: 'session-1',
      cwd: '/test/cwd',
      adapter: () => strictAdapter,
      createRegistry: () => mockRegistry,
      buildSystemPrompt: async () => 'prompt',
      forkContext: {
        session: {
          sessionId: 'sess_parent',
          cwd: '/test/cwd',
          createdAt: 1,
          updatedAt: 2,
          lineage: ['sess_parent'],
          messages: [{
            role: 'assistant',
            content: [{
              type: 'thinking',
              thinking: 'provider-private-reasoning',
              reasoningProvenance: {
                captureVersion: 1,
                source: 'reasoning_content',
                fieldPresence: 'present',
              },
            }],
          }],
          usage: { inputTokens: 0, outputTokens: 0 },
          compactions: [],
          memoryRefs: [],
          approvalRefs: [],
          backgroundJobRefs: [],
        },
        messages: [{
          role: 'assistant',
          content: [{
            type: 'thinking',
            thinking: 'provider-private-reasoning',
            reasoningProvenance: {
              captureVersion: 1,
              source: 'reasoning_content',
              fieldPresence: 'present',
            },
          }],
        }],
      } as any,
    });

    const agentInstance = (Agent as any).mock.results[0].value;
    expect(agentInstance.restoreSession).not.toHaveBeenCalled();
    const runPrompt = agentInstance.runTurn.mock.calls[0][0];
    expect(runPrompt).toContain('xiaok.synthesized-subagent-context');
    expect(runPrompt).toContain('child task');
    expect(runPrompt).not.toContain('provider-private-reasoning');
    strictAdapter.dispose();
  });

  it('does not restore strict K3 parent reasoning when the child overrides to a generic model', async () => {
    const strictParentAdapter = createAdapterFromBinding({
      providerId: 'kimi',
      providerType: 'first_party',
      modelId: 'k3',
      wireModel: 'k3',
      protocol: 'openai_legacy',
      apiKey: 'sk-test',
      baseUrl: 'https://api.kimi.com/coding/v1',
      headers: {},
      capabilities: ['tools', 'thinking'],
    }) as OpenAIAdapter;

    await executeNamedSubAgent({
      agentDef: {
        name: 'generic-child',
        systemPrompt: '',
        source: 'builtin',
        model: 'kimi-k2.5',
      },
      prompt: 'child task',
      sessionId: 'session-1',
      cwd: '/test/cwd',
      adapter: () => strictParentAdapter,
      createRegistry: () => mockRegistry,
      buildSystemPrompt: async () => 'prompt',
      forkContext: {
        session: {
          sessionId: 'sess_parent',
          cwd: '/test/cwd',
          createdAt: 1,
          updatedAt: 2,
          lineage: ['sess_parent'],
          messages: [{
            role: 'assistant',
            content: [{
              type: 'thinking',
              thinking: 'PRIVATE_REASONING_CANARY',
              reasoningProvenance: {
                captureVersion: 1,
                source: 'reasoning_content',
                fieldPresence: 'present',
              },
            }, {
              type: 'text',
              text: 'safe answer',
            }],
          }],
          usage: { inputTokens: 0, outputTokens: 0 },
          compactions: [],
          memoryRefs: [],
          approvalRefs: [],
          backgroundJobRefs: [],
        },
        messages: [{
          role: 'assistant',
          content: [{
            type: 'thinking',
            thinking: 'PRIVATE_REASONING_CANARY',
            reasoningProvenance: {
              captureVersion: 1,
              source: 'reasoning_content',
              fieldPresence: 'present',
            },
          }, {
            type: 'text',
            text: 'safe answer',
          }],
        }],
      } as any,
    });

    const dispatchedAdapter = (Agent as any).mock.calls[0][0] as OpenAIAdapter;
    const agentInstance = (Agent as any).mock.results[0].value;
    const runPrompt = agentInstance.runTurn.mock.calls[0][0];
    expect(dispatchedAdapter.harnessContext.profile.id).toBe('generic-openai');
    expect(agentInstance.restoreSession).not.toHaveBeenCalled();
    expect(runPrompt).toContain('xiaok.synthesized-subagent-context');
    expect(runPrompt).toContain('safe answer');
    expect(runPrompt).not.toContain('PRIVATE_REASONING_CANARY');
    strictParentAdapter.dispose();
    dispatchedAdapter.dispose();
  });
});

describe('subagent-executor registry isolation', () => {
  it('forwards parentDepth to createRegistry opts', async () => {
    let capturedOpts: { parentDepth?: number } | undefined;
    const createRegistry = vi.fn().mockImplementation((_cwd, _allowedTools, _agentId, opts) => {
      capturedOpts = opts;
      return mockRegistry;
    });

    await executeNamedSubAgent({
      agentDef: { name: 'test', systemPrompt: '', source: 'builtin' },
      prompt: 'test',
      sessionId: 'session-1',
      adapter: () => mockAdapter,
      createRegistry,
      buildSystemPrompt: async () => 'prompt',
      parentDepth: 2,
    });

    expect(capturedOpts).toEqual({ parentDepth: 2 });
  });

  it('passes allowedTools to createRegistry', async () => {
    let capturedAllowedTools: string[] | undefined;
    const createRegistry = vi.fn().mockImplementation((_cwd, allowedTools) => {
      capturedAllowedTools = allowedTools;
      return mockRegistry;
    });

    await executeNamedSubAgent({
      agentDef: {
        name: 'reviewer',
        systemPrompt: '',
        source: 'builtin',
        allowedTools: ['Read', 'Edit', 'Bash'],
      },
      prompt: 'test',
      sessionId: 'session-1',
      adapter: () => mockAdapter,
      createRegistry,
      buildSystemPrompt: async () => 'prompt',
    });

    expect(createRegistry).toHaveBeenCalled();
    expect(capturedAllowedTools).toEqual(['Read', 'Edit', 'Bash']);
  });

  it('passes undefined allowedTools when agent has no restrictions', async () => {
    let capturedAllowedTools: string[] | undefined = ['not-undefined'];
    const createRegistry = vi.fn().mockImplementation((_cwd, allowedTools) => {
      capturedAllowedTools = allowedTools;
      return mockRegistry;
    });

    await executeNamedSubAgent({
      agentDef: { name: 'test', systemPrompt: '', source: 'builtin' },
      prompt: 'test',
      sessionId: 'session-1',
      adapter: () => mockAdapter,
      createRegistry,
      buildSystemPrompt: async () => 'prompt',
    });

    expect(capturedAllowedTools).toBeUndefined();
  });
});

describe('subagent-executor model capability routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves agent modelCapability through ToolExecutionContext settingsStore before dispatch', async () => {
    const clonedAdapter = { ...mockAdapter, getModelName: () => 'gpt-5.4-deep' } as unknown as ModelAdapter;
    const baseAdapter = {
      ...mockAdapter,
      cloneWithModel: vi.fn().mockReturnValue(clonedAdapter),
    } as unknown as ModelAdapter & { cloneWithModel: (model: string) => ModelAdapter };

    await executeNamedSubAgent({
      agentDef: {
        name: 'reviewer',
        systemPrompt: '',
        source: 'builtin',
        modelCapability: 'deep-reviewer',
      } as any,
      prompt: 'test',
      sessionId: 'session-1',
      adapter: () => baseAdapter,
      createRegistry: () => mockRegistry,
      buildSystemPrompt: async () => 'prompt',
      forkContext: {
        settingsStore: {
          getSettings: () => ({
            modelCapabilities: {
              'deep-reviewer': 'gpt-5.4-deep',
            },
          }),
        },
      } as any,
    });

    expect(baseAdapter.cloneWithModel).toHaveBeenCalledWith('gpt-5.4-deep');
    expect(Agent).toHaveBeenCalled();
    expect((Agent as any).mock.calls[0][0]).toBe(clonedAdapter);
  });

  it('routes a real OpenAI adapter override through the shared wire-model clone seam', async () => {
    const baseAdapter = createAdapterFromBinding({
      providerId: 'kimi',
      providerType: 'first_party',
      modelId: 'kimi-k2.7',
      wireModel: 'kimi-k2.7',
      protocol: 'openai_legacy',
      apiKey: 'sk-kimi',
      baseUrl: 'https://api.kimi.com/coding/v1',
      headers: {},
      capabilities: ['tools', 'thinking'],
    }) as OpenAIAdapter;

    await executeNamedSubAgent({
      agentDef: {
        name: 'reviewer',
        systemPrompt: '',
        source: 'builtin',
        modelCapability: 'kimi-coding',
      } as any,
      prompt: 'test',
      sessionId: 'session-1',
      adapter: () => baseAdapter,
      createRegistry: () => mockRegistry,
      buildSystemPrompt: async () => 'prompt',
      forkContext: {
        settingsStore: {
          getSettings: () => ({
            modelCapabilities: {
              'kimi-coding': 'k3',
            },
          }),
        },
      } as any,
    });

    const dispatchedAdapter = (Agent as any).mock.calls[0][0] as OpenAIAdapter;
    expect(dispatchedAdapter).not.toBe(baseAdapter);
    expect(dispatchedAdapter.getModelName()).toBe('k3');
    expect(dispatchedAdapter.harnessContext.profile.id).toBe('kimi-k3-coding-openai');
  });

  it('rejects unknown modelCapability before constructing the subagent', async () => {
    const baseAdapter = {
      ...mockAdapter,
      cloneWithModel: vi.fn(),
    } as unknown as ModelAdapter & { cloneWithModel: (model: string) => ModelAdapter };

    await expect(executeNamedSubAgent({
      agentDef: {
        name: 'reviewer',
        systemPrompt: '',
        source: 'builtin',
        modelCapability: 'missing-capability',
      } as any,
      prompt: 'test',
      sessionId: 'session-1',
      adapter: () => baseAdapter,
      createRegistry: () => mockRegistry,
      buildSystemPrompt: async () => 'prompt',
      forkContext: {
        settingsStore: {
          getSettings: () => ({ modelCapabilities: {} }),
        },
      } as any,
    })).rejects.toThrow('unknown capability: missing-capability');

    expect(baseAdapter.cloneWithModel).not.toHaveBeenCalled();
    expect(Agent).not.toHaveBeenCalled();
  });
});

describe('subagent-executor abort signal propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes a child signal that aborts when the parent context signal aborts', async () => {
    const parentController = new AbortController();

    await executeNamedSubAgent({
      agentDef: { name: 'test', systemPrompt: '', source: 'builtin' },
      prompt: 'test',
      sessionId: 'session-1',
      adapter: () => mockAdapter,
      createRegistry: () => mockRegistry,
      buildSystemPrompt: async () => 'prompt',
      forkContext: {
        signal: parentController.signal,
      } as any,
    });

    const agentInstance = (Agent as any).mock.results[0].value;
    const childSignal = agentInstance.runTurn.mock.calls[0][2] as AbortSignal | undefined;
    expect(childSignal).toBeDefined();
    expect(childSignal?.aborted).toBe(false);
    parentController.abort();
    expect(childSignal?.aborted).toBe(true);
  });

  it('passes an independent child signal even without a parent context signal', async () => {
    await executeNamedSubAgent({
      agentDef: { name: 'test', systemPrompt: '', source: 'builtin' },
      prompt: 'test',
      sessionId: 'session-1',
      adapter: () => mockAdapter,
      createRegistry: () => mockRegistry,
      buildSystemPrompt: async () => 'prompt',
    });

    const agentInstance = (Agent as any).mock.results[0].value;
    const childSignal = agentInstance.runTurn.mock.calls[0][2] as AbortSignal | undefined;
    expect(childSignal).toBeDefined();
    expect(childSignal?.aborted).toBe(false);
  });
});
