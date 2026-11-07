import {assertOrdinarySourceWriterRoute,observeOrdinarySQLiteWriter} from '../../src/runtime/verification/ordinary-source-writer-observation.js';
import {assertBeforeEffects} from '../../src/runtime/verification/before-effects.js';
import type { NativeEvent } from './codex-native-transport.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodexNativeService, type NativeActor, type NativeServiceOptions, type NativeTaskTurn, type NativeApprovalInventory } from './codex-native-service.js';
import { InProcessTaskRuntimeHost, readCurrentOriginalTaskRunnerResourceContext, readOriginalTaskRunnerResourceContextForHost, type TaskRunnerInput, type createTaskSourceWriterPopulation, type OriginalTaskRunnerResourceContext } from '../../src/runtime/task-host/task-runtime-host.js';
import type { MaterialRegistry } from '../../src/runtime/task-host/material-registry.js';
import type { FileTaskSnapshotStore } from '../../src/runtime/task-host/snapshot-store.js';
import type { TaskCreateInput, UserAnswer } from '../../src/runtime/task-host/types.js';
import {parseNativeApprovalOwner} from '../../src/runtime/task-host/native-approval-owner.js';
import { hasOriginalMainSdkBridgeInstallation } from '../../src/runtime/verification/original-main-sdk-bridge.js';
export const LOCAL_CODEX_MODEL = 'local-codex';
type NativeTaskRun = { nativeId: string; threadId: string; sessionId: string; turn?: NativeTaskTurn };
type CodexBridgeBirth={bridge:CodexTaskBridge;service:CodexNativeService;host:InProcessTaskRuntimeHost;store:FileTaskSnapshotStore;assertLocal():void};
type CodexBridgeInvocation={birth:CodexBridgeBirth;context:object;input:TaskRunnerInput;view:OriginalTaskRunnerResourceContext;active:boolean;threadId:string|null;nativeSessionId:string|undefined};
const codexServiceBirths=new WeakMap<object,CodexBridgeBirth>(),codexInvocations=new WeakMap<object,CodexBridgeInvocation>();
const codexGet=WeakMap.prototype.get,codexSet=WeakMap.prototype.set,codexDelete=WeakMap.prototype.delete,codexApply=Reflect.apply;
const codexDescriptor=Object.getOwnPropertyDescriptor,codexOwn=Object.hasOwn;
function codexData(value:object,name:string):unknown{const d=codexDescriptor(value,name);return d&&codexOwn(d,'value')?d.value:undefined;}
let originalCodexRun:Function;
async function runOriginalCodexInvocation(bridge:CodexTaskBridge,input:TaskRunnerInput,birth:CodexBridgeBirth):Promise<void>{
  if(!hasOriginalMainSdkBridgeInstallation())return await codexApply(originalCodexRun,bridge,[input]);
  birth.assertLocal();const context=readCurrentOriginalTaskRunnerResourceContext();
  if(!context)throw Error('CODEX_PROCESS_ORIGINAL_CONTEXT_REQUIRED');
  const view=readOriginalTaskRunnerResourceContextForHost(context,birth.host,birth.store);
  if(view.taskId!==input.taskId||codexApply(codexGet,codexInvocations,[context]))throw Error('CODEX_PROCESS_ORIGINAL_INVOCATION_REQUIRED');
  const frame:CodexBridgeInvocation={birth,context,input,view,active:true,threadId:null,nativeSessionId:undefined};
  codexApply(codexSet,codexInvocations,[context,frame]);
  try{await codexApply(originalCodexRun,bridge,[input]);}
  finally{frame.active=false;codexApply(codexDelete,codexInvocations,[context]);}
}
/** This is the actual original Bridge/Service/Host/Store/task relation. A new
 * public genuine Service under some other original Host is not this producer. */
export function readOriginalCodexTaskServiceContext(service:unknown,nativeSessionId:string):Readonly<{context:object;assertCurrent():void;assertLocal():void}>{
  const birth=codexApply(codexGet,codexServiceBirths,[service]) as CodexBridgeBirth|undefined;
  if(!birth)throw Error('CODEX_PROCESS_ORIGINAL_BRIDGE_REQUIRED');
  const context=readCurrentOriginalTaskRunnerResourceContext(),frame=context?codexApply(codexGet,codexInvocations,[context]) as CodexBridgeInvocation|undefined:undefined;
  if(!context||!frame||frame.birth!==birth||!frame.active||!frame.threadId)throw Error('CODEX_PROCESS_ORIGINAL_INVOCATION_REQUIRED');
  if(frame.nativeSessionId===undefined)frame.nativeSessionId=nativeSessionId;
  if(frame.nativeSessionId!==nativeSessionId)throw Error('CODEX_PROCESS_ORIGINAL_SESSION_REQUIRED');
  let retired=false;
  const assertLocal=()=>{try{if(retired||!frame.active||codexApply(codexGet,codexInvocations,[context])!==frame||frame.birth!==birth||frame.nativeSessionId!==nativeSessionId)throw Error('CODEX_PROCESS_ORIGINAL_INVOCATION_RETIRED');birth.assertLocal();frame.view.assertLocal();}catch(error){retired=true;throw error;}};
  const assertCurrent=()=>{assertLocal();try{frame.view.assertCurrent();}catch(error){retired=true;throw error;}assertLocal();};
  assertCurrent();return Object.freeze({context,assertCurrent,assertLocal});
}
export type CodexQuestionInventory = NativeApprovalInventory & Readonly<{ taskId: string; threadId: string; taskSessionId: string }>;
export class CodexTaskBridge {
  static{originalCodexRun=CodexTaskBridge.prototype.run;}
  readonly host: InProcessTaskRuntimeHost;
  private db: DatabaseSync;
  private native: CodexNativeService;
  private actor: NativeActor;
  private observers = new Map<string,()=>void>();
  private runs = new Map<string,NativeTaskRun>();
  private readonly questionProofs = new WeakMap<CodexQuestionInventory, { run: NativeTaskRun; native: NativeApprovalInventory }>();
  private nativeEvents = new Map<string,(event:NativeEvent)=>void>();
  private closing=false;
  private disposal?:Promise<void>;
  private quiescence?:Promise<void>;
  private readonly creations=new Set<Promise<unknown>>();
  constructor(private options:{dataRoot:string;profileId:string;cwd:string;materialRegistry:MaterialRegistry;snapshotStore:FileTaskSnapshotStore;sourcePopulation?:ReturnType<typeof createTaskSourceWriterPopulation>;admitThread?:(id:string,current:()=>void)=>Promise<void|(()=>void)>;beforeStartTask?:(task:Awaited<ReturnType<InProcessTaskRuntimeHost['prepareTask']>>,actor:NativeActor,current:()=>void)=>Promise<void>|void;createClient?:NativeServiceOptions['createClient']}) {
    assertOrdinarySourceWriterRoute();
    options.sourcePopulation?.assertAccepting();
    mkdirSync(options.dataRoot,{recursive:true});this.actor={requestSource:'user',actorId:options.profileId};
    this.db=new DatabaseSync(join(options.dataRoot,'codex-task-routes.sqlite'));
    let native:CodexNativeService|undefined;
    try {
    observeOrdinarySQLiteWriter(join(options.dataRoot,'codex-task-routes.sqlite'),'codex-routes-sqlite-v1');
    this.db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT); CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY,native_id TEXT); CREATE TABLE IF NOT EXISTS routes(task_id TEXT PRIMARY KEY,thread_id TEXT NOT NULL)');
    this.native=native=new CodexNativeService({dbPath:join(options.dataRoot,'codex-native.sqlite'),profileId:options.profileId,createClient:options.createClient,onChanged:id=>this.observers.get(id)?.(),onEvent:(id,event)=>this.nativeEvents.get(id)?.(event)});
    let sourceBirth:CodexBridgeBirth;
    const hostOptions={materialRegistry:options.materialRegistry,snapshotStore:options.snapshotStore,runner:(input:TaskRunnerInput)=>runOriginalCodexInvocation(this,input,sourceBirth),createTaskId:()=>`task_codex_${randomUUID()}`,aheGuards:{artifactEvidence:true,recoveryContinuity:true}};
    this.host=options.sourcePopulation ? options.sourcePopulation.createHost(hostOptions) : new InProcessTaskRuntimeHost(hostOptions);
    sourceBirth={bridge:this,service:this.native,host:this.host,store:options.snapshotStore,assertLocal:()=>{if(codexData(this,'closing')!==false||codexData(this,'native')!==sourceBirth.service||codexData(this,'host')!==sourceBirth.host)throw Error('CODEX_PROCESS_ORIGINAL_BRIDGE_RETIRED');}};
    codexApply(codexSet,codexServiceBirths,[this.native,sourceBirth]);
    }catch(error){try{native?.closeBeforeUse();}catch{/* Preserve initialization failure. */}try{this.db.close();}catch{/* Preserve initialization failure. */}throw error;}
  }
  selected(){return this.db.prepare('SELECT value FROM settings WHERE key=?').get('selected')?.value==='true';}
  select(value:boolean){this.db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run('selected',String(value));}
  owns(taskId:string){return Boolean(this.db.prepare('SELECT task_id FROM routes WHERE task_id=?').get(taskId));}
  authorize(actor?:NativeActor){if(this.closing||actor?.requestSource!=='user'||actor.actorId!==this.actor.actorId)throw new Error('native_access_denied');}
  create(input:TaskCreateInput,actor?:NativeActor,current?:()=>void){
    const pending=this.createOwned(input,actor,current);this.creations.add(pending);
    void pending.then(()=>this.creations.delete(pending),()=>this.creations.delete(pending));return pending;
  }
  private async createOwned(input:TaskCreateInput,actor?:NativeActor,current?:()=>void){
    const assertCurrent=()=>{this.authorize(actor);assertBeforeEffects(current);this.authorize(actor);};
    assertCurrent();const threadId=input.context?.threadId;if(!threadId)throw new Error('native_thread_required');
    const revalidate=await this.options.admitThread?.(threadId,assertCurrent);
    const admitted=()=>{assertCurrent();if(revalidate)assertBeforeEffects(revalidate);assertCurrent();};
    admitted();
    const task=await this.host.prepareTask(input);
    let startCalled=false;
    try {
      admitted();this.db.prepare('INSERT INTO routes VALUES (?,?)').run(task.taskId,threadId);
      await this.options.beforeStartTask?.(task,actor!,admitted);admitted();
      startCalled=true;await this.host.startTask(task.taskId);
    }catch(primary){
      try{await this.host.cancelTask(task.taskId,startCalled?'native_start_failed':'admission_revoked');}
      catch(cleanup){throw new AggregateError([primary,cleanup],startCalled?'native_start_and_cancel_failed':'native_preparation_and_cancel_failed');}
      throw primary;
    }
    return task;
  }
  async answer(input:{taskId:string;answer:UserAnswer},actor?:NativeActor,current?:()=>void){
    this.authorize(actor);const run=this.runs.get(input.taskId);if(!run?.turn||input.answer.type!=='choice'||!['approve','deny'].includes(input.answer.choiceId))throw new Error('native_approval_expired');
    this.native.assertTaskTurnCurrent(this.actor,run.turn);
    const check=()=>{this.authorize(actor);assertBeforeEffects(current);this.assertTaskRouteIdentity({taskId:input.taskId,threadId:run.threadId,sessionId:run.sessionId},actor!);this.native.assertTaskTurnCurrent(this.actor,run.turn!);};check();
    await this.native.decide(this.actor,run.nativeId,input.answer.questionId,input.answer.choiceId==='approve'?'allow':'deny',check);
    this.observers.get(run.nativeId)?.();
  }
  /** Current IPC admission only narrows the original private inventory grant. */
  async answerFromQuestionInventory(input:{taskId:string;answer:UserAnswer},actor:NativeActor,frame:CodexQuestionInventory,current:()=>void):Promise<void>{
    this.assertQuestionInventoryCurrent(actor,frame);
    if(input.taskId!==frame.taskId||input.answer.type!=='choice'||!['approve','deny'].includes(input.answer.choiceId)||!frame.questions.some(question=>question.token===input.answer.questionId))throw Error('native_approval_expired');
    const proof=this.questionProofs.get(frame)!;
    const guard=()=>{
      assertBeforeEffects(current);
      this.assertQuestionInventoryCurrent(actor,frame);
      this.assertTaskRouteIdentity({taskId:frame.taskId,threadId:frame.threadId},actor);
    };
    await this.native.decide(this.actor,proof.run.nativeId,input.answer.questionId,input.answer.choiceId==='approve'?'allow':'deny',guard);
    // The actual Native decision is already acknowledged. No post-effect
    // authorization or awaited metadata refresh can turn it into a retry.
    this.observers.get(proof.run.nativeId)?.();
  }
  assertTaskRouteIdentity(input:{taskId:string;threadId:string;sessionId?:string},actor:NativeActor):void{
    this.authorize(actor);
    const route=this.db.prepare('SELECT thread_id FROM routes WHERE task_id=?').get(input.taskId);
    if(!route||route.thread_id!==input.threadId||input.sessionId!==undefined&&this.runs.get(input.taskId)?.sessionId!==input.sessionId)throw Error('native_task_route_forbidden');
  }
  readQuestionInventory(input:{taskId:string;threadId:string;sessionId:string},actor?:NativeActor):CodexQuestionInventory {
    this.authorize(actor);
    const run=this.runs.get(input.taskId);
    const route=this.db.prepare('SELECT thread_id FROM routes WHERE task_id=?').get(input.taskId);
    if(!run?.turn || route?.thread_id!==input.threadId || run.threadId!==input.threadId || run.sessionId!==input.sessionId)throw Error('native_question_inventory_unavailable');
    this.native.assertTaskTurnCurrent(this.actor,run.turn);
    const native=this.native.readApprovalInventory(this.actor,run.nativeId);
    const frame=Object.freeze({...native,taskId:input.taskId,threadId:input.threadId,taskSessionId:input.sessionId});
    this.questionProofs.set(frame,{run,native});return frame;
  }
  assertQuestionInventoryCurrent(actor:NativeActor|undefined,frame:CodexQuestionInventory):void {
    this.authorize(actor);
    const proof=this.questionProofs.get(frame);
    if(!proof || this.runs.get(frame.taskId)!==proof.run || !proof.run.turn)throw Error('native_question_inventory_stale');
    this.native.assertTaskTurnCurrent(this.actor,proof.run.turn);
    this.native.assertApprovalInventoryCurrent(this.actor,proof.native);
  }
  async cancel(id:string,actor?:NativeActor){this.authorize(actor);return this.host.cancelTask(id);}
  private async run(input:TaskRunnerInput){
    const qualified=hasOriginalMainSdkBridgeInstallation();
    const route=this.db.prepare('SELECT thread_id FROM routes WHERE task_id=?').get(input.taskId);if(!route)throw new Error('native_route_missing');
    const threadId=String(route.thread_id);
    let nativeId=this.db.prepare('SELECT native_id FROM threads WHERE id=?').get(threadId)?.native_id as string|undefined;
    if(qualified){const context=readCurrentOriginalTaskRunnerResourceContext(),frame=context?codexApply(codexGet,codexInvocations,[context]) as CodexBridgeInvocation|undefined:undefined;if(!frame||frame.birth.bridge!==this||frame.input!==input)throw Error('CODEX_PROCESS_ORIGINAL_INVOCATION_REQUIRED');frame.threadId=threadId;frame.nativeSessionId=nativeId;}
    if(!nativeId){nativeId=(await this.native.create(this.actor,this.options.cwd)).id;this.db.prepare('INSERT INTO threads VALUES (?,?)').run(threadId,nativeId);}
    if(this.observers.has(nativeId))throw new Error('native_thread_busy');
    const id=nativeId;const run:NativeTaskRun={nativeId:id,threadId,sessionId:input.sessionId};this.runs.set(input.taskId,run);
    const initial=this.native.get(this.actor,id);const offsets=new Map(initial.messages.map(m=>[m.id,m.text.length]));const questions=new Set<string>();let answer='';let started=false;let settled=false;let chain=Promise.resolve();
    const eventBase={sessionId:input.sessionId,turnId:input.taskId,intentId:'codex',stepId:'codex'};
    let resolve!:()=>void,reject!:(e:unknown)=>void;const done=new Promise<void>((a,b)=>{resolve=a;reject=b;});
    // An actual question event can precede the held start ACK. Keep its failure
    // owned until the original send reaches the await of this same promise.
    void done.catch(()=>{});
    const pump=async()=>{
      if(settled)return;const view=this.native.get(this.actor,id);
      let inventory:NativeApprovalInventory|undefined;
      if(run.turn)try{
        this.native.assertTaskTurnCurrent(this.actor,run.turn);
        inventory=this.native.readApprovalInventory(this.actor,id);
      }catch(error){
        if(!(error instanceof Error)||!['native_access_denied','native_task_turn_stale','native_approval_inventory_unavailable'].includes(error.message))throw error;
        // Unknown is not an empty inventory. The original terminal source will
        // close the work after the original send/receipt actually settles.
      }
      if(inventory){
        const current=()=>{
          if(this.closing||this.runs.get(input.taskId)!==run||!run.turn)return false;
          try{this.native.assertTaskTurnCurrent(this.actor,run.turn);this.native.assertApprovalInventoryCurrent(this.actor,inventory!);return true;}
          catch(error){if(error instanceof Error&&['native_access_denied','native_task_turn_stale','native_approval_inventory_stale','native_approval_inventory_unavailable'].includes(error.message))return false;throw error;}
        };
        for(const a of inventory.questions)if(!questions.has(a.token)){
          if(!current())return;
          const owner=parseNativeApprovalOwner({schemaVersion:1,kind:'codex_native_approval',taskSessionId:input.sessionId,nativeIncarnation:inventory.incarnation,
            nativeSessionId:inventory.sessionId,nativeThreadId:inventory.nativeThreadId,nativeTurnId:inventory.turnId,nativeTurnGeneration:inventory.generation,approvalToken:a.token,requestDigest:a.requestDigest});
          questions.add(a.token);await input.emitRuntimeEvent({type:'approval_required',...eventBase,approvalId:a.token,prompt:a.description,owner,choices:[{id:'approve',label:'允许一次 / Allow once'},{id:'deny',label:'拒绝 / Deny'}]});
        }
        for(const token of [...questions])if(!inventory.questions.some(a=>a.token===token)){
          if(!current())return;
          questions.delete(token);await input.emitRuntimeEvent({type:'approval_resolved',...eventBase,approvalId:token});
        }
      }
      if(!started)return;
      for(const m of view.messages){if(m.role!=='assistant')continue;const from=offsets.get(m.id)??0;const delta=m.text.slice(from);offsets.set(m.id,m.text.length);if(delta){answer+=delta;await input.emitRuntimeEvent({type:'assistant_delta',...eventBase,delta});}}
      if(view.status==='error'){reject(new Error(view.error||'native_execution_failed'));return;}
      if(view.status==='idle'&&view.queued===0){settled=true;await input.emitRuntimeEvent({type:'receipt_emitted',...eventBase,note:JSON.stringify({summary:answer,artifacts:[]})});resolve();}
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
    let failed=false,primary:unknown,cleanupFailed=false,cleanupError:unknown;
    try{
      if(input.signal.aborted)throw new Error('native_cancelled');
      const snapshot=await this.options.snapshotStore.recoverTask(input.taskId);
      const priorTask=snapshot?.context?.taskIds?.at(-1);
      const needsContext=!initial.messages.length || (priorTask && !this.owns(priorTask));
      const history=needsContext&&input.history.length?`Previous conversation context:\n${JSON.stringify(input.history)}\n\n`:'';
      const attachments=input.materials.map(m=>`${m.originalName}: ${m.workspacePath}`).join('\n');
      await this.native.sendTaskTurn(this.actor,id,`${history}${input.prompt}${attachments?`\n\nAttached working copies:\n${attachments}`:''}`,turn=>{
        if(this.closing || this.runs.get(input.taskId)!==run || run.turn)return;
        run.turn=turn;
      });started=true;this.observers.get(id)?.();await done;await chain;
    }catch(error){failed=true;primary=error;}
    finally{
      input.signal.removeEventListener('abort',abort);this.observers.delete(id);this.nativeEvents.delete(id);this.runs.delete(input.taskId);
      // A qualified process belongs to this actual runner incarnation. Preserve
      // the durable native thread id, but never retain its live client past Root.
      if(qualified)try{await this.native.disconnect(this.actor,id);}catch(cleanup){
        cleanupFailed=true;cleanupError=cleanup;
      }
    }
    if(failed&&cleanupFailed)throw new AggregateError([primary,cleanupError],'CODEX_TASK_AND_PROCESS_CLEANUP_FAILED',{cause:primary});
    if(failed)throw primary;
    if(cleanupFailed)throw cleanupError;
  }
  async stopThread(threadId:string){
    for(const row of this.db.prepare('SELECT task_id FROM routes WHERE thread_id=?').all(threadId)){if(this.runs.has(String(row.task_id)))await this.host.cancelTask(String(row.task_id),'user_deleted_thread');}
    const nativeId=this.db.prepare('SELECT native_id FROM threads WHERE id=?').get(threadId)?.native_id;
    if(nativeId)await this.native.disconnect(this.actor,String(nativeId));
  }
  async stopForRevocation(){this.host.abortAllActive();await this.host.drain();}
  beginShutdown():void {
    if(this.closing)return;this.closing=true;
    this.host.stopAccepting();this.host.abortAllActive();this.native.beginShutdown();
  }
  quiesceShutdown():Promise<void> {
    if(this.quiescence)return this.quiescence;
    this.quiescence=Promise.resolve().then(async()=>{
      await Promise.all([this.native.quiesceShutdown(),(async()=>{
        while(this.creations.size)await Promise.allSettled([...this.creations]);
        await this.host.drain();
      })()]);
    });
    this.beginShutdown();return this.quiescence;
  }
  drainShutdown(deadlineMs:number):Promise<boolean> {
    if(!Number.isFinite(deadlineMs)||deadlineMs<=0)return Promise.resolve(false);
    return new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),deadlineMs);
      void this.quiesceShutdown().then(()=>{clearTimeout(timer);resolve(true);},()=>{clearTimeout(timer);resolve(false);});});
  }
  dispose():Promise<void> {
    if(this.disposal)return this.disposal;
    this.disposal=Promise.resolve().then(async()=>{await this.quiesceShutdown();await this.native.dispose();this.db.close();});
    this.beginShutdown();return this.disposal;
  }
}
