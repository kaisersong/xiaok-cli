import {createHash} from 'node:crypto';
import {types,isDeepStrictEqual} from 'node:util';
import {captureDispatchBusinessData} from '../conversation-activity/dispatch-business-data.js';
import {assertStandardIpcPromise} from '../verification/native-ipc-promise.js';
import {createIntrinsicSet} from '../verification/intrinsic-async-collection.js';
import {canonicalVerificationJson} from '../verification/protocol.js';
import type {TaskCreateInput,TaskSnapshot} from './types.js';
const read=Reflect.get,apply=Reflect.apply,descriptors=Object.getOwnPropertyDescriptors,own=Object.hasOwn,keys=Reflect.ownKeys,proto=Object.getPrototypeOf,freeze=Object.freeze,create=Object.create;
const then=Promise.prototype.then,P=Promise,isProxy=types.isProxy,isPromise=types.isPromise,isAsync=types.isAsyncFunction;
const asyncPrototype=proto(async()=>{}),startsWith=Function.prototype.call.bind(String.prototype.startsWith);
const syncFunction=(fn:unknown):fn is Function=>typeof fn==='function'&&!isProxy(fn)&&!isAsync(fn)&&proto(fn)!==asyncPrototype;
const json=JSON.stringify,parse=JSON.parse,weakGet=WeakMap.prototype.get,weakSet=WeakMap.prototype.set;
const exec=Function.prototype.call.bind(RegExp.prototype.exec);
const tickets=new WeakMap<object,Ticket|ObservationTicket>();
const digest=(data:unknown)=>createHash('sha256').update(canonicalVerificationJson(data)).digest('hex');
/** Canonical input data digest only; never a preparation capability. */
export function originalChildPreparationInputDigest(input:Readonly<TaskCreateInput>):string{return digest(captureDispatchBusinessData(input));}
function deny(code='DEFAULT_DISPATCH_PREPARATION_INVALID'):never{throw Error(code);}
const hex=(value:unknown):value is string=>typeof value==='string'&&exec(/^[a-f0-9]{64}$/,value)!==null;
const id=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=256&&exec(/[\x00-\x1f\x7f]/,value)===null;
function record(raw:unknown,names:readonly string[]){
 if(!raw||typeof raw!=='object'||isProxy(raw)||Array.isArray(raw))deny();const fields=descriptors(raw),actual=keys(fields);
 if(actual.length!==names.length)deny();for(let i=0;i<names.length;i++){const key=names[i]!;if(!own(fields,key)||!own(fields[key]!,'value')||!fields[key]!.enumerable)deny();}return fields;
}
export interface OriginalChildPreparation {
 version:1;contract:'ordinary_default_dispatch_task_preparation_v1';scope:{profileId:string;workspaceId:string};projectId:string;kswarmTaskId:string;runId:string;
 businessExecutionGeneration:number;childKey:string;payloadHash:string;bindingDigest:string;hostId:string;inputDigest:string;taskId:string;sessionId:string;preparationId:string;preparedContentDigest?:string;
}
export type DefaultDispatchPreparationPurpose = 'prepare' | 'observe';
export interface TaskDefaultDispatchPreparationSource {resolve(proof:unknown,purpose:DefaultDispatchPreparationPurpose):unknown}
interface ObservationTicket {purpose:'observe';store:object;marker:Readonly<OriginalChildPreparation>;input:Readonly<TaskCreateInput>;assertCurrent():void}
interface Ticket extends Omit<ObservationTicket,'purpose'> {purpose:'prepare';capture(raw:unknown):TaskSnapshot;build():TaskSnapshot|Promise<TaskSnapshot>}
function identities(scope:OriginalChildPreparation['scope'],childKey:string){const key=digest(['default-dispatch-host-task-v1',scope,childKey]);return{taskId:'task_default_dispatch_'+key,sessionId:'session_default_dispatch_'+key,preparationId:'default-dispatch-task-prepare:'+key};}
export function captureOriginalChildPreparation(raw:unknown):Readonly<OriginalChildPreparation>{
 const data=captureDispatchBusinessData(raw) as OriginalChildPreparation;
 const fields=['version','contract','scope','projectId','kswarmTaskId','runId','businessExecutionGeneration','childKey','payloadHash','bindingDigest','hostId','inputDigest','taskId','sessionId','preparationId'];if(own(data,'preparedContentDigest'))fields.push('preparedContentDigest');record(data,fields);record(data.scope,['profileId','workspaceId']);
 if(data.version!==1||data.contract!=='ordinary_default_dispatch_task_preparation_v1'||!hex(data.scope.profileId)||!hex(data.scope.workspaceId)||!id(data.projectId)||!id(data.kswarmTaskId)||!id(data.runId)||!id(data.hostId)||!Number.isSafeInteger(data.businessExecutionGeneration)||data.businessExecutionGeneration<1||typeof data.childKey!=='string'||exec(/^default-dispatch-child:[a-f0-9]{64}$/,data.childKey)===null||!hex(data.payloadHash)||!hex(data.bindingDigest)||!hex(data.inputDigest))deny();
 if(data.childKey!=='default-dispatch-child:'+digest(['default-dispatch-business-key-v1',data.scope,data.projectId,data.kswarmTaskId,data.businessExecutionGeneration]))deny('DEFAULT_DISPATCH_CHILD_IDENTITY_INVALID');
 if(own(data,'preparedContentDigest')&&!hex(data.preparedContentDigest))deny();
 const expected=identities(data.scope,data.childKey);if(data.taskId!==expected.taskId||data.sessionId!==expected.sessionId||data.preparationId!==expected.preparationId)deny();return data;
}
/** Digest the original immutable prepared content; runtime status/usage and
 * later event suffixes do not rewrite its first preparation facts. */
export function originalPreparedContentDigest(snapshot:TaskSnapshot,inputDigest:string):string{
 const data=captureDispatchBusinessData(snapshot) as unknown as TaskSnapshot;
 const events=[];for(let i=0;i<2;i++)events.push(data.events[i]);
 return digest(['default-dispatch-prepared-content-v1',inputDigest,{taskId:data.taskId,sessionId:data.sessionId,prompt:data.prompt,materials:data.materials,understanding:data.understanding??null,context:data.context??null,executionScope:data.executionScope??null,createdAt:data.createdAt,events}]);
}
export function originalChildPreparationSourceData(marker:Readonly<OriginalChildPreparation>):Readonly<OriginalChildPreparation>{
 const copy={...marker};delete copy.preparedContentDigest;return captureOriginalChildPreparation(copy);
}
export function isOriginalChildPreparationTaskId(raw:unknown):raw is string{return typeof raw==='string'&&startsWith(raw,'task_default_dispatch_');}
/** Data recognition/restriction only. A marker never grants a launch. */
export function assertOriginalChildPreparationSnapshot(snapshot:TaskSnapshot):void{
 if(isOriginalChildPreparationTaskId(snapshot.taskId)&&!own(snapshot,'originalChildPreparation'))deny('DEFAULT_DISPATCH_PREPARATION_TICKET_REQUIRED');
 if(!own(snapshot,'originalChildPreparation'))return;const marker=captureOriginalChildPreparation(snapshot.originalChildPreparation);
 if(snapshot.taskId!==marker.taskId||snapshot.sessionId!==marker.sessionId||!hex(marker.preparedContentDigest)||marker.preparedContentDigest!==originalPreparedContentDigest(snapshot,marker.inputDigest))deny('DEFAULT_DISPATCH_PREPARED_CONTENT_INVALID');
}
/** Verify the original requested execution inputs on both birth and replay.
 * Derived material/context facts remain part of the prepared-content digest. */
export function assertOriginalChildPreparationInput(snapshot:TaskSnapshot,input:Readonly<TaskCreateInput>):void{
 if(snapshot.prompt!==input.prompt||!Array.isArray(snapshot.materials)||snapshot.materials.length!==input.materials.length)deny('DEFAULT_DISPATCH_PREPARED_CONTENT_INVALID');
 for(let i=0;i<input.materials.length;i++){const expected=input.materials[i]!,actual=snapshot.materials[i]!;if(!actual||actual.materialId!==expected.materialId||expected.role!==undefined&&actual.role!==expected.role)deny('DEFAULT_DISPATCH_PREPARED_CONTENT_INVALID');}
 if(canonicalVerificationJson(snapshot.executionScope??null)!==canonicalVerificationJson(input.executionScope??null))deny('DEFAULT_DISPATCH_PREPARED_CONTENT_INVALID');
 if(!input.context){if(snapshot.context!==undefined)deny('DEFAULT_DISPATCH_PREPARED_CONTENT_INVALID');return;}
 const expectedIds:string[]=[],seen=createIntrinsicSet<string>();for(let i=0;i<(input.context.taskIds?.length??0);i++){const value=input.context.taskIds![i];const normalized=typeof value==='string'?value.trim():'';if(normalized&&!seen.has(normalized)){seen.add(normalized);expectedIds.push(normalized);}}
 const thread=typeof input.context.threadId==='string'?input.context.threadId.trim():'';
 if(!snapshot.context||canonicalVerificationJson(snapshot.context.taskIds)!==canonicalVerificationJson(expectedIds)||(snapshot.context.threadId??'')!==thread)deny('DEFAULT_DISPATCH_PREPARED_CONTENT_INVALID');
 for(let i=0;i<snapshot.context.loadedTaskIds.length;i++)if(!seen.has(snapshot.context.loadedTaskIds[i]!))deny('DEFAULT_DISPATCH_PREPARED_CONTENT_INVALID');
 for(let i=0;i<snapshot.context.skipped.length;i++)if(!seen.has(snapshot.context.skipped[i]!.taskId))deny('DEFAULT_DISPATCH_PREPARED_CONTENT_INVALID');
}
export function assertOriginalChildPreparationTransition(previous:TaskSnapshot|undefined,next:TaskSnapshot,birth?:Readonly<OriginalChildPreparation>):void{
 assertOriginalChildPreparationSnapshot(next);
 const had=previous!==undefined&&own(previous,'originalChildPreparation'),has=own(next,'originalChildPreparation');
 if(had!==has&&!(!had&&has&&birth))deny('DEFAULT_DISPATCH_PREPARATION_IMMUTABLE');
 if(had&&(!isDeepStrictEqual(previous!.originalChildPreparation,next.originalChildPreparation)||previous!.sessionId!==next.sessionId))deny('DEFAULT_DISPATCH_PREPARATION_IMMUTABLE');
 // Until its dedicated runtime protocol is implemented, ordinary writers may
 // observe/re-sync this exact record but cannot turn it into executable state.
 if(had&&canonicalVerificationJson(previous)!==canonicalVerificationJson(next))deny('DEFAULT_DISPATCH_EXECUTION_UNAVAILABLE');
 if(has){assertOriginalChildPreparationSnapshot(next);if(!had&&(!birth||canonicalVerificationJson(birth)!==canonicalVerificationJson(originalChildPreparationSourceData(next.originalChildPreparation!))))deny('DEFAULT_DISPATCH_PREPARATION_TICKET_REQUIRED');}
}
/** Internal constructor composition port. It authenticates only its fixed
 * original source's opaque proofs; it is not a NativeMain/B/launch grant. */
export function createTaskDefaultDispatchPreparationIssuer(store:object,source:TaskDefaultDispatchPreparationSource,exitSource:<T>(work:()=>T)=>T=work=>work()){
 if(!source||isProxy(source))deny('DEFAULT_DISPATCH_PREPARATION_SOURCE_REQUIRED');const descriptor=Object.getOwnPropertyDescriptor(source,'resolve'),resolve=descriptor&&own(descriptor,'value')?descriptor.value:undefined;
 if(!syncFunction(resolve))deny('DEFAULT_DISPATCH_PREPARATION_SYNCHRONOUS_REQUIRED');
 const rawOwned=createIntrinsicSet<unknown>(),known=createIntrinsicSet<object>();let sealed=false,pending=0,active=0,drainPromise:Promise<void>|undefined,finish:(()=>void)|undefined;
 function retain(raw:unknown){if(!raw||typeof raw!=='object'&&typeof raw!=='function'||rawOwned.has(raw))return;rawOwned.add(raw);if(!isPromise(raw)||isProxy(raw))return;pending++;try{assertStandardIpcPromise(raw,'DEFAULT_DISPATCH_PREPARATION_OBSERVER_UNKNOWN');}catch{return;}known.add(raw);const done=()=>{if(known.has(raw)){known.delete(raw);pending--;if(!pending&&!active)finish?.();}};apply(then,raw,[done,done]);}
 function local(){if(sealed)deny('DEFAULT_DISPATCH_PREPARATION_SEALED');if(rawOwned.size)deny('DEFAULT_DISPATCH_PREPARATION_UNCONFIRMED');}
 function invokeSource<T>(fn:Function,receiver:unknown,args:unknown[],consume:(raw:unknown)=>T):T{active++;try{return consume(exitSource(()=>apply(fn,receiver,args)));}finally{active--;if(!active&&!pending)finish?.();}}
 function check(fn:unknown,receiver:unknown){if(!syncFunction(fn)){retain(fn);deny('DEFAULT_DISPATCH_PREPARATION_SYNCHRONOUS_REQUIRED');}invokeSource(fn,receiver,[],raw=>{if(raw!==undefined){retain(raw);deny('DEFAULT_DISPATCH_PREPARATION_UNCONFIRMED');}local();});}
 return freeze({
  open(proof:unknown,requestSource:'user'|'agent'|'scheduler',purpose:DefaultDispatchPreparationPurpose='prepare'){
   local();if(requestSource!=='scheduler')deny('DEFAULT_DISPATCH_PREPARATION_SOURCE_REQUIRED');if(purpose!=='prepare'&&purpose!=='observe')deny('DEFAULT_DISPATCH_PREPARATION_PURPOSE_REQUIRED');return invokeSource(resolve,source,[proof,purpose],reply=>{
   if(!reply||(typeof reply!=='object'&&typeof reply!=='function')||isProxy(reply)){retain(reply);deny('DEFAULT_DISPATCH_PREPARATION_UNCONFIRMED');}
   // Keep independent raw siblings before refusing malformed metadata.
   const fields=descriptors(reply),names=keys(fields);for(let i=0;i<names.length;i++){const row=fields[names[i] as string]!;if(!own(row,'value')||names[i]==='then')retain(reply);}
   for(let i=0;i<names.length;i++){const key=names[i]!;const row=fields[key as string]!;if(own(row,'value')&&!(key==='assertCurrent'&&syncFunction(row.value)))try{captureDispatchBusinessData(row.value,retain);}catch{}}
   if(typeof reply!=='object'||isPromise(reply)||proto(reply)!==Object.prototype&&proto(reply)!==null){retain(reply);deny('DEFAULT_DISPATCH_PREPARATION_UNCONFIRMED');}
   const envelope=record(reply,['data','assertCurrent']),data=captureDispatchBusinessData(envelope.data!.value,retain) as any;
   record(data,['scope','projectId','taskId','runId','businessExecutionGeneration','childKey','payloadHash','bindingDigest','hostId','input']);
   const input=captureDispatchBusinessData(data.input,retain) as unknown as TaskCreateInput;
   const marker=captureOriginalChildPreparation({version:1,contract:'ordinary_default_dispatch_task_preparation_v1',scope:data.scope,projectId:data.projectId,kswarmTaskId:data.taskId,runId:data.runId,businessExecutionGeneration:data.businessExecutionGeneration,childKey:data.childKey,payloadHash:data.payloadHash,bindingDigest:data.bindingDigest,hostId:data.hostId,inputDigest:originalChildPreparationInputDigest(input),...identities(data.scope,data.childKey)});
   const assertCurrent=()=>{local();check(envelope.assertCurrent!.value,reply);};assertCurrent();
   return freeze({marker,input:parse(json(input)) as TaskCreateInput,assertCurrent,
    sdk(receiver:object,name:string,args:unknown[],thisArgument:unknown=receiver):unknown{
     active++;try{local();const fn=exitSource(()=>read(receiver,name));if(!syncFunction(fn)){retain(fn);deny('DEFAULT_DISPATCH_PREPARATION_SYNCHRONOUS_REQUIRED');}
      local();const raw=exitSource(()=>apply(fn,thisArgument,args));if(raw===undefined){local();return raw;}const value=captureDispatchBusinessData(raw,retain,true);local();return value;
     }finally{active--;if(!active&&!pending)finish?.();}
    },
    capture(raw:unknown):unknown{return captureDispatchBusinessData(raw,retain,true);},issueObservation(){if(purpose!=='observe')deny('DEFAULT_DISPATCH_PREPARATION_PURPOSE_REQUIRED');assertCurrent();const ticket=freeze(create(null));apply(weakSet,tickets,[ticket,freeze({purpose,store,marker,input,assertCurrent})]);return ticket;},
    issue(build:Ticket['build']){if(purpose!=='prepare')deny('DEFAULT_DISPATCH_PREPARATION_PURPOSE_REQUIRED');assertCurrent();if(typeof build!=='function'||isProxy(build))deny();const ticket=freeze(create(null));apply(weakSet,tickets,[ticket,freeze({purpose,store,marker,input,assertCurrent,capture:(raw:unknown)=>captureDispatchBusinessData(raw,retain) as unknown as TaskSnapshot,build})]);return ticket;}});
   });
  },
  seal(){sealed=true;},
  drain(){if(drainPromise)return drainPromise;sealed=true;drainPromise=new P<void>((yes,no)=>{finish=()=>{if(rawOwned.size)no(Error('DEFAULT_DISPATCH_PREPARATION_UNCONFIRMED'));else yes();};if(!pending&&!active)finish();});return drainPromise;},
 });
}
/** Membership is checked before reading any candidate property. */
export function readOriginalChildPreparationTicket(ticket:unknown,store:object):Ticket{
 const entry=ticket&&typeof ticket==='object'?apply(weakGet,tickets,[ticket]) as Ticket|undefined:undefined;if(!entry||entry.store!==store||entry.purpose!=='prepare')deny('DEFAULT_DISPATCH_PREPARATION_TICKET_REQUIRED');entry.assertCurrent();return entry;
}

/** Read-cut membership only. Neither a preparation nor a launch capability. */
export function readOriginalChildPreparationObservationTicket(ticket:unknown,store:object):ObservationTicket{
 const entry=ticket&&typeof ticket==='object'?apply(weakGet,tickets,[ticket]) as ObservationTicket|undefined:undefined;
 if(!entry||entry.store!==store||entry.purpose!=='observe')deny('DEFAULT_DISPATCH_PREPARATION_TICKET_REQUIRED');entry.assertCurrent();return entry;
}
