import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createWorktreeManager } from '../../../src/platform/worktrees/manager.js';
import { createMultiAgentCoordinator } from '../../../src/ai/agents/multi-agent-coordinator.js';
import { createNamedSubAgentSession } from '../../../src/ai/agents/subagent-executor.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';

const caller = { requestSource: 'agent' as const, callerId: 'main' };

describe('production subagent with real git worktrees', () => {
  it.each(['delete', 'keep'] as const)('applies %s policy only after the active tool actually exits', async (cleanup) => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-subagent-git-'));
    const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git(['init']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'fixture']);
    const manager = createWorktreeManager({ repoRoot: root, worktreesDir: join(root, '.worktrees'), execGit: async (args) => git(args) });
    const coordinator = createMultiAgentCoordinator({ closeSettlementTimeoutMs: 5 });
    let finish!: () => void;
    const running = new Promise<void>((resolve) => { finish = resolve; });
    let worktree: string | undefined;
    let entered = false;
    try {
      const child = await coordinator.spawn({ ...caller, taskName: 'isolated', message: 'work',
        createSession: (identity, signal) => createNamedSubAgentSession({
          agentDef: { name: 'isolated', systemPrompt: '', source: 'builtin', isolation: 'worktree', cleanup },
          sessionId: 'real-worktree', runtimeAgentId: identity.id, cwd: root, signal,
          worktreeManager: manager, buildSystemPrompt: async (cwd) => { worktree = cwd; return 'fixture'; },
          createRegistry: () => new ToolRegistry({}, [{permission:'safe',definition:{name:'held_tool',description:'fixture',inputSchema:{type:'object',properties:{}}},execute:async () => {entered = true; await running; return 'done';}}]),
          adapter: () => ({ async *stream() { yield {type:'tool_use' as const,id:'held',name:'held_tool',input:{}}; yield { type: 'done' as const }; } }),
        }),
      });
      await vi.waitFor(() => expect(entered).toBe(true));
      expect(existsSync(worktree!)).toBe(true);
      expect(git(['worktree', 'list', '--porcelain'])).toContain(worktree);
      expect(await coordinator.closeAgent({ ...caller, target: child.id })).toMatchObject({ resourcesReleased: false, cleanupPending: true });
      expect(existsSync(worktree!)).toBe(true);
      finish();
      await vi.waitFor(() => expect(coordinator.listAgents(caller)).toContainEqual(expect.objectContaining({ id: child.id, resourcesReleased: true })));
      expect(existsSync(worktree!)).toBe(cleanup === 'keep');
      expect(git(['worktree', 'list', '--porcelain']).includes(worktree!)).toBe(cleanup === 'keep');
    } finally {
      finish();
      await coordinator.dispose();
      rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
