import {openOriginalBudgetSourceWorker,notifyOriginalBudgetSourceFailure,completeOriginalBudgetSourceWorker,retainOriginalBudgetSourceFailure,closeOriginalBudgetSourceWorker,readOriginalBudgetSourceWorkerFate,assertOriginalBudgetSourceCommandCurrent,assertOriginalBudgetSourceLocal,readOriginalBudgetSourceRetirement,postOriginalBudgetSourceWorker} from './harness-budget-source-lifecycle.js';
import { Worker } from 'node:worker_threads';
import type { HarnessOptimizationConfig } from './harness-optimization-types.js';
import {constructOriginalProtectedBudgetWorker,closeOriginalProtectedBudgetWorker} from './harness-protected-budget-worker.js';
const apply = Reflect.apply, workerPost = Worker.prototype.postMessage;
const NativePromise = Promise, nativeThen=Promise.prototype.then;
const NativeMap = Map, mapGet = Map.prototype.get, mapSet = Map.prototype.set;
const mapDelete = Map.prototype.delete, mapClear = Map.prototype.clear, mapForEach = Map.prototype.forEach;
export interface HarnessStoreState {
  ownerId: string; ownerEpoch: number; config: HarnessOptimizationConfig;
  recoveryGuard: boolean; highWaterMark: number;
  clockGuard: boolean;
}
const originalBudgetStoreBirths=new WeakMap<object,object>(),birthGet=WeakMap.prototype.get,birthSet=WeakMap.prototype.set;
/** Per-original Worker only; never whole-file/OS retirement or a resource grant. */
export function readOriginalHarnessBudgetStoreWriterFate(store:unknown){const birth=apply(birthGet,originalBudgetStoreBirths,[store]);if(!birth)throw new Error('original_budget_store_required');return readOriginalBudgetSourceWorkerFate(birth);}
export class HarnessOptimizationStore {
  private worker: Worker;
  private sequence = 0;
  private sourceBirth?:object;
  private disposePromise?:Promise<void>;
  private stopped = false;
  private closing = false;
  private pending = new NativeMap<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  readonly ready: Promise<HarnessStoreState>;
  constructor(data: Record<string, unknown>, onFailure: () => void,private readonly originalProtectedBirth?:object) {
    const ordinary=originalProtectedBirth?undefined:openOriginalBudgetSourceWorker(data,onFailure);
    this.worker = originalProtectedBirth?constructOriginalProtectedBudgetWorker(originalProtectedBirth,data):ordinary!.worker;
    if(ordinary){this.sourceBirth=ordinary.birth;apply(birthSet,originalBudgetStoreBirths,[this,ordinary.birth]);}
    const notifyFailure=()=>{if(ordinary)notifyOriginalBudgetSourceFailure(ordinary.birth,onFailure);else onFailure();};
    let bootResolve!: (state: HarnessStoreState) => void, bootReject!: (error: Error) => void;
    this.ready = new NativePromise((resolve, reject) => { bootResolve = resolve; bootReject = reject; });
    this.worker.on('message', message => {
      if (message.ready) {
        if(!ordinary){bootResolve(message.ready);return;}
        const complete=(async()=>{try{await ordinary.acquisition;completeOriginalBudgetSourceWorker(ordinary.birth);bootResolve(message.ready);}catch(raw){
          this.stopped=true;retainOriginalBudgetSourceFailure(ordinary.birth,raw);
          notifyFailure();
          try{await this.dispose();}catch(secondary){retainOriginalBudgetSourceFailure(ordinary.birth,secondary);}
          bootReject(raw as Error);
        }})();void complete;return;
      }
      if (message.bootError) { const error=new Error(message.bootError);this.stopped=true;if(ordinary)retainOriginalBudgetSourceFailure(ordinary.birth,error);notifyFailure();bootReject(error); return; }
      const pending = apply(mapGet, this.pending, [message.id]) as { resolve(value: unknown): void; reject(error: Error): void } | undefined;
      if (pending) { apply(mapDelete, this.pending, [message.id]); if (message.error) {
        const error=ordinary&&message.error==='budget_source_writer_retired'?readOriginalBudgetSourceRetirement(ordinary.birth)??new Error(message.error):new Error(message.error);
        if(message.outcomeUnknown===true){Object.assign(error,{outcomeUnknown:true,stage:message.stage,primaryPresent:message.primaryPresent===true,rollbackErrorPresent:message.rollbackErrorPresent===true});notifyFailure();}
        pending.reject(error);
      } else pending.resolve(message.value); }
    });
    const failed = (raw?:unknown,present=false) => {
      const error=ordinary&&present?raw:ordinary?readOriginalBudgetSourceRetirement(ordinary.birth)??new Error('optimization_store_unavailable'):new Error('optimization_store_unavailable');
      if(ordinary)retainOriginalBudgetSourceFailure(ordinary.birth,error);
      this.stopped = true; notifyFailure(); bootReject(error as Error);
      apply(mapForEach, this.pending, [(p: { reject(error: Error): void }) => p.reject(error as Error)]);
      apply(mapClear, this.pending, []);
    };
    this.worker.on('error', raw=>failed(raw,true));
    this.worker.on('exit', () => {
      if (!this.stopped) failed();
      apply(mapForEach, this.pending, [(p: { reject(error: Error): void }) => p.reject(new Error('optimization_store_unavailable'))]);
      apply(mapClear, this.pending, []);
    });
  }
  call<T = unknown>(command: string, payload: unknown = {}, beforePost?: () => void): Promise<T> {
    if(this.sourceBirth&&command!=='shutdown'){const retired=readOriginalBudgetSourceRetirement(this.sourceBirth);if(retired)return new NativePromise<T>((_resolve,reject)=>reject(retired));}
    if (this.stopped || (this.closing && command !== 'shutdown')) return new NativePromise<T>((_resolve, reject) => reject(new Error('optimization_store_unavailable')));
    return new NativePromise<T>((resolve, reject) => {
      const id = ++this.sequence;
      apply(mapSet, this.pending, [id, { resolve: (value: unknown) => resolve(value as T), reject }]);
      try {
        if(this.sourceBirth&&command!=='shutdown')assertOriginalBudgetSourceCommandCurrent(this.sourceBirth);
        beforePost?.();
        if (this.stopped || (this.closing && command !== 'shutdown')) throw new Error('optimization_store_unavailable');
        if(this.sourceBirth){if(command!=='shutdown')assertOriginalBudgetSourceLocal(this.sourceBirth);postOriginalBudgetSourceWorker(this.sourceBirth,{id,command,payload},command==='shutdown');}
        else apply(workerPost, this.worker, [{ id, command, payload }]);
      } catch (error) {
        apply(mapDelete, this.pending, [id]);
        reject(error);
      }
    });
  }
  dispose(): Promise<void> {
    if(this.disposePromise)return this.disposePromise;
    this.closing = true;
    let yes!:()=>void,no!:(raw:unknown)=>void;this.disposePromise=new NativePromise<void>((resolve,reject)=>{yes=resolve;no=reject;});
    const operation=this.disposeOnce();void apply(nativeThen,operation,[yes,no]);return this.disposePromise;
  }
  private async disposeOnce(): Promise<void> {
    if(this.originalProtectedBirth){
      let first:{raw:unknown}|undefined;
      if(!this.stopped)try{await this.call('shutdown');}catch(raw){first={raw};}
      this.stopped=true;
      try{await closeOriginalProtectedBudgetWorker(this.originalProtectedBirth);}catch(raw){first??={raw};}
      if(first)throw first.raw;return;
    }
    let first:{raw:unknown}|undefined;
    if(!this.stopped&&!(this.sourceBirth&&readOriginalBudgetSourceRetirement(this.sourceBirth)))try{await this.call('shutdown');}catch(raw){first={raw};if(this.sourceBirth)retainOriginalBudgetSourceFailure(this.sourceBirth,raw);}
    this.stopped=true;
    try{if(this.sourceBirth)await closeOriginalBudgetSourceWorker(this.sourceBirth);else await this.worker.terminate();}catch(raw){first??={raw};}
    if(first)throw first.raw;
  }
}
