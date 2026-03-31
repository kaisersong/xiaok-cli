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
});
