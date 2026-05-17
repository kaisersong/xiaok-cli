import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LayeredMemoryStore, resolveLayeredConfig } from '../../../src/ai/memory/layered-store.js';

describe('migration from JSON', () => {
  it('should import legacy memory entries and make them searchable', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaok-migrate-'));
    const dbPath = path.join(tmpDir, 'memory.db');
    const config = resolveLayeredConfig({ dbPath });
    const store = new LayeredMemoryStore(config);

    // Simulate migration: import entries that would come from user-memories.json
    const legacyEntries = [
      { id: 'mem_1', content: '用户名字叫张三', tags: ['个人信息'], createdAt: Date.now() - 86400000 },
      { id: 'mem_2', content: '偏好使用深色主题', tags: ['偏好'], createdAt: Date.now() - 43200000 },
      { id: 'mem_3', content: '项目使用Next.js框架', tags: ['项目', '技术栈'], createdAt: Date.now() },
    ];

    for (const entry of legacyEntries) {
      await store.save({
        id: entry.id,
        scope: 'global',
        title: entry.content.slice(0, 80),
        summary: entry.content,
        tags: entry.tags,
        updatedAt: entry.createdAt,
        type: 'user',
      });
    }

    // Verify entries are searchable
    const r1 = await store.search('张三');
    expect(r1.length).toBeGreaterThan(0);
    expect(r1[0].summary).toContain('张三');

    const r2 = await store.search('Next.js');
    expect(r2.length).toBeGreaterThan(0);
    expect(r2[0].summary).toContain('Next.js');

    const r3 = await store.search('深色主题');
    expect(r3.length).toBeGreaterThan(0);

    // Verify stats
    const stats = store.getStats();
    expect(stats.l0).toBe(3);
    expect(stats.l1).toBe(3);

    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should handle delete correctly', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaok-migrate2-'));
    const dbPath = path.join(tmpDir, 'memory.db');
    const config = resolveLayeredConfig({ dbPath });
    const store = new LayeredMemoryStore(config);

    await store.save({
      id: 'del-test', scope: 'global', title: 'to delete',
      summary: '将要删除的记忆', tags: [], updatedAt: Date.now(), type: 'user',
    });

    expect(store.getStats().l1).toBe(1);

    const deleted = await store.delete('del-test');
    expect(deleted).toBe(true);
    expect(store.getStats().l1).toBe(0);
    expect(store.getStats().l0).toBe(0);

    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should handle clearAll', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaok-migrate3-'));
    const dbPath = path.join(tmpDir, 'memory.db');
    const config = resolveLayeredConfig({ dbPath });
    const store = new LayeredMemoryStore(config);

    await store.save({
      id: 'c1', scope: 'global', title: 'test', summary: 'test',
      tags: [], updatedAt: Date.now(), type: 'user',
    });
    await store.save({
      id: 'c2', scope: 'global', title: 'test2', summary: 'test2',
      tags: [], updatedAt: Date.now(), type: 'user',
    });

    expect(store.getStats().l1).toBe(2);
    store.clearAll();
    expect(store.getStats().l0).toBe(0);
    expect(store.getStats().l1).toBe(0);

    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
