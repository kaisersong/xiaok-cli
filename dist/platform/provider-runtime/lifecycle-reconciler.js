/**
 * LifecycleReconciler (design v58 §4.1, §5.1–§5.5).
 *
 * Single responsibility: compare persisted desired configuration against the
 * provider slots and produce the minimal, serialised lifecycle actions.
 *
 * Frozen behaviours:
 *  - one single-flight reconcile per component; concurrent inputs only bump
 *    `desiredRevision` instead of starting a second activate/deactivate;
 *  - after every async boundary the revision is re-compared, and a stale
 *    attempt disposes its provisional scope instead of committing;
 *  - commit happens in a synchronous critical section (no `await` inside);
 *  - a failed new generation never removes a healthy committed one — the
 *    projection becomes `active_degraded`, not disconnected;
 *  - retire drain/dispose failures surface as `cleanup_failed`, and they never
 *    block reconciliation of unrelated components;
 *  - `health_signal` is queued, never applied inside the reporter's lease;
 *  - retry never writes persisted desired state.
 */
import { ProviderSlotDirectory, } from './provider-slot-directory.js';
import { componentInstanceKeyOf } from './types.js';
export class LifecycleReconciler {
    slots;
    hooks;
    components = new Map();
    projectionRevision = 0;
    constructor(slots = new ProviderSlotDirectory(), hooks = {}) {
        this.slots = slots;
        this.hooks = hooks;
    }
    register(spec) {
        if (this.components.has(spec.id))
            throw new Error(`component already registered: ${spec.id}`);
        this.components.set(spec.id, {
            spec,
            desiredActive: spec.activation === 'startup',
            desiredRevision: 1,
            runtimeState: 'inactive',
            committedGeneration: null,
            preparingGeneration: null,
            inFlight: null,
            generationSeq: 0,
            pendingHealth: [],
        });
    }
    projection(componentId) {
        const record = this.require(componentId);
        const ready = record.runtimeState === 'active' || record.runtimeState === 'active_degraded';
        const actions = [];
        if (record.spec.activation === 'user')
            actions.push(record.desiredActive ? 'disable' : 'enable');
        if (record.desiredActive && !ready)
            actions.push('retry');
        return {
            componentId,
            pluginName: record.spec.pluginName,
            desiredActive: record.desiredActive,
            runtimeState: record.runtimeState,
            resourceMode: record.spec.resourceMode,
            committedGeneration: record.committedGeneration,
            preparingGeneration: record.preparingGeneration,
            ready,
            activeInvocationCount: this.slots.activeLeaseCount(record.spec.provides),
            availableActions: Object.freeze(actions),
            ...(record.lastError ? { lastError: record.lastError } : {}),
            ...(record.blockedBy ? { blockedBy: record.blockedBy } : {}),
            ...(record.cleanupStatus ? { cleanupStatus: record.cleanupStatus } : {}),
            revision: this.projectionRevision,
        };
    }
    /** Persisted desired-state mutation; only user-sourced callers reach this. */
    async setDesiredActive(componentId, desiredActive, requestSource) {
        if (requestSource !== 'user')
            throw new Error('desired state mutation requires requestSource "user"');
        const record = this.require(componentId);
        record.desiredActive = desiredActive;
        record.desiredRevision += 1;
        await this.reconcile(componentId);
    }
    /** Startup path: read persisted state and converge without writing anything. */
    async reconcileFromPersistedState(input) {
        for (const [componentId, desiredActive] of Object.entries(input)) {
            const record = this.components.get(componentId);
            if (!record)
                continue;
            record.desiredActive = desiredActive;
            record.desiredRevision += 1;
        }
        await Promise.all([...this.components.keys()].map((id) => this.reconcile(id)));
    }
    /** Component-specific retry; never mutates persisted desired state (§7.2). */
    async retry(componentId, requestSource) {
        if (requestSource !== 'user')
            throw new Error('retry requires requestSource "user"');
        const record = this.require(componentId);
        if (!record.desiredActive)
            return; // a disabled component is not activated by retry
        record.desiredRevision += 1;
        await this.reconcile(componentId);
    }
    /**
     * Health observation only. It never writes persisted state itself and is not
     * applied inside the reporting lease.
     */
    submitHealthSignal(signal) {
        const record = this.components.get(signal.componentId);
        if (!record)
            return;
        record.pendingHealth.push(signal);
    }
    /** Applied by the runtime after the reporting lease has been released. */
    async applyPendingHealthSignals(componentId) {
        const record = this.require(componentId);
        const pending = record.pendingHealth.splice(0);
        if (pending.length === 0)
            return;
        const generation = record.committedGeneration;
        const relevant = pending.filter((s) => s.generationId === generation);
        if (relevant.length === 0)
            return;
        for (const signal of relevant.filter((s) => s.persistent)) {
            this.hooks.onArchivePersistentFailure?.(signal);
        }
        record.lastError = relevant[relevant.length - 1].failureCode;
        await this.retireCommitted(record, 'provider_lost');
        if (record.desiredActive)
            await this.reconcile(componentId);
    }
    /** Single-flight per component; extra calls coalesce onto the running attempt. */
    async reconcile(componentId) {
        const record = this.require(componentId);
        if (record.inFlight) {
            await record.inFlight;
            // Requested revision may have moved while we waited; run once more.
            if (this.needsWork(record))
                await this.reconcile(componentId);
            return;
        }
        record.inFlight = this.runReconcile(record).finally(() => { record.inFlight = null; });
        await record.inFlight;
        if (this.needsWork(record))
            await this.reconcile(componentId);
    }
    needsWork(record) {
        const hasCommitted = record.committedGeneration !== null;
        if (record.desiredActive && !hasCommitted) {
            return record.runtimeState !== 'failed'
                && record.runtimeState !== 'blocked_manifest'
                && record.runtimeState !== 'cleanup_failed';
        }
        if (!record.desiredActive && hasCommitted)
            return true;
        return false;
    }
    async runReconcile(record) {
        if (!record.desiredActive) {
            if (record.committedGeneration)
                await this.retireCommitted(record, 'user_disabled');
            else
                this.setState(record, 'inactive');
            return;
        }
        if (record.committedGeneration)
            return; // already active
        await this.activate(record);
    }
    /**
     * §5.3 transactional replacement: prepare and validate the new generation
     * while the old one keeps serving, swap in a synchronous critical section,
     * then drain the old generation. A failed attempt leaves the old generation
     * committed and only projects `active_degraded`.
     */
    async replaceGeneration(componentId) {
        const record = this.require(componentId);
        if (!record.committedGeneration) {
            await this.reconcile(componentId);
            return { replaced: record.committedGeneration !== null };
        }
        const startRevision = record.desiredRevision;
        const previousGeneration = record.committedGeneration;
        record.generationSeq += 1;
        const provider = componentInstanceKeyOf(record.spec.id, `gen-${record.generationSeq}`);
        record.preparingGeneration = provider.generationId;
        const { scope } = this.slots.prepare({
            capabilityKey: record.spec.provides,
            provider,
            resourceMode: record.spec.resourceMode,
            value: null,
        });
        try {
            const result = await record.spec.activate({
                provider,
                scope,
                isStale: () => record.desiredRevision !== startRevision,
            });
            if (record.desiredRevision !== startRevision) {
                await scope.dispose();
                this.slots.markFailed(record.spec.provides, provider);
                record.preparingGeneration = null;
                return { replaced: false };
            }
            this.slots.prepare({
                capabilityKey: record.spec.provides,
                provider,
                resourceMode: record.spec.resourceMode,
                value: result.value,
                closeOnce: result.closeOnce,
            });
            this.slots.commit(record.spec.provides, provider);
            record.committedGeneration = provider.generationId;
            record.preparingGeneration = null;
            record.lastError = undefined;
            this.setState(record, 'active');
            // Old generation stops granting leases at commit; drain it afterwards.
            void this.slots.retire(record.spec.provides, previousGeneration).catch((error) => {
                record.cleanupStatus = error instanceof Error ? error.message : String(error);
                this.setState(record, 'cleanup_failed');
            });
            return { replaced: true };
        }
        catch (error) {
            await scope.dispose();
            this.slots.markFailed(record.spec.provides, provider);
            record.preparingGeneration = null;
            record.lastError = error instanceof Error ? error.message : String(error);
            // The old generation is untouched and still serving.
            this.setState(record, 'active_degraded');
            return { replaced: false };
        }
    }
    async activate(record) {
        const startRevision = record.desiredRevision;
        record.generationSeq += 1;
        const provider = componentInstanceKeyOf(record.spec.id, `gen-${record.generationSeq}`);
        record.preparingGeneration = provider.generationId;
        this.setState(record, 'activating');
        const { scope } = this.slots.prepare({
            capabilityKey: record.spec.provides,
            provider,
            resourceMode: record.spec.resourceMode,
            value: null,
        });
        try {
            const result = await record.spec.activate({
                provider,
                scope,
                isStale: () => record.desiredRevision !== startRevision,
            });
            // Async boundary landed: re-compare before publishing anything.
            if (record.desiredRevision !== startRevision) {
                await scope.dispose();
                this.slots.markFailed(record.spec.provides, provider);
                record.preparingGeneration = null;
                this.setState(record, record.desiredActive ? 'activating' : 'inactive');
                return;
            }
            // Synchronous critical section: no await between here and commit.
            this.slots.prepare({
                capabilityKey: record.spec.provides,
                provider,
                resourceMode: record.spec.resourceMode,
                value: result.value,
                closeOnce: result.closeOnce,
            });
            this.slots.commit(record.spec.provides, provider);
            record.committedGeneration = provider.generationId;
            record.preparingGeneration = null;
            record.lastError = undefined;
            record.blockedBy = undefined;
            record.cleanupStatus = undefined;
            this.setState(record, 'active');
            this.hooks.onClearPersistentFailure?.(record.spec.id);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await scope.dispose();
            this.slots.markFailed(record.spec.provides, provider);
            record.preparingGeneration = null;
            record.lastError = message;
            const blocked = error instanceof BlockedManifestError;
            if (blocked) {
                record.blockedBy = error.diagnostic;
                this.setState(record, 'blocked_manifest');
                return;
            }
            // A previously committed generation stays usable: degraded, not down.
            this.setState(record, record.committedGeneration ? 'active_degraded' : 'failed');
        }
    }
    async retireCommitted(record, reason) {
        const generationId = record.committedGeneration;
        if (!generationId)
            return;
        this.setState(record, 'deactivating');
        try {
            await this.slots.retire(record.spec.provides, generationId);
            record.committedGeneration = null;
            record.cleanupStatus = undefined;
            this.setState(record, reason === 'user_disabled' ? 'inactive' : 'failed');
        }
        catch (error) {
            record.committedGeneration = null;
            record.cleanupStatus = error instanceof Error ? error.message : String(error);
            this.setState(record, 'cleanup_failed');
        }
    }
    setState(record, state) {
        record.runtimeState = state;
        this.projectionRevision += 1;
        this.hooks.onProjection?.(this.projection(record.spec.id));
    }
    require(componentId) {
        const record = this.components.get(componentId);
        if (!record)
            throw new Error(`unknown component: ${componentId}`);
        return record;
    }
}
/** Desired active but manifest/trusted source unresolvable (§5.1). */
export class BlockedManifestError extends Error {
    diagnostic;
    constructor(diagnostic) {
        super(`blocked_manifest: ${diagnostic}`);
        this.diagnostic = diagnostic;
        this.name = 'BlockedManifestError';
    }
}
