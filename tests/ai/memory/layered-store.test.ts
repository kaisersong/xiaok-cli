import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LayeredMemoryStore, type LayeredMemoryConfig } from '../../../src/ai/memory/layered-store.js';

describe('LayeredMemoryStore', () => {
  let store: LayeredMemoryStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaok-lms-test-'));
    const config: LayeredMemoryConfig = {
      dbPath: path.join(tmpDir, 'memory.db'),
      embedding: {
        apiUrl: 'http://localhost:11434/v1',
        model: 'nomic-embed-text',
        dimensions: 768,
      },
      compaction: { autoCompact: false },
    };
    store = new LayeredMemoryStore(config);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should save and search', async () => {
    const record = {
      id: 'test-1',
      scope: 'global' as const,
      title: '用户偏好TypeScript',
      summary: '用户在开发中偏好使用TypeScript',
      tags: ['typescript'],
      updatedAt: Date.now(),
    };

    await store.save(record);
    const results = await store.search('TypeScript');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should preserve scope in listRelevant', async () => {
    await store.save({
      id: 'global-1', scope: 'global', title: 'global mem', summary: 'global content',
      tags: [], updatedAt: Date.now(),
    });

    const results = await store.listRelevant({
      cwd: '/test', query: 'global',
    });
    expect(results.some(r => r.scope === 'global')).toBe(true);
  });

  it('should write raw messages to L0 and search them', async () => {
    await store.writeRawMessage('session-1', 'user', '我喜欢用React开发前端');
    const results = await store.search('React');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should track layer counts', async () => {
    await store.writeRawMessage('s1', 'user', 'msg1');
    await store.writeRawMessage('s1', 'user', 'msg2');
    expect(store.getLayerCount(0)).toBe(2);
  });
});
