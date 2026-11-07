import { validateScopedPatterns, type SearchScope } from './search-scope.mjs';
import { Worker } from 'node:worker_threads';
import {types} from 'node:util';
import {ORIGINAL_BOUNDED_GLOB_WORKER_ENTRY} from './original-glob-worker-source.js';
import {hasOriginalMainSdkBridgeInstallation} from '../../runtime/verification/original-main-sdk-bridge.js';
import type * as OriginalProcessSdk from '../../runtime/verification/original-process-sdk.js';
import {loadOriginalProcessSdk} from '../../runtime/verification/original-process-sdk-loader.js';
const applyOriginal = Reflect.apply;
const originalAbortThrow = AbortSignal.prototype.throwIfAborted;
const originalUrlHref = Object.getOwnPropertyDescriptor(URL.prototype, 'href')!.get!;
const originalIsProxy = types.isProxy;

export interface GlobSearchInput {
  patterns: string | string[];
  cwd: string;
  type?: 'file' | 'directory' | 'all';
  dot?: boolean;
  ignore?: string[];
  skipInaccessible?: boolean;
  /** Authenticated host-only scope; never copied from raw tool input. */
  searchScope?: SearchScope;
  grep?: { pattern: string; context: number; outputMode: string; directFile: boolean };
}
export interface GlobEntry { path: string; mtimeMs: number; text?: string }
export const GLOB_LIMITS = Object.freeze({
  maxEntries: 50_000, maxDirectories: 10_000, maxResults: 5_000, maxPathBytes: 2 * 1024 * 1024,
});
export type GlobLimits = { -readonly [K in keyof typeof GLOB_LIMITS]: number };
const ERROR_CODES = new Set(['glob_scan_limit', 'glob_result_limit', 'glob_search_failed', 'glob_worker_heap_config', 'grep_scan_limit', 'grep_result_limit', 'grep_invalid_regex', 'grep_native_regex_profile_unavailable']);

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
  const timeoutMs = Math.min(10_000, Math.max(1, Number.isFinite(options.timeoutMs) ? Math.floor(options.timeoutMs!) : 10_000));
  const maxWorkers = Math.min(2, Math.max(1, Number.isFinite(options.maxWorkers) ? Math.floor(options.maxWorkers!) : 2));
  return {
    get activeCount() { return activeCount; },
    async search(input: GlobSearchInput, signal?: AbortSignal): Promise<GlobEntry[]> {
      if (hasOriginalMainSdkBridgeInstallation() && signal !== undefined) {
        if (originalIsProxy(signal)) throw new Error('glob_abort_signal_required');
        applyOriginal(originalAbortThrow, signal, []);
      } else signal?.throwIfAborted();
      const patterns = typeof input.patterns === 'string' ? [input.patterns] : input.patterns;
      if (!Array.isArray(patterns) || !patterns.length || patterns.some(p => typeof p !== 'string' || !p.length)
        || patterns.join('').length > 2048 || typeof input.cwd !== 'string' || input.cwd.length > 10_240) {
        throw new Error('glob_invalid_input');
      }
      validateScopedPatterns(patterns, input.searchScope);
      if (activeCount >= maxWorkers) throw new Error('glob_busy');
      activeCount++;
      let owned:Awaited<ReturnType<typeof OriginalProcessSdk.createOriginalToolWorker>>|undefined;
      let worker:Worker;
      let sdk:typeof OriginalProcessSdk|undefined;
      try {
      const entry=options.workerUrl ?? new URL(ORIGINAL_BOUNDED_GLOB_WORKER_ENTRY);
      const workerOptions = {
        workerData: { input, limits, ...(hasOriginalMainSdkBridgeInstallation()?{nativeSearchProfile:'ascii_regex_or_literal_v1',timeoutMs}:{}) },
        // V8 heap failure must terminate the search, never Electron's main isolate.
        resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 },
        execArgv: [],
        stdout: true, stderr: true,
      };
      if(hasOriginalMainSdkBridgeInstallation()){
        // A Native readonly search uses its original P's owned OS leaf. It does
        // not manufacture a Worker handle or start the legacy worker as a child.
        if (originalIsProxy(entry) || applyOriginal(originalUrlHref, entry, []) !== ORIGINAL_BOUNDED_GLOB_WORKER_ENTRY) throw new Error('glob_native_entry_required');
        sdk=await loadOriginalProcessSdk();
        const message = await sdk.runOriginalBoundedReadonlyLeaf(workerOptions, signal) as {ok?:boolean;entries?:GlobEntry[];code?:string};
        if (!message?.ok || !Array.isArray(message.entries) || message.entries.length > limits.maxResults)
          throw new Error(ERROR_CODES.has(message?.code ?? '') ? message.code : 'glob_worker_failed');
        activeCount--;
        return message.entries;
      } else worker=new Worker(entry,workerOptions);
      }catch(error){activeCount--;throw error;}
      const listen=(event:string,callback:Function)=>{if(owned)sdk!.listenOriginalToolProcess(owned.attempt,'child',event,callback);else worker.once(event,callback as (...args:any[])=>void);};
      if(owned){sdk!.listenOriginalToolProcess(owned.attempt,'stdout','data',()=>{});sdk!.listenOriginalToolProcess(owned.attempt,'stderr','data',()=>{});}
      else {worker.stdout?.resume();worker.stderr?.resume();}
      let primaryPresent=false,primary:unknown,result:GlobEntry[]|undefined;
      try {result=await new Promise<GlobEntry[]>((resolve, reject) => {
        let result: GlobEntry[] | undefined;
        let failure: unknown;
        const stop = () => { void (owned?sdk!.terminateOriginalToolProcess(owned.attempt):worker.terminate()).catch(() => undefined); };
        const onAbort = () => { failure = signal?.reason ?? new Error('glob_aborted'); stop(); };
        const timer = setTimeout(() => { failure ??= new Error('glob_timeout'); stop(); }, timeoutMs);
        signal?.addEventListener('abort', onAbort, { once: true });
        listen('message', (message: { ok?: boolean; entries?: GlobEntry[]; code?: string }) => {
          if (message?.ok && Array.isArray(message.entries) && message.entries.length <= limits.maxResults) {
            result = message.entries;
          } else {
            failure ??= new Error(ERROR_CODES.has(message?.code ?? '') ? message.code : 'glob_worker_failed');
          }
          stop();
        });
        listen('error', (error: NodeJS.ErrnoException) => {
          failure ??= new Error(error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'glob_worker_memory_limit' : 'glob_worker_failed');
          stop();
        });
        listen('exit', () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          // Only the actual exit releases the slot and settles cancellation.
          if (signal?.aborted) reject(signal.reason);
          else if (failure) reject(failure);
          else if (result) resolve(result);
          else reject(new Error('glob_worker_failed'));
        });
        if(owned)sdk!.sealOriginalToolProcessListeners(owned.attempt);
        if (signal?.aborted) onAbort();
      });}catch(error){primaryPresent=true;primary=error;}
      if(owned)try{await sdk!.waitOriginalToolProcessPhysical(owned.attempt);}catch(error){if(!primaryPresent){primaryPresent=true;primary=error;}}
      activeCount--;
      if(primaryPresent)throw primary;
      return result!;
    },
  };
}

const sharedRunner = createBoundedGlobRunner();
export const runBoundedGlob = sharedRunner.search;
