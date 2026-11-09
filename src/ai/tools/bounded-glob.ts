import { Worker } from 'node:worker_threads';
import {types} from 'node:util';
import {validateScopedPatterns,permitsSearchPath,type SearchScope} from './search-scope.mjs';
import {ORIGINAL_BOUNDED_GLOB_WORKER_ENTRY} from './original-glob-worker-source.js';
import {hasOriginalMainSdkBridgeInstallation} from '../../runtime/verification/original-main-sdk-bridge.js';
import {loadOriginalProcessSdk} from '../../runtime/verification/original-process-sdk-loader.js';
const applyOriginal=Reflect.apply,originalAbortThrow=AbortSignal.prototype.throwIfAborted;
const originalUrlHref=Object.getOwnPropertyDescriptor(URL.prototype,'href')!.get!;
const originalIsProxy=types.isProxy;
import type {SearchPathGuard} from '../../platform/sandbox/search-scope.js';

export interface GlobSearchInput {
  patterns: string | string[];
  cwd: string;
  type?: 'file' | 'directory' | 'all';
  dot?: boolean;
  ignore?: string[];
  skipInaccessible?: boolean;
  /** Host-only private context binding, never copied from model input. */
  searchScope?:SearchScope;
  /** Existing fixed Native leaf grep payload; ordinary grep uses .grep(). */
  grep?:{pattern:string;context:number;outputMode:string;directFile?:boolean};
}
export interface GlobEntry { path: string; mtimeMs: number; text?:string }
export interface GrepSearchInput extends GlobSearchInput {
  grep:{pattern:string; context:number; outputMode:string};
}
export interface GrepEntry {path:string; lineNo:number; text:string; count?:number}
/** Why a grep result was cut short; empty when it is complete. */
export type GrepTruncation = 'result_limit'|'file_too_large'|'read_budget';
const TRUNCATIONS = new Set<string>(['result_limit','file_too_large','read_budget']);
export type SearchResult<T> = T[] & {truncated?: GrepTruncation[]};
export function formatSearchPath(path:string):string {
  return /\p{Cc}/u.test(path)?JSON.stringify(path):path;
}
export const GLOB_LIMITS = Object.freeze({
  maxEntries: 50_000, maxDirectories: 10_000, maxResults: 5_000, maxPathBytes: 2 * 1024 * 1024,
});
export type GlobLimits = { -readonly [K in keyof typeof GLOB_LIMITS]: number };
const ERROR_CODES = new Set(['glob_scan_limit', 'glob_result_limit', 'glob_search_failed', 'glob_worker_heap_config',
  'sandbox denied search path', 'search_scope_denied', 'search_scope_invalid_pattern', 'grep_scan_limit', 'grep_native_regex_profile_unavailable', 'grep_invalid_regex', 'grep_invalid_input', 'grep_read_failed', 'grep_read_limit', 'grep_result_limit']);

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
  const timeoutMs = Math.min(10_000, Math.max(1,Number.isFinite(options.timeoutMs)?Math.floor(options.timeoutMs!):10_000));
  const maxWorkers = Math.min(2, Math.max(1,Number.isFinite(options.maxWorkers)?Math.floor(options.maxWorkers!):2));
    async function run<T extends GlobEntry|GrepEntry>(input: GlobSearchInput|GrepSearchInput,
      kind:'glob'|'grep', signal?: AbortSignal, guard?:SearchPathGuard): Promise<SearchResult<T>> {
      const installed=hasOriginalMainSdkBridgeInstallation();
      if(installed&&signal!==undefined){if(originalIsProxy(signal))throw Error('glob_abort_signal_required');applyOriginal(originalAbortThrow,signal,[]);}
      else signal?.throwIfAborted();
      // Both host controls are intersections. A callback cannot widen an
      // already authenticated static scope from an older host context.
      const pathGuard=guard;
      if(input.searchScope)guard=path=>(!pathGuard||pathGuard(path))&&permitsSearchPath(path,input.searchScope);
      const patterns = typeof input.patterns === 'string' ? [input.patterns] : input.patterns;
      if (!Array.isArray(patterns) || !patterns.length || patterns.some(p => typeof p !== 'string' || !p.length)
        || patterns.join('').length > 2048 || typeof input.cwd !== 'string' || input.cwd.length > 10_240) {
        throw new Error('glob_invalid_input');
      }
      if(input.searchScope&&(input.searchScope.allowedPaths.length||input.searchScope.deniedPaths.length))validateScopedPatterns(patterns,input.searchScope);
      if (activeCount >= maxWorkers) throw new Error('glob_busy');
      if(installed){
        // No regular Worker/rg fallback after the Native ABI was installed or
        // retired. The fixed Source SDK alone can authorize this OS leaf.
        if(kind!=='glob')throw Error('glob_native_grep_contract_required');
        const entry=options.workerUrl??new URL(ORIGINAL_BOUNDED_GLOB_WORKER_ENTRY);
        if(originalIsProxy(entry)||applyOriginal(originalUrlHref,entry,[])!==ORIGINAL_BOUNDED_GLOB_WORKER_ENTRY)throw Error('glob_native_entry_required');
        if(guard&&!guard(input.cwd))throw Error('sandbox denied search path');
        activeCount++;
        try{
          const sdk=await loadOriginalProcessSdk();
          const message=await sdk.runOriginalBoundedReadonlyLeaf({workerData:{input,limits,nativeSearchProfile:'ascii_regex_or_literal_v1',timeoutMs},
            resourceLimits:{maxOldGenerationSizeMb:96,maxYoungGenerationSizeMb:8,stackSizeMb:2},execArgv:[],stdout:true,stderr:true},signal) as {ok?:boolean;entries?:GlobEntry[];code?:string};
          if(!message?.ok||!Array.isArray(message.entries)||message.entries.length>limits.maxResults)throw Error(ERROR_CODES.has(message?.code??'')?message.code:'glob_worker_failed');
          let bytes=0;
          for(const entry of message.entries){
            if(!entry||typeof entry.path!=='string'||!Number.isFinite(entry.mtimeMs)||('text' in entry&&typeof entry.text!=='string'))throw Error('glob_worker_failed');
            bytes+=Buffer.byteLength(entry.path)+(entry.text===undefined?0:Buffer.byteLength(entry.text));
            if(bytes>limits.maxPathBytes*2)throw Error('glob_result_limit');
            if(guard&&!guard(entry.path))throw Error('sandbox denied search path');
          }
          if(guard&&!guard(input.cwd))throw Error('sandbox denied search path');
          return message.entries as SearchResult<T>;
        }finally{activeCount--;}
      }
      const worker = new Worker(options.workerUrl ?? new URL('./glob-worker.mjs', import.meta.url), {
        workerData: { input, limits, kind, scoped:!!guard },
        // V8 heap failure must terminate the search, never Electron's main isolate.
        resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 },
        execArgv: [],
        stdout: true, stderr: true,
      });
      activeCount++;
      worker.stdout?.resume(); worker.stderr?.resume();
      return new Promise<SearchResult<T>>((resolve, reject) => {
        let result: SearchResult<T> | undefined;
        let failure: unknown;
        let authorizationId=0,authorizedPaths=0;
        const checkedPaths=new Set<string>();let checkedPathBytes=0;
        const remember=(path:string)=>{
          if(checkedPaths.has(path))return;
          checkedPathBytes+=Buffer.byteLength(path);checkedPaths.add(path);
          if(checkedPaths.size>limits.maxEntries+limits.maxDirectories||checkedPathBytes>limits.maxPathBytes)throw Error('glob_scan_limit');
        };
        const stop = () => { void worker.terminate().catch(() => undefined); };
        const onAbort = () => { failure = signal?.reason ?? new Error('glob_aborted'); stop(); };
        const timer = setTimeout(() => { failure ??= new Error('glob_timeout'); stop(); }, timeoutMs);
        signal?.addEventListener('abort', onAbort, { once: true });
        worker.on('message', (message) => {
          try {
            if(signal?.aborted || failure) {stop();return;}
            if(message?.kind==='authorize') {
              const paths:unknown=message.paths;
              if(!guard || message.id!==authorizationId+1 || !Array.isArray(paths)
                || paths.length>256 || paths.some(p=>typeof p!=='string'||p.length>10_240)
                || Buffer.byteLength(paths.join(''))>limits.maxPathBytes) throw Error('glob_worker_failed');
              authorizationId=message.id;authorizedPaths+=paths.length;
              if(authorizedPaths>limits.maxEntries*3+limits.maxDirectories*2)throw Error('glob_scan_limit');
              const allowed=paths.map(path=>{const allow=guard(path);if(allow)remember(path);return allow;});
              if(!signal?.aborted) worker.postMessage({kind:'authorized',id:message.id,allowed});
              return;
            }
            if (message?.ok && Array.isArray(message.entries) && message.entries.length <= limits.maxResults) {
              const entries=message.entries as T[];
              let pathBytes=0,textBytes=0;
              for(const entry of entries){
                if(!entry || typeof entry.path!=='string' || (kind==='glob'
                  ? !Number.isFinite((entry as GlobEntry).mtimeMs)
                  : typeof (entry as GrepEntry).text!=='string'||!Number.isSafeInteger((entry as GrepEntry).lineNo))) throw Error('glob_worker_failed');
                pathBytes+=Buffer.byteLength(entry.path);
                if(kind==='grep') textBytes+=Buffer.byteLength((entry as GrepEntry).text);
                if(pathBytes>limits.maxPathBytes || textBytes>1024*1024) throw Error('glob_result_limit');
                // Never recover paths by parsing formatted grep output.
                if(guard && !guard(entry.path)) throw Error('sandbox denied search path');
                if(guard)remember(entry.path);
              }
              const truncated:unknown=message.truncated??[];
              // Index every slot: .some() skips holes, so a sparse array would smuggle undefined through.
              if(!Array.isArray(truncated)||truncated.length>TRUNCATIONS.size||(kind==='glob'&&truncated.length)) throw Error('glob_worker_failed');
              for(let i=0;i<truncated.length;i++){const reason:unknown=truncated[i];
                if(typeof reason!=='string'||!TRUNCATIONS.has(reason)) throw Error('glob_worker_failed');}
              result = kind==='grep'?Object.assign(entries,{truncated:[...new Set(truncated as GrepTruncation[])]}):entries;
            } else {
              failure ??= new Error(ERROR_CODES.has(message?.code ?? '') ? message.code : 'glob_worker_failed');
            }
          } catch(error) {failure??=error;}
          stop();
        });
        worker.once('error', (error: NodeJS.ErrnoException) => {
          failure ??= new Error(error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'glob_worker_memory_limit' : 'glob_worker_failed');
          stop();
        });
        worker.once('exit', async () => {
          activeCount--;
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          // Only the actual exit releases the slot and settles cancellation.
          if (signal?.aborted) reject(signal.reason);
          else if (failure) reject(failure);
          else if (result) {
            try{
              if(guard){
                // Zero-match facts depend on visited paths too. Revalidate the
                // bounded authorized candidate set, not just matching results.
                let count=0;
                for(const path of checkedPaths){
                  signal?.throwIfAborted();
                  if(!guard(path))throw Error('sandbox denied search path');
                  if(++count%256===0)await new Promise<void>(done=>setImmediate(done));
                }
                signal?.throwIfAborted();
                if(result.some(entry=>!guard(entry.path)))throw Error('sandbox denied search path');
              }
              resolve(result);
            }catch(error){reject(error);}
          }
          else reject(new Error('glob_worker_failed'));
        });
        if (signal?.aborted) onAbort();
      });
    }
  return {
    get activeCount() { return activeCount; },
    search:(input:GlobSearchInput,signal?:AbortSignal,guard?:SearchPathGuard)=>run<GlobEntry>(input,'glob',signal,guard),
    grep:(input:GrepSearchInput,signal?:AbortSignal,guard?:SearchPathGuard)=>run<GrepEntry>(input,'grep',signal,guard),
  };
}

const sharedRunner = createBoundedGlobRunner();
export const runBoundedGlob = sharedRunner.search;
export const runBoundedGrep = sharedRunner.grep;
