import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSubAgentTool } from '../../../src/ai/tools/subagent.js';
import type { ModelAdapter, ToolExecutionContext } from '../../../src/types.js';

// Mock executeNamedSubAgent
vi.mock('../../../src/ai/agents/subagent-executor.js', () => ({
  executeNamedSubAgent: vi.fn().mockResolvedValue('subagent result'),
}));

import { executeNamedSubAgent } from '../../../src/ai/agents/subagent-executor.js';

const mockAdapter = (): ModelAdapter => ({
  generate: vi.fn(),
  stream: vi.fn(),
} as unknown as ModelAdapter);

const mockBuildSystemPrompt = async () => 'xiaok system prompt';

function mockRegistry() {
  return {
    getTool: () => undefined,
    list: () => [],
    capabilities: () => [],
    getToolDefinitions: () => [],
  } as any;
}

const baseOptions = {
  source: 'chat',
  sessionId: 'test-session',
  adapter: mockAdapter,
  agents: [] as any[],
  createRegistry: () => mockRegistry(),
  buildSystemPrompt: mockBuildSystemPrompt,
};

describe('subagent tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('inline agent mode', () => {
    it('creates inline agent with description and prompt', async () => {
      const tool = createSubAgentTool({ ...baseOptions, agents: [] });
      await tool.execute({
        description: 'code review',
        prompt: 'Check for bugs in src/main.ts',
      }, {} as ToolExecutionContext);

      expect(executeNamedSubAgent).toHaveBeenCalled();
      const call = (executeNamedSubAgent as any).mock.calls[0][0];
      expect(call.agentDef.name).toBe('inline');
      expect(call.agentDef.source).toBe('project');
      expect(call.agentDef.systemPrompt).toBe('');
    });

    it('filters out subagent tool from inline agent allowedTools', async () => {
      const tool = createSubAgentTool({ ...baseOptions, agents: [] });
      await tool.execute({
        description: 'recursive test',
        prompt: 'do something',
        tools: ['Read', 'Edit', 'subagent'],
      }, {} as ToolExecutionContext);

      const call = (executeNamedSubAgent as any).mock.calls[0][0];
      expect(call.agentDef.allowedTools).toEqual(['Read', 'Edit']);
    });

    it('allows inline agent with empty tools list', async () => {
      const tool = createSubAgentTool({ ...baseOptions, agents: [] });
      await tool.execute({
        description: 'simple task',
        prompt: 'summarize',
        tools: [],
      }, {} as ToolExecutionContext);

      const call = (executeNamedSubAgent as any).mock.calls[0][0];
      expect(call.agentDef.allowedTools).toBeUndefined();
    });

    it('supports custom name for inline agent', async () => {
      const tool = createSubAgentTool({ ...baseOptions, agents: [] });
      await tool.execute({
        description: 'test',
        prompt: 'do something',
        name: 'my-reviewer',
      }, {} as ToolExecutionContext);

      const call = (executeNamedSubAgent as any).mock.calls[0][0];
      expect(call.agentDef.name).toBe('my-reviewer');
    });

    it('supports model override for inline agent', async () => {
      const tool = createSubAgentTool({ ...baseOptions, agents: [] });
      await tool.execute({
        description: 'test',
        prompt: 'do something',
        model: 'opus',
      }, {} as ToolExecutionContext);

      const call = (executeNamedSubAgent as any).mock.calls[0][0];
      expect(call.agentDef.model).toBe('opus');
    });

    it('supports worktree isolation for inline agent', async () => {
      const tool = createSubAgentTool({ ...baseOptions, agents: [] });
      await tool.execute({
        description: 'test',
        prompt: 'do something',
        isolation: 'worktree',
      }, {} as ToolExecutionContext);

      const call = (executeNamedSubAgent as any).mock.calls[0][0];
      expect(call.agentDef.isolation).toBe('worktree');
    });
  });

  describe('pre-defined agent mode', () => {
    const agents = [
      { name: 'reviewer', systemPrompt: 'You are a reviewer', source: 'builtin' as const },
      { name: 'planner', systemPrompt: 'You are a planner', source: 'builtin' as const },
    ];

    it('calls pre-defined agent', async () => {
      const tool = createSubAgentTool({ ...baseOptions, agents: agents as any[] });
      await tool.execute({
        agent: 'reviewer',
        prompt: 'Review the code',
      }, {} as ToolExecutionContext);

      expect(executeNamedSubAgent).toHaveBeenCalled();
      const call = (executeNamedSubAgent as any).mock.calls[0][0];
      expect(call.agentDef.name).toBe('reviewer');
      expect(call.agentDef.systemPrompt).toBe('You are a reviewer');
    });

    it('returns error for unknown agent', async () => {
      const tool = createSubAgentTool({ ...baseOptions, agents: agents as any[] });
      const result = await tool.execute({
        agent: 'nonexistent',
        prompt: 'do something',
      }, {} as ToolExecutionContext);

      expect(result).toContain('Error: unknown agent');
      expect(result).toContain('nonexistent');
    });

    it('inline mode takes precedence when agent is not specified', async () => {
      const tool = createSubAgentTool({ ...baseOptions, agents: agents as any[] });
      await tool.execute({
        description: 'custom task',
        prompt: 'do something custom',
        tools: ['Read'],
      }, {} as ToolExecutionContext);

      const call = (executeNamedSubAgent as any).mock.calls[0][0];
      expect(call.agentDef.name).toBe('inline');
    });
  });

  describe('validation', () => {
    it('returns error when prompt is empty', async () => {
      const tool = createSubAgentTool({ ...baseOptions, agents: [] });
      const result = await tool.execute({
        description: 'test',
        prompt: '',
      }, {} as ToolExecutionContext);

      expect(result).toContain('Error: prompt is required');
    });

    it('returns error when prompt is whitespace only', async () => {
      const tool = createSubAgentTool({ ...baseOptions, agents: [] });
      const result = await tool.execute({
        description: 'test',
        prompt: '   ',
      }, {} as ToolExecutionContext);

      expect(result).toContain('Error: prompt is required');
    });
  });

  describe('background mode', () => {
    const mockBackgroundRunner = {
      start: vi.fn().mockResolvedValue({ jobId: 'job-123' }),
    };

    it('queues background job for pre-defined agent', async () => {
      const agents = [{ name: 'reviewer', systemPrompt: '', source: 'builtin' as const }];
      const tool = createSubAgentTool({
        ...baseOptions,
        agents: agents as any[],
        backgroundRunner: mockBackgroundRunner as any,
      });

      const result = await tool.execute({
        agent: 'reviewer',
        prompt: 'Review code',
        background: true,
      }, {} as ToolExecutionContext);

      expect(result).toContain('background agent queued');
      expect(result).toContain('job-123');
      expect(mockBackgroundRunner.start).toHaveBeenCalled();
    });

    it('queues background job for inline agent', async () => {
      const tool = createSubAgentTool({
        ...baseOptions,
        agents: [],
        backgroundRunner: mockBackgroundRunner as any,
      });

      const result = await tool.execute({
        description: 'background task',
        prompt: 'do something in background',
        background: true,
      }, {} as ToolExecutionContext);

      expect(result).toContain('background agent queued');
    });

    it('returns error when background runner not configured', async () => {
      const tool = createSubAgentTool({ ...baseOptions, agents: [] });
      const result = await tool.execute({
        description: 'test',
        prompt: 'do something',
        background: true,
      }, {} as ToolExecutionContext);

      expect(result).toContain('Error: background runner is not configured');
    });
  });
});

describe('subagent recursion depth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.XIAOK_SUBAGENT_MAX_DEPTH;
  });

  it('passes parentDepth+1 to executeNamedSubAgent', async () => {
    const tool = createSubAgentTool({ ...baseOptions, agents: [], parentDepth: 0 });
    await tool.execute(
      { description: 'task', prompt: 'do' },
      {} as ToolExecutionContext,
    );

    const call = (executeNamedSubAgent as any).mock.calls[0][0];
    expect(call.parentDepth).toBe(1);
  });

  it('rejects when depth would exceed default max=3', async () => {
    const tool = createSubAgentTool({ ...baseOptions, agents: [], parentDepth: 3 });
    const result = await tool.execute(
      { description: 'task', prompt: 'do' },
      {} as ToolExecutionContext,
    );

    expect(result).toContain('Error: subagent recursion depth exceeded');
    expect(result).toContain('max=3');
    expect(result).toContain('attempted=4');
    expect(executeNamedSubAgent).not.toHaveBeenCalled();
  });

  it('allows depth up to max', async () => {
    const tool = createSubAgentTool({ ...baseOptions, agents: [], parentDepth: 2 });
    await tool.execute(
      { description: 'task', prompt: 'do' },
      {} as ToolExecutionContext,
    );

    const call = (executeNamedSubAgent as any).mock.calls[0][0];
    expect(call.parentDepth).toBe(3);
  });

  it('honors XIAOK_SUBAGENT_MAX_DEPTH env override', async () => {
    process.env.XIAOK_SUBAGENT_MAX_DEPTH = '1';
    const tool = createSubAgentTool({ ...baseOptions, agents: [], parentDepth: 1 });
    const result = await tool.execute(
      { description: 'task', prompt: 'do' },
      {} as ToolExecutionContext,
    );

    expect(result).toContain('max=1');
    expect(result).toContain('attempted=2');
  });

  it('honors explicit maxDepth option over env', async () => {
    process.env.XIAOK_SUBAGENT_MAX_DEPTH = '99';
    const tool = createSubAgentTool({
      ...baseOptions,
      agents: [],
      parentDepth: 1,
      maxDepth: 1,
    });
    const result = await tool.execute(
      { description: 'task', prompt: 'do' },
      {} as ToolExecutionContext,
    );

    expect(result).toContain('max=1');
  });

  it('gates pre-defined agent path by depth', async () => {
    const agents = [{ name: 'reviewer', systemPrompt: 'You are a reviewer', source: 'builtin' as const }];
    const tool = createSubAgentTool({
      ...baseOptions,
      agents: agents as any[],
      parentDepth: 3,
    });
    const result = await tool.execute(
      { agent: 'reviewer', prompt: 'review' },
      {} as ToolExecutionContext,
    );

    expect(result).toContain('Error: subagent recursion depth exceeded');
    expect(executeNamedSubAgent).not.toHaveBeenCalled();
  });

  it('passes parentDepth in background job input payload', async () => {
    const mockBackgroundRunner = {
      start: vi.fn().mockResolvedValue({ jobId: 'job-depth' }),
    };
    const tool = createSubAgentTool({
      ...baseOptions,
      agents: [],
      parentDepth: 1,
      backgroundRunner: mockBackgroundRunner as any,
    });
    await tool.execute(
      { description: 'bg', prompt: 'do', background: true },
      {} as ToolExecutionContext,
    );

    const call = mockBackgroundRunner.start.mock.calls[0][0];
    expect(call.input.parentDepth).toBe(2);
  });
});

describe('subagent tool description', () => {
  it('includes pre-defined agent names in description', () => {
    const agents = [
      { name: 'reviewer', systemPrompt: '', source: 'builtin' as const },
      { name: 'planner', systemPrompt: '', source: 'builtin' as const },
    ];

    const tool = createSubAgentTool({
      source: 'chat',
      sessionId: 'test',
      adapter: mockAdapter,
      agents: agents as any[],
      createRegistry: () => mockRegistry(),
      buildSystemPrompt: mockBuildSystemPrompt,
    });

    const desc = tool.definition.description;
    expect(desc).toContain('reviewer');
    expect(desc).toContain('planner');
    expect(desc).toContain('inline');
    expect(desc).toContain('subagent');
  });

  it('explains both modes clearly', () => {
    const tool = createSubAgentTool({
      ...baseOptions,
      agents: [],
    });

    const desc = tool.definition.description;
    expect(desc).toContain('Pre-defined agent');
    expect(desc).toContain('Inline agent');
    expect(desc).toContain('recursion');
  });
});
