// Script evaluated in the isolated dictionary worker, and its wait budgets.
export const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
let mod;
try {
  mod = require(workerData.entry);
  mod.load(workerData.options);
  parentPort.postMessage({ type: 'ready' });
} catch (error) {
  parentPort.postMessage({ type: 'failed', error: String(error && error.message || error) });
}
parentPort.on('message', ({ id, runs }) => {
  try {
    parentPort.postMessage({ type: 'cut', id, cuts: runs.map(run => mod.cut(run)) });
  } catch (error) {
    parentPort.postMessage({ type: 'cut', id, cutError: String(error && error.message || error) });
  }
});
`;

/**
 * Upper bound for the off-thread dictionary load. Normal loads take ~0.3–1.5s
 * (first-screen p90 ≈ 0.6s, cold max ≈ 1.5s on the #147 runs), so 10s is far
 * above them; a normal environment does not reach it (measured trigger count
 * in #150). A load that hangs (dictionary on a stalled network drive, native
 * load never returning) must not leave the first turn waiting forever: past
 * this point the worker is dropped and callers fall back to the synchronous
 * path, which segments exactly as master does (CTO ruling on #150: never skip
 * segmentation). The fallback is logged with its reason and timings.
 */
export const SEGMENTATION_WORKER_READY_DEADLINE_MS = 10_000;
/**
 * Upper bound for one cut() round trip once the worker is ready (normally a few
 * ms). Past it the worker is treated as stuck, dropped, and the call falls back
 * to the identical synchronous segmentation, so a first turn or close() never
 * waits on a stuck worker indefinitely.
 */
export const SEGMENTATION_WORKER_CUT_DEADLINE_MS = 5_000;
/**
 * Budget for the synchronous fallback load on the calling thread. A native
 * synchronous call cannot be preempted on its own thread, so this is a reported
 * bound, not an abort: a fallback load over it is logged as such. The fallback
 * load happens at most once per process (the loaded dictionary is reused), so
 * the worst case equals master's single synchronous load.
 */
export const SEGMENTATION_SYNC_FALLBACK_BUDGET_MS = 5_000;
