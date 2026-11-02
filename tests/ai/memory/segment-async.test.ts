// #145 / #147：nodejieba 词典加载不得阻塞主线程事件循环（首屏 ❯ 之前的记忆检索走这里），
// 首轮在加载完成前到来时要等加载完成再分词，结果与同步路径（master 行为）逐字一致，不得静默退回未分词文本。
// 本文件用真实 nodejieba；每个用例先停掉进程级 worker，从“词典尚未加载”的状态开始。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import * as segment from '../../../src/ai/memory/segment.js';
import { hybridSearch } from '../../../src/ai/memory/retrieval.js';
import { LayeredMemoryStore } from '../../../src/ai/memory/layered-store.js';

// 回滚验证要求“因行为断言失败”，不是因新导出不存在而报 TypeError：新导出都按可选取用，
// 缺失时退到 master 已有的同步函数（行为与 master 一致）。
type SegmentModule = typeof segment & Partial<{
  resetSegmentationWorkerForTests(): Promise<void>; prewarmSegmentation(): void; segmentQueryAsync(query: string): Promise<string>;
}>;
const resetWorker = async (mod: SegmentModule = segment) => { await mod.resetSegmentationWorkerForTests?.(); };
const queryAsync = (mod: SegmentModule, query: string) => mod.segmentQueryAsync ? mod.segmentQueryAsync(query) : Promise.resolve(mod.segmentQuery(query));

const WORKER_KEY = Symbol.for('xiaok.segment.worker');
const workerSlot = () => (globalThis as unknown as Record<symbol, unknown>)[WORKER_KEY];
const CHINESE_QUERY = '我们今天讨论自然语言处理和南京市长江大桥 with TypeScript';

/**
 * 数主线程上 nodejieba 的 load() 调用次数（DS M5：确定性判据，替代墙钟比值）。
 * segment.ts 经 createRequire 拿到的是同一个 CJS 导出对象；worker 线程有自己的模块实例，不计入。
 */
function countMainThreadLoads() {
  const mod = createRequire(import.meta.url)('nodejieba') as { load: (...args: unknown[]) => unknown };
  const original = mod.load;
  const counter = { count: 0, restore: () => { mod.load = original; } };
  mod.load = function (this: unknown, ...args: unknown[]) { counter.count += 1; return original.apply(this, args); };
  return counter;
}

describe('off-thread segmentation (#145 / #147)', () => {
  let tmpDir: string | undefined;
  let store: LayeredMemoryStore | undefined;
  beforeEach(async () => { await resetWorker(); });
  afterEach(async () => {
    await store?.close(); store = undefined;
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
    await resetWorker();
  });

  // 本用例必须是文件里第一个用到分词的：此时本进程主线程还没加载过词典。
  // 依赖真实 nodejieba 与词典（CI 安装时带 install scripts）；不按可用性跳过，否则回归会被静默绕过（DS M6，待创始人确认）。
  it('memory search segments a Chinese query without loading the dictionary on the main thread', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaok-seg-async-'));
    store = new LayeredMemoryStore({
      dbPath: path.join(tmpDir, 'memory.db'),
      embedding: { apiUrl: 'http://127.0.0.1:9/v1', model: 'none', dimensions: 8 },
      compaction: { autoCompact: false },
    });
    const db = (store as unknown as { db: Parameters<typeof hybridSearch>[0] }).db;
    const embedding = (store as unknown as { embeddingClient: Parameters<typeof hybridSearch>[1] }).embeddingClient;
    const loads = countMainThreadLoads();
    try {
      expect(await hybridSearch(db, embedding, CHINESE_QUERY, { vectorWeight: 0 })).toEqual([]);
      // master 在这里同步 load（首屏前占住事件循环约 1s）；改动后由 worker 加载，主线程 0 次。
      expect(loads.count).toBe(0);
    } finally { loads.restore(); }
  });

  // 之后的用例重新求值 segment.js，使本模块的主线程词典状态回到“未加载”，异步调用只能走 worker；
  // 同步对照仍是同一个 nodejieba（进程级缓存，不重复加载）。
  it('a first turn that arrives before the prewarmed load finishes waits for it and segments exactly like the sync path', async () => {
    vi.resetModules();
    const fresh: SegmentModule = await import('../../../src/ai/memory/segment.js');
    fresh.prewarmSegmentation?.();
    const segmented = await queryAsync(fresh, CHINESE_QUERY);
    const expected = segment.segmentChinese(CHINESE_QUERY);
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
    // DS B1/M3：close 在有在途写时返回可等待的 promise，退出路径（chat 收尾 settle）会等它。
    const closing = first.close();
    await write;
    await closing;
    await expect(first.writeRawMessage('session-1', 'user', '关闭后')).rejects.toThrow('memory_store_closed');
    store = new LayeredMemoryStore(config);
    const row = (store as unknown as { db: { prepare(sql: string): { get(): { segmented_content: string } } } }).db
      .prepare(`SELECT segmented_content FROM memory_l0_raw WHERE session_id = 'session-1'`).get();
    expect(row.segmented_content).toBe(segment.segmentChinese(CHINESE_QUERY));
  });

  it('text without Chinese is segmented without starting the dictionary load', async () => {
    const query = '  /tmp/project-dir   with  spaces ';
    const loads = countMainThreadLoads();
    try {
      expect(await queryAsync(segment, query)).toBe('/tmp/project-dir with spaces');
      expect(loads.count).toBe(0);
      expect(workerSlot()).toBeUndefined();
    } finally { loads.restore(); }
  });
});
