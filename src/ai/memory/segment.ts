// ESM-compatible wrapper for nodejieba.
// nodejieba is a CJS package; use createRequire for ESM compat.
import { accessSync, constants as fsConstants } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, win32 } from 'node:path';
import { Worker } from 'node:worker_threads';

const require = createRequire(import.meta.url);

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

/**
 * Text without Chinese never reaches jieba, so its output does not depend on
 * the dictionary. Produce it without loading: same result as the jieba path
 * when the dictionaries are usable, and the raw text when they are not.
 */
function segmentWithoutChinese(text: string): string {
  return dictionariesAvailable() ? joinParts(text, () => []) : text;
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
interface SegmentationWorker {
  /** Resolves true once the dictionary is loaded, false if the worker cannot load it. */
  whenReady(): Promise<boolean>;
  cut(runs: string[]): Promise<CutReply>;
  terminate(): Promise<void>;
}

const WORKER_KEY = Symbol.for('xiaok.segment.worker');
type WorkerHolder = Record<symbol, SegmentationWorker | null | undefined>;

function startWorker(entry: string, options: ReturnType<typeof nativeLoadOptions>): SegmentationWorker {
  const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { entry, options } });
  const pending = new Map<number, (reply: CutReply) => void>();
  let nextId = 0;
  let waiting = 0;
  let alive = true;
  // Only hold the process open while a caller is waiting on the worker.
  const hold = () => { if (waiting++ === 0) worker.ref(); };
  const release = () => { if (--waiting === 0) worker.unref(); };
  worker.unref();
  let settleReady!: (ok: boolean) => void;
  const ready = new Promise<boolean>(resolve => { settleReady = resolve; });
  const fail = (_reason: string) => {
    alive = false;
    settleReady(false);
    for (const resolve of pending.values()) resolve({ unavailable: true });
    pending.clear();
  };
  worker.on('message', (message: { type: string; id?: number; cuts?: string[][]; cutError?: string; error?: string }) => {
    if (message.type === 'ready') settleReady(true);
    else if (message.type === 'failed') { fail(message.error ?? 'load failed'); void worker.terminate(); }
    else if (message.type === 'cut' && message.id !== undefined) {
      const resolve = pending.get(message.id);
      pending.delete(message.id);
      resolve?.(message.cutError === undefined ? { cuts: message.cuts } : { cutError: message.cutError });
    }
  });
  worker.on('error', error => fail(String(error)));
  worker.on('exit', () => fail('worker exited'));
  return {
    async whenReady() {
      hold();
      try { return await ready; } finally { release(); }
    },
    async cut(runs) {
      if (!alive) return { unavailable: true };
      hold();
      try {
        const id = nextId++;
        return await new Promise<CutReply>(resolve => {
          pending.set(id, resolve);
          worker.postMessage({ id, runs });
        });
      } finally {
        release();
      }
    },
    async terminate() { alive = false; await worker.terminate(); },
  };
}

/** The per-process segmentation worker, started on first use; null when it cannot start. */
function segmentationWorker(): SegmentationWorker | null {
  const holder = globalThis as unknown as WorkerHolder;
  if (holder[WORKER_KEY] !== undefined) return holder[WORKER_KEY];
  let created: SegmentationWorker | null = null;
  try {
    const paths = readableDictionaryPaths();
    if (paths !== null) created = startWorker(require.resolve('nodejieba'), nativeLoadOptions(paths));
  } catch {
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
  // Worker unavailable: same segmentation on the calling thread.
  return segmentChinese(text);
}

/** Async form of segmentQuery; see segmentChineseAsync. */
export function segmentQueryAsync(query: string): Promise<string> {
  return segmentChineseAsync(query);
}

/** Test-only: stop the per-process worker so the next async call starts a new one. */
export async function resetSegmentationWorkerForTests(): Promise<void> {
  const holder = globalThis as unknown as WorkerHolder;
  const worker = holder[WORKER_KEY];
  holder[WORKER_KEY] = undefined;
  await worker?.terminate();
}
