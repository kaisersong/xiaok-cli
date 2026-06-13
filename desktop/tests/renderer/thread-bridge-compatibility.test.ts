import { describe, expect, it } from 'vitest';
import { withoutThreadCompatibility, withThreadCompatibility } from '../../renderer/src/api/bridge';
import type { ThreadRecord } from '../../renderer/src/api/types';

function makeThread(overrides: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    id: 'thread-1',
    title: 'Work thread',
    status: 'idle',
    mode: 'work',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_060_000,
    starred: false,
    gtdBucket: 'inbox',
    pinnedAt: null,
    currentTaskId: null,
    taskIds: [],
    ...overrides,
  };
}

describe('thread bridge compatibility fields', () => {
  it('keeps sidebar work folder as durable thread state while stripping compatibility-only fields', () => {
    const stored = withoutThreadCompatibility(makeThread({
      sidebar_work_folder: '/Users/song/projects/xiaok-cli',
      created_at: '2026-06-14T00:00:00.000Z',
      updated_at: '2026-06-14T00:01:00.000Z',
      sidebar_pinned_at: 1_700_000_060_000,
      sidebar_gtd_bucket: 'next',
      active_run_id: 'run_1',
      is_private: false,
      collaboration_mode: 'solo',
      collaboration_mode_revision: 3,
    }));

    expect(stored.sidebar_work_folder).toBe('/Users/song/projects/xiaok-cli');
    expect(stored).not.toHaveProperty('created_at');
    expect(stored).not.toHaveProperty('updated_at');
    expect(stored).not.toHaveProperty('sidebar_pinned_at');
    expect(stored).not.toHaveProperty('sidebar_gtd_bucket');
    expect(stored).not.toHaveProperty('active_run_id');
  });

  it('returns web-client compatibility aliases without overwriting durable sidebar work folder', () => {
    const compatible = withThreadCompatibility(makeThread({
      sidebar_work_folder: '/Users/song/projects/xiaok-cli',
      gtdBucket: 'next',
      pinnedAt: 1_700_000_060_000,
    }));

    expect(compatible.sidebar_work_folder).toBe('/Users/song/projects/xiaok-cli');
    expect(compatible.sidebar_gtd_bucket).toBe('next');
    expect(compatible.sidebar_pinned_at).toBe(1_700_000_060_000);
    expect(compatible.created_at).toBe('2023-11-14T22:13:20.000Z');
    expect(compatible.updated_at).toBe('2023-11-14T22:14:20.000Z');
  });
});
