// #145 / #147：nodejieba 词典加载不得阻塞主线程事件循环（首屏 ❯ 之前的记忆检索走这里），
// 首轮在加载完成前到来时要等加载完成再分词，结果与同步路径（master 行为）逐字一致，不得静默退回未分词文本。
// 本文件用真实 nodejieba；每个用例先停掉进程级 worker，从“词典尚未加载”的状态开始。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  resetSegmentationWorkerForTests, segmentChinese, segmentationAvailable, segmentQueryAsync,
} from '../../../src/ai/memory/segment.js';
import { hybridSearch } from '../../../src/ai/memory/retrieval.js';
import { LayeredMemoryStore } from '../../../src/ai/memory/layered-store.js';

const WORKER_KEY = Symbol.for('xiaok.segment.worker');
const workerSlot = () => (globalThis as unknown as Record<symbol, unknown>)[WORKER_KEY];
const CHINESE_QUERY = '我们今天讨论自然语言处理和南京市长江大桥 with TypeScript';

/** 跑 action，期间每 5ms 记一次事件循环，返回最长的一次间隔（ms）。 */
async function maxEventLoopGap<T>(action: () => Promise<T>): Promise<{ value: T; gapMs: number }> {
  let last = performance.now();
  let gapMs = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    gapMs = Math.max(gapMs, now - last);
    last = now;
  }, 5);
  try {
    const value = await action();
    gapMs = Math.max(gapMs, performance.now() - last);
    return { value, gapMs };
  } finally {
    clearInterval(timer);
  }
}

describe('off-thread segmentation (#145 / #147)', () => {
  let tmpDir: string | undefined;
  let store: LayeredMemoryStore | undefined;
  beforeEach(async () => { await resetSegmentationWorkerForTests(); });
  afterEach(async () => {
    store?.close(); store = undefined;
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
    await resetSegmentationWorkerForTests();
  });

  // 本用例必须是文件里第一个用到同步分词的：它要在主线程词典尚未加载时量出同步加载的耗时作对照。
  it('memory search segments a Chinese query without blocking the event loop on the dictionary load', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaok-seg-async-'));
    store = new LayeredMemoryStore({
      dbPath: path.join(tmpDir, 'memory.db'),
      embedding: { apiUrl: 'http://127.0.0.1:9/v1', model: 'none', dimensions: 8 },
      compaction: { autoCompact: false },
    });
    const db = (store as unknown as { db: Parameters<typeof hybridSearch>[0] }).db;
    const embedding = (store as unknown as { embeddingClient: Parameters<typeof hybridSearch>[1] }).embeddingClient;
    const asyncRun = await maxEventLoopGap(() => hybridSearch(db, embedding, CHINESE_QUERY, { vectorWeight: 0 }));
    expect(asyncRun.value).toEqual([]);
    // 对照：同一进程里主线程同步加载词典要多久（这就是 master 首屏前被占住的时长）。
    const syncStarted = performance.now();
    expect(segmentationAvailable()).toBe(true);
    const syncLoadMs = performance.now() - syncStarted;
    expect(syncLoadMs).toBeGreaterThan(100);
    // 异步路径的最长停顿必须远小于一次同步加载，否则就是在主线程上加载了。
    expect(asyncRun.gapMs).toBeLessThan(syncLoadMs / 2);
  });

  // 之后的用例重新求值 segment.js，使本模块的主线程词典状态回到“未加载”，异步调用只能走 worker；
  // 同步对照仍是同一个 nodejieba（进程级缓存，不重复加载）。
  it('a first turn that arrives before the prewarmed load finishes waits for it and segments exactly like the sync path', async () => {
    vi.resetModules();
    const fresh = await import('../../../src/ai/memory/segment.js');
    fresh.prewarmSegmentation();
    expect(workerSlot()).toBeTruthy();
    const segmented = await fresh.segmentQueryAsync(CHINESE_QUERY);
    const expected = segmentChinese(CHINESE_QUERY);
    expect(expected).not.toBe(CHINESE_QUERY);
    expect(segmented).toBe(expected);
    expect(segmented).toContain('南京市 长江大桥');
  });

  it('a raw message written just before close still lands with the same segmentation', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaok-seg-async-'));
    const dbPath = path.join(tmpDir, 'memory.db');
    const config = { dbPath, embedding: { apiUrl: 'http://127.0.0.1:9/v1', model: 'none', dimensions: 8 }, compaction: { autoCompact: false } };
    vi.resetModules();
    const { LayeredMemoryStore: FreshStore } = await import('../../../src/ai/memory/layered-store.js');
    const first = new FreshStore(config);
    const write = first.writeRawMessage('session-1', 'user', CHINESE_QUERY);
    first.close();
    await write;
    await expect(first.writeRawMessage('session-1', 'user', '关闭后')).rejects.toThrow('memory_store_closed');
    store = new LayeredMemoryStore(config);
    const row = (store as unknown as { db: { prepare(sql: string): { get(): { segmented_content: string } } } }).db
      .prepare(`SELECT segmented_content FROM memory_l0_raw WHERE session_id = 'session-1'`).get();
    expect(row.segmented_content).toBe(segmentChinese(CHINESE_QUERY));
  });

  it('text without Chinese is segmented without starting the dictionary load', async () => {
    const query = '  /tmp/project-dir   with  spaces ';
    expect(await segmentQueryAsync(query)).toBe('/tmp/project-dir with spaces');
    expect(workerSlot()).toBeUndefined();
  });
});
