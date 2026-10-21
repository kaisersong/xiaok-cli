// Ordinary direct-hook JS settlement; no resource or permission grant.
// Consumers retain their original receiver/function/raw return/direct await.
const JoinPromise = Promise;
/** Only ToolRegistry's original hook continuations may call the bookkeeping methods.
 * No invoke(), raw.then, signal, observer, lifecycle hook or physical-release API. */
export class AcceptedHookCalls {
    #sealed = false;
    #sealReason;
    #records = new WeakMap();
    #pending = new Set();
    #failures = [];
    #joining;
    #resolveJoin;
    #rejectJoin;
    reserveOriginalCall(receiver, originalFunction, phase) {
        if (this.#sealed)
            throw new Error('hook_callback_ingress_closed', { cause: this.#sealReason });
        const call = Object.freeze({ receiver, originalFunction, phase });
        this.#records.set(call, { captured: false, state: 'pending' });
        this.#pending.add(call);
        return call;
    }
    captureOriginalReturn(call, raw) {
        const record = this.#pendingRecord(call);
        if (!record)
            return;
        if (record.captured) {
            this.#bookkeepingFailure();
            return;
        }
        // Store the original reference without Promise resolution/reflection/subscription.
        record.captured = true;
        record.raw = raw;
    }
    recordOriginalResolution(call) {
        const record = this.#pendingRecord(call);
        if (!record)
            return;
        if (!record.captured) {
            this.#bookkeepingFailure();
            return;
        }
        record.state = 'resolved';
        this.#pending.delete(call);
        // The original consumer has completed await; this does not release external IO.
        record.raw = undefined;
        this.#finishJoin();
    }
    recordOriginalRejection(call, error) {
        const record = this.#pendingRecord(call);
        if (!record)
            return;
        // A synchronous producer throw has no raw return, but is an accepted failure.
        record.state = 'rejected';
        this.#failures.push(error); // Original reference, including rejection with undefined.
        this.#pending.delete(call);
        record.raw = undefined;
        this.#finishJoin();
    }
    recordUnconfirmedReturn(call, error) {
        const record = this.#pendingRecord(call);
        if (!record)
            return;
        this.#failures.push(error);
        this.sealIngress(error);
        // Failed raw witness cannot retire already returned work or prove release.
        // Keep its raw reference and pending record without subscription/assimilation.
    }
    sealIngress(reason) {
        if (this.#sealed)
            return;
        this.#sealed = true;
        this.#sealReason = reason;
        // No cancellation, no timeout, no iteration of raw promises, no final hook.
    }
    waitForAcceptedCalls() {
        if (!this.#sealed)
            throw new Error('hook_callback_join_requires_seal');
        if (this.#joining)
            return this.#joining;
        // This is a single close-control Promise, never a relay for any hook result.
        this.#joining = new JoinPromise((resolve, reject) => {
            this.#resolveJoin = resolve;
            this.#rejectJoin = reject;
        });
        this.#finishJoin();
        return this.#joining;
    }
    #pendingRecord(call) {
        const record = this.#records.get(call);
        if (!record || record.state !== 'pending' || !this.#pending.has(call)) {
            this.#bookkeepingFailure();
            return undefined;
        }
        return record;
    }
    #bookkeepingFailure() {
        const error = new Error('hook_callback_bookkeeping_unconfirmed');
        this.#failures.push(error);
        this.sealIngress(error);
        // Preserve known pending records. Do not throw over the consumer's outcome
        // or declare an unknown/duplicate return physically released.
        this.#finishJoin();
    }
    #finishJoin() {
        if (!this.#sealed || this.#pending.size || !this.#resolveJoin || !this.#rejectJoin)
            return;
        const resolve = this.#resolveJoin, reject = this.#rejectJoin;
        this.#resolveJoin = undefined;
        this.#rejectJoin = undefined;
        if (this.#failures.length)
            reject(new AggregateError([...this.#failures], 'hook_accepted_calls_rejected'));
        else
            resolve();
    }
}
