import type { TaskEventRecord, TaskRuntimeHost } from '../task-host/types.js';
import type { ConversationActivityApi } from './service.js';
import type { ConversationActivityStore } from './store.js';
import type { WorkEvent, WorkKind, WorkWatch } from './types.js';
import type { AgentActivityMember, AgentActivityRun } from './agent-runs.js';

export interface ProjectActivityPage {
  ok: boolean; sourceDataEpoch: string; headSeq: number; nextCursor: number; gap: boolean;
  coveredThrough?: number;
  gapRanges?: Array<{ from: number; through: number; reason: string }>;
  snapshot: { status: string; deliveredAt?: number | null; tasks?: Array<{ status: string }> };
  events: Array<Omit<WorkEvent, 'logicalSourceId' | 'transportGeneration' | 'receivedAt'>>;
}

/** One query owner per resource, independent of windows or visible conversations. */
export class ConversationActivitySources {
  private readonly controllers = new Map<string, AbortController>();
  private readonly projectReads = new Map<string, Promise<void>>();
  private readonly projectPending = new Set<string>();
  private readonly groupReads = new Map<string, Promise<void>>();
  private readonly groupPending = new Set<string>();
  private readonly taskRetries = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly taskAttempts = new Map<string, number>();
  private projectConnected = false;
  private projectFallback: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private readonly options: {
    store: ConversationActivityStore; service: ConversationActivityApi;
    taskHost(taskId: string): TaskRuntimeHost;
    readProject(projectId: string, after: number, signal: AbortSignal): Promise<ProjectActivityPage>;
    readGroup?(groupId: string, after: number): Array<{ eventId: string; seq: number; timestamp: number; kind: string; agentId?: string; turnId?: string; payload: Record<string, unknown> }>;
    groupMembers?(runId: string): AgentActivityMember[];
    onError?(error: unknown): void;
  }) {}

  async startWatch(watchId: string): Promise<void> {
    const watch = this.options.store.getWatch(watchId);
    if (!watch || watch.status !== 'active' || this.disposed) return;
    if (watch.source === 'kswarm') { this.scheduleProjectFallback(); return this.refreshProject(watch.workId); }
    if (watch.source === 'agent_group') return this.refreshGroup(watch.workId);
    if (watch.source !== 'task_host' || this.controllers.has(watchId)) return;
    const priorRetry = this.taskRetries.get(watchId);
    if (priorRetry) clearTimeout(priorRetry);
    this.taskRetries.delete(watchId);
    const controller = new AbortController(); this.controllers.set(watchId, controller);
    let retry = true;
    void Promise.resolve().then(async () => {
      const host = this.options.taskHost(watch.workId);
      if (!host.subscribeTaskRecords) { retry = false; throw new Error('activity_source_unsupported'); }
      await this.readTask(watch, host, controller);
    }).catch(async error => {
      if (!controller.signal.aborted && !this.disposed) {
        try { await this.options.service.sourceUnavailable(watchId, 'unavailable', 'activity_source_unavailable'); }
        catch (deliveryError) { this.options.onError?.(deliveryError); }
        this.options.onError?.(error);
      }
    }).finally(() => {
      if (this.controllers.get(watchId) === controller) this.controllers.delete(watchId);
      if (retry && !controller.signal.aborted && !this.disposed) this.scheduleTaskRetry(watch);
    }).catch(error => this.options.onError?.(error));
  }

  private async readTask(watch: WorkWatch, host: TaskRuntimeHost, controller: AbortController): Promise<void> {
    if (!await this.options.service.canReadSource(watch.watchId)) throw new Error('activity_source_forbidden');
    const sinceIndex = this.options.store.getProjection(watch.watchId)?.sourceSequence ?? 0;
    for await (const record of host.subscribeTaskRecords!(watch.workId, { sinceIndex, signal: controller.signal })) {
      if (this.disposed || controller.signal.aborted) return;
      const current = this.options.store.getWatch(watch.watchId);
      if (!current || current.status !== 'active' || current.generation !== watch.generation) return;
      await this.options.service.acceptEvent(watch.watchId, this.taskEvent(watch, record));
      this.taskAttempts.delete(watch.watchId);
      await this.options.service.confirmFreshness(watch.watchId);
    }
  }

  private taskEvent(watch: WorkWatch, record: TaskEventRecord): WorkEvent {
    const event = record.event;
    let kind: WorkKind = 'heartbeat', summary: string | undefined;
    let evidenceRefs: string[] = [];
    switch (event.type) {
      case 'task_started': kind = 'accepted'; break;
      case 'task_execution_started': kind = 'started'; break;
      case 'task_terminal': kind = event.status === 'failed' ? 'failed' : event.status === 'cancelled' ? 'cancelled' : 'completed'; break;
      case 'task_cancelled': kind = 'cancelled'; break;
      case 'needs_user': kind = 'input_required'; break;
      case 'error': kind = 'blocked'; summary = event.message; break;
      case 'artifact_recorded': kind = 'artifact_available'; evidenceRefs = [event.artifactId]; break;
      case 'progress': kind = 'progress'; summary = event.message; break;
      case 'assistant_delta': kind = 'progress'; break;
      case 'result': kind = 'artifact_available'; summary = event.result.summary; evidenceRefs = event.result.artifacts.map(artifact => artifact.artifactId); break;
    }
    return { schemaVersion: 1, eventId: `${record.taskId}#${record.eventIndex}`, source: 'task_host',
      logicalSourceId: watch.logicalSourceId, sourceDataEpoch: record.sourceDataEpoch,
      workId: watch.workId, runId: watch.runId, sourceSequence: record.eventIndex + 1,
      transportGeneration: watch.generation, kind, summary: summary?.slice(0, 1024), evidenceRefs,
      receivedAt: Date.now() };
  }

  refreshProject(projectId: string, sourceChanged = false): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const existing = this.projectReads.get(projectId);
    if (existing) {
      if (sourceChanged) this.projectPending.add(projectId);
      return existing;
    }
    this.projectPending.add(projectId);
    const promise = this.drainProject(projectId).catch(async error => {
      if (!this.disposed) {
        for (const watch of this.projectWatches(projectId)) {
          try { await this.options.service.sourceUnavailable(watch.watchId, 'unavailable', 'activity_source_unavailable'); }
          catch (deliveryError) { this.options.onError?.(deliveryError); }
        }
        this.options.onError?.(error);
      }
    }).finally(() => { if (this.projectReads.get(projectId) === promise) this.projectReads.delete(projectId); });
    this.projectReads.set(projectId, promise); return promise;
  }

  private projectWatches(projectId: string): WorkWatch[] {
    return this.options.store.listWatches().filter(watch => watch.source === 'kswarm' && watch.workId === projectId && watch.status === 'active');
  }

  async projectConnectionChanged(status: 'connected' | 'disconnected' | 'reconnecting'): Promise<void> {
    if (this.disposed) return;
    this.projectConnected = status === 'connected';
    if (this.projectFallback) clearTimeout(this.projectFallback);
    this.projectFallback = undefined;
    const watches = this.options.store.listWatches().filter(watch => watch.source === 'kswarm' && watch.status === 'active');
    if (this.projectConnected) {
      await Promise.all([...new Set(watches.map(watch => watch.workId))].map(id => this.refreshProject(id, true)));
    } else {
      for (const watch of watches) await this.options.service.sourceUnavailable(watch.watchId, 'reconnecting', 'activity_stream_disconnected');
      this.scheduleProjectFallback();
    }
  }

  private scheduleProjectFallback(): void {
    if (this.disposed || this.projectConnected || this.projectFallback) return;
    this.projectFallback = setTimeout(() => {
      this.projectFallback = undefined;
      if (this.disposed || this.projectConnected) return;
      const ids = new Set(this.options.store.listWatches().filter(watch => watch.source === 'kswarm' && watch.status === 'active').map(watch => watch.workId));
      if (!ids.size) return;
      void Promise.all([...ids].map(id => this.refreshProject(id, true))).finally(() => this.scheduleProjectFallback());
    }, 30_000);
    this.projectFallback.unref?.();
  }

  private async drainProject(projectId: string): Promise<void> {
    while (this.projectPending.delete(projectId) && !this.disposed) {
      const watches: WorkWatch[] = [];
      for (const watch of this.projectWatches(projectId)) {
        if (await this.options.service.canReadSource(watch.watchId)) watches.push(watch);
        else await this.options.service.sourceUnavailable(watch.watchId, 'unavailable', 'activity_source_forbidden');
      }
      if (this.disposed) return;
      if (!watches.length) return;
      const controller = new AbortController();
      const key = `project:${projectId}`; this.controllers.set(key, controller);
      try {
        let after = Math.min(...watches.map(watch => this.options.store.getProjection(watch.watchId)?.sourceSequence ?? 0));
        for (;;) {
          if (!await this.options.service.canReadSource(watches[0]!.watchId)) throw new Error('activity_source_forbidden');
          const page = await this.options.readProject(projectId, after, controller.signal);
          if (this.disposed || controller.signal.aborted) return;
          if (!page.ok) throw new Error('activity_source_unsupported');
          for (const watch of this.projectWatches(projectId)) {
            const current = this.options.store.getWatch(watch.watchId);
            if (!current || current.status !== 'active' || current.generation !== watch.generation) continue;
            if (!await this.options.service.canReadSource(watch.watchId)) continue;
            if ((this.options.store.getProjection(watch.watchId)?.sourceSequence ?? 0) < after) {
              this.projectPending.add(projectId); continue;
            }
            if (watch.sourceDataEpoch !== page.sourceDataEpoch) throw new Error('activity_source_epoch_changed');
            if (page.coveredThrough !== undefined && page.gapRanges) {
              await this.options.service.acceptRetainedPage(watch.watchId, {
                sourceDataEpoch: page.sourceDataEpoch, coveredThrough: page.coveredThrough, gapRanges: page.gapRanges,
                events: page.events.map(event => ({ ...event, logicalSourceId: watch.logicalSourceId,
                  sourceDataEpoch: page.sourceDataEpoch, transportGeneration: watch.generation, receivedAt: Date.now() })),
              });
            } else if (page.gap) {
              const state = page.snapshot.status === 'delivered' || page.snapshot.deliveredAt ? 'completed' : page.snapshot.status === 'closed' ? 'cancelled' : 'accepted';
              await this.options.service.reconcileSnapshot(watch.watchId, page.sourceDataEpoch, page.headSeq, state);
              continue;
            } else for (const event of page.events) await this.options.service.acceptEvent(watch.watchId, {
              ...event, logicalSourceId: watch.logicalSourceId, sourceDataEpoch: page.sourceDataEpoch,
              transportGeneration: watch.generation, receivedAt: Date.now(),
            });
            if (page.nextCursor >= page.headSeq && (page.snapshot.status === 'delivered' || page.snapshot.deliveredAt || page.snapshot.status === 'closed')) {
              const state = page.snapshot.status === 'delivered' || page.snapshot.deliveredAt ? 'completed' : 'cancelled';
              await this.options.service.reconcileSnapshot(watch.watchId, page.sourceDataEpoch, page.headSeq, state, false);
            }
            await this.options.service.confirmFreshness(watch.watchId);
          }
          if (page.nextCursor >= page.headSeq || page.gap && page.coveredThrough === undefined) break;
          if (page.nextCursor <= after) throw new Error('activity_source_cursor_stalled');
          after = page.nextCursor;
        }
      } finally { this.controllers.delete(key); }
    }
  }

  stopWatch(watchId: string): void {
    this.controllers.get(watchId)?.abort(); this.controllers.delete(watchId);
    const retry = this.taskRetries.get(watchId); if (retry) clearTimeout(retry);
    this.taskRetries.delete(watchId); this.taskAttempts.delete(watchId);
  }

  private scheduleTaskRetry(watch: WorkWatch): void {
    const current = this.options.store.getWatch(watch.watchId);
    const projection = this.options.store.getProjection(watch.watchId);
    if (!current || current.status !== 'active' || current.generation !== watch.generation
      || projection && ['completed','failed','cancelled'].includes(projection.executionState)) return;
    const attempt = this.taskAttempts.get(watch.watchId) ?? 0;
    this.taskAttempts.set(watch.watchId, Math.min(attempt + 1, 5));
    const timer = setTimeout(() => {
      this.taskRetries.delete(watch.watchId);
      void this.startWatch(watch.watchId).catch(error => this.options.onError?.(error));
    }, Math.min(30_000, 1000 * 2 ** attempt));
    timer.unref?.(); this.taskRetries.set(watch.watchId, timer);
  }

  refreshGroup(groupId: string, sourceChanged = false): Promise<void> {
    if (this.disposed || !this.options.readGroup) return Promise.resolve();
    const existing = this.groupReads.get(groupId);
    if (existing) { if (sourceChanged) this.groupPending.add(groupId); return existing; }
    this.groupPending.add(groupId);
    const pending = this.drainGroup(groupId).catch(error => {
      if (!this.disposed) this.options.onError?.(error);
    }).finally(() => { if (this.groupReads.get(groupId) === pending) this.groupReads.delete(groupId); });
    this.groupReads.set(groupId, pending); return pending;
  }

  private async drainGroup(groupId: string): Promise<void> {
    while (!this.disposed && this.groupPending.delete(groupId)) {
      const watches: WorkWatch[] = [];
      for (const watch of this.options.store.listWatches().filter(watch => watch.source === 'agent_group' && watch.workId === groupId && watch.status === 'active')) {
        if (await this.options.service.canReadSource(watch.watchId)) watches.push(watch);
      }
      if (!watches.length) return;
      let after = Math.min(...watches.map(watch => this.options.store.getProjection(watch.watchId)?.sourceSequence ?? 0));
      for (;;) {
        if (this.disposed) return;
        const events = this.options.readGroup!(groupId, after);
        if (!events.length) break;
        for (const event of events) {
          if (this.disposed) return;
          const agent = event.payload.agent as { parentId?: unknown; status?: unknown; taskName?: unknown } | undefined;
          let kind: WorkKind = event.kind === 'approval' ? 'input_required' : event.kind === 'artifact' || event.kind === 'result' ? 'artifact_available' : 'progress';
          if (event.kind === 'status') {
            if (agent?.status === 'running') kind = 'started';
            if (agent?.status === 'failed' || agent?.status === 'interrupted') kind = 'blocked';
            // A root turn's end is not the group's physical completion: children,
            // followups, retained resources and future turns have separate owners.
          }
          for (const watch of watches) {
            const current = this.options.store.getWatch(watch.watchId);
            if (!current || current.status !== 'active' || current.generation !== watch.generation) continue;
            const resultContentId = event.payload.resultContentId;
            let watchKind: WorkKind = kind;
            if (watch.runId && this.options.groupMembers) {
              const run = event.payload.run as AgentActivityRun | undefined;
              const memberAgent = event.payload.agent as { id?: string; turnId?: string } | undefined;
              const agentId = event.agentId ?? memberAgent?.id ?? event.payload.agentId;
              const turnId = event.turnId ?? memberAgent?.turnId ?? event.payload.turnId;
              const belongs = this.options.groupMembers(watch.runId).some(member => member.agentId === agentId && member.turnId !== undefined && member.turnId === turnId);
              watchKind = 'heartbeat';
              if (event.kind === 'activity_run' && run?.runId === watch.runId) {
                if (['completed', 'failed', 'cancelled'].includes(run.state)) watchKind = run.state as WorkKind;
                else if (run.state === 'running') watchKind = 'started';
                else if (run.state === 'unknown') watchKind = 'blocked';
              } else if (belongs) watchKind = kind;
            }
            await this.options.service.acceptEvent(watch.watchId, { schemaVersion: 1, eventId: event.eventId, source: 'agent_group',
              logicalSourceId: watch.logicalSourceId, sourceDataEpoch: watch.sourceDataEpoch, workId: groupId, runId: watch.runId,
              transportGeneration: watch.generation, sourceSequence: event.seq, kind: watchKind, occurredAt: event.timestamp,
              receivedAt: Date.now(), summary: watchKind !== 'heartbeat' && typeof agent?.taskName === 'string' ? agent.taskName.slice(0, 1024) : undefined,
              evidenceRefs: watchKind !== 'heartbeat' && typeof resultContentId === 'string' ? [resultContentId] : [] });
          }
          after = event.seq;
        }
        if (events.length < 100) break;
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear(); this.projectPending.clear(); this.groupPending.clear();
    if (this.projectFallback) clearTimeout(this.projectFallback);
    this.projectFallback = undefined;
    for (const timer of this.taskRetries.values()) clearTimeout(timer);
    this.taskRetries.clear(); this.taskAttempts.clear();
  }
}
