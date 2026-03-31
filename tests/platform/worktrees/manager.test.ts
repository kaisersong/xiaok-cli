import { describe, expect, it, vi } from 'vitest';
import { createWorktreeManager } from '../../../src/platform/worktrees/manager.js';

describe('worktree manager', () => {
  it('creates a new worktree inside the configured project boundary', async () => {
    const execGit = vi.fn(async () => '');
    const manager = createWorktreeManager({
      repoRoot: '/repo',
      worktreesDir: '/repo/.worktrees',
      execGit,
    });

    const allocation = await manager.allocate({
      owner: 'agent-a',
      taskId: 'task_1',
      branch: 'bg-task-1',
    });

    expect(allocation.path).toBe('/repo/.worktrees/bg-task-1');
    expect(allocation.created).toBe(true);
    expect(execGit).toHaveBeenCalledWith(['worktree', 'add', '/repo/.worktrees/bg-task-1', '-b', 'bg-task-1']);
  });

  it('reuses an existing branch allocation without creating another worktree', async () => {
    const execGit = vi.fn(async () => '');
    const manager = createWorktreeManager({
      repoRoot: '/repo',
      worktreesDir: '/repo/.worktrees',
      execGit,
    });

    const first = await manager.allocate({
      owner: 'agent-a',
      taskId: 'task_1',
      branch: 'shared-branch',
    });
    const second = await manager.allocate({
      owner: 'agent-b',
      taskId: 'task_2',
      branch: 'shared-branch',
    });

    expect(first.path).toBe(second.path);
    expect(second.created).toBe(false);
    expect(execGit).toHaveBeenCalledTimes(1);
  });

  it('tracks cleanup policy and removes managed worktrees', async () => {
    const execGit = vi.fn(async () => '');
    const manager = createWorktreeManager({
      repoRoot: '/repo',
      worktreesDir: '/repo/.worktrees',
      execGit,
    });

    const allocation = await manager.allocate({
      owner: 'agent-a',
      taskId: 'task_9',
      branch: 'cleanup-branch',
      cleanup: 'delete',
    });

    await manager.release(allocation.path);

    expect(execGit).toHaveBeenLastCalledWith(['worktree', 'remove', '/repo/.worktrees/cleanup-branch']);
  });

  it('rejects worktree paths outside the configured boundary', async () => {
    const manager = createWorktreeManager({
      repoRoot: '/repo',
      worktreesDir: '/repo/.worktrees',
      execGit: async () => '',
    });

    expect(() =>
      manager.validatePath('/tmp/escape')
    ).toThrow('outside configured worktree boundary');
  });
});
