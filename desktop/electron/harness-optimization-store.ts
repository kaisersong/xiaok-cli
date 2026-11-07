import { Worker } from 'node:worker_threads';
import type { HarnessOptimizationConfig } from './harness-optimization-types.js';
import {constructOriginalProtectedBudgetWorker,closeOriginalProtectedBudgetWorker} from './harness-protected-budget-worker.js';
const apply = Reflect.apply, workerPost = Worker.prototype.postMessage;
const NativePromise = Promise;
const NativeMap = Map, mapGet = Map.prototype.get, mapSet = Map.prototype.set;
const mapDelete = Map.prototype.delete, mapClear = Map.prototype.clear, mapForEach = Map.prototype.forEach;
export interface HarnessStoreState {
  ownerId: string; ownerEpoch: number; config: HarnessOptimizationConfig;
  recoveryGuard: boolean; highWaterMark: number;
  clockGuard: boolean;
}
export class HarnessOptimizationStore {
  private worker: Worker;
  private sequence = 0;
  private stopped = false;
  private closing = false;
  private pending = new NativeMap<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  readonly ready: Promise<HarnessStoreState>;
  constructor(data: Record<string, unknown>, onFailure: () => void,private readonly originalProtectedBirth?:object) {
    this.worker = originalProtectedBirth?constructOriginalProtectedBudgetWorker(originalProtectedBirth,data):new Worker(new URL('./harness-optimization-store-worker.mjs', import.meta.url), { workerData: data, execArgv: ['--no-warnings'] });
    let bootResolve!: (state: HarnessStoreState) => void, bootReject!: (error: Error) => void;
    this.ready = new NativePromise((resolve, reject) => { bootResolve = resolve; bootReject = reject; });
    this.worker.on('message', message => {
      if (message.ready) { bootResolve(message.ready); return; }
      if (message.bootError) { this.stopped=true;onFailure();bootReject(new Error(message.bootError)); return; }
      const pending = apply(mapGet, this.pending, [message.id]) as { resolve(value: unknown): void; reject(error: Error): void } | undefined;
      if (pending) { apply(mapDelete, this.pending, [message.id]); if (message.error) {
        const error=new Error(message.error);
        if(message.outcomeUnknown===true){Object.assign(error,{outcomeUnknown:true,stage:message.stage,primaryPresent:message.primaryPresent===true,rollbackErrorPresent:message.rollbackErrorPresent===true});onFailure();}
        pending.reject(error);
      } else pending.resolve(message.value); }
    });
    const failed = () => {
      this.stopped = true; onFailure(); bootReject(new Error('optimization_store_unavailable'));
      apply(mapForEach, this.pending, [(p: { reject(error: Error): void }) => p.reject(new Error('optimization_store_unavailable'))]);
      apply(mapClear, this.pending, []);
    };
    this.worker.on('error', failed);
    this.worker.on('exit', () => {
      if (!this.stopped) failed();
      apply(mapForEach, this.pending, [(p: { reject(error: Error): void }) => p.reject(new Error('optimization_store_unavailable'))]);
      apply(mapClear, this.pending, []);
    });
  }
  call<T = unknown>(command: string, payload: unknown = {}, beforePost?: () => void): Promise<T> {
    if (this.stopped || (this.closing && command !== 'shutdown')) return new NativePromise<T>((_resolve, reject) => reject(new Error('optimization_store_unavailable')));
    return new NativePromise<T>((resolve, reject) => {
      const id = ++this.sequence;
      apply(mapSet, this.pending, [id, { resolve: (value: unknown) => resolve(value as T), reject }]);
      try {
        beforePost?.();
        if (this.stopped || (this.closing && command !== 'shutdown')) throw new Error('optimization_store_unavailable');
        apply(workerPost, this.worker, [{ id, command, payload }]);
      } catch (error) {
        apply(mapDelete, this.pending, [id]);
        reject(error);
      }
    });
  }
  async dispose(): Promise<void> {
    this.closing = true;
    if(this.originalProtectedBirth){
      let first:{raw:unknown}|undefined;
      if(!this.stopped)try{await this.call('shutdown');}catch(raw){first={raw};}
      this.stopped=true;
      try{await closeOriginalProtectedBudgetWorker(this.originalProtectedBirth);}catch(raw){first??={raw};}
      if(first)throw first.raw;return;
    }
    if (!this.stopped) { try { await this.call('shutdown'); } finally { this.stopped = true; await this.worker.terminate(); } }
    else await this.worker.terminate();
  }
}
