import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildWorktreePath, planWorktreeAdd, sanitizeBranchName } from '../../scripts/new-worktree.js';

describe('sanitizeBranchName', () => {
  it('normalizes whitespace for branch names', () => {
    expect(sanitizeBranchName('  feature runtime hygiene  ')).toBe('feature-runtime-hygiene');
  });
});

describe('buildWorktreePath', () => {
  it('maps slash branch names into stable worktree paths', () => {
    expect(buildWorktreePath('/repo', 'feature/runtime-hygiene')).toBe(join('/repo', '.worktrees', 'feature-runtime-hygiene'));
  });
});

describe('planWorktreeAdd', () => {
  it('creates a new branch from origin/master when the branch does not exist', () => {
    expect(planWorktreeAdd({
      repoRoot: '/repo',
      branch: 'feature/runtime-hygiene',
      hasLocalBranch: false,
    })).toEqual([
      'git',
      '-C',
      '/repo',
      'worktree',
      'add',
      '-b',
      'feature/runtime-hygiene',
      join('/repo', '.worktrees', 'feature-runtime-hygiene'),
      'origin/master',
    ]);
  });

  it('reuses an existing local branch when present', () => {
    expect(planWorktreeAdd({
      repoRoot: '/repo',
      branch: 'feature/runtime-hygiene',
      hasLocalBranch: true,
    })).toEqual([
      'git',
      '-C',
      '/repo',
      'worktree',
      'add',
      join('/repo', '.worktrees', 'feature-runtime-hygiene'),
      'feature/runtime-hygiene',
    ]);
  });
});
