import { createCodexRunObservation, codexTaskPrompt, assertCodexTaskRoute } from './codex-task-observation.js';
import { createCodexOrdinaryWriter } from './codex-ordinary-writer.js';
import { createCodexTask, stopCodexThread, stopCodexForRevocation, beginCodexBridgeShutdown, quiesceCodexBridgeShutdown, disposeCodexBridge, drainCodexBridge } from './codex-task-operations.js';
import {assertOrdinarySourceWriterRoute,observeOrdinarySQLiteWriter} from '../../src/runtime/verification/ordinary-source-writer-observation.js';
import {assertBeforeEffects} from '../../src/runtime/verification/before-effects.js';
import type { NativeEvent } from './codex-native-transport.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodexNativeService, assertOriginalCodexNativeWriter, type NativeActor, type NativeServiceOptions, type NativeTaskTurn, type NativeApprovalInventory } from './codex-native-service.js';
import { InProcessTaskRuntimeHost, readCurrentOriginalTaskRunnerResourceContext, readOriginalTaskRunnerResourceContextForHost, type TaskRunnerInput, type createTaskSourceWriterPopulation, type OriginalTaskRunnerResourceContext } from '../../src/runtime/task-host/task-runtime-host.js';
import type { MaterialRegistry } from '../../src/runtime/task-host/material-registry.js';
import type { FileTaskSnapshotStore } from '../../src/runtime/task-host/snapshot-store.js';
import type { TaskCreateInput, UserAnswer } from '../../src/runtime/task-host/types.js';
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
const bridgeLifecycleBirths=new WeakMap<object,{db:DatabaseSync;native:CodexNativeService;host:InProcessTaskRuntimeHost;options:object;writer:ReturnType<typeof createCodexOrdinaryWriter>}>();
/** Passive exact-member check for fixed negative cleanup; no mutable state escapes. */
export function assertOriginalCodexBridgeLifecycle(value:unknown):void {
  const birth=codexApply(codexGet,bridgeLifecycleBirths,[value]) as {db:DatabaseSync;native:CodexNativeService;host:InProcessTaskRuntimeHost;options:object;writer:ReturnType<typeof createCodexOrdinaryWriter>}|undefined;
  if(!birth||codexData(value as object,'db')!==birth.db||codexData(value as object,'native')!==birth.native||codexData(value as object,'host')!==birth.host||codexData(value as object,'options')!==birth.options||codexData(value as object,'writer')!==birth.writer)throw Error('CODEX_PROCESS_ORIGINAL_BRIDGE_REQUIRED');
}
const runObservations=new WeakMap<object,{owner:object;input:TaskRunnerInput;run:NativeTaskRun;id:string;initial:object}>();
/** Fixed literal helper only: membership is checked before reading a ticket. */
export function assertOriginalCodexRunObservation(owner:unknown,ticket:unknown):void {
  const row=codexApply(codexGet,runObservations,[ticket]) as {owner:object;input:TaskRunnerInput;run:NativeTaskRun;id:string;initial:object}|undefined;
  if(!row||row.owner!==owner)throw Error('CODEX_RUN_OBSERVATION_REQUIRED');
  assertOriginalCodexBridgeLifecycle(owner);
  if(codexData(ticket as object,'input')!==row.input||codexData(ticket as object,'run')!==row.run||codexData(ticket as object,'id')!==row.id||codexData(ticket as object,'initial')!==row.initial)throw Error('CODEX_RUN_OBSERVATION_REQUIRED');
}
/** Optional peer relation only narrows the Native service's own fresh guard. */
export function assertOriginalCodexTaskWriter(service:unknown):void {
  const birth=codexApply(codexGet,codexServiceBirths,[service]) as CodexBridgeBirth|undefined;
  if(!birth)return;
  assertOriginalCodexBridgeLifecycle(birth.bridge);
  const row=codexApply(codexGet,bridgeLifecycleBirths,[birth.bridge]) as {writer:ReturnType<typeof createCodexOrdinaryWriter>};row.writer.assertOpen();
}
export type CodexQuestionInventory = NativeApprovalInventory & Readonly<{ taskId: string; threadId: string; taskSessionId: string }>;
export class CodexTaskBridge {
  static{originalCodexRun=CodexTaskBridge.prototype.run;}
  readonly host: InProcessTaskRuntimeHost;
  private readonly writer=createCodexOrdinaryWriter(this);
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
    this.writer.bind(join(options.dataRoot,'codex-task-routes.sqlite'));this.writer.assertOpen();
    mkdirSync(options.dataRoot,{recursive:true});this.actor={requestSource:'user',actorId:options.profileId};
    this.db=new DatabaseSync(join(options.dataRoot,'codex-task-routes.sqlite'));
    let native:CodexNativeService|undefined;
    try {
    observeOrdinarySQLiteWriter(join(options.dataRoot,'codex-task-routes.sqlite'),'codex-routes-sqlite-v1');
    this.writer.assertOpen();this.db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT); CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY,native_id TEXT); CREATE TABLE IF NOT EXISTS routes(task_id TEXT PRIMARY KEY,thread_id TEXT NOT NULL)');
    this.native=native=new CodexNativeService({dbPath:join(options.dataRoot,'codex-native.sqlite'),profileId:options.profileId,createClient:options.createClient,onChanged:id=>this.observers.get(id)?.(),onEvent:(id,event)=>this.nativeEvents.get(id)?.(event)});
    let sourceBirth:CodexBridgeBirth;
    const hostOptions={materialRegistry:options.materialRegistry,snapshotStore:options.snapshotStore,runner:(input:TaskRunnerInput)=>runOriginalCodexInvocation(this,input,sourceBirth),createTaskId:()=>`task_codex_${randomUUID()}`,aheGuards:{artifactEvidence:true,recoveryContinuity:true}};
    this.host=options.sourcePopulation ? options.sourcePopulation.createHost(hostOptions) : new InProcessTaskRuntimeHost(hostOptions);
    sourceBirth={bridge:this,service:this.native,host:this.host,store:options.snapshotStore,assertLocal:()=>{this.writeCurrent();if(codexData(this,'closing')!==false||codexData(this,'native')!==sourceBirth.service||codexData(this,'host')!==sourceBirth.host)throw Error('CODEX_PROCESS_ORIGINAL_BRIDGE_RETIRED');}};
    codexApply(codexSet,codexServiceBirths,[this.native,sourceBirth]);
    codexApply(codexSet,bridgeLifecycleBirths,[this,{db:this.db,native:this.native,host:this.host,options,writer:this.writer}]);
    }catch(error){this.writer.hold(error);try{native?.closeBeforeUse();}catch(cleanup){this.writer.hold(native);this.writer.fail(cleanup);}try{this.writer.stock.syncVoid(this.db.close,this.db,[]);}catch(cleanup){this.writer.hold(this.db);this.writer.fail(cleanup);}throw error;}
  }
  private writeCurrent():void {
    try{this.writer.assertOpen();assertOriginalCodexNativeWriter(this.native);}
    catch(raw){const refusal=this.writer.retire(raw);this.native.beginShutdown();throw refusal;}
  }
  selected(){return this.db.prepare('SELECT value FROM settings WHERE key=?').get('selected')?.value==='true';}
  select(value:boolean){const text=String(value);this.writeCurrent();const statement=this.db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)');this.writeCurrent();statement.run('selected',text);}
  owns(taskId:string){return Boolean(this.db.prepare('SELECT task_id FROM routes WHERE task_id=?').get(taskId));}
  authorize(actor?:NativeActor){if(this.closing||actor?.requestSource!=='user'||actor.actorId!==this.actor.actorId)throw new Error('native_access_denied');}
  create(input:TaskCreateInput,actor?:NativeActor,current?:()=>void){
    const pending=this.createOwned(input,actor,current);this.creations.add(pending);
    void pending.then(()=>this.creations.delete(pending),()=>this.creations.delete(pending));return pending;
  }
  private async createOwned(input:TaskCreateInput,actor?:NativeActor,current?:()=>void){return createCodexTask(this,input,actor,current);}
  async answer(input:{taskId:string;answer:UserAnswer},actor?:NativeActor,current?:()=>void){
    this.authorize(actor);this.writeCurrent();const run=this.runs.get(input.taskId);if(!run?.turn||input.answer.type!=='choice'||!['approve','deny'].includes(input.answer.choiceId))throw new Error('native_approval_expired');
    this.native.assertTaskTurnCurrent(this.actor,run.turn);
    const check=()=>{this.authorize(actor);assertBeforeEffects(current);this.assertTaskRouteIdentity({taskId:input.taskId,threadId:run.threadId,sessionId:run.sessionId},actor!);this.native.assertTaskTurnCurrent(this.actor,run.turn!);};check();
    await this.native.decide(this.actor,run.nativeId,input.answer.questionId,input.answer.choiceId==='approve'?'allow':'deny',check);
    this.observers.get(run.nativeId)?.();
  }
  /** Current IPC admission only narrows the original private inventory grant. */
  async answerFromQuestionInventory(input:{taskId:string;answer:UserAnswer},actor:NativeActor,frame:CodexQuestionInventory,current:()=>void):Promise<void>{
    this.writeCurrent();this.assertQuestionInventoryCurrent(actor,frame);
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
  assertTaskRouteIdentity(input:{taskId:string;threadId:string;sessionId?:string},actor:NativeActor):void {assertCodexTaskRoute(this,input,actor);}
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
    this.writeCurrent();
    const qualified=hasOriginalMainSdkBridgeInstallation();
    const route=this.db.prepare('SELECT thread_id FROM routes WHERE task_id=?').get(input.taskId);if(!route)throw new Error('native_route_missing');
    const threadId=String(route.thread_id);
    let nativeId=this.db.prepare('SELECT native_id FROM threads WHERE id=?').get(threadId)?.native_id as string|undefined;
    if(qualified){const context=readCurrentOriginalTaskRunnerResourceContext(),frame=context?codexApply(codexGet,codexInvocations,[context]) as CodexBridgeInvocation|undefined:undefined;if(!frame||frame.birth.bridge!==this||frame.input!==input)throw Error('CODEX_PROCESS_ORIGINAL_INVOCATION_REQUIRED');frame.threadId=threadId;frame.nativeSessionId=nativeId;}
    if(!nativeId){
      let created:string|undefined;
      try{
        created=(await this.native.create(this.actor,this.options.cwd)).id;nativeId=created;
        this.writeCurrent();const statement=this.db.prepare('INSERT INTO threads VALUES (?,?)');
        this.writeCurrent();statement.run(threadId,nativeId);
      }catch(primary){
        this.writer.hold(primary);
        if(created)try{await this.native.disconnect(this.actor,created);}catch(cleanup){this.writer.fail(cleanup);throw new AggregateError([primary,cleanup],'CODEX_ORPHAN_AND_CLEANUP_FAILED',{cause:primary});}
        throw primary;
      }
    }
    if(this.observers.has(nativeId))throw new Error('native_thread_busy');
    const id=nativeId;const run:NativeTaskRun={nativeId:id,threadId,sessionId:input.sessionId};this.runs.set(input.taskId,run);
    const initial=this.native.get(this.actor,id);
    const observationTicket={input,run,id,initial};
    codexApply(codexSet,runObservations,[observationTicket,{owner:this,input,run,id,initial}]);
    const observation=createCodexRunObservation(this,observationTicket);
    this.observers.set(id,observation.notify);this.nativeEvents.set(id,observation.event);
    const abort=()=>{void this.native.interrupt(this.actor,id).then(()=>observation.fail(new Error('native_cancelled')),observation.fail);};
    input.signal.addEventListener('abort',abort,{once:true});
    let failed=false,primary:unknown,cleanupFailed=false,cleanupError:unknown;
    try{
      if(input.signal.aborted)throw new Error('native_cancelled');
      const snapshot=await this.options.snapshotStore.recoverTask(input.taskId);
      const prompt=codexTaskPrompt(input,initial,snapshot?.context?.taskIds?.at(-1)?this.owns(snapshot.context.taskIds.at(-1)!):undefined);
      await this.native.sendTaskTurn(this.actor,id,prompt,turn=>{
        if(this.closing || this.runs.get(input.taskId)!==run || run.turn)return;
        run.turn=turn;
      });observation.start();this.observers.get(id)?.();await observation.done;await observation.waitChain();
    }catch(error){failed=true;primary=error;}
    finally{
      observation.retire();codexApply(codexDelete,runObservations,[observationTicket]);
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
  async stopThread(threadId:string){return stopCodexThread(this,threadId);}
  async stopForRevocation(){return stopCodexForRevocation(this);}
  beginShutdown():void {beginCodexBridgeShutdown(this);}
  quiesceShutdown():Promise<void> {return quiesceCodexBridgeShutdown(this);}
  drainShutdown(deadlineMs:number):Promise<boolean> {return drainCodexBridge(this,deadlineMs);}
  dispose():Promise<void> {return disposeCodexBridge(this);}
}
