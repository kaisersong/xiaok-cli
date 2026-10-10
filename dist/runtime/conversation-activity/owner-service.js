/** Same semantics through the single writer. Renderer/model payloads cannot
 * choose a daemon actor or invoke producer methods through user IPC. */
export class ConversationActivityAttachedService {
    client;
    actorId;
    disposed = false;
    subscriptions = new Set();
    constructor(client, actorId) {
        this.client = client;
        this.actorId = actorId;
    }
    actor(actor) { if (this.disposed || actor.requestSource !== 'user' || actor.actorId !== this.actorId)
        throw new Error('activity_actor_forbidden'); }
    prepareAssociation(input, actor) { this.actor(actor); return this.client.request('prepare', input); }
    bindWork(binding, reference) { return this.client.request('bind', { ...binding, ...(reference ? { mcpReference: reference } : {}) }); }
    forgetUnboundAssociation(operationId) { void this.client.request('forgetAssociation', { operationId }).catch(() => { }); }
    canReadSource(watchId) { return this.client.request('canReadSource', { watchId }); }
    acceptEvent(watchId, event, currentSource) {
        if (currentSource && !currentSource())
            return Promise.reject(new Error('activity_source_superseded'));
        return this.client.request('ingest', { watchId, event });
    }
    acceptRetainedPage(watchId, page) { return this.client.request('retainedPage', { watchId, page }); }
    reconcileSnapshot(watchId, epoch, sequence, state, historyGap = true) { return this.client.request('reconcile', { watchId, epoch, sequence, state, historyGap }); }
    confirmFreshness(watchId) { return this.client.request('freshness', { watchId }); }
    sourceUnavailable(watchId, freshness, errorCode) { return this.client.request('unavailable', { watchId, freshness, errorCode }); }
    listActivities(threadId, actor, page) { this.actor(actor); return this.client.request('list', { threadId, ...page }); }
    async subscribe(threadId, actor, handler) {
        this.actor(actor);
        const stop = await this.client.subscribe(threadId, handler);
        if (this.disposed) {
            stop();
            throw new Error('activity_service_disposed');
        }
        const cleanup = () => { stop(); this.subscriptions.delete(cleanup); };
        this.subscriptions.add(cleanup);
        return cleanup;
    }
    async subscribeOverview(actor, handler) {
        this.actor(actor);
        const stop = await this.client.subscribeOverview(handler);
        if (this.disposed) {
            stop();
            throw new Error('activity_service_disposed');
        }
        const cleanup = () => { stop(); this.subscriptions.delete(cleanup); };
        this.subscriptions.add(cleanup);
        return cleanup;
    }
    getWork(watchId, actor) { this.actor(actor); return this.client.request('work', { watchId }); }
    markRead(threadId, through, actor) { this.actor(actor); return this.client.request('read', { threadId, through }); }
    unreadThreads(actor) { this.actor(actor); return this.client.request('unread'); }
    updateReporting(watchId, preference, revision, actor) { this.actor(actor); return this.client.request('reporting', { watchId, preference, revision }); }
    stopWatch(watchId, revision, actor) { this.actor(actor); return this.client.request('stop', { watchId, revision }); }
    handleThreadDeletion(threadId, operationId) { void this.client.request('deleted', { threadId, operationId }).catch(() => { }); }
    start() { }
    dispose() { this.disposed = true; for (const stop of this.subscriptions)
        stop(); this.subscriptions.clear(); this.client.dispose(); }
}
