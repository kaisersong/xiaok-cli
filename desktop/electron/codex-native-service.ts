import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { dirname, join, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { NativePublicSource,composeNativeWork,inspectNativeWork,type NativeWorkEnvelope } from './codex-native-public-source.js';
import { NativeSendJournal,nativeSendHash,type NativeSendBinding,type NativeSendStatus } from './codex-native-send-journal.js';
import { SessionProbe, type NativeEvent, type NativeOptions } from './codex-native-transport.js';
import type { NativeSnapshot, NativeSummary, NativeApproval } from '../shared/codex-native-types.js';

export interface NativeActor { requestSource: 'user' | 'agent' | 'scheduler'; actorId: string }
export interface NativeSendReceipt { messageId: string; nativeSessionId: string; nativeThreadId: string; connectionGeneration: string; turnId: string; afterEvent: number }
/** Parent turn completion only; not a physical descendant/background-process settlement proof. */
export interface NativeTurnCompletionReceipt extends NativeSendReceipt { completedEvent: number }
type Pending = { view: NativeApproval; connection: SessionProbe; threadId: string; turnId: string; digest: string; requestId: string; resolve: (result: unknown) => void; timer: ReturnType<typeof setTimeout> };
type Session = { view: NativeSnapshot; nativeId: string | null; client?: SessionProbe; generation?: string; eventSequence?: number; lock: Promise<unknown>; ready: boolean; stopping: boolean; pending: Map<string, Pending>; turnId?: string; items: Map<string, unknown>; queue: Array<{id:string;text:string}>; readySends:Set<string>; sendUnavailable?:boolean };
export interface NativeServiceOptions {
  dbPath: string; profileId: string;
  initializeOwner?:()=>void; migrateFromProfileId?:string;
  createClient?: (options: NativeOptions) => SessionProbe;
  approvalTimeoutMs?: number; onChanged?: (id: string) => void; onEvent?: (id:string,event:NativeEvent)=>void;
  authorizeExecution?: (id: string) => void;
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
  private db!: DatabaseSync;
  private sendJournal!:NativeSendJournal;
  private publicSource!:NativePublicSource;
  private startupError?:Error;
  private sessions = new Map<string, Session>();
  private disposed = false;
  private notices = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private options: NativeServiceOptions) {
    try{
    options.initializeOwner?.();
    mkdirSync(dirname(options.dbPath), {recursive:true});
    this.db = new DatabaseSync(options.dbPath); this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
    this.db.exec('CREATE TABLE IF NOT EXISTS codex_native_sessions (id TEXT PRIMARY KEY, owner TEXT NOT NULL, native_id TEXT, snapshot TEXT NOT NULL)');
    this.db.exec('CREATE TABLE IF NOT EXISTS codex_native_send_receipts (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, generation TEXT NOT NULL, native_thread_id TEXT NOT NULL, turn_id TEXT NOT NULL, after_event INTEGER NOT NULL, completed_event INTEGER); CREATE TABLE IF NOT EXISTS codex_native_turn_settlements (session_id TEXT NOT NULL, generation TEXT NOT NULL, native_thread_id TEXT NOT NULL, turn_id TEXT NOT NULL, event_watermark INTEGER NOT NULL, PRIMARY KEY(session_id,generation,native_thread_id,turn_id))');
    this.db.exec('CREATE TABLE IF NOT EXISTS codex_native_context_qualifications (session_id TEXT PRIMARY KEY, native_thread_id TEXT NOT NULL, safety_version INTEGER NOT NULL)');
    this.sendJournal=new NativeSendJournal(this.db);this.publicSource=new NativePublicSource(this.db,options.profileId);
    if(options.migrateFromProfileId){
      const from=options.migrateFromProfileId;
      if(!/^desktop-user:[a-f0-9]{64}$/.test(from)||!/^desktop-user:\w{8}-\w{4}-4\w{3}-[89ab]\w{3}-\w{12}$/.test(options.profileId))throw new Error('profile_identity_unavailable');
      this.db.exec('BEGIN IMMEDIATE');
      try{
        this.db.exec('CREATE TABLE IF NOT EXISTS profile_identity_migrations(old_profile TEXT PRIMARY KEY,new_profile TEXT NOT NULL,committed_at INTEGER NOT NULL)');
        const prior=this.db.prepare('SELECT new_profile FROM profile_identity_migrations WHERE old_profile=?').get(from);
        if(prior&&(prior.new_profile!==options.profileId||this.db.prepare('SELECT 1 FROM codex_native_sessions WHERE owner=? LIMIT 1').get(from)))throw new Error('profile_migration_conflict');
        if(!prior){this.db.prepare('UPDATE codex_native_sessions SET owner=? WHERE owner=?').run(options.profileId,from);this.db.prepare('INSERT INTO profile_identity_migrations VALUES(?,?,?)').run(from,options.profileId,Date.now());}
        this.db.exec('COMMIT');
      }catch(error){this.db.exec('ROLLBACK');throw error;}
    }
    for (const row of this.db.prepare('SELECT id,native_id,snapshot FROM codex_native_sessions WHERE owner=?').all(options.profileId) as any[]) {
      this.sendJournal.recover(row.id);this.sendJournal.atomic(()=>{this.publicSource.ensureLegacy(row.id,row.native_id);this.publicSource.markGap(row.id);this.publicSource.syncDisposition(row.id);});
      const view = JSON.parse(row.snapshot) as NativeSnapshot; view.status='disconnected'; view.approvals=[]; view.queued=0;
      for(const m of view.messages){const send=this.sendJournal.forMessage(m.id);if(send&&send.sessionId===row.id)m.state=send.status==='accepted'?'sent':send.status==='unknown'?'unknown':'cancelled';else if(m.state==='queued')m.state='cancelled';}
      this.sessions.set(row.id,{view,nativeId:row.native_id,lock:Promise.resolve(),ready:false,stopping:false,pending:new Map(),items:new Map(),queue:[],readySends:new Set()});
    }
    }catch(error){this.startupError=new Error('native_owner_unavailable',{cause:error});this.sessions.clear();this.db?.close();}
  }
  private authorize(actor: NativeActor) { if (this.disposed || actor.requestSource !== 'user' || actor.actorId !== this.options.profileId) throw new Error('native_access_denied');if(this.startupError)throw this.startupError; }
  private owned(actor: NativeActor, id: string) { this.authorize(actor); const s=this.sessions.get(id); if(!s) throw new Error('native_session_denied'); return s; }
  list(actor: NativeActor): NativeSummary[] { this.authorize(actor); return [...this.sessions.values()].map(({view:{id,title,cwd,status,updatedAt,error}})=>({id,title,cwd,status,updatedAt,error})).sort((a,b)=>b.updatedAt-a.updatedAt); }
  assertNoUnknownExecution(actor:NativeActor):void{
    this.authorize(actor);
    // No existing native session has a complete trusted descendant/process closure receipt.
    if(this.db.prepare('SELECT 1 FROM codex_native_sessions WHERE owner=? LIMIT 1').get(this.options.profileId))throw new Error('blocked_unsettled');
  }
  get(actor: NativeActor,id:string):NativeSnapshot { return structuredClone(this.owned(actor,id).view); }
  private save(s:Session) {
    s.view.updatedAt=Date.now(); s.view.revision++; s.view.approvals=[...s.pending.values()].map(p=>p.view); s.view.queued=s.queue.length;
    // Native Codex owns full history; retain a bounded display projection.
    s.view.messages=s.view.messages.slice(-200); for(const m of s.view.messages) m.text=m.text.slice(-65536);
    this.db.prepare('INSERT OR REPLACE INTO codex_native_sessions (id,owner,native_id,snapshot) VALUES (?,?,?,?)').run(s.view.id,this.options.profileId,s.nativeId,JSON.stringify({...s.view,approvals:[]}));
    if(!this.notices.has(s.view.id)) this.notices.set(s.view.id,setTimeout(()=>{this.notices.delete(s.view.id);this.options.onChanged?.(s.view.id);},80));
  }
  private serial<T>(s:Session,fn:()=>Promise<T>):Promise<T> { const next=s.lock.then(fn);s.lock=next.catch(()=>{});return next; }
  async create(actor:NativeActor,cwd:string) {
    this.authorize(actor); const path=await realpath(cwd); if(!(await stat(path)).isDirectory()) throw new Error('native_invalid_directory');
    const id=randomUUID(); const s:Session={view:{id,title:'Codex',cwd:path,status:'disconnected',updatedAt:Date.now(),revision:0,messages:[],approvals:[],queued:0},nativeId:null,lock:Promise.resolve(),ready:false,stopping:false,pending:new Map(),items:new Map(),queue:[],readySends:new Set()};
    this.sessions.set(id,s);this.sendJournal.atomic(()=>{this.publicSource.reserveFresh(id);this.save(s);});
    await this.serial(s,()=>this.connect(s));return this.get(actor,id);
  }
  private markPublicGap(s:Session):void{try{this.sendJournal.atomic(()=>this.publicSource.markGap(s.view.id));}catch(error){s.sendUnavailable=true;throw error;}}
  private async connect(s:Session) {
    if(s.client && s.view.status!=='error') return;
    if([...this.sessions.values()].filter(v=>v!==s&&(v.client||v.view.status==='connecting')).length>=4) throw new Error('native_session_limit');
    if(s.client) {await s.client.close();s.client=undefined;}
    s.view.status='connecting';s.view.error=undefined;this.save(s);
    const originalNativeId=s.nativeId;let bindingCommitted=false;
    try {
      const executable=this.options.createClient ? process.execPath : await findCodexEntry();
      const client=(this.options.createClient ?? (o=>new SessionProbe(o)))({executable,prefixArgs:['app-server','--stdio',...['hooks','apps','multi_agent','goals','memories','remote_plugin'].flatMap(feature=>['-c',`features.${feature}=false`])],cwd:s.view.cwd,sandbox:'workspace-write',timeoutMs:30000,
        onEvent:e=>{if(s.client===client)this.event(s,e);},onApproval:r=>this.approval(s,client,r),onFailure:()=>{if(s.client===client&&!s.stopping){s.view.status='error';s.view.error='native_connection_closed';this.markPublicGap(s);this.revoke(s);this.sendJournal.atomic(()=>{this.sendJournal.markUnknown(s.view.id);this.publicSource.syncDisposition(s.view.id);});this.cancelQueue(s);this.save(s);}}});
      s.client=client;s.generation=randomUUID();s.eventSequence=0;await client.connect();await client.assertNoExternalTools();
      const fresh=!s.nativeId;
      if(s.nativeId){if(!this.db.prepare('SELECT 1 FROM codex_native_context_qualifications WHERE session_id=? AND native_thread_id=? AND safety_version=2').get(s.view.id,s.nativeId))throw new Error('native_context_unqualified');await client.resume(s.nativeId);}
      else{await client.create();s.nativeId=client.threadId;}
      await client.assertNoExternalTools();
      this.sendJournal.atomic(()=>{this.publicSource.bind(s.view.id,s.nativeId!,fresh);if(fresh)this.db.prepare('INSERT INTO codex_native_context_qualifications VALUES (?,?,2)').run(s.view.id,s.nativeId!);s.view.status='idle';s.ready=false;this.save(s);});bindingCommitted=true;
    } catch(error) {if(!bindingCommitted)s.nativeId=originalNativeId;this.markPublicGap(s);s.view.status='error';s.view.error=(error as Error).message;this.save(s);if(s.client){await s.client.close();s.client=undefined;}throw error;}
  }
  async send(actor:NativeActor,id:string,text:string,wireSendId:string=randomUUID(),options:{requireImmediate?:boolean}={}) {
    this.owned(actor,id);return this.sendEnvelope(actor,id,composeNativeWork({prompt:text}),wireSendId,options);
  }
  /** Fixed main producer: context/transport never becomes a second public work instruction. */
  async sendWork(actor:NativeActor,id:string,input:{prompt:string;contextText?:string;attachmentsText?:string},wireSendId:string,options:{requireImmediate?:boolean}={}){this.owned(actor,id);return this.sendEnvelope(actor,id,composeNativeWork(input),wireSendId,options);}
  readPublicSource(actor:NativeActor,id:string){if(this.owned(actor,id).sendUnavailable)throw new Error('native_public_source_unavailable');return this.publicSource.read(id);}
  private async sendEnvelope(actor:NativeActor,id:string,envelope:NativeWorkEnvelope,wireSendId:string,options:{requireImmediate?:boolean}) {
    const projection=inspectNativeWork(envelope),text=projection.wireText;
    const s=this.owned(actor,id);if(s.sendUnavailable)throw new Error('native_send_unavailable');if(typeof text!=='string'||!text.trim()||text.length>32000||typeof wireSendId!=='string'||!wireSendId||wireSendId.length>256||/[\u0000-\u001f]/u.test(wireSendId))throw new Error('native_invalid_message');
    const immediate=options.requireImmediate===true;
    const previous=this.sendJournal.get(wireSendId);
    if(previous&&(previous.sessionId!==id||previous.text!==text||previous.payloadHash!==projection.payloadHash))throw new Error('native_send_conflict');
    if(!previous){
      if(s.stopping)throw new Error('native_stopping');this.sendJournal.assertKnown(id);
      // Accept the identity before *any* setup/serial await so cancellation can find it.
      const before=structuredClone(s.view),beforeQueue=[...s.queue];
      try{this.sendJournal.atomic(()=>{const messageId=randomUUID();this.sendJournal.enqueue(wireSendId,id,messageId,text,projection.publicText,projection.metadata,projection.payloadHash);this.publicSource.user(id,messageId,projection.publicText);s.view.messages.push({id:messageId,role:'user',text:projection.publicText,state:'queued'});s.queue.push({id:messageId,text});if(s.view.title==='Codex')s.view.title=projection.publicText.slice(0,60);this.save(s);});}
      catch(error){s.view=before;s.queue=beforeQueue;throw error;}
    }
    return this.serial(s,async()=>{
      try{
      if(s.sendUnavailable)throw new Error('native_send_unavailable');
      const record=this.sendJournal.get(wireSendId)!;
      if(record.status==='accepted'){const receipt=this.sendReceipt(s,record.messageId);if(!receipt)throw new Error('native_send_unknown');return receipt;}
      if(record.status==='transport_cancelled')throw new Error('native_send_transport_cancelled');
      if(record.status==='unknown'||record.status==='send_intent')throw new Error('native_send_unknown');
      if(previous)return null;
      this.sendJournal.assertKnown(id);this.sendJournal.assertQueued(record);if(s.stopping)throw new Error('native_stopping');
      await this.connect(s);this.sendJournal.assertQueued(record);if(s.stopping)throw new Error('native_stopping');
      await s.client!.assertNoExternalTools();this.sendJournal.assertQueued(record);if(s.stopping)throw new Error('native_stopping');
      if(immediate&&s.client!.activeTurnId&&!s.ready){
        this.sendJournal.atomic(()=>{this.sendJournal.cancelQueued(id,wireSendId);this.publicSource.syncDisposition(id);});s.queue=s.queue.filter(q=>q.id!==record.messageId);const message=s.view.messages.find(m=>m.id===record.messageId);if(message)message.state='cancelled';this.save(s);throw new Error('native_busy_not_admitted');
      }
      s.readySends.add(record.id);
      try{await this.flush(s);}catch(error){s.readySends.delete(record.id);throw error;}
      return this.sendReceipt(s,record.messageId);
      }catch(error){
        if(immediate){
          try{const row=this.sendJournal.get(wireSendId);if(row?.status==='queued'){this.sendJournal.atomic(()=>{this.sendJournal.cancelQueued(id,wireSendId);this.publicSource.syncDisposition(id);});s.readySends.delete(wireSendId);s.queue=s.queue.filter(q=>q.id!==row.messageId);const message=s.view.messages.find(m=>m.id===row.messageId);if(message)message.state='cancelled';this.save(s);}}
          catch{ s.sendUnavailable=true;throw new Error('native_send_unavailable'); }
        }
        throw error;
      }
    });
  }
  /** User-authorized main inspection, not an admission or physical-settlement certificate. */
  getSendState(actor:NativeActor,id:string,wireSendId:string):{wireSendId:string;status:NativeSendStatus;receipt:NativeSendReceipt|null}|null {
    const s=this.owned(actor,id),row=this.sendJournal.get(wireSendId);if(!row||row.sessionId!==id)return null;
    return {wireSendId,status:row.status,receipt:this.sendReceipt(s,row.messageId)};
  }
  private async flush(s:Session) {
    if(s.sendUnavailable)throw new Error('native_send_unavailable');
    if(s.stopping||!s.client)return;
    this.sendJournal.assertKnown(s.view.id);
    if(s.client.activeTurnId&&!s.ready)return;
    const messages=this.sendJournal.queued(s.view.id).filter(row=>s.readySends.has(row.id));if(!messages.length)return;
    const text=messages.map(m=>m.text).join('\n\n');
    const generation=s.generation!,afterEvent=s.eventSequence??0,activeTurn=s.client.activeTurnId;
    const binding:NativeSendBinding={connectionGeneration:generation,nativeThreadId:s.nativeId!,afterEvent,kind:activeTurn?'steer':'start',activeTurnId:activeTurn,wireHash:nativeSendHash(text),wireSendIds:messages.map(m=>m.id)};
    // Authority and exact durable queue claim are synchronous immediately before work RPC.
    this.options.authorizeExecution?.(s.view.id);
    this.sendJournal.atomic(()=>{this.sendJournal.claim(messages,binding);this.publicSource.syncDisposition(s.view.id);});
    s.queue=s.queue.filter(q=>!messages.some(m=>m.messageId===q.id));for(const row of messages)s.readySends.delete(row.id);
    let accepted=false;
    try {
      let turnId:string;
      if(activeTurn){const ack=await s.client.steer(text);turnId=activeTurn;if(ack?.turnId!==activeTurn)throw new Error('native_send_binding_unknown');}
      else {s.ready=false;s.view.status='running';turnId=(await s.client.start(text)).turnId;}
      if(!turnId||typeof turnId!=='string'||s.generation!==generation||s.nativeId!==binding.nativeThreadId)throw new Error('native_send_binding_unknown');
      const settled=this.db.prepare('SELECT event_watermark FROM codex_native_turn_settlements WHERE session_id=? AND generation=? AND native_thread_id=? AND turn_id=? AND event_watermark>?').get(s.view.id,generation,s.nativeId!,turnId,afterEvent);
      const receipts=messages.map(entry=>({messageId:entry.messageId,nativeSessionId:s.view.id,connectionGeneration:generation,nativeThreadId:s.nativeId!,turnId,afterEvent}));
      this.sendJournal.atomic(()=>{this.sendJournal.accept(messages,binding,receipts,typeof settled?.event_watermark==='number'?settled.event_watermark:null);this.publicSource.syncDisposition(s.view.id);});accepted=true;
      for(const entry of messages){const m=s.view.messages.find(m=>m.id===entry.messageId);if(m)m.state='sent';}
    }catch(error){
      if(!accepted){this.sendJournal.atomic(()=>{this.sendJournal.markUnknown(s.view.id);this.publicSource.syncDisposition(s.view.id);});for(const entry of messages){const m=s.view.messages.find(m=>m.id===entry.messageId);if(m)m.state='unknown';}}
      s.view.status='error';s.view.error=(error as Error).message;throw error;
    }finally{this.save(s);}
  }
  private sendReceipt(s:Session,messageId:string):NativeSendReceipt|null {
    const row=this.db.prepare('SELECT * FROM codex_native_send_receipts WHERE id=? AND session_id=?').get(messageId,s.view.id);
    return row?{messageId,nativeSessionId:s.view.id,nativeThreadId:String(row.native_thread_id),connectionGeneration:String(row.generation),turnId:String(row.turn_id),afterEvent:Number(row.after_event)}:null;
  }
  readTurnCompletion(actor:NativeActor,id:string,receipt:NativeSendReceipt):NativeTurnCompletionReceipt|null {
    const s=this.owned(actor,id),bound=this.sendReceipt(s,receipt.messageId);
    if(!bound||JSON.stringify(bound)!==JSON.stringify(receipt))throw new Error('native_send_binding_unknown');
    const row=this.db.prepare('SELECT completed_event FROM codex_native_send_receipts WHERE id=?').get(receipt.messageId);
    return typeof row?.completed_event==='number'&&row.completed_event>bound.afterEvent?{...bound,completedEvent:row.completed_event}:null;
  }
  private event(s:Session,e:NativeEvent) {
    if(e.method==='serverRequest/resolved'){
      for(const [token,p] of s.pending)if(p.requestId===String(e.params?.requestId)){clearTimeout(p.timer);s.pending.delete(token);p.resolve({decision:'decline'});}
      this.save(s);return;
    }
    if(e.params?.threadId!==s.nativeId)return;
    if(e.method==='turn/started'){s.turnId=e.params.turn.id;s.view.status='running';s.ready=false;s.items.clear();}
    else if(e.params.turnId && e.params.turnId!==s.turnId)return;
    if(e.method==='turn/completed'&&e.params.turn.id!==s.turnId)return;
    const sequence=(s.eventSequence??0)+1;s.eventSequence=sequence;
    if(e.method==='turn/completed'){
      this.db.prepare('INSERT OR IGNORE INTO codex_native_turn_settlements VALUES (?,?,?,?,?)').run(s.view.id,s.generation!,s.nativeId!,s.turnId!,sequence);
      this.db.prepare('UPDATE codex_native_send_receipts SET completed_event=? WHERE session_id=? AND generation=? AND native_thread_id=? AND turn_id=? AND after_event<? AND completed_event IS NULL').run(sequence,s.view.id,s.generation!,s.nativeId!,s.turnId!,sequence);
    }
    try{this.sendJournal.atomic(()=>{
      if(e.method==='turn/started')this.publicSource.turn(s.view.id,'turn_started',s.turnId!,null);
      else if(e.method==='turn/completed')this.publicSource.turn(s.view.id,'turn_completed',s.turnId!,String(e.params.turn.status));
      else if(e.method==='item/agentMessage/delta')this.publicSource.assistant(s.view.id,String(e.params.itemId),e.params.delta,s.turnId??null,true);
      else if(e.method==='item/completed'&&e.params.item?.type==='agentMessage')this.publicSource.assistant(s.view.id,String(e.params.item.id),e.params.item.text,s.turnId??null,false);
    });}catch(error){s.sendUnavailable=true;this.markPublicGap(s);throw error;}
    this.options.onEvent?.(s.view.id,e);
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
    if(s.stopping||s.client!==client||r.params?.threadId!==s.nativeId||r.params?.turnId!==client.activeTurnId)return Promise.resolve(decline);
    try { this.options.authorizeExecution?.(s.view.id); } catch { return Promise.resolve(decline); }
    if(method==='item/fileChange/requestApproval'&&!s.items.has(r.params.itemId))return Promise.resolve(decline);
    const token=randomUUID();
    const description=JSON.stringify({request:r.params,...(method==='item/fileChange/requestApproval'?{changes:s.items.get(r.params.itemId)}:{})},null,2);
    if(description.length>16000)return Promise.resolve(decline);
    return new Promise(resolve=>{
      const view={token,method,description:description.slice(0,16000),expiresAt:Date.now()+(this.options.approvalTimeoutMs??120000)};
      const timer=setTimeout(()=>{s.pending.delete(token);resolve(decline);this.save(s);},this.options.approvalTimeoutMs??120000);
      s.pending.set(token,{view,connection:client,threadId:s.nativeId!,turnId:client.activeTurnId!,requestId:String(r.id),digest:createHash('sha256').update(JSON.stringify(r)).digest('hex'),resolve,timer});this.save(s);
    });
  }
  async decide(actor:NativeActor,id:string,token:string,decision:'allow'|'deny') {
    const s=this.owned(actor,id);const p=s.pending.get(token);
    if(!p||p.view.expiresAt<=Date.now()||p.connection!==s.client||p.threadId!==s.nativeId||p.turnId!==s.client?.activeTurnId||!['allow','deny'].includes(decision))throw new Error('native_approval_expired');
    if(decision==='allow')this.options.authorizeExecution?.(id);
    s.pending.delete(token);clearTimeout(p.timer);p.resolve({decision:decision==='allow'?'accept':'decline'});this.save(s);
  }
  private revoke(s:Session){for(const p of s.pending.values()){clearTimeout(p.timer);p.resolve({decision:'decline'});}s.pending.clear();}
  private cancelQueue(s:Session){this.sendJournal.atomic(()=>{this.sendJournal.cancelQueued(s.view.id);this.publicSource.syncDisposition(s.view.id);});s.readySends.clear();for(const q of s.queue){const m=s.view.messages.find(m=>m.id===q.id);if(m)m.state='cancelled';}s.queue=[];}
  async interrupt(actor:NativeActor,id:string){const s=this.owned(actor,id);s.stopping=true;this.revoke(s);this.cancelQueue(s);try{await s.lock;if(s.client?.activeTurnId)await s.client.interrupt();}finally{s.stopping=false;this.save(s);}}
  async disconnect(actor:NativeActor,id:string){const s=this.owned(actor,id);s.stopping=true;this.markPublicGap(s);this.revoke(s);this.cancelQueue(s);try{await s.lock;await s.client?.close();s.client=undefined;s.view.status='disconnected';}finally{s.stopping=false;this.save(s);}}
  async dispose(){if(this.disposed)return;for(const s of this.sessions.values())await this.disconnect({requestSource:'user',actorId:this.options.profileId},s.view.id);this.disposed=true;for(const timer of this.notices.values())clearTimeout(timer);if(!this.startupError)this.db.close();}
}
