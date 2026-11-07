import {z} from 'zod/v3';
import {CodexTaskBridge,type CodexQuestionInventory} from './codex-task-bridge.js';
import {inspectNativeActivityReadAdmission,type NativeActivityReadAdmission} from './conversation-activity-ipc.js';
import {ConversationActivityAttachedService} from '../../src/runtime/conversation-activity/owner-service.js';
import {ConversationActivityService,type ConversationActivityApi,type ActivityActor,type ActivityThreadIdentity} from '../../src/runtime/conversation-activity/service.js';
import type {ConversationActivityStore} from '../../src/runtime/conversation-activity/store.js';
import type {ConversationWorkView,WorkWatch} from '../../src/runtime/conversation-activity/types.js';
import type {AttentionReaderSlot,NativeAttentionReaderSlot} from '../../src/runtime/conversation-activity/attention-reader-owner.js';
import type {AttentionInventory} from '../../src/runtime/conversation-activity/attention-canonical-state.js';
import {nativeAttentionReferenceSchema,nativeAttentionBindingDigest,type NativeAttentionReference} from '../../src/runtime/conversation-activity/native-attention-source.js';
import {nativeAttentionInventorySchema} from '../../src/runtime/conversation-activity/native-attention-inventory-data.js';
import {nativeQuestionReference,nativeQuestionExpectedDigest} from '../../src/runtime/conversation-activity/native-question-data.js';
import {nativeActivityQuestionFormsSchema,type NativeActivityQuestionForm,type NativeActivityAnswer} from '../shared/native-activity-question-contract.js';
import type {ActivityNativeConnection} from '../../src/runtime/conversation-activity/owner-client.js';

const referenceSchema=z.custom<NativeAttentionReference>(value=>nativeAttentionReferenceSchema.safeParse(value).success).transform(value=>nativeAttentionReferenceSchema.parse(value));
const slotSchema=z.object({sourceKind:z.literal('codex_native_approval'),watchId:z.string().min(1).max(256),readerIncarnation:z.string().uuid(),reference:referenceSchema,sourceLeaseId:z.string().uuid(),enrollmentIncarnation:z.string().uuid(),bindingDigest:z.string().regex(/^[a-f0-9]{64}$/),mode:z.enum(['live','terminal'])}).strict();
const identity=(watch:WorkWatch)=>JSON.stringify([nativeAttentionBindingDigest(watch),watch.generation,watch.status]);
const physical=(reference:NativeAttentionReference)=>JSON.stringify(reference);
interface TaskScope {watch:WorkWatch;identity:string;terminal:boolean}
type NativeActivityService=ConversationActivityAttachedService|ConversationActivityService;
interface ReadScope {actor:ActivityActor;admission:NativeActivityReadAdmission;service:NativeActivityService;store:ConversationActivityStore;watches:Map<string,TaskScope>;slots:Map<string,NativeAttentionReaderSlot>;inventories:Set<AttentionInventory>;qualifying:Set<CodexQuestionInventory>;connection?:ActivityNativeConnection}
interface Binding {service:NativeActivityService;store:ConversationActivityStore;connection?:ActivityNativeConnection;identity:string;slot:NativeAttentionReaderSlot}

/** Main-only one-shot adapter. Real Native/TaskHost/SQLite owners remain original. */
export class NativeActivityAttention {
 private readonly actors=new WeakMap<ActivityActor,ReadScope>();
 private readonly frames=new WeakMap<AttentionInventory,{frame:CodexQuestionInventory;watchId:string}>();
 private readonly outputs=new WeakMap<object,ReadScope>();
 private readonly bindings=new Map<string,Binding>();
 private readonly qualifications=new Map<string,Promise<void>>();
 private readonly work=new Set<Promise<void>>();
 private readonly sealedReads=new WeakSet<Error>();
 private closing=false;private closed?:Promise<void>;
 constructor(private readonly options:{bridge:CodexTaskBridge;profileId:string;actorId:string;store():ConversationActivityStore|undefined;service():ConversationActivityApi|undefined;owner():object;
  getThread(id:string):ActivityThreadIdentity|null;authorizeTaskRead(taskId:string,actor:ActivityActor):Promise<void>}){}
 private own<T>(begin:()=>Promise<T>):Promise<T>{
  if(this.closing)return Promise.reject(Error('activity_native_read_forbidden'));
  let done!:()=>void,fail!:(error:unknown)=>void;const reservation=new Promise<void>((resolve,reject)=>{done=resolve;fail=reject;});this.work.add(reservation);void reservation.then(()=>this.work.delete(reservation),()=>this.work.delete(reservation));
  try{const raw=begin();void raw.then(()=>done(),fail);return raw;}catch(error){fail(error);return Promise.reject(error);}
 }
 private scope(actor:ActivityActor):ReadScope{
  if(this.closing){const error=Error('activity_native_read_forbidden');this.sealedReads.add(error);throw error;}
  const scope=this.actors.get(actor);if(!scope||actor.requestSource!=='user'||actor.actorId!==this.options.actorId)throw Error('activity_native_read_forbidden');
  const proof=inspectNativeActivityReadAdmission(scope.admission,this.options.owner());if(proof.actor.actorId!==actor.actorId||this.options.service()!==scope.service||this.options.store()!==scope.store)throw Error('activity_native_read_forbidden');
  if(scope.connection){if(!(scope.service instanceof ConversationActivityAttachedService))throw Error('activity_native_source_connection_stale');scope.service.client.assertNativeConnectionCurrent(scope.connection);}
  for(const item of scope.watches.values()){this.assertTaskScope(scope,item);if(scope.service instanceof ConversationActivityService)scope.service.assertCurrentUserRead(item.watch.watchId,actor);}
  return scope;
 }
 private assertTaskScope(scope:ReadScope,item:TaskScope):void{
  const watch=scope.store.getWatch(item.watch.watchId);if(!watch||watch.status!=='active'||identity(watch)!==item.identity||watch.source!=='task_host'||watch.origin.profileId!==this.options.profileId)throw Error('activity_source_superseded');
  for(const id of new Set([watch.origin.threadId,watch.actualExecutionThreadId??watch.origin.threadId])){const thread=this.options.getThread(id);if(!thread||thread.profileId!==this.options.profileId||thread.workspaceId!==watch.origin.workspaceId||thread.deleteState!=='none')throw Error('activity_thread_forbidden');}
  this.options.bridge.assertTaskRouteIdentity({taskId:watch.workId,threadId:watch.actualExecutionThreadId??watch.origin.threadId},scope.actor);
 }
 assertReadActorCurrent(actor:ActivityActor):void{const scope=this.scope(actor);for(const inventory of scope.inventories)this.assertFrame(inventory,scope);for(const frame of scope.qualifying)this.options.bridge.assertQuestionInventoryCurrent(scope.actor,frame);}
 private createScope(actor:ActivityActor,admission:NativeActivityReadAdmission|undefined):ReadScope{
  const proof=inspectNativeActivityReadAdmission(admission,this.options.owner());if(actor.requestSource!=='user'||actor.actorId!==this.options.actorId||proof.actor.actorId!==actor.actorId)throw Error('activity_native_read_forbidden');
  const service=this.options.service(),store=this.options.store();if(!(service instanceof ConversationActivityAttachedService)&&!(service instanceof ConversationActivityService)||!store)throw Error('activity_native_source_unsupported');
  const mapped=Object.freeze({...actor}),scope:ReadScope={actor:mapped,admission:admission!,service,store,watches:new Map(),slots:new Map(),inventories:new Set(),qualifying:new Set()};this.actors.set(mapped,scope);return scope;
 }
 private async authorize(scope:ReadScope,watchId:string):Promise<TaskScope>{
  this.scope(scope.actor);const watch=scope.store.getWatch(watchId);if(!watch||watch.status!=='active'||watch.source!=='task_host'||watch.origin.profileId!==this.options.profileId||!this.options.bridge.owns(watch.workId))throw Error('activity_watch_forbidden');
  const item:TaskScope={watch,identity:identity(watch),terminal:false};scope.watches.set(watchId,item);this.assertTaskScope(scope,item);
  await this.options.authorizeTaskRead(watch.workId,scope.actor);this.scope(scope.actor);
  const snapshot=await this.options.bridge.host.inspectTask(watch.workId);this.scope(scope.actor);
  if(!snapshot||snapshot.taskId!==watch.workId||snapshot.sessionId!==watch.sourceDataEpoch||snapshot.context?.threadId!==(watch.actualExecutionThreadId??watch.origin.threadId))throw Error('activity_source_forbidden');
  item.terminal=['completed','failed','cancelled'].includes(snapshot.status);return item;
 }
 inspectLocalSource(actor:ActivityActor,watchId:string):NativeAttentionReference|undefined{
  this.assertReadActorCurrent(actor);const scope=this.scope(actor),item=scope.watches.get(watchId);if(!item||!(scope.service instanceof ConversationActivityService))throw Error('activity_native_read_forbidden');
  if(item.terminal)return undefined;return this.reference(scope,item).reference;
 }
 private reference(scope:ReadScope,item:TaskScope):{frame:CodexQuestionInventory;reference:NativeAttentionReference}{
  this.scope(scope.actor);const watch=item.watch,frame=this.options.bridge.readQuestionInventory({taskId:watch.workId,threadId:watch.actualExecutionThreadId??watch.origin.threadId,sessionId:watch.sourceDataEpoch},scope.actor);
  const reference=nativeAttentionReferenceSchema.parse({sourceKind:'codex_native_approval',taskId:watch.workId,taskSessionId:frame.taskSessionId,executionThreadId:frame.threadId,nativeSessionId:frame.sessionId,nativeThreadId:frame.nativeThreadId,nativeTurnId:frame.turnId,nativeGeneration:frame.generation,nativeIncarnation:frame.incarnation});return{frame,reference};
 }
 private async qualify(scope:ReadScope,item:TaskScope):Promise<void>{
  const previous=this.qualifications.get(item.watch.watchId);if(previous){await previous;this.scope(scope.actor);return this.checkBinding(scope,item);}
  const begin=async()=>{
   const live=item.terminal?undefined:this.reference(scope,item),current=()=>{this.scope(scope.actor);if(live)this.options.bridge.assertQuestionInventoryCurrent(scope.actor,live.frame);};current();
   if(live)scope.qualifying.add(live.frame);
   try{
   const old=this.bindings.get(item.watch.watchId);
   if(old&&old.service===scope.service&&old.store===scope.store&&old.identity===item.identity&&old.slot.mode===(item.terminal?'terminal':'live')&&(!live||physical(old.slot.reference)===physical(live.reference))){
    try{if(scope.service instanceof ConversationActivityAttachedService){if(!old.connection)throw Error('activity_native_source_connection_stale');scope.service.client.assertNativeConnectionCurrent(old.connection);scope.connection??=old.connection;}return;}catch(error){if(!(error instanceof Error)||error.message!=='activity_native_source_connection_stale')throw error;this.bindings.delete(item.watch.watchId);}
   }
   const result=scope.service instanceof ConversationActivityAttachedService?await scope.service.client.requestNative<unknown>('nativeReaderQualify',{watchId:item.watch.watchId,...(live?{reference:live.reference}:{})},current):{value:await scope.service.qualifyNativeAttentionReader(item.watch.watchId,scope.actor),connection:undefined};current();
   if(scope.connection&&scope.connection!==result.connection)throw Error('activity_native_source_connection_stale');scope.connection=result.connection;
   const slot=slotSchema.parse(result.value);if(slot.watchId!==item.watch.watchId||slot.reference.taskId!==item.watch.workId||slot.reference.taskSessionId!==item.watch.sourceDataEpoch||slot.reference.executionThreadId!==(item.watch.actualExecutionThreadId??item.watch.origin.threadId)||slot.readerIncarnation!==slot.reference.nativeIncarnation||slot.mode!==(item.terminal?'terminal':'live')||live&&physical(slot.reference)!==physical(live.reference))throw Error('attention_inventory_source_conflict');
   this.bindings.set(item.watch.watchId,{service:scope.service,store:scope.store,connection:result.connection,identity:item.identity,slot});
   }finally{if(live)scope.qualifying.delete(live.frame);}
  };
  const pending=begin();this.qualifications.set(item.watch.watchId,pending);try{await pending;this.scope(scope.actor);}finally{if(this.qualifications.get(item.watch.watchId)===pending)this.qualifications.delete(item.watch.watchId);}
 }
 private checkBinding(scope:ReadScope,item:TaskScope):void{const binding=this.bindings.get(item.watch.watchId);if(!binding||binding.service!==scope.service||binding.store!==scope.store||binding.identity!==item.identity)throw Error('attention_inventory_unavailable');if(scope.service instanceof ConversationActivityAttachedService){if(!binding.connection)throw Error('activity_native_source_connection_stale');scope.service.client.assertNativeConnectionCurrent(binding.connection);}if(scope.connection&&scope.connection!==binding.connection)throw Error('activity_native_source_connection_stale');scope.connection=binding.connection;}
 private async prepare(scope:ReadScope,watchId:string):Promise<void>{
  const target=await this.authorize(scope,watchId),watch=target.watch;
  const members=scope.store.listWatches().filter(item=>item.status==='active'&&item.origin.profileId===watch.origin.profileId&&item.origin.workspaceId===watch.origin.workspaceId&&item.source===watch.source&&item.logicalSourceId===watch.logicalSourceId&&item.sourceDataEpoch===watch.sourceDataEpoch&&item.workId===watch.workId&&(item.runId??'')===(watch.runId??''));
  if(members.length>512)throw Error('attention_membership_capacity_exceeded');
  for(const member of members){const item=member.watchId===watchId?target:await this.authorize(scope,member.watchId);this.scope(scope.actor);await this.qualify(scope,item);this.scope(scope.actor);}
 }
 hasBinding(watchId:string):boolean{return !this.closing&&this.bindings.has(watchId);}
 isNativeWatch(watchId:string):boolean{
  const store=this.options.store(),watch=store?.getWatch(watchId);return Boolean(watch&&watch.source==='task_host'&&(this.options.bridge.owns(watch.workId)||store!.getNativeAttentionEnrollment(watchId)));
 }
 assertCurrent(raw:AttentionReaderSlot,actor:ActivityActor):void{
  const scope=this.scope(actor),slot=slotSchema.parse(raw),item=scope.watches.get(slot.watchId),binding=this.bindings.get(slot.watchId);if(!item||!binding||binding.identity!==item.identity||binding.service!==scope.service||binding.store!==scope.store||slot.sourceLeaseId!==binding.slot.sourceLeaseId||slot.enrollmentIncarnation!==binding.slot.enrollmentIncarnation||slot.bindingDigest!==binding.slot.bindingDigest||physical(slot.reference)!==physical(binding.slot.reference)||slot.readerIncarnation!==binding.slot.readerIncarnation)throw Error('attention_inventory_unavailable');
  if(scope.service instanceof ConversationActivityAttachedService){if(!binding.connection)throw Error('activity_native_source_connection_stale');scope.service.client.assertNativeConnectionCurrent(binding.connection);}if(scope.connection!==binding.connection)throw Error('activity_native_source_connection_stale');
  if(slot.mode==='live'){const fresh=this.reference(scope,item);if(physical(fresh.reference)!==physical(slot.reference))throw Error('attention_inventory_unavailable');}else if(!item.terminal)throw Error('attention_native_terminal_unverified');
  scope.slots.set(slot.watchId,slot);
 }
 async collect(slot:AttentionReaderSlot,actor:ActivityActor):Promise<AttentionInventory>{
  this.assertCurrent(slot,actor);if(slot.sourceKind!=='codex_native_approval'||slot.mode!=='live')throw Error('attention_inventory_unavailable');const scope=this.scope(actor),item=scope.watches.get(slot.watchId)!,live=this.reference(scope,item);
  const inventory=nativeAttentionInventorySchema.parse({sourceKind:'codex_native_approval',watchId:slot.watchId,readerIncarnation:slot.readerIncarnation,enrollmentIncarnation:slot.enrollmentIncarnation,bindingDigest:slot.bindingDigest,reference:live.reference,coverage:'native_approvals_exclusive_execution_v1',inventoryRevision:live.frame.inventoryRevision,inventoryDigest:live.frame.digest,taskStatus:live.frame.questions.length?'input_required':'working',businessOutcome:'unknown',questions:live.frame.questions.map(question=>({inputId:question.token,requestDigest:question.requestDigest,expectedDigest:nativeQuestionExpectedDigest(live.reference,question)}))});
  this.frames.set(inventory,{frame:live.frame,watchId:slot.watchId});this.assertCollectedCurrent(inventory,actor);return inventory;
 }
 private assertFrame(inventory:AttentionInventory,scope:ReadScope):void{const proof=this.frames.get(inventory);if(!proof||!scope.watches.has(proof.watchId))throw Error('native_question_inventory_stale');this.options.bridge.assertQuestionInventoryCurrent(scope.actor,proof.frame);}
 assertCollectedCurrent(inventory:AttentionInventory,actor:ActivityActor):void{const scope=this.scope(actor);this.assertFrame(inventory,scope);scope.inventories.add(inventory);}
 private record<T extends object>(value:T,scope:ReadScope):T{
  this.assertReadActorCurrent(scope.actor);
  // Coalesced service reads may share their raw view. Each IPC admission needs
  // its own output identity while retaining this caller's original proofs.
  const owned=Object.assign(Array.isArray(value)?[]:{},value);this.outputs.set(owned,scope);return owned;
 }
 read(watchId:string,actor:ActivityActor,admission:NativeActivityReadAdmission|undefined,dismiss?:{expectedProjectionVersion:number;expectedPresentationIncarnation:string}):Promise<ConversationWorkView>{return this.own(async()=>{
  const scope=this.createScope(actor,admission);await this.prepare(scope,watchId);this.scope(scope.actor);const view=dismiss?await scope.service.dismissAttention(watchId,dismiss,scope.actor):await scope.service.getWork(watchId,scope.actor);return this.record({...view,questionSourceKind:'codex_native_approval'},scope);
 });}
 questions(watchId:string,actor:ActivityActor,admission:NativeActivityReadAdmission):Promise<NativeActivityQuestionForm[]>{return this.own(async()=>{
  const scope=this.createScope(actor,admission);await this.prepare(scope,watchId);this.scope(scope.actor);const view=await scope.service.getWork(watchId,scope.actor);this.assertReadActorCurrent(scope.actor);
  if(!view.presentation||view.presentation.protocolUnavailable||view.projection.freshness!=='fresh')throw Error('attention_inventory_unavailable');const item=scope.watches.get(watchId)!;
  if(item.terminal){if(view.presentation.questions.length)throw Error('attention_inventory_source_conflict');return this.record([],scope);}
  const live=this.reference(scope,item),forms=live.frame.questions.map(question=>{const questionRef=nativeQuestionReference(view.presentation!.anchorFactId,'native:'+question.token),metadata=view.presentation!.questions.find(value=>value.questionRef===questionRef&&value.ownerKind==='task_host'&&value.answerApiRef==='answerQuestion');if(!metadata)throw Error('attention_inventory_source_conflict');return {questionRef,questionId:question.token,expectedDigest:nativeQuestionExpectedDigest(live.reference,question),sourceRevision:metadata.sourceRevision,prompt:question.description,choices:['approve','deny'] as ['approve','deny']};});
  if(forms.length!==view.presentation.questions.length)throw Error('attention_inventory_source_conflict');this.options.bridge.assertQuestionInventoryCurrent(scope.actor,live.frame);return this.record(nativeActivityQuestionFormsSchema.parse(forms),scope);
 });}
 answer(watchId:string,input:NativeActivityAnswer,actor:ActivityActor,admission:NativeActivityReadAdmission):Promise<void>{return this.own(async()=>{
  const scope=this.createScope(actor,admission);await this.prepare(scope,watchId);this.scope(scope.actor);const view=await scope.service.getWork(watchId,scope.actor);this.assertReadActorCurrent(scope.actor);const item=scope.watches.get(watchId)!;
  if(item.terminal||!view.presentation||view.presentation.protocolUnavailable||!['approve','deny'].includes(input.choiceId))throw Error('native_approval_expired');const live=this.reference(scope,item),question=live.frame.questions.find(value=>nativeQuestionReference(view.presentation!.anchorFactId,'native:'+value.token)===input.questionRef);
  if(!question||nativeQuestionExpectedDigest(live.reference,question)!==input.expectedDigest||!view.presentation.questions.some(value=>value.questionRef===input.questionRef&&value.ownerKind==='task_host'&&value.answerApiRef==='answerQuestion'))throw Error('native_question_conflict');
  const current=()=>{this.assertReadActorCurrent(scope.actor);this.options.bridge.assertQuestionInventoryCurrent(scope.actor,live.frame);};current();
  await this.options.bridge.answerFromQuestionInventory({taskId:item.watch.workId,answer:{type:'choice',questionId:question.token,choiceId:input.choiceId}},scope.actor,live.frame,current);
 });}
 assertReadResultCurrent(raw:unknown,admission:NativeActivityReadAdmission):void{
  inspectNativeActivityReadAdmission(admission,this.options.owner());const scope=raw&&typeof raw==='object'?this.outputs.get(raw):undefined;
  if(!scope){
   // The same activity IPC retains its ordinary/MCP read path. It cannot use
   // that path to deliver any Native result lacking this adapter's proof.
   if(!raw||typeof raw!=='object'||!('watch'in raw)||!raw.watch||typeof raw.watch!=='object'||!('watchId'in raw.watch)||typeof raw.watch.watchId!=='string'||this.isNativeWatch(raw.watch.watchId))throw Error('activity_native_read_forbidden');
   return;
  }
  if(scope.admission!==admission)throw Error('activity_native_read_forbidden');this.assertReadActorCurrent(scope.actor);for(const slot of scope.slots.values())this.assertCurrent(slot,scope.actor);
 }
 close():Promise<void>{if(this.closed)return this.closed;this.closing=true;const active=[...this.work];this.closed=Promise.allSettled(active).then(results=>{const failed=results.flatMap(result=>result.status==='rejected'&&!(result.reason instanceof Error&&this.sealedReads.has(result.reason))?[result.reason]:[]);if(failed.length)throw new AggregateError(failed,'native_activity_attention_drain_failed');this.bindings.clear();});return this.closed;}
}
