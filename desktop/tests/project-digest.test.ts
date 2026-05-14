import { describe, it, expect } from 'vitest';
import { buildDigest, formatDigestMarkdown, type DigestInput, type DigestEntry } from '../electron/project-digest.js';

const now = Date.now();
const hour = 3600000;

function makeThread(overrides: Partial<DigestInput['threads'][0]> & { id: string }): DigestInput['threads'][0] {
  return {
    title: `Thread ${overrides.id}`,
    status: 'completed' as const,
    createdAt: now - hour,
    updatedAt: now,
    taskIds: [],
    currentTaskId: null,
    ...overrides,
  };
}

function makeExec(overrides: Partial<DigestInput['skillExecRecords'][0]> & { id: string }): DigestInput['skillExecRecords'][0] {
  return {
    skillNames: ['review'],
    taskId: `task-${overrides.id}`,
    startTime: now - hour,
    endTime: now - hour + 30000,
    durationMs: 30000,
    status: 'success' as const,
    ...overrides,
  };
}

describe('buildDigest', () => {
  it('returns empty summary when no threads', () => {
    const result = buildDigest({ threads: [], skillExecRecords: [], since: now - 24 * hour });
    expect(result.entries).toHaveLength(0);
    expect(result.totalThreads).toBe(0);
  });

  it('returns thread title and time for single thread with no skills', () => {
    const threads = [makeThread({ id: 't1', title: 'Fix login bug' })];
    const result = buildDigest({ threads, skillExecRecords: [], since: now - 24 * hour });
    expect(result.totalThreads).toBe(1);
    expect(result.entries[0].title).toBe('Fix login bug');
    expect(result.entries[0].skillStats).toHaveLength(0);
  });

  it('includes skill stats for thread with matching exec records', () => {
    const threads = [makeThread({ id: 't1', taskIds: ['task-e1'] })];
    const records = [makeExec({ id: 'e1', skillNames: ['review'], durationMs: 45000 })];
    const result = buildDigest({ threads, skillExecRecords: records, since: now - 24 * hour });
    expect(result.entries[0].skillStats).toHaveLength(1);
    expect(result.entries[0].skillStats[0].name).toBe('review');
    expect(result.entries[0].skillStats[0].count).toBe(1);
    expect(result.entries[0].skillStats[0].status).toBe('success');
  });

  it('aggregates multiple skill execs per thread', () => {
    const threads = [makeThread({ id: 't1', taskIds: ['task-e1', 'task-e2', 'task-e3'] })];
    const records = [
      makeExec({ id: 'e1', skillNames: ['review'], status: 'success' }),
      makeExec({ id: 'e2', skillNames: ['review'], status: 'error' }),
      makeExec({ id: 'e3', skillNames: ['qa'], status: 'success' }),
    ];
    const result = buildDigest({ threads, skillExecRecords: records, since: now - 24 * hour });
    const stats = result.entries[0].skillStats;
    expect(stats).toHaveLength(2);
    const review = stats.find(s => s.name === 'review')!;
    expect(review.count).toBe(2);
    expect(review.errorCount).toBe(1);
  });

  it('filters by time range', () => {
    const threads = [
      makeThread({ id: 't1', createdAt: now - 2 * hour }),
      makeThread({ id: 't2', createdAt: now - 48 * hour }),
    ];
    const result = buildDigest({ threads, skillExecRecords: [], since: now - 24 * hour });
    expect(result.totalThreads).toBe(1);
    expect(result.entries[0].title).toBe('Thread t1');
  });

  it('handles corrupted skill-exec records gracefully', () => {
    const threads = [makeThread({ id: 't1', taskIds: ['task-e1'] })];
    const records = [
      makeExec({ id: 'e1' }),
      { bad: 'record' } as any,
    ];
    const result = buildDigest({ threads, skillExecRecords: records, since: now - 24 * hour });
    expect(result.entries[0].skillStats).toHaveLength(1);
  });

  it('handles empty skill names array', () => {
    const threads = [makeThread({ id: 't1', taskIds: ['task-e1'] })];
    const records = [makeExec({ id: 'e1', skillNames: [] })];
    const result = buildDigest({ threads, skillExecRecords: records, since: now - 24 * hour });
    expect(result.entries[0].skillStats).toHaveLength(0);
  });
});

describe('formatDigestMarkdown', () => {
  it('returns empty message for no entries', () => {
    const result = formatDigestMarkdown({ entries: [], totalThreads: 0, since: now - 24 * hour });
    expect(result).toContain('暂无活动');
  });

  it('formats structured summary as markdown', () => {
    const entries: DigestEntry[] = [{
      threadId: 't1',
      title: 'Fix login bug',
      status: 'completed',
      createdAt: now - hour,
      skillStats: [{ name: 'review', count: 1, status: 'success', errorCount: 0, avgDurationMs: 30000 }],
      deliverables: [],
    }];
    const result = formatDigestMarkdown({ entries, totalThreads: 1, since: now - 24 * hour });
    expect(result).toContain('Fix login bug');
    expect(result).toContain('review');
    expect(result).toContain('1 次');
  });

  it('includes deliverables when present', () => {
    const entries: DigestEntry[] = [{
      threadId: 't1',
      title: 'Build report',
      status: 'completed',
      createdAt: now - hour,
      skillStats: [],
      deliverables: [{ name: 'report.html', type: 'text/html' }],
    }];
    const result = formatDigestMarkdown({ entries, totalThreads: 1, since: now - 24 * hour });
    expect(result).toContain('report.html');
  });
});
