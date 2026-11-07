import {assertOrdinarySourceWriterRoute,observeOrdinarySQLiteWriter} from '../../src/runtime/verification/ordinary-source-writer-observation.js';
import {assertBeforeEffects} from '../../src/runtime/verification/before-effects.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { dirname, join, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { SessionProbe, type NativeEvent, type NativeOptions } from './codex-native-transport.js';
import type { NativeSnapshot, NativeSummary, NativeApproval } from '../shared/codex-native-types.js';
import { readCurrentOriginalTaskRunnerResourceContext } from '../../src/runtime/task-host/task-runtime-host.js';
import { hasOriginalMainSdkBridgeInstallation } from '../../src/runtime/verification/original-main-sdk-bridge.js';
import { readOriginalCodexTaskServiceContext } from './codex-task-bridge.js';

const processSessions = new WeakMap<object, Readonly<{ context: object; assertCurrent(): void; assertLocal(): void }>>();
const processGet = WeakMap.prototype.get, processSet = WeakMap.prototype.set, processApply = Reflect.apply;
const serviceBirths=new WeakMap<object,{sessions:Map<string,Session>;options:NativeServiceOptions}>();
const sessionBirths=new WeakMap<object,{service:object;view:NativeSnapshot;id:string;cwd:string}>();
const processDescriptor=Object.getOwnPropertyDescriptor,processOwn=Object.hasOwn;
const processMapGet=Map.prototype.get;
function processData(value:object,key:string):unknown{const d=processDescriptor(value,key);return d&&processOwn(d,'value')?d.value:undefined;}
function originalService(value:unknown){
  const row=processApply(processGet,serviceBirths,[value]) as {sessions:Map<string,Session>;options:NativeServiceOptions}|undefined;
  if(!row||processData(value as object,'sessions')!==row.sessions||processData(value as object,'options')!==row.options)throw Error('CODEX_PROCESS_ORIGINAL_SERVICE_REQUIRED');
  return row;
}
/** Only connect() publishes this exact original client/session incarnation. */
export function readOriginalCodexProcessSession(probe: unknown): Readonly<{ context: object; assertCurrent(): void; assertLocal(): void }> {
  const row = processApply(processGet, processSessions, [probe]) as Readonly<{ context: object; assertCurrent(): void; assertLocal(): void }> | undefined;
  if (!row) throw Error('CODEX_PROCESS_ORIGINAL_SESSION_REQUIRED');
  return row;
}

export interface NativeActor { requestSource: 'user' | 'agent' | 'scheduler'; actorId: string }
type Pending = { view: NativeApproval; connection: SessionProbe; threadId: string; turnId: string; digest: string; requestId: string; resolve: (result: unknown) => void; timer: ReturnType<typeof setTimeout> };
export type NativeTaskTurn = Readonly<{ sessionId: string; nativeThreadId: string; turnId: string; generation: number; incarnation: string }>;
export type NativeApprovalInventory = NativeTaskTurn & Readonly<{ inventoryRevision: number; digest: string; questions: readonly Readonly<NativeApproval & { requestDigest: string }>[] }>;
type Session = { view: NativeSnapshot; nativeId: string | null; client?: SessionProbe; lock: Promise<unknown>; ready: boolean; stopping: boolean; pending: Map<string, Pending>; approvalRevision?: number; turnId?: string; turnGeneration?: number; liveTurn?: boolean; startingTaskTurn?: (turn: NativeTaskTurn) => void; items: Map<string, unknown>; queue: Array<{id:string;text:string}> };
export interface NativeServiceOptions {
  dbPath: string; profileId: string;
  createClient?: (options: NativeOptions) => SessionProbe;
  approvalTimeoutMs?: number; onChanged?: (id: string) => void; onEvent?: (id:string,event:NativeEvent)=>void;
}
export async function findCodexEntry(): Promise<string> {
  const dirs = [...(process.env.PATH ?? '').split(delimiter), join(homedir(), '.local', 'node', 'bin'), join(homedir(), '.local', 'bin'), join(homedir(), '.npm-global', 'bin')];
  if (process.platform === 'win32' && process.env.APPDATA) dirs.push(join(process.env.APPDATA, 'npm'));
  for (const dir of dirs.filter(Boolean)) for (const name of process.platform === 'win32' ? ['codex.exe', join('node_modules','@openai','codex','bin','codex.js')] : ['codex']) {
    try { const entry = await realpath(join(dir, name)); await access(entry); return entry; } catch { /* next installation */ }
  }
  throw new Error('codex_not_installed');
}
export class CodexNativeService {
  private db: DatabaseSync;
  private sessions = new Map<string, Session>();
  private disposed = false;
  private stopping=false;
  private quiescence?:Promise<void>;
  private disposal?:Promise<void>;
  private used = false;
  private notices = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly questionIncarnation = randomUUID();
  private readonly taskTurnProofs = new WeakMap<NativeTaskTurn, { session: Session; client: SessionProbe }>();
  private readonly approvalInventoryProofs = new WeakMap<NativeApprovalInventory, { session: Session; client: SessionProbe }>();
  constructor(private options: NativeServiceOptions) {
    assertOrdinarySourceWriterRoute();
    mkdirSync(dirname(options.dbPath), {recursive:true});
    this.db = new DatabaseSync(options.dbPath);
    try {
    observeOrdinarySQLiteWriter(options.dbPath,'codex-native-sqlite-v1');
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('CREATE TABLE IF NOT EXISTS codex_native_sessions (id TEXT PRIMARY KEY, owner TEXT NOT NULL, native_id TEXT, snapshot TEXT NOT NULL)');
    for (const row of this.db.prepare('SELECT id,native_id,snapshot FROM codex_native_sessions WHERE owner=?').all(options.profileId) as any[]) {
      const view = JSON.parse(row.snapshot) as NativeSnapshot; view.status='disconnected'; view.approvals=[]; view.queued=0;
      for (const m of view.messages) if (m.state==='queued') m.state='cancelled';
      const session:Session={view,nativeId:row.native_id,lock:Promise.resolve(),ready:false,stopping:false,pending:new Map(),items:new Map(),queue:[]};
      this.sessions.set(row.id,session);processApply(processSet,sessionBirths,[session,{service:this,view,id:row.id,cwd:view.cwd}]);
    }
    processApply(processSet,serviceBirths,[this,{sessions:this.sessions,options}]);
    } catch(error) {try{this.db.close();}catch{/* Preserve initialization failure. */}throw error;}
  }
  /** Synchronous construction rollback only; after any admitted use, normal drain is required. */
  closeBeforeUse(){if(this.used)throw Error('native_already_used');if(this.disposed)return;this.disposed=true;this.db.close();}
  private authorize(actor: NativeActor) { if(hasOriginalMainSdkBridgeInstallation())originalService(this);if (this.disposed || actor.requestSource !== 'user' || actor.actorId !== this.options.profileId) throw new Error('native_access_denied'); this.used=true; }
  private owned(actor: NativeActor, id: string) { this.authorize(actor); const s=this.sessions.get(id); if(!s) throw new Error('native_session_denied'); return s; }
  list(actor: NativeActor): NativeSummary[] { this.authorize(actor); return [...this.sessions.values()].map(({view:{id,title,cwd,status,updatedAt,error}})=>({id,title,cwd,status,updatedAt,error})).sort((a,b)=>b.updatedAt-a.updatedAt); }
  get(actor: NativeActor,id:string):NativeSnapshot { return structuredClone(this.owned(actor,id).view); }
  /** Main-only live facts, never restored display approvals or an answer grant. */
  readApprovalInventory(actor: NativeActor, id: string): NativeApprovalInventory {
    const s = this.owned(actor, id);
    this.assertLiveQuestionTurn(s);
    if (s.pending.size > 32) throw Error('native_approval_inventory_unavailable');
    const questions = [...s.pending.values()].map(p => {
      if (p.connection !== s.client || p.threadId !== s.nativeId || p.turnId !== s.turnId || p.view.expiresAt <= Date.now()) throw Error('native_approval_inventory_unavailable');
      return Object.freeze({ ...p.view, requestDigest: p.digest });
    }).sort((a, b) => a.token.localeCompare(b.token));
    const identity = { sessionId: id, nativeThreadId: s.nativeId!, turnId: s.turnId!, generation: s.turnGeneration!, incarnation: this.questionIncarnation };
    const inventoryRevision = s.approvalRevision ?? 0;
    const digest = createHash('sha256').update(JSON.stringify({ ...identity, inventoryRevision, questions })).digest('hex');
    const frame = Object.freeze({ ...identity, inventoryRevision, digest, questions: Object.freeze(questions) });
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
    const s = proof.session;
    if (this.stopping || s.stopping || !s.liveTurn || s.view.status !== 'running' || s.nativeId !== turn.nativeThreadId || s.turnId !== turn.turnId || s.client?.activeTurnId !== turn.turnId || s.turnGeneration !== turn.generation || turn.incarnation !== this.questionIncarnation) throw Error('native_task_turn_stale');
  }
  private assertLiveQuestionTurn(s: Session): void {
    if (this.stopping || s.stopping || !s.liveTurn || s.view.status !== 'running' || !s.client || !s.nativeId || !s.turnId || s.client.activeTurnId !== s.turnId) throw Error('native_approval_inventory_unavailable');
  }
  private advanceApprovalRevision(s: Session): void {
    const next = (s.approvalRevision ?? 0) + 1;
    if (!Number.isSafeInteger(next)) throw Error('native_approval_inventory_revision_exhausted');
    s.approvalRevision = next;
  }
  private save(s:Session) {
    s.view.updatedAt=Date.now(); s.view.revision++; s.view.approvals=[...s.pending.values()].map(p=>p.view); s.view.queued=s.queue.length;
    // Native Codex owns full history; retain a bounded display projection.
    s.view.messages=s.view.messages.slice(-200); for(const m of s.view.messages) m.text=m.text.slice(-65536);
    this.db.prepare('INSERT OR REPLACE INTO codex_native_sessions (id,owner,native_id,snapshot) VALUES (?,?,?,?)').run(s.view.id,this.options.profileId,s.nativeId,JSON.stringify({...s.view,approvals:[]}));
    if(!this.notices.has(s.view.id)) this.notices.set(s.view.id,setTimeout(()=>{this.notices.delete(s.view.id);this.options.onChanged?.(s.view.id);},80));
  }
  private serial<T>(s:Session,fn:()=>Promise<T>):Promise<T> { const next=s.lock.then(fn);s.lock=next.catch(()=>{});return next; }
  async create(actor:NativeActor,cwd:string) {
    this.authorize(actor);if(this.stopping)throw Error('native_stopping'); const path=await realpath(cwd); if(!(await stat(path)).isDirectory()) throw new Error('native_invalid_directory');
    if(this.stopping)throw Error('native_stopping');
    const id=randomUUID(); const s:Session={view:{id,title:'Codex',cwd:path,status:'disconnected',updatedAt:Date.now(),revision:0,messages:[],approvals:[],queued:0},nativeId:null,lock:Promise.resolve(),ready:false,stopping:false,pending:new Map(),items:new Map(),queue:[]};
    this.sessions.set(id,s);processApply(processSet,sessionBirths,[s,{service:this,view:s.view,id,cwd:path}]);this.save(s);
    await this.serial(s,()=>this.connect(s));return this.get(actor,id);
  }
  private async connect(s:Session) {
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
      if(this.stopping)throw Error('native_stopping');
      const client=(this.options.createClient ?? (o=>new SessionProbe(o)))({executable,prefixArgs:['app-server','--stdio','-c','features.hooks=false'],cwd:s.view.cwd,sandbox:'workspace-write',timeoutMs:30000,
        onEvent:e=>{if(s.client===client)this.event(s,e);},onApproval:r=>this.approval(s,client,r),onFailure:()=>{if(s.client===client&&!s.stopping){s.view.status='error';s.view.error='native_connection_closed';this.revoke(s);this.cancelQueue(s);this.save(s);}}});
      s.client=client;
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
      await client.connect();
      if(this.stopping)throw Error('native_stopping');
      if(s.nativeId) await client.resume(s.nativeId);else{await client.create();s.nativeId=client.threadId;}
      s.view.status='idle';s.ready=false;this.save(s);
    } catch(error) {
      const failures:unknown[]=[error];s.view.status='error';
      s.view.error=hasOriginalMainSdkBridgeInstallation()?'native_connection_failed':(error as Error).message;
      try{this.save(s);}catch(secondary){failures.push(secondary);}
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
    const s=this.owned(actor,id);if(this.stopping)throw Error('native_stopping');if(typeof text!=='string'||!text.trim()||text.length>32000)throw new Error('native_invalid_message');
    return this.serial(s,async()=>{
      if(s.stopping)throw new Error('native_stopping');await this.connect(s);
      this.authorize(actor);
      if(this.stopping||s.stopping)throw Error('native_stopping');
      if(onTurnStarted && (s.client?.activeTurnId || s.queue.length))throw Error('native_task_turn_busy');
      const message={id:randomUUID(),role:'user' as const,text,state:'queued' as const};s.view.messages.push(message);
      if(s.view.title==='Codex')s.view.title=text.slice(0,60);
      s.queue.push({id:message.id,text});this.save(s);
      s.startingTaskTurn=onTurnStarted;
      try { await this.flush(s); } finally { if(s.startingTaskTurn===onTurnStarted)s.startingTaskTurn=undefined; }
    });
  }
  private async flush(s:Session) {
    if(this.stopping||s.stopping||!s.client||!s.queue.length)return;
    if(s.client.activeTurnId&&!s.ready)return;
    const messages=s.queue.splice(0);const text=messages.map(m=>m.text).join('\n\n');
    try {
      if(s.client.activeTurnId)await s.client.steer(text);else {s.ready=false;s.view.status='running';await s.client.start(text);}
      for(const entry of messages){const m=s.view.messages.find(m=>m.id===entry.id);if(m)m.state='sent';}
    }catch(error){for(const entry of messages){const m=s.view.messages.find(m=>m.id===entry.id);if(m)m.state='unknown';}s.view.status='error';s.liveTurn=false;s.view.error=(error as Error).message;throw error;}
    finally{this.save(s);}
  }
  private event(s:Session,e:NativeEvent) {
    if(e.method==='serverRequest/resolved'){
      for(const [token,p] of s.pending)if(p.requestId===String(e.params?.requestId)){this.advanceApprovalRevision(s);clearTimeout(p.timer);s.pending.delete(token);p.resolve({decision:'decline'});}
      this.save(s);return;
    }
    if(e.params?.threadId!==s.nativeId)return;
    this.options.onEvent?.(s.view.id,e);
    if(e.method==='turn/started'){
      if(e.params.turn.id!==s.client?.activeTurnId)return;
      if(!s.liveTurn || s.turnId!==e.params.turn.id)s.turnGeneration=(s.turnGeneration??0)+1;
      s.liveTurn=true;s.turnId=e.params.turn.id;s.view.status='running';s.ready=false;s.items.clear();
      const callback=s.startingTaskTurn;s.startingTaskTurn=undefined;
      if(callback){
        const turn=Object.freeze({sessionId:s.view.id,nativeThreadId:s.nativeId!,turnId:s.turnId!,generation:s.turnGeneration!,incarnation:this.questionIncarnation});
        this.taskTurnProofs.set(turn,{session:s,client:s.client!});callback(turn);
      }
    }
    else if(e.params.turnId && e.params.turnId!==s.turnId)return;
    if(e.method==='turn/completed'&&e.params.turn.id!==s.turnId)return;
    if(e.method==='item/started'&&e.params.item?.type==='fileChange')s.items.set(e.params.item.id,e.params.item);
    if(e.method==='item/agentMessage/delta') {
      s.ready=true;const id=String(e.params.itemId);let message=s.view.messages.find(m=>m.id===id);
      if(!message){message={id,role:'assistant',text:''};s.view.messages.push(message);}message.text+=String(e.params.delta ?? '');
      void this.serial(s,()=>this.flush(s)).catch(()=>{});
    }
    if(e.method==='item/completed'&&e.params.item?.type==='agentMessage') {
      const item=e.params.item;const old=s.view.messages.find(m=>m.id===item.id);if(old)old.text=item.text;else s.view.messages.push({id:item.id,role:'assistant',text:item.text});
    }
    if(e.method==='turn/completed') {
      s.liveTurn=false;
      this.revoke(s);s.ready=false;s.view.status=e.params.turn.status==='failed'?'error':'idle';
      if(s.view.status==='error')s.view.error='native_turn_failed';
      if(e.params.turn.status==='interrupted')this.cancelQueue(s);else void this.serial(s,()=>this.flush(s)).catch(()=>{});
    }
    if(['turn/started','turn/completed','item/agentMessage/delta','item/completed'].includes(e.method))this.save(s);
  }
  private approval(s:Session,client:SessionProbe,r:any):Promise<any> {
    const method=r.method;const decline={decision:'decline'};
    if(method==='item/permissions/requestApproval')return Promise.resolve({permissions:{},scope:'turn'});
    if(method==='mcpServer/elicitation/request')return Promise.resolve({action:'decline',content:null});
    if(!['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(method))return Promise.resolve(null);
    if(this.stopping||s.stopping||s.client!==client||r.params?.threadId!==s.nativeId||r.params?.turnId!==client.activeTurnId)return Promise.resolve(decline);
    if(method==='item/fileChange/requestApproval'&&!s.items.has(r.params.itemId))return Promise.resolve(decline);
    const token=randomUUID();
    const description=JSON.stringify({request:r.params,...(method==='item/fileChange/requestApproval'?{changes:s.items.get(r.params.itemId)}:{})},null,2);
    if(description.length>16000)return Promise.resolve(decline);
    return new Promise(resolve=>{
      const view={token,method,description:description.slice(0,16000),expiresAt:Date.now()+(this.options.approvalTimeoutMs??120000)};
      const timer=setTimeout(()=>{if(s.pending.has(token)){this.advanceApprovalRevision(s);s.pending.delete(token);}resolve(decline);this.save(s);},this.options.approvalTimeoutMs??120000);
      this.advanceApprovalRevision(s);s.pending.set(token,{view,connection:client,threadId:s.nativeId!,turnId:client.activeTurnId!,requestId:String(r.id),digest:createHash('sha256').update(JSON.stringify(r)).digest('hex'),resolve,timer});this.save(s);
    });
  }
  async decide(actor:NativeActor,id:string,token:string,decision:'allow'|'deny',narrowCurrent?:()=>void) {
    const s=this.owned(actor,id);const p=s.pending.get(token);
    const assertCurrent=()=>{
      this.authorize(actor);
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
  private revoke(s:Session){s.liveTurn=false;if(s.pending.size)this.advanceApprovalRevision(s);for(const p of s.pending.values()){clearTimeout(p.timer);p.resolve({decision:'decline'});}s.pending.clear();}
  private cancelQueue(s:Session){for(const q of s.queue){const m=s.view.messages.find(m=>m.id===q.id);if(m)m.state='cancelled';}s.queue=[];}
  async interrupt(actor:NativeActor,id:string){const s=this.owned(actor,id);s.stopping=true;this.revoke(s);this.cancelQueue(s);try{await s.lock;if(s.client?.activeTurnId)await s.client.interrupt();}finally{s.stopping=false;this.save(s);}}
  async disconnect(actor:NativeActor,id:string){
    const s=this.owned(actor,id);s.stopping=true;this.revoke(s);this.cancelQueue(s);
    let failed=false,primary:unknown,saveFailed=false,saveError:unknown;
    try{await s.lock;await s.client?.close();s.client=undefined;s.view.status='disconnected';}
    catch(error){failed=true;primary=error;if(hasOriginalMainSdkBridgeInstallation()){s.view.status='error';s.view.error='native_process_cleanup_unconfirmed';}}
    finally{s.stopping=false;}
    try{this.save(s);}catch(error){saveFailed=true;saveError=error;}
    if(failed&&saveFailed)throw new AggregateError([primary,saveError],'native_disconnect_and_save_failed',{cause:primary});
    if(failed)throw primary;if(saveFailed)throw saveError;
  }
  beginShutdown():void {
    if(this.stopping)return;this.stopping=true;
    for(const s of this.sessions.values()){s.stopping=true;this.revoke(s);this.cancelQueue(s);}
  }
  /** Close actual clients while their original event/route writers remain open.
   * Do not wait a hung send lock before initiating its real child close. */
  quiesceShutdown():Promise<void> {
    if(this.quiescence)return this.quiescence;
    this.beginShutdown();
    this.quiescence=Promise.resolve().then(async()=>{
      const results=await Promise.allSettled([...this.sessions.values()].map(async s=>{
        const client=s.client;await client?.close();
        await s.lock;
        if(s.client && s.client!==client)await s.client.close();
        s.client=undefined;s.view.status='disconnected';this.save(s);
      }));
      const errors=results.flatMap(result=>result.status==='rejected'?[result.reason]:[]);
      if(errors.length)throw new AggregateError(errors,'native_shutdown_unconfirmed');
    });
    return this.quiescence;
  }
  dispose():Promise<void> {
    if(this.disposal)return this.disposal;
    this.disposal=Promise.resolve().then(async()=>{
      await this.quiesceShutdown();
      this.disposed=true;for(const timer of this.notices.values())clearTimeout(timer);this.notices.clear();this.db.close();
    });
    this.beginShutdown();
    return this.disposal;
  }
}
