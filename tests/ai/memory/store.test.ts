import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileMemoryStore } from '../../../src/ai/memory/store.js';

describe('FileMemoryStore', () => {
  it('separates global and project scoped memory records', async () => {
    const rootDir = join(tmpdir(), `xiaok-memory-store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      const store = new FileMemoryStore(rootDir);
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
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

describe('MemoryRecord type field', () => {
  it('saves and retrieves records with type field', async () => {
    const rootDir = join(tmpdir(), `xiaok-memory-type-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      const store = new FileMemoryStore(rootDir);
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
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('listRelevant filters by type when typeFilter provided', async () => {
    const rootDir = join(tmpdir(), `xiaok-memory-type-filter-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      const store = new FileMemoryStore(rootDir);
      await store.save({ id: 'u1', scope: 'global', title: 'User', summary: 'User pref', tags: [], updatedAt: 1, type: 'user' });
      await store.save({ id: 'f1', scope: 'global', title: 'Feed', summary: 'Feedback note', tags: [], updatedAt: 2, type: 'feedback' });

      const feedbackOnly = await store.listRelevant({ cwd: '/any', query: '', typeFilter: 'feedback' });
      expect(feedbackOnly.every((r) => r.type === 'feedback')).toBe(true);
      expect(feedbackOnly).toHaveLength(1);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
