/**
 * ComponentEffectScope (design v58 §3.3).
 *
 * The resource ledger of one generation. Contract points the tests freeze:
 *  - LIFO release order;
 *  - handle and scope dispose are idempotent;
 *  - one failing disposer never skips the rest; failures are aggregated;
 *  - a scope only releases handles whose owner is its own generation, so a late
 *    dispose can never reach a newer generation's resources;
 *  - registering into an already-disposed scope is a contract violation and
 *    fails fast instead of silently leaking.
 */
import { sameComponentInstance, } from './types.js';
export class EffectScopeContractViolation extends Error {
    constructor(message) {
        super(message);
        this.name = 'EffectScopeContractViolation';
    }
}
export class ComponentEffectScope {
    owner;
    now;
    entries = [];
    disposeResult = null;
    disposing = null;
    constructor(owner, now = () => Date.now()) {
        this.owner = owner;
        this.now = now;
    }
    get size() {
        return this.entries.filter((e) => !e.disposed).length;
    }
    get isDisposed() {
        return this.disposeResult !== null;
    }
    /**
     * Records an effect that has already been created. Must be called before the
     * next interruptible boundary (§3.3), which is why it is synchronous.
     */
    register(handle) {
        if (!sameComponentInstance(handle.owner, this.owner)) {
            throw new EffectScopeContractViolation(`handle owner ${handle.owner.componentId}/${handle.owner.generationId} does not match scope `
                + `${this.owner.componentId}/${this.owner.generationId}`);
        }
        if (this.disposing !== null || this.disposeResult !== null) {
            throw new EffectScopeContractViolation(`cannot register ${handle.kind}:${handle.resourceId} into a disposed scope`);
        }
        const entry = { handle, disposed: false };
        this.entries.push(entry);
        return {
            owner: handle.owner,
            kind: handle.kind,
            resourceId: handle.resourceId,
            dispose: async () => {
                await this.disposeEntry(entry);
            },
        };
    }
    /** Releases every remaining handle in LIFO order; idempotent. */
    async dispose() {
        if (this.disposeResult)
            return this.disposeResult;
        if (this.disposing)
            return this.disposing;
        const startedAt = this.now();
        this.disposing = (async () => {
            const failures = [];
            let disposed = 0;
            for (let i = this.entries.length - 1; i >= 0; i -= 1) {
                const entry = this.entries[i];
                if (entry.disposed)
                    continue;
                const failure = await this.disposeEntry(entry);
                if (failure)
                    failures.push(failure);
                else
                    disposed += 1;
            }
            const result = {
                disposed,
                failures: Object.freeze(failures),
                durationMs: this.now() - startedAt,
            };
            this.disposeResult = result;
            return result;
        })();
        return this.disposing;
    }
    async disposeEntry(entry) {
        if (entry.disposed)
            return null;
        entry.disposed = true;
        try {
            await entry.handle.dispose();
            return null;
        }
        catch (error) {
            return {
                kind: entry.handle.kind,
                resourceId: entry.handle.resourceId,
                error: error instanceof Error ? error : new Error(String(error)),
            };
        }
    }
}
