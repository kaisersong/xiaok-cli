#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function runGit(args, cwd, stdio = 'pipe') {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio }).trim();
}

export function sanitizeBranchName(input) {
  return input.trim().replace(/\s+/g, '-');
}

export function buildWorktreePath(repoRoot, branch) {
  return join(repoRoot, '.worktrees', branch.replace(/[\\/]+/g, '-'));
}

export function planWorktreeAdd({ repoRoot, branch, hasLocalBranch }) {
  const worktreePath = buildWorktreePath(repoRoot, branch);
  if (hasLocalBranch) {
    return ['git', '-C', repoRoot, 'worktree', 'add', worktreePath, branch];
  }
  return ['git', '-C', repoRoot, 'worktree', 'add', '-b', branch, worktreePath, 'origin/master'];
}

function hasLocalBranch(repoRoot, branch) {
  return spawnSync('git', ['-C', repoRoot, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).status === 0;
}

function main() {
  const rawBranch = process.argv[2];
  if (!rawBranch) throw new Error('usage: npm run worktree:new -- <branch-name>');

  const branch = sanitizeBranchName(rawBranch);
  if (!branch) throw new Error('branch name cannot be empty');

  const repoRoot = runGit(['rev-parse', '--show-toplevel'], process.cwd());
  const worktreeRoot = join(repoRoot, '.worktrees');
  const worktreePath = buildWorktreePath(repoRoot, branch);
  mkdirSync(worktreeRoot, { recursive: true });

  if (existsSync(worktreePath)) {
    process.stdout.write(`${worktreePath}\n`);
    return;
  }

  const command = planWorktreeAdd({
    repoRoot,
    branch,
    hasLocalBranch: hasLocalBranch(repoRoot, branch),
  });
  execFileSync(command[0], command.slice(1), { stdio: 'inherit' });
  process.stdout.write(`${worktreePath}\n`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[worktree-new] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
