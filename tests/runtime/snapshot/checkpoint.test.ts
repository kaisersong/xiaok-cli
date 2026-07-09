import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  captureCheckpoint,
  diffCheckpoints,
  revertToCheckpoint,
} from '../../../src/runtime/snapshot/checkpoint.js';

describe('stage checkpoints', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `xiaok-checkpoint-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('captures dirty git worktrees with git stash create without mutating files', async () => {
    execFileSync('git', ['init'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root });
    writeFileSync(join(root, 'report.md'), 'base\n');
    execFileSync('git', ['add', 'report.md'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'base'], { cwd: root });
    writeFileSync(join(root, 'report.md'), 'draft\n');

    const checkpoint = await captureCheckpoint(root, 'sess_1', 'stage_1', 'stage-start');

    expect(checkpoint.method).toBe('git-stash');
    expect(checkpoint.ref).toMatch(/^[0-9a-f]{40}$/);
    expect(checkpoint.id).toMatch(/^sess_1-stage_1-stage-start-\d+-[a-z0-9]{4}$/);
    expect(checkpoint.files['report.md']).toMatch(/^[0-9a-f]{16}$/);
    expect(readFileSync(join(root, 'report.md'), 'utf8')).toBe('draft\n');
  });

  it('falls back to file-copy with a file-count warning for non-git projects', async () => {
    writeFileSync(join(root, 'a.txt'), 'a');
    writeFileSync(join(root, 'b.txt'), 'b');
    writeFileSync(join(root, 'c.txt'), 'c');

    const checkpoint = await captureCheckpoint(root, 'sess_1', 'stage_1', 'stage-start', {
      maxFiles: 2,
    });

    expect(checkpoint.method).toBe('file-copy');
    expect(Object.keys(checkpoint.files)).toHaveLength(2);
    expect(checkpoint.warnings).toContain('file-copy checkpoint reached maxFiles=2; remaining files were skipped');
    expect(existsSync(checkpoint.ref)).toBe(true);
  });

  it('diffs checkpoint file records', async () => {
    const diff = await diffCheckpoints({
      id: 'from',
      sessionId: 's',
      stageId: 'stage',
      boundary: 'stage-start',
      method: 'file-copy',
      ref: '/tmp/from',
      files: {
        'changed.md': 'old',
        'deleted.md': 'old',
      },
      capturedAt: '2026-06-30T00:00:00.000Z',
    }, {
      id: 'to',
      sessionId: 's',
      stageId: 'stage',
      boundary: 'stage-end',
      method: 'file-copy',
      ref: '/tmp/to',
      files: {
        'changed.md': 'new',
        'added.md': 'new',
      },
      capturedAt: '2026-06-30T00:01:00.000Z',
    });

    expect(diff).toEqual([
      { path: 'changed.md', status: 'modified' },
      { path: 'deleted.md', status: 'deleted' },
      { path: 'added.md', status: 'added' },
    ]);
  });

  it('creates a safety snapshot before reverting a file-copy checkpoint', async () => {
    writeFileSync(join(root, 'draft.md'), 'before');
    const checkpoint = await captureCheckpoint(root, 'sess_1', 'stage_1', 'stage-start');
    writeFileSync(join(root, 'draft.md'), 'after');

    const result = await revertToCheckpoint(root, checkpoint);

    expect(result.success).toBe(true);
    expect(result.safetySnapshot).toBeDefined();
    expect(result.safetySnapshot?.id).not.toBe(checkpoint.id);
    expect(readFileSync(join(root, 'draft.md'), 'utf8')).toBe('before');
  });
});
