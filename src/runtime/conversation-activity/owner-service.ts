import type { ConversationActivityApi,ConversationActivityService,PreparedMcpReaderAssociation, ActivityActor, ActivityChange } from './service.js';
import { ConversationActivityOwnerClient } from './owner-client.js';
import type {ActivityNativeConnection} from './owner-client.js';
import type { WorkBinding, WorkWatch, ConversationActivity, ReportingPreference } from './types.js';
import type { SerializedTaskReference } from '@modelcontextprotocol/ext-tasks/client';
import {AttentionWorkReader,type AttentionInventoryReader,type AttentionDismiss,type AttentionReadResult} from './attention-work-reader.js';
import type {ConversationActivityStore} from './store.js';
import type {ConversationWorkView} from './types.js';
import {assertBeforeEffects} from '../verification/before-effects.js';
import {captureProjectForwardData,projectForwardDigest} from './project-forward-snapshot-data.js';
import {projectUnavailableActivityAttention} from './attention-projector.js';
type ProjectAttachment={store:ConversationActivityStore;assertUserRead(watch:WorkWatch,actor:ActivityActor):void};

/** Same semantics through the single writer. Renderer/model payloads cannot
 * choose a daemon actor or invoke producer methods through user IPC. */
export class ConversationActivityAttachedService implements ConversationActivityApi {
  private disposed = false;
  private closing?:Promise<void>;
  private disposeFailure?: { error: unknown };
  private readonly work=new Set<Promise<void>>();
  private workCut?: readonly Promise<void>[];
  private own<T>(begin:()=>Promise<T>):Promise<T>{
    let completed!:()=>void,failed!:(error:unknown)=>void;
    const reservation=new Promise<void>((resolve,reject)=>{completed=resolve;failed=reject;});this.work.add(reservation);
    void reservation.then(()=>this.work.delete(reservation),()=>this.work.delete(reservation));
    try{const raw=begin();void raw.then(()=>completed(),failed);return raw;}catch(error){failed(error);return Promise.reject(error);}
  }
  private readonly subscriptions = new Set<() => void>();
  private readonly readerBirths=new WeakMap<PreparedMcpReaderAssociation,{operationId:string;sourceBirthRef:string;ownerEpoch:string|undefined}>();
  private attentionWork?:AttentionWorkReader;
  private readonly nativeRounds=new Map<string,ActivityNativeConnection>();
  private readonly project?:ProjectAttachment;
  private readonly legacyProjectViews=new WeakSet<object>();
  constructor(readonly client: ConversationActivityOwnerClient, private readonly actorId: string,private readonly attention?:{reader:AttentionInventoryReader;assertNative(watch:WorkWatch,actor:ActivityActor):void;isNativeBinding?(watchId:string):boolean;nativeCurrent?(actor:ActivityActor):void;onError?(error:unknown):void},project?:ProjectAttachment) {
    if(project)this.project=Object.freeze({store:project.store,assertUserRead:project.assertUserRead.bind(project)});
  }
  private actor(actor: ActivityActor): void { if (this.disposed || actor.requestSource !== 'user' || actor.actorId !== this.actorId) throw new Error('activity_actor_forbidden'); }
  prepareAssociation(input: { threadId: string; operationId: string; creationIdempotencyKey: string }, actor: ActivityActor): Promise<void> { this.actor(actor); return this.client.request('prepare', input); }
  async registerMcpReader(endpointId:string,sourceIncarnation:string,actor:ActivityActor):Promise<boolean>{
    this.actor(actor);const status=await this.client.request<{features?:string[]}|undefined>('status');this.actor(actor);
    if(!status?.features?.includes('attention_reader_birth_v1'))return false;
    await this.client.request('attentionReaderRegister',{endpointId,sourceIncarnation});this.actor(actor);return true;
  }
  async prepareMcpReaderAssociation(input:{threadId:string;operationId:string;creationIdempotencyKey:string},actor:ActivityActor):Promise<PreparedMcpReaderAssociation>{
    this.actor(actor);const receipt=await this.client.request<{sourceBirthRef:string}>('attentionPrepare',input);this.actor(actor);
    const frame=Object.freeze({kind:'mcp_reader_birth_v1' as const});this.readerBirths.set(frame,{operationId:input.operationId,sourceBirthRef:receipt.sourceBirthRef,ownerEpoch:this.client.ownerEpoch});return frame;
  }
  async bindMcpReaderWork(binding:WorkBinding,reference:SerializedTaskReference,frame:PreparedMcpReaderAssociation,actor:ActivityActor):Promise<WorkWatch>{
    this.actor(actor);const birth=this.readerBirths.get(frame);if(!birth||birth.operationId!==binding.operationId||birth.ownerEpoch!==this.client.ownerEpoch||binding.source!=='mcp')throw Error('attention_reader_forbidden');
    const {source:_source,actualExecutionThreadId:_executionThread,...fields}=binding;return this.client.request('attentionBind',{sourceBirthRef:birth.sourceBirthRef,binding:fields,reference});
  }
  async forgetMcpReaderAssociation(frame:PreparedMcpReaderAssociation,actor:ActivityActor):Promise<void>{
    this.actor(actor);const birth=this.readerBirths.get(frame);if(!birth||birth.ownerEpoch!==this.client.ownerEpoch)throw Error('attention_reader_forbidden');await this.client.request('attentionForget',{operationId:birth.operationId,sourceBirthRef:birth.sourceBirthRef});
  }
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
  private basicGetWork(watchId:string,actor:ActivityActor):ReturnType<ConversationActivityApi['getWork']>{this.actor(actor);return this.client.request('work',{watchId});}
  private workReader():AttentionWorkReader{
    if(!this.attention)throw Error('attention_inventory_unavailable');
    return this.attentionWork??=new AttentionWorkReader({reader:this.attention.reader,assertNative:(watch,actor)=>{this.actor(actor);this.attention!.assertNative(watch,actor);},
      base:(id,actor)=>this.basicGetWork(id,actor),begin:async(id,actor)=>{
        this.actor(actor);if(!this.attention!.isNativeBinding?.(id))return this.client.request('attentionReadBegin',{watchId:id});
        const result=await this.nativeRequest<{roundId:string;readerSlots:import('./attention-reader-owner.js').AttentionReaderSlot[];memberSlots:import('./attention-reader-owner.js').AttentionReaderSlot[]}>('attentionReadBegin',{watchId:id},actor);
        this.nativeRounds.set(result.value.roundId,result.connection);return result.value;
      },finalize:async(input,actor)=>{
        this.actor(actor);const round=typeof input.roundId==='string'?input.roundId:'';const connection=this.nativeRounds.get(round);
        if(!connection)return this.client.request<AttentionReadResult>('attentionReadFinalize',input);
        try{return (await this.nativeRequest<AttentionReadResult>('attentionReadFinalize',input,actor,connection)).value;}finally{this.nativeRounds.delete(round);}
      },abort:async(id,actor)=>{
        this.actor(actor);const connection=this.nativeRounds.get(id);if(!connection)return this.client.request('attentionReadAbort',{roundId:id});
        try{return (await this.nativeRequest('attentionReadAbort',{roundId:id},actor,connection)).value;}finally{this.nativeRounds.delete(id);}
      },onError:this.attention.onError});
  }
  private nativeRequest<T>(method:string,input:Record<string,unknown>,actor:ActivityActor,expected?:ActivityNativeConnection){
    const current=()=>{this.actor(actor);if(!this.attention?.nativeCurrent)throw Error('activity_native_read_forbidden');this.attention.nativeCurrent(actor);if(expected)this.client.assertNativeConnectionCurrent(expected);};
    return this.client.requestNative<T>(method,input,current);
  }
  private projectUser(watchId:string,actor:ActivityActor):WorkWatch{
    this.actor(actor);if(!this.project)throw Error('activity_project_return_unverified');
    const watch=this.project.store.getWatch(watchId);if(!watch||watch.source!=='kswarm')throw Error('activity_source_superseded');
    assertBeforeEffects(()=>this.project!.assertUserRead(watch,actor));this.actor(actor);return watch;
  }
  private async projectGetWork(watchId:string,actor:ActivityActor,dismiss?:AttentionDismiss):Promise<ConversationWorkView>{
    const before=this.projectUser(watchId,actor),identity=JSON.stringify(before),current=()=>{if(JSON.stringify(this.projectUser(watchId,actor))!==identity)throw Error('activity_source_superseded');};
    let view:ConversationWorkView;
    try{view=await this.client.readProjectWork(watchId,before.workId,current,dismiss);}
    catch(error){
      if(dismiss||!this.client.isProjectForwardUnsupported(error))throw error;
      current();const projection=this.project!.store.getProjection(watchId);if(!projection)throw Error('activity_source_unavailable');
      // A valid old-owner status only permits a local ordinary unavailable
      // display. No fallback RPC, witness, strong stage or execution grant.
      const {summary:_summary,...ordinary}=projection;
      view=captureProjectForwardData({watch:before,projection:{...ordinary,freshness:'unavailable',errorCode:'activity_project_forward_unsupported'},presentation:{...projectUnavailableActivityAttention(before,projection.revision),protocolUnavailable:true}}) as ConversationWorkView;
      this.legacyProjectViews.add(view);
    }
    current();this.assertProjectWorkReadCurrent(view,actor);return view;
  }
  assertProjectWorkReadCurrent(raw:unknown,actor:ActivityActor):void{
    this.actor(actor);if(!this.project||!raw||typeof raw!=='object')throw Error('activity_project_return_unverified');
    const legacy=this.legacyProjectViews.has(raw),stamp=legacy?null:this.client.assertProjectWorkReadCurrent(raw),view=raw as ConversationWorkView;
    if(projectForwardDigest(this.projectUser(view.watch.watchId,actor))!==projectForwardDigest(view.watch))throw Error('activity_source_superseded');
    if(stamp){
      const members=this.project.store.assertProjectForwardSnapshot(stamp,view);
      for(const member of members)if(!member.deleted&&member.watch.status==='active')assertBeforeEffects(()=>this.project!.assertUserRead(member.watch,actor));
      this.actor(actor);this.project.store.assertProjectForwardSnapshot(stamp,view);
    }
    if(!legacy)this.client.assertProjectWorkReadCurrent(raw);this.actor(actor);
  }
  getWork(watchId: string, actor: ActivityActor): ReturnType<ConversationActivityApi['getWork']> { this.actor(actor); return this.own(()=>this.project?.store.getWatch(watchId)?.source==='kswarm'?this.projectGetWork(watchId,actor):this.attention?this.workReader().getWork(watchId,actor):this.basicGetWork(watchId,actor)); }
  dismissAttention(watchId:string,input:AttentionDismiss,actor:ActivityActor){this.actor(actor);return this.own(()=>this.project?.store.getWatch(watchId)?.source==='kswarm'?this.projectGetWork(watchId,actor,input):this.workReader().dismiss(watchId,input,actor));}
  async authorizeRead(watchId:string,actor:ActivityActor):ReturnType<ConversationActivityService['authorizeRead']>{
    this.actor(actor);const status=await this.client.request<{features?:string[]}|undefined>('status');this.actor(actor);
    if(status?.features?.includes('attention_read_round_v1'))return this.client.request('authorizeRead',{watchId});
    // Old owners only have the nonaggregated work protocol. They acquire no new
    // complete-inventory qualification through this compatibility read.
    const {watch,projection}=await this.basicGetWork(watchId,actor);this.actor(actor);
    if(projection.errorCode==='activity_source_forbidden')throw Error('activity_source_forbidden');return {watch,projection};
  }
  markRead(threadId: string, through: number, actor: ActivityActor): Promise<void> { this.actor(actor); return this.client.request('read', { threadId, through }); }
  unreadThreads(actor: ActivityActor): Promise<Array<{ threadId: string; count: number }>> { this.actor(actor); return this.client.request('unread'); }
  updateReporting(watchId: string, preference: ReportingPreference, revision: number, actor: ActivityActor): Promise<WorkWatch> { this.actor(actor); return this.client.request('reporting', { watchId, preference, revision }); }
  stopWatch(watchId: string, revision: number, actor: ActivityActor): Promise<WorkWatch> { this.actor(actor); return this.client.request('stop', { watchId, revision }); }
  handleThreadDeletion(threadId: string, operationId: string): void { void this.client.request('deleted', { threadId, operationId }).catch(() => {}); }
  start(): void {}
  close():Promise<void>{
    if(this.closing)return this.closing;
    let completed!:()=>void,failed!:(error:unknown)=>void;this.closing=new Promise<void>((resolve,reject)=>{completed=resolve;failed=reject;});
    const failures:unknown[]=[];try{this.dispose();}catch(error){failures.push(error);}const active=[...(this.workCut??this.work)];
    try{active.push(this.client.close());}catch(error){failures.push(error);}
    void Promise.allSettled(active).then(results=>{failures.push(...results.flatMap(result=>result.status==='rejected'?[result.reason]:[]));if(failures.length)failed(new AggregateError(failures,'activity_attached_service_drain_failed'));else completed();},failed);return this.closing;
  }
  dispose(): void {
    if (this.disposed) { if (this.disposeFailure) throw this.disposeFailure.error; return; }
    this.disposed = true;
    this.workCut = [...this.work];
    this.client.seal();
    this.nativeRounds.clear();
    const failures: unknown[] = [];
    for (const stop of this.subscriptions) try { stop(); } catch (error) { failures.push(error); }
    this.subscriptions.clear();
    try { this.client.dispose(); } catch (error) { failures.push(error); }
    if (failures.length) {
      const error = new AggregateError(failures, 'activity_attached_service_dispose_failed');
      this.disposeFailure = { error };
      throw error;
    }
  }
}
