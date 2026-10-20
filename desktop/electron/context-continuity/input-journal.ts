import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {openSync,closeSync,lstatSync,constants,readFileSync,realpathSync} from 'node:fs';
import type {InProcessTaskRuntimeHost,PendingTaskInputIdentity,TaskIdentityReservation} from '../../../src/runtime/task-host/task-runtime-host.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import type {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import type {TaskCreateInput,TaskSnapshot} from '../../../src/runtime/task-host/types.js';
import type {ContinuityService,ContinuityActor} from './service.js';
import {digest,key,effectSnapshotHash} from './store.js';

export interface InputOwnerDependencies {host:InProcessTaskRuntimeHost;materialRegistry:MaterialRegistry;snapshotStore:FileTaskSnapshotStore;authorizePreparedInput?:(inputId:string,input:TaskCreateInput)=>void;isExistingAdmission?:(snapshot:TaskSnapshot)=>boolean;captureExecutionAuthority?:()=>string;assertExecutionAuthority?:(authority:string,conversationId:string)=>void;assertPreparationFailure?:(reservation:TaskIdentityReservation)=>void}
export interface ConversationInputView {inputId:string;conversationId:string;sequence:number;taskId:string;sourceEpoch:string;status:'pending'|'claimed'|'completed'|'unknown'|'cancelled'|'failed_not_started';revision:number;prompt:string}
interface InputRow {input_id:string;conversation_id:string;sequence:number;payload_hash:string;payload:string;material_manifest:string;task_id:string;source_epoch:string;authority:string;execution_epoch:number;status:ConversationInputView['status'];claim_boot:string|null;revision:number;deleted:number;prepared_payload:string|null;prepared_hash:string|null;execution_authority:string|null}

/** Main-only input owner. No method here is a renderer/model certificate. */
export class ContinuityInputJournal {
  private readonly bootId=randomUUID();
  private readonly actor:ContinuityActor;
  private readonly lock:DatabaseSync;
  private readonly lockPath:string;
  private readonly lockIdentity:{dev:number;ino:number};
  private closed=false;
  private closeCompletion:Promise<void>=Promise.resolve();
  private readonly claimedReservations=new Map<string,TaskIdentityReservation>();
  private fileSubmissions=new Map<string,{hash:string;pending:Promise<ConversationInputView>}>();
  constructor(private readonly service:ContinuityService,path:string,private readonly owner:InputOwnerDependencies){
    owner.host.assertInputOwnerDependencies(owner.snapshotStore,owner.materialRegistry);
    this.actor={requestSource:'user',profileId:service.store.profileId,actorId:`desktop-user:${service.store.profileId}`};
    this.lockPath=path+'.input-owner.sqlite';
    try{const fd=openSync(this.lockPath,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|(constants.O_NOFOLLOW??0),0o600);closeSync(fd);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    const stat=lstatSync(this.lockPath);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||typeof process.getuid==='function'&&stat.uid!==process.getuid())throw new Error('input_owner_unavailable');
    this.lockIdentity={dev:stat.dev,ino:stat.ino};
    this.lock=new DatabaseSync(this.lockPath);
    try{
      // A separate lifetime transaction: ordinary continuity reads/writes do not release it.
      this.lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');this.assertOwner();
      service.store.transaction(()=>{service.store.db.prepare("UPDATE conversation_inputs SET status='unknown',revision=revision+1 WHERE status='claimed'").run();});
    }catch(error){this.lock.close();throw new Error('input_owner_unavailable',{cause:error});}
  }
  private assertOwner():void{
    if(this.closed)throw new Error('input_owner_unavailable');
    const stat=lstatSync(this.lockPath);if(stat.dev!==this.lockIdentity.dev||stat.ino!==this.lockIdentity.ino||!stat.isFile()||stat.isSymbolicLink())throw new Error('input_owner_unavailable');
    if(!this.lock.isOpen||this.lock.isTransaction!==true)throw new Error('input_owner_unavailable');
    this.lock.prepare('SELECT 1').get();
  }
  private row(id:string):InputRow{
    key(id);const row=this.service.store.db.prepare('SELECT * FROM conversation_inputs WHERE input_id=?').get(id) as unknown as InputRow|undefined;
    if(!row||row.deleted)throw new Error('not_readable');return row;
  }
  private view(row:InputRow):ConversationInputView{return {inputId:row.input_id,conversationId:row.conversation_id,sequence:row.sequence,taskId:row.task_id,sourceEpoch:row.source_epoch,status:row.status,revision:row.revision,prompt:JSON.parse(row.payload).prompt};}
  private manifest(input:TaskCreateInput):string{
    return JSON.stringify(input.materials.map(item=>{
      const record=this.owner.materialRegistry.get(item.materialId);if(!record)throw new Error('input_material_changed');
      const stat=lstatSync(record.workspacePath);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('input_material_changed');
      const hash=createHash('sha256').update(readFileSync(record.workspacePath)).digest('hex');if(hash!==record.sha256||stat.size!==record.sizeBytes)throw new Error('input_material_changed');
      return {materialId:record.materialId,workspacePath:record.workspacePath,sha256:hash,sizeBytes:record.sizeBytes,role:item.role??record.role};
    }));
  }
  private normalize(input:TaskCreateInput,prepared=false):TaskCreateInput{
    if(!input||typeof input.prompt!=='string'||!input.prompt.trim()||Buffer.byteLength(input.prompt)>1024*1024||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(input.prompt)||!Array.isArray(input.materials)||input.materials.length>64||!input.context?.threadId||!prepared&&input.executionScope)throw new Error('invalid_argument');
    const result=JSON.parse(JSON.stringify(input)) as TaskCreateInput;
    if(Object.keys(result).some(k=>!['prompt','materials','context','permissionMode','watchdogMs','maxToolLoopIterations',...(prepared?['executionScope']:[])].includes(k)))throw new Error('invalid_argument');
    key(result.context!.threadId);for(const item of result.materials){key(item.materialId);if(Object.keys(item).some(k=>!['materialId','role'].includes(k)))throw new Error('invalid_argument');}
    return result;
  }
  private assertAuthority(row:InputRow):void{
    this.assertOwner();this.service.requireConversation(this.actor,row.conversation_id);
    const execution=this.service.store.db.prepare('SELECT * FROM conversation_execution WHERE conversation_id=?').get(row.conversation_id);
    if(!execution||execution.authority!==row.authority||execution.authority!==this.service.store.profileId||execution.execution_epoch!==row.execution_epoch||execution.harness!=='xiaok-native'||execution.barrier!=='open')throw new Error('input_authority_changed');
    const anchor=this.service.store.db.prepare("SELECT a.*,v.record FROM message_anchors a JOIN message_versions v ON v.message_id=a.id AND v.revision=a.latest_revision WHERE a.source_kind='desktop_task' AND a.source_id=? AND a.source_epoch=? AND a.source_message_id='user'").get(row.task_id,row.source_epoch);
    const input=JSON.parse(row.payload) as TaskCreateInput;
    if(!anchor||anchor.deleted||anchor.conversation_id!==row.conversation_id||JSON.parse(String(anchor.record)).contentHash!==digest(input.prompt)||JSON.parse(String(anchor.record)).role!=='user')throw new Error('not_readable');
    if(this.manifest(input)!==row.material_manifest||digest([input,row.material_manifest])!==row.payload_hash)throw new Error('input_material_changed');
  }
  private captureExecutionAuthority():string|null{if(!this.owner.captureExecutionAuthority)return null;const value=this.owner.captureExecutionAuthority();if(typeof value!=='string'||!value||value.length>4096)throw new Error('input_execution_authority_unavailable');return value;}
  private assertExecutionAuthority(row:InputRow):void{if(!this.owner.captureExecutionAuthority)return;if(!row.execution_authority||!this.owner.assertExecutionAuthority)throw new Error('input_execution_authority_changed');try{const result:unknown=this.owner.assertExecutionAuthority(row.execution_authority,row.conversation_id);if(result!==undefined)throw new Error('input_execution_authority_changed');}catch{throw new Error('input_execution_authority_changed');}}
  executionBlockReason(id:string):'execution_authorization_changed'|'input_unavailable'|null{const row=this.row(id);this.assertOwner();this.service.requireConversation(this.actor,row.conversation_id);try{this.assertAuthority(row);}catch{return 'input_unavailable';}try{this.assertExecutionAuthority(row);return null;}catch{return 'execution_authorization_changed';}}
  submit(actor:ContinuityActor,request:{inputId:string;input:TaskCreateInput}):Promise<ConversationInputView>{return this.submitOwned(actor,request,undefined,this.captureExecutionAuthority());}
  async submitFiles(actor:ContinuityActor,request:{inputId:string;prompt:string;filePaths:string[];context:TaskCreateInput['context']}):Promise<ConversationInputView>{
    const executionAuthority=this.captureExecutionAuthority();
    this.service.assertActor(actor,true);this.assertOwner();key(request.inputId);
    if(!Array.isArray(request.filePaths)||request.filePaths.length>64)throw new Error('invalid_argument');
    const original=this.normalize({prompt:request.prompt,materials:[],context:request.context});
    this.service.assertConversationExecution(request.context!.threadId!);this.service.requireConversation(actor,request.context!.threadId!);
    let bytes=0;const files=request.filePaths.map(path=>{
      if(typeof path!=='string'||!path||path.length>4096)throw new Error('invalid_argument');
      const resolved=realpathSync(path),stat=lstatSync(resolved);bytes+=stat.size;
      if(!stat.isFile()||stat.size>64*1024*1024||bytes>128*1024*1024)throw new Error('invalid_argument');
      return {path,resolved,size:stat.size,sha256:createHash('sha256').update(readFileSync(resolved)).digest('hex')};
    });
    const fileIntent={hash:digest([original,files]),record:JSON.stringify(files)};
    const previous=this.service.store.db.prepare('SELECT request_hash FROM conversation_input_files WHERE input_id=?').get(request.inputId);
    if(previous){if(previous.request_hash!==fileIntent.hash)throw new Error('input_conflict');const row=this.row(request.inputId);return this.submitOwned(actor,{inputId:request.inputId,input:JSON.parse(row.payload)},fileIntent,executionAuthority);}
    const pending=this.fileSubmissions.get(request.inputId);if(pending){if(pending.hash!==fileIntent.hash)throw new Error('input_conflict');return pending.pending;}
    const run=(async()=>{
      const materials:TaskCreateInput['materials']=[];
      for(const file of files){
        const record=await this.owner.materialRegistry.importMaterial({taskId:`intake_${randomUUID()}`,sourcePath:file.resolved,role:'customer_material',roleSource:'user'});
        this.assertOwner();if(record.sha256!==file.sha256||record.sizeBytes!==file.size)throw new Error('input_material_changed');materials.push({materialId:record.materialId,role:record.role});
      }
      this.assertOwner();return this.submitOwned(actor,{inputId:request.inputId,input:{...original,materials}},fileIntent,executionAuthority);
    })();
    this.fileSubmissions.set(request.inputId,{hash:fileIntent.hash,pending:run});try{return await run;}finally{if(this.fileSubmissions.get(request.inputId)?.pending===run)this.fileSubmissions.delete(request.inputId);}
  }
  readPendingPayload(id:string):TaskCreateInput{const row=this.row(id);this.assertAuthority(row);if(row.status!=='pending')throw new Error('input_not_pending');this.assertExecutionAuthority(row);return JSON.parse(row.payload);}
  private async submitOwned(actor:ContinuityActor,request:{inputId:string;input:TaskCreateInput},files:{hash:string;record:string}|undefined,executionAuthority:string|null):Promise<ConversationInputView>{
    this.service.assertActor(actor,true);this.assertOwner();key(request.inputId);
    const input=this.normalize(request.input),id=input.context!.threadId!;this.service.assertConversationExecution(id);this.service.requireConversation(actor,id);const manifest=this.manifest(input),hash=digest([input,manifest]);
    const previous=this.service.store.db.prepare('SELECT * FROM conversation_inputs WHERE input_id=?').get(request.inputId) as unknown as InputRow|undefined;
    if(previous){if(previous.deleted)throw new Error('not_readable');if(previous.conversation_id!==id||previous.payload_hash!==hash)throw new Error('input_conflict');this.assertAuthority(previous);return this.view(previous);}
    const reservation=this.owner.host.reserveTaskIdentity();
    this.service.store.transaction(()=>{
      this.service.requireConversation(actor,id);
      this.service.store.db.prepare("INSERT OR IGNORE INTO conversation_execution VALUES (?,?,1,'xiaok-native','open')").run(id,this.service.store.profileId);
      const execution=this.service.store.db.prepare('SELECT * FROM conversation_execution WHERE conversation_id=?').get(id)!;
      if(execution.authority!==this.service.store.profileId||execution.harness!=='xiaok-native'||execution.barrier!=='open')throw new Error('input_authority_changed');
      const sequence=Number(this.service.store.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM conversation_inputs WHERE conversation_id=?').get(id)!.next);
      this.service.store.db.prepare("INSERT INTO conversation_inputs (input_id,conversation_id,sequence,payload_hash,payload,material_manifest,task_id,source_epoch,authority,execution_epoch,execution_authority,status,claim_boot,revision,deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',NULL,1,0)").run(request.inputId,id,sequence,hash,JSON.stringify(input),manifest,reservation.taskId,reservation.sessionId,this.service.store.profileId,Number(execution.execution_epoch),executionAuthority);
      if(files)this.service.store.db.prepare('INSERT INTO conversation_input_files VALUES (?,?,?)').run(request.inputId,files.hash,files.record);
      this.service.recordMessage(actor,{conversationId:id,sourceKind:'desktop_task',sourceId:reservation.taskId,sourceDataEpoch:reservation.sessionId,sourceMessageId:'user',sourceRevision:1,role:'user',text:input.prompt,executionState:'pending'});
    });
    // The durable row alone is enough to restore after a lost ACK; no pre-start side effect.
    await this.owner.host.bindPendingInputIdentity(request.inputId,reservation);
    const current=this.row(request.inputId);this.assertAuthority(current);return this.view(current);
  }
  list(actor:ContinuityActor,conversationId:string):ConversationInputView[]{this.service.assertActor(actor,true);this.service.requireConversation(actor,conversationId);return (this.service.store.db.prepare('SELECT * FROM conversation_inputs WHERE conversation_id=? AND deleted=0 ORDER BY sequence').all(conversationId) as unknown as InputRow[]).map(row=>this.view(row));}
  readPendingIdentity(id:string):PendingTaskInputIdentity|null{
    const row=this.row(id);this.assertAuthority(row);if(row.status!=='pending')return null;
    return {taskId:row.task_id,sessionId:row.source_epoch,revision:String(row.revision)};
  }
  async claim(id:string,preparedInput?:TaskCreateInput):Promise<{reservation:TaskIdentityReservation;input:TaskCreateInput}>{
    const first=this.row(id);this.assertAuthority(first);this.assertExecutionAuthority(first);if(first.status!=='pending')throw new Error('input_not_pending');
    if(this.service.store.db.prepare("SELECT 1 FROM conversation_inputs WHERE conversation_id=? AND sequence<? AND status NOT IN ('completed','cancelled','failed_not_started') LIMIT 1").get(first.conversation_id,first.sequence))throw new Error('input_blocked');
    const reservation=await this.owner.host.restorePendingInputIdentity(id);
    const input=this.service.store.transaction(()=>{
      const row=this.row(id);this.assertAuthority(row);this.assertExecutionAuthority(row);if(row.status!=='pending'||row.revision!==first.revision)throw new Error('input_not_pending');
      if(this.service.store.db.prepare("SELECT 1 FROM conversation_inputs WHERE conversation_id=? AND sequence<? AND status NOT IN ('completed','cancelled','failed_not_started') LIMIT 1").get(row.conversation_id,row.sequence))throw new Error('input_blocked');
      const original=JSON.parse(row.payload) as TaskCreateInput;
      if(preparedInput){
        if(!this.owner.authorizePreparedInput)throw new Error('prepared_origin_missing');
        const checked:unknown=this.owner.authorizePreparedInput(id,preparedInput);if(checked!==undefined)throw new Error('prepared_origin_missing');
      }
      const prepared=this.normalize(preparedInput??original,true);
      if(prepared.prompt!==original.prompt||prepared.context?.threadId!==row.conversation_id||this.manifest(prepared)!==row.material_manifest)throw new Error('input_conflict');
      const encoded=JSON.stringify(prepared),preparedHash=digest(prepared);
      const update=this.service.store.db.prepare("UPDATE conversation_inputs SET status='claimed',claim_boot=?,prepared_payload=?,prepared_hash=? WHERE input_id=? AND status='pending' AND revision=?").run(this.bootId,encoded,preparedHash,id,row.revision);if(update.changes!==1)throw new Error('input_not_pending');return prepared;
    });
    this.claimedReservations.set(id,reservation);return {reservation,input};
  }
  assertPreparation(id:string,identity:PendingTaskInputIdentity,input:TaskCreateInput):void{
    const row=this.row(id);this.assertAuthority(row);this.assertExecutionAuthority(row);
    if(row.status!=='claimed'||row.claim_boot!==this.bootId||row.task_id!==identity.taskId||row.source_epoch!==identity.sessionId||String(row.revision)!==identity.revision||!row.prepared_hash||digest(this.normalize(input,true))!==row.prepared_hash)throw new Error('input_authority_changed');
  }
  assertAdmission(snapshot:TaskSnapshot):void{
    this.assertOwner();const row=this.service.store.db.prepare('SELECT * FROM conversation_inputs WHERE task_id=?').get(snapshot.taskId) as unknown as InputRow|undefined;
    if(!row){if(snapshot.inputPreparation)throw new Error('input_authority_changed');if(snapshot.context?.threadId&&!this.owner.isExistingAdmission?.(snapshot)&&this.service.store.db.prepare("SELECT 1 FROM conversation_inputs WHERE conversation_id=? AND status NOT IN ('completed','cancelled','failed_not_started') LIMIT 1").get(snapshot.context.threadId))throw new Error('input_blocked');return;}
    if(row.deleted)throw new Error('not_readable');this.assertAuthority(row);this.assertExecutionAuthority(row);
    const input=JSON.parse(row.prepared_payload??'null') as TaskCreateInput|null;
    if(!input||digest(input)!==row.prepared_hash||row.status!=='claimed'||row.claim_boot!==this.bootId||snapshot.sessionId!==row.source_epoch||snapshot.prompt!==input.prompt||snapshot.context?.threadId!==row.conversation_id||digest(snapshot.executionScope??null)!==digest(input.executionScope??null)||snapshot.inputPreparation?.inputId!==row.input_id||snapshot.inputPreparation?.inputRevision!==String(row.revision)||JSON.stringify(snapshot.materials.map(m=>[m.materialId,m.role]))!==JSON.stringify(JSON.parse(row.material_manifest).map((m:{materialId:string;role:string})=>[m.materialId,m.role])))throw new Error('input_authority_changed');
  }
  /** Last synchronous main IO admission: caller cannot supply a snapshot or proof. */
  assertCurrentExecution(taskId:string):void{
    key(taskId);this.assertOwner();
    const snapshot=originalReadSnapshot.call(this.owner.snapshotStore,taskId);
    if(!snapshot)throw new Error('input_execution_snapshot_unavailable');
    originalInputAdmission.call(this,snapshot);
  }
  finalizePreparationFailure(id:string):ConversationInputView{
    return this.service.store.transaction(()=>{
      this.assertOwner();const row=this.row(id);this.service.requireConversation(this.actor,row.conversation_id);
      if(row.status==='failed_not_started')return this.view(row);
      const reservation=this.claimedReservations.get(id);
      if(row.status!=='claimed'||row.claim_boot!==this.bootId||!reservation||reservation.taskId!==row.task_id||reservation.sessionId!==row.source_epoch||!row.prepared_hash)throw new Error('input_never_started_proof_unavailable');
      if(this.owner.assertPreparationFailure){const checked:unknown=this.owner.assertPreparationFailure(reservation);if(checked!==undefined)throw new Error('input_never_started_proof_unavailable');}
      this.owner.host.consumeFailedInputPreparation(id,reservation,String(row.revision),row.prepared_hash);
      if(this.service.store.db.prepare("UPDATE conversation_inputs SET status='failed_not_started',revision=revision+1 WHERE input_id=? AND status='claimed' AND claim_boot=? AND revision=?").run(id,this.bootId,row.revision).changes!==1)throw new Error('input_never_started_proof_unavailable');
      this.service.store.db.prepare("UPDATE message_anchors SET execution_state='unknown' WHERE source_id=? AND source_epoch=?").run(row.task_id,row.source_epoch);
      this.claimedReservations.delete(id);return this.view(this.row(id));
    });
  }

  markClaimUnknown(id:string):void{
    this.assertOwner();this.service.store.transaction(()=>{const row=this.row(id);this.service.requireConversation(this.actor,row.conversation_id);if(row.status==='claimed'&&row.claim_boot===this.bootId){this.service.store.db.prepare("UPDATE conversation_inputs SET status='unknown',revision=revision+1 WHERE input_id=? AND status='claimed' AND claim_boot=?").run(id,this.bootId);this.claimedReservations.delete(id);this.service.store.db.prepare("UPDATE message_anchors SET execution_state='unknown' WHERE source_id=? AND source_epoch=?").run(row.task_id,row.source_epoch);}});
  }
  async readAcceptedTask(id:string):Promise<{taskId:string;understanding?:TaskSnapshot['understanding']}>{
    const first=this.row(id);this.assertAuthority(first);if(!['claimed','completed'].includes(first.status))throw new Error('input_execution_unknown');
    await this.owner.snapshotStore.inspectPersistedTask(first.task_id);
    const row=this.row(id);this.assertAuthority(row);if(row.revision!==first.revision||!['claimed','completed'].includes(row.status))throw new Error('input_execution_unknown');
    const snapshot=this.owner.snapshotStore.inspectPersistedTaskSync(row.task_id),prepared=row.prepared_payload&&JSON.parse(row.prepared_payload) as TaskCreateInput|null,binding=this.service.store.db.prepare('SELECT conversation_id,revoked FROM task_bindings WHERE task_id=?').get(row.task_id);
    if(!snapshot||!prepared||digest(prepared)!==row.prepared_hash||snapshot.taskId!==row.task_id||snapshot.sessionId!==row.source_epoch||snapshot.prompt!==prepared.prompt||snapshot.context?.threadId!==row.conversation_id||digest(snapshot.executionScope??null)!==digest(prepared.executionScope??null)||snapshot.inputPreparation?.inputId!==id||!binding||binding.revoked||binding.conversation_id!==row.conversation_id)throw new Error('input_execution_unknown');
    this.service.assertTaskReadable(row.task_id);return {taskId:row.task_id,understanding:snapshot.understanding};
  }
  cancel(actor:ContinuityActor,id:string):ConversationInputView{
    this.service.assertActor(actor,true);return this.service.store.transaction(()=>{const row=this.row(id);this.assertOwner();this.service.requireConversation(actor,row.conversation_id);if(row.status==='cancelled')return this.view(row);if(row.status!=='pending')throw new Error('input_not_pending');this.service.store.db.prepare("UPDATE conversation_inputs SET status='cancelled',revision=revision+1 WHERE input_id=?").run(id);this.service.store.db.prepare("UPDATE message_anchors SET execution_state='unknown' WHERE source_id=? AND source_epoch=?").run(row.task_id,row.source_epoch);return this.view(this.row(id));});
  }
  async reconcile(id:string):Promise<ConversationInputView>{
    const first=this.row(id);this.assertAuthority(first);if(!['claimed','unknown','completed'].includes(first.status))throw new Error('blocked_unsettled');
    const snapshot=await this.owner.snapshotStore.inspectPersistedTask(first.task_id);
    return this.service.store.transaction(()=>{
      const row=this.row(id);this.assertAuthority(row);if(row.revision!==first.revision||row.task_id!==first.task_id||row.source_epoch!==first.source_epoch||!snapshot||snapshot.taskId!==row.task_id||snapshot.sessionId!==row.source_epoch||!row.prepared_payload||digest(JSON.parse(row.prepared_payload))!==row.prepared_hash||snapshot.prompt!==(JSON.parse(row.prepared_payload) as TaskCreateInput).prompt||digest(snapshot.executionScope??null)!==digest((JSON.parse(row.prepared_payload) as TaskCreateInput).executionScope??null)||snapshot.context?.threadId!==row.conversation_id||!['completed','failed','cancelled'].includes(snapshot.status))throw new Error('blocked_unsettled');
      const binding=this.service.store.db.prepare('SELECT conversation_id,revoked FROM task_bindings WHERE task_id=?').get(row.task_id);if(!binding||binding.revoked||binding.conversation_id!==row.conversation_id)throw new Error('blocked_unsettled');
      const fresh=this.owner.snapshotStore.inspectPersistedTaskSync(row.task_id);
      if(!fresh||effectSnapshotHash(fresh)!==effectSnapshotHash(snapshot))throw new Error('blocked_unsettled');
      this.service.assertHistorySourceClosed(row.task_id,fresh);
      const settlement=this.service.store.db.prepare('SELECT * FROM source_settlements WHERE task_id=?').get(row.task_id);if(!settlement||settlement.source_epoch!==row.source_epoch||settlement.event_count!==snapshot.events.length||settlement.prefix_hash!==digest(snapshot.events))throw new Error('blocked_unsettled');
      this.service.store.db.prepare("UPDATE conversation_inputs SET status='completed',revision=revision+CASE WHEN status='completed' THEN 0 ELSE 1 END WHERE input_id=?").run(id);this.claimedReservations.delete(id);return this.view(this.row(id));
    });
  }
  close():void{
    if(this.closed)return;this.closed=true;this.claimedReservations.clear();
    const physicalImports=[...this.fileSubmissions.values()].map(job=>job.pending);
    if(physicalImports.length)this.closeCompletion=Promise.allSettled(physicalImports).then(()=>{this.lock.close();});
    else this.lock.close();
  }
  async drainClosed():Promise<void>{if(!this.closed)throw new Error('input_owner_still_open');await this.closeCompletion;}
}

const originalReadSnapshot=FileTaskSnapshotStore.prototype.inspectPersistedTaskSync;
const originalInputAdmission=ContinuityInputJournal.prototype.assertAdmission;
