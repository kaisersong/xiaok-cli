import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createWorktreeManager } from '../../../src/platform/worktrees/manager.js';

describe('worktree manager', () => {
  function setup(
    processStatus: 'same' | 'missing' | 'mismatch' | 'unknown' = 'same',
    pathUsage: 'used' | 'free' | 'unknown' = 'free',
  ) {
    const repoRoot = mkdtempSync(join(tmpdir(), 'xiaok-worktree-manager-'));
    const worktreesDir = join(repoRoot, '.worktrees');
    const gitWorktrees = new Map<string, string>();
    const branches = new Set<string>();
    let lockOid: string | null = null;
    const execGit = vi.fn(async (args: string[]) => {
      if (args[0] === 'hash-object') return 'a'.repeat(40);
      if (args[0] === 'update-ref' && args[1] === '-d') {
        if (lockOid !== args[3]) throw new Error('lock owner changed');
        lockOid = null;
        return '';
      }
      if (args[0] === 'update-ref') {
        if (lockOid) throw new Error('lock occupied');
        lockOid = args[2];
        return '';
      }
      if (args[0] === 'worktree' && args[1] === 'list') {
        return [...gitWorktrees.entries()]
          .map(([path, branch]) => `worktree ${path}\nbranch refs/heads/${branch}\n`)
          .join('\n');
      }
      if (args[0] === 'show-ref') {
        if (!branches.has(args.at(-1)!.replace('refs/heads/', ''))) {
          throw new Error('missing ref');
        }
        return '';
      }
      if (args[0] === 'worktree' && args[1] === 'add') {
        const path = args[2];
        const branch = args[3] === '-b' ? args[4] : args[3];
        branches.add(branch);
        gitWorktrees.set(path, branch);
        mkdirSync(path, { recursive: true });
        return '';
      }
      if (args[0] === 'worktree' && args[1] === 'remove') {
        gitWorktrees.delete(args[2]);
        rmSync(args[2], { recursive: true, force: true });
        return '';
      }
      if (args[0] === 'cat-file') {
        return JSON.stringify({
          token: 'lock-token',
          pid: 100,
          startedAt: 'start-100',
          cwd: repoRoot,
          acquiredAt: 1,
        });
      }
      if (args[0] === 'rev-parse') return lockOid ?? '';
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    });
    const manager = createWorktreeManager({
      repoRoot,
      worktreesDir,
      execGit,
      getCurrentProcessIdentity: async () => ({
        pid: 100,
        startedAt: 'start-100',
        cwd: repoRoot,
      }),
      inspectProcess: async () => ({
        status: processStatus,
        startedAt: 'start-100',
        cwd: repoRoot,
      }),
      inspectPathUsage: async () => pathUsage,
      now: () => 1,
    });
    return {
      repoRoot,
      worktreesDir,
      gitWorktrees,
      branches,
      execGit,
      manager,
      cleanup: () => rmSync(repoRoot, { recursive: true, force: true }),
    };
  }

  it('persists allocating before git add and active after success', async () => {
    const fixture = setup();
    const states: string[] = [];
    fixture.execGit.mockImplementationOnce(async () => 'a'.repeat(40));
    const original = fixture.execGit.getMockImplementation()!;
    fixture.execGit.mockImplementation(async (args: string[]) => {
      if (args[0] === 'worktree' && args[1] === 'add') {
        const document = JSON.parse(
          readFileSync(join(fixture.worktreesDir, '.xiaok-worktree-registry'), 'utf8'),
        );
        states.push(document.leases[0].state);
      }
      return original(args);
    });

    const allocation = await fixture.manager.allocate({
      owner: 'agent-a',
      taskId: 'task_1',
      branch: 'bg-task-1',
    });

    const expectedPath = resolve(fixture.worktreesDir, 'bg-task-1');
    expect(allocation.path).toBe(expectedPath);
    expect(allocation.created).toBe(true);
    expect(states).toEqual(['allocating']);
    expect(JSON.parse(
      readFileSync(join(fixture.worktreesDir, '.xiaok-worktree-registry'), 'utf8'),
    ).leases[0].state).toBe('active');
    fixture.cleanup();
  });

  it('rejects a live different task that requests the same branch', async () => {
    const fixture = setup();
    await fixture.manager.allocate({
      owner: 'agent-a',
      taskId: 'task_1',
      branch: 'shared-branch',
    });
    await expect(fixture.manager.allocate({
      owner: 'agent-b',
      taskId: 'task_2',
      branch: 'shared-branch',
    })).rejects.toThrow('branch_in_use');
    fixture.cleanup();
  });

  it('reuses the same live owner and task without another git add', async () => {
    const fixture = setup();
    const first = await fixture.manager.allocate({
      owner: 'agent-a',
      taskId: 'task_same',
      branch: 'same-branch',
    });
    const addCallsBefore = fixture.execGit.mock.calls.filter(
      ([args]) => args[0] === 'worktree' && args[1] === 'add',
    ).length;

    const second = await fixture.manager.allocate({
      owner: 'agent-a',
      taskId: 'task_same',
      branch: 'same-branch',
    });

    expect(second).toEqual({ ...first, created: false });
    expect(fixture.execGit.mock.calls.filter(
      ([args]) => args[0] === 'worktree' && args[1] === 'add',
    )).toHaveLength(addCallsBefore);
    fixture.cleanup();
  });

  it('reuses an existing branch ref without passing -b', async () => {
    const fixture = setup();
    fixture.branches.add('existing-branch');

    const allocation = await fixture.manager.allocate({
      owner: 'agent-a',
      taskId: 'task_existing',
      branch: 'existing-branch',
    });

    expect(fixture.execGit).toHaveBeenCalledWith([
      'worktree',
      'add',
      allocation.path,
      'existing-branch',
    ]);
    fixture.cleanup();
  });

  it('keeps registry ownership when remove fails', async () => {
    const fixture = setup();
    const allocation = await fixture.manager.allocate({
      owner: 'agent-a',
      taskId: 'task_9',
      branch: 'cleanup-branch',
      cleanup: 'delete',
    });
    const original = fixture.execGit.getMockImplementation()!;
    fixture.execGit.mockImplementation(async (args: string[]) => {
      if (args[0] === 'worktree' && args[1] === 'remove') {
        throw new Error('dirty worktree');
      }
      return original(args);
    });
    await expect(fixture.manager.release(allocation.path)).rejects.toThrow(
      'dirty worktree',
    );
    expect(JSON.parse(
      readFileSync(join(fixture.worktreesDir, '.xiaok-worktree-registry'), 'utf8'),
    ).leases[0].state).toBe('released');
    fixture.cleanup();
  });

  it('refuses to release a live worktree owned by another allocator identity', async () => {
    const fixture = setup();
    const allocation = await fixture.manager.allocate({
      owner: 'agent-a',
      taskId: 'task_foreign',
      branch: 'foreign-branch',
      cleanup: 'delete',
    });
    const document = JSON.parse(readFileSync(
      join(fixture.worktreesDir, '.xiaok-worktree-registry'),
      'utf8',
    ));
    document.leases[0].allocator = {
      pid: 200,
      startedAt: 'start-200',
      cwd: fixture.repoRoot,
    };
    writeFileSync(
      join(fixture.worktreesDir, '.xiaok-worktree-registry'),
      JSON.stringify(document, null, 2),
      'utf8',
    );

    await expect(fixture.manager.release(allocation.path)).rejects.toThrow(
      'release_forbidden_active_allocator',
    );
    expect(fixture.gitWorktrees.has(allocation.path)).toBe(true);
    fixture.cleanup();
  });

  it('fails closed when registry JSON is corrupt', async () => {
    const fixture = setup();
    mkdirSync(fixture.worktreesDir, { recursive: true });
    writeFileSync(
      join(fixture.worktreesDir, '.xiaok-worktree-registry'),
      '{broken',
      'utf8',
    );
    await expect(fixture.manager.reconcile()).rejects.toThrow(
      'worktree registry is invalid',
    );
    expect(fixture.execGit).not.toHaveBeenCalledWith(
      expect.arrayContaining(['worktree', 'remove']),
    );
    fixture.cleanup();
  });

  it('reports dry-run candidates without changing registry or removing worktrees', async () => {
    const fixture = setup();
    const allocation = await fixture.manager.allocate({
      owner: 'agent-a',
      taskId: 'task_gc',
      branch: 'gc-branch',
      cleanup: 'delete',
    });
    const registryPath = join(
      fixture.worktreesDir,
      '.xiaok-worktree-registry',
    );
    const document = JSON.parse(readFileSync(registryPath, 'utf8'));
    document.leases[0].state = 'released';
    writeFileSync(registryPath, JSON.stringify(document, null, 2), 'utf8');
    const before = readFileSync(registryPath, 'utf8');
    const removeCallsBefore = fixture.execGit.mock.calls.filter(
      ([args]) => args[0] === 'worktree' && args[1] === 'remove',
    ).length;

    const result = await fixture.manager.gc();

    expect(result).toMatchObject({
      dryRun: true,
      candidates: ['gc-branch'],
      removed: [],
    });
    expect(readFileSync(registryPath, 'utf8')).toBe(before);
    expect(fixture.execGit.mock.calls.filter(
      ([args]) => args[0] === 'worktree' && args[1] === 'remove',
    )).toHaveLength(removeCallsBefore);
    expect(existsSync(allocation.path)).toBe(true);
    fixture.cleanup();
  });

  it('removes a released managed worktree during non-dry-run gc', async () => {
    const fixture = setup();
    const allocation = await fixture.manager.allocate({
      owner: 'agent-a',
      taskId: 'task_gc_remove',
      branch: 'gc-remove-branch',
      cleanup: 'delete',
    });
    const registryPath = join(
      fixture.worktreesDir,
      '.xiaok-worktree-registry',
    );
    const document = JSON.parse(readFileSync(registryPath, 'utf8'));
    document.leases[0].state = 'released';
    writeFileSync(registryPath, JSON.stringify(document, null, 2), 'utf8');

    const result = await fixture.manager.gc({ dryRun: false });

    expect(result.removed).toEqual(['gc-remove-branch']);
    expect(existsSync(allocation.path)).toBe(false);
    expect(JSON.parse(readFileSync(registryPath, 'utf8')).leases).toEqual([]);
    fixture.cleanup();
  });

  it('does not remove a released worktree while path usage is confirmed', async () => {
    const fixture = setup('same', 'used');
    const allocation = await fixture.manager.allocate({
      owner: 'agent-a',
      taskId: 'task_gc_used',
      branch: 'gc-used-branch',
      cleanup: 'delete',
    });
    const registryPath = join(
      fixture.worktreesDir,
      '.xiaok-worktree-registry',
    );
    const document = JSON.parse(readFileSync(registryPath, 'utf8'));
    document.leases[0].state = 'released';
    writeFileSync(registryPath, JSON.stringify(document, null, 2), 'utf8');

    const result = await fixture.manager.gc({ dryRun: false });

    expect(result.removed).toEqual([]);
    expect(result.skipped).toContainEqual({
      branch: 'gc-used-branch',
      reason: 'path_used',
    });
    expect(existsSync(allocation.path)).toBe(true);
    fixture.cleanup();
  });

  it('recovers an allocating lease from git registration', async () => {
    const fixture = setup();
    const path = join(fixture.worktreesDir, 'recover-branch');
    mkdirSync(path, { recursive: true });
    fixture.gitWorktrees.set(path, 'recover-branch');
    fixture.branches.add('recover-branch');
    writeFileSync(
      join(fixture.worktreesDir, '.xiaok-worktree-registry'),
      JSON.stringify({
        schemaVersion: 1,
        leases: [{
          branch: 'recover-branch',
          path,
          owner: 'agent-a',
          taskId: 'task_recover',
          cleanup: 'delete',
          state: 'allocating',
          allocator: { pid: 100, startedAt: 'start-100', cwd: fixture.repoRoot },
          createdAt: 1,
          updatedAt: 1,
        }],
      }),
      'utf8',
    );

    await expect(fixture.manager.reconcile()).resolves.toMatchObject({
      changed: ['recover-branch'],
    });
    expect(JSON.parse(readFileSync(
      join(fixture.worktreesDir, '.xiaok-worktree-registry'),
      'utf8',
    )).leases[0].state).toBe('active');
    fixture.cleanup();
  });

  it('rejects a branch checked out by an unowned git worktree', async () => {
    const fixture = setup();
    const unownedPath = join(fixture.worktreesDir, 'manual');
    mkdirSync(unownedPath, { recursive: true });
    fixture.gitWorktrees.set(unownedPath, 'manual-branch');
    fixture.branches.add('manual-branch');

    await expect(fixture.manager.allocate({
      owner: 'agent-a',
      taskId: 'task_manual',
      branch: 'manual-branch',
    })).rejects.toThrow('branch_checked_out_unowned');
    expect(existsSync(
      join(fixture.worktreesDir, '.xiaok-worktree-registry'),
    )).toBe(false);
    fixture.cleanup();
  });

  it.skipIf(process.platform === 'win32')(
    'refuses release when a managed path is replaced by a symlink',
    async () => {
      const fixture = setup();
      const allocation = await fixture.manager.allocate({
        owner: 'agent-a',
        taskId: 'task_symlink',
        branch: 'symlink-branch',
        cleanup: 'delete',
      });
      rmSync(allocation.path, { recursive: true, force: true });
      symlinkSync(fixture.repoRoot, allocation.path);

      await expect(fixture.manager.release(allocation.path)).rejects.toThrow(
        'unsafe worktree path',
      );
      fixture.cleanup();
    },
  );

  it('takes over a stale lock only through observed-OID CAS', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'xiaok-worktree-lock-'));
    const worktreesDir = join(repoRoot, '.worktrees');
    let lockOid: string | null = 'b'.repeat(40);
    const calls: string[][] = [];
    const execGit = vi.fn(async (args: string[]) => {
      calls.push(args);
      if (args[0] === 'hash-object') return 'a'.repeat(40);
      if (args[0] === 'rev-parse') return lockOid ?? '';
      if (args[0] === 'cat-file') {
        return JSON.stringify({
          token: 'stale',
          pid: 99,
          startedAt: 'old-start',
          cwd: repoRoot,
          acquiredAt: 1,
        });
      }
      if (args[0] === 'update-ref' && args[1] === '-d') {
        if (lockOid !== args[3]) throw new Error('owner changed');
        lockOid = null;
        return '';
      }
      if (args[0] === 'update-ref') {
        if (lockOid) throw new Error('occupied');
        lockOid = args[2];
        return '';
      }
      if (args[0] === 'worktree' && args[1] === 'list') return '';
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    });
    const manager = createWorktreeManager({
      repoRoot,
      worktreesDir,
      execGit,
      getCurrentProcessIdentity: async () => ({
        pid: 100,
        startedAt: 'new-start',
        cwd: repoRoot,
      }),
      inspectProcess: async () => ({ status: 'missing' }),
    });

    await expect(manager.reconcile()).resolves.toEqual({
      changed: [],
      skipped: [],
    });
    expect(calls).toContainEqual([
      'update-ref',
      '-d',
      'refs/xiaok/worktree-registry-lock',
      'b'.repeat(40),
    ]);
    expect(lockOid).toBeNull();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('rejects worktree paths outside the configured boundary', async () => {
    const manager = createWorktreeManager({
      repoRoot: '/repo',
      worktreesDir: '/repo/.worktrees',
      execGit: async () => '',
    });

    expect(() =>
      manager.validatePath(join(resolve('/tmp'), 'escape'))
    ).toThrow('outside configured worktree boundary');
  });
});
