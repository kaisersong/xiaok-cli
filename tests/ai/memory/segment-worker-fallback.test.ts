// #145 / #147（评审 DS M1/M4）：worker 起不来、词典加载卡住、worker 内 cut 抛错这三条回退分支。
// 用假的 Worker 驱动 segment.ts 的进程级 worker；同步对照用真实 nodejieba（与 master 同一路径）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  mode: 'throw' as 'throw' | 'never-ready' | 'cut-error' | 'delayed-ready' | 'die-after-ready' | 'cut-hang',
  warnings: [] as Array<{ message: string; details: Record<string, unknown> }>,
  emitReady: undefined as undefined | (() => void),
  workers: [] as Array<{ terminated: boolean }>,
}));
// 回退要写日志（CTO 裁定 / 质量验收：原因与耗时）。只截 memory:segment 的 warn，其余照常。
vi.mock('../../../src/utils/logger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/logger.js')>();
  return {
    ...actual,
    createLogger: (module: string, options?: Parameters<typeof actual.createLogger>[1]) => {
      const real = actual.createLogger(module, options);
      if (module !== 'memory:segment') return real;
      return { ...real, warn: (message: string, details: Record<string, unknown>) => { fake.warnings.push({ message, details }); } };
    },
  };
});
vi.mock('node:worker_threads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:worker_threads')>();
  const { EventEmitter } = await import('node:events');
  class FakeWorker extends EventEmitter {
    terminated = false;
    constructor() {
      super();
      if (fake.mode === 'throw') throw new Error('worker threads unavailable');
      fake.workers.push(this);
      if (fake.mode === 'cut-error' || fake.mode === 'die-after-ready' || fake.mode === 'cut-hang') queueMicrotask(() => this.emit('message', { type: 'ready' }));
      if (fake.mode === 'delayed-ready') fake.emitReady = () => this.emit('message', { type: 'ready' });
    }
    ref() {} unref() {}
    postMessage(message: { id: number; runs: string[] }) {
      // delayed-ready：按固定词表切分，证明结果来自 worker 而不是主线程同步路径。
      if (fake.mode === 'delayed-ready') queueMicrotask(() => this.emit('message', { type: 'cut', id: message.id, cuts: message.runs.map(() => ['南京市', '长江大桥']) }));
      // die-after-ready：ready 之后 worker 退出，在途的 cut 没有回复（DS M5）。
      else if (fake.mode === 'die-after-ready') queueMicrotask(() => this.emit('exit', 1));
      // cut-hang：ready 之后 cut 永远不回复（cut 截止，CTO 裁定）。
      else if (fake.mode === 'cut-hang') return;
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
    fake.warnings.length = 0;
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

  // CTO 裁定：超时后不跳过分词，回到主线程同步加载，并记一条写明原因和耗时的日志。
  it('logs the ready-deadline fallback with its reason, the time waited and the synchronous load time', async () => {
    fake.mode = 'never-ready';
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const segment = await import('../../../src/ai/memory/segment.js');
    const pending = segment.segmentChineseAsync(QUERY);
    await vi.advanceTimersByTimeAsync(segment.SEGMENTATION_WORKER_READY_DEADLINE_MS);
    vi.useRealTimers();
    expect(await pending).toBe(segment.segmentChinese(QUERY));
    expect(fake.warnings.map((w) => w.details.reason)).toEqual(['ready deadline exceeded', 'ready deadline exceeded']);
    const fallback = fake.warnings[1]!;
    expect(fallback.message).toContain('synchronous segmentation fallback load');
    expect(fallback.details.waitedMs).toBe(segment.SEGMENTATION_WORKER_READY_DEADLINE_MS);
    expect(fallback.details.syncLoadMs).toEqual(expect.any(Number));
    expect(fallback.details.loaded).toBe(true);
    expect(fallback.details.budgetMs).toBe(segment.SEGMENTATION_SYNC_FALLBACK_BUDGET_MS);
  });

  // 第 2 轮 DS M5：ready 之后 worker 死掉，在途 cut 不能挂住，回退同步路径、结果一致。
  it('falls back to the identical synchronous segmentation when the worker dies after ready', async () => {
    fake.mode = 'die-after-ready';
    const segment = await import('../../../src/ai/memory/segment.js');
    const result = await segment.segmentChineseAsync(QUERY);
    expect(result).toBe(segment.segmentChinese(QUERY));
    expect(result).toContain('南京市 长江大桥');
    expect(fake.warnings[0]?.details.reason).toBe('worker exited');
    // 之后的调用也不再等这个死掉的 worker。
    expect(await segment.segmentChineseAsync('南京市长江大桥')).toBe('南京市 长江大桥');
  });

  // CTO 裁定：worker 的 cut 要有截止；到期丢弃 worker，本次及之后都走同步路径，结果一致。
  it('stops waiting for a cut that never answers at the cut deadline and segments synchronously', async () => {
    fake.mode = 'cut-hang';
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const segment = await import('../../../src/ai/memory/segment.js');
    let settled = false;
    const pending = segment.segmentChineseAsync(QUERY).then((value) => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(segment.SEGMENTATION_WORKER_CUT_DEADLINE_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    vi.useRealTimers();
    const result = await pending;
    expect(result).toBe(segment.segmentChinese(QUERY));
    expect(result).toContain('南京市 长江大桥');
    expect(fake.workers[0]?.terminated).toBe(true);
    expect(fake.warnings[0]?.details.reason).toBe('cut deadline exceeded');
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
    // 正常路径不回退、不记回退日志；主动停掉 worker 也不算回退（触发次数统计靠这条日志）。
    await segment.resetSegmentationWorkerForTests();
    expect(fake.warnings).toEqual([]);
  });

  it('returns the raw text when nodejieba throws inside the worker, as the synchronous path does', async () => {
    fake.mode = 'cut-error';
    const segment = await import('../../../src/ai/memory/segment.js');
    expect(await segment.segmentChineseAsync(QUERY)).toBe(QUERY);
  });
});
