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
