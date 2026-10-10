import type { ConversationActivityApi, ActivityActor, ActivityChange } from './service.js';
import { ConversationActivityOwnerClient } from './owner-client.js';
import type { WorkBinding, WorkWatch, ConversationActivity, ReportingPreference } from './types.js';
import type { SerializedTaskReference } from '@modelcontextprotocol/ext-tasks/client';

/** Same semantics through the single writer. Renderer/model payloads cannot
 * choose a daemon actor or invoke producer methods through user IPC. */
export class ConversationActivityAttachedService implements ConversationActivityApi {
  private disposed = false;
  private readonly subscriptions = new Set<() => void>();
  constructor(readonly client: ConversationActivityOwnerClient, private readonly actorId: string) {}
  private actor(actor: ActivityActor): void { if (this.disposed || actor.requestSource !== 'user' || actor.actorId !== this.actorId) throw new Error('activity_actor_forbidden'); }
  prepareAssociation(input: { threadId: string; operationId: string; creationIdempotencyKey: string }, actor: ActivityActor): Promise<void> { this.actor(actor); return this.client.request('prepare', input); }
  bindWork(binding: WorkBinding, reference?: SerializedTaskReference): Promise<WorkWatch> { return this.client.request('bind', { ...binding, ...(reference ? { mcpReference: reference } : {}) }); }
  forgetUnboundAssociation(operationId: string): void { void this.client.request('forgetAssociation', { operationId }).catch(() => {}); }
  canReadSource(watchId: string): Promise<boolean> { return this.client.request('canReadSource', { watchId }); }
  acceptEvent(watchId: string, event: unknown, currentSource?: () => boolean): Promise<{ acknowledge: boolean; duplicate?: boolean; quarantined?: boolean }> {
    if (currentSource && !currentSource()) return Promise.reject(new Error('activity_source_superseded'));
    return this.client.request('ingest', { watchId, event });
  }
  acceptRetainedPage(watchId: string, page: Parameters<ConversationActivityApi['acceptRetainedPage']>[1]): Promise<void> { return this.client.request('retainedPage', { watchId, page }); }
  reconcileSnapshot(watchId: string, epoch: string, sequence: number, state: Parameters<ConversationActivityApi['reconcileSnapshot']>[3], historyGap = true): Promise<void> { return this.client.request('reconcile', { watchId, epoch, sequence, state, historyGap }); }
  confirmFreshness(watchId: string): Promise<void> { return this.client.request('freshness', { watchId }); }
  sourceUnavailable(watchId: string, freshness: 'reconnecting' | 'unavailable', errorCode: string): Promise<void> { return this.client.request('unavailable', { watchId, freshness, errorCode }); }
  listActivities(threadId: string, actor: ActivityActor, page?: { afterLocalSeq?: number; limit?: number }): Promise<ConversationActivity[]> { this.actor(actor); return this.client.request('list', { threadId, ...page }); }
  async subscribe(threadId: string, actor: ActivityActor, handler: (change: ActivityChange) => void): Promise<() => void> {
    this.actor(actor); const stop = await this.client.subscribe(threadId, handler);
    if (this.disposed) { stop(); throw new Error('activity_service_disposed'); }
    const cleanup = () => { stop(); this.subscriptions.delete(cleanup); }; this.subscriptions.add(cleanup); return cleanup;
  }
  async subscribeOverview(actor: ActivityActor, handler: (change: ActivityChange) => void): Promise<() => void> {
    this.actor(actor); const stop = await this.client.subscribeOverview(handler);
    if (this.disposed) { stop(); throw new Error('activity_service_disposed'); }
    const cleanup = () => { stop(); this.subscriptions.delete(cleanup); }; this.subscriptions.add(cleanup); return cleanup;
  }
  getWork(watchId: string, actor: ActivityActor): ReturnType<ConversationActivityApi['getWork']> { this.actor(actor); return this.client.request('work', { watchId }); }
  markRead(threadId: string, through: number, actor: ActivityActor): Promise<void> { this.actor(actor); return this.client.request('read', { threadId, through }); }
  unreadThreads(actor: ActivityActor): Promise<Array<{ threadId: string; count: number }>> { this.actor(actor); return this.client.request('unread'); }
  updateReporting(watchId: string, preference: ReportingPreference, revision: number, actor: ActivityActor): Promise<WorkWatch> { this.actor(actor); return this.client.request('reporting', { watchId, preference, revision }); }
  stopWatch(watchId: string, revision: number, actor: ActivityActor): Promise<WorkWatch> { this.actor(actor); return this.client.request('stop', { watchId, revision }); }
  handleThreadDeletion(threadId: string, operationId: string): void { void this.client.request('deleted', { threadId, operationId }).catch(() => {}); }
  start(): void {}
  dispose(): void { this.disposed = true; for (const stop of this.subscriptions) stop(); this.subscriptions.clear(); this.client.dispose(); }
}
