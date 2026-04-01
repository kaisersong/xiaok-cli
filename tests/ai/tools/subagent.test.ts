import { describe, expect, it, vi } from 'vitest';
import type { ModelAdapter, StreamChunk, Tool } from '../../../src/types.js';
import { createSubAgentTool } from '../../../src/ai/tools/subagent.js';
import { createWorktreeManager } from '../../../src/platform/worktrees/manager.js';
import { createBackgroundRunner } from '../../../src/platform/agents/background-runner.js';

async function* mockStream(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe('createSubAgentTool', () => {
  it('runs a named subagent inside an isolated worktree when the agent requires worktree isolation', async () => {
    const execGit = vi.fn(async () => '');
    const worktreeManager = createWorktreeManager({
      repoRoot: '/repo',
      worktreesDir: '/repo/.worktrees',
      execGit,
    });
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: () => mockStream([{ type: 'text', delta: 'subagent done' }, { type: 'done' }]),
    };
    const createRegistry = vi.fn(() => ({
      getToolDefinitions: () => [],
      executeTool: async () => 'ok',
    }));

    const tool = createSubAgentTool({
      source: 'chat',
      sessionId: 'sess_1',
      adapter: () => adapter,
      agents: [
        {
          name: 'reviewer',
          systemPrompt: 'You review code',
          isolation: 'worktree',
          allowedTools: ['read'],
        },
      ],
      createRegistry,
      buildSystemPrompt: async () => 'base system',
      worktreeManager,
    });

    const result = await tool.execute({
      agent: 'reviewer',
      prompt: 'inspect the repo',
    });

    expect(result).toContain('subagent done');
    expect(execGit).toHaveBeenCalledWith([
      'worktree',
      'add',
      '/repo/.worktrees/reviewer-sess_1',
      '-b',
      'reviewer-sess_1',
    ]);
    expect(createRegistry).toHaveBeenCalledWith('/repo/.worktrees/reviewer-sess_1', ['read']);
  });

  it('dispatches background agents through the background runner and returns the queued job id', async () => {
    const notify = vi.fn(async () => undefined);
    const backgroundRunner = createBackgroundRunner({
      rootDir: '/tmp/xiaok-subagent-background-tests',
      execute: async () => ({ ok: true, summary: 'background complete' }),
      notify,
    });
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: () => mockStream([{ type: 'done' }]),
    };

    const tool = createSubAgentTool({
      source: 'chat',
      sessionId: 'sess_2',
      adapter: () => adapter,
      agents: [
        {
          name: 'planner',
          systemPrompt: 'You plan tasks',
          background: true,
        },
      ],
      createRegistry: () => ({
        getToolDefinitions: () => [],
        executeTool: async () => 'ok',
      }),
      buildSystemPrompt: async () => 'base system',
      backgroundRunner,
    });

    const result = await tool.execute({
      agent: 'planner',
      prompt: 'plan next steps',
    });

    expect(result).toContain('job_');
    expect(result).toContain('queued');
  });

  it('releases isolated worktrees when the agent cleanup policy is delete', async () => {
    const execGit = vi.fn(async () => '');
    const worktreeManager = createWorktreeManager({
      repoRoot: '/repo',
      worktreesDir: '/repo/.worktrees',
      execGit,
    });
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: () => mockStream([{ type: 'text', delta: 'done' }, { type: 'done' }]),
    };

    const tool = createSubAgentTool({
      source: 'chat',
      sessionId: 'sess_cleanup',
      adapter: () => adapter,
      agents: [
        {
          name: 'janitor',
          systemPrompt: 'You clean up worktrees',
          isolation: 'worktree',
          cleanup: 'delete',
        },
      ],
      createRegistry: () => ({
        getToolDefinitions: () => [],
        executeTool: async () => 'ok',
      }),
      buildSystemPrompt: async () => 'base system',
      worktreeManager,
    });

    const result = await tool.execute({
      agent: 'janitor',
      prompt: 'run cleanup',
    });

    expect(result).toContain('done');
    expect(execGit).toHaveBeenNthCalledWith(
      1,
      ['worktree', 'add', '/repo/.worktrees/janitor-sess_cleanup', '-b', 'janitor-sess_cleanup'],
    );
    expect(execGit).toHaveBeenNthCalledWith(
      2,
      ['worktree', 'remove', '/repo/.worktrees/janitor-sess_cleanup'],
    );
  });

  it('forwards the parent session snapshot to the subagent when runtime context is available', async () => {
    const capturedMessages: Array<{ role: string }> = [];
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: (messages) => {
        capturedMessages.push(...messages.map((message) => ({ role: message.role })));
        return mockStream([{ type: 'text', delta: 'subagent inherited context' }, { type: 'done' }]);
      },
    };

    const tool = createSubAgentTool({
      source: 'chat',
      sessionId: 'sess_parent',
      adapter: () => adapter,
      agents: [
        {
          name: 'reviewer',
          systemPrompt: 'You review code',
        },
      ],
      createRegistry: () => ({
        getToolDefinitions: () => [],
        executeTool: async () => 'ok',
      }),
      buildSystemPrompt: async () => 'base system',
    });

    const result = await tool.execute({
      agent: 'reviewer',
      prompt: 'inspect',
    }, {
      session: {
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'history' }] },
        ],
        usage: { inputTokens: 1, outputTokens: 1 },
        compactions: [],
      },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'history' }] }],
      systemPrompt: 'rendered system',
      toolDefinitions: [],
    });

    expect(result).toContain('subagent inherited context');
    expect(capturedMessages[0]?.role).toBe('user');
  });

  it('uses the invoking registry cwd for shared subagents', async () => {
    const createRegistry = vi.fn(() => ({
      getToolDefinitions: () => [],
      executeTool: async () => 'ok',
    }));
    const buildSystemPrompt = vi.fn(async () => 'base system');
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: () => mockStream([{ type: 'text', delta: 'shared cwd run' }, { type: 'done' }]),
    };

    const tool = createSubAgentTool({
      source: 'chat',
      sessionId: 'sess_cwd',
      cwd: '/repo/packages/app',
      adapter: () => adapter,
      agents: [
        {
          name: 'reviewer',
          systemPrompt: 'Use the current repo cwd',
        },
      ],
      createRegistry,
      buildSystemPrompt,
    });

    const result = await tool.execute({
      agent: 'reviewer',
      prompt: 'inspect current package',
    });

    expect(result).toContain('shared cwd run');
    expect(createRegistry).toHaveBeenCalledWith('/repo/packages/app', undefined);
    expect(buildSystemPrompt).toHaveBeenCalledWith('/repo/packages/app');
  });

  it('uses the subagent-specific model override when the adapter supports cloning by model', async () => {
    let selectedModel = '';
    const clonedAdapter: ModelAdapter = {
      getModelName: () => selectedModel,
      stream: () => mockStream([{ type: 'text', delta: 'model-specific run' }, { type: 'done' }]),
    };
    const adapter = {
      getModelName: () => 'base-model',
      stream: () => mockStream([{ type: 'done' }]),
      cloneWithModel(model: string) {
        selectedModel = model;
        return clonedAdapter;
      },
    } satisfies ModelAdapter & { cloneWithModel(model: string): ModelAdapter };

    const tool = createSubAgentTool({
      source: 'chat',
      sessionId: 'sess_model',
      adapter: () => adapter,
      agents: [
        {
          name: 'specialist',
          systemPrompt: 'Use a different model',
          model: 'gpt-5.4',
        },
      ],
      createRegistry: () => ({
        getToolDefinitions: () => [],
        executeTool: async () => 'ok',
      }),
      buildSystemPrompt: async () => 'base system',
    });

    const result = await tool.execute({
      agent: 'specialist',
      prompt: 'run with override',
    });

    expect(selectedModel).toBe('gpt-5.4');
    expect(result).toContain('model-specific run');
  });

  it('preserves the invoking cwd when queueing background subagents', async () => {
    const start = vi.fn(async () => ({
      jobId: 'job_1',
      sessionId: 'sess_bg_cwd',
      source: 'chat',
      inputSummary: '{"agent":"planner","prompt":"plan next steps","cwd":"/repo/packages/app"}',
      status: 'queued' as const,
      createdAt: 0,
      updatedAt: 0,
    }));
    const backgroundRunner = {
      start,
      get: () => undefined,
      listBySession: () => [],
      listByTask: () => [],
    };
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: () => mockStream([{ type: 'done' }]),
    };

    const tool = createSubAgentTool({
      source: 'chat',
      sessionId: 'sess_bg_cwd',
      cwd: '/repo/packages/app',
      adapter: () => adapter,
      agents: [
        {
          name: 'planner',
          systemPrompt: 'Plan work in the current package',
          background: true,
        },
      ],
      createRegistry: () => ({
        getToolDefinitions: () => [],
        executeTool: async () => 'ok',
      }),
      buildSystemPrompt: async () => 'base system',
      backgroundRunner,
    });

    const result = await tool.execute({
      agent: 'planner',
      prompt: 'plan next steps',
    });

    expect(result).toContain('job_1');
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      input: {
        agent: 'planner',
        prompt: 'plan next steps',
        cwd: '/repo/packages/app',
      },
    }));
  });
});
