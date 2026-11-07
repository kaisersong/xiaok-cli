import { parentPort, workerData } from 'node:worker_threads';
import { getHeapStatistics } from 'node:v8';
import { searchBoundedGlob } from './bounded-glob-body.mjs';

try {
  // Node's process-level V8 flags can override resourceLimits. Fail closed if
  // the effective heap exceeds 96 MiB old + 8 MiB young and V8 internal space.
  if (getHeapStatistics().heap_size_limit > 128 * 1024 * 1024) throw new Error('glob_worker_heap_config');
  const { input, limits } = workerData;
  parentPort.postMessage({ ok: true, entries: await searchBoundedGlob(input, limits, workerData.nativeSearchProfile) });
} catch (error) {
  const code = error instanceof Error && ['glob_scan_limit', 'glob_result_limit', 'glob_worker_heap_config', 'grep_scan_limit', 'grep_result_limit', 'grep_invalid_regex', 'grep_native_regex_profile_unavailable'].includes(error.message)
    ? error.message : 'glob_search_failed';
  parentPort.postMessage({ ok: false, code });
} finally { parentPort.close(); }
