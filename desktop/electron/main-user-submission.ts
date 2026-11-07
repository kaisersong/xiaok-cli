import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash,randomUUID} from 'node:crypto';
import {closeSync,constants,existsSync,fstatSync,lstatSync,mkdirSync,openSync,readSync,promises as fsPromises,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import {types} from 'node:util';
import {assertBeforeEffects} from '../../src/runtime/verification/before-effects.js';
import {writeFileAtomicallySync} from '../../src/utils/atomic-file.js';
import {assertCapturedJsonUniqueKeys} from '../../src/runtime/verification/captured-source-json.js';
import {getTaskPreparedSourceReceipt,type TaskPreparedSourceReceipt} from '../../src/runtime/task-host/task-runtime-host.js';
import type {TaskSnapshot} from '../../src/runtime/task-host/types.js';
import {captureIpcData} from './ipc-data-snapshot.js';
import {USER_TASK_SUBMISSION_INPUT,USER_SUBMISSION_ID,type UserSubmissionTaskInput,type UserTaskSubmissionOutput} from '../shared/user-task-submission-contract.js';
import {ROOM_CONVERSION_CAPTURE_INPUT} from '../shared/room-conversion-input-contract.js';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const nativePromiseThen=Promise.prototype.then;
function invalidRoomAuthority(value?:unknown):never {
 // Never assimilate a data object's then getter. A malformed trusted callback
 // may already have returned a native rejected Promise; observe that rejection
 // while refusing it as synchronous authority.
 if(types.isPromise(value))Reflect.apply(nativePromiseThen,value,[()=>undefined,()=>undefined]);
 throw Error('room_conversion_source_unverified');
}
const id=z.string().min(1),count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const preparedSchema=z.object({taskId:id,sessionId:id,threadId:id,promptSha256:z.string().regex(/^[a-f0-9]{64}$/),permissionMode:z.enum(['auto','default','plan']).optional()}).strict();
const recordSchema=z.object({schemaVersion:z.literal(1),profileId:id,workspaceId:id,actorId:id,gestureId:z.string().uuid(),submissionId:USER_SUBMISSION_ID,
 canonicalMessageId:id,canonicalUserTaskId:id,payloadHash:z.string().regex(/^[a-f0-9]{64}$/),revision:count,attempt:count,
 phase:z.enum(['captured','preparing','prepared','accepted']),bootId:z.string().uuid(),effectsStarted:z.boolean(),prepared:preparedSchema.optional(),taskId:id.optional()}).strict();
type SubmissionRecord=z.infer<typeof recordSchema>;
const roomReference=z.string().min(1).max(256).refine(value=>value.trim()===value&&!value.includes('\0')),hex=z.string().regex(/^[a-f0-9]{64}$/),positive=count.refine(value=>value>0);
const roomCaptureId=z.string().regex(/^main-room-conversion:[a-f0-9]{64}:[a-f0-9-]{36}$/);
const roomFactSchema=z.object({profileId:roomReference,workspaceId:roomReference,actorId:roomReference,brokerUserId:roomReference,brokerOriginDigest:hex,
 intent:ROOM_CONVERSION_CAPTURE_INPUT,
 source:z.object({roomId:roomReference,messageId:roomReference,messageSequence:positive,text:z.string().max(65536),roomRevision:count,membershipRevision:count}).strict(),
 project:z.object({projectId:roomReference,primaryRoomId:roomReference,bindingDigest:hex,classification:z.string(),projectRevision:positive}).strict(),
}).strict();
const roomIdentitySchema=z.object({sourceFamily:z.literal('main_room_conversion_v1'),captureId:roomCaptureId,originKey:hex,
 profileId:roomReference,workspaceId:roomReference,actorId:roomReference,brokerUserId:roomReference,brokerOriginDigest:hex,
 canonicalMessageId:z.string().regex(/^main-user-message:[a-f0-9]{64}$/),canonicalUserTaskId:z.string().regex(/^main-user-task:[a-f0-9]{64}$/),
 roomId:roomReference,roomMessageId:roomReference,messageSequence:positive,messageSha256:hex,projectId:roomReference,projectBindingDigest:hex,userIntentHash:hex,envelopeHash:hex,
}).strict();
const roomRecordSchema=z.object({schemaVersion:z.literal(1),revision:positive,identity:roomIdentitySchema,
 sourceObserved:z.object({roomRevision:count,membershipRevision:count}).strict(),
 payload:z.object({input:ROOM_CONVERSION_CAPTURE_INPUT,body:z.string().max(65536)}).strict().optional(),
}).strict();
type RoomConversionRecord=z.infer<typeof roomRecordSchema>;
export type RoomConversionIdentity=Readonly<z.infer<typeof roomIdentitySchema>>;
export interface RoomConversionSourceAuthority {
 readonly brokerOriginDigest:string;
 verify(proof:object,expectedOwner:MainUserSubmissionOwner):{fact:unknown;assertCurrent():void};
}
declare const roomSourceBrand:unique symbol;
export type RoomConversionSourceProof={readonly [roomSourceBrand]:true};
const roomSourceProofs=new WeakMap<object,{owner:MainUserSubmissionOwner;read:()=>{identity:RoomConversionIdentity;payload:NonNullable<RoomConversionRecord['payload']>}}>();
/** Capture/source attestation only. This never grants B mutation, model/egress,
 * physical execution, broker control or a qualified profile. */
export function resolveRoomConversionSourceProof(proof:RoomConversionSourceProof,expectedOwner:MainUserSubmissionOwner){
 const entry=roomSourceProofs.get(proof);if(!entry||entry.owner!==expectedOwner)throw Error('room_conversion_source_unverified');return entry.read();
}
export type MainSubmissionIdentity=Readonly<Pick<SubmissionRecord,'profileId'|'workspaceId'|'actorId'|'submissionId'|'canonicalMessageId'|'canonicalUserTaskId'|'payloadHash'>>;
export type PreparedSubmissionIdentity=MainSubmissionIdentity & Readonly<{prepared:z.infer<typeof preparedSchema>}>;
declare const preparedSubmissionBrand:unique symbol;
export type PreparedSubmissionProof={readonly [preparedSubmissionBrand]:true};
const preparedProofs=new WeakMap<object,{identity:PreparedSubmissionIdentity;assertCurrent:()=>void}>();
export function resolvePreparedSubmissionProof(proof:PreparedSubmissionProof):PreparedSubmissionIdentity {
 const entry=preparedProofs.get(proof);if(!entry)throw Error('user_submission_prepared_unverified');entry.assertCurrent();return structuredClone(entry.identity);
}
interface SubmissionUse {record:SubmissionRecord;input:UserSubmissionTaskInput;key:string;preparedProof?:PreparedSubmissionProof}
export interface SubmissionActor {requestSource:'user'|'agent'|'scheduler';actorId:string}
const defaultDispatchLookupSchema=z.object({projectId:roomReference,planRevision:count,dispatchGeneration:count}).strict();
const defaultDispatchObservationSchema=defaultDispatchLookupSchema.extend({scope:z.object({profileId:hex,workspaceId:hex}).strict(),bindingDigest:hex,taskSetDigest:hex}).strict();
const defaultDispatchRecordSchema=defaultDispatchObservationSchema.extend({schemaVersion:z.literal(1),kind:z.literal('default_dispatch_user_action_v1'),actorId:roomReference,
 actionId:z.string().regex(/^main-default-dispatch:[a-f0-9]{64}$/),payloadHash:hex}).strict();
type DefaultDispatchRecord=z.infer<typeof defaultDispatchRecordSchema>;
export type DefaultDispatchAction=Readonly<{kind:'main_default_dispatch_action_v1'}>;
export type DefaultDispatchUserAudience=Readonly<{scope:Readonly<{profileId:string;workspaceId:string}>;projectId:string;action:'dispatch_current_plan'}>;
export interface DefaultDispatchObservationSource {resolve(frame:object):Readonly<{data:unknown;assertCurrent():void}>}
export interface OriginalDefaultDispatchOwner {
 readonly scope:Readonly<{profileId:string;workspaceId:string}>;
 assertLocal():void;
 capture(observation:object,userAdmission:object,actor:SubmissionActor|undefined):DefaultDispatchAction;
 read(action:DefaultDispatchAction,actor:SubmissionActor|undefined):Readonly<DefaultDispatchRecord>;
}
const originalDispatchOwners=new WeakMap<object,{source:object;admission:Function;binding:OriginalDefaultDispatchOwner}>();
const originalGet=WeakMap.prototype.get,originalSet=WeakMap.prototype.set,originalApply=Reflect.apply,originalFreeze=Object.freeze,originalCreate=Object.create,originalDefine=Object.defineProperty,originalSetSize=Object.getOwnPropertyDescriptor(Set.prototype,'size')!.get!;
/** Main composition only: original constructor identities, never method shape,
 * instanceof, a recovered journal record or a supplied verifier replacement. */
export function readOriginalDefaultDispatchOwner(owner:object,source:object,admission:Function):OriginalDefaultDispatchOwner{
 const row=originalApply(originalGet,originalDispatchOwners,[owner]) as {source:object;admission:Function;binding:OriginalDefaultDispatchOwner}|undefined;
 if(!row||row.source!==source||row.admission!==admission)throw Error('default_dispatch_original_owner_required');return row.binding;
}
/** Stable hashing of a strict captured JSON value; no IO or path normalization. */
function canonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().filter(key=>(value as Record<string,unknown>)[key]!==undefined).map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';
 return JSON.stringify(value);
}
/** Main-only input owner. Its journal is an observation/idempotency record,
 * not a protected B backend, native writer closure or business authorization. */
export class MainUserSubmissionOwner {
 private readonly directory:string;
 private readonly directoryIdentity:{dev:number;ino:number};
 private readonly bootId=randomUUID();
 private readonly uses=new AsyncLocalStorage<SubmissionUse>();
 private readonly inflight=new Map<string,Promise<UserTaskSubmissionOutput>>();
 private sealed=false;
 private writeFailure?:{error:unknown};
 private readonly roomHistoryReads=new Set<Promise<RoomConversionIdentity|undefined>>();
 private roomHistoryCloseFailure?:unknown;
 private roomSourceAuthority?:{brokerOriginDigest:string;verify:RoomConversionSourceAuthority['verify']};
 private readonly defaultDispatchSource?:DefaultDispatchObservationSource['resolve'];
 private readonly defaultDispatchScope:Readonly<{profileId:string;workspaceId:string}>;
 private readonly defaultDispatchUserAdmission?:(frame:object,actor:SubmissionActor,expected?:DefaultDispatchUserAudience)=>void;
 private readonly defaultDispatchActions=new WeakMap<object,{record:DefaultDispatchRecord;current(actor:SubmissionActor|undefined):void}>();
 private readonly journalReadUnknown=new Set<{fd:number;path:string;identity:{dev:number;ino:number}|null;expectedIdentity:{dev:number;ino:number};phase:'close_unknown';error:unknown}>();
 constructor(private readonly options:{dataRoot:string;profileId:string;workspaceId:string;roomConversionSources?:RoomConversionSourceAuthority;
  defaultDispatchSource?:DefaultDispatchObservationSource;defaultDispatchUserAdmission?(frame:object,actor:SubmissionActor,expected?:DefaultDispatchUserAudience):void}){
  this.directory=join(options.dataRoot,'conversation-projects','user-submissions');mkdirSync(this.directory,{recursive:true,mode:0o700});
  this.defaultDispatchScope=Object.freeze({profileId:options.profileId,workspaceId:options.workspaceId});
  const stat=lstatSync(this.directory);this.directoryIdentity={dev:stat.dev,ino:stat.ino};this.assertDirectory();
  const source=options.roomConversionSources;
  if(source&&hex.safeParse(source.brokerOriginDigest).success&&typeof source.verify==='function')this.bindRoomConversionSources(source);
  const dispatchSource=options.defaultDispatchSource,dispatchAdmission=options.defaultDispatchUserAdmission;
  if(dispatchSource)this.defaultDispatchSource=dispatchSource.resolve.bind(dispatchSource);
  this.defaultDispatchUserAdmission=dispatchAdmission?.bind(options);
  if(dispatchSource&&dispatchAdmission){
   const binding=originalCreate(null);originalDefine(binding,'scope',{__proto__:null,value:this.defaultDispatchScope,enumerable:true} as PropertyDescriptor);
   originalDefine(binding,'assertLocal',{__proto__:null,value:()=>{if(this.sealed||this.writeFailure||this.roomHistoryCloseFailure||originalApply(originalSetSize,this.journalReadUnknown,[]))throw Error('default_dispatch_action_closed');},enumerable:true} as PropertyDescriptor);
   originalDefine(binding,'capture',{__proto__:null,value:(observation:object,user:object,actor:SubmissionActor|undefined)=>originalApply(originalDefaultDispatchCapture,this,[observation,user,actor]),enumerable:true} as PropertyDescriptor);
   originalDefine(binding,'read',{__proto__:null,value:(action:DefaultDispatchAction,actor:SubmissionActor|undefined)=>originalApply(originalDefaultDispatchRead,this,[action,actor]),enumerable:true} as PropertyDescriptor);
   originalApply(originalSet,originalDispatchOwners,[this,{source:dispatchSource,admission:dispatchAdmission,binding:originalFreeze(binding)}]);
  }
 }
 /** One-way Main composition only; never exposed as a caller/tool primitive.
  * The real broker realm can become available after this original owner exists. */
 bindRoomConversionSources(source:RoomConversionSourceAuthority):void {
  if(this.sealed)throw Error('room_conversion_closed');this.assertRoomOpen();
  if(this.roomSourceAuthority)throw Error('room_conversion_source_owner_conflict');
  const brokerOriginDigest=source?.brokerOriginDigest,verify=source?.verify;
  if(!hex.safeParse(brokerOriginDigest).success||typeof verify!=='function')throw Error('room_conversion_source_unverified');
  this.roomSourceAuthority={brokerOriginDigest,verify:verify.bind(source)};
 }
 seal():void {this.sealed=true;}
 private assertActor(actor:SubmissionActor|undefined):void {
  if(!actor||actor.requestSource!=='user'||actor.actorId!==`desktop-user:${this.options.profileId}`)throw Error('user_submission_actor_forbidden');
 }
 private assertDirectory():void {
  const d=lstatSync(this.directory);if(!d.isDirectory()||d.isSymbolicLink()||d.dev!==this.directoryIdentity.dev||d.ino!==this.directoryIdentity.ino
   ||process.platform!=='win32'&&((d.mode&0o077)!==0||d.uid!==process.getuid?.()))throw Error('user_submission_storage_changed');
 }
 private assertOpen():void {if(this.writeFailure)throw Error('user_submission_write_unconfirmed',{cause:this.writeFailure.error});this.assertDirectory();}
 private assertRoomOpen():void {this.assertOpen();if(this.roomHistoryCloseFailure)throw Error('room_conversion_history_close_unconfirmed',{cause:this.roomHistoryCloseFailure});}
 private key(gestureId:string):string {return hash(canonical([this.options.profileId,this.options.workspaceId,`desktop-user:${this.options.profileId}`,gestureId]));}
 private path(key:string):string {return join(this.directory,key+'.json');}
 private assertJournalReadable():void {
  this.assertDirectory();
  if(this.journalReadUnknown.size)throw Error('user_submission_read_close_unconfirmed',{cause:this.writeFailure?.error});
  if(this.roomHistoryCloseFailure)throw Error('room_conversion_history_close_unconfirmed',{cause:this.roomHistoryCloseFailure});
 }
 /** Bytes only: no schema parsing or action capability. Never follow a new
  * path after observing its original inode, or trust a stale size check. */
 private readJournalBytes(key:string,maxBytes:number,code:string):string|undefined {
  this.assertJournalReadable();const path=this.path(key);let before:import('node:fs').Stats;
  try{before=lstatSync(path);}catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT')return undefined;throw Error(code,{cause:error});}
  const valid=(stat:import('node:fs').Stats)=>{if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>maxBytes||process.platform!=='win32'&&((stat.mode&0o077)!==0||stat.uid!==process.getuid?.()))throw Error(code);};
  valid(before);let fd:number;
  try{fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));}catch(error){throw Error(code,{cause:error});}
  let bytes:string|undefined,readFailed=false,readError:unknown,identity:{dev:number;ino:number}|null=null;
  try{
   const actual=fstatSync(fd);identity={dev:actual.dev,ino:actual.ino};valid(actual);if(actual.dev!==before.dev||actual.ino!==before.ino)throw Error(code);
   const current=lstatSync(path);valid(current);if(current.dev!==actual.dev||current.ino!==actual.ino)throw Error(code);
   const buffer=Buffer.alloc(maxBytes+1);let size=0;
   while(size<buffer.length){const count=readSync(fd,buffer,size,buffer.length-size,size);if(count===0)break;size+=count;}
   if(size>maxBytes)throw Error(code);valid(fstatSync(fd));
   const after=lstatSync(path);valid(after);if(after.dev!==actual.dev||after.ino!==actual.ino)throw Error(code);
   this.assertDirectory();bytes=buffer.subarray(0,size).toString('utf8');
  }catch(error){readFailed=true;readError=error;}
  try{closeSync(fd);}catch(error){
   this.journalReadUnknown.add({fd,path,identity,expectedIdentity:{dev:before.dev,ino:before.ino},phase:'close_unknown',error});
   const failure=readFailed?new AggregateError([readError,error],'user_submission_read_close_unconfirmed',{cause:readError}):Error('user_submission_read_close_unconfirmed',{cause:error});
   this.writeFailure={error:failure};throw failure;
  }
  if(readFailed)throw Error(code,{cause:readError});return bytes!;
 }
 private read(key:string):SubmissionRecord|undefined {
  const raw=this.readJournalBytes(key,16384,'user_submission_record_invalid');if(raw===undefined)return undefined;
  try {
   assertCapturedJsonUniqueKeys(raw,'user_submission_record_invalid');const r=recordSchema.parse(JSON.parse(raw));
   const nonce=r.submissionId.split(':')[2],canonicalId=hash(canonical(['main-user-submission-id-v1',r.profileId,r.workspaceId,r.actorId,nonce]));
   if(r.profileId!==this.options.profileId||r.workspaceId!==this.options.workspaceId||r.actorId!==`desktop-user:${this.options.profileId}`||this.key(r.gestureId)!==key
    ||r.submissionId!==`main-submission:${r.gestureId}:${nonce}`||r.canonicalMessageId!==`main-user-message:${canonicalId}`||r.canonicalUserTaskId!==`main-user-task:${canonicalId}`
    ||(r.phase==='prepared'||r.phase==='accepted')&&!r.taskId||r.phase==='prepared'&&!r.prepared||r.prepared&&r.prepared.taskId!==r.taskId)throw Error('invalid');
   return r;
  }catch(error){throw Error('user_submission_record_invalid',{cause:error});}
 }
 private write(record:SubmissionRecord|RoomConversionRecord|DefaultDispatchRecord,key:string):void {
  this.assertOpen();try {writeFileAtomicallySync(this.path(key),JSON.stringify(record));this.assertDirectory();}catch(error){this.writeFailure={error};throw error;}
 }
 private locked<T>(key:string,action:()=>T):T {
  this.assertOpen();const path=join(this.directory,key+'.lock');let fd:number;
  try{fd=openSync(path,'wx',0o600);}catch(error){throw Error('user_submission_reconciliation_required',{cause:error});}
  let result!:T,originalFailure:{error:unknown}|undefined,cleanupFailure:{error:unknown}|undefined;
  let identity:{dev:number;ino:number}|undefined;
  try{const stat=fstatSync(fd);identity={dev:stat.dev,ino:stat.ino};result=action();}catch(error){originalFailure={error};}
  try{
   closeSync(fd);
   if(!identity)throw Error('user_submission_lock_unconfirmed');
   const current=lstatSync(path);
   if(current.dev!==identity.dev||current.ino!==identity.ino)throw Error('user_submission_storage_changed');
   unlinkSync(path);
  }catch(error){cleanupFailure={error};this.writeFailure={error};}
  if(originalFailure&&cleanupFailure)throw new AggregateError([originalFailure.error,cleanupFailure.error],'user_submission_reconciliation_required');
  if(cleanupFailure)throw cleanupFailure.error;
  if(originalFailure)throw originalFailure.error;
  return result;
 }
 private defaultDispatchOpen():void {if(this.sealed)throw Error('default_dispatch_action_closed');this.assertRoomOpen();}
 private assertDefaultDispatchActor(actor:SubmissionActor|undefined):void {
  if(!actor||actor.requestSource!=='user'||actor.actorId!==`desktop-user:${this.defaultDispatchScope.profileId}`)throw Error('user_submission_actor_forbidden');
 }
 private defaultDispatchKey(data:z.infer<typeof defaultDispatchLookupSchema>,actorId:string):string {
  return hash(canonical(['main-default-dispatch-key-v1',this.defaultDispatchScope.profileId,this.defaultDispatchScope.workspaceId,actorId,data.projectId,data.planRevision,data.dispatchGeneration]));
 }
 private defaultDispatchRecord(data:z.infer<typeof defaultDispatchObservationSchema>,actorId:string):DefaultDispatchRecord {
  const key=this.defaultDispatchKey(data,actorId);
  return {...data,schemaVersion:1,kind:'default_dispatch_user_action_v1',actorId,actionId:'main-default-dispatch:'+key,
   payloadHash:hash(canonical(['main-default-dispatch-payload-v1',actorId,data]))};
 }
 private readDefaultDispatchRecord(key:string):DefaultDispatchRecord|undefined {
  const raw=this.readJournalBytes(key,16384,'default_dispatch_record_invalid');if(raw===undefined)return undefined;
  try{
   assertCapturedJsonUniqueKeys(raw,'default_dispatch_record_invalid');const record=defaultDispatchRecordSchema.parse(JSON.parse(raw));
   const {schemaVersion:_schema,kind:_kind,actorId,actionId:_id,payloadHash:_payload,...data}=record;
   if(data.scope.profileId!==this.defaultDispatchScope.profileId||data.scope.workspaceId!==this.defaultDispatchScope.workspaceId||actorId!==`desktop-user:${this.defaultDispatchScope.profileId}`
    ||this.defaultDispatchKey(data,actorId)!==key||canonical(this.defaultDispatchRecord(data,actorId))!==canonical(record))throw Error('default_dispatch_record_invalid');
   return record;
  }catch(error){throw Error('default_dispatch_record_invalid',{cause:error});}
 }
 /** A B observation is independent of a fresh user gesture. Both original
  * opaque inputs are required; journal data is never an execution grant. */
 captureDefaultDispatch(observationFrame:object,userAdmissionFrame:object,actor:SubmissionActor|undefined):DefaultDispatchAction {
  this.assertDefaultDispatchActor(actor);this.defaultDispatchOpen();
  if(!this.defaultDispatchSource||!this.defaultDispatchUserAdmission)throw Error('default_dispatch_source_unavailable');
  let audience:DefaultDispatchUserAudience|undefined;
  const user=(currentActor:SubmissionActor|undefined)=>{this.assertDefaultDispatchActor(currentActor);assertBeforeEffects(()=>this.defaultDispatchUserAdmission!(userAdmissionFrame,currentActor!,audience));this.assertDefaultDispatchActor(currentActor);this.defaultDispatchOpen();};
  user(actor);const resolved=this.defaultDispatchSource(observationFrame);
  if(!resolved||typeof resolved!=='object'||types.isProxy(resolved)||Object.getOwnPropertySymbols(resolved).length||![Object.prototype,null].includes(Object.getPrototypeOf(resolved))){
   if(types.isPromise(resolved))Reflect.apply(nativePromiseThen,resolved,[()=>undefined,()=>undefined]);throw Error('default_dispatch_source_unverified');
  }
  const fields=Object.getOwnPropertyDescriptors(resolved),names=Object.keys(fields);
  if(names.length!==2||!Object.hasOwn(fields.data??{},'value')||!Object.hasOwn(fields.assertCurrent??{},'value')||typeof fields.assertCurrent!.value!=='function')throw Error('default_dispatch_source_unverified');
  const source=fields.assertCurrent!.value as()=>void;
  const current=(currentActor:SubmissionActor|undefined)=>{user(currentActor);assertBeforeEffects(()=>source.call(resolved));user(currentActor);};
  const data=defaultDispatchObservationSchema.parse(captureIpcData(fields.data!.value,'default_dispatch_source_unverified'));current(actor);
  if(data.scope.profileId!==this.defaultDispatchScope.profileId||data.scope.workspaceId!==this.defaultDispatchScope.workspaceId)throw Error('default_dispatch_scope_mismatch');
  audience=Object.freeze({scope:this.defaultDispatchScope,projectId:data.projectId,action:'dispatch_current_plan' as const});
  const record=this.defaultDispatchRecord(data,actor!.actorId),key=this.defaultDispatchKey(data,actor!.actorId);
  current(actor);this.locked(key,()=>{current(actor);const previous=this.readDefaultDispatchRecord(key);current(actor);
   if(previous){if(canonical(previous)!==canonical(record))throw Error('default_dispatch_action_conflict');return;}
   current(actor);this.write(record,key);current(actor);
  });
  current(actor);const action=Object.freeze({kind:'main_default_dispatch_action_v1' as const});
  this.defaultDispatchActions.set(action,{record,current});return action;
 }
 readDefaultDispatchAction(action:DefaultDispatchAction,actor:SubmissionActor|undefined):Readonly<DefaultDispatchRecord> {
  this.assertDefaultDispatchActor(actor);this.defaultDispatchOpen();const entry=this.defaultDispatchActions.get(action);
  if(!entry)throw Error('default_dispatch_action_foreign');entry.current(actor);
  const record=this.readDefaultDispatchRecord(this.defaultDispatchKey(entry.record,entry.record.actorId));
  if(!record||canonical(record)!==canonical(entry.record))throw Error('default_dispatch_action_changed');entry.current(actor);
  return Object.freeze({...record,scope:Object.freeze({...record.scope})});
 }
 /** Existing journal metadata only; no creation or fresh action capability. */
 observeDefaultDispatchAction(input:unknown,actor:SubmissionActor|undefined):Readonly<DefaultDispatchRecord>|undefined {
  this.assertDefaultDispatchActor(actor);this.defaultDispatchOpen();const lookup=defaultDispatchLookupSchema.parse(captureIpcData(input,'default_dispatch_lookup_invalid'));
  const record=this.readDefaultDispatchRecord(this.defaultDispatchKey(lookup,actor!.actorId));this.defaultDispatchOpen();
  return record?Object.freeze({...record,scope:Object.freeze({...record.scope})}):undefined;
 }
 private update(use:SubmissionUse,change:(record:SubmissionRecord)=>SubmissionRecord):void {
  this.locked(use.key,()=>{const current=this.read(use.key);if(!current||current.revision!==use.record.revision||current.bootId!==this.bootId)throw Error('user_submission_reconciliation_required');
   const next=change(current);next.revision=current.revision+1;if(!Number.isSafeInteger(next.revision))throw Error('user_submission_revision_exhausted');this.write(next,use.key);use.record=next;});
 }
 /** Call BEFORE the original Host/native producer or material IO is entered. */
 beginEffects():void {const use=this.uses.getStore();if(use&&!use.record.effectsStarted)this.update(use,r=>({...r,effectsStarted:true}));}
 currentIdentity():MainSubmissionIdentity|undefined {
  const use=this.uses.getStore();if(!use)return undefined;
  const {profileId,workspaceId,actorId,submissionId,canonicalMessageId,canonicalUserTaskId,payloadHash}=use.record;
  return Object.freeze({profileId,workspaceId,actorId,submissionId,canonicalMessageId,canonicalUserTaskId,payloadHash});
 }
 /** Historical metadata observation only; it cannot mint a native receipt or
  * start/restart a task. Used by the existing source owner to verify both sides. */
 observePreparedBinding(submissionId:string):PreparedSubmissionIdentity {
  this.assertDirectory();if(!USER_SUBMISSION_ID.safeParse(submissionId).success)throw Error('user_submission_prepared_unverified');
  const record=this.read(this.key(submissionId.split(':')[1]));
  if(!record||record.submissionId!==submissionId||!['prepared','accepted'].includes(record.phase)||!record.prepared)throw Error('user_submission_prepared_unverified');
  const {profileId,workspaceId,actorId,canonicalMessageId,canonicalUserTaskId,payloadHash,prepared}=record;
  return Object.freeze({profileId,workspaceId,actorId,submissionId,canonicalMessageId,canonicalUserTaskId,payloadHash,prepared:structuredClone(prepared)});
 }
 currentPreparedSourceProof():PreparedSubmissionProof|undefined {return this.uses.getStore()?.preparedProof;}
 private roomOrigin(value:Pick<RoomConversionIdentity,'profileId'|'workspaceId'|'actorId'|'brokerUserId'|'brokerOriginDigest'|'roomId'|'roomMessageId'>):string {
  return hash(canonical(['main-room-conversion-origin-v1',value.profileId,value.workspaceId,value.actorId,value.brokerUserId,value.brokerOriginDigest,value.roomId,value.roomMessageId,0]));
 }
 private roomEnvelope(identity:Pick<RoomConversionIdentity,'originKey'|'messageSequence'|'messageSha256'|'projectId'|'projectBindingDigest'>,input:unknown):string {
  return hash(canonical(['main-room-conversion-envelope-v1',identity.originKey,identity.messageSequence,identity.messageSha256,identity.projectId,identity.projectBindingDigest,input]));
 }
 private assertRoomFile(stat:import('node:fs').Stats):void {
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>393216||process.platform!=='win32'&&((stat.mode&0o077)!==0||stat.uid!==process.getuid?.()))throw Error('room_conversion_record_invalid');
 }
 private readRoomRecord(originKey:string):RoomConversionRecord|undefined {
  this.assertJournalReadable();const path=this.path('room-'+originKey);if(!existsSync(path))return undefined;
  const before=lstatSync(path);this.assertRoomFile(before);
  const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  let result:RoomConversionRecord|undefined,readError:unknown,readFailed=false;
  try{
   const stat=fstatSync(fd);this.assertRoomFile(stat);if(stat.dev!==before.dev||stat.ino!==before.ino)throw Error('room_conversion_record_invalid');
   const bytes=Buffer.alloc(393217);let size=0;
   while(size<bytes.length){const count=readSync(fd,bytes,size,bytes.length-size,size);if(count===0)break;size+=count;}
   if(size>393216)throw Error('room_conversion_record_invalid');result=this.parseRoomRecord(bytes.subarray(0,size).toString('utf8'),originKey);
  }catch(error){readFailed=true;readError=error;}
  try{closeSync(fd);}catch(error){this.roomHistoryCloseFailure=error;throw Error('room_conversion_history_close_unconfirmed',{cause:error});}
  if(readFailed)throw readError;
  return result;
 }
 private parseRoomRecord(raw:string,originKey:string):RoomConversionRecord {
  try{
   assertCapturedJsonUniqueKeys(raw,'room_conversion_record_invalid');const record=roomRecordSchema.parse(JSON.parse(raw)),identity=record.identity;
   const nonce=identity.captureId.split(':')[2],canonicalId=hash(canonical(['main-room-conversion-id-v1',identity.originKey,nonce]));
   if(identity.profileId!==this.options.profileId||identity.workspaceId!==this.options.workspaceId||identity.actorId!==`desktop-user:${this.options.profileId}`
    ||identity.originKey!==originKey||this.roomOrigin(identity)!==originKey||!z.string().uuid().safeParse(nonce).success||identity.captureId!==`main-room-conversion:${originKey}:${nonce}`
    ||identity.canonicalMessageId!==`main-user-message:${canonicalId}`||identity.canonicalUserTaskId!==`main-user-task:${canonicalId}`)throw Error('invalid');
   const payload=record.payload;
   if(payload&&(Buffer.byteLength(payload.body,'utf8')>65536||hash(payload.body)!==identity.messageSha256||hash(canonical(payload.input))!==identity.userIntentHash
    ||payload.input.roomId!==identity.roomId||payload.input.messageId!==identity.roomMessageId||payload.input.projectId!==identity.projectId||this.roomEnvelope(identity,payload.input)!==identity.envelopeHash))throw Error('invalid');
   return record;
  }catch(error){throw Error('room_conversion_record_invalid',{cause:error});}
 }
 /** Own-journal metadata only, never a Room/project read or mutation grant. */
 observeRoomConversion(captureId:string,actor:SubmissionActor|undefined):RoomConversionIdentity {
  this.assertActor(actor);if(!roomCaptureId.safeParse(captureId).success)throw Error('room_conversion_not_found');
  const record=this.readRoomRecord(captureId.split(':')[1]);if(!record||record.identity.captureId!==captureId)throw Error('room_conversion_not_found');
  return Object.freeze(structuredClone(record.identity));
 }
 /** Retry without an ACK/captureId: observe OWN historical input metadata
  * before looking up a possibly deleted remote source. Never a new grant. */
 observeRoomConversionIntent(raw:unknown,actor:SubmissionActor|undefined,signal:AbortSignal,recheck:()=>void):Promise<RoomConversionIdentity|undefined> {
  this.assertActor(actor);this.assertDirectory();if(this.sealed)throw Error('room_conversion_closed');
  const parsed=ROOM_CONVERSION_CAPTURE_INPUT.safeParse(captureIpcData(raw,'room_conversion_input_invalid'));if(!parsed.success)throw Error('room_conversion_input_invalid');
  if(this.roomHistoryCloseFailure)throw Error('room_conversion_observation_unavailable',{cause:this.roomHistoryCloseFailure});
  if(this.roomHistoryReads.size>=2)return Promise.reject(Error('room_conversion_observation_busy'));
  const operation=this.readRoomHistoryIntent(parsed.data,actor!,signal,recheck);this.roomHistoryReads.add(operation);
  const remove=()=>{this.roomHistoryReads.delete(operation);};void operation.then(remove,remove);return operation;
 }
 async drainRoomConversionObservations():Promise<void> {
  while(this.roomHistoryReads.size)await Promise.allSettled([...this.roomHistoryReads]);
  if(this.journalReadUnknown.size)throw Error('user_submission_read_close_unconfirmed',{cause:this.writeFailure?.error});
  if(this.roomHistoryCloseFailure)throw Error('room_conversion_history_close_unconfirmed',{cause:this.roomHistoryCloseFailure});
 }
 private async closeRoomHistoryHandle(handle:{close():Promise<void>}):Promise<void> {
  try{await handle.close();}catch(error){this.roomHistoryCloseFailure=error;throw Error('room_conversion_history_close_unconfirmed',{cause:error});}
 }
 private async readRoomHistoryIntent(input:z.infer<typeof ROOM_CONVERSION_CAPTURE_INPUT>,actor:SubmissionActor,signal:AbortSignal,recheck:()=>void):Promise<RoomConversionIdentity|undefined> {
  const deadline=performance.now()+2000;let entries=0,bytesRead=0,found:RoomConversionIdentity|undefined;
  const current=()=>{this.assertActor(actor);signal.throwIfAborted();if(this.sealed)throw Error('room_conversion_closed');
   if(performance.now()>deadline)throw Error('room_conversion_observation_unavailable');
   if(types.isAsyncFunction(recheck))throw Error('user_submission_actor_forbidden');const result=recheck();
   if(result!==undefined){if(types.isPromise(result))Reflect.apply(nativePromiseThen,result,[()=>undefined,()=>undefined]);throw Error('user_submission_actor_forbidden');}};
  current();const directory=await fsPromises.opendir(this.directory);
  try{current();for(;;){
   const entry=await directory.read();current();if(!entry)break;
   if(++entries>8192)throw Error('room_conversion_observation_unavailable');
   const match=/^room-([a-f0-9]{64})\.json$/.exec(entry.name);if(!match)continue;
   this.assertDirectory();const path=this.path('room-'+match[1]),before=await fsPromises.lstat(path);current();this.assertRoomFile(before);
   if(before.size>64*1024*1024-bytesRead)throw Error('room_conversion_observation_unavailable');
   const file=await fsPromises.open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
   let record:RoomConversionRecord;
   try{
    current();this.assertDirectory();const stat=await file.stat();current();this.assertRoomFile(stat);
    if(stat.dev!==before.dev||stat.ino!==before.ino)throw Error('room_conversion_record_invalid');
    const data=Buffer.alloc(393217);let size=0;
    while(size<data.length){const result=await file.read(data,size,data.length-size,size);current();if(result.bytesRead===0)break;size+=result.bytesRead;bytesRead+=result.bytesRead;
     if(size>393216||bytesRead>64*1024*1024)throw Error('room_conversion_observation_unavailable');}
    record=this.parseRoomRecord(data.subarray(0,size).toString('utf8'),match[1]);
   }finally{await this.closeRoomHistoryHandle(file);}
   current();const identity=record.identity;if(identity.roomId!==input.roomId||identity.roomMessageId!==input.messageId)continue;
   if(found)throw Error('room_conversion_origin_ambiguous');
   if(identity.userIntentHash!==hash(canonical(input)))throw Error('room_conversion_conflict');found=identity;
  }}finally{await this.closeRoomHistoryHandle(directory);}
  current();this.assertDirectory();return found?Object.freeze(structuredClone(found)):undefined;
 }
 /** Synchronous original-owner transaction after the real Main source root.
  * The captured source attestation is never a B/model/publication grant. */
 captureRoomConversion(raw:unknown,actor:SubmissionActor|undefined,sourceProof:object):Readonly<{identity:RoomConversionIdentity;sourceProof:RoomConversionSourceProof}> {
  this.assertActor(actor);if(this.sealed)throw Error('room_conversion_closed');this.assertRoomOpen();
  const source=this.roomSourceAuthority;if(!source)throw Error('room_conversion_unavailable');
  if(source.verify.constructor?.name==='AsyncFunction')invalidRoomAuthority();
  const verified=source.verify(sourceProof,this);
  if(types.isPromise(verified)||!verified||typeof verified.assertCurrent!=='function')invalidRoomAuthority(verified);
  if(verified.assertCurrent.constructor?.name==='AsyncFunction')invalidRoomAuthority();
  const checkCurrent=verified.assertCurrent.bind(verified);
  const assertCurrent=()=>{const result=checkCurrent();if(result!==undefined)invalidRoomAuthority(result);};assertCurrent();
  const wire=ROOM_CONVERSION_CAPTURE_INPUT.safeParse(captureIpcData(raw,'room_conversion_input_invalid'));
  if(!wire.success)throw Error('room_conversion_input_invalid');
  const parsed=roomFactSchema.safeParse(captureIpcData(verified.fact,'room_conversion_source_mismatch'));
  if(!parsed.success)throw Error('room_conversion_source_mismatch');const fact=parsed.data,input=wire.data;
  if(fact.profileId!==this.options.profileId||fact.workspaceId!==this.options.workspaceId||fact.actorId!==actor!.actorId||fact.brokerOriginDigest!==source.brokerOriginDigest
   ||canonical(fact.intent)!==canonical(input)||fact.source.roomId!==input.roomId||fact.source.messageId!==input.messageId||fact.project.projectId!==input.projectId)throw Error('room_conversion_source_mismatch');
  if(fact.project.classification!=='ordinary')throw Error('room_conversion_provenance_forbidden');
  if(fact.project.primaryRoomId!==fact.source.roomId)throw Error('room_conversion_room_scope_mismatch');
  if(Buffer.byteLength(fact.source.text,'utf8')>65536||input.action==='add_task'&&(Buffer.byteLength(input.title??'','utf8')>4096||Buffer.byteLength(input.brief??'','utf8')>65536))throw Error('room_conversion_input_invalid');
  const origin={profileId:fact.profileId,workspaceId:fact.workspaceId,actorId:fact.actorId,brokerUserId:fact.brokerUserId,brokerOriginDigest:fact.brokerOriginDigest,roomId:fact.source.roomId,roomMessageId:fact.source.messageId};
  const originKey=this.roomOrigin(origin),basis={originKey,messageSequence:fact.source.messageSequence,messageSha256:hash(fact.source.text),projectId:fact.project.projectId,projectBindingDigest:fact.project.bindingDigest};
  const envelopeHash=this.roomEnvelope(basis,input);
  const record=this.locked('room-'+originKey,()=>{
   assertCurrent();let current=this.readRoomRecord(originKey);
   if(current){if(current.identity.envelopeHash!==envelopeHash)throw Error('room_conversion_conflict');return current;}
   if(input.expectedProjectRevision!==fact.project.projectRevision)throw Error('room_conversion_project_revision_conflict');
   const nonce=randomUUID(),canonicalId=hash(canonical(['main-room-conversion-id-v1',originKey,nonce]));
   current=roomRecordSchema.parse({schemaVersion:1,revision:1,identity:{sourceFamily:'main_room_conversion_v1',captureId:`main-room-conversion:${originKey}:${nonce}`,
    ...origin,...basis,envelopeHash,userIntentHash:hash(canonical(input)),canonicalMessageId:`main-user-message:${canonicalId}`,canonicalUserTaskId:`main-user-task:${canonicalId}`},
    sourceObserved:{roomRevision:fact.source.roomRevision,membershipRevision:fact.source.membershipRevision},payload:{input,body:fact.source.text}});
   if(Buffer.byteLength(JSON.stringify(current),'utf8')>393216)throw Error('room_conversion_input_invalid');
   this.write(current,'room-'+originKey);return current;
  });
  if(!record.payload)throw Error('room_conversion_payload_unavailable');
  const proof=Object.freeze(Object.create(null)) as RoomConversionSourceProof;
  roomSourceProofs.set(proof,{owner:this,read:()=>{
   if(this.sealed)throw Error('room_conversion_closed');this.assertRoomOpen();assertCurrent();
   const current=this.readRoomRecord(originKey);
   if(!current||current.revision!==record.revision||canonical(current.identity)!==canonical(record.identity))throw Error('room_conversion_source_changed');
   if(!current.payload)throw Error('room_conversion_payload_unavailable');
   return {identity:Object.freeze(structuredClone(current.identity)),payload:structuredClone(current.payload)};
  }});
  return Object.freeze({identity:Object.freeze(structuredClone(record.identity)),sourceProof:proof});
 }
 /** Actual private Host receipt is verified while still prepared, before start. */
 recordPreparedTask(snapshot:TaskSnapshot,receipt:TaskPreparedSourceReceipt|undefined):void {
  const use=this.uses.getStore();if(!use)return;
  if(!receipt)throw Error('user_submission_prepared_unverified');const actual=getTaskPreparedSourceReceipt(receipt);
  if(!use.record.effectsStarted||actual.taskId!==snapshot.taskId||actual.sessionId!==snapshot.sessionId||actual.prompt!==snapshot.prompt||snapshot.prompt!==use.input.prompt
   ||snapshot.status!=='understanding'||!snapshot.context?.threadId||actual.threadId!==snapshot.context.threadId
   ||use.input.context?.threadId&&use.input.context.threadId.trim()!==snapshot.context.threadId||actual.permissionMode!==use.input.permissionMode)throw Error('user_submission_prepared_mismatch');
  const prepared={taskId:snapshot.taskId,sessionId:snapshot.sessionId,threadId:snapshot.context.threadId,promptSha256:hash(snapshot.prompt),...(actual.permissionMode===undefined?{}:{permissionMode:actual.permissionMode})};
  if(use.record.phase==='prepared'){
   if(use.record.taskId!==snapshot.taskId || canonical(use.record.prepared)!==canonical(prepared))throw Error('user_submission_prepared_mismatch');
  }else this.update(use,r=>({...r,phase:'prepared',taskId:snapshot.taskId,prepared}));
  // Even a repeated registration requires the actual still-current native
  // receipt above; durable JSON alone never mints this private capability.
  const identity=this.observePreparedBinding(use.record.submissionId),proof=Object.freeze(Object.create(null)) as PreparedSubmissionProof;
  preparedProofs.set(proof,{identity,assertCurrent:()=>{this.assertOpen();if(canonical(this.observePreparedBinding(identity.submissionId))!==canonical(identity))throw Error('user_submission_prepared_changed');}});
  use.preparedProof=proof;
 }
 submit(raw:unknown,actor:SubmissionActor|undefined,produce:(input:UserSubmissionTaskInput)=>Promise<{taskId:string}>):Promise<UserTaskSubmissionOutput> {
  this.assertActor(actor);if(this.sealed)throw Error('user_submission_closed');this.assertOpen();
  // Authorization precedes data capture, including hostile DTO getters.
  const parsed=USER_TASK_SUBMISSION_INPUT.safeParse(captureIpcData(raw,'user_submission_input_invalid'));
  if(!parsed.success)return Promise.reject(Error('user_submission_input_invalid'));
  const wire=parsed.data;
  const key=this.key(wire.action==='submit_new'?wire.gestureId:wire.submissionId.split(':')[1]);
  let selected:SubmissionRecord;
  try {selected=this.locked(key,()=>{
   let current=this.read(key);
   if(wire.action==='retry_existing'){
    if(!current||current.submissionId!==wire.submissionId)throw Error('user_submission_not_found');return current;
   }
   const payloadHash=hash(canonical(['main-user-submission-payload-v1',wire.input]));
   if(current){if(current.payloadHash!==payloadHash)throw Error('user_submission_conflict');return current;}
   const nonce=randomUUID(),canonicalId=hash(canonical(['main-user-submission-id-v1',this.options.profileId,this.options.workspaceId,actor!.actorId,nonce]));current={schemaVersion:1,profileId:this.options.profileId,workspaceId:this.options.workspaceId,actorId:actor!.actorId,gestureId:wire.gestureId,
    submissionId:`main-submission:${wire.gestureId}:${nonce}`,canonicalMessageId:`main-user-message:${canonicalId}`,canonicalUserTaskId:`main-user-task:${canonicalId}`,payloadHash,revision:0,attempt:0,phase:'captured',bootId:this.bootId,effectsStarted:false};this.write(current,key);return current;
  });}catch(error){return Promise.reject(error);}
  const running=this.inflight.get(key);if(running)return running;
  if(selected.phase==='accepted'||selected.phase==='prepared')return Promise.resolve({taskId:selected.taskId!,submissionId:selected.submissionId});
  if(selected.phase==='preparing')return Promise.reject(Error('user_submission_reconciliation_required'));
  if(wire.action==='retry_existing')return Promise.reject(Error('user_submission_not_prepared'));
  const use:SubmissionUse={record:selected,input:wire.input,key};
  try {this.locked(key,()=>{const current=this.read(key);if(!current||current.revision!==selected.revision||current.phase!=='captured')throw Error('user_submission_reconciliation_required');
   const next={...current,phase:'preparing' as const,bootId:this.bootId,attempt:current.attempt+1,revision:current.revision+1,effectsStarted:false};this.write(next,key);use.record=next;});}catch(error){return Promise.reject(error);}
  // Queue producer only after the in-flight slot is installed. Independent ALS
  // prevents nested legacy conversation admissions from dropping this use.
  const result=Promise.resolve().then(()=>this.uses.run(use,async()=>{
   try {
    const value=await produce(wire.input);if(!value||typeof value.taskId!=='string'||!value.taskId||use.record.taskId&&use.record.taskId!==value.taskId)throw Error('user_submission_result_invalid');
    this.update(use,r=>({...r,phase:'accepted',taskId:value.taskId}));return {taskId:value.taskId,submissionId:use.record.submissionId};
   }catch(error){
    // Only a settled, still-in-this-boot call with no entered effects may retry.
    if(use.record.phase==='preparing'&&!use.record.effectsStarted&&!this.writeFailure)this.update(use,r=>({...r,phase:'captured'}));
    throw error;
   }
  }));
  this.inflight.set(key,result);void result.then(()=>this.inflight.delete(key),()=>this.inflight.delete(key));return result;
 }
}
const originalDefaultDispatchCapture=MainUserSubmissionOwner.prototype.captureDefaultDispatch,originalDefaultDispatchRead=MainUserSubmissionOwner.prototype.readDefaultDispatchAction;
