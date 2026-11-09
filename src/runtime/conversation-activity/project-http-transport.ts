import {types} from 'node:util';
import {parseProjectActivityPage,PROJECT_ACTIVITY_BODY_LIMIT,type ParsedProjectActivityPage} from './project-delivery-data.js';
import {assertBeforeEffects} from '../verification/before-effects.js';
import {captureScopedProjectActivityAudience,parseScopedProjectActivityPage,type ScopedProjectActivityAudience,type ParsedScopedProjectActivityPage} from './project-scoped-activity-data.js';

export interface ActivityProjectHttpSubject {readonly projectId:string;readonly sourceDataEpoch:string;readonly after:number}
export interface ActivityProjectHttpRead {readonly subject:ActivityProjectHttpSubject;readonly page:ParsedProjectActivityPage}
type ScopedBinding=Readonly<Pick<ParsedScopedProjectActivityPage,'protocol'|'projectId'|'scope'|'bindingDigest'>>;
export type ActivityScopedProjectHttpRead=ActivityProjectHttpRead&ScopedBinding&{readonly kind:'activity_scoped_project_http_read_v1'};
export type ActivityProjectSourceHttpRead=ActivityProjectHttpRead&{readonly kind:'activity_project_source_http_read_v1';readonly scoped?:ActivityScopedProjectHttpRead};
interface Generation {controller:AbortController;qualification:object;pin?:Promise<string|undefined>}
interface ReadOwner {generation:Generation;signal:AbortSignal;beforeEffects?:()=>void}
interface FrameOwner extends ReadOwner {subject:ActivityProjectHttpSubject;qualification:object;scopedBinding?:ScopedBinding}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function subject(raw:ActivityProjectHttpSubject):ActivityProjectHttpSubject {
  if(!raw||typeof raw!=='object'||types.isProxy(raw)||Object.getOwnPropertySymbols(raw).length)throw Error('activity_project_subject_invalid');
  const fields=Object.getOwnPropertyDescriptors(raw);
  if(Object.keys(fields).length!==3||!['projectId','sourceDataEpoch','after'].every(name=>Object.hasOwn(fields[name]??{},'value')))throw Error('activity_project_subject_invalid');
  const value={projectId:fields.projectId!.value as string,sourceDataEpoch:fields.sourceDataEpoch!.value as string,after:fields.after!.value as number};
  if(typeof value.projectId!=='string'||!value.projectId.length||value.projectId.length>256||typeof value.sourceDataEpoch!=='string'||!value.sourceDataEpoch.length||value.sourceDataEpoch.length>256||!Number.isSafeInteger(value.after)||value.after<0)throw Error('activity_project_subject_invalid');
  return Object.freeze(value);
}
function freeze<T>(value:T):T {
  if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;
}

/** The original daemon metadata HTTP owner. Frames identify a completed read,
 * not project permission or a Core delivery witness. No new polling owner. */
export class ActivityProjectHttpTransport {
  private readonly realm:Readonly<{url:string;mutationToken:string;brokerUrl:string;roomToken:string}>;
  private readonly ownerEpoch:string;
  private readonly fetchOverride?:typeof fetch;
  private readonly assertOwner?:()=>void;
  private readonly onInvalidated?:()=>void;
  private invalidationFailed=false;
  private invalidationFailure?:unknown;
  private generation:Generation={controller:new AbortController(),qualification:Object.freeze({})};
  private readonly lifetime=new AbortController();
  private readonly controlErrors=new WeakSet<object>();
  private readonly frames=new WeakMap<object,FrameOwner>();
  private readonly sourceFrames=new WeakMap<object,ReadOwner&{audience:ScopedProjectActivityAudience}>();
  private readonly raw=new Set<Promise<void>>();
  // Retain actual handles and original errors when cleanup is not known.
  private readonly cleanupUnknown=new Set<{response:Response;reader?:ReadableStreamDefaultReader<Uint8Array>;errors:unknown[]}>();
  private readonly lateFailures:unknown[]=[];
  private closing?:Promise<void>;

  constructor(options:{ownerEpoch:string;kswarm:{url:string;mutationToken:string;brokerUrl:string;roomToken:string};fetch?:typeof fetch;assertCurrent?:()=>void;onInvalidated?:()=>void}) {
    this.realm=Object.freeze({...options.kswarm});this.ownerEpoch=options.ownerEpoch;
    this.fetchOverride=options.fetch;this.assertOwner=options.assertCurrent;this.onInvalidated=options.onInvalidated;
  }
  private control(code:string):Error {const error=Error(code);this.controlErrors.add(error);return error;}
  private current(owner:ReadOwner):void {
    if(this.invalidationFailed)throw this.invalidationFailure;
    if(this.cleanupUnknown.size)throw Error('activity_project_http_cleanup_unknown');
    if(this.lifetime.signal.aborted)throw this.lifetime.signal.reason;
    if(owner.generation!==this.generation||owner.generation.controller.signal.aborted)throw owner.generation.controller.signal.reason??this.control('activity_project_http_stale');
    if(!this.ownerEpoch)throw Error('activity_project_http_owner_invalid');
    owner.signal.throwIfAborted();assertBeforeEffects(this.assertOwner);
    // Fixed hooks may synchronously revoke this very operation.
    if(this.lifetime.signal.aborted)throw this.lifetime.signal.reason;
    if(owner.generation!==this.generation)throw owner.generation.controller.signal.reason;
    owner.signal.throwIfAborted();
  }
  private guard(owner:ReadOwner):void {this.current(owner);assertBeforeEffects(owner.beforeEffects);this.current(owner);}
  invalidate():void {
    const previous=this.generation;this.generation={controller:new AbortController(),qualification:Object.freeze({})};
    previous.controller.abort(this.control('activity_project_http_stale'));
    this.notifyInvalidated();
  }
  private notifyInvalidated():void{
    try{assertBeforeEffects(this.onInvalidated);}catch(error){this.invalidationFailed=true;this.invalidationFailure=error;this.lateFailures.push(error);}
  }
  private capture(signal?:AbortSignal,beforeEffects?:()=>void):ReadOwner {
    const generation=this.generation;
    const owner={generation,signal:AbortSignal.any([this.lifetime.signal,generation.controller.signal,...(signal?[signal]:[])]),beforeEffects};
    this.guard(owner);return owner;
  }
  private own<T>(owner:ReadOwner|undefined,begin:()=>Promise<T>):Promise<T> {
    let done!:()=>void;const reservation=new Promise<void>(resolve=>{done=resolve;});this.raw.add(reservation);
    // Publish raw ownership before any fetch/method getter or fixed callback.
    let result:Promise<T>;try{result=begin();}catch(error){result=Promise.reject(error);}
    void result.then(()=>{this.raw.delete(reservation);done();},error=>{
      if((this.lifetime.signal.aborted||owner?.generation.controller.signal.aborted)&&!(error&&typeof error==='object'&&this.controlErrors.has(error)))this.lateFailures.push(error);
      this.raw.delete(reservation);done();
    });return result;
  }
  private request(owner:ReadOwner,source:'kswarm'|'broker',path:string,limit:number,scoped:false|true|'source'=false):Promise<{data:Record<string,unknown>;instance:string|null;profile:string|null}> {
    return this.own(owner,async()=>{
      const deadline=AbortSignal.timeout(10000),operation={...owner,signal:AbortSignal.any([owner.signal,deadline])};
      let response:Response|undefined,body:ReadableStream<Uint8Array>|null|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
      let exhausted=false,value:{data:Record<string,unknown>;instance:string|null;profile:string|null}|undefined;
      const errors:unknown[]=[];
      let cancelWork:Promise<void>|undefined;
      const cancel=(target:ReadableStream<Uint8Array>|ReadableStreamDefaultReader<Uint8Array>)=>{
        if(cancelWork)return;
        let completed!:()=>void,failed!:(error:unknown)=>void;
        cancelWork=new Promise<void>((resolve,reject)=>{completed=resolve;failed=reject;});void cancelWork.catch(()=>{});
        try{const method=target.cancel;void Promise.resolve(Reflect.apply(method,target,[operation.signal.reason])).then(completed,failed);}catch(error){failed(error);}
      };
      const abort=()=>{if(reader)cancel(reader);};operation.signal.addEventListener('abort',abort);
      try{
        this.guard(operation);const dispatch=this.fetchOverride??globalThis.fetch;this.guard(operation);
        response=await Reflect.apply(dispatch,globalThis,[`${source==='kswarm'?this.realm.url:this.realm.brokerUrl}${path}`,{
          headers:source==='kswarm'?{'x-kswarm-mutation-token':this.realm.mutationToken,...(scoped==='source'?{'x-kswarm-source-read':'project_source_v1'}:scoped?{'x-kswarm-activity-profile':'project_delivery_v1'}:{})}:{'x-intent-broker-room-token':this.realm.roomToken},
          signal:operation.signal,redirect:'error',method:'GET',
        }]);
        this.guard(operation);if(!response!.ok){const status=response!.status;this.guard(operation);throw Error(scoped?'activity_source_http_'+status:'activity_source_request_failed');}this.guard(operation);
        const headers=response!.headers,getHeader=headers.get;this.guard(operation);
        const instance=Reflect.apply(getHeader,headers,['x-kswarm-source-instance']) as string|null;this.guard(operation);
        const profile=Reflect.apply(getHeader,headers,['x-kswarm-activity-profile']) as string|null;this.guard(operation);
        body=response!.body;this.guard(operation);if(!body)throw Error('activity_source_body_missing');
        const acquire=body.getReader;this.guard(operation);reader=Reflect.apply(acquire,body,[]) as ReadableStreamDefaultReader<Uint8Array>;this.guard(operation);
        const chunks:Uint8Array[]=[];let bytes=0;
        for(;;){
          const read=reader!.read;this.guard(operation);const chunk=await Reflect.apply(read,reader,[]);this.guard(operation);
          if(chunk.done){exhausted=true;break;}
          if(!(chunk.value instanceof Uint8Array)||(bytes+=chunk.value.byteLength)>limit)throw Error('activity_source_body_limit');
          chunks.push(chunk.value);
        }
        const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes))) as unknown;
        if(!data||typeof data!=='object'||Array.isArray(data))throw Error('activity_source_body_invalid');
        this.guard(operation);value={data:data as Record<string,unknown>,instance,profile};
      }catch(error){errors.push(error);try{this.current(operation);}catch(control){if(!Object.is(control,error))errors.push(control);}}
      operation.signal.removeEventListener('abort',abort);
      // Cleanup is permitted after revocation and must settle before releasing
      // the reservation. Never retry an unknown cancel or discard its handle.
      const cleanupErrors:unknown[]=[];
      if(response){
        if(!exhausted){
          try{if(reader)cancel(reader);else{body??=response.body;if(body)cancel(body);}}catch(error){cleanupErrors.push(error);}
        }
        if(cancelWork)try{await cancelWork;}catch(error){cleanupErrors.push(error);}
        if(reader)try{const release=reader.releaseLock;Reflect.apply(release,reader,[]);}catch(error){cleanupErrors.push(error);}
        if(cleanupErrors.length){this.cleanupUnknown.add({response,reader,errors:[...errors,...cleanupErrors]});this.notifyInvalidated();}
      }
      errors.push(...cleanupErrors);
      if(errors.length===1)throw errors[0];if(errors.length>1)throw new AggregateError(errors,'activity_source_read_and_cleanup_failed',{cause:errors[0]});
      this.guard(operation);return value!;
    });
  }
  private pin(owner:ReadOwner):Promise<string|undefined> {
    this.guard(owner);const generation=owner.generation;
    if(!generation.pin){
      // A shared health handshake belongs to the generation, not its first
      // caller's cancellation or callback. Its raw ownership is still joined.
      const healthOwner:ReadOwner={generation,signal:AbortSignal.any([this.lifetime.signal,generation.controller.signal])};
      const pending=Promise.resolve().then(async()=>{
        const{data}=await this.request(healthOwner,'kswarm','/health',1024*1024);this.guard(healthOwner);
        const service=data.service as Record<string,unknown>|undefined,id=service?.instanceId;
        if(data.ok!==true)throw Error('activity_source_instance_unavailable');return typeof id==='string'&&uuid.test(id)?id:undefined;
      });
      generation.pin=pending;void pending.catch(()=>{if(generation.pin===pending)generation.pin=undefined;});
    }
    return generation.pin;
  }
  readProject(raw:ActivityProjectHttpSubject,signal?:AbortSignal,beforeEffects?:()=>void):Promise<ActivityProjectHttpRead> {
    return this.own(undefined,async()=>{
      const result=await this.readRound(raw,signal,beforeEffects,false);
      if(result.kind!=='current')throw Error('activity_source_instance_unavailable');
      this.assertProjectRead(result.frame.subject,result.frame);return result.frame;
    });
  }
  /** Original event-feed compatibility. Missing issuer support can never
   * qualify a delivery head or produce the new private read receipt. */
  readCompatibleProject(raw:ActivityProjectHttpSubject,signal?:AbortSignal):Promise<ParsedProjectActivityPage> {
    return this.own(undefined,async()=>{
      const result=await this.readRound(raw,signal,undefined,true);
      if(result.kind==='current'){this.assertProjectRead(result.frame.subject,result.frame);return result.frame.page;}
      if(result.kind==='legacy')return result.page;throw Error('activity_source_profile_unsupported');
    });
  }
  readScopedProject(raw:ScopedProjectActivityAudience,signal?:AbortSignal,beforeEffects?:()=>void):Promise<ActivityScopedProjectHttpRead> {
    return this.own(undefined,async()=>{
      const audience=captureScopedProjectActivityAudience(raw),expected={projectId:audience.projectId,sourceDataEpoch:audience.sourceDataEpoch,after:audience.after};
      const result=await this.readRound(expected,signal,beforeEffects,false,{profileId:audience.profileId,workspaceId:audience.workspaceId});
      if(result.kind!=='current')throw Error('activity_source_instance_unavailable');
      this.assertScopedProjectRead(audience,result.frame);return result.frame as ActivityScopedProjectHttpRead;
    });
  }
  /** One actual GET: ordinary provenance is independent of optional strong
   * metadata qualification. An ordinary frame never grants a delivery head. */
  readProjectSource(raw:ScopedProjectActivityAudience,signal?:AbortSignal,beforeEffects?:()=>void):Promise<ActivityProjectSourceHttpRead>{
    return this.own(undefined,async()=>{
      const audience=captureScopedProjectActivityAudience(raw),expected={projectId:audience.projectId,sourceDataEpoch:audience.sourceDataEpoch,after:audience.after};
      const result=await this.readRound(expected,signal,beforeEffects,true,{profileId:audience.profileId,workspaceId:audience.workspaceId},true);
      if(result.kind!=='source')throw Error('activity_source_profile_unsupported');
      this.assertProjectSourceRead(audience,result.frame);return result.frame;
    });
  }
  assertProjectSourceRead(raw:ScopedProjectActivityAudience,frame:ActivityProjectHttpRead):void{
    const audience=captureScopedProjectActivityAudience(raw),owner=frame&&typeof frame==='object'?this.sourceFrames.get(frame):undefined;
    if(!owner||Object.keys(audience).some(key=>audience[key as keyof typeof audience]!==owner.audience[key as keyof typeof audience]))throw Error('activity_project_read_foreign');
    this.guard(owner);
  }
  private sourceRead(owner:ReadOwner,expected:ActivityProjectHttpSubject,scope:Pick<ScopedProjectActivityAudience,'profileId'|'workspaceId'>,page:ParsedProjectActivityPage,scoped?:ActivityScopedProjectHttpRead):ActivityProjectSourceHttpRead{
    const frame=freeze({kind:'activity_project_source_http_read_v1' as const,subject:expected,page:{...page,delivery:{status:'unavailable' as const,reasonCode:'SNAPSHOT_INCOMPLETE' as const}},...(scoped?{scoped}:{})});
    this.sourceFrames.set(frame,{...owner,audience:freeze({...expected,...scope})});this.guard(owner);return frame;
  }
  private async readRound(raw:ActivityProjectHttpSubject,signal:AbortSignal|undefined,beforeEffects:(()=>void)|undefined,compatible:boolean,scope?:Pick<ScopedProjectActivityAudience,'profileId'|'workspaceId'>,source=false):Promise<{kind:'current';frame:ActivityProjectHttpRead}|{kind:'legacy';page:ParsedProjectActivityPage}|{kind:'source';frame:ActivityProjectSourceHttpRead}> {
    const expected=subject(raw),owner=this.capture(signal,beforeEffects),qualification=owner.generation.qualification,pin=await this.pin(owner);this.guard(owner);
    if(!pin&&!compatible)throw Error('activity_source_instance_unavailable');
    const result=await this.request(owner,'kswarm',`/projects/${encodeURIComponent(expected.projectId)}/activity?after=${expected.after}&limit=200`,PROJECT_ACTIVITY_BODY_LIMIT,source?'source':Boolean(scope));
    this.guard(owner);
    if(pin&&result.instance&&result.instance!==pin){this.invalidate();throw Error('activity_source_instance_changed');}
    if(scope&&result.profile!=='project_delivery_v1'&&!(source&&!result.profile))throw Error('activity_source_profile_unsupported');
    const scopedPage=scope&&result.profile==='project_delivery_v1'?parseScopedProjectActivityPage(result.data,{...expected,...scope}):undefined;
    const page=scopedPage?.page??parseProjectActivityPage(result.data,expected);this.guard(owner);
    if(!pin||!result.instance||qualification!==owner.generation.qualification){
      // Missing protocol support revokes metadata qualification, not the
      // lifetime of independent legal legacy project HTTP requests.
      if(!pin||!result.instance){owner.generation.qualification=Object.freeze({});this.notifyInvalidated();}
      if(!compatible)throw Error('activity_source_instance_changed');
      if(source&&scope)return{kind:'source',frame:this.sourceRead(owner,expected,scope,page)};
      return{kind:'legacy',page:freeze({...page,delivery:{status:'unavailable',reasonCode:'SNAPSHOT_INCOMPLETE'}})};
    }
    const scopedBinding:ScopedBinding|undefined=scopedPage?freeze({protocol:scopedPage.protocol,projectId:scopedPage.projectId,scope:scopedPage.scope,bindingDigest:scopedPage.bindingDigest}):undefined;
    const frame=scopedBinding?freeze({subject:expected,page,kind:'activity_scoped_project_http_read_v1' as const,...scopedBinding}):freeze({subject:expected,page});
    this.frames.set(frame,{...owner,subject:expected,qualification,...(scopedBinding?{scopedBinding}:{})});this.guard(owner);
    if(source&&scope)return{kind:'source',frame:this.sourceRead(owner,expected,scope,page,scopedBinding?frame as ActivityScopedProjectHttpRead:undefined)};
    return{kind:'current',frame};
  }
  assertProjectRead(raw:ActivityProjectHttpSubject,frame:ActivityProjectHttpRead):void {
    const expected=subject(raw),owner=frame&&typeof frame==='object'?this.frames.get(frame):undefined;
    if(!owner||owner.subject.projectId!==expected.projectId||owner.subject.sourceDataEpoch!==expected.sourceDataEpoch||owner.subject.after!==expected.after)throw Error('activity_project_read_foreign');
    const check=()=>{if(owner.qualification!==owner.generation.qualification)throw Error('activity_project_read_not_current');};
    check();this.guard(owner);check();
  }
  assertScopedProjectRead(raw:ScopedProjectActivityAudience,frame:ActivityProjectHttpRead):void {
    const audience=captureScopedProjectActivityAudience(raw),owner=frame&&typeof frame==='object'?this.frames.get(frame):undefined,binding=owner?.scopedBinding;
    if(!binding||binding.protocol!=='scoped_project_activity_v1'||binding.projectId!==audience.projectId||binding.scope.profileId!==audience.profileId||binding.scope.workspaceId!==audience.workspaceId)throw Error('activity_project_read_foreign');
    this.assertProjectRead({projectId:audience.projectId,sourceDataEpoch:audience.sourceDataEpoch,after:audience.after},frame);
  }
  readJson(source:'kswarm'|'broker',path:string,signal?:AbortSignal):Promise<Record<string,unknown>> {
    return this.own(undefined,async()=>{
    if(source==='kswarm'?!/^\/projects\/[^/?#]+\/activity-identity$/.test(path):source!=='broker'||!/^\/rooms\/[^/?#]+$/.test(path))throw Error('activity_source_path_forbidden');
    const owner=this.capture(signal);const result=await this.request(owner,source,path,8*1024*1024);this.guard(owner);return result.data;
    });
  }
  canObserveProject(projectId:string,sourceDataEpoch:string,signal?:AbortSignal):Promise<boolean> {
    return this.own(undefined,async()=>{
    subject({projectId,sourceDataEpoch,after:0});const owner=this.capture(signal);
    const{data:routing}=await this.request(owner,'kswarm',`/projects/${encodeURIComponent(projectId)}/activity-identity`,8*1024*1024);this.guard(owner);
    if(routing.ok!==true||routing.sourceDataEpoch!==sourceDataEpoch||typeof routing.roomId!=='string'||!routing.roomId.length||routing.roomId.length>256)return false;
    const{data:room}=await this.request(owner,'broker',`/rooms/${encodeURIComponent(routing.roomId)}`,8*1024*1024);this.guard(owner);
    return room.ok!==false&&Boolean(room.room);
    });
  }
  close():Promise<void> {
    if(this.closing)return this.closing;
    let completed!:()=>void,failed!:(error:unknown)=>void;
    this.closing=new Promise<void>((resolve,reject)=>{completed=resolve;failed=reject;});
    this.lifetime.abort(this.control('activity_project_http_closed'));this.invalidate();
    void(async()=>{
      while(this.raw.size)await Promise.all([...this.raw]);
      const failures=[...this.lateFailures,...[...this.cleanupUnknown].flatMap(item=>item.errors)];
      if(failures.length)throw new AggregateError([...new Set(failures)],'activity_project_http_cleanup_unknown');
    })().then(completed,failed);return this.closing;
  }
}
