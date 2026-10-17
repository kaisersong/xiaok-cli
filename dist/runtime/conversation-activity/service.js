/** Owned by the host, with actor and thread identity supplied by main's registry. */
export class ConversationActivityService {
    options;
    subscribers = new Set();
    timer;
    disposed = false;
    reporting;
    notifying;
    retentionTicks = 0;
    pendingChanges = new Map();
    constructor(options) {
        this.options = options;
    }
    assertUser(actor) {
        if (this.disposed)
            throw new Error('activity_service_disposed');
        if (actor?.requestSource !== 'user' || actor.actorId !== this.options.actorId)
            throw new Error('activity_actor_forbidden');
    }
    thread(threadId) {
        const thread = this.options.getThread(threadId);
        if (!thread || thread.profileId !== this.options.profileId)
            throw new Error('activity_thread_forbidden');
        if (thread.deleteState !== 'none')
            throw new Error('activity_thread_deleted');
        return thread;
    }
    async visible(watch) {
        const thread = this.thread(watch.origin.threadId);
        if (thread.workspaceId !== watch.origin.workspaceId)
            throw new Error('activity_thread_forbidden');
        const allowed = await this.options.canObserveWork(watch);
        // Recheck the local admission fence after suspended authorization IO.
        if (this.thread(watch.origin.threadId).workspaceId !== watch.origin.workspaceId)
            throw new Error('activity_thread_forbidden');
        return allowed;
    }
    async prepareAssociation(input, actor) {
        this.assertUser(actor);
        const thread = this.thread(input.threadId);
        const origin = { profileId: thread.profileId, threadId: thread.threadId, workspaceId: thread.workspaceId, actorId: actor.actorId };
        this.options.store.prepareAssociation({ operationId: input.operationId, creationIdempotencyKey: input.creationIdempotencyKey, origin });
    }
    /** Main-only source receipt binding; never registered as a model/renderer mutation. */
    async bindWork(binding, mcpReference) {
        if (this.disposed)
            throw new Error('activity_service_disposed');
        const association = this.options.store.getAssociation(binding.operationId);
        if (!association || association.origin.profileId !== this.options.profileId)
            throw new Error('activity_association_missing');
        const thread = this.thread(association.origin.threadId);
        if (thread.workspaceId !== association.origin.workspaceId)
            throw new Error('activity_thread_forbidden');
        const watch = this.options.store.bindWork(binding, mcpReference);
        await this.publish({ threadId: watch.origin.threadId, watchId: watch.watchId });
        return watch;
    }
    forgetUnboundAssociation(operationId) { if (this.disposed)
        throw new Error('activity_service_disposed'); this.options.store.forgetUnboundAssociation(operationId); }
    async canReadSource(watchId) {
        if (this.disposed)
            return false;
        const watch = this.options.store.getWatch(watchId);
        if (!watch || watch.status !== 'active' || watch.origin.profileId !== this.options.profileId)
            return false;
        return this.visible(watch);
    }
    /** Source adapter entry only. Event payloads cannot choose a conversation. */
    async acceptEvent(watchId, raw, currentSource) {
        if (this.disposed)
            throw new Error('activity_service_disposed');
        const watch = this.options.store.getWatch(watchId);
        if (!watch || watch.origin.profileId !== this.options.profileId)
            throw new Error('activity_watch_forbidden');
        if (!await this.visible(watch))
            throw new Error('activity_source_forbidden');
        if (currentSource && !currentSource())
            throw new Error('activity_source_superseded');
        const result = this.options.store.ingest(watchId, raw);
        if (!result.duplicate) {
            if (raw && typeof raw === 'object' && ['progress', 'heartbeat'].includes(String(raw.kind)))
                this.publishProgress(watch.origin.threadId);
            else
                await this.publish({ threadId: watch.origin.threadId, watchId });
        }
        await this.notifyPending();
        return result;
    }
    async reconcileSnapshot(watchId, epoch, sequence, state, historyGap = true, currentSource) {
        const watch = this.options.store.getWatch(watchId);
        if (!watch || watch.origin.profileId !== this.options.profileId || !await this.visible(watch))
            throw new Error('activity_source_forbidden');
        if (currentSource && !currentSource())
            throw new Error('activity_source_superseded');
        this.options.store.reconcileSnapshot(watchId, epoch, sequence, state, historyGap);
        await this.publish({ threadId: watch.origin.threadId, watchId });
    }
    async acceptRetainedPage(watchId, page, currentSource) {
        if (this.disposed)
            throw new Error('activity_service_disposed');
        const watch = this.options.store.getWatch(watchId);
        if (!watch || watch.origin.profileId !== this.options.profileId || !await this.visible(watch))
            throw new Error('activity_source_forbidden');
        if (currentSource && !currentSource())
            throw new Error('activity_source_superseded');
        this.options.store.ingestRetainedPage(watchId, page);
        if (!page.gapRanges.length && page.events.every(event => event && typeof event === 'object' && ['progress', 'heartbeat'].includes(String(event.kind))))
            this.publishProgress(watch.origin.threadId);
        else
            await this.publish({ threadId: watch.origin.threadId, watchId });
        await this.notifyPending();
    }
    async confirmFreshness(watchId) {
        const watch = this.options.store.getWatch(watchId);
        if (!watch || watch.origin.profileId !== this.options.profileId || !await this.visible(watch))
            throw new Error('activity_source_forbidden');
        const previous = this.options.store.getProjection(watchId)?.freshness;
        this.options.store.setFreshness(watchId, 'fresh');
        if (previous !== 'fresh')
            await this.publish({ threadId: watch.origin.threadId, watchId });
    }
    async sourceUnavailable(watchId, freshness, errorCode) {
        if (this.disposed)
            return;
        const watch = this.options.store.getWatch(watchId);
        if (!watch || watch.origin.profileId !== this.options.profileId || watch.status !== 'active')
            return;
        this.thread(watch.origin.threadId);
        this.options.store.setFreshness(watchId, freshness, errorCode);
        await this.publish({ threadId: watch.origin.threadId, watchId });
    }
    async listActivities(threadId, actor, page) {
        this.assertUser(actor);
        this.thread(threadId);
        const rows = [];
        const limit = page?.limit ?? 100;
        let afterLocalSeq = page?.afterLocalSeq ?? 0;
        const permission = new Map();
        const unavailable = new Set();
        for (;;) {
            const batch = this.options.store.listActivities(this.options.profileId, threadId, { afterLocalSeq, limit });
            for (const row of batch) {
                if (!permission.has(row.watchId)) {
                    const watch = this.options.store.getWatch(row.watchId);
                    permission.set(row.watchId, Boolean(watch && await this.visible(watch)));
                }
                if (permission.get(row.watchId))
                    rows.push(row);
                else if (!unavailable.has(row.watchId)) {
                    // A scope-local warning preserves the user's own watch without
                    // exposing source text, outcome, evidence or unread counts.
                    unavailable.add(row.watchId);
                    rows.push({ ...row, activityId: `unavailable:${row.watchId}`, kind: 'diagnostic', projection: { ...row.projection,
                            executionState: 'accepted', businessOutcome: 'unknown', freshness: 'unavailable', summary: undefined,
                            evidenceRefs: [], sourceSequence: 0, lastProgressAt: null, lastHeartbeatAt: null, lastReportAt: null, errorCode: 'activity_source_forbidden' } });
                }
                if (rows.length >= limit)
                    break;
            }
            if (rows.length >= limit || batch.length < limit)
                break;
            afterLocalSeq = batch.at(-1).localSeq;
        }
        this.thread(threadId);
        return rows;
    }
    subscribe(threadId, actor, handler) {
        this.assertUser(actor);
        this.thread(threadId);
        const subscription = { threadId, actor: { ...actor }, handler };
        this.subscribers.add(subscription);
        return () => this.subscribers.delete(subscription);
    }
    subscribeOverview(actor, handler) {
        this.assertUser(actor);
        const subscription = { threadId: null, actor: { ...actor }, handler };
        this.subscribers.add(subscription);
        return () => this.subscribers.delete(subscription);
    }
    async getWork(watchId, actor) {
        this.assertUser(actor);
        const watch = this.options.store.getWatch(watchId);
        if (!watch || watch.origin.profileId !== this.options.profileId)
            throw new Error('activity_watch_forbidden');
        this.thread(watch.origin.threadId);
        const projection = this.options.store.getProjection(watchId);
        if (await this.visible(watch))
            return { watch, projection };
        return { watch, projection: { ...projection, executionState: 'accepted', businessOutcome: 'unknown',
                freshness: 'unavailable', summary: undefined, evidenceRefs: [], lastProgressAt: null, lastHeartbeatAt: null, errorCode: 'activity_source_forbidden' } };
    }
    async markRead(threadId, throughLocalSeq, actor) {
        this.assertUser(actor);
        this.thread(threadId);
        if (throughLocalSeq !== 0) {
            const row = this.options.store.getActivity(this.options.profileId, threadId, throughLocalSeq);
            const watch = row && this.options.store.getWatch(row.watchId);
            if (!watch || !await this.visible(watch))
                throw new Error('activity_read_cursor_forbidden');
        }
        if (this.options.store.markRead(this.options.profileId, threadId, throughLocalSeq))
            void this.publish({ threadId });
    }
    async unreadThreads(actor) {
        this.assertUser(actor);
        const counts = new Map();
        for (const row of this.options.store.unreadByWatch(this.options.profileId)) {
            try {
                const watch = this.options.store.getWatch(row.watchId);
                if (watch && await this.visible(watch))
                    counts.set(row.threadId, (counts.get(row.threadId) ?? 0) + row.count);
            }
            catch { /* Revoked/deleted scopes have no visible unread metadata. */ }
        }
        return [...counts].map(([threadId, count]) => ({ threadId, count }));
    }
    async publish(change) {
        const pending = this.pendingChanges.get(change.threadId);
        if (pending) {
            clearTimeout(pending);
            this.pendingChanges.delete(change.threadId);
        }
        // Notifications contain only routing IDs; content is read through fresh authorization.
        for (const subscription of [...this.subscribers])
            if (subscription.threadId === null || subscription.threadId === change.threadId) {
                try {
                    this.assertUser(subscription.actor);
                    this.thread(change.threadId);
                    subscription.handler(change);
                }
                catch (error) {
                    this.options.onError?.(error);
                }
            }
    }
    publishProgress(threadId) {
        if (this.disposed || this.pendingChanges.has(threadId))
            return;
        const timer = setTimeout(() => {
            this.pendingChanges.delete(threadId);
            if (!this.disposed)
                void this.publish({ threadId }).catch(error => this.options.onError?.(error));
        }, 1000);
        timer.unref?.();
        this.pendingChanges.set(threadId, timer);
    }
    async updateReporting(watchId, preference, expectedPolicyRevision, actor) {
        this.assertUser(actor);
        const watch = this.options.store.getWatch(watchId);
        if (!watch || watch.origin.profileId !== this.options.profileId)
            throw new Error('activity_watch_forbidden');
        this.thread(watch.origin.threadId);
        const updated = this.options.store.updateReporting(this.options.profileId, watchId, preference, expectedPolicyRevision);
        await this.publish({ threadId: updated.origin.threadId, watchId });
        return updated;
    }
    async stopWatch(watchId, expectedPolicyRevision, actor) {
        this.assertUser(actor);
        const watch = this.options.store.getWatch(watchId);
        if (!watch || watch.origin.profileId !== this.options.profileId)
            throw new Error('activity_watch_forbidden');
        this.thread(watch.origin.threadId);
        const updated = this.options.store.stopWatch(this.options.profileId, watchId, expectedPolicyRevision);
        await this.publish({ threadId: updated.origin.threadId, watchId });
        return updated;
    }
    /** Called from the existing shared thread deletion CAS/fanout, not from a new IPC. */
    handleThreadDeletion(threadId, operationId) {
        const thread = this.options.getThread(threadId);
        if (!thread || thread.profileId !== this.options.profileId || thread.deleteState === 'none')
            throw new Error('activity_deletion_not_admitted');
        this.options.store.deleteThread(this.options.profileId, threadId, operationId);
    }
    reportDue() {
        if (this.disposed)
            return Promise.resolve();
        if (this.reporting)
            return this.reporting;
        const pending = this.generateReports().finally(() => { if (this.reporting === pending)
            this.reporting = undefined; });
        this.reporting = pending;
        return pending;
    }
    async generateReports() {
        const authorized = new Set();
        for (const watch of this.options.store.dueWatches()) {
            try {
                if (await this.visible(watch))
                    authorized.add(watch.watchId);
            }
            catch (error) {
                this.options.onError?.(error);
            }
        }
        if (this.disposed)
            return;
        for (const watchId of [...authorized]) {
            try {
                this.thread(this.options.store.getWatch(watchId).origin.threadId);
            }
            catch {
                authorized.delete(watchId);
            }
        }
        for (const watchId of this.options.store.reportDue(authorized)) {
            const watch = this.options.store.getWatch(watchId);
            await this.publish({ threadId: watch.origin.threadId, watchId });
        }
    }
    notifyPending() {
        if (this.disposed || !this.options.notify)
            return Promise.resolve();
        if (this.notifying)
            return this.notifying;
        const pending = this.deliverNotifications().finally(() => { if (this.notifying === pending)
            this.notifying = undefined; });
        this.notifying = pending;
        return pending;
    }
    async deliverNotifications() {
        while (!this.disposed) {
            const rows = this.options.store.pendingNotifications();
            if (!rows.length)
                return;
            for (const activity of rows) {
                let status = 'suppressed';
                const watch = this.options.store.getWatch(activity.watchId);
                let visible = false;
                try {
                    visible = Boolean(watch && watch.status === 'active' && watch.preference !== 'quiet' && await this.visible(watch));
                }
                catch (error) {
                    this.options.onError?.(error);
                }
                if (this.disposed)
                    return;
                // Commit the attempt before calling the OS. A crash leaves 'unknown';
                // recovery keeps the unread card and does not blindly ring again.
                if (!this.options.store.claimNotification(activity.activityId))
                    continue;
                const current = this.options.store.getWatch(activity.watchId);
                if (visible && current?.status === 'active' && current.preference !== 'quiet' && current.generation === watch?.generation) {
                    try {
                        status = await this.options.notify(activity, current);
                    }
                    catch (error) {
                        status = 'failed';
                        this.options.onError?.(error);
                    }
                }
                if (this.disposed)
                    return;
                this.options.store.finishNotification(activity.activityId, status);
            }
        }
    }
    start() {
        if (this.timer || this.disposed)
            return;
        this.timer = setInterval(() => {
            if (++this.retentionTicks >= 1800) {
                this.retentionTicks = 0;
                try {
                    this.options.store.pruneRetention();
                }
                catch (error) {
                    this.options.onError?.(error);
                }
            }
            void this.reportDue().catch(error => this.options.onError?.(error));
            void this.notifyPending().catch(error => this.options.onError?.(error));
        }, 1000);
        this.timer.unref?.();
    }
    dispose() {
        this.disposed = true;
        if (this.timer)
            clearInterval(this.timer);
        this.timer = undefined;
        this.subscribers.clear();
        for (const timer of this.pendingChanges.values())
            clearTimeout(timer);
        this.pendingChanges.clear();
    }
}
