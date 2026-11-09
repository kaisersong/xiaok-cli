import {assertStandardIpcPromise} from './ipc-native-promise.js';
import {createIntrinsicSet,settleIntrinsicOperations,appendIntrinsic,aggregateIntrinsicErrors} from '../../src/runtime/verification/intrinsic-async-collection.js';
import type { ChildProcess } from 'node:child_process';
const NativePromise=Promise,NativeWeakSet=WeakSet,apply=Reflect.apply,then=Promise.prototype.then;
const resolveNative=Promise.resolve.bind(Promise),weakHas=WeakSet.prototype.has,weakAdd=WeakSet.prototype.add;

/** Tracks direct children spawned by one service. This is local lifecycle
 * bookkeeping, not process-tree custody or a persistence/remote-work receipt. */
export function createOwnedServiceChildCloseTracker() {
  type Record = { child: ChildProcess; graceMs: number; exited: boolean; closed: boolean; close: Promise<void>; errors: unknown[]; signalErrors: unknown[] };
  const unclosed = createIntrinsicSet<Record>();
  const seen = new NativeWeakSet<ChildProcess>();
  const seenHas = (child:ChildProcess):boolean=>apply(weakHas,seen,[child]), seenAdd = (child:ChildProcess):void=>{apply(weakAdd,seen,[child]);};
  let closing: Promise<void> | undefined;
  function track(child: ChildProcess, graceMs: number): void {
    if (closing) throw Error('owned_service_children_closed');
    if (seenHas(child)) throw Error('owned_service_child_already_tracked');
    seenAdd(child);
    let resolve!: () => void;
    const close = new NativePromise<void>(done => { resolve = done; });
    const record: Record = { child, graceMs, exited: child.exitCode != null || child.signalCode != null, closed: false, close, errors: [], signalErrors: [] };
    unclosed.add(record);
    const onExit = () => { record.exited = true; };
    const onError = (error: Error) => { appendIntrinsic(record.errors,error); };
    child.once('exit', onExit);
    child.on('error', onError);
    child.once('close', () => {
      record.closed = true;
      unclosed.delete(record);
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
      resolve();
    });
  }
  function waitForClose(record: Record, ms: number): Promise<boolean> {
    if (record.closed) return resolveNative(true);
    return new NativePromise(resolve => {
      const timer = setTimeout(() => resolve(false), ms);
      assertStandardIpcPromise(record.close,'owned_service_child_observation_unknown');
      void apply(then,record.close,[() => { clearTimeout(timer); resolve(true); }]);
    });
  }
  async function terminate(record: Record): Promise<void> {
    function signal(value: NodeJS.Signals) {
      if (record.closed || record.exited || record.child.exitCode != null || record.child.signalCode != null) return;
      try {
        if (!record.child.kill(value)) appendIntrinsic(record.signalErrors,Error(`owned_service_child_signal_failed:${value}`));
      } catch (error) { appendIntrinsic(record.signalErrors,error); }
    }
    signal('SIGTERM');
    let confirmed = await waitForClose(record, record.graceMs);
    if (!confirmed) { signal('SIGKILL'); confirmed = await waitForClose(record, 3_000); }
    if (!confirmed || record.signalErrors.length) {
      const errors:unknown[]=[];for(let i=0;i<record.signalErrors.length;i++)appendIntrinsic(errors,record.signalErrors[i]);if(!confirmed)for(let i=0;i<record.errors.length;i++)appendIntrinsic(errors,record.errors[i]);
      throw aggregateIntrinsicErrors(errors,'owned_service_child_close_unconfirmed');
    }
  }
  function closeAll(): Promise<void> {
    if (closing) return closing;
    // Defer execution so the shared Promise is assigned before any signal can
    // synchronously reenter the service through a process/status callback.
    const initial=resolveNative();assertStandardIpcPromise(initial,'owned_service_child_observation_unknown');
    closing = apply(then,initial,[async () => {
      const outcomes = await settleIntrinsicOperations(unclosed.snapshot(),terminate);
      const errors:unknown[]=[];for(let i=0;i<outcomes.length;i++){const outcome=outcomes[i]!;if(outcome.status==='rejected')appendIntrinsic(errors,outcome.reason);}
      if (errors.length) throw aggregateIntrinsicErrors(errors, 'owned_service_children_close_unconfirmed');
    }]) as Promise<void>;
    return closing;
  }
  return Object.freeze({ track, closeAll });
}
