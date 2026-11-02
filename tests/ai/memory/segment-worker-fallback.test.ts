// #145 / #147（评审 DS M1/M4）：worker 起不来、词典加载卡住、worker 内 cut 抛错这三条回退分支。
// 用假的 Worker 驱动 segment.ts 的进程级 worker；同步对照用真实 nodejieba（与 master 同一路径）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  mode: 'throw' as 'throw' | 'never-ready' | 'cut-error' | 'delayed-ready',
  emitReady: undefined as undefined | (() => void),
  workers: [] as Array<{ terminated: boolean }>,
}));
vi.mock('node:worker_threads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:worker_threads')>();
  const { EventEmitter } = await import('node:events');
  class FakeWorker extends EventEmitter {
    terminated = false;
    constructor() {
      super();
      if (fake.mode === 'throw') throw new Error('worker threads unavailable');
      fake.workers.push(this);
      if (fake.mode === 'cut-error') queueMicrotask(() => this.emit('message', { type: 'ready' }));
      if (fake.mode === 'delayed-ready') fake.emitReady = () => this.emit('message', { type: 'ready' });
    }
    ref() {} unref() {}
    postMessage(message: { id: number; runs: string[] }) {
      // delayed-ready：按固定词表切分，证明结果来自 worker 而不是主线程同步路径。
      if (fake.mode === 'delayed-ready') queueMicrotask(() => this.emit('message', { type: 'cut', id: message.id, cuts: message.runs.map(() => ['南京市', '长江大桥']) }));
      else queueMicrotask(() => this.emit('message', { type: 'cut', id: message.id, cutError: 'native cut threw' }));
    }
    async terminate() { this.terminated = true; this.emit('exit', 1); return 1; }
  }
  return { ...actual, Worker: FakeWorker };
});

const QUERY = '南京市长江大桥 with TypeScript';
const WORKER_KEY = Symbol.for('xiaok.segment.worker');

describe('segmentation worker fallbacks (#145 / #147)', () => {
  beforeEach(() => {
    vi.resetModules();
    fake.workers.length = 0;
    delete (globalThis as unknown as Record<symbol, unknown>)[WORKER_KEY];
  });
  afterEach(() => { vi.useRealTimers(); delete (globalThis as unknown as Record<symbol, unknown>)[WORKER_KEY]; });

  it('falls back to the identical synchronous segmentation when the worker cannot start', async () => {
    fake.mode = 'throw';
    const segment = await import('../../../src/ai/memory/segment.js');
    const result = await segment.segmentChineseAsync(QUERY);
    expect(result).toContain('南京市 长江大桥');
    expect(result).toBe(segment.segmentChinese(QUERY));
  });

  it('stops waiting for a dictionary load that never finishes and falls back at the ready deadline', async () => {
    fake.mode = 'never-ready';
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const segment = await import('../../../src/ai/memory/segment.js');
    let settled = false;
    const pending = segment.segmentChineseAsync(QUERY).then((value) => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(segment.SEGMENTATION_WORKER_READY_DEADLINE_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    vi.useRealTimers();
    const result = await pending;
    expect(fake.workers[0]?.terminated).toBe(true);
    expect(result).toBe(segment.segmentChinese(QUERY));
    expect(result).toContain('南京市 长江大桥');
  });

  // 第 2 轮 codex Major 1：首轮早于词典加载完成到来时，要等 ready 再分词；等待期间事件循环照常推进。
  it('holds a first call that arrives before the dictionary is ready until ready, without blocking the event loop', async () => {
    fake.mode = 'delayed-ready';
    const segment = await import('../../../src/ai/memory/segment.js');
    let settled = false;
    const pending = segment.segmentChineseAsync('南京市长江大桥').then((value) => { settled = true; return value; });
    let ticks = 0;
    for (let i = 0; i < 20; i += 1) { await new Promise((resolve) => setImmediate(resolve)); ticks += 1; }
    expect(ticks).toBe(20);
    expect(settled).toBe(false);
    expect(fake.emitReady).toBeTypeOf('function');
    fake.emitReady!();
    expect(await pending).toBe('南京市 长江大桥');
  });

  it('returns the raw text when nodejieba throws inside the worker, as the synchronous path does', async () => {
    fake.mode = 'cut-error';
    const segment = await import('../../../src/ai/memory/segment.js');
    expect(await segment.segmentChineseAsync(QUERY)).toBe(QUERY);
  });
});
