/** Public ESM signatures from new-worktree.js; no runtime code or ambient any. */
export function sanitizeBranchName(input: string): string;
export function buildWorktreePath(repoRoot: string, branch: string): string;
export function planWorktreeAdd(input: {
  repoRoot: string;
  branch: string;
  hasLocalBranch: boolean;
}): string[];
export function main(): void;
