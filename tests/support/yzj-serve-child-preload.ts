// Preload for the yzj serve child-process shutdown test (#150). Loaded with `node --import`
// before the real CLI entry; it changes no product code.
// - Replaces the per-process segmentation worker (the global holder segment.ts reads) with one
//   whose readiness waits on a gate, so the dry-run probe write stays in flight until released.
//   The gate holds no handle, so it never keeps the process alive by itself.
// - XIAOK_TEST_YZJ_GATE=release-on-close: the gate opens one macrotask after the store's close()
//   starts, i.e. only a shutdown that waits for close() lets the write land.
//   XIAOK_TEST_YZJ_GATE=hold: the gate never opens (for the second-signal case).
// - XIAOK_TEST_YZJ_LEFTOVER_HANDLE=1: keeps one ref'd timer alive for the whole run, like a handle
//   shutdown does not own (an agent turn or reconnect timer); serve must still exit after shutdown.
import { LayeredMemoryStore } from '../../src/ai/memory/layered-store.js';

let release!: () => void;
const gate = new Promise<void>((resolve) => { release = resolve; });

(globalThis as unknown as Record<symbol, unknown>)[Symbol.for('xiaok.segment.worker')] = {
  async whenReady() { await gate; return true; },
  failureReason: () => undefined,
  async cut(runs: string[]) { return { cuts: runs.map((run) => [run]) }; },
  async terminate() {},
  describe: () => ({ entry: 'yzj-shutdown-test-gate', options: {}, ready: true }),
};

if (process.env.XIAOK_TEST_YZJ_GATE === 'release-on-close') {
  const realClose = LayeredMemoryStore.prototype.close;
  LayeredMemoryStore.prototype.close = function close(this: LayeredMemoryStore) {
    console.info('[yzj-test] memory store close() started');
    setImmediate(release);
    return realClose.call(this);
  };
}

if (process.env.XIAOK_TEST_YZJ_LEFTOVER_HANDLE === '1') {
  setInterval(() => undefined, 60_000);
}
