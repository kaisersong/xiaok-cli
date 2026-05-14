import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UserMemoryStore, type UserMemory } from '../electron/user-memory.js';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = '/tmp/xiaok-user-memory-test';

function setupStore() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
  const store = new UserMemoryStore(TEST_DIR);
  return { store, cleanup: () => { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true }); } };
}

describe('UserMemoryStore', () => {
  let store: UserMemoryStore;
  let cleanup: () => void;

  beforeEach(() => {
    const { store: s, cleanup: c } = setupStore();
    store = s;
    cleanup = c;
  });

  afterEach(() => { cleanup(); });

  describe('create', () => {
    it('creates a memory with content and tags', () => {
      const m = store.create({ content: 'User prefers dark mode', tags: ['preference', 'ui'] });
      expect(m.id).toBeDefined();
      expect(m.content).toBe('User prefers dark mode');
      expect(m.tags).toEqual(['preference', 'ui']);
      expect(m.createdAt).toBeGreaterThan(0);
    });

    it('persists memory to disk', () => {
      store.create({ content: 'Test persist', tags: ['test'] });
      const store2 = new UserMemoryStore(TEST_DIR);
      expect(store2.list()).toHaveLength(1);
      expect(store2.list()[0].content).toBe('Test persist');
    });

    it('handles empty tags', () => {
      const m = store.create({ content: 'No tags', tags: [] });
      expect(m.tags).toEqual([]);
    });
  });

  describe('list', () => {
    it('returns memories sorted by time descending', () => {
      store.create({ content: 'First', tags: [] });
      store.create({ content: 'Second', tags: [] });
      store.create({ content: 'Third', tags: [] });
      const list = store.list();
      expect(list).toHaveLength(3);
      expect(list[0].content).toBe('Third');
      expect(list[2].content).toBe('First');
    });

    it('returns empty for new store', () => {
      expect(store.list()).toHaveLength(0);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      store.create({ content: 'User prefers dark mode for coding', tags: ['preference'] });
      store.create({ content: 'Project alpha uses React + TypeScript', tags: ['project', 'tech'] });
      store.create({ content: 'Always run tests before commit', tags: ['workflow'] });
    });

    it('finds by content match', () => {
      const results = store.search('dark mode');
      expect(results).toHaveLength(1);
      expect(results[0].content).toContain('dark mode');
    });

    it('finds by tag match', () => {
      const results = store.search('preference');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(r => r.tags.includes('preference'))).toBe(true);
    });

    it('returns empty for no match', () => {
      expect(store.search('nonexistent xyz')).toHaveLength(0);
    });

    it('handles special characters gracefully', () => {
      expect(() => store.search('[regex](danger)')).not.toThrow();
    });

    it('case insensitive search', () => {
      expect(store.search('REACT')).toHaveLength(1);
    });
  });

  describe('delete', () => {
    it('deletes a memory by id', () => {
      const m = store.create({ content: 'To delete', tags: [] });
      expect(store.delete(m.id)).toBe(true);
      expect(store.list()).toHaveLength(0);
    });

    it('returns false for non-existent id', () => {
      expect(store.delete('non-existent')).toBe(false);
    });

    it('persists deletion', () => {
      store.create({ content: 'Keep', tags: [] });
      const m = store.create({ content: 'Remove', tags: [] });
      store.delete(m.id);
      const store2 = new UserMemoryStore(TEST_DIR);
      expect(store2.list()).toHaveLength(1);
      expect(store2.list()[0].content).toBe('Keep');
    });
  });

  describe('corrupted file', () => {
    it('handles corrupted store file gracefully', () => {
      writeFileSync(join(TEST_DIR, 'user-memories.json'), '{{{not json');
      const store2 = new UserMemoryStore(TEST_DIR);
      expect(store2.list()).toHaveLength(0);
      expect(() => store2.create({ content: 'After corrupt', tags: [] })).not.toThrow();
    });
  });

  describe('max entries', () => {
    it('auto-cleans oldest when exceeding limit', () => {
      for (let i = 0; i < 510; i++) {
        store.create({ content: `Memory ${i}`, tags: [] });
      }
      expect(store.list().length).toBeLessThanOrEqual(500);
    });
  });

  describe('update', () => {
    it('updates content', () => {
      const m = store.create({ content: 'Old content', tags: ['old'] });
      const updated = store.update(m.id, { content: 'New content' });
      expect(updated!.content).toBe('New content');
      expect(store.list()[0].content).toBe('New content');
    });

    it('updates tags', () => {
      const m = store.create({ content: 'Test', tags: ['old'] });
      const updated = store.update(m.id, { tags: ['new', 'tags'] });
      expect(updated!.tags).toEqual(['new', 'tags']);
    });

    it('returns null for non-existent id', () => {
      expect(store.update('non-existent', { content: 'x' })).toBeNull();
    });
  });

  describe('importMemories', () => {
    it('imports new memories', () => {
      const result = store.importMemories([
        { content: 'Imported memory 1', tags: ['import'] },
        { content: 'Imported memory 2', tags: ['import'] },
      ]);
      expect(result.imported).toBe(2);
      expect(result.deduped).toBe(0);
      expect(store.list()).toHaveLength(2);
    });

    it('deduplicates against existing', () => {
      store.create({ content: 'Existing memory', tags: [] });
      const result = store.importMemories([
        { content: 'Existing memory', tags: [] },
        { content: 'New memory', tags: [] },
      ]);
      expect(result.imported).toBe(1);
      expect(result.deduped).toBe(1);
    });

    it('auto-tags when no tags provided', () => {
      store.importMemories([
        { content: '用户偏好深色主题' },
        { content: '项目 alpha 的技术栈是 React' },
        { content: '部署前必须跑测试' },
      ]);
      const list = store.list();
      expect(list[2].tags).toContain('preference');
      expect(list[1].tags).toContain('project');
      expect(list[0].tags).toContain('workflow');
    });

    it('skips empty content', () => {
      const result = store.importMemories([
        { content: '' },
        { content: '   ' },
        { content: 'Valid' },
      ]);
      expect(result.imported).toBe(1);
    });

    it('marks source as import', () => {
      store.importMemories([{ content: 'From export', source: 'claude-code' }]);
      expect(store.list()[0].source).toBe('claude-code');
    });
  });
});
