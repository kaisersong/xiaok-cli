import type { ChildProcess } from 'node:child_process';

/** Tracks direct children spawned by one service. This is local lifecycle
 * bookkeeping, not process-tree custody or a persistence/remote-work receipt. */
export function createOwnedServiceChildCloseTracker() {
  type Record = { child: ChildProcess; graceMs: number; exited: boolean; closed: boolean; close: Promise<void>; errors: unknown[]; signalErrors: unknown[] };
  const unclosed = new Set<Record>();
  const seen = new WeakSet<ChildProcess>();
  let closing: Promise<void> | undefined;
  function track(child: ChildProcess, graceMs: number): void {
    if (closing) throw Error('owned_service_children_closed');
    if (seen.has(child)) throw Error('owned_service_child_already_tracked');
    seen.add(child);
    let resolve!: () => void;
    const close = new Promise<void>(done => { resolve = done; });
    const record: Record = { child, graceMs, exited: child.exitCode != null || child.signalCode != null, closed: false, close, errors: [], signalErrors: [] };
    unclosed.add(record);
    const onExit = () => { record.exited = true; };
    const onError = (error: Error) => { record.errors.push(error); };
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
    if (record.closed) return Promise.resolve(true);
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), ms);
      void record.close.then(() => { clearTimeout(timer); resolve(true); });
    });
  }
  async function terminate(record: Record): Promise<void> {
    function signal(value: NodeJS.Signals) {
      if (record.closed || record.exited || record.child.exitCode != null || record.child.signalCode != null) return;
      try {
        if (!record.child.kill(value)) record.signalErrors.push(Error(`owned_service_child_signal_failed:${value}`));
      } catch (error) { record.signalErrors.push(error); }
    }
    signal('SIGTERM');
    let confirmed = await waitForClose(record, record.graceMs);
    if (!confirmed) { signal('SIGKILL'); confirmed = await waitForClose(record, 3_000); }
    if (!confirmed || record.signalErrors.length) {
      throw new AggregateError([...record.signalErrors, ...(!confirmed ? record.errors : [])], 'owned_service_child_close_unconfirmed');
    }
  }
  function closeAll(): Promise<void> {
    if (closing) return closing;
    // Defer execution so the shared Promise is assigned before any signal can
    // synchronously reenter the service through a process/status callback.
    closing = Promise.resolve().then(async () => {
      const outcomes = await Promise.allSettled([...unclosed].map(terminate));
      const errors = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason] : []);
      if (errors.length) throw new AggregateError(errors, 'owned_service_children_close_unconfirmed');
    });
    return closing;
  }
  return Object.freeze({ track, closeAll });
}
