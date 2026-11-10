import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {types} from 'node:util';
import {createIntrinsicSet,appendIntrinsic,aggregateIntrinsicErrors} from '../verification/intrinsic-async-collection.js';
import {assertStandardIpcPromise} from '../verification/native-ipc-promise.js';
import {captureDispatchBusinessData,dispatchBusinessProtocolTag} from './dispatch-business-data.js';
import {bindOriginalSupervisedBusinessEndpoint,type ActivitySourceSupervisor} from './source-supervisor.js';
import type {ActivityOwnerConfig} from './owner-runtime.js';
import {readOwnedKSwarmBusinessRemoteError,type BusinessScope,type KSwarmBusinessAudience,type KSwarmBusinessOperation,type KSwarmPreparationAudience,type KSwarmPreparationWork} from './owned-kswarm-business.js';
const protocol='activity_dispatch_business_v1',configuration='activity_desktop_config_v1';
const P=Promise,then=P.prototype.then,apply=Reflect.apply,freeze=Object.freeze,create=Object.create,define=Object.defineProperty;
const descriptor=Object.getOwnPropertyDescriptor,descriptors=Object.getOwnPropertyDescriptors,prototype=Object.getPrototypeOf,own=Object.hasOwn,keys=Object.keys,assign=Object.assign,json=JSON.stringify,trim=String.prototype.trim;
const proxy=types.isProxy,promiseType=types.isPromise,asyncType=types.isAsyncFunction,asyncPrototype=prototype(async()=>{}),setPrototype=Object.setPrototypeOf;
const NativeWeakMap=WeakMap,NativeAbortController=AbortController,abortSignal=descriptor(AbortController.prototype,'signal')!.get!;
const weakGet=WeakMap.prototype.get,weakSet=WeakMap.prototype.set,weakDelete=WeakMap.prototype.delete;
const ownPromises=new WeakSet<object>(),weakHas=WeakSet.prototype.has,weakAdd=WeakSet.prototype.add;
const species=Symbol.species,initialSpecies=descriptor(P,species),charCode=String.prototype.charCodeAt;
const births=new NativeWeakMap<object,{configFile:string;channel:object;send:Function;used:boolean}>();let minted=false;
export interface CanonicalBusinessTargetAudience {readonly scope:BusinessScope;readonly targetGeneration:number;readonly childBoot:string}
export interface CanonicalBusinessCommand {readonly op:KSwarmBusinessOperation;readonly projectId:string;readonly input:unknown;readonly signal:AbortSignal;assertCurrent():void}
export type CanonicalPreparationOperation='read_preparation_basis'|'prepare_intent'|'admit_send'|'read_prepare_call'|'ack_prepared'|'register_host'|'finish_host_no_effect';
export interface CanonicalPreparationBinding {readonly workId:string;readonly sourceIncarnation:string;readonly projectId:string;readonly lookup:{childKey:string;payloadHash:string};readonly signal:AbortSignal;readonly custody:object;assertAudience(audience:KSwarmPreparationAudience):void;resolveHost(audience:KSwarmPreparationAudience,settling:boolean):unknown;observeProducer(observer:(cut:unknown)=>void):void;sealProducer():void}
export interface CanonicalPreparationCommand {readonly workProof:object;readonly operation:CanonicalPreparationOperation;readonly input:unknown;assertCurrent():void}
export interface CanonicalSupervisedBusinessPort {
 readonly ownerEpoch:string;
 prepare(scope:BusinessScope):Promise<CanonicalBusinessTargetAudience>;
 assertCurrent(audience:object):void;
 invoke(audience:object,command:object,requestSource:'user'|'agent'|'scheduler'):Promise<unknown>;
 assertPreparationCurrent(audience:object):void;
 assertSettlementCurrent(audience:object):void;
 openPreparationWork(audience:object,workProof:object):KSwarmPreparationWork;
 invokePreparation(audience:object,command:object):Promise<unknown>;
 sealAndDrain():Promise<void>;
 configBound():boolean;
}
interface Root {raw?:unknown;unknown:boolean;done:boolean;completion:Promise<void>;listeners:Array<()=>void>;complete():void}
interface Send extends Root {returned:boolean;callback:boolean;rawDone:boolean;invoked:boolean;value:unknown}
interface Invocation extends Root {frame:Record<string,any>;executing:boolean;admitted:boolean;target?:CanonicalBusinessTargetAudience;sending?:Send}
interface EndpointIdentity {supervisor:object;revokeTarget():void;observeTargetClose(target:object|undefined,settled:()=>void):void;observeClose(settled:(error?:unknown)=>void):void;read(command:object,target:object,audience?:KSwarmBusinessAudience):CanonicalBusinessCommand;readPreparation(work:object,target:object):CanonicalPreparationBinding;readPreparationCommand(command:object,target:object):CanonicalPreparationCommand}
const endpoints=new NativeWeakMap<object,EndpointIdentity>();
const inert=<T extends object>(value:T):T=>setPrototype(value,null);
const sync=(fn:unknown):fn is Function=>typeof fn==='function'&&!proxy(fn)&&!asyncType(fn)&&prototype(fn)!==asyncPrototype;
function method(object:object,name:string):unknown{let cursor:object|null=object;for(let i=0;cursor&&i<16;i++){if(proxy(cursor))return;const row=descriptor(cursor,name);if(row)return own(row,'value')?row.value:undefined;cursor=prototype(cursor);}return;}
function samePath(a:string,b:string){try{return realpathSync.native(a)===realpathSync.native(b);}catch{return false;}}
function deferred<T>(){let resolve!:(value:T|PromiseLike<T>)=>void,reject!:(error:unknown)=>void;const promise=new P<T>((yes,no)=>{resolve=yes;reject=no;});define(promise,'constructor',{__proto__:null,value:P} as PropertyDescriptor);apply(weakAdd,ownPromises,[promise]);return{promise,resolve,reject};}
function internal<T>(raw:Promise<T>):Promise<T>{define(raw,'constructor',{__proto__:null,value:P} as PropertyDescriptor);apply(weakAdd,ownPromises,[raw]);return raw;}
function standard(raw:unknown,internalAllowed=false):raw is Promise<unknown>{
 try{if(!raw||typeof raw!=='object'||proxy(raw)||descriptor(raw,'then'))return false;
  if(internalAllowed&&apply(weakHas,ownPromises,[raw])){const ctor=descriptor(raw,'constructor'),current=descriptor(P,species);return promiseType(raw)&&prototype(raw)===P.prototype&&!!ctor&&own(ctor,'value')&&ctor.value===P&&!!current&&!!initialSpecies&&!own(current,'value')&&current.get===initialSpecies.get&&current.set===initialSpecies.set;}
  assertStandardIpcPromise(raw,'activity_business_raw_unknown');return true;
 }catch{return false;}
}
const exact=(value:any,names:readonly string[])=>{if(!value||typeof value!=='object'||Array.isArray(value)||keys(value).length!==names.length)return false;for(let i=0;i<names.length;i++)if(!own(value,names[i]!))return false;return true;};
function hex(value:unknown):value is string{if(typeof value!=='string'||value.length!==64)return false;for(let i=0;i<64;i++){const c=apply(charCode,value,[i]);if(!(c>=48&&c<=57||c>=97&&c<=102))return false;}return true;}
function nonce(){const b=randomBytes(32),alphabet='0123456789abcdef';let out='';for(let i=0;i<b.length;i++)out+=alphabet[b[i]!>>>4]!+alphabet[b[i]!&15]!;return out;}
const validScope=(value:any):value is BusinessScope=>exact(value,['profileId','workspaceId'])&&hex(value.profileId)&&hex(value.workspaceId);
const sameScope=(a:BusinessScope,b:BusinessScope)=>a.profileId===b.profileId&&a.workspaceId===b.workspaceId;
const invalid=()=>Error('activity_business_protocol_invalid');
/** Canonical inherited-parent birth only. This is not NativeMain provenance
 * or a user action. A role DTO and an imported module cannot manufacture it. */
export function mintCanonicalDesktopBusinessBirth():object|undefined{
 if(minted||!process.argv[1]||!process.argv[2]||!samePath(process.argv[1],fileURLToPath(new URL('./owner-entry.js',import.meta.url))))return;
 const channel=process.channel,send=method(process,'send');if(!channel||process.connected!==true||!sync(send))return;
 const birth=freeze(create(null));apply(weakSet,births,[birth,{configFile:realpathSync.native(process.argv[2]),channel,send,used:false}]);minted=true;return birth;
}
/** Membership before candidate properties; used only by the original
 * supervisor binding, never to mint a command from wire/history data. */
export function assertCanonicalBusinessEndpoint(endpoint:object,supervisor:object):void{
 const row=apply(weakGet,endpoints,[endpoint]) as EndpointIdentity|undefined;if(!row||row.supervisor!==supervisor)throw Error('activity_business_original_endpoint_required');
}
export function readCanonicalBusinessCommand(endpoint:object,supervisor:object,command:object,target:object,audience?:KSwarmBusinessAudience):CanonicalBusinessCommand{
 const row=apply(weakGet,endpoints,[endpoint]) as EndpointIdentity|undefined;if(!row||row.supervisor!==supervisor)throw Error('activity_business_original_endpoint_required');return row.read(command,target,audience);
}
export function readCanonicalPreparationBinding(endpoint:object,supervisor:object,work:object,target:object):CanonicalPreparationBinding{
 const row=apply(weakGet,endpoints,[endpoint]) as EndpointIdentity|undefined;if(!row||row.supervisor!==supervisor)throw Error('activity_business_original_endpoint_required');return row.readPreparation(work,target);
}
export function readCanonicalPreparationCommand(endpoint:object,supervisor:object,command:object,target:object):CanonicalPreparationCommand{
 const row=apply(weakGet,endpoints,[endpoint]) as EndpointIdentity|undefined;if(!row||row.supervisor!==supervisor)throw Error('activity_business_original_endpoint_required');return row.readPreparationCommand(command,target);
}
export interface CanonicalDesktopBusinessEndpoint {start():void;seal():void;sealAndDrain():Promise<void>}
/** The original endpoint owns this physical completion, including future sends.
 * Caller Promise objects are never accepted as completion evidence. */
export function observeCanonicalDesktopBusinessClose(endpoint:object,settled:(error?:unknown)=>void):void{
 const entry=apply(weakGet,endpoints,[endpoint]) as EndpointIdentity|undefined;if(!entry)throw Error('activity_business_original_endpoint_required');entry.observeClose(settled);
}
export function revokeCanonicalBusinessTarget(endpoint:object,supervisor:object):void{
 const entry=apply(weakGet,endpoints,[endpoint]) as EndpointIdentity|undefined;if(!entry||entry.supervisor!==supervisor)throw Error('activity_business_original_endpoint_required');entry.revokeTarget();
}
export function observeCanonicalBusinessTargetClose(endpoint:object,supervisor:object,target:object|undefined,settled:()=>void):void{
 const entry=apply(weakGet,endpoints,[endpoint]) as EndpointIdentity|undefined;if(!entry||entry.supervisor!==supervisor)throw Error('activity_business_original_endpoint_required');entry.observeTargetClose(target,settled);
}
/** The owner stores this passive controller before start performs SDK work. */
export function bindCanonicalDesktopBusinessBirth(birth:object,supervisor:ActivitySourceSupervisor,configFile:string,config:ActivityOwnerConfig):CanonicalDesktopBusinessEndpoint{
 const born=apply(weakGet,births,[birth]) as {configFile:string;channel:object;send:Function;used:boolean}|undefined;
 if(!born||born.used)throw Error('activity_business_original_birth_required');
 if(config.identity.kind!=='desktop'||!samePath(configFile,born.configFile)||!process.argv[2]||!samePath(configFile,process.argv[2])||process.channel!==born.channel||process.connected!==true||method(process,'send')!==born.send)throw Error('activity_business_original_birth_required');born.used=true;
 const roots=createIntrinsicSet<Root>(),sends=createIntrinsicSet<Send>(),tails=createIntrinsicSet<Root>(),unknown=createIntrinsicSet<unknown>(),errors:unknown[]=[],cleanups:Array<()=>void>=[];
 const commands=new NativeWeakMap<object,{row:Invocation;command:CanonicalBusinessCommand}>();
 interface Work {physical:ReturnType<typeof createIntrinsicSet<Root>>;proof:object;custody:object;producer:Root;target:CanonicalBusinessTargetAudience;projectId:string;lookup:{childKey:string;payloadHash:string};workId:string;incarnation:string;abort:AbortController;binding:CanonicalPreparationBinding;lower?:KSwarmPreparationWork;current?:CanonicalPreparationCommand;opening:boolean;operations:number;closed:boolean;unknown:boolean;ackRegistered:boolean;hostRef?:object;hostFinishRegistered?:boolean;hostFinishing?:boolean;observer?:((cut:unknown)=>void);cutDelivered:boolean}
 const works=createIntrinsicSet<Work>(),byWork=new NativeWeakMap<object,Work>(),preparationCommands=new NativeWeakMap<object,{work:Work;command:CanonicalPreparationCommand}>();
 let producerFrontierClosed=false;
 let port:CanonicalSupervisedBusinessPort,started=false,starting=false,sealed=false,terminal=false,disposed=false,probeAccepted=false,faultSent=false;
 let scope:BusinessScope|undefined,target:CanonicalBusinessTargetAudience|undefined,session:Record<string,any>|undefined,probeRoot:Root|undefined,prefix:Root|undefined,sequence=0;
 let closing:Promise<void>|undefined;const boot=nonce();
 const remember=(error:unknown)=>appendIntrinsic(errors,error);
 function fail(error:unknown){terminal=true;sealed=true;remember(error);closePreparationFrontier();}
 function notify(row:Root){const callbacks=row.listeners;row.listeners=[];for(let i=0;i<callbacks.length;i++)callbacks[i]!();}
 function unconfirmed(row:Root,raw:unknown){row.unknown=true;unknown.add(raw);notify(row);}
 function root(collection=roots):Root{const done=deferred<void>(),row:Root=inert({raw:undefined,unknown:false,done:false,completion:done.promise,listeners:[],complete(){if(row.done)return;row.done=true;collection.delete(row);done.resolve();notify(row);}});collection.add(row);return row;}
 function retain(raw:unknown,finished?:()=>void){const row=root(tails);row.raw=raw;if(!standard(raw)){unconfirmed(row,raw);return;}try{apply(then,raw,[()=>{row.complete();finished?.();},(error:unknown)=>{fail(error);row.complete();finished?.();}]);}catch(error){unconfirmed(row,raw);fail(error);}}
 function checked<T>(raw:Promise<T>):Promise<T>{if(!standard(raw,true)){retain(raw);throw Error('activity_business_internal_tail_unknown');}return raw;}
 function observe(row:Root,work:()=>Promise<void>){try{const raw=work();row.raw=raw;if(!promiseType(raw)||proxy(raw)||prototype(raw)!==P.prototype)throw Error('activity_business_internal_tail_unknown');internal(raw);if(!standard(raw,true))throw Error('activity_business_internal_tail_unknown');apply(then,raw,[()=>row.complete(),(error:unknown)=>{fail(error);row.complete();}]);}catch(error){unconfirmed(row,row.raw);fail(error);}}
 const data=(raw:unknown)=>captureDispatchBusinessData(raw,value=>{retain(value);fail(Error('activity_business_wire_unconfirmed'));});
 function channelCurrent(){if(process.channel!==born!.channel||process.connected!==true)throw Error('activity_business_closed');}
 function live(){channelCurrent();if(terminal)throw Error('activity_business_closed');}
 function join(rows:readonly Root[]):Promise<void>{const result=deferred<void>();let remaining=rows.length;if(!remaining){result.resolve();return result.promise;}
  for(let i=0;i<rows.length;i++){const row=rows[i]!;let counted=false;const check=()=>{if(!counted&&(row.done||row.unknown)){counted=true;if(--remaining===0)result.resolve();}};if(!row.done&&!row.unknown)appendIntrinsic(row.listeners,check);check();}return result.promise;
 }
 function errorData(error:unknown,depth=0):Record<string,unknown>{
  if(!error||typeof error!=='object'||proxy(error)||depth>4)return inert({name:'Error',message:'activity business failed',code:'ACTIVITY_BUSINESS_ERROR',durableCommitted:false});
  const fields=descriptors(error),read=(key:string)=>fields[key]&&own(fields[key]!,'value')?fields[key]!.value:undefined;
  // A failure from the original lower client has already validated this DTO.
  // Preserve its origin truth, never promote it to a local Native SQL brand.
  const remote=readOwnedKSwarmBusinessRemoteError(error);if(remote){
   const closed=data(remote) as Record<string,unknown>;if(typeof closed.durableCommitted==='boolean'&&typeof closed.code==='string'&&typeof closed.message==='string'&&typeof closed.name==='string')return closed;
  }
  const text=(key:string,fallback:string)=>typeof read(key)==='string'?(read(key) as string).slice(0,2048):fallback;
  return inert({name:text('name','Error'),message:text('message','activity business failed'),code:text('code','ACTIVITY_BUSINESS_ERROR'),durableCommitted:false,...(read('cause')&&depth<4?{cause:errorData(read('cause'),depth+1)}:{})});
 }
 function publish(frame:Record<string,unknown>):Send{
  const base=root(sends as unknown as ReturnType<typeof createIntrinsicSet<Root>>),row=Object.assign(base,{returned:false,callback:false,rawDone:true,invoked:false,value:undefined}) as Send;
  const finish=()=>{if(row.done||!row.returned||!row.rawDone||row.invoked&&!row.callback)return;row.complete();};
  try{
   const outgoing=data(frame);channelCurrent();row.invoked=true;const callback=root(tails);
   const raw=apply(born!.send,process,[outgoing,(error:Error|null)=>{row.callback=true;callback.complete();if(error)fail(error);finish();}]);row.value=raw;
   if(raw!==true&&raw!==false){row.rawDone=false;fail(Error('activity_business_send_return_unknown'));if(!standard(raw))unconfirmed(row,raw);retain(raw,()=>{row.rawDone=true;finish();});}
   row.returned=true;finish();
  }catch(error){row.returned=true;fail(error);if(row.invoked)unconfirmed(row,error);finish();}return row;
 }
 function common(){if(!session)throw invalid();return session;}
 function frame(type:string,values:Record<string,unknown>={}){return{...common(),type,...values};}
 function sessionMatches(row:Record<string,any>){if(!session)throw invalid();const names=keys(session);for(let i=0;i<names.length;i++){const key=names[i]!;if(key==='scope'){if(!validScope(row.scope)||!sameScope(row.scope,scope!))throw invalid();}else if(row[key]!==session[key])throw invalid();}}
 function finishProducer(work:Work){
  if(work.unknown||work.operations||!work.closed&&!producerFrontierClosed)return;
  if(work.hostRef)return;
  work.closed=true;if(!work.observer){if(!work.opening)work.producer.complete();return;}if(work.cutDelivered)return;
  work.cutDelivered=true;
  try{const raw=apply(work.observer,undefined,[freeze({disposition:work.hostFinishRegistered?'host_no_effect_registered':work.ackRegistered?'ack_registered':'no_ack'})]);if(raw!==undefined){retain(raw);work.unknown=true;unknown.add(raw);fail(Error('activity_preparation_observer_unknown'));return;}work.producer.complete();}
  catch(error){work.unknown=true;unknown.add(error);fail(error);}
 }
 function closePreparationFrontier(){producerFrontierClosed=true;const all=works.snapshot();for(let i=0;i<all.length;i++)finishProducer(all[i]!);}
 function currentWork(work:Work,continuation=false,settling=false){
  live();if(work.closed||work.unknown||work.target!==target||!works.has(work)||!continuation&&sealed)throw Error('activity_preparation_work_revoked');
  if(settling)port.assertSettlementCurrent(work.target);else port.assertPreparationCurrent(work.target);live();if(work.closed||work.unknown||work.target!==target||!continuation&&sealed)throw Error('activity_preparation_work_revoked');
 }
 function selectWork(row:Record<string,any>):Work{
  const all=works.snapshot();for(let i=0;i<all.length;i++){const work=all[i]!;if(work.workId===row.workId){if(work.incarnation!==row.sourceIncarnation||work.projectId!==row.projectId||work.target!==target)throw Error('activity_preparation_work_mismatch');return work;}}
  if(sealed||producerFrontierClosed||row.op!=='read_preparation_basis'||all.length>=64||!target)throw Error('activity_preparation_work_unavailable');
  if(!exact(row.input,['childKey','payloadHash'])||typeof row.input.childKey!=='string'||!hex(row.input.payloadHash))throw invalid();
  for(let i=0;i<all.length;i++)if(all[i]!.projectId===row.projectId&&all[i]!.lookup.childKey===row.input.childKey&&all[i]!.incarnation===row.sourceIncarnation)throw Error('activity_preparation_child_already_bound');
  const producer=root();define(producer,'target',{__proto__:null,value:target} as PropertyDescriptor);
  const work:Work=inert({physical:createIntrinsicSet<Root>(),proof:freeze(create(null)),custody:freeze(create(null)),producer,target,projectId:row.projectId,lookup:row.input,workId:row.workId,incarnation:row.sourceIncarnation,abort:new NativeAbortController(),binding:undefined as unknown as CanonicalPreparationBinding,opening:false,operations:0,closed:false,unknown:false,ackRegistered:false,cutDelivered:false});
  work.binding=freeze({workId:work.workId,sourceIncarnation:work.incarnation,projectId:work.projectId,lookup:work.lookup,signal:apply(abortSignal,work.abort,[]) as AbortSignal,custody:work.custody,
   assertAudience(audience:KSwarmPreparationAudience){
    const opening=audience.operation==='open_work',operation=work.current;
    if(audience.projectId!==work.projectId||!sameScope(audience.scope,scope!)||audience.serviceOwner!==supervisor||audience.workId!==undefined&&audience.workId!==work.workId||audience.sourceIncarnation!==undefined&&audience.sourceIncarnation!==work.incarnation)throw Error('activity_preparation_audience_mismatch');
    if(opening){if(!work.opening||json(audience.input)!==json(work.lookup))throw Error('activity_preparation_open_required');}
    else if(!operation||audience.operation!==operation.operation||json(audience.input)!==json(operation.input))throw Error('activity_preparation_operation_required');
    currentWork(work,!opening&&(operation?.operation==='read_prepare_call'||operation?.operation==='ack_prepared'||operation?.operation==='finish_host_no_effect'),operation?.operation==='finish_host_no_effect');
   },
   resolveHost(audience:KSwarmPreparationAudience,settling:boolean){
    const command=work.current,operation=settling?'finish_host_no_effect':'register_host';
    if(!command||command.operation!==operation||audience.operation!==operation||audience.projectId!==work.projectId||audience.serviceOwner!==supervisor||!sameScope(audience.scope,scope!)||audience.workId!==work.workId||audience.sourceIncarnation!==work.incarnation||audience.input!==null)throw Error('activity_preparation_host_command_required');
    command.assertCurrent();return freeze({data:command.input,assertCurrent:command.assertCurrent});
   },
   observeProducer(observer:(cut:unknown)=>void){if(!sync(observer)||work.observer)throw Error('activity_preparation_original_observer_required');work.observer=observer;finishProducer(work);},
   sealProducer(){/* Only the actual upper ingress frontier closes future ACK publishing. */finishProducer(work);}
  });works.add(work);apply(weakSet,byWork,[work.proof,work]);return work;
 }
 function responseValues(row:Record<string,any>,values:Record<string,unknown>){return{id:row.id,op:row.op,projectId:row.projectId,...(row.family==='preparation'?{family:'preparation',workId:row.workId,sourceIncarnation:row.sourceIncarnation}:{}),...values};}
 function probe(row:Record<string,any>){
  if(probeAccepted||sealed||!exact(row,['protocol','type','scope','mainLaunchNonce'])||!validScope(row.scope)||!hex(row.mainLaunchNonce))throw invalid();
  probeAccepted=true;scope=row.scope;const invocation=root();probeRoot=invocation;
  observe(invocation,async()=>{
   try{
    live();target=await checked(port.prepare(scope!));live();port.assertCurrent(target);
    session=data({protocol,scope,mainLaunchNonce:row.mainLaunchNonce,daemonBoot:boot,ownerEpoch:port.ownerEpoch,connectionIncarnation:nonce(),targetGeneration:target.targetGeneration,childBoot:target.childBoot}) as Record<string,any>;
    await checked(publish(frame('hello_ack')).completion);
   }catch(error){fail(error);await checked(publish({protocol,type:'unavailable',scope,mainLaunchNonce:row.mainLaunchNonce,error:errorData(error)}).completion);}
  });
 }
 function execute(row:Record<string,any>){
  const invocation=assign(root(),{frame:row,executing:false,admitted:!sealed&&!terminal,target,sending:undefined}) as Invocation;
  observe(invocation,async()=>{
   let commandFrame:object|undefined,work:Work|undefined,preparationCommand:CanonicalPreparationCommand|undefined;
   function releasePreparationOperation(){if(work&&preparationCommand&&work.current===preparationCommand){work.current=undefined;work.operations--;invocation.executing=false;if(commandFrame)apply(weakDelete,preparationCommands,[commandFrame]);if(work.ackRegistered)work.closed=true;finishProducer(work);}}
   function deliveryCurrent(){live();if(!roots.has(invocation)||invocation.target!==target)throw Error('activity_preparation_delivery_revoked');if(row.op==='finish_host_no_effect')port.assertSettlementCurrent(invocation.target!);else port.assertPreparationCurrent(invocation.target!);live();if(!roots.has(invocation)||invocation.target!==target)throw Error('activity_preparation_delivery_revoked');}
   try{
    if(probeRoot)await checked(probeRoot.completion);live();
    if(row.family==='preparation'){
     work=selectWork(row);const settling=row.op==='finish_host_no_effect',continuation=row.op==='read_prepare_call'||row.op==='ack_prepared'||settling;currentWork(work,continuation,settling);
     // Refuse an unissued ACK before terminal reservation or lower SDK.
     // Its actual reply still belongs to this Work's physical prior frontier.
     if(row.op==='ack_prepared'&&work.hostRef){
      work.physical.add(invocation);appendIntrinsic(invocation.listeners,()=>{if(invocation.done&&!invocation.unknown)work!.physical.delete(invocation);});
      deliveryCurrent();invocation.sending=publish(frame('response',responseValues(row,{result:{ok:false,error:'activity_preparation_host_ack_unavailable',notInvoked:true}})));await checked(invocation.sending.completion);return;
     }
     if(row.op==='register_host'){if(work.hostRef||work.hostFinishing)throw Error('activity_preparation_host_already_registered');work.hostRef=freeze(create(null));}
     if(settling){if(!work.hostRef||work.hostFinishing||work.ackRegistered)throw Error('activity_preparation_host_required');work.hostFinishing=true;}
     if(!settling&&work.hostFinishing)throw Error('activity_preparation_host_effect_stopped');
     const prior=work.physical.snapshot(),priorTails=tails.snapshot();for(let i=0;i<priorTails.length;i++)appendIntrinsic(prior,priorTails[i]!);
     work.physical.add(invocation);appendIntrinsic(invocation.listeners,()=>{if(invocation.done&&!invocation.unknown)work!.physical.delete(invocation);});
     if(settling){await checked(join(prior));for(let i=0;i<prior.length;i++)if(prior[i]!.unknown||!prior[i]!.done)throw Error('activity_preparation_host_prior_unconfirmed');currentWork(work,true,true);}
     if(work.operations)throw Error('activity_preparation_busy');work.operations++;invocation.executing=true;
     commandFrame=freeze(create(null));const original=work;
     const command:CanonicalPreparationCommand=freeze({workProof:work.proof,operation:row.op,input:row.input,assertCurrent(){currentWork(original,continuation,row.op==='finish_host_no_effect');if(original.current!==command||!invocation.executing)throw Error('activity_preparation_command_revoked');}});
     preparationCommand=command;work.current=command;apply(weakSet,preparationCommands,[commandFrame,{work,command}]);
     if(!work.lower){work.opening=true;try{work.lower=port.openPreparationWork(target!,work.proof);}finally{work.opening=false;}}
     const result=await checked(port.invokePreparation(target!,commandFrame!));command.assertCurrent();
     if(row.op==='ack_prepared')work.ackRegistered=true;
     if(row.op==='register_host'&&(result as any)?.ok!==true){work.unknown=true;throw Error('activity_preparation_host_registration_unconfirmed');}
     if(row.op==='finish_host_no_effect'){if((result as any)?.ok!==true){work.unknown=true;throw Error('activity_preparation_host_finish_unconfirmed');}work.hostRef=undefined;work.hostFinishRegistered=true;}
     releasePreparationOperation();deliveryCurrent();
     invocation.sending=publish(frame('response',responseValues(row,{result})));await checked(invocation.sending.completion);return;
    }
    port.assertCurrent(target!);
    if(!invocation.admitted){invocation.sending=publish(frame('response',{id:row.id,op:row.op,projectId:row.projectId,result:{ok:false,error:'activity_business_closed',notInvoked:true}}));await checked(invocation.sending.completion);return;}
    invocation.executing=true;commandFrame=freeze(create(null));const abort=new NativeAbortController();
    const command:CanonicalBusinessCommand=freeze({op:row.op,projectId:row.projectId,input:row.input,signal:apply(abortSignal,abort,[]) as AbortSignal,assertCurrent(){live();if(!invocation.executing||!roots.has(invocation)||invocation.target!==target)throw Error('activity_business_command_revoked');port.assertCurrent(invocation.target!);live();if(!invocation.executing||!roots.has(invocation)||invocation.target!==target)throw Error('activity_business_command_revoked');}});
    apply(weakSet,commands,[commandFrame,{row:invocation,command}]);
    const result=await checked(port.invoke(target!,commandFrame!,'user'));live();command.assertCurrent();
    invocation.sending=publish(frame('response',{id:row.id,op:row.op,projectId:row.projectId,result}));await checked(invocation.sending.completion);
   }catch(error){
    // Preserve the original lower cause before any caller lifetime test and
    // reserve this error publication in the same original invocation Root.
    fail(error);if(probeAccepted&&session){invocation.sending=publish(frame('response',responseValues(row,{error:errorData(error)})));await checked(invocation.sending.completion);}
   }finally{invocation.executing=false;if(commandFrame){apply(weakDelete,commands,[commandFrame]);apply(weakDelete,preparationCommands,[commandFrame]);}releasePreparationOperation();}
  });
 }
 function sealPrefix(row:Record<string,any>){
  if(prefix||!Number.isSafeInteger(row.throughId)||row.throughId!==sequence||!hex(row.sealNonce))throw invalid();sealed=true;closePreparationFrontier();const cut=roots.snapshot(),pending=sends.snapshot(),reservation=root();prefix=reservation;
  observe(reservation,async()=>{
   await checked(join(cut));await checked(join(pending));await checked(join(tails.snapshot()));
   try{await checked(port.sealAndDrain());}catch(error){fail(error);}
   await checked(join(sends.snapshot()));if(terminal||unknown.size)return;live();
   const sent=publish(frame('prefix_drained',{throughId:row.throughId,sealNonce:row.sealNonce}));await checked(sent.completion);
  });
 }
 const onMessage=(raw:unknown,handle:unknown)=>{
  if(handle!==undefined&&handle!==null){retain(handle);fail(Error('activity_business_transfer_handle_unknown'));return;}
  if(dispatchBusinessProtocolTag(raw)===configuration&&port.configBound())return;
  // Closed admission cannot extend a previously selected output frontier.
  // Original Invocation Roots already own their remaining response publishers.
  if(closing||disposed||terminal)return;
  try{
   const row=data(raw) as Record<string,any>;if(row.protocol!==protocol||!started||starting||disposed)throw invalid();
   if(row.type==='probe'){probe(row);return;}sessionMatches(row);
   const base=keys(common());
   if(row.type==='seal_prefix'){if(!exact(row,[...base,'type','throughId','sealNonce']))throw invalid();sealPrefix(row);return;}
   const preparation=row.family==='preparation',fields=[...base,'type','id','op','projectId','input'];
   if(preparation)fields.push('family','workId','sourceIncarnation');
   if(prefix||!exact(row,fields)||row.type!=='request'||!Number.isSafeInteger(row.id)||row.id!==sequence+1||(preparation?(!hex(row.workId)||!hex(row.sourceIncarnation)||row.op!=='read_preparation_basis'&&row.op!=='prepare_intent'&&row.op!=='admit_send'&&row.op!=='read_prepare_call'&&row.op!=='ack_prepared'&&row.op!=='register_host'&&row.op!=='finish_host_no_effect'):(row.op!=='read_plan'&&row.op!=='capture_default_dispatch'&&row.op!=='read_operation'))||typeof row.projectId!=='string'||!row.projectId||row.projectId.length>256||apply(trim,row.projectId,[])!==row.projectId||row.projectId.includes('\0')||row.op==='read_plan'&&row.input!==null)throw invalid();
   sequence=row.id;execute(row);
  }catch(error){fail(error);if(probeAccepted&&!faultSent){faultSent=true;publish({protocol,type:'fault',error:errorData(error)});}}
 };
 const disconnected=()=>{fail(Error('activity_business_parent_disconnected'));const raw=sealAndDrain();try{if(!standard(raw,true)){unknown.add(raw);return;}apply(then,raw,[()=>{},()=>{}]);}catch(error){unknown.add(raw);remember(error);}};
 const processError=(error:unknown)=>fail(error);
 function cleanup(final=false){if(disposed&&!final||starting)return;disposed=true;for(let i=0;i<cleanups.length;i++)try{cleanups[i]!();}catch(error){fail(error);}}
 function seal(){sealed=true;}
 function start(){
  if(started||sealed)return;started=true;starting=true;const setup=root();
  try{
   const on=method(process,'on'),off=method(process,'off');if(!sync(on)||!sync(off)||!sync(born!.send))throw Error('activity_business_synchronous_sdk_required');
   const listeners=[['message',onMessage],['disconnect',disconnected],['error',processError]] as const;
   for(let i=0;i<listeners.length;i++){
    const [event,handler]=listeners[i]!;appendIntrinsic(cleanups,()=>{const raw=apply(off,process,[event,handler]);if(raw!==process){retain(raw);fail(Error('activity_business_off_unknown'));}});
    const raw=apply(on,process,[event,handler]);if(raw!==process){retain(raw);throw Error('activity_business_on_unknown');}if(sealed)throw Error('activity_business_closed');
   }
  }catch(error){fail(error);}finally{starting=false;if(terminal)cleanup();setup.complete();}
 }
 function sealAndDrain():Promise<void>{
  if(closing)return closing;const result=deferred<void>();closing=result.promise;seal();closePreparationFrontier();const cut=roots.snapshot(),initial=sends.snapshot(),draining=root();
  observe(draining,async()=>{
   try{
    await checked(join(cut));await checked(join(initial));try{await checked(port.sealAndDrain());}catch(error){remember(error);}
    await checked(join(sends.snapshot()));await checked(join(tails.snapshot()));cleanup(true);await checked(join(tails.snapshot()));
    if(unknown.size||errors.length)throw aggregateIntrinsicErrors(errors,'activity_business_drain_unconfirmed');result.resolve();
   }catch(error){cleanup();try{await checked(join(sends.snapshot()));await checked(join(tails.snapshot()));}catch(sibling){remember(sibling);}result.reject(error);}
  });return result.promise;
 }
 const controller=freeze({start,seal,sealAndDrain});
 apply(weakSet,endpoints,[controller,{supervisor,revokeTarget(){if(probeAccepted)fail(Error('activity_business_target_revoked'));},observeTargetClose(expected:object|undefined,settled:()=>void){
  const all=roots.snapshot(),selected:Root[]=[];for(let i=0;i<all.length;i++){const row=all[i]!;if(row===probeRoot||own(row,'target')&&(row as Invocation).target===expected)appendIntrinsic(selected,row);}
  // Prefix and endpoint-close Roots are deliberately excluded: both can be
  // awaiting this retirement. An Invocation owns its future upper send.
  const raw=join(selected);try{if(!standard(raw,true)){unknown.add(raw);return;}apply(then,raw,[()=>{if(!unknown.size)settled();},(error:unknown)=>{unknown.add(raw);fail(error);}]);}catch(error){unknown.add(raw);fail(error);}
 },observeClose(settled:(error?:unknown)=>void){const raw=sealAndDrain();if(!standard(raw,true)){unknown.add(raw);fail(Error('activity_business_close_observer_unknown'));return;}try{apply(then,raw,[()=>settled(),(error:unknown)=>settled(error)]);}catch(error){unknown.add(raw);fail(error);}},read(commandFrame:object,expectedTarget:object,audience?:KSwarmBusinessAudience){
  const entry=apply(weakGet,commands,[commandFrame]) as {row:Invocation;command:CanonicalBusinessCommand}|undefined;
  if(!entry||entry.row.target!==expectedTarget)throw Error('activity_business_original_command_required');entry.command.assertCurrent();
  if(audience&&(audience.operation!==entry.command.op||audience.projectId!==entry.command.projectId||!sameScope(audience.scope,scope!)))throw Error('activity_business_command_audience_mismatch');return entry.command;
 },readPreparation(proof:object,expectedTarget:object){
  const work=apply(weakGet,byWork,[proof]) as Work|undefined;if(!work||work.target!==expectedTarget)throw Error('activity_preparation_original_work_required');currentWork(work,work.current?.operation==='read_prepare_call'||work.current?.operation==='ack_prepared'||work.current?.operation==='finish_host_no_effect',work.current?.operation==='finish_host_no_effect');return work.binding;
 },readPreparationCommand(proof:object,expectedTarget:object){
  const entry=apply(weakGet,preparationCommands,[proof]) as {work:Work;command:CanonicalPreparationCommand}|undefined;if(!entry||entry.work.target!==expectedTarget)throw Error('activity_preparation_original_command_required');entry.command.assertCurrent();return entry.command;
 }}]);
 port=bindOriginalSupervisedBusinessEndpoint(supervisor,controller);return controller;
}
