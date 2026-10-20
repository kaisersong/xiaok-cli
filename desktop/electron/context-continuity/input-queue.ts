import type {NativeActor} from '../codex-native-service.js';
import type {InProcessTaskRuntimeHost} from '../../../src/runtime/task-host/task-runtime-host.js';
import type {TaskCreateInput,TaskSnapshot} from '../../../src/runtime/task-host/types.js';
import type {ContinuityService,ContinuityActor} from './service.js';
import type {ContinuityInputJournal} from './input-journal.js';
import type {ConversationInputAcceptance,ConversationQueueView,EnqueueConversationInput} from '../../shared/conversation-inputs.js';
import {digest,key} from './store.js';
interface InputQueueOptions {
 service:ContinuityService;actor:ContinuityActor;host:InProcessTaskRuntimeHost;
 withUserRequest:<T>(actor:NativeActor,action:()=>Promise<T>)=>Promise<T>;
 journal:()=>ContinuityInputJournal;ready:()=>Promise<void>;
 prepare:(input:TaskCreateInput,inputId:string)=>Promise<{taskId:string}>;
 setGoalPending:(conversationId:string,pending:boolean)=>Promise<void>;
 observeGoalPending:(conversationId:string,pending:boolean)=>void;
 readSource:(taskId:string)=>TaskSnapshot|null;
 onReconciled?:(inputId:string,taskId:string)=>void;
}
function promptPreview(value:string):string{const text=value.slice(0,2000);return /[\uD800-\uDBFF]$/.test(text)?text.slice(0,-1):text;}
interface Drain {generation:number;observed:number;promise:Promise<void>}
/** Owns scheduling accepted input; notifications are pointers, never execution receipts. */
export class DesktopInputQueue {
 private closed=false;private initialization?:Promise<void>;
 private readonly errors=new Set<string>();
 private readonly drains=new Map<string,Drain>();private listeners=new Set<(conversationId:string)=>void>();
 private readonly replies=new WeakMap<object,{actor:NativeActor;conversationId:string;kind:'accept'|'view';origin:string;hash:string}>();
 constructor(private readonly options:InputQueueOptions){}
 private actor(actor:NativeActor):void{if(!actor||actor.requestSource!=='user'||actor.actorId!==this.options.actor.actorId)throw new Error('input_user_required');if(this.closed)throw new Error('input_queue_closed');}
 async start():Promise<void>{await this.ready();}
 private async ready():Promise<void>{
  if(this.closed)throw new Error('input_queue_closed');
  if(!this.initialization){this.initialization=(async()=>{await this.options.ready();if(this.closed)throw new Error('input_queue_closed');this.options.journal();for(const row of this.options.service.store.db.prepare("SELECT DISTINCT conversation_id FROM conversation_inputs WHERE status NOT IN ('completed','cancelled','failed_not_started')").all()){const id=String(row.conversation_id);try{this.options.observeGoalPending(id,this.hasPending(id));this.wake(id);}catch{/* Unknown/deleted scope cannot acquire automatic execution. */}}})();}
  await this.initialization;if(this.closed)throw new Error('input_queue_closed');
 }
 hasPending(conversationId:string,exceptTaskId?:string):boolean{return !!this.options.service.store.db.prepare("SELECT 1 FROM conversation_inputs WHERE conversation_id=? AND status NOT IN ('completed','cancelled','failed_not_started') AND task_id<>? LIMIT 1").get(conversationId,exceptTaskId??'');}
 async syncGoal(conversationId:string):Promise<void>{if(!this.closed){const pending=this.hasPending(conversationId);this.options.observeGoalPending(conversationId,pending);await this.options.setGoalPending(conversationId,pending);}}
 private emit(conversationId:string):void{if(this.closed)return;for(const listener of this.listeners)try{listener(conversationId);}catch{/* A dead window cannot change durable input state. */}}
 subscribe(listener:(id:string)=>void):()=>void{this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
 assertPointer(conversationId:string,actor:NativeActor):void{this.actor(actor);this.options.service.requireConversation(this.options.actor,conversationId);}
 private origin(inputId:string):string{
  const row=this.options.service.store.db.prepare('SELECT * FROM conversation_inputs WHERE input_id=?').get(inputId);if(!row||row.deleted)throw new Error('not_readable');
  const payload=JSON.parse(String(row.payload)),anchor=this.options.service.store.db.prepare("SELECT a.deleted,a.conversation_id,v.record FROM message_anchors a JOIN message_versions v ON v.message_id=a.id AND v.revision=a.latest_revision WHERE a.source_kind='desktop_task' AND a.source_id=? AND a.source_epoch=? AND a.source_message_id='user'").get(String(row.task_id),String(row.source_epoch));
  if(!anchor||anchor.deleted||anchor.conversation_id!==row.conversation_id||JSON.parse(String(anchor.record)).role!=='user'||JSON.parse(String(anchor.record)).contentHash!==digest(payload.prompt)||digest([payload,String(row.material_manifest)])!==row.payload_hash)throw new Error('not_readable');
  return digest([row.input_id,row.conversation_id,row.sequence,row.task_id,row.source_epoch,row.payload_hash,row.authority,row.execution_epoch]);
 }
 private version(conversationId:string):string{const c=this.options.service.requireConversation(this.options.actor,conversationId);return digest([c.currentTaskId,this.errors.has(conversationId),this.options.service.store.db.prepare('SELECT input_id,status,revision,deleted,payload_hash FROM conversation_inputs WHERE conversation_id=? ORDER BY sequence').all(conversationId).map(row=>{let readable=false;if(!row.deleted)try{this.origin(String(row.input_id));readable=true;}catch{}return [row,readable,!row.deleted&&row.status==='pending'?this.options.journal().executionBlockReason(String(row.input_id)):null];})]);}

 private remember<T extends object>(result:T,actor:NativeActor,conversationId:string,kind:'accept'|'view',origin:string):T{this.replies.set(result,{actor,conversationId,kind,origin,hash:digest(result)});this.assertReply(result,actor);return result;}
 assertReply(result:object,actor:NativeActor):void{
  const proof=this.replies.get(result);if(!proof||proof.actor!==actor||proof.hash!==digest(result))throw new Error('input_queue_proof_unavailable');this.assertPointer(proof.conversationId,actor);
  const origin=proof.kind==='accept'?this.origin((result as ConversationInputAcceptance).inputId):this.version(proof.conversationId);if(origin!==proof.origin)throw new Error('input_queue_changed');
 }
 withUserRequest<T>(actor:NativeActor,action:()=>Promise<T>):Promise<T>{this.actor(actor);return this.options.withUserRequest(actor,action);}
 enqueue(request:EnqueueConversationInput,actor:NativeActor):Promise<ConversationInputAcceptance>{return this.withUserRequest(actor,()=>this.enqueueOwned(structuredClone(request),actor));}
 private async enqueueOwned(request:EnqueueConversationInput,actor:NativeActor):Promise<ConversationInputAcceptance>{
  this.actor(actor);key(request.inputId);key(request.conversationId);await this.ready();this.assertPointer(request.conversationId,actor);
  const db=this.options.service.store.db,prior=db.prepare('SELECT conversation_id FROM conversation_inputs WHERE input_id=?').get(request.inputId);
  if(prior&&prior.conversation_id!==request.conversationId)throw new Error('input_conflict');
  if(!prior&&Number(db.prepare("SELECT COUNT(*) AS n FROM conversation_inputs WHERE conversation_id=? AND status NOT IN ('completed','cancelled','failed_not_started')").get(request.conversationId)!.n)>=20)throw new Error('input_queue_full');
  const journal=this.options.journal(),context={threadId:request.conversationId};
  const accepted=request.filePaths?.length?await journal.submitFiles(this.options.actor,{inputId:request.inputId,prompt:request.prompt,filePaths:request.filePaths,context}):await journal.submit(this.options.actor,{inputId:request.inputId,input:{prompt:request.prompt,materials:[],context}});
  this.assertPointer(request.conversationId,actor);
  const receipt:ConversationInputAcceptance={accepted:true,inputId:accepted.inputId,conversationId:accepted.conversationId,sequence:accepted.sequence,taskId:accepted.taskId,sourceEpoch:accepted.sourceEpoch};
  const result=this.remember(receipt,actor,request.conversationId,'accept',this.origin(request.inputId));this.emit(request.conversationId);this.wake(request.conversationId);return result;
 }
 async list(request:{conversationId:string},actor:NativeActor):Promise<ConversationQueueView>{
  this.actor(actor);await this.ready();this.assertPointer(request.conversationId,actor);return this.listCurrent(request.conversationId,actor);
 }
 private listCurrent(conversationId:string,actor:NativeActor):ConversationQueueView{
  const db=this.options.service.store.db,c=this.options.service.requireConversation(this.options.actor,conversationId);
  const rows=db.prepare("SELECT * FROM conversation_inputs WHERE conversation_id=? AND status NOT IN ('completed','cancelled','failed_not_started') ORDER BY sequence").all(conversationId);
  const items=rows.filter(row=>!row.deleted).slice(0,20).map(row=>{
   try{this.origin(String(row.input_id));}catch{return {inputId:String(row.input_id),prompt:'',unavailable:true,status:row.status as 'pending'|'claimed'|'unknown',sequence:Number(row.sequence),revision:Number(row.revision),materialCount:0,prepared:false};}const input=JSON.parse(String(row.payload)),binding=db.prepare('SELECT t.revoked,p.source_epoch FROM task_bindings t JOIN task_presentation_sources p ON p.task_id=t.task_id WHERE t.task_id=? AND t.conversation_id=?').get(String(row.task_id),conversationId);
   return {inputId:String(row.input_id),prompt:promptPreview(String(input.prompt)),status:row.status as 'pending'|'claimed'|'unknown',sequence:Number(row.sequence),revision:Number(row.revision),materialCount:input.materials.length,prepared:!!binding&&!binding.revoked&&binding.source_epoch===row.source_epoch};
  });
  const failed=db.prepare("SELECT input_id,payload,sequence FROM conversation_inputs WHERE conversation_id=? AND deleted=0 AND status='failed_not_started' ORDER BY sequence DESC LIMIT 1").get(conversationId);let failedReadable=true;if(failed)try{this.origin(String(failed.input_id));}catch{failedReadable=false;}
  const result:ConversationQueueView={conversationId,items,failedInput:failed?{inputId:String(failed.input_id),prompt:failedReadable?promptPreview(String(JSON.parse(String(failed.payload)).prompt)):'',unavailable:!failedReadable,sequence:Number(failed.sequence)}:null,pauseReason:rows.some(row=>row.status==='unknown')?'unknown_execution':rows.some(row=>!row.deleted&&row.status==='pending'&&this.options.journal().executionBlockReason(String(row.input_id))==='execution_authorization_changed')?'execution_authorization_changed':items.some(item=>'unavailable' in item&&item.unavailable)||rows.some(row=>!row.deleted&&row.status==='pending'&&this.options.journal().executionBlockReason(String(row.input_id))==='input_unavailable')||rows.length>0&&this.errors.has(conversationId)?'input_unavailable':null,currentTaskId:c.currentTaskId};
  return this.remember(result,actor,conversationId,'view',this.version(conversationId));
 }
 async cancel(request:{conversationId:string;inputId:string},actor:NativeActor):Promise<ConversationQueueView>{
  this.actor(actor);await this.ready();this.assertPointer(request.conversationId,actor);
  if(this.options.service.store.db.prepare('SELECT conversation_id FROM conversation_inputs WHERE input_id=?').get(request.inputId)?.conversation_id!==request.conversationId)throw new Error('not_readable');
  this.options.journal().cancel(this.options.actor,request.inputId);const view=this.listCurrent(request.conversationId,actor);this.emit(request.conversationId);this.wake(request.conversationId);return view;
 }
 wakeAll():void{if(this.closed)return;for(const row of this.options.service.store.db.prepare("SELECT DISTINCT conversation_id FROM conversation_inputs WHERE status NOT IN ('completed','cancelled','failed_not_started')").all())this.wake(String(row.conversation_id));}
 wake(conversationId:string):void{
  if(this.closed)return;const previous=this.drains.get(conversationId);if(previous){previous.generation++;return;}
  const state:Drain={generation:1,observed:0,promise:Promise.resolve()};this.drains.set(conversationId,state);
  state.promise=Promise.resolve().then(async()=>{while(!this.closed&&state.observed!==state.generation){state.observed=state.generation;await this.drainOnce(conversationId);}}).catch(()=>{if(!this.closed){this.errors.add(conversationId);this.emit(conversationId);}}).finally(()=>{if(this.drains.get(conversationId)!==state)return;this.drains.delete(conversationId);if(!this.closed&&state.observed!==state.generation)this.wake(conversationId);});
 }
 private async drainOnce(conversationId:string):Promise<void>{
  await this.ready();if(this.closed)return;this.options.service.requireConversation(this.options.actor,conversationId);this.options.observeGoalPending(conversationId,this.hasPending(conversationId));
  const ids=this.options.host.pendingWorkTaskIds();for(const id of ids){const snapshot=await this.options.host.inspectTask(id);if(!snapshot||!snapshot.context?.threadId)return;if(snapshot.context.threadId===conversationId){if(snapshot.status==='running'&&snapshot.executionScope?.kind==='goal_turn'&&snapshot.executionScope.origin==='continuation')await this.syncGoal(conversationId);return;}}
  await this.syncGoal(conversationId);if(this.closed)return;
  if(digest(ids)!==digest(this.options.host.pendingWorkTaskIds())){this.wake(conversationId);return;}
  const db=this.options.service.store.db,row=db.prepare("SELECT * FROM conversation_inputs WHERE conversation_id=? AND status NOT IN ('completed','cancelled','failed_not_started') ORDER BY sequence LIMIT 1").get(conversationId);if(!row)return;
  if(row.deleted||row.status!=='pending'){
   if(!row.deleted)try{await this.options.journal().reconcile(String(row.input_id));this.options.onReconciled?.(String(row.input_id),String(row.task_id));this.emit(conversationId);this.wake(conversationId);}catch{/* A logical terminal is not closure. */}return;
  }
  const c=this.options.service.requireConversation(this.options.actor,conversationId);for(const id of c.taskIds){const source=this.options.readSource(id);if(!source)throw new Error('input_owner_busy');this.options.service.assertHistorySourceClosed(id,source);}
  if(this.options.host.pendingWorkTaskIds().some(id=>!ids.includes(id))){this.wake(conversationId);return;}
  this.errors.delete(conversationId);
  try{await this.options.prepare(this.options.journal().readPendingPayload(String(row.input_id)),String(row.input_id));this.emit(conversationId);}
  catch(error){this.errors.add(conversationId);this.options.journal().markClaimUnknown(String(row.input_id));this.emit(conversationId);if(error instanceof Error&&error.message==='goal_user_turn_waiting_for_preemption'||db.prepare('SELECT status FROM conversation_inputs WHERE input_id=?').get(String(row.input_id))?.status==='failed_not_started')this.wake(conversationId);}
 }
 async close():Promise<void>{this.closed=true;this.listeners.clear();await Promise.allSettled([...(this.initialization?[this.initialization]:[]),...[...this.drains.values()].map(state=>state.promise)]);}
}
