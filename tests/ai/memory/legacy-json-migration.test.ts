// #145 / #147 第 2 轮 DS B1：桌面启动时的 legacy JSON 迁移在同一 tick 里回读校验。
// save() 改为异步分词后，迁移若仍 `void save()` 再立即 getById，每次都会校验失败、桌面退到 fallback 后端。
// 这里用真实 LayeredMemoryStore 走桌面实际调用的迁移函数。
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LayeredMemoryStore } from '../../../src/ai/memory/layered-store.js';
import { migrateLegacyUserMemories } from '../../../src/ai/memory/legacy-json-migration.js';
import { segmentChinese } from '../../../src/ai/memory/segment.js';

describe('legacy JSON memory migration (#145 / #147)', () => {
  let tmpDir: string | undefined;
  let store: LayeredMemoryStore | undefined;
  afterEach(async () => {
    await store?.close(); store = undefined;
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('imports every entry so that it reads back in the same tick, with the synchronous segmentation', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaok-legacy-mig-'));
    store = new LayeredMemoryStore({
      dbPath: path.join(tmpDir, 'memory.db'),
      embedding: { apiUrl: 'http://127.0.0.1:9/v1', model: 'none', dimensions: 8 },
      compaction: { autoCompact: false },
    });
    const entries = [
      { id: 'mem_1', content: '用户名字叫张三', tags: ['个人信息'] },
      { id: 'mem_2', content: 'prefers dark theme', tags: ['偏好'], scope: 'project' as const, cwd: '/repo' },
    ];
    expect(() => migrateLegacyUserMemories(store!, entries)).not.toThrow();
    expect(store.getById('mem_1')?.summary).toBe('用户名字叫张三');
    expect(store.getById('mem_2')?.cwd).toBe('/repo');
    const db = (store as unknown as { db: { prepare(sql: string): { get(id: string): { segmented_content: string } } } }).db;
    const row = db.prepare('SELECT segmented_content FROM memory_l0_raw WHERE id = ?').get('mem_1');
    expect(row.segmented_content).toBe(segmentChinese('用户名字叫张三 用户名字叫张三'));
  });

  it('reports the first entry that does not read back', () => {
    const target = { saveSync: () => {}, getById: () => undefined };
    expect(() => migrateLegacyUserMemories(target, [{ id: 'lost', content: 'x', tags: [] }])).toThrow('memory migration verification failed: lost');
  });
});
