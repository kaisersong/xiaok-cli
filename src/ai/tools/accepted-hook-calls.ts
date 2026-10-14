// Ordinary direct-hook JS settlement; no resource or permission grant.
// Consumers retain their original receiver/function/raw return/direct await.
const JoinPromise = Promise;
export interface AcceptedHookCall {
  readonly receiver: object;
  readonly originalFunction: Function;
  readonly phase: 'generic' | 'pre' | 'post';
}
interface RecordState {
  captured: boolean;
  raw?: unknown;
  state: 'pending' | 'resolved' | 'rejected';
}
/** Only ToolRegistry's original hook continuations may call the bookkeeping methods.
 * No invoke(), raw.then, signal, observer, lifecycle hook or physical-release API. */
export class AcceptedHookCalls {
  #sealed = false;
  #sealReason: unknown;
  #records = new WeakMap<AcceptedHookCall, RecordState>();
  #pending = new Set<AcceptedHookCall>();
  #failures: unknown[] = [];
  #joining: Promise<void> | undefined;
  #resolveJoin: (() => void) | undefined;
  #rejectJoin: ((error: unknown) => void) | undefined;

  reserveOriginalCall(receiver: object, originalFunction: Function, phase: AcceptedHookCall['phase']): AcceptedHookCall {
    if (this.#sealed) throw new Error('hook_callback_ingress_closed', { cause: this.#sealReason });
    const call = Object.freeze({ receiver, originalFunction, phase });
    this.#records.set(call, { captured: false, state: 'pending' });
    this.#pending.add(call);
    return call;
  }

  captureOriginalReturn(call: AcceptedHookCall, raw: unknown): void {
    const record = this.#pendingRecord(call);
    if (!record) return;
    if (record.captured) { this.#bookkeepingFailure(); return; }
    // Store the original reference without Promise resolution/reflection/subscription.
    record.captured = true;
    record.raw = raw;
  }

  recordOriginalResolution(call: AcceptedHookCall): void {
    const record = this.#pendingRecord(call);
    if (!record) return;
    if (!record.captured) { this.#bookkeepingFailure(); return; }
    record.state = 'resolved';
    this.#pending.delete(call);
    // The original consumer has completed await; this does not release external IO.
    record.raw = undefined;
    this.#finishJoin();
  }

  recordOriginalRejection(call: AcceptedHookCall, error: unknown): void {
    const record = this.#pendingRecord(call);
    if (!record) return;
    // A synchronous producer throw has no raw return, but is an accepted failure.
    record.state = 'rejected';
    this.#failures.push(error); // Original reference, including rejection with undefined.
    this.#pending.delete(call);
    record.raw = undefined;
    this.#finishJoin();
  }

  recordUnconfirmedReturn(call: AcceptedHookCall, error: unknown): void {
    const record = this.#pendingRecord(call);
    if (!record) return;
    this.#failures.push(error);
    this.sealIngress(error);
    // Failed raw witness cannot retire already returned work or prove release.
    // Keep its raw reference and pending record without subscription/assimilation.
  }

  sealIngress(reason?: unknown): void {
    if (this.#sealed) return;
    this.#sealed = true;
    this.#sealReason = reason;
    // No cancellation, no timeout, no iteration of raw promises, no final hook.
  }

  waitForAcceptedCalls(): Promise<void> {
    if (!this.#sealed) throw new Error('hook_callback_join_requires_seal');
    if (this.#joining) return this.#joining;
    // This is a single close-control Promise, never a relay for any hook result.
    this.#joining = new JoinPromise<void>((resolve, reject) => {
      this.#resolveJoin = resolve;
      this.#rejectJoin = reject;
    });
    this.#finishJoin();
    return this.#joining;
  }

  #pendingRecord(call: AcceptedHookCall): RecordState | undefined {
    const record = this.#records.get(call);
    if (!record || record.state !== 'pending' || !this.#pending.has(call)) {
      this.#bookkeepingFailure();
      return undefined;
    }
    return record;
  }

  #bookkeepingFailure(): void {
    const error = new Error('hook_callback_bookkeeping_unconfirmed');
    this.#failures.push(error);
    this.sealIngress(error);
    // Preserve known pending records. Do not throw over the consumer's outcome
    // or declare an unknown/duplicate return physically released.
    this.#finishJoin();
  }

  #finishJoin(): void {
    if (!this.#sealed || this.#pending.size || !this.#resolveJoin || !this.#rejectJoin) return;
    const resolve = this.#resolveJoin, reject = this.#rejectJoin;
    this.#resolveJoin = undefined;
    this.#rejectJoin = undefined;
    if (this.#failures.length) reject(new AggregateError([...this.#failures], 'hook_accepted_calls_rejected'));
    else resolve();
  }
}
