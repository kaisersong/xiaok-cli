import { describe, expect, it } from 'vitest';
import { FileMemoryStore } from '../../../src/ai/memory/store.js';

describe('FileMemoryStore', () => {
  it('separates global and project scoped memory records', async () => {
    const store = new FileMemoryStore('/tmp/xiaok-memory-store');
    await store.save({
      id: 'mem_global',
      scope: 'global',
      title: 'Global',
      summary: 'Global preference',
      tags: ['pref'],
      updatedAt: 1,
    });
    await store.save({
      id: 'mem_project',
      scope: 'project',
      cwd: '/repo',
      title: 'Project',
      summary: 'Repo-specific note',
      tags: ['repo'],
      updatedAt: 2,
    });

    const records = await store.listRelevant({ cwd: '/repo', query: 'Repo-specific' });
    expect(records.map((record) => record.id)).toEqual(['mem_project', 'mem_global']);
  });
});

describe('MemoryRecord type field', () => {
  it('saves and retrieves records with type field', async () => {
    const store = new FileMemoryStore('/tmp/xiaok-memory-type');
    await store.save({
      id: 'mem_typed',
      scope: 'global',
      title: 'Feedback',
      summary: 'Always TDD.',
      tags: [],
      updatedAt: 1,
      type: 'feedback',
    });

    const records = await store.listRelevant({ cwd: '/any', query: 'TDD' });
    expect(records[0]?.type).toBe('feedback');
  });

  it('listRelevant filters by type when typeFilter provided', async () => {
    const store = new FileMemoryStore('/tmp/xiaok-memory-type-filter');
    await store.save({ id: 'u1', scope: 'global', title: 'User', summary: 'User pref', tags: [], updatedAt: 1, type: 'user' });
    await store.save({ id: 'f1', scope: 'global', title: 'Feed', summary: 'Feedback note', tags: [], updatedAt: 2, type: 'feedback' });

    const feedbackOnly = await store.listRelevant({ cwd: '/any', query: '', typeFilter: 'feedback' });
    expect(feedbackOnly.every((r) => r.type === 'feedback')).toBe(true);
    expect(feedbackOnly).toHaveLength(1);
  });
});
