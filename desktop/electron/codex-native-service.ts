import { createCodexOrdinaryWriter } from './codex-ordinary-writer.js';
import { findCodexEntry, type NativeActor, type NativeServiceOptions, type NativeTaskTurn, type NativeApprovalInventory, type Session } from './codex-native-support.js';
export {findCodexEntry} from './codex-native-support.js';
export type { NativeActor, NativeServiceOptions, NativeTaskTurn, NativeApprovalInventory } from './codex-native-support.js';
import { saveNativeProjection, revokeNativeQuestions, listNativeSessions, assertNativeLiveQuestionTurn, buildNativeApprovalInventory, advanceNativeApprovalRevision, cancelNativeQueue, sendNativeOwned, applyNativeEventProjection, requestNativeApproval, closeNativeBeforeUse, interruptNative, disconnectNative, beginNativeShutdown, quiesceNativeShutdown, disposeNative } from './codex-native-lifecycle.js';
import {assertOrdinarySourceWriterRoute,observeOrdinarySQLiteWriter} from '../../src/runtime/verification/ordinary-source-writer-observation.js';
import {assertBeforeEffects} from '../../src/runtime/verification/before-effects.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { SessionProbe, type NativeEvent, type NativeOptions } from './codex-native-transport.js';
import type { NativeSnapshot, NativeSummary, NativeApproval } from '../shared/codex-native-types.js';
import { readCurrentOriginalTaskRunnerResourceContext } from '../../src/runtime/task-host/task-runtime-host.js';
import { hasOriginalMainSdkBridgeInstallation } from '../../src/runtime/verification/original-main-sdk-bridge.js';
import { readOriginalCodexTaskServiceContext, assertOriginalCodexTaskWriter } from './codex-task-bridge.js';

const processSessions = new WeakMap<object, Readonly<{ context: object; assertCurrent(): void; assertLocal(): void }>>();
const processGet = WeakMap.prototype.get, processSet = WeakMap.prototype.set, processApply = Reflect.apply;
const serviceBirths=new WeakMap<object,{sessions:Map<string,Session>;options:NativeServiceOptions;db:DatabaseSync;writer:ReturnType<typeof createCodexOrdinaryWriter>}>();
const sessionBirths=new WeakMap<object,{service:object;view:NativeSnapshot;id:string;cwd:string}>();
const processDescriptor=Object.getOwnPropertyDescriptor,processOwn=Object.hasOwn;
const processMapGet=Map.prototype.get;
function processData(value:object,key:string):unknown{const d=processDescriptor(value,key);return d&&processOwn(d,'value')?d.value:undefined;}
function originalService(value:unknown){
  const row=processApply(processGet,serviceBirths,[value]) as {sessions:Map<string,Session>;options:NativeServiceOptions;db:DatabaseSync;writer:ReturnType<typeof createCodexOrdinaryWriter>}|undefined;
  if(!row||processData(value as object,'sessions')!==row.sessions||processData(value as object,'options')!==row.options||processData(value as object,'db')!==row.db||processData(value as object,'writer')!==row.writer)throw Error('CODEX_PROCESS_ORIGINAL_SERVICE_REQUIRED');
  return row;
}
const acceptedClients = new WeakMap<object, WeakSet<object>>();
const acceptedHas=WeakSet.prototype.has,acceptedAdd=WeakSet.prototype.add;
/** Fixed negative/projection consumer; never returns maps, clients or a grant. */
export function assertOriginalCodexNativeLifecycle(owner: unknown, session?: unknown, client?: unknown): void {
  const row = originalService(owner);
  if (session !== undefined) {
    const birth = processApply(processGet, sessionBirths, [session]) as {service:object;id:string}|undefined;
    if (!birth || birth.service !== owner || processApply(processMapGet,row.sessions,[birth.id]) !== session) throw Error('CODEX_PROCESS_ORIGINAL_SESSION_REQUIRED');
  }
  if (client !== undefined) {
    const clients = processApply(processGet,acceptedClients,[owner]) as WeakSet<object>|undefined;
    if (!clients || !processApply(acceptedHas,clients,[client])) throw Error('CODEX_PROCESS_ORIGINAL_CLIENT_REQUIRED');
  }
}
/** Denial-only peer check; no Source/turn proof or mutable state is returned. */
export function assertOriginalCodexNativeWriter(owner:unknown):void {originalService(owner).writer.assertOpen();}
/** Only connect() publishes this exact original client/session incarnation. */
export function readOriginalCodexProcessSession(probe: unknown): Readonly<{ context: object; assertCurrent(): void; assertLocal(): void }> {
  const row = processApply(processGet, processSessions, [probe]) as Readonly<{ context: object; assertCurrent(): void; assertLocal(): void }> | undefined;
  if (!row) throw Error('CODEX_PROCESS_ORIGINAL_SESSION_REQUIRED');
  return row;
}

export class CodexNativeService {
  private readonly writer = createCodexOrdinaryWriter(this);
  private db: DatabaseSync;
  private sessions = new Map<string, Session>();
  private disposed = false;
  private stopping=false;
  private quiescence?:Promise<void>;
  private disposal?:Promise<void>;
  private used = false;
  private retirementNotified = false;
  private notices = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly questionIncarnation = randomUUID();
  private readonly taskTurnProofs = new WeakMap<NativeTaskTurn, { session: Session; client: SessionProbe }>();
  private readonly approvalInventoryProofs = new WeakMap<NativeApprovalInventory, { session: Session; client: SessionProbe }>();
  constructor(private options: NativeServiceOptions) {
    assertOrdinarySourceWriterRoute();
    this.writer.bind(options.dbPath);this.writer.assertOpen();
    mkdirSync(dirname(options.dbPath), {recursive:true});
    this.db = new DatabaseSync(options.dbPath);
    try {
    observeOrdinarySQLiteWriter(options.dbPath,'codex-native-sqlite-v1');
    this.writer.assertOpen();this.db.exec('PRAGMA journal_mode=WAL');
    this.writer.assertOpen();
    this.db.exec('CREATE TABLE IF NOT EXISTS codex_native_sessions (id TEXT PRIMARY KEY, owner TEXT NOT NULL, native_id TEXT, snapshot TEXT NOT NULL)');
    for (const row of this.db.prepare('SELECT id,native_id,snapshot FROM codex_native_sessions WHERE owner=?').all(options.profileId) as any[]) {
      const view = JSON.parse(row.snapshot) as NativeSnapshot; view.status='disconnected'; view.approvals=[]; view.queued=0;
      for (const m of view.messages) if (m.state==='queued') m.state='cancelled';
      const session:Session={view,nativeId:row.native_id,lock:Promise.resolve(),ready:false,stopping:false,pending:new Map(),items:new Map(),queue:[]};
      this.sessions.set(row.id,session);processApply(processSet,sessionBirths,[session,{service:this,view,id:row.id,cwd:view.cwd}]);
    }
    processApply(processSet,serviceBirths,[this,{sessions:this.sessions,options,db:this.db,writer:this.writer}]);
    processApply(processSet,acceptedClients,[this,new WeakSet<object>()]);
    } catch(error) {this.writer.hold(error);try{this.writer.stock.syncVoid(this.db.close,this.db,[]);}catch(cleanup){this.writer.hold(this.db);this.writer.fail(cleanup);}throw error;}
  }
  /** Synchronous construction rollback only; after any admitted use, normal drain is required. */
  closeBeforeUse(){return closeNativeBeforeUse(this);}
  private authorize(actor: NativeActor) { if(hasOriginalMainSdkBridgeInstallation())originalService(this);if (this.disposed || actor.requestSource !== 'user' || actor.actorId !== this.options.profileId) throw new Error('native_access_denied'); this.used=true; }
  private owned(actor: NativeActor, id: string) { this.authorize(actor); const s=this.sessions.get(id); if(!s) throw new Error('native_session_denied'); return s; }
  list(actor:NativeActor):NativeSummary[]{return listNativeSessions(this,actor);}
  get(actor: NativeActor,id:string):NativeSnapshot { return structuredClone(this.owned(actor,id).view); }
  /** Main-only live facts, never restored display approvals or an answer grant. */
  readApprovalInventory(actor: NativeActor, id: string): NativeApprovalInventory {
    const s = this.owned(actor, id);this.writeCurrent(s);
    const frame=buildNativeApprovalInventory(this,s);
    this.approvalInventoryProofs.set(frame, { session: s, client: s.client! });
    return frame;
  }
  assertApprovalInventoryCurrent(actor: NativeActor, frame: NativeApprovalInventory): void {
    this.authorize(actor);
    const proof = this.approvalInventoryProofs.get(frame);
    if (!proof || this.sessions.get(frame.sessionId) !== proof.session || proof.session.client !== proof.client) throw Error('native_approval_inventory_stale');
    if (this.readApprovalInventory(actor, frame.sessionId).digest !== frame.digest) throw Error('native_approval_inventory_stale');
  }
  assertTaskTurnCurrent(actor: NativeActor, turn: NativeTaskTurn): void {
    this.authorize(actor);
    const proof = this.taskTurnProofs.get(turn);
    if (!proof || this.sessions.get(turn.sessionId) !== proof.session || proof.session.client !== proof.client) throw Error('native_task_turn_stale');
    const s = proof.session;this.writeCurrent(s);
    if (this.stopping || s.stopping || !s.liveTurn || s.view.status !== 'running' || s.nativeId !== turn.nativeThreadId || s.turnId !== turn.turnId || s.client?.activeTurnId !== turn.turnId || s.turnGeneration !== turn.generation || turn.incarnation !== this.questionIncarnation) throw Error('native_task_turn_stale');
  }
  private assertLiveQuestionTurn(s:Session):void {assertNativeLiveQuestionTurn(this,s);}
  private advanceApprovalRevision(s:Session):void {advanceNativeApprovalRevision(this,s);}
  private save(s:Session) { return saveNativeProjection(this,s); }
  private writeCurrent(s?:Session):void {
    try { this.writer.assertOpen();assertOriginalCodexTaskWriter(this); }
    catch(raw) {
      const refusal=this.writer.retire(raw);this.writer.hold(raw);
      for(const timer of this.notices.values())clearTimeout(timer);this.notices.clear();
      for(const current of this.sessions.values()){
        current.view.status='error';current.view.error='native_writer_retired';
        try{this.revoke(current);}catch(secondary){this.writer.fail(secondary);}
        try{this.cancelQueue(current);}catch(secondary){this.writer.fail(secondary);}
      }
      if(!this.retirementNotified){
        this.retirementNotified=true;
        const timer=setTimeout(()=>{
          this.notices.delete('retirement');
          for(const current of this.sessions.values())try{this.writer.hold(this.options.onChanged?.(current.view.id));}catch(secondary){this.writer.fail(secondary);}
        },0);this.notices.set('retirement',timer);
      }
      throw refusal;
    }
  }
  private background(s:Session,work:()=>void):void {
    try{work();}catch(raw){this.writer.hold(raw);if(!this.writer.isPolicy(raw))this.writer.fail(raw);}
  }
  private serial<T>(s:Session,fn:()=>Promise<T>):Promise<T> { const next=s.lock.then(fn);s.lock=next.catch(()=>{});return next; }
  async create(actor:NativeActor,cwd:string) {
    this.authorize(actor);this.writeCurrent();if(this.stopping)throw Error('native_stopping'); const path=await realpath(cwd); if(!(await stat(path)).isDirectory()) throw new Error('native_invalid_directory');
    this.writeCurrent();if(this.stopping)throw Error('native_stopping');
    const id=randomUUID(); const s:Session={view:{id,title:'Codex',cwd:path,status:'disconnected',updatedAt:Date.now(),revision:0,messages:[],approvals:[],queued:0},nativeId:null,lock:Promise.resolve(),ready:false,stopping:false,pending:new Map(),items:new Map(),queue:[]};
    this.sessions.set(id,s);processApply(processSet,sessionBirths,[s,{service:this,view:s.view,id,cwd:path}]);this.save(s);
    await this.serial(s,()=>this.connect(s));return this.get(actor,id);
  }
  private async connect(s:Session) {
    this.writeCurrent(s);
    if(hasOriginalMainSdkBridgeInstallation()){
      const service=originalService(this),birth=processApply(processGet,sessionBirths,[s]) as {service:object;view:NativeSnapshot;id:string;cwd:string}|undefined;
      if(!birth||birth.service!==this||processApply(processMapGet,service.sessions,[birth.id])!==s||processData(s,'view')!==birth.view||processData(birth.view,'id')!==birth.id||processData(birth.view,'cwd')!==birth.cwd)throw Error('CODEX_PROCESS_ORIGINAL_SESSION_REQUIRED');
    }
    if(this.stopping)throw Error('native_stopping');
    if(s.client && s.view.status!=='error') return;
    if([...this.sessions.values()].filter(v=>v!==s&&(v.client||v.view.status==='connecting')).length>=4) throw new Error('native_session_limit');
    if(s.client) {await s.client.close();s.client=undefined;}
    s.view.status='connecting';s.view.error=undefined;this.save(s);
    try {
      const executable=this.options.createClient ? process.execPath : await findCodexEntry();
      this.writeCurrent(s);if(this.stopping)throw Error('native_stopping');
      const client=(this.options.createClient ?? (o=>new SessionProbe(o)))({executable,prefixArgs:['app-server','--stdio','-c','features.hooks=false'],cwd:s.view.cwd,sandbox:'workspace-write',timeoutMs:30000,
        onEvent:e=>{if(s.client===client)this.background(s,()=>{this.writeCurrent(s);this.event(s,e);});},onApproval:r=>this.approval(s,client,r),onFailure:raw=>{this.writer.hold(raw);if(s.client===client&&!s.stopping)this.background(s,()=>{this.writeCurrent(s);s.view.status='error';s.view.error='native_connection_closed';this.revoke(s);this.cancelQueue(s);this.save(s);});}});
      s.client=client;processApply(acceptedAdd,processApply(processGet,acceptedClients,[this]),[client]);
      if(hasOriginalMainSdkBridgeInstallation()) {
        const context=readCurrentOriginalTaskRunnerResourceContext();
        if(!context)throw Error('CODEX_PROCESS_ORIGINAL_CONTEXT_REQUIRED');
        const origin=readOriginalCodexTaskServiceContext(this,s.view.id);
        if(origin.context!==context)throw Error('CODEX_PROCESS_ORIGINAL_INVOCATION_REQUIRED');
        let retired=false;
        const assertLocal=()=>{
          try{
            const service=originalService(this),birth=processApply(processGet,sessionBirths,[s]) as {service:object;view:NativeSnapshot;id:string;cwd:string}|undefined;
            if(retired||!birth||birth.service!==this||processData(this,'disposed')!==false||processData(this,'stopping')!==false||processData(s,'stopping')!==false||processApply(processMapGet,service.sessions,[birth.id])!==s||processData(s,'client')!==client||processData(s,'view')!==birth.view||processData(birth.view,'id')!==birth.id||processData(birth.view,'cwd')!==birth.cwd)throw Error('CODEX_PROCESS_ORIGINAL_SESSION_RETIRED');
            origin.assertLocal();
          }catch(error){retired=true;throw error;}
        };
        const assertCurrent=()=>{assertLocal();origin.assertCurrent();assertLocal();};
        processApply(processSet,processSessions,[client,Object.freeze({context,assertCurrent,assertLocal})]);
      }
      this.writeCurrent(s);await client.connect();
      if(this.stopping)throw Error('native_stopping');
      this.writeCurrent(s);if(s.nativeId) await client.resume(s.nativeId);else{await client.create();s.nativeId=client.threadId;}
      s.view.status='idle';s.ready=false;this.save(s);
    } catch(error) {
      const failures:unknown[]=[error];s.view.status='error';
      this.writer.hold(error);s.view.error='native_connection_failed';
      try{this.save(s);}catch(secondary){this.writer.hold(secondary);if(!this.writer.isPolicy(secondary))failures.push(secondary);}
      if(s.client)try{await s.client.close();s.client=undefined;}catch(secondary){failures.push(secondary);}
      if(failures.length>1)throw new AggregateError(failures,'native_connect_and_cleanup_failed',{cause:error});
      throw error;
    }
  }
  async send(actor:NativeActor,id:string,text:string) { return this.sendOwned(actor,id,text); }
  /** Bind this task's original send to an actual turn even before start ACK. */
  async sendTaskTurn(actor:NativeActor,id:string,text:string,onTurnStarted:(turn:NativeTaskTurn)=>void) {
    return this.sendOwned(actor,id,text,onTurnStarted);
  }
  private async sendOwned(actor:NativeActor,id:string,text:string,onTurnStarted?:(turn:NativeTaskTurn)=>void) {
    return sendNativeOwned(this,actor,id,text,onTurnStarted);
  }
  private async flush(s:Session) {
    this.writeCurrent(s);
    if(this.stopping||s.stopping||!s.client||!s.queue.length)return;
    if(s.client.activeTurnId&&!s.ready)return;
    const messages=s.queue.splice(0),text=messages.map(m=>m.text).join('\n\n');
    let failure:{raw:unknown}|undefined;
    try {
      this.writeCurrent(s);
      if(s.client.activeTurnId)await s.client.steer(text);else {s.ready=false;s.view.status='running';await s.client.start(text);}
      for(const entry of messages){const m=s.view.messages.find(m=>m.id===entry.id);if(m)m.state='sent';}
    }catch(raw){failure={raw};this.writer.hold(raw);for(const entry of messages){const m=s.view.messages.find(m=>m.id===entry.id);if(m)m.state='unknown';}s.view.status='error';s.liveTurn=false;s.view.error='native_send_failed';}
    let projection:{raw:unknown}|undefined;
    try{this.save(s);}catch(raw){projection={raw};this.writer.hold(raw);}
    if(failure)throw failure.raw;
    if(projection)throw projection.raw;
  }
  private event(s:Session,e:NativeEvent) {
    if(e.method==='serverRequest/resolved'){applyNativeEventProjection(this,s,e);return;}
    if(e.params?.threadId!==s.nativeId)return;
    this.writer.hold(this.options.onEvent?.(s.view.id,e));this.writeCurrent(s);
    if(e.method==='turn/started'){
      if(e.params.turn.id!==s.client?.activeTurnId)return;
      if(!s.liveTurn || s.turnId!==e.params.turn.id)s.turnGeneration=(s.turnGeneration??0)+1;
      s.liveTurn=true;s.turnId=e.params.turn.id;s.view.status='running';s.ready=false;s.items.clear();
      const callback=s.startingTaskTurn;s.startingTaskTurn=undefined;
      if(callback){
        const turn=Object.freeze({sessionId:s.view.id,nativeThreadId:s.nativeId!,turnId:s.turnId!,generation:s.turnGeneration!,incarnation:this.questionIncarnation});
        this.taskTurnProofs.set(turn,{session:s,client:s.client!});this.writer.hold(callback(turn));
      }
    }else if(e.params.turnId && e.params.turnId!==s.turnId)return;
    applyNativeEventProjection(this,s,e);
  }
  private approval(s:Session,client:SessionProbe,r:any):Promise<any> {return requestNativeApproval(this,s,client,r);}
  async decide(actor:NativeActor,id:string,token:string,decision:'allow'|'deny',narrowCurrent?:()=>void) {
    const s=this.owned(actor,id);this.writeCurrent(s);const p=s.pending.get(token);
    const assertCurrent=()=>{
      this.authorize(actor);this.writeCurrent(s);
      if(this.stopping||s.stopping||!p||s.pending.get(token)!==p||p.view.expiresAt<=Date.now()||p.connection!==s.client||p.threadId!==s.nativeId||p.turnId!==s.client?.activeTurnId||!['allow','deny'].includes(decision))throw new Error('native_approval_expired');
    };
    const check=()=>{
      assertCurrent();
      if(narrowCurrent){assertBeforeEffects(narrowCurrent);assertCurrent();}
    };
    check();
    // This SQLite write persists only the display projection (never approvals).
    // Keep its failure before the real transport decision and retain the token.
    this.save(s);
    check();
    this.advanceApprovalRevision(s);s.pending.delete(token);clearTimeout(p!.timer);
    s.view.approvals=[...s.pending.values()].map(item=>item.view);
    p!.resolve({decision:decision==='allow'?'accept':'decline'});
  }
  private revoke(s:Session){revokeNativeQuestions(this,s);}
  private cancelQueue(s:Session){cancelNativeQueue(this,s);}
  async interrupt(actor:NativeActor,id:string){return interruptNative(this,actor,id);}
  async disconnect(actor:NativeActor,id:string){return disconnectNative(this,actor,id);}
  beginShutdown():void {beginNativeShutdown(this);}
  quiesceShutdown():Promise<void> {return quiesceNativeShutdown(this);}
  dispose():Promise<void> {return disposeNative(this);}
}
