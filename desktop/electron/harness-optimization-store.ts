import { Worker } from 'node:worker_threads';
import type { HarnessOptimizationConfig } from './harness-optimization-types.js';
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
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  readonly ready: Promise<HarnessStoreState>;
  constructor(data: Record<string, unknown>, onFailure: () => void) {
    this.worker = new Worker(new URL('./harness-optimization-store-worker.mjs', import.meta.url), { workerData: data, execArgv: ['--no-warnings'] });
    let bootResolve!: (state: HarnessStoreState) => void, bootReject!: (error: Error) => void;
    this.ready = new Promise((resolve, reject) => { bootResolve = resolve; bootReject = reject; });
    this.worker.on('message', message => {
      if (message.ready) { bootResolve(message.ready); return; }
      if (message.bootError) { bootReject(new Error(message.bootError)); return; }
      const pending = this.pending.get(message.id);
      if (pending) { this.pending.delete(message.id); if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.value); }
    });
    const failed = () => {
      this.stopped = true; onFailure(); bootReject(new Error('optimization_store_unavailable'));
      for (const p of this.pending.values()) p.reject(new Error('optimization_store_unavailable'));
      this.pending.clear();
    };
    this.worker.on('error', failed);
    this.worker.on('exit', () => {
      if (!this.stopped) failed();
      for (const p of this.pending.values()) p.reject(new Error('optimization_store_unavailable'));
      this.pending.clear();
    });
  }
  call<T = unknown>(command: string, payload: unknown = {}): Promise<T> {
    if (this.stopped || (this.closing && command !== 'shutdown')) return Promise.reject(new Error('optimization_store_unavailable'));
    return new Promise<T>((resolve, reject) => {
      const id = ++this.sequence;
      this.pending.set(id, { resolve: value => resolve(value as T), reject });
      this.worker.postMessage({ id, command, payload });
    });
  }
  async dispose(): Promise<void> {
    this.closing = true;
    if (!this.stopped) { try { await this.call('shutdown'); } finally { this.stopped = true; await this.worker.terminate(); } }
    else await this.worker.terminate();
  }
}
