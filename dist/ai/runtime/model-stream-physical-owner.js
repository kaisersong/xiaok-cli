export class ModelStreamPhysicalOwner {
    stopping = new AbortController();
    sealed = false;
    claims = new Set();
    raw = new Set();
    failures = [];
    waiters = new Set();
    closure;
    get signal() { return this.stopping.signal; }
    hasPending() { return this.claims.size > 0 || this.raw.size > 0; }
    hasFailure() { return this.failures.length > 0; }
    admit() {
        if (this.sealed)
            throw Error('agent_model_ingress_closed');
        if (this.failures.length)
            throw Error('agent_model_cleanup_unconfirmed');
        const claim = {};
        this.claims.add(claim);
        const current = () => { if (!this.claims.has(claim))
            throw Error('agent_model_claim_retired'); };
        const failure = (error) => { this.failures.push(error); };
        return Object.freeze({
            observeRead: (raw, knownReasons) => {
                current();
                let outcome = 'pending', reason;
                let classification = 'pending', visibleError, recorded = false;
                const classify = () => {
                    if (recorded || outcome !== 'rejected' || classification !== 'failed')
                        return;
                    recorded = true;
                    if (reason !== visibleError && !knownReasons().some(known => known !== undefined && known === reason))
                        failure(reason);
                };
                const receipt = {};
                this.raw.add(receipt);
                const settle = () => {
                    if (outcome === 'pending' || classification === 'pending')
                        return;
                    classify();
                    this.raw.delete(receipt);
                    this.checkIdle();
                };
                void raw.then(() => { outcome = 'fulfilled'; settle(); }, error => { outcome = 'rejected'; reason = error; settle(); });
                return Object.freeze({
                    consume() { if (classification !== 'pending')
                        return; classification = 'consumed'; settle(); },
                    classifyFailure(error) { if (classification !== 'pending')
                        return; classification = 'failed'; visibleError = error; settle(); },
                });
            },
            observeReturn: (raw) => { current(); this.track(raw, () => { }, failure); },
            noteReturnFailure: (error) => { current(); failure(error); },
            finish: () => { this.claims.delete(claim); this.checkIdle(); },
        });
    }
    stop(reason) {
        if (this.sealed)
            return;
        this.sealed = true;
        this.closure = this.waitForIdle();
        // A caller may attach later; this handler observes without replacing the
        // original sticky rejected closure returned by waitForStopped().
        void this.closure.catch(() => { });
        this.stopping.abort(reason);
        this.checkIdle();
    }
    waitForStopped() { return this.sealed ? this.closure : Promise.reject(Error('agent_model_stop_not_started')); }
    waitForIdle() { return new Promise((resolve, reject) => { this.waiters.add({ resolve, reject }); this.checkIdle(); }); }
    track(raw, fulfilled, rejected) {
        // Promise identity is not operation identity: a legal iterator may reuse
        // the same original Promise for next/return or concurrent owner receipts.
        const receipt = {};
        this.raw.add(receipt);
        void raw.then(() => { fulfilled(); this.raw.delete(receipt); this.checkIdle(); }, error => { rejected(error); this.raw.delete(receipt); this.checkIdle(); });
    }
    checkIdle() {
        if (this.hasPending())
            return;
        const error = this.failures.length ? new AggregateError([...this.failures], 'agent_model_physical_drain_unconfirmed') : undefined;
        for (const waiter of this.waiters) {
            if (error)
                waiter.reject(error);
            else
                waiter.resolve();
        }
        this.waiters.clear();
    }
}
