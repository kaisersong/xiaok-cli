import { resolve, relative, sep, join } from 'path';

export type WorktreeCleanupPolicy = 'keep' | 'delete';

export interface WorktreeAllocationRecord {
  branch: string;
  path: string;
  owner: string;
  taskId: string;
  cleanup: WorktreeCleanupPolicy;
  created: boolean;
}

export interface AllocateWorktreeInput {
  owner: string;
  taskId: string;
  branch: string;
  cleanup?: WorktreeCleanupPolicy;
}

export interface WorktreeManagerOptions {
  repoRoot: string;
  worktreesDir: string;
  execGit(args: string[]): Promise<string>;
}

export interface WorktreeManager {
  allocate(input: AllocateWorktreeInput): Promise<WorktreeAllocationRecord>;
  release(path: string): Promise<void>;
  validatePath(path: string): string;
}

function isWithinBoundary(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  const rel = relative(normalizedRoot, normalizedCandidate);
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`));
}

export function createWorktreeManager(options: WorktreeManagerOptions): WorktreeManager {
  const allocations = new Map<string, WorktreeAllocationRecord>();
  const normalizedRoot = resolve(options.repoRoot);
  const normalizedWorktreesDir = resolve(options.worktreesDir);

  return {
    async allocate(input) {
      const existing = allocations.get(input.branch);
      if (existing) {
        return { ...existing, created: false };
      }

      const worktreePath = this.validatePath(join(normalizedWorktreesDir, input.branch));
      await options.execGit(['worktree', 'add', worktreePath, '-b', input.branch]);

      const allocation: WorktreeAllocationRecord = {
        branch: input.branch,
        path: worktreePath,
        owner: input.owner,
        taskId: input.taskId,
        cleanup: input.cleanup ?? 'keep',
        created: true,
      };
      allocations.set(input.branch, allocation);
      return allocation;
    },

    async release(path) {
      const normalizedPath = this.validatePath(path);
      const match = [...allocations.values()].find((entry) => entry.path === normalizedPath);
      if (!match) {
        return;
      }

      if (match.cleanup === 'delete') {
        await options.execGit(['worktree', 'remove', normalizedPath]);
      }

      allocations.delete(match.branch);
    },

    validatePath(path) {
      const normalizedPath = resolve(path);
      if (!isWithinBoundary(normalizedRoot, normalizedPath) || !isWithinBoundary(normalizedWorktreesDir, normalizedPath)) {
        throw new Error(`worktree path is outside configured worktree boundary: ${path}`);
      }
      return normalizedPath;
    },
  };
}
