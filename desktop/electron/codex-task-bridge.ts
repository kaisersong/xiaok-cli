import type { NativeEvent } from './codex-native-transport.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodexNativeService, type NativeActor, type NativeServiceOptions, type NativeSendReceipt, type NativeTurnCompletionReceipt } from './codex-native-service.js';
import type { SourceSettlementReceipt } from './context-continuity/task-source.js';
import { digest } from './context-continuity/store.js';
import { InProcessTaskRuntimeHost, type TaskRunnerInput, type PersistedTaskEvent, type InProcessTaskRuntimeHostOptions } from '../../src/runtime/task-host/task-runtime-host.js';
import type { MaterialRegistry } from '../../src/runtime/task-host/material-registry.js';
import type { FileTaskSnapshotStore } from '../../src/runtime/task-host/snapshot-store.js';
import type { TaskSnapshot } from '../shared/task-types.js';
import type { TaskCreateInput, UserAnswer } from '../../src/runtime/task-host/types.js';
export const LOCAL_CODEX_MODEL = 'local-codex';
interface CodexTaskBridgeOptions {
  dataRoot: string; profileId: string; cwd: string; materialRegistry: MaterialRegistry; snapshotStore: FileTaskSnapshotStore;
  admitThread?: (id: string) => Promise<void | (() => void)>;
  createClient?: NativeServiceOptions['createClient'];
  initializeOwner?:NativeServiceOptions['initializeOwner'];migrateFromProfileId?:string;
  assertNativeExecutionAvailable?:()=>void;
  onTaskPrepared?: (input: TaskCreateInput, taskId: string) => Promise<void>;
  onPersistedEvent?: (input: PersistedTaskEvent) => Promise<void> | void;
  assertHistoryRead?: (taskId: string, conversationId: string | undefined) => Promise<void> | void;
  resolveOwnedHistory?: InProcessTaskRuntimeHostOptions['resolveOwnedHistory'];
  assertContextAdmission?: (taskId: string) => void;
  acquireNativeContext?: (taskId:string,routeTaskIds:string[])=>void;
  onHistoryLoaded?: (taskId: string, sources: TaskSnapshot[], conversationId: string | undefined) => Promise<void> | void;
  onExecutionSettled?: (snapshot: TaskSnapshot, receipt: SourceSettlementReceipt) => Promise<void> | void;
}
export class CodexTaskBridge {
  readonly host: InProcessTaskRuntimeHost;
  private db: DatabaseSync;
  private native: CodexNativeService;
  private actor: NativeActor;
  private observers = new Map<string,()=>void>();
  private runs = new Map<string,string>();
  private nativeEvents = new Map<string,(event:NativeEvent)=>void>();
  private closing=false;
  private completedTurns = new Map<string, NativeTurnCompletionReceipt>();
  constructor(private options: CodexTaskBridgeOptions) {
    mkdirSync(options.dataRoot,{recursive:true});this.actor={requestSource:'user',actorId:options.profileId};
    this.db=new DatabaseSync(join(options.dataRoot,'codex-task-routes.sqlite'));
    this.db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT); CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY,native_id TEXT); CREATE TABLE IF NOT EXISTS routes(task_id TEXT PRIMARY KEY,thread_id TEXT NOT NULL)');
    this.db.exec('CREATE TABLE IF NOT EXISTS native_task_bindings (task_id TEXT PRIMARY KEY, receipt TEXT NOT NULL, settlement TEXT)');
    this.native=new CodexNativeService({dbPath:join(options.dataRoot,'codex-native.sqlite'),profileId:options.profileId,initializeOwner:options.initializeOwner,migrateFromProfileId:options.migrateFromProfileId,createClient:options.createClient,onChanged:id=>this.observers.get(id)?.(),onEvent:(id,event)=>this.nativeEvents.get(id)?.(event),authorizeExecution:id=>this.assertNativeContext(id)});
    this.host=new InProcessTaskRuntimeHost({materialRegistry:options.materialRegistry,snapshotStore:options.snapshotStore,runner:input=>this.run(input),createTaskId:()=>`task_codex_${randomUUID()}`,aheGuards:{artifactEvidence:true,recoveryContinuity:true},resolveOwnedHistory:options.resolveOwnedHistory,assertTaskAdmission:snapshot=>options.assertContextAdmission?.(snapshot.taskId),assertHistoryRead:options.assertHistoryRead,onHistoryLoaded:options.onHistoryLoaded,onPersistedEvent:options.onPersistedEvent,onExecutionSettled:async snapshot=>{
      const proof=this.completedTurns.get(snapshot.taskId);this.completedTurns.delete(snapshot.taskId);
      if(proof)await options.onExecutionSettled?.(snapshot,{physicallySettled:false,sourceEpoch:snapshot.sessionId,eventCount:snapshot.events.length,prefixHash:digest(snapshot.events)});
    }});
  }
  private assertNativeContext(nativeId:string):void {
    // A resumed native session may retain prior task context even when the renderer omits it.
    const thread=this.db.prepare('SELECT id FROM threads WHERE native_id=?').get(nativeId);
    if(!thread)throw new Error('native_route_missing');
    const routes=this.db.prepare('SELECT task_id FROM routes WHERE thread_id=?').all(String(thread.id)).map(row=>String(row.task_id));
    for(const taskId of routes)this.options.assertContextAdmission?.(taskId);
    const current=[...this.runs].find(([,id])=>id===nativeId)?.[0];if(!current)throw new Error('native_context_unknown');
    this.options.acquireNativeContext?.(current,routes);
  }
  selected(){return this.db.prepare('SELECT value FROM settings WHERE key=?').get('selected')?.value==='true';}
  select(value:boolean){this.db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run('selected',String(value));}
  owns(taskId:string){return Boolean(this.db.prepare('SELECT task_id FROM routes WHERE task_id=?').get(taskId));}
  authorize(actor?:NativeActor){if(this.closing||actor?.requestSource!=='user'||actor.actorId!==this.actor.actorId)throw new Error('native_access_denied');}
  async create(input:TaskCreateInput,actor?:NativeActor){
    this.authorize(actor);const threadId=input.context?.threadId;if(!threadId)throw new Error('native_thread_required');
    this.options.assertNativeExecutionAvailable?.();
    const revalidate=await this.options.admitThread?.(threadId);
    const task=await this.host.prepareTask(input);
    this.db.prepare('INSERT INTO routes VALUES (?,?)').run(task.taskId,threadId);
    try { await this.options.onTaskPrepared?.(input, task.taskId); revalidate?.(); await this.host.startTask(task.taskId); }
    catch(error){await this.host.cancelTask(task.taskId,'admission_revoked');throw error;}
    return task;
  }
  async answer(input:{taskId:string;answer:UserAnswer},actor?:NativeActor){
    this.authorize(actor);const nativeId=this.runs.get(input.taskId);if(!nativeId||input.answer.type!=='choice'||!['approve','deny'].includes(input.answer.choiceId))throw new Error('native_approval_expired');
    if(input.answer.choiceId==='approve')this.options.assertContextAdmission?.(input.taskId);
    await this.native.decide(this.actor,nativeId,input.answer.questionId,input.answer.choiceId==='approve'?'allow':'deny');
  }
  async cancel(id:string,actor?:NativeActor){this.authorize(actor);return this.host.cancelTask(id);}
  private async run(input:TaskRunnerInput){
    const route=this.db.prepare('SELECT thread_id FROM routes WHERE task_id=?').get(input.taskId);if(!route)throw new Error('native_route_missing');
    const threadId=String(route.thread_id);
    let nativeId=this.db.prepare('SELECT native_id FROM threads WHERE id=?').get(threadId)?.native_id as string|undefined;
    if(!nativeId){nativeId=(await this.native.create(this.actor,this.options.cwd)).id;this.db.prepare('INSERT INTO threads VALUES (?,?)').run(threadId,nativeId);}
    if(this.observers.has(nativeId))throw new Error('native_thread_busy');
    const id=nativeId;this.runs.set(input.taskId,id);
    const initial=this.native.get(this.actor,id);const offsets=new Map(initial.messages.map(m=>[m.id,m.text.length]));const questions=new Set<string>();let answer='';let started=false;let settled=false;let chain=Promise.resolve();let sendReceipt:NativeSendReceipt|null=null;
    const eventBase={sessionId:input.sessionId,turnId:input.taskId,intentId:'codex',stepId:'codex'};
    let resolve!:()=>void,reject!:(e:unknown)=>void;const done=new Promise<void>((a,b)=>{resolve=a;reject=b;});
    const pump=async()=>{
      if(!started||settled)return;const view=this.native.get(this.actor,id);
      for(const m of view.messages){if(m.role!=='assistant')continue;const from=offsets.get(m.id)??0;const delta=m.text.slice(from);offsets.set(m.id,m.text.length);if(delta){answer+=delta;await input.emitRuntimeEvent({type:'assistant_delta',...eventBase,delta});}}
      for(const a of view.approvals)if(!questions.has(a.token)){questions.add(a.token);await input.emitRuntimeEvent({type:'approval_required',...eventBase,approvalId:a.token,prompt:a.description,choices:[{id:'approve',label:'允许一次 / Allow once'},{id:'deny',label:'拒绝 / Deny'}]});}
      for(const token of [...questions]) if(!view.approvals.some(a=>a.token===token)){questions.delete(token);await input.emitRuntimeEvent({type:'approval_resolved',...eventBase,approvalId:token});}
      if(view.status==='error'){reject(new Error(view.error||'native_execution_failed'));return;}
      if(view.status==='idle'&&view.queued===0&&sendReceipt&&this.native.readTurnCompletion(this.actor,id,sendReceipt)){settled=true;await input.emitRuntimeEvent({type:'receipt_emitted',...eventBase,note:JSON.stringify({summary:answer,artifacts:[]})});resolve();}
    };
    this.observers.set(id,()=>{chain=chain.then(pump).catch(reject);});
    this.nativeEvents.set(id,event=>{
      const item=event.params?.item;if(!item||!['commandExecution','fileChange','mcpToolCall'].includes(item.type))return;
      const toolName=`codex.${item.type}`;
      if(event.method==='item/started') chain=chain.then(()=>input.emitRuntimeEvent({type:'pre_tool_use',...eventBase,toolName,toolUseId:item.id,toolInput:item})).catch(reject);
      if(event.method==='item/completed') {
        const failed=item.status==='failed'||item.status==='declined'||(typeof item.exitCode==='number'&&item.exitCode!==0);
        chain=chain.then(()=>input.emitRuntimeEvent(failed
          ? {type:'post_tool_use_failure',...eventBase,toolName,toolUseId:item.id,toolInput:item,error:String(item.aggregatedOutput??item.error??item.status)}
          : {type:'post_tool_use',...eventBase,toolName,toolUseId:item.id,toolInput:item,toolResponse:item.aggregatedOutput??item})).catch(reject);
      }
    });
    const abort=()=>{void this.native.interrupt(this.actor,id).then(()=>reject(new Error('native_cancelled')),reject);};
    input.signal.addEventListener('abort',abort,{once:true});
    try{
      if(input.signal.aborted)throw new Error('native_cancelled');
      const snapshot=await this.options.snapshotStore.recoverTask(input.taskId);
      const priorTask=snapshot?.context?.taskIds?.at(-1);
      const needsContext=!initial.messages.length || (priorTask && !this.owns(priorTask));
      const history=needsContext&&input.history.length?JSON.stringify(input.history):'';
      const attachments=input.materials.map(m=>`${m.originalName}: ${m.workspacePath}`).join('\n');
      sendReceipt=await this.native.sendWork(this.actor,id,{prompt:input.prompt,contextText:history,attachmentsText:attachments},input.taskId,{requireImmediate:true});
      if(!sendReceipt)throw new Error('native_send_binding_unknown');
      this.db.prepare('INSERT INTO native_task_bindings VALUES (?,?,NULL)').run(input.taskId,JSON.stringify(sendReceipt));
      started=true;this.observers.get(id)?.();await done;
    }finally{
      // Drain every original task write before detaching; a logical terminal string is insufficient.
      for(;;){const pending=chain;await pending;if(pending===chain)break;}
      input.signal.removeEventListener('abort',abort);this.observers.delete(id);this.nativeEvents.delete(id);this.runs.delete(input.taskId);
      if(sendReceipt){
        const proof=this.native.readTurnCompletion(this.actor,id,sendReceipt);
        if(proof){this.db.prepare('UPDATE native_task_bindings SET settlement=? WHERE task_id=?').run(JSON.stringify(proof),input.taskId);this.completedTurns.set(input.taskId,proof);}
      }
    }
  }
  async stopThread(threadId:string){
    for(const row of this.db.prepare('SELECT task_id FROM routes WHERE thread_id=?').all(threadId)){if(this.runs.has(String(row.task_id)))await this.host.cancelTask(String(row.task_id),'user_deleted_thread');}
    const nativeId=this.db.prepare('SELECT native_id FROM threads WHERE id=?').get(threadId)?.native_id;
    if(nativeId)await this.native.disconnect(this.actor,String(nativeId));
    this.assertDeletionSafe();
  }
  assertDeletionSafe():void{
    // Legacy routes may have consumed other threads without a continuity edge. Absence is not proof.
    if(this.db.prepare('SELECT 1 FROM routes LIMIT 1').get()||this.db.prepare('SELECT 1 FROM threads LIMIT 1').get())throw new Error('blocked_unsettled');
    this.native.assertNoUnknownExecution(this.actor);
  }
  async stopForRevocation(){this.host.abortAllActive();await this.host.drain();}
  async dispose(){if(this.closing)return;this.closing=true;this.host.stopAccepting();this.host.abortAllActive();await this.host.drain();await this.native.dispose();this.db.close();}
}
