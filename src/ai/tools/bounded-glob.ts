import { Worker } from 'node:worker_threads';

export interface GlobSearchInput {
  patterns: string | string[];
  cwd: string;
  type?: 'file' | 'directory' | 'all';
  dot?: boolean;
  ignore?: string[];
  skipInaccessible?: boolean;
}
export interface GlobEntry { path: string; mtimeMs: number }
export const GLOB_LIMITS = Object.freeze({
  maxEntries: 50_000, maxDirectories: 10_000, maxResults: 5_000, maxPathBytes: 2 * 1024 * 1024,
});
export type GlobLimits = { -readonly [K in keyof typeof GLOB_LIMITS]: number };
const ERROR_CODES = new Set(['glob_scan_limit', 'glob_result_limit', 'glob_search_failed', 'glob_worker_heap_config']);

/** Host-only options can reduce budgets; tool arguments cannot increase them. */
export function createBoundedGlobRunner(options: {
  limits?: Partial<GlobLimits>; timeoutMs?: number; maxWorkers?: number; workerUrl?: URL;
} = {}) {
  let activeCount = 0;
  const limits: GlobLimits = { ...GLOB_LIMITS };
  for (const key of Object.keys(limits) as (keyof GlobLimits)[]) {
    const value = options.limits?.[key];
    if (value !== undefined && Number.isSafeInteger(value) && value > 0) limits[key] = Math.min(value, limits[key]);
  }
  const timeoutMs = Math.min(10_000, Math.max(1, options.timeoutMs ?? 10_000));
  const maxWorkers = Math.min(2, Math.max(1, options.maxWorkers ?? 2));
  return {
    get activeCount() { return activeCount; },
    async search(input: GlobSearchInput, signal?: AbortSignal): Promise<GlobEntry[]> {
      signal?.throwIfAborted();
      const patterns = typeof input.patterns === 'string' ? [input.patterns] : input.patterns;
      if (!Array.isArray(patterns) || !patterns.length || patterns.some(p => typeof p !== 'string' || !p.length)
        || patterns.join('').length > 2048 || typeof input.cwd !== 'string' || input.cwd.length > 10_240) {
        throw new Error('glob_invalid_input');
      }
      if (activeCount >= maxWorkers) throw new Error('glob_busy');
      const worker = new Worker(options.workerUrl ?? new URL('./glob-worker.mjs', import.meta.url), {
        workerData: { input, limits },
        // V8 heap failure must terminate the search, never Electron's main isolate.
        resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 },
        execArgv: [],
        stdout: true, stderr: true,
      });
      activeCount++;
      worker.stdout?.resume(); worker.stderr?.resume();
      return new Promise<GlobEntry[]>((resolve, reject) => {
        let result: GlobEntry[] | undefined;
        let failure: unknown;
        const stop = () => { void worker.terminate().catch(() => undefined); };
        const onAbort = () => { failure = signal?.reason ?? new Error('glob_aborted'); stop(); };
        const timer = setTimeout(() => { failure ??= new Error('glob_timeout'); stop(); }, timeoutMs);
        signal?.addEventListener('abort', onAbort, { once: true });
        worker.once('message', (message: { ok?: boolean; entries?: GlobEntry[]; code?: string }) => {
          if (message?.ok && Array.isArray(message.entries) && message.entries.length <= limits.maxResults) {
            result = message.entries;
          } else {
            failure ??= new Error(ERROR_CODES.has(message?.code ?? '') ? message.code : 'glob_worker_failed');
          }
          stop();
        });
        worker.once('error', (error: NodeJS.ErrnoException) => {
          failure ??= new Error(error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'glob_worker_memory_limit' : 'glob_worker_failed');
          stop();
        });
        worker.once('exit', () => {
          activeCount--;
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          // Only the actual exit releases the slot and settles cancellation.
          if (signal?.aborted) reject(signal.reason);
          else if (failure) reject(failure);
          else if (result) resolve(result);
          else reject(new Error('glob_worker_failed'));
        });
        if (signal?.aborted) onAbort();
      });
    },
  };
}

const sharedRunner = createBoundedGlobRunner();
export const runBoundedGlob = sharedRunner.search;
