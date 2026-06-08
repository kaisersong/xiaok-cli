import { describe, expect, it, vi, beforeEach } from 'vitest';
import { executeNamedSubAgent } from '../../../src/ai/agents/subagent-executor.js';
import type { ModelAdapter } from '../../../src/types.js';
import type { ToolRegistry } from '../../../src/ai/tools/index.js';

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
