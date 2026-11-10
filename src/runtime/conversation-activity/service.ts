import type { ConversationActivityStore } from './store.js';
import {unavailableProjection,unavailableActivity} from './disclosure.js';
import type { ActivityOrigin, ConversationActivity, ReportingPreference, WorkBinding, WorkWatch, WorkProjection, ConversationWorkView } from './types.js';
import type { SerializedTaskReference } from '@modelcontextprotocol/ext-tasks/client';
import { projectActivityAttention, projectUnavailableActivityAttention } from './attention-projector.js';
import {randomUUID} from 'node:crypto';
import {ActivityAttentionReaders,type NativeReaderAuthorization,type NativeReaderAction} from './attention-reader-owner.js';
import {AttentionWorkReader,type AttentionInventoryReader,type AttentionDismiss} from './attention-work-reader.js';
import {nativeAttentionBindingDigest,nativeAttentionReferenceSchema,type NativeAttentionReference} from './native-attention-source.js';
import type {ProjectSourcePort,ProjectSourcePage,ProjectSourceHttpFrame} from './project-source-port.js';
import {captureScopedProjectActivityAudience,type ScopedProjectActivityAudience} from './project-scoped-activity-data.js';
import type {ProjectDeliveryStoreSource,ProjectOrdinaryStoreSource} from './store.js';
import {assertBeforeEffects} from '../verification/before-effects.js';

export interface ActivityActor { requestSource: 'user' | 'agent' | 'scheduler'; actorId: string }
export interface ActivityThreadIdentity {
  profileId: string; threadId: string; workspaceId: string;
  deleteState: 'none' | 'delete_pending' | 'deleted';
}
export interface ActivityChange { threadId: string; watchId?: string }
export type PreparedMcpReaderAssociation=Readonly<{kind:'mcp_reader_birth_v1'}>;
/** VM-local original source lifetime; never a wire/renderer capability. */
export type TaskSourceDelivery=Readonly<{kind:'task_source_delivery_v1'}>;
const taskSourceIdentity=(watch:WorkWatch)=>JSON.stringify([nativeAttentionBindingDigest(watch),watch.generation,watch.status]);
interface LocalNativeRound {actor:ActivityActor;watchIds:Set<string>}
interface LocalNativeOperation {active:boolean;actor:ActivityActor;action:NativeReaderAction;watchIds:Set<string>;roundId?:string;cleanup:boolean}

/** Owned by the host, with actor and thread identity supplied by main's registry. */
export class ConversationActivityService {
  private readonly subscribers = new Set<{ threadId: string | null; actor: ActivityActor; handler: (change: ActivityChange) => void }>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;
  private closing?: Promise<void>;
  private readonly drainWork = new Set<Promise<void>>();
  /** Reserve ownership before any synchronous producer prefix can reenter close. */
  private own<T>(begin: () => Promise<T>): Promise<T> {
    let completed!: () => void, failed!: (error: unknown) => void;
    const reservation = new Promise<void>((resolve, reject) => { completed = resolve; failed = reject; });
    this.drainWork.add(reservation);
    void reservation.then(() => { this.drainWork.delete(reservation); }, () => {
      this.drainWork.delete(reservation);
    });
    try { const raw = begin(); void raw.then(()=>completed(), failed); return raw; }
    catch (error) { failed(error); return Promise.reject(error); }
  }

  private reporting: Promise<void> | undefined;
  private notifying: Promise<void> | undefined;
  private retentionTicks = 0;
  private readonly pendingChanges = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly localReaderClient={role:'producer' as const,active:true};
  private localReaders?:ActivityAttentionReaders;
  private attentionWork?:AttentionWorkReader;
  private readonly readerBirths=new WeakMap<PreparedMcpReaderAssociation,{operationId:string;sourceBirthRef:string}>();
  private readonly projectSource?:ProjectSourcePort;
  private readonly projectPages=new WeakMap<ProjectSourcePage,{owner:object;projectId:string;after:number;demandId:string;members:WorkWatch[];http:ProjectSourceHttpFrame;audience:ScopedProjectActivityAudience;current():void;authorize():Promise<void>}>();
  private readonly projectOrdinaryFrames=new WeakMap<object,ReturnType<ProjectOrdinaryStoreSource>>();
  private readonly projectStrongFrames=new WeakMap<object,ReturnType<ProjectDeliveryStoreSource>>();
  private readonly projectAccepted=new Map<string,{projectId:string;frame:object}>();
  private readonly projectPublished=new Map<string,string>();
  private readonly projectForwardResults=new WeakMap<object,{frame:object;result:object}>();
  private readonly projectReadInvalidated?: (projectId:string)=>void;
  private readonly projectPublishPending=new Map<string,ActivityChange[]>();
  private readonly taskSources=new WeakMap<TaskSourceDelivery,{watchId:string;identity:string;owner:object;signal:AbortSignal}>();
  private readonly nativeOperations=new WeakMap<object,LocalNativeOperation>();
  private readonly nativeRounds=new Map<string,LocalNativeRound>();
  private assertNativeActor(actor:ActivityActor):void{
    this.assertUser(actor);const source=this.options.nativeAttentionSource;if(!source)throw Error('activity_native_source_unsupported');
    assertBeforeEffects(()=>source.assertActorCurrent(actor));this.assertUser(actor);
  }
  private nativeOperation<T>(actor:ActivityActor,action:NativeReaderAction,watchIds:Set<string>,roundId:string|undefined,cleanup:boolean,run:(context:object)=>Promise<T>|T):Promise<T>{
    return this.own(async()=>{
      this.assertUser(actor);if(!cleanup)this.assertNativeActor(actor);
      const context=Object.freeze(Object.create(null)) as object,state:LocalNativeOperation={active:true,actor,action,watchIds,roundId,cleanup};this.nativeOperations.set(context,state);
      try{const result=await run(context);if(!cleanup)this.assertNativeActor(actor);return result;}
      finally{state.active=false;this.nativeOperations.delete(context);}
    });
  }
  private assertNativeOperation(authorization:NativeReaderAuthorization):LocalNativeOperation{
    const state=authorization.context&&this.nativeOperations.get(authorization.context);
    if(!state?.active||state.action!==authorization.action||!state.watchIds.has(authorization.watchId)||state.roundId!==authorization.roundId)throw Error('activity_native_source_forbidden');
    this.assertUser(state.actor);
    if(state.roundId){const round=this.nativeRounds.get(state.roundId);if(!round||round.actor!==state.actor||!round.watchIds.has(authorization.watchId))throw Error('attention_round_conflict');}
    if(state.cleanup){if(state.action!=='abort')throw Error('activity_native_source_forbidden');}else this.assertNativeActor(state.actor);
    return state;
  }
  private readers():ActivityAttentionReaders{
    if(this.disposed)throw Error('activity_service_disposed');
    return this.localReaders??=new ActivityAttentionReaders({store:this.options.store,service:this,actor:{requestSource:'user',actorId:this.options.actorId},ownerEpoch:randomUUID(),getThread:this.options.getThread,
      assertProducer:(client,threadId)=>{if(client!==this.localReaderClient||this.disposed)throw Error('activity_producer_forbidden');if(threadId!==undefined)this.thread(threadId);},
      assertNativeProducer:(client,_thread,authorization)=>{if(client!==this.localReaderClient)throw Error('activity_native_source_forbidden');this.assertNativeOperation(authorization);},
      assertNativeCleanupOwner:(client,roundId,context)=>{
        const state=context&&this.nativeOperations.get(context),round=this.nativeRounds.get(roundId);
        if(client!==this.localReaderClient||!state?.active||state.action!=='abort'||state.roundId!==roundId||!round||round.actor!==state.actor)throw Error('activity_native_source_forbidden');
      }});
  }
  qualifyNativeAttentionReader(watchId:string,actor:ActivityActor){
    return this.nativeOperation(actor,'qualify',new Set([watchId]),undefined,false,async context=>{
      const reference=this.options.nativeAttentionSource!.inspect(actor,watchId);this.assertNativeActor(actor);
      return this.readers().qualifyNative(this.localReaderClient,{watchId,...(reference===undefined?{}:{reference:nativeAttentionReferenceSchema.parse(reference)})},context);
    });
  }
  private beginNativeAttentionRead(watchId:string,actor:ActivityActor){
    return this.own(async()=>{
      this.assertNativeActor(actor);
      const members=this.options.store.captureAttentionRead(watchId).members.filter(member=>!member.deleted&&member.watch.status==='active').map(member=>member.watch.watchId);
      let allocated:{roundId:string;owned:LocalNativeRound}|undefined;
      try{return await this.nativeOperation(actor,'begin',new Set(members),undefined,false,async context=>{
        const round=await this.readers().begin(this.localReaderClient,{watchId},context);
        const owned:LocalNativeRound={actor,watchIds:new Set((round.memberSlots??round.readerSlots).map(slot=>slot.watchId))};this.nativeRounds.set(round.roundId,owned);allocated={roundId:round.roundId,owned};
        this.assertNativeActor(actor);return round;
      });}catch(primary){
        // The outer operation itself has a post-await guard. It owns cleanup
        // even when withdrawal occurs after the inner body already returned.
        if(allocated&&this.nativeRounds.get(allocated.roundId)===allocated.owned)try{await this.abortNativeAttentionRead(allocated.roundId,actor);}catch(cleanup){throw new AggregateError([primary,cleanup],'native_attention_begin_cleanup_failed');}
        throw primary;
      }
    });
  }
  private finalizeNativeAttentionRead(input:Record<string,unknown>,actor:ActivityActor){
    const roundId=typeof input.roundId==='string'?input.roundId:'',owned=this.nativeRounds.get(roundId);
    if(!owned||owned.actor!==actor)throw Error('attention_round_conflict');
    return this.nativeOperation(actor,'finalize',owned.watchIds,roundId,false,async context=>{
      const result=await this.readers().finalize(this.localReaderClient,input,context);
      if(this.nativeRounds.get(roundId)===owned)this.nativeRounds.delete(roundId);return result;
    });
  }
  private abortNativeAttentionRead(roundId:string,actor:ActivityActor){
    const owned=this.nativeRounds.get(roundId);if(!owned||owned.actor!==actor)throw Error('attention_round_conflict');
    return this.nativeOperation(actor,'abort',owned.watchIds,roundId,true,context=>{
      try{return this.readers().abort(this.localReaderClient,{roundId},context);}
      finally{if(this.nativeRounds.get(roundId)===owned)this.nativeRounds.delete(roundId);}
    });
  }
  async registerMcpReader(endpointId:string,sourceIncarnation:string,actor:ActivityActor):Promise<boolean>{
    this.assertUser(actor);const readers=this.readers();readers.noteMcpRegistration(this.localReaderClient,{endpointId});readers.register(this.localReaderClient,{endpointId,sourceIncarnation});return true;
  }
  async prepareMcpReaderAssociation(input:{threadId:string;operationId:string;creationIdempotencyKey:string},actor:ActivityActor):Promise<PreparedMcpReaderAssociation>{
    this.assertUser(actor);const receipt=await this.readers().prepare(this.localReaderClient,input);this.assertUser(actor);
    const frame=Object.freeze({kind:'mcp_reader_birth_v1' as const});this.readerBirths.set(frame,{operationId:input.operationId,sourceBirthRef:receipt.sourceBirthRef});return frame;
  }
  async bindMcpReaderWork(binding:WorkBinding,reference:SerializedTaskReference,frame:PreparedMcpReaderAssociation,actor:ActivityActor):Promise<WorkWatch>{
    this.assertUser(actor);const birth=this.readerBirths.get(frame);if(!birth||birth.operationId!==binding.operationId||binding.source!=='mcp')throw Error('attention_reader_forbidden');
    const {source:_source,actualExecutionThreadId:_executionThread,...fields}=binding;
    return this.readers().bind(this.localReaderClient,{sourceBirthRef:birth.sourceBirthRef,binding:fields,reference});
  }
  async forgetMcpReaderAssociation(frame:PreparedMcpReaderAssociation,actor:ActivityActor):Promise<void>{
    this.assertUser(actor);const birth=this.readerBirths.get(frame);if(!birth)throw Error('attention_reader_forbidden');this.readers().forget(this.localReaderClient,birth);
  }
  beginMcpAttentionRead(watchId:string,actor:ActivityActor){this.assertUser(actor);return this.readers().begin(this.localReaderClient,{watchId});}
  finalizeMcpAttentionRead(input:Record<string,unknown>,actor:ActivityActor){this.assertUser(actor);return this.readers().finalize(this.localReaderClient,input);}
  abortMcpAttentionRead(roundId:string,actor:ActivityActor){this.assertUser(actor);return this.readers().abort(this.localReaderClient,{roundId});}

  constructor(private readonly options: {
    store: ConversationActivityStore; profileId: string; actorId: string;
    getThread(threadId: string): ActivityThreadIdentity | null;
    canObserveWork(watch: WorkWatch): Promise<boolean> | boolean;
    notify?(activity: ConversationActivity, watch: WorkWatch): Promise<'shown' | 'suppressed' | 'failed'>;
    onError?(error: unknown): void;
    attentionReader?:AttentionInventoryReader;
    projectSource?:ProjectSourcePort;
    projectReadInvalidated?(projectId:string):void;
    assertTaskSourceOwner?(watch:WorkWatch,owner:object):boolean;
    /** Fixed Main source port. Plain user actors and JSON are never positive witnesses. */
    nativeAttentionSource?:{assertActorCurrent(actor:ActivityActor):void;inspect(actor:ActivityActor,watchId:string):NativeAttentionReference|undefined};
  }) {
    const port=options.projectSource;
    if(port)this.projectSource=Object.freeze({assertOwner:port.assertOwner.bind(port),read:port.read.bind(port),assertRead:port.assertRead.bind(port),assertScoped:port.assertScoped.bind(port),ensureRound:port.ensureRound.bind(port),...(port.admitHint?{admitHint:port.admitHint.bind(port)}:{})});
    this.projectReadInvalidated=options.projectReadInvalidated;
  }

  private projectMembers(projectId:string){return this.options.store.listWatches().filter(watch=>watch.source==='kswarm'&&watch.workId===projectId&&watch.status==='active').sort((a,b)=>a.watchId.localeCompare(b.watchId));}
  private projectMemberIdentity(projectId:string){return JSON.stringify(this.projectMembers(projectId));}
  private assertProjectOwner(owner:object):ProjectSourcePort{
    if(this.disposed||!this.projectSource)throw Error('activity_project_source_unsupported');
    assertBeforeEffects(()=>this.projectSource!.assertOwner(owner));return this.projectSource;
  }
  /** The Sources instance, demand and original HTTP owner are all independent
   * admission fences. No renderer/caller DTO can mint either Store frame. */
  readProjectSource(owner:object,projectId:string,after:number,signal:AbortSignal,demandId:string,assertDemandCurrent:()=>void):Promise<ProjectSourcePage>{
    return this.own(async()=>{
      const port=this.assertProjectOwner(owner),members=this.projectMembers(projectId),identity=this.projectMemberIdentity(projectId);
      if(!members.length)throw Error('activity_project_source_unavailable');
      const first=members[0]!,audience=captureScopedProjectActivityAudience({projectId,after,sourceDataEpoch:first.sourceDataEpoch,profileId:first.origin.profileId,workspaceId:first.origin.workspaceId});
      const local=()=>{
        this.assertProjectOwner(owner);assertBeforeEffects(assertDemandCurrent);
        if(signal.aborted||identity!==this.projectMemberIdentity(projectId))throw Error('activity_project_source_superseded');
        for(const watch of members){if(watch.origin.profileId!==this.options.profileId||watch.sourceDataEpoch!==audience.sourceDataEpoch||watch.origin.profileId!==audience.profileId||watch.origin.workspaceId!==audience.workspaceId||this.thread(watch.origin.threadId).workspaceId!==watch.origin.workspaceId)throw Error('activity_project_source_forbidden');}
      };
      const authorize=async()=>{for(const watch of members){local();const allowed=await this.visible(watch);local();if(!allowed)throw Error('activity_source_forbidden');}};
      local();await authorize();local();const http=await port.read(audience,signal,local);local();assertBeforeEffects(()=>port.assertRead(audience,http));local();
      const current=()=>{local();assertBeforeEffects(()=>port.assertRead(audience,http));local();};
      const frame=Object.freeze({kind:'project_source_page_v1' as const,page:http.page});
      this.projectPages.set(frame,{owner,projectId,after,demandId,members,http,audience,current,authorize});return frame;
    });
  }
  invalidateProjectSource(owner:object,projectId:string):void{
    this.assertProjectOwner(owner);
    // Clear every VM-local grant before a SQL failure can interrupt revocation.
    this.clearProjectAccepted(projectId);
    assertBeforeEffects(()=>this.projectReadInvalidated?.(projectId));
    for(const watch of this.projectMembers(projectId))this.options.store.invalidateProjectDelivery(watch.watchId);
  }
  private clearProjectAccepted(projectId:string):void{
    for(const[watchId,accepted]of this.projectAccepted)if(accepted.projectId===projectId)this.projectAccepted.delete(watchId);
  }
  failProjectSource(owner:object,projectId:string):void{
    this.assertProjectOwner(owner);this.clearProjectAccepted(projectId);assertBeforeEffects(()=>this.projectReadInvalidated?.(projectId));const members=this.projectMembers(projectId);
    for(const watch of members)this.options.store.setFreshness(watch.watchId,'unavailable','activity_source_unavailable');
    const signature=JSON.stringify(['unavailable',members]);
    if(this.projectPublished.get(projectId)!==signature){this.projectPublished.set(projectId,signature);this.projectPublishPending.set(projectId,members.map(watch=>({threadId:watch.origin.threadId,watchId:watch.watchId})));}
  }
  resolveProjectOrdinarySource(frame:object){
    const record=this.projectOrdinaryFrames.get(frame);if(!record)throw Error('activity_project_source_forbidden');record.assertCurrent();return record;
  }
  resolveProjectDeliverySource(frame:object){
    const record=this.projectStrongFrames.get(frame);if(!record)throw Error('activity_project_source_forbidden');record.assertCurrent();return record;
  }
  acceptProjectSourcePage(owner:object,frame:ProjectSourcePage):Promise<void>{
    return this.own(async()=>{
      const port=this.assertProjectOwner(owner),source=this.projectPages.get(frame);if(!source||source.owner!==owner)throw Error('activity_project_source_forbidden');
      source.current();await source.authorize();source.current();
      for(const watch of source.members){
        const ordinary=Object.freeze({}),record={watchId:watch.watchId,page:source.http.page,after:source.after,assertCurrent:source.current};
        this.projectOrdinaryFrames.set(ordinary,record);
        try{this.options.store.applyProjectSourcePage(ordinary);}finally{this.projectOrdinaryFrames.delete(ordinary);}
      }
      source.current();await source.authorize();source.current();
      const strong=source.http.scoped;let qualified=false;
      if(strong&&frame.page.nextCursor===frame.page.headSeq){assertBeforeEffects(()=>port.assertScoped(source.audience,strong));qualified=true;source.current();}
      const accepted:Array<[string,object]>=[];
      if(strong&&qualified){
        const body={ok:true,protocol:strong.protocol,projectId:strong.projectId,scope:strong.scope,bindingDigest:strong.bindingDigest,page:strong.page};
        const current=()=>{source.current();assertBeforeEffects(()=>port.assertScoped(source.audience,strong));source.current();};
        try{
          for(const watch of source.members){const delivery=Object.freeze({});this.projectStrongFrames.set(delivery,{watchId:watch.watchId,body,after:source.after,demandId:source.demandId,assertCurrent:current});accepted.push([watch.watchId,delivery]);this.options.store.acceptProjectDelivery(delivery);}
          current();for(const[watchId,delivery]of accepted)this.projectAccepted.set(watchId,{projectId:source.projectId,frame:delivery});
        }catch(error){for(const[watchId,delivery]of accepted){this.projectAccepted.delete(watchId);this.projectStrongFrames.delete(delivery);}throw error;}
      }
      if(frame.page.nextCursor===frame.page.headSeq){
        const signature=JSON.stringify([source.members.map(watch=>[watch,this.options.store.getOrdinaryAttentionFact(watch.watchId).factId]),qualified?strong!.page.delivery:{status:'unknown'}]);
        if(this.projectPublished.get(source.projectId)!==signature){this.projectPublished.set(source.projectId,signature);this.projectPublishPending.set(source.projectId,source.members.map(watch=>({threadId:watch.origin.threadId,watchId:watch.watchId})));}
      }
      source.current();
    });
  }
  /** Called only after Sources releases its shared pump. A subscription or
   * notification may reenter getWork without waiting on its own producer. */
  flushProjectSource(owner:object,projectId:string):Promise<void>{
    this.assertProjectOwner(owner);const changes=this.projectPublishPending.get(projectId);this.projectPublishPending.delete(projectId);if(!changes)return Promise.resolve();
    return this.own(async()=>{for(const change of changes)await this.publish(change);await this.notifyPending();});
  }
  assertProjectWorkReadCurrent(raw:unknown,actor:ActivityActor):void{
    this.assertUser(actor);if(!this.projectSource||!this.attentionWork)throw Error('activity_project_return_unverified');
    this.attentionWork.assertProjectReadCurrent(raw,actor);
  }
  captureProjectWorkSnapshot(raw:unknown,actor:ActivityActor){
    this.assertProjectWorkReadCurrent(raw,actor);const record=this.projectForwardResults.get(raw as object);
    if(!record)return null;
    const stamp=this.options.store.captureProjectForwardStamp(record.frame,record.result);
    this.options.store.assertProjectForwardSnapshot(stamp,raw);this.assertProjectWorkReadCurrent(raw,actor);return stamp;
  }
  private async finalizeProjectWork(watchId:string,actor:ActivityActor,dismiss?:AttentionDismiss){
    const context=await this.authorizeRead(watchId,actor),captured=this.options.store.captureAttentionRead(watchId);
    const frame=this.projectAccepted.get(watchId)?.frame;if(!frame)throw Error('project_delivery_source_unverified');
    for(const member of captured.members){if(member.deleted||member.watch.status!=='active')continue;const allowed=await this.visible(member.watch);this.finishReadContext(context.watch,actor);if(!allowed)throw Error('activity_source_forbidden');}
    this.finishReadContext(context.watch,actor);this.resolveProjectDeliverySource(frame);
    const result=this.options.store.finalizeProjectDelivery(frame,{expectedMembershipDigest:captured.membershipDigest,expectedProjectionVersion:captured.projectionVersion,expectedPresentationIncarnation:captured.presentationIncarnation,...(dismiss?{dismiss}:{})});
    if(dismiss&&result.dismissConflict)throw Error('attention_projection_conflict');
    const view={...result.view,attentionState:{presentationIncarnation:result.presentationIncarnation,dismissed:result.dismissed}};
    this.projectForwardResults.set(view,{frame,result});
    return{view,assertCurrent:(currentActor:ActivityActor)=>{this.finishReadContext(context.watch,currentActor);if(this.projectAccepted.get(watchId)?.frame!==frame)throw Error('project_delivery_source_superseded');this.options.store.assertProjectDeliveryRead(frame,result);this.finishReadContext(context.watch,currentActor);}};
  }
  private async ensureProjectWork(watchId:string,actor:ActivityActor):Promise<boolean>{
    if(!this.projectSource||this.options.store.getWatch(watchId)?.source!=='kswarm')return false;
    const before=await this.authorizeRead(watchId,actor);await this.projectSource.ensureRound(before.watch.workId);
    const after=await this.authorizeRead(watchId,actor);if(JSON.stringify(before.watch)!==JSON.stringify(after.watch))throw Error('activity_source_superseded');return true;
  }

  private taskSourceWatch(frame:TaskSourceDelivery):WorkWatch {
    if(this.disposed)throw Error('activity_service_disposed');
    const source=this.taskSources.get(frame),watch=source&&this.options.store.getWatch(source.watchId);
    if(!source||source.signal.aborted||!watch||watch.status!=='active'||watch.source!=='task_host'||watch.origin.profileId!==this.options.profileId||taskSourceIdentity(watch)!==source.identity||this.options.assertTaskSourceOwner?.(watch,source.owner)!==true)throw Error('activity_task_source_forbidden');
    if(this.thread(watch.origin.threadId).workspaceId!==watch.origin.workspaceId)throw Error('activity_thread_forbidden');
    return watch;
  }
  bindTaskSource(watchId:string,owner:object,signal:AbortSignal):Promise<TaskSourceDelivery|undefined>{
    return this.own(async()=>{
      if(this.disposed)throw Error('activity_service_disposed');
      if(!this.options.assertTaskSourceOwner)return undefined;
      const watch=this.options.store.getWatch(watchId);
      if(!watch||watch.status!=='active'||watch.source!=='task_host'||watch.origin.profileId!==this.options.profileId||signal.aborted||!this.options.assertTaskSourceOwner(watch,owner))throw Error('activity_task_source_forbidden');
      const frame=Object.freeze({kind:'task_source_delivery_v1' as const});this.taskSources.set(frame,{watchId,identity:taskSourceIdentity(watch),owner,signal});
      try{if(!await this.visible(watch))throw Error('activity_source_forbidden');this.taskSourceWatch(frame);return frame;}
      catch(error){this.taskSources.delete(frame);throw error;}
    });
  }
  private taskSourceWrite<T>(frame:TaskSourceDelivery,write:(watch:WorkWatch,delivery:Parameters<ConversationActivityStore['ingest']>[2])=>T,after?:(watch:WorkWatch,value:T)=>Promise<void>):Promise<T>{
    return this.own(async()=>{
      const watch=this.taskSourceWatch(frame);
      if(!await this.visible(watch))throw Error('activity_source_forbidden');
      const current=this.taskSourceWatch(frame);
      // Enrollment may have happened while the original authorization awaited.
      // Fetch the exact current Store capability after that final await.
      const enrolled=this.options.store.getNativeAttentionEnrollment(current.watchId);
      const delivery=enrolled?this.options.store.enrollNativeAttentionSource(current.watchId,enrolled.reference).delivery:undefined;
      let value:T;
      try{value=write(current,delivery);}finally{if(delivery)this.options.store.revokeNativeAttentionDelivery(delivery);}
      if(after)await after(current,value);else await this.publish({threadId:current.origin.threadId,watchId:current.watchId});
      return value;
    });
  }
  acceptTaskSourceEvent(frame:TaskSourceDelivery,event:unknown){
    return this.taskSourceWrite(frame,(watch,delivery)=>this.options.store.ingest(watch.watchId,event,delivery),async(watch,result)=>{
      if(!result.duplicate){
        if(event&&typeof event==='object'&&['progress','heartbeat'].includes(String((event as {kind?:unknown}).kind)))this.publishProgress(watch.origin.threadId);
        else await this.publish({threadId:watch.origin.threadId,watchId:watch.watchId});
      }
      await this.notifyPending();
    });
  }
  async confirmTaskSourceFreshness(frame:TaskSourceDelivery):Promise<void>{
    await this.taskSourceWrite(frame,(watch,delivery)=>{const previous=this.options.store.getProjection(watch.watchId)?.freshness;this.options.store.setFreshness(watch.watchId,'fresh',undefined,delivery);return previous;},async(watch,previous)=>{if(previous!=='fresh')await this.publish({threadId:watch.origin.threadId,watchId:watch.watchId});});
  }
  taskSourceUnavailable(frame:TaskSourceDelivery,freshness:'reconnecting'|'unavailable',errorCode:string):Promise<void>{
    return this.taskSourceWrite(frame,(watch,delivery)=>this.options.store.setFreshness(watch.watchId,freshness,errorCode,delivery));
  }

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

  /** Same-frame native identity fence. Remote authorization remains separate. */
  assertCurrentUserRead(watchId:string,actor:ActivityActor):void{
    this.assertUser(actor);
    const watch=this.options.store.getWatch(watchId);
    if(!watch||watch.status!=='active'||watch.origin.profileId!==this.options.profileId)throw Error('activity_watch_forbidden');
    if(this.thread(watch.origin.threadId).workspaceId!==watch.origin.workspaceId)throw Error('activity_thread_forbidden');
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
    if (this.projectSource && watch.source === 'kswarm') {
      // A recovery of the same semantic head must publish after this negative
      // freshness transition. Revoke VM admission before SQL can fail.
      this.clearProjectAccepted(watch.workId);
      assertBeforeEffects(()=>this.projectReadInvalidated?.(watch.workId));
      this.projectPublished.delete(watch.workId);
    }
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
          rows.push(unavailableActivity(row));
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

  private async readContext(watchId:string,actor:ActivityActor){
    this.assertUser(actor);
    const watch = this.options.store.getWatch(watchId);
    if (!watch || watch.origin.profileId !== this.options.profileId) throw new Error('activity_watch_forbidden');
    this.thread(watch.origin.threadId);
    const identity=(value:WorkWatch)=>JSON.stringify([value.operationId,value.source,value.logicalSourceId,value.sourceDataEpoch,value.workId,value.runId??'',value.actualExecutionThreadId??'',value.generation,value.status,[value.origin.profileId,value.origin.workspaceId,value.origin.threadId,value.origin.actorId]]);
    const expected=identity(watch),allowed=await this.visible(watch);this.assertUser(actor);
    const current=this.options.store.getWatch(watchId);
    if(!current||identity(current)!==expected)throw Error('activity_source_superseded');
    if(this.thread(current.origin.threadId).workspaceId!==current.origin.workspaceId)throw Error('activity_thread_forbidden');
    const projection=this.options.store.getProjection(watchId);if(!projection)throw Error('activity_source_unavailable');
    return {watch:current,projection,allowed};
  }
  private finishReadContext(watch:WorkWatch,actor:ActivityActor){
    this.assertUser(actor);const current=this.options.store.getWatch(watch.watchId);
    const identity=(value:WorkWatch)=>JSON.stringify([value.operationId,value.source,value.logicalSourceId,value.sourceDataEpoch,value.workId,value.runId??'',value.actualExecutionThreadId??'',value.generation,value.status,[value.origin.profileId,value.origin.workspaceId,value.origin.threadId,value.origin.actorId]]);
    if(!current||identity(current)!==identity(watch))throw Error('activity_source_superseded');
    if(this.thread(current.origin.threadId).workspaceId!==current.origin.workspaceId)throw Error('activity_thread_forbidden');
    const projection=this.options.store.getProjection(watch.watchId);if(!projection)throw Error('activity_source_unavailable');return {watch:current,projection};
  }
  /** Producer-internal primitive: no aggregation and no denied source body. */
  async authorizeRead(watchId:string,actor:ActivityActor):Promise<{watch:WorkWatch;projection:WorkProjection}>{
    const context=await this.readContext(watchId,actor),result=this.finishReadContext(context.watch,actor);
    if(!context.allowed)throw Error('activity_source_forbidden');return result;
  }
  private async basicGetWork(watchId: string, actor: ActivityActor): Promise<ConversationWorkView> {
    const context=await this.readContext(watchId,actor),{watch,projection}=this.finishReadContext(context.watch,actor);
    if (context.allowed){const presentation=projectActivityAttention(watch,projection);if(watch.source==='mcp')presentation.protocolUnavailable=true;return {watch,projection,presentation};}
    const unavailable = unavailableProjection(projection);
    return { watch, projection: unavailable, presentation: projectUnavailableActivityAttention(watch, projection.revision) };
  }
  private workReader():AttentionWorkReader{
    if(!this.options.attentionReader&&!this.projectSource)throw Error('attention_inventory_unavailable');
    const reader=this.options.attentionReader??{hasBinding:()=>false,assertCurrent(){throw Error('attention_inventory_unavailable');},async collect():Promise<never>{throw Error('attention_inventory_unavailable');}};
    return this.attentionWork??=new AttentionWorkReader({reader,base:(id,actor)=>this.basicGetWork(id,actor),assertNative:(watch,actor)=>{this.finishReadContext(watch,actor);},
      ...(this.projectSource?{project:(id:string,actor:ActivityActor,dismiss?:AttentionDismiss)=>this.finalizeProjectWork(id,actor,dismiss)}:{}),
      begin:(id,actor)=>this.options.store.getNativeAttentionEnrollment(id)?this.beginNativeAttentionRead(id,actor):this.beginMcpAttentionRead(id,actor),
      finalize:(input,actor)=>typeof input.roundId==='string'&&this.nativeRounds.has(input.roundId)?this.finalizeNativeAttentionRead(input,actor):this.finalizeMcpAttentionRead(input,actor),
      abort:(id,actor)=>this.nativeRounds.has(id)?this.abortNativeAttentionRead(id,actor):this.abortMcpAttentionRead(id,actor),onError:this.options.onError});
  }
  async getWork(watchId:string,actor:ActivityActor):Promise<ConversationWorkView>{
    this.assertUser(actor);
    if(this.projectSource&&this.options.store.getWatch(watchId)?.source==='kswarm')return this.own(async()=>{await this.ensureProjectWork(watchId,actor);return this.workReader().getWorkForCaller(watchId,actor);});
    return this.own(()=>this.options.attentionReader?this.workReader().getWork(watchId,actor):this.basicGetWork(watchId,actor));
  }
  async dismissAttention(watchId:string,input:AttentionDismiss,actor:ActivityActor):Promise<ConversationWorkView>{
    this.assertUser(actor);
    if(this.projectSource&&this.options.store.getWatch(watchId)?.source==='kswarm')return this.own(async()=>{await this.ensureProjectWork(watchId,actor);return this.workReader().dismissForCaller(watchId,input,actor);});
    return this.own(()=>this.workReader().dismiss(watchId,input,actor));
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

  /** Original owner-only routing invalidation after an acknowledged metadata
   * commit. No source event, unread count, model turn or second notification. */
  publishAttentionChange(watchId:string,actor:ActivityActor):void{
    void this.own(async()=>{
      this.assertUser(actor);const watch=this.options.store.getWatch(watchId);
      if(!watch||watch.origin.profileId!==this.options.profileId)throw Error('activity_watch_forbidden');
      this.thread(watch.origin.threadId);await this.publish({threadId:watch.origin.threadId,watchId});
    }).catch(error=>{try{this.options.onError?.(error);}catch{/* Diagnostic failure cannot undo the committed user dismiss. */}});
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
    return this.own(() => {
      const pending = this.generateReports().finally(() => { if (this.reporting === pending) this.reporting = undefined; });
      this.reporting = pending; return pending;
    });
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
    return this.own(() => {
      const pending = this.deliverNotifications().finally(() => { if (this.notifying === pending) this.notifying = undefined; });
      this.notifying = pending; return pending;
    });
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
      if (failures.length) failed(new AggregateError([...new Set(failures)], 'activity_service_drain_failed'));
      else completed();
    }, failed);
    return this.closing;
  }
  dispose(): void {
    this.disposed = true;
    this.localReaderClient.active=false;this.localReaders?.seal();
    this.nativeRounds.clear();
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
    /** Attached clients must use their own original native repository instead. */
    assertCurrentUserRead?:ConversationActivityService['assertCurrentUserRead'];
    authorizeRead?:ConversationActivityService['authorizeRead'];
    registerMcpReader?:ConversationActivityService['registerMcpReader'];
    prepareMcpReaderAssociation?:ConversationActivityService['prepareMcpReaderAssociation'];
    bindMcpReaderWork?:ConversationActivityService['bindMcpReaderWork'];
    forgetMcpReaderAssociation?:ConversationActivityService['forgetMcpReaderAssociation'];
    dismissAttention?:ConversationActivityService['dismissAttention'];
    close?:ConversationActivityService['close'];
    bindTaskSource?:ConversationActivityService['bindTaskSource'];
    acceptTaskSourceEvent?:ConversationActivityService['acceptTaskSourceEvent'];
    confirmTaskSourceFreshness?:ConversationActivityService['confirmTaskSourceFreshness'];
    taskSourceUnavailable?:ConversationActivityService['taskSourceUnavailable'];
    readProjectSource?:ConversationActivityService['readProjectSource'];
    acceptProjectSourcePage?:ConversationActivityService['acceptProjectSourcePage'];
    invalidateProjectSource?:ConversationActivityService['invalidateProjectSource'];
    flushProjectSource?:ConversationActivityService['flushProjectSource'];
    failProjectSource?:ConversationActivityService['failProjectSource'];
    subscribe(...args: Parameters<ConversationActivityService['subscribe']>): (() => void) | Promise<() => void>;
    subscribeOverview(...args: Parameters<ConversationActivityService['subscribeOverview']>): (() => void) | Promise<() => void>;
  };
