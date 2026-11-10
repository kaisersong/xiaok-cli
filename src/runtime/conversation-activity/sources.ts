import {randomUUID} from 'node:crypto';
import type { TaskEventRecord, TaskRuntimeHost } from '../task-host/types.js';
import type { ConversationActivityApi,TaskSourceDelivery } from './service.js';
import type { ConversationActivityStore } from './store.js';
import type { WorkEvent, WorkKind, WorkWatch } from './types.js';
import type { AgentActivityMember, AgentActivityRun } from './agent-runs.js';
import {parseNativeApprovalOwner} from '../task-host/native-approval-owner.js';

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
  private readonly projectDemands=new Map<string,string>();
  private readonly projectRounds=new Map<string,{demand:string;completion:Promise<void>;finish():void;foreground:boolean;started:boolean;finished:boolean}>();
  private readonly groupReads = new Map<string, Promise<void>>();
  private readonly groupPending = new Set<string>();
  private readonly taskRetries = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly taskAttempts = new Map<string, number>();
  private projectConnected = false;
  private projectFallback: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private closing?: Promise<void>;
  private readonly drainWork = new Set<Promise<void>>();
  /** Reserve ownership before any synchronous producer prefix can reenter close. */
  private own(begin: () => Promise<void>): Promise<void> {
    let completed!: () => void, failed!: (error: unknown) => void;
    const reservation = new Promise<void>((resolve, reject) => { completed = resolve; failed = reject; });
    this.drainWork.add(reservation);
    void reservation.then(() => { this.drainWork.delete(reservation); }, () => {
      this.drainWork.delete(reservation);
    });
    try { const raw = begin(); void raw.then(completed, failed); return raw; }
    catch (error) { failed(error); return reservation; }
  }


  constructor(private readonly options: {
    store: ConversationActivityStore; service: ConversationActivityApi;
    fixedProjectSource?:boolean;
    taskHost(taskId: string): TaskRuntimeHost;
    readProject?(projectId: string, after: number, signal: AbortSignal,sourceDataEpoch:string): Promise<ProjectActivityPage>;
    readGroup?(groupId: string, after: number): Array<{ eventId: string; seq: number; timestamp: number; kind: string; agentId?: string; turnId?: string; payload: Record<string, unknown> }>;
    groupMembers?(runId: string): AgentActivityMember[];
    onError?(error: unknown): void;
  }) {}

  startWatch(watchId: string): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return this.own(() => this.startWatchNow(watchId));
  }
  private async startWatchNow(watchId: string): Promise<void> {
    const watch = this.options.store.getWatch(watchId);
    if (!watch || watch.status !== 'active' || this.disposed) return;
    if (watch.source === 'kswarm') { this.scheduleProjectFallback(); return this.refreshProject(watch.workId,!!this.options.fixedProjectSource); }
    if (watch.source === 'agent_group') return this.refreshGroup(watch.workId);
    if (watch.source !== 'task_host' || this.controllers.has(watchId)) return;
    const priorRetry = this.taskRetries.get(watchId);
    if (priorRetry) clearTimeout(priorRetry);
    this.taskRetries.delete(watchId);
    const controller = new AbortController(); this.controllers.set(watchId, controller);
    let retry = true;
    let delivery:TaskSourceDelivery|undefined;
    void this.own(() => Promise.resolve().then(async () => {
      if (this.disposed || controller.signal.aborted) return;
      const host = this.options.taskHost(watch.workId);
      if (!host.subscribeTaskRecords) { retry = false; throw new Error('activity_source_unsupported'); }
      delivery=await this.options.service.bindTaskSource?.(watchId,host,controller.signal);
      if(this.disposed||controller.signal.aborted)return;
      await this.readTask(watch, host, controller,delivery);
    }).catch(async error => {
      if (!controller.signal.aborted && !this.disposed) {
        try { if(delivery)await this.options.service.taskSourceUnavailable!(delivery,'unavailable','activity_source_unavailable');else await this.options.service.sourceUnavailable(watchId, 'unavailable', 'activity_source_unavailable'); }
        catch (deliveryError) { this.options.onError?.(deliveryError); }
        this.options.onError?.(error);
      }
    }).finally(() => {
      if (this.controllers.get(watchId) === controller) this.controllers.delete(watchId);
      if (retry && !controller.signal.aborted && !this.disposed) this.scheduleTaskRetry(watch);
    }).catch(error => this.options.onError?.(error)));
  }

  private async readTask(watch: WorkWatch, host: TaskRuntimeHost, controller: AbortController,delivery?:TaskSourceDelivery): Promise<void> {
    if (!await this.options.service.canReadSource(watch.watchId)) throw new Error('activity_source_forbidden');
    if(this.disposed||controller.signal.aborted)return;
    const sinceIndex = this.options.store.getProjection(watch.watchId)?.sourceSequence ?? 0;
    for await (const record of host.subscribeTaskRecords!(watch.workId, { sinceIndex, signal: controller.signal })) {
      if (this.disposed || controller.signal.aborted) return;
      const current = this.options.store.getWatch(watch.watchId);
      if (!current || current.status !== 'active' || current.generation !== watch.generation) return;
      if(record.taskId!==watch.workId||record.sourceDataEpoch!==watch.sourceDataEpoch)throw Error('activity_source_mismatch');
      if(delivery)await this.options.service.acceptTaskSourceEvent!(delivery,this.taskEvent(watch,record));
      else await this.options.service.acceptEvent(watch.watchId, this.taskEvent(watch, record),()=>!this.disposed&&!controller.signal.aborted);
      this.taskAttempts.delete(watch.watchId);
      if(this.disposed||controller.signal.aborted)return;
      if(delivery)await this.options.service.confirmTaskSourceFreshness!(delivery);
      else await this.options.service.confirmFreshness(watch.watchId);
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
    const owner=event.type==='needs_user'&&event.question.owner!==undefined?parseNativeApprovalOwner(event.question.owner):undefined;
    if(owner&&(owner.taskSessionId!==record.sourceDataEpoch||event.type!=='needs_user'||owner.approvalToken!==event.question.questionId||event.question.taskId!==record.taskId))throw Error('activity_native_source_owner_conflict');
    return { schemaVersion: owner?2:1, eventId: `${record.taskId}#${record.eventIndex}`, source: 'task_host',
      logicalSourceId: watch.logicalSourceId, sourceDataEpoch: record.sourceDataEpoch,
      workId: watch.workId, runId: watch.runId, sourceSequence: record.eventIndex + 1,
      transportGeneration: watch.generation, kind, summary: summary?.slice(0, 1024), evidenceRefs,
      receivedAt: Date.now(),...(owner?{questionId:owner.approvalToken,questionOwner:owner}:{}) };
  }

  refreshProject(projectId: string, sourceChanged = false): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return this.own(() => this.refreshProjectNow(projectId, sourceChanged));
  }
  /** Negative admission only: the receipt proves actual synchronous demand
   * rotation, never HTTP success. Its tail remains owned by this Source. */
  admitProjectHint(projectId:string):Readonly<{demandId:string;settled:Promise<void>}>{
    if(this.disposed||!this.options.fixedProjectSource||!this.projectWatches(projectId).length)throw Error('activity_project_hint_unconfirmed');
    let demandId:string|undefined;
    const settled=this.own(()=>this.refreshProjectNow(projectId,true,false,demand=>{demandId=demand;}));
    void settled.catch(error=>this.options.onError?.(error));
    if(!demandId)throw Error('activity_project_hint_unconfirmed');
    return Object.freeze({demandId,settled});
  }
  private refreshProjectNow(projectId: string, sourceChanged = false, foreground=false,admitted?:(demandId:string)=>void): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const existing = this.projectReads.get(projectId);
    if (existing) {
      if(sourceChanged&&this.options.fixedProjectSource){
        this.newProjectDemand(projectId);const round=this.projectRounds.get(projectId);
        if(round){round.foreground=false;if(!round.started)round.demand=this.projectDemands.get(projectId)!;}
      }
      if (sourceChanged) this.projectPending.add(projectId);
      if(this.options.fixedProjectSource)admitted?.(this.projectDemands.get(projectId)!);
      return existing;
    }
    // Publish the shared owner and round shell before guards/SQLite/abort
    // callbacks can synchronously reenter scheduling or close.
    let begin!:()=>void,fail!:(error:unknown)=>void;
    const admission=new Promise<void>((resolve,reject)=>{begin=resolve;fail=reject;});
    const promise=admission.then(()=>this.options.fixedProjectSource?this.drainFixedProject(projectId):this.drainProject(projectId)).catch(async error=>{
      if(!this.disposed){
        if(this.options.fixedProjectSource){try{this.options.service.failProjectSource!(this,projectId);}catch(deliveryError){this.options.onError?.(deliveryError);}}
        else for(const watch of this.projectWatches(projectId)){try{await this.options.service.sourceUnavailable(watch.watchId,'unavailable','activity_source_unavailable');}catch(deliveryError){this.options.onError?.(deliveryError);}}
        this.options.onError?.(error);
      }
    }).finally(()=>{
      if(this.projectReads.get(projectId)===promise)this.projectReads.delete(projectId);
      if(this.disposed)return;
      // A completion consumer can enqueue a hint after drain's last loop test
      // but before this release. Hand it to the same original pump here.
      if(this.projectPending.has(projectId)){void this.refreshProject(projectId).catch(error=>this.options.onError?.(error));return;}
      if(this.options.fixedProjectSource)return this.options.service.flushProjectSource!(this,projectId).catch(error=>this.options.onError?.(error));
    });
    this.projectReads.set(projectId,promise);
    try{if(this.options.fixedProjectSource)this.reserveProjectRound(projectId,foreground);this.projectPending.add(projectId);if(this.options.fixedProjectSource)admitted?.(this.projectDemands.get(projectId)!);begin();}
    catch(error){const round=this.projectRounds.get(projectId);if(round&&!round.started){round.finished=true;round.finish();}fail(error);}
    return promise;
  }

  private newProjectDemand(projectId:string):string{
    const demand=randomUUID();this.projectDemands.set(projectId,demand);
    this.controllers.get(`project:${projectId}`)?.abort();
    this.options.service.invalidateProjectSource!(this,projectId);return demand;
  }
  private reserveProjectRound(projectId:string,foreground:boolean){
    let finish!:()=>void;const completion=new Promise<void>(resolve=>{finish=resolve;});
    const round={demand:'',completion,finish,foreground,started:false,finished:false};
    this.projectRounds.set(projectId,round);this.newProjectDemand(projectId);
    // A synchronous invalidation/abort callback may have rotated again.
    round.demand=this.projectDemands.get(projectId)??'';return round;
  }
  /** Foreground waits at most one admitted round, never the quiescence of an
   * unbounded hint stream. Background dirty reads expose unknown immediately. */
  ensureProjectRound(projectId:string):Promise<void>{
    if(this.disposed)return Promise.reject(Error('activity_sources_disposed'));
    if(!this.options.fixedProjectSource)return this.refreshProject(projectId);
    return this.own(()=>{
      const existing=this.projectRounds.get(projectId);
      if(this.projectReads.has(projectId))return existing?.foreground?existing.completion:Promise.resolve();
      const drain=this.own(()=>this.refreshProjectNow(projectId,false,true));void drain.catch(error=>this.options.onError?.(error));
      return this.projectRounds.get(projectId)!.completion;
    });
  }
  private async drainFixedProject(projectId:string):Promise<void>{
    while(this.projectPending.delete(projectId)&&!this.disposed){
      let round=this.projectRounds.get(projectId);
      if(!round||round.finished)round=this.reserveProjectRound(projectId,false);
      round.started=true;const active=round;
      const controller=new AbortController(),key=`project:${projectId}`;this.controllers.set(key,controller);
      const current=()=>{if(this.disposed||controller.signal.aborted||this.projectDemands.get(projectId)!==active.demand)throw Error('activity_project_source_superseded');};
      try{
        const watches=this.projectWatches(projectId);if(!watches.length)continue;
        let after=Math.min(...watches.map(watch=>this.options.store.getProjection(watch.watchId)?.sourceSequence??0));
        for(;;){
          current();const frame=await this.options.service.readProjectSource!(this,projectId,after,controller.signal,active.demand,current);current();
          await this.options.service.acceptProjectSourcePage!(this,frame);current();
          if(frame.page.nextCursor===frame.page.headSeq)break;
          if(frame.page.nextCursor<=after)throw Error('activity_source_cursor_stalled');after=frame.page.nextCursor;
        }
      }catch(error){
        if(!this.disposed){try{this.options.service.failProjectSource!(this,projectId);}catch(deliveryError){this.options.onError?.(deliveryError);}this.options.onError?.(error);}
      }finally{
        if(this.controllers.get(key)===controller)this.controllers.delete(key);
        active.finished=true;active.finish();
      }
    }
  }

  private projectWatches(projectId: string): WorkWatch[] {
    return this.options.store.listWatches().filter(watch => watch.source === 'kswarm' && watch.workId === projectId && watch.status === 'active');
  }

  projectConnectionChanged(status: 'connected' | 'disconnected' | 'reconnecting'): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return this.own(() => this.projectConnectionChangedNow(status));
  }
  private async projectConnectionChangedNow(status: 'connected' | 'disconnected' | 'reconnecting'): Promise<void> {
    if (this.disposed) return;
    this.projectConnected = status === 'connected';
    if (this.projectFallback) clearTimeout(this.projectFallback);
    this.projectFallback = undefined;
    const watches = this.options.store.listWatches().filter(watch => watch.source === 'kswarm' && watch.status === 'active');
    if (this.projectConnected) {
      await Promise.all([...new Set(watches.map(watch => watch.workId))].map(id => this.refreshProject(id, true)));
    } else {
      if(this.options.fixedProjectSource)for(const projectId of new Set(watches.map(watch=>watch.workId)))this.newProjectDemand(projectId);
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
      void this.own(() => Promise.all([...ids].map(id => this.refreshProject(id, true))).then(() => undefined).finally(() => this.scheduleProjectFallback()));
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
          if(!this.options.readProject)throw Error('activity_project_source_unsupported');
          const page = await this.options.readProject(projectId, after, controller.signal,watches[0]!.sourceDataEpoch);
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
    if (this.disposed) return Promise.resolve();
    return this.own(() => this.refreshGroupNow(groupId, sourceChanged));
  }
  private refreshGroupNow(groupId: string, sourceChanged = false): Promise<void> {
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

  /** Seals scheduling synchronously and waits actual owned work; never fabricates a drain ACK. */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    let completed!: () => void, failed!: (error: unknown) => void;
    this.closing = new Promise<void>((resolve, reject) => { completed = resolve; failed = reject; });
    const sealFailures: unknown[] = [];
    try { this.dispose(); } catch (error) { sealFailures.push(error); }
    const active = [...this.drainWork];
    void Promise.allSettled(active).then(outcomes => {
      const failures = [...sealFailures,
        ...outcomes.flatMap(result => result.status === 'rejected' ? [result.reason] : [])];
      if (failures.length) failed(new AggregateError([...new Set(failures)], 'activity_sources_drain_failed'));
      else completed();
    }, failed);
    return this.closing;
  }
  dispose(): void {
    this.disposed = true;
    for(const round of this.projectRounds.values())round.finish();
    this.projectDemands.clear();
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear(); this.projectPending.clear(); this.groupPending.clear();
    if (this.projectFallback) clearTimeout(this.projectFallback);
    this.projectFallback = undefined;
    for (const timer of this.taskRetries.values()) clearTimeout(timer);
    this.taskRetries.clear(); this.taskAttempts.clear();
  }
}
