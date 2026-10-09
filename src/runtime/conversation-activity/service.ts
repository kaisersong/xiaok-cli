import type { ConversationActivityStore } from './store.js';
import type { ActivityOrigin, ConversationActivity, ReportingPreference, WorkBinding, WorkWatch } from './types.js';
import type { SerializedTaskReference } from '@modelcontextprotocol/ext-tasks/client';

export interface ActivityActor { requestSource: 'user' | 'agent' | 'scheduler'; actorId: string }
export interface ActivityThreadIdentity {
  profileId: string; threadId: string; workspaceId: string;
  deleteState: 'none' | 'delete_pending' | 'deleted';
}
export interface ActivityChange { threadId: string; watchId?: string }

/** Owned by the host, with actor and thread identity supplied by main's registry. */
export class ConversationActivityService {
  private readonly subscribers = new Set<{ threadId: string | null; actor: ActivityActor; handler: (change: ActivityChange) => void }>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;
  private reporting: Promise<void> | undefined;
  private notifying: Promise<void> | undefined;
  private retentionTicks = 0;
  private readonly pendingChanges = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly options: {
    store: ConversationActivityStore; profileId: string; actorId: string;
    getThread(threadId: string): ActivityThreadIdentity | null;
    canObserveWork(watch: WorkWatch): Promise<boolean> | boolean;
    notify?(activity: ConversationActivity, watch: WorkWatch): Promise<'shown' | 'suppressed' | 'failed'>;
    onError?(error: unknown): void;
  }) {}

  private assertUser(actor: ActivityActor): void {
    if (this.disposed) throw new Error('activity_service_disposed');
    if (actor?.requestSource !== 'user' || actor.actorId !== this.options.actorId) throw new Error('activity_actor_forbidden');
  }

  private thread(threadId: string): ActivityThreadIdentity {
    const thread = this.options.getThread(threadId);
    if (!thread || thread.profileId !== this.options.profileId) throw new Error('activity_thread_forbidden');
    if (thread.deleteState !== 'none') throw new Error('activity_thread_deleted');
    return thread;
  }

  private async visible(watch: WorkWatch): Promise<boolean> {
    const thread = this.thread(watch.origin.threadId);
    if (thread.workspaceId !== watch.origin.workspaceId) throw new Error('activity_thread_forbidden');
    const allowed = await this.options.canObserveWork(watch);
    // Recheck the local admission fence after suspended authorization IO.
    if (this.thread(watch.origin.threadId).workspaceId !== watch.origin.workspaceId) throw new Error('activity_thread_forbidden');
    return allowed;
  }

  async prepareAssociation(input: { threadId: string; operationId: string; creationIdempotencyKey: string }, actor: ActivityActor): Promise<void> {
    this.assertUser(actor);
    const thread = this.thread(input.threadId);
    const origin: ActivityOrigin = { profileId: thread.profileId, threadId: thread.threadId, workspaceId: thread.workspaceId, actorId: actor.actorId };
    this.options.store.prepareAssociation({ operationId: input.operationId, creationIdempotencyKey: input.creationIdempotencyKey, origin });
  }

  /** Main-only source receipt binding; never registered as a model/renderer mutation. */
  async bindWork(binding: WorkBinding, mcpReference?: SerializedTaskReference): Promise<WorkWatch> {
    if (this.disposed) throw new Error('activity_service_disposed');
    const association = this.options.store.getAssociation(binding.operationId);
    if (!association || association.origin.profileId !== this.options.profileId) throw new Error('activity_association_missing');
    const thread = this.thread(association.origin.threadId);
    if (thread.workspaceId !== association.origin.workspaceId) throw new Error('activity_thread_forbidden');
    const watch = this.options.store.bindWork(binding, mcpReference);
    await this.publish({ threadId: watch.origin.threadId, watchId: watch.watchId });
    return watch;
  }
  forgetUnboundAssociation(operationId: string): void { if (this.disposed) throw new Error('activity_service_disposed'); this.options.store.forgetUnboundAssociation(operationId); }

  async canReadSource(watchId: string): Promise<boolean> {
    if (this.disposed) return false;
    const watch = this.options.store.getWatch(watchId);
    if (!watch || watch.status !== 'active' || watch.origin.profileId !== this.options.profileId) return false;
    return this.visible(watch);
  }

  /** Source adapter entry only. Event payloads cannot choose a conversation. */
  async acceptEvent(watchId: string, raw: unknown, currentSource?: () => boolean): Promise<{ acknowledge: boolean; duplicate?: boolean; quarantined?: boolean }> {
    if (this.disposed) throw new Error('activity_service_disposed');
    const watch = this.options.store.getWatch(watchId);
    if (!watch || watch.origin.profileId !== this.options.profileId) throw new Error('activity_watch_forbidden');
    if (!await this.visible(watch)) throw new Error('activity_source_forbidden');
    if (currentSource && !currentSource()) throw new Error('activity_source_superseded');
    const result = this.options.store.ingest(watchId, raw);
    if (!result.duplicate) {
      if (raw && typeof raw === 'object' && ['progress','heartbeat'].includes(String((raw as { kind?: unknown }).kind))) this.publishProgress(watch.origin.threadId);
      else await this.publish({ threadId: watch.origin.threadId, watchId });
    }
    await this.notifyPending();
    return result;
  }

  async reconcileSnapshot(watchId: string, epoch: string, sequence: number, state: Parameters<ConversationActivityStore['reconcileSnapshot']>[3], historyGap = true, currentSource?: () => boolean): Promise<void> {
    const watch = this.options.store.getWatch(watchId);
    if (!watch || watch.origin.profileId !== this.options.profileId || !await this.visible(watch)) throw new Error('activity_source_forbidden');
    if (currentSource && !currentSource()) throw new Error('activity_source_superseded');
    this.options.store.reconcileSnapshot(watchId, epoch, sequence, state, historyGap);
    await this.publish({ threadId: watch.origin.threadId, watchId });
  }

  async acceptRetainedPage(watchId: string, page: Parameters<ConversationActivityStore['ingestRetainedPage']>[1], currentSource?: () => boolean): Promise<void> {
    if (this.disposed) throw new Error('activity_service_disposed');
    const watch = this.options.store.getWatch(watchId);
    if (!watch || watch.origin.profileId !== this.options.profileId || !await this.visible(watch)) throw new Error('activity_source_forbidden');
    if (currentSource && !currentSource()) throw new Error('activity_source_superseded');
    this.options.store.ingestRetainedPage(watchId, page);
    if (!page.gapRanges.length && page.events.every(event => event && typeof event === 'object' && ['progress','heartbeat'].includes(String((event as { kind?: unknown }).kind)))) this.publishProgress(watch.origin.threadId);
    else await this.publish({ threadId: watch.origin.threadId, watchId });
    await this.notifyPending();
  }

  async confirmFreshness(watchId: string): Promise<void> {
    const watch = this.options.store.getWatch(watchId);
    if (!watch || watch.origin.profileId !== this.options.profileId || !await this.visible(watch)) throw new Error('activity_source_forbidden');
    const previous = this.options.store.getProjection(watchId)?.freshness;
    this.options.store.setFreshness(watchId, 'fresh');
    if (previous !== 'fresh') await this.publish({ threadId: watch.origin.threadId, watchId });
  }

  async sourceUnavailable(watchId: string, freshness: 'reconnecting' | 'unavailable', errorCode: string): Promise<void> {
    if (this.disposed) return;
    const watch = this.options.store.getWatch(watchId);
    if (!watch || watch.origin.profileId !== this.options.profileId || watch.status !== 'active') return;
    this.thread(watch.origin.threadId);
    this.options.store.setFreshness(watchId, freshness, errorCode);
    await this.publish({ threadId: watch.origin.threadId, watchId });
  }

  async listActivities(threadId: string, actor: ActivityActor, page?: { afterLocalSeq?: number; limit?: number }): Promise<ConversationActivity[]> {
    this.assertUser(actor); this.thread(threadId);
    const rows: ConversationActivity[] = [];
    const limit = page?.limit ?? 100;
    let afterLocalSeq = page?.afterLocalSeq ?? 0;
    const permission = new Map<string, boolean>();
    const unavailable = new Set<string>();
    for (;;) {
      const batch = this.options.store.listActivities(this.options.profileId, threadId, { afterLocalSeq, limit });
      for (const row of batch) {
        if (!permission.has(row.watchId)) {
          const watch = this.options.store.getWatch(row.watchId);
          permission.set(row.watchId, Boolean(watch && await this.visible(watch)));
        }
        if (permission.get(row.watchId)) rows.push(row);
        else if (!unavailable.has(row.watchId)) {
          // A scope-local warning preserves the user's own watch without
          // exposing source text, outcome, evidence or unread counts.
          unavailable.add(row.watchId);
          rows.push({ ...row, activityId: `unavailable:${row.watchId}`, kind: 'diagnostic', projection: { ...row.projection,
            executionState: 'accepted', businessOutcome: 'unknown', freshness: 'unavailable', summary: undefined,
            evidenceRefs: [], sourceSequence: 0, lastProgressAt: null, lastHeartbeatAt: null, lastReportAt: null, errorCode: 'activity_source_forbidden' } });
        }
        if (rows.length >= limit) break;
      }
      if (rows.length >= limit || batch.length < limit) break;
      afterLocalSeq = batch.at(-1)!.localSeq;
    }
    this.thread(threadId);
    return rows;
  }

  subscribe(threadId: string, actor: ActivityActor, handler: (change: ActivityChange) => void): () => void {
    this.assertUser(actor); this.thread(threadId);
    const subscription = { threadId, actor: { ...actor }, handler };
    this.subscribers.add(subscription);
    return () => this.subscribers.delete(subscription);
  }

  subscribeOverview(actor: ActivityActor, handler: (change: ActivityChange) => void): () => void {
    this.assertUser(actor);
    const subscription = { threadId: null, actor: { ...actor }, handler };
    this.subscribers.add(subscription); return () => this.subscribers.delete(subscription);
  }

  async getWork(watchId: string, actor: ActivityActor) {
    this.assertUser(actor);
    const watch = this.options.store.getWatch(watchId);
    if (!watch || watch.origin.profileId !== this.options.profileId) throw new Error('activity_watch_forbidden');
    this.thread(watch.origin.threadId);
    const projection = this.options.store.getProjection(watchId)!;
    if (await this.visible(watch)) return { watch, projection };
    return { watch, projection: { ...projection, executionState: 'accepted' as const, businessOutcome: 'unknown' as const,
      freshness: 'unavailable' as const, summary: undefined, evidenceRefs: [], lastProgressAt: null, lastHeartbeatAt: null, errorCode: 'activity_source_forbidden' } };
  }

  async markRead(threadId: string, throughLocalSeq: number, actor: ActivityActor): Promise<void> {
    this.assertUser(actor); this.thread(threadId);
    if (throughLocalSeq !== 0) {
      const row = this.options.store.getActivity(this.options.profileId, threadId, throughLocalSeq);
      const watch = row && this.options.store.getWatch(row.watchId);
      if (!watch || !await this.visible(watch)) throw new Error('activity_read_cursor_forbidden');
    }
    if (this.options.store.markRead(this.options.profileId, threadId, throughLocalSeq)) void this.publish({ threadId });
  }

  async unreadThreads(actor: ActivityActor): Promise<Array<{ threadId: string; count: number }>> {
    this.assertUser(actor);
    const counts = new Map<string, number>();
    for (const row of this.options.store.unreadByWatch(this.options.profileId)) {
      try {
        const watch = this.options.store.getWatch(row.watchId);
        if (watch && await this.visible(watch)) counts.set(row.threadId, (counts.get(row.threadId) ?? 0) + row.count);
      } catch { /* Revoked/deleted scopes have no visible unread metadata. */ }
    }
    return [...counts].map(([threadId, count]) => ({ threadId, count }));
  }

  private async publish(change: ActivityChange): Promise<void> {
    const pending = this.pendingChanges.get(change.threadId);
    if (pending) { clearTimeout(pending); this.pendingChanges.delete(change.threadId); }
    // Notifications contain only routing IDs; content is read through fresh authorization.
    for (const subscription of [...this.subscribers]) if (subscription.threadId === null || subscription.threadId === change.threadId) {
      try {
        this.assertUser(subscription.actor); this.thread(change.threadId);
        subscription.handler(change);
      } catch (error) { this.options.onError?.(error); }
    }
  }

  private publishProgress(threadId: string): void {
    if (this.disposed || this.pendingChanges.has(threadId)) return;
    const timer = setTimeout(() => {
      this.pendingChanges.delete(threadId);
      if (!this.disposed) void this.publish({ threadId }).catch(error => this.options.onError?.(error));
    }, 1000);
    timer.unref?.(); this.pendingChanges.set(threadId, timer);
  }

  async updateReporting(watchId: string, preference: ReportingPreference, expectedPolicyRevision: number, actor: ActivityActor): Promise<WorkWatch> {
    this.assertUser(actor);
    const watch = this.options.store.getWatch(watchId);
    if (!watch || watch.origin.profileId !== this.options.profileId) throw new Error('activity_watch_forbidden');
    this.thread(watch.origin.threadId);
    const updated = this.options.store.updateReporting(this.options.profileId, watchId, preference, expectedPolicyRevision);
    await this.publish({ threadId: updated.origin.threadId, watchId }); return updated;
  }

  async stopWatch(watchId: string, expectedPolicyRevision: number, actor: ActivityActor): Promise<WorkWatch> {
    this.assertUser(actor);
    const watch = this.options.store.getWatch(watchId);
    if (!watch || watch.origin.profileId !== this.options.profileId) throw new Error('activity_watch_forbidden');
    this.thread(watch.origin.threadId);
    const updated = this.options.store.stopWatch(this.options.profileId, watchId, expectedPolicyRevision);
    await this.publish({ threadId: updated.origin.threadId, watchId }); return updated;
  }

  /** Called from the existing shared thread deletion CAS/fanout, not from a new IPC. */
  handleThreadDeletion(threadId: string, operationId: string): void {
    const thread = this.options.getThread(threadId);
    if (!thread || thread.profileId !== this.options.profileId || thread.deleteState === 'none') throw new Error('activity_deletion_not_admitted');
    this.options.store.deleteThread(this.options.profileId, threadId, operationId);
  }

  reportDue(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.reporting) return this.reporting;
    const pending = this.generateReports().finally(() => { if (this.reporting === pending) this.reporting = undefined; });
    this.reporting = pending; return pending;
  }

  private async generateReports(): Promise<void> {
    const authorized = new Set<string>();
    for (const watch of this.options.store.dueWatches()) {
      try { if (await this.visible(watch)) authorized.add(watch.watchId); }
      catch (error) { this.options.onError?.(error); }
    }
    if (this.disposed) return;
    for (const watchId of [...authorized]) {
      try { this.thread(this.options.store.getWatch(watchId)!.origin.threadId); }
      catch { authorized.delete(watchId); }
    }
    for (const watchId of this.options.store.reportDue(authorized)) {
      const watch = this.options.store.getWatch(watchId)!;
      await this.publish({ threadId: watch.origin.threadId, watchId });
    }
  }

  notifyPending(): Promise<void> {
    if (this.disposed || !this.options.notify) return Promise.resolve();
    if (this.notifying) return this.notifying;
    const pending = this.deliverNotifications().finally(() => { if (this.notifying === pending) this.notifying = undefined; });
    this.notifying = pending; return pending;
  }

  private async deliverNotifications(): Promise<void> {
    while (!this.disposed) {
      const rows = this.options.store.pendingNotifications();
      if (!rows.length) return;
      for (const activity of rows) {
        let status: 'shown' | 'suppressed' | 'failed' = 'suppressed';
        const watch = this.options.store.getWatch(activity.watchId);
        let visible = false;
        try { visible = Boolean(watch && watch.status === 'active' && watch.preference !== 'quiet' && await this.visible(watch)); }
        catch (error) { this.options.onError?.(error); }
        if (this.disposed) return;
        // Commit the attempt before calling the OS. A crash leaves 'unknown';
        // recovery keeps the unread card and does not blindly ring again.
        if (!this.options.store.claimNotification(activity.activityId)) continue;
        const current = this.options.store.getWatch(activity.watchId);
        if (visible && current?.status === 'active' && current.preference !== 'quiet' && current.generation === watch?.generation) {
          try { status = await this.options.notify!(activity, current); }
          catch (error) { status = 'failed'; this.options.onError?.(error); }
        }
        if (this.disposed) return;
        this.options.store.finishNotification(activity.activityId, status);
      }
    }
  }

  start(): void {
    if (this.timer || this.disposed) return;
    this.timer = setInterval(() => {
      if (++this.retentionTicks >= 1800) {
        this.retentionTicks = 0;
        try { this.options.store.pruneRetention(); } catch (error) { this.options.onError?.(error); }
      }
      void this.reportDue().catch(error => this.options.onError?.(error));
      void this.notifyPending().catch(error => this.options.onError?.(error));
    }, 1000);
    this.timer.unref?.();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined; this.subscribers.clear();
    for (const timer of this.pendingChanges.values()) clearTimeout(timer);
    this.pendingChanges.clear();
  }
}
export type ConversationActivityApi = Pick<ConversationActivityService, 'prepareAssociation' | 'bindWork' | 'forgetUnboundAssociation' |
  'canReadSource' | 'acceptEvent' | 'acceptRetainedPage' | 'reconcileSnapshot' | 'confirmFreshness' | 'sourceUnavailable' |
  'listActivities' | 'getWork' | 'markRead' | 'unreadThreads' | 'updateReporting' | 'stopWatch' |
  'handleThreadDeletion' | 'start' | 'dispose'> & {
    subscribe(...args: Parameters<ConversationActivityService['subscribe']>): (() => void) | Promise<() => void>;
    subscribeOverview(...args: Parameters<ConversationActivityService['subscribeOverview']>): (() => void) | Promise<() => void>;
  };
