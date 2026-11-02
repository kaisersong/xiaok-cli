// ESM-compatible wrapper for nodejieba.
// nodejieba is a CJS package; use createRequire for ESM compat.
import { accessSync, constants as fsConstants } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, win32 } from 'node:path';
import { Worker } from 'node:worker_threads';
import { createLogger } from '../../utils/logger.js';

const require = createRequire(import.meta.url);
const logger = createLogger('memory:segment', { stderr: false });

interface JiebaModule {
  cut(text: string): string[];
  load(dict: {
    dict: string;
    hmmDict: string;
    userDict: string;
    idfDict: string;
    stopWordDict: string;
  }): unknown;
}

let jieba: JiebaModule | null = null;
let jiebaLoadFailed = false;
// Result of the cheap JS-side readability check, cached so CJK-free text does
// not repeat it. null = not checked yet.
let dictionariesReadable: boolean | null = null;

/**
 * Dictionaries already loaded into a nodejieba instance, per process.
 *
 * Keyed by the nodejieba module object so a module-registry reset (vitest
 * `vi.resetModules`) that re-evaluates this file does not call the ~1s native
 * `load` again: Node's require cache still hands back the same, already-loaded
 * nodejieba instance. Lives on globalThis for the same reason.
 */
const LOADED_KEY = Symbol.for('xiaok.segment.jiebaLoaded');
function loadedDictionaries(): WeakMap<object, string> {
  const holder = globalThis as unknown as Record<symbol, WeakMap<object, string> | undefined>;
  return holder[LOADED_KEY] ??= new WeakMap<object, string>();
}

// The five dictionaries cppjieba opens natively.
const DICT_FILES = {
  dict: 'jieba.dict.utf8',
  hmmDict: 'hmm_model.utf8',
  userDict: 'user.dict.utf8',
  idfDict: 'idf.utf8',
  stopWordDict: 'stop_words.utf8',
} as const;

/**
 * Point a path at app.asar.unpacked instead of app.asar.
 *
 * Electron patches `fs` so JS reads inside app.asar work, but cppjieba opens
 * its dictionaries with C++ ifstream, which bypasses that patch. electron-builder
 * unpacks native modules to app.asar.unpacked while `__dirname` still reports the
 * app.asar path, so the path has to be rewritten explicitly.
 */
export function rewriteAsarPath(filePath: string): string {
  if (filePath.includes('app.asar.unpacked')) return filePath;
  // Only rewrite when `app.asar` is a full path segment, so a directory that
  // merely starts with that name is left alone. Handles both separators.
  return filePath.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
}

/**
 * Resolve every dictionary to a native-compatible path, or null when
 * nodejieba is not installed or cannot safely open that Windows path.
 */
export function resolveJiebaDictPaths(): Record<string, string> | null {
  let entry: string;
  try {
    entry = require.resolve('nodejieba');
  } catch {
    return null;
  }
  const dictDir = rewriteAsarPath(join(dirname(entry), 'submodules', 'cppjieba', 'dict'));
  const resolved: Record<string, string> = {};
  for (const fileName of Object.values(DICT_FILES)) {
    resolved[fileName] = join(dictDir, fileName);
  }
  if (process.platform === 'win32') {
    // cppjieba uses narrow ifstream: JS readability does not establish native
    // Unicode-path support, and a failed native open aborts the entire process.
    if (Object.values(resolved).some(filePath => /[^\x00-\x7f]/.test(filePath))) return null;
    for (const fileName of Object.values(DICT_FILES)) {
      resolved[fileName] = win32.toNamespacedPath(resolved[fileName]);
    }
  }
  return resolved;
}

/**
 * Whether Chinese segmentation can actually run.
 *
 * Requiring nodejieba is not enough: dictionary loading is lazy, so a require
 * succeeds even when the dictionaries are unreachable, and the first cut() would
 * then abort the process from C++. This probes readability from JS first.
 */
export function segmentationAvailable(): boolean {
  return getJieba() !== null;
}

/** Resolve dictionary paths and verify them from JS; null when unusable. */
function readableDictionaryPaths(): Record<string, string> | null {
  const paths = resolveJiebaDictPaths();
  if (paths === null) return null;
  // Verify every dictionary is readable before handing paths to native code,
  // because a failed native open calls abort() and cannot be caught here.
  for (const fileName of Object.values(DICT_FILES)) {
    accessSync(paths[fileName], fsConstants.R_OK);
  }
  return paths;
}

function nativeLoadOptions(paths: Record<string, string>) {
  return {
    dict: paths[DICT_FILES.dict],
    hmmDict: paths[DICT_FILES.hmmDict],
    userDict: paths[DICT_FILES.userDict],
    idfDict: paths[DICT_FILES.idfDict],
    stopWordDict: paths[DICT_FILES.stopWordDict],
  };
}

function getJieba(): JiebaModule | null {
  if (jiebaLoadFailed) return null;
  if (!jieba) {
    try {
      const paths = readableDictionaryPaths();
      if (paths === null) {
        jiebaLoadFailed = true;
        dictionariesReadable = false;
        return null;
      }
      dictionariesReadable = true;
      const mod = require('nodejieba') as JiebaModule;
      const options = nativeLoadOptions(paths);
      const key = JSON.stringify(options);
      const loaded = loadedDictionaries();
      if (loaded.get(mod) !== key) {
        mod.load(options);
        loaded.set(mod, key);
      }
      jieba = mod;
    } catch {
      jiebaLoadFailed = true;
      return null;
    }
  }
  return jieba;
}

/**
 * Whether the dictionaries can be handed to native code, without loading them.
 * Mirrors the checks getJieba() runs before its native load.
 */
function dictionariesAvailable(): boolean {
  if (jieba) return true;
  if (jiebaLoadFailed) return false;
  if (dictionariesReadable === null) {
    try {
      dictionariesReadable = readableDictionaryPaths() !== null;
    } catch {
      dictionariesReadable = false;
    }
  }
  return dictionariesReadable;
}

// Regex to match contiguous Chinese character runs
const CHINESE_RE = /([\u4e00-\u9fff\u3400-\u4dbf]+)/g;

// Regex to test whether any Chinese character is present (non-global, no lastIndex state).
const HAS_CHINESE_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;

function joinParts(text: string, cuts: (run: string) => string[]): string {
  // Split into alternating non-Chinese and Chinese segments
  const parts: string[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(CHINESE_RE)) {
    // Non-Chinese portion before this match
    if (match.index! > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    // Chinese portion — segment with jieba
    parts.push(cuts(match[0]).join(' '));
    lastIndex = match.index! + match[0].length;
  }
  // Trailing non-Chinese portion
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// Whether nodejieba's native binding can be loaded, without loading any dictionary.
// nodejieba's index.js only requires its binding lazily (inside load()/cut()), so
// require('nodejieba') alone does not prove it; require the binding at the same
// path nodejieba uses (shared require cache, so no second dlopen later).
let nativeBindingLoadable: boolean | null = null;
function nativeBindingAvailable(): boolean {
  if (jieba) return true;
  if (nativeBindingLoadable === null) {
    try {
      require(join(dirname(require.resolve('nodejieba')), 'build', 'Release', 'nodejieba.node'));
      nativeBindingLoadable = true;
    } catch {
      nativeBindingLoadable = false;
    }
  }
  return nativeBindingLoadable;
}

/**
 * Text without Chinese never reaches jieba, so its output does not depend on
 * the dictionary. Produce it without loading the dictionary: same result as the
 * jieba path when the dictionaries are readable and the native binding loads,
 * and the raw text when either is missing (as master's failed getJieba()).
 * Not covered: readable dictionaries whose native load() then throws — that is
 * only discovered by loading, which this path exists to avoid.
 */
function segmentWithoutChinese(text: string): string {
  return dictionariesAvailable() && nativeBindingAvailable() ? joinParts(text, () => []) : text;
}

/**
 * Segment Chinese text for FTS indexing and querying.
 * Splits into Chinese / non-Chinese segments. Only Chinese segments go
 * through jieba; English words are preserved intact so FTS can match them.
 *
 * Synchronous: when the dictionary is not loaded yet and the text contains
 * Chinese, this loads it on the calling thread (~1s, once per process). Async
 * callers should use segmentChineseAsync, which never blocks the event loop.
 */
export function segmentChinese(text: string): string {
  if (!HAS_CHINESE_RE.test(text)) return segmentWithoutChinese(text);
  const j = getJieba();
  if (!j) return text;
  try {
    return joinParts(text, run => j.cut(run));
  } catch {
    return text;
  }
}

/**
 * Segment a query string using the same tokenizer used for indexing.
 * MUST match the segmentation applied during INSERT for BM25 recall.
 */
export function segmentQuery(query: string): string {
  return segmentChinese(query);
}

// ---------------------------------------------------------------------------
// Off-thread segmentation
//
// nodejieba's native load is synchronous and takes ~1s. Async callers (memory
// search while building the prompt, raw-message indexing) go through one
// worker thread per process that loads the dictionary off the main thread, so
// the first screen never waits on it with the event loop blocked. A caller that
// arrives before the load finishes waits for it; the output is the same
// nodejieba with the same dictionaries, so segmentation is identical to the
// synchronous path. If the worker cannot start or load, callers fall back to
// the synchronous path (also identical) instead of returning unsegmented text.
// ---------------------------------------------------------------------------

const WORKER_SOURCE = `
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

/** cuts on success; cutError when nodejieba itself threw; unavailable when the worker is gone. */
interface CutReply { cuts?: string[][]; cutError?: string; unavailable?: true }
/** Why the async path fell back to the synchronous one; logged with the time spent waiting. */
type FallbackReason = 'worker could not start' | 'ready deadline exceeded' | 'cut deadline exceeded' | 'load failed' | 'worker exited' | 'worker error';
interface SegmentationWorker {
  /** Resolves true once the dictionary is loaded, false if the worker cannot load it. */
  whenReady(): Promise<boolean>;
  /** Why the worker became unusable, once it has; undefined while it is usable. */
  failureReason(): FallbackReason | undefined;
  cut(runs: string[]): Promise<CutReply>;
  terminate(): Promise<void>;
  /** nodejieba entry and dictionaries this worker loads, and whether the load finished. */
  describe(): { entry: string; options: ReturnType<typeof nativeLoadOptions>; ready: boolean };
}

const WORKER_KEY = Symbol.for('xiaok.segment.worker');
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
type WorkerHolder = Record<symbol, SegmentationWorker | null | undefined>;

function startWorker(entry: string, options: ReturnType<typeof nativeLoadOptions>): SegmentationWorker {
  const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { entry, options } });
  const pending = new Map<number, (reply: CutReply) => void>();
  let nextId = 0;
  let waiting = 0;
  let alive = true;
  // Set by terminate(): an exit we asked for is not a fallback and is not logged as one.
  let stopping = false;
  // Only hold the process open while a caller is waiting on the worker.
  const hold = () => { if (waiting++ === 0) worker.ref(); };
  const release = () => { if (--waiting === 0) worker.unref(); };
  worker.unref();
  let settleReady!: (ok: boolean) => void;
  const ready = new Promise<boolean>(resolve => { settleReady = resolve; });
  let failure: FallbackReason | undefined;
  let isReady = false;
  const fail = (reason: FallbackReason, detail?: string) => {
    alive = false;
    if (failure === undefined) {
      failure = reason;
      if (!stopping) logger.warn('segmentation worker unavailable; falling back to synchronous segmentation', { reason, ...(detail ? { detail } : {}) });
    }
    clearTimeout(readyDeadline);
    settleReady(false);
    for (const resolve of pending.values()) resolve({ unavailable: true });
    pending.clear();
  };
  const readyDeadline = setTimeout(() => { fail('ready deadline exceeded'); void worker.terminate(); }, SEGMENTATION_WORKER_READY_DEADLINE_MS);
  readyDeadline.unref();
  worker.on('message', (message: { type: string; id?: number; cuts?: string[][]; cutError?: string; error?: string }) => {
    if (message.type === 'ready') { clearTimeout(readyDeadline); isReady = true; settleReady(true); }
    else if (message.type === 'failed') { fail('load failed', message.error); void worker.terminate(); }
    else if (message.type === 'cut' && message.id !== undefined) {
      const resolve = pending.get(message.id);
      pending.delete(message.id);
      resolve?.(message.cutError === undefined ? { cuts: message.cuts } : { cutError: message.cutError });
    }
  });
  worker.on('error', error => fail('worker error', String(error)));
  worker.on('exit', () => fail('worker exited'));
  return {
    async whenReady() {
      hold();
      try { return await ready; } finally { release(); }
    },
    failureReason: () => failure,
    async cut(runs) {
      if (!alive) return { unavailable: true };
      hold();
      let cutDeadline: ReturnType<typeof setTimeout> | undefined;
      try {
        const id = nextId++;
        return await new Promise<CutReply>(resolve => {
          pending.set(id, resolve);
          // A cut that never answers marks the worker stuck: drop it and let this and
          // every later call fall back to the identical synchronous segmentation.
          cutDeadline = setTimeout(() => { fail('cut deadline exceeded'); void worker.terminate(); }, SEGMENTATION_WORKER_CUT_DEADLINE_MS);
          worker.postMessage({ id, runs });
        });
      } finally {
        clearTimeout(cutDeadline);
        release();
      }
    },
    async terminate() { stopping = true; alive = false; clearTimeout(readyDeadline); await worker.terminate(); },
    describe: () => ({ entry, options, ready: isReady && alive }),
  };
}

/** The per-process segmentation worker, started on first use; null when it cannot start. */
function segmentationWorker(): SegmentationWorker | null {
  const holder = globalThis as unknown as WorkerHolder;
  if (holder[WORKER_KEY] !== undefined) return holder[WORKER_KEY];
  let created: SegmentationWorker | null = null;
  try {
    const paths = readableDictionaryPaths();
    // Same asar rewrite as the dictionaries: in a packaged Electron app the worker
    // requires the unpacked copy of nodejieba (JS entry + native binding).
    if (paths !== null) created = startWorker(rewriteAsarPath(require.resolve('nodejieba')), nativeLoadOptions(paths));
  } catch (error) {
    logger.warn('segmentation worker could not start; falling back to synchronous segmentation', { reason: 'worker could not start', detail: error instanceof Error ? error.message : String(error) });
    created = null;
  }
  holder[WORKER_KEY] = created;
  return created;
}

/**
 * Start loading the dictionary off the main thread. Call once the first screen
 * is up; it returns immediately and never blocks the event loop.
 */
export function prewarmSegmentation(): void {
  if (jieba || jiebaLoadFailed) return;
  segmentationWorker();
}

/**
 * Async form of segmentChinese with identical output. Waits for the off-thread
 * dictionary load when it is still in progress; never loads on the main thread
 * unless the worker is unavailable.
 */
export async function segmentChineseAsync(text: string): Promise<string> {
  if (!HAS_CHINESE_RE.test(text)) return segmentWithoutChinese(text);
  if (jieba || jiebaLoadFailed) return segmentChinese(text);
  const startedAt = Date.now();
  const worker = segmentationWorker();
  if (worker && await worker.whenReady()) {
    const runs = Array.from(text.matchAll(CHINESE_RE), match => match[0]);
    const reply = await worker.cut(runs);
    if (reply.cuts) {
      let index = 0;
      return joinParts(text, () => reply.cuts![index++]!);
    }
    // nodejieba threw inside cut(): the sync path returns the raw text then too.
    if (reply.cutError !== undefined) return text;
  }
  // Worker unavailable: same segmentation on the calling thread (never skipped).
  return segmentChineseFallback(text, worker?.failureReason() ?? 'worker could not start', Date.now() - startedAt);
}

/**
 * The synchronous fallback, timed. The first fallback in a process loads the
 * dictionary on the calling thread (as master always does); that load and the
 * time already spent waiting on the worker are logged once, with the reason.
 */
function segmentChineseFallback(text: string, reason: FallbackReason, waitedMs: number): string {
  if (jieba || jiebaLoadFailed) return segmentChinese(text);
  const loadStartedAt = Date.now();
  const loaded = getJieba() !== null;
  const syncLoadMs = Date.now() - loadStartedAt;
  const details = { reason, waitedMs, syncLoadMs, loaded, budgetMs: SEGMENTATION_SYNC_FALLBACK_BUDGET_MS };
  if (syncLoadMs > SEGMENTATION_SYNC_FALLBACK_BUDGET_MS) logger.warn('synchronous segmentation fallback load exceeded its budget', details);
  else logger.warn('synchronous segmentation fallback load finished', details);
  return segmentChinese(text);
}

/** Where segmentation was loaded from in this process; see segmentationRuntimeInfo. */
export interface SegmentationRuntimeInfo {
  /** nodejieba entry the worker required (asar-rewritten), null when no worker started. */
  workerEntry: string | null;
  /** Dictionary paths the worker handed to the native load, null when no worker started. */
  dictionaryPaths: ReturnType<typeof nativeLoadOptions> | null;
  /** The worker loaded the dictionary and is still usable. */
  workerReady: boolean;
  /** Why the worker became unusable, null while it is usable or not started. */
  failureReason: FallbackReason | null;
  /** The dictionary was loaded on the calling thread (the synchronous path ran). */
  synchronousLoad: boolean;
}

/**
 * Read-only view of the segmentation runtime, for the packaged desktop smoke
 * (#150 M6): it proves the async path loaded nodejieba through the worker from
 * the packaged app, not from a development node_modules, and did not fall back.
 */
export function segmentationRuntimeInfo(): SegmentationRuntimeInfo {
  const worker = (globalThis as unknown as WorkerHolder)[WORKER_KEY];
  const described = worker ? worker.describe() : null;
  return {
    workerEntry: described?.entry ?? null,
    dictionaryPaths: described?.options ?? null,
    workerReady: described?.ready ?? false,
    failureReason: worker?.failureReason() ?? null,
    synchronousLoad: jieba !== null,
  };
}

/** Async form of segmentQuery; see segmentChineseAsync. */
export function segmentQueryAsync(query: string): Promise<string> {
  return segmentChineseAsync(query);
}

/**
 * Test-only hook (not used by product code): stop the per-process worker so the
 * next async call starts a new one. Terminates before clearing the slot so a
 * concurrent caller cannot start a second worker while the old one still holds
 * its dictionary.
 */
export async function resetSegmentationWorkerForTests(): Promise<void> {
  const holder = globalThis as unknown as WorkerHolder;
  const worker = holder[WORKER_KEY];
  await worker?.terminate();
  if (holder[WORKER_KEY] === worker) holder[WORKER_KEY] = undefined;
}
