import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { dirname, join, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { SessionProbe, type NativeEvent, type NativeOptions } from './codex-native-transport.js';
import type { NativeSnapshot, NativeSummary, NativeApproval } from '../shared/codex-native-types.js';

export interface NativeActor { requestSource: 'user' | 'agent' | 'scheduler'; actorId: string }
type Pending = { view: NativeApproval; connection: SessionProbe; threadId: string; turnId: string; digest: string; requestId: string; resolve: (result: unknown) => void; timer: ReturnType<typeof setTimeout> };
type Session = { view: NativeSnapshot; nativeId: string | null; client?: SessionProbe; lock: Promise<unknown>; ready: boolean; stopping: boolean; pending: Map<string, Pending>; turnId?: string; items: Map<string, unknown>; queue: Array<{id:string;text:string}> };
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
  private notices = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private options: NativeServiceOptions) {
    mkdirSync(dirname(options.dbPath), {recursive:true});
    this.db = new DatabaseSync(options.dbPath); this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('CREATE TABLE IF NOT EXISTS codex_native_sessions (id TEXT PRIMARY KEY, owner TEXT NOT NULL, native_id TEXT, snapshot TEXT NOT NULL)');
    for (const row of this.db.prepare('SELECT id,native_id,snapshot FROM codex_native_sessions WHERE owner=?').all(options.profileId) as any[]) {
      const view = JSON.parse(row.snapshot) as NativeSnapshot; view.status='disconnected'; view.approvals=[]; view.queued=0;
      for (const m of view.messages) if (m.state==='queued') m.state='cancelled';
      this.sessions.set(row.id,{view,nativeId:row.native_id,lock:Promise.resolve(),ready:false,stopping:false,pending:new Map(),items:new Map(),queue:[]});
    }
  }
  private authorize(actor: NativeActor) { if (this.disposed || actor.requestSource !== 'user' || actor.actorId !== this.options.profileId) throw new Error('native_access_denied'); }
  private owned(actor: NativeActor, id: string) { this.authorize(actor); const s=this.sessions.get(id); if(!s) throw new Error('native_session_denied'); return s; }
  list(actor: NativeActor): NativeSummary[] { this.authorize(actor); return [...this.sessions.values()].map(({view:{id,title,cwd,status,updatedAt,error}})=>({id,title,cwd,status,updatedAt,error})).sort((a,b)=>b.updatedAt-a.updatedAt); }
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
    const id=randomUUID(); const s:Session={view:{id,title:'Codex',cwd:path,status:'disconnected',updatedAt:Date.now(),revision:0,messages:[],approvals:[],queued:0},nativeId:null,lock:Promise.resolve(),ready:false,stopping:false,pending:new Map(),items:new Map(),queue:[]};
    this.sessions.set(id,s);this.save(s);
    await this.serial(s,()=>this.connect(s));return this.get(actor,id);
  }
  private async connect(s:Session) {
    if(s.client && s.view.status!=='error') return;
    if([...this.sessions.values()].filter(v=>v!==s&&(v.client||v.view.status==='connecting')).length>=4) throw new Error('native_session_limit');
    if(s.client) {await s.client.close();s.client=undefined;}
    s.view.status='connecting';s.view.error=undefined;this.save(s);
    try {
      const executable=this.options.createClient ? process.execPath : await findCodexEntry();
      const client=(this.options.createClient ?? (o=>new SessionProbe(o)))({executable,prefixArgs:['app-server','--stdio','-c','features.hooks=false'],cwd:s.view.cwd,sandbox:'workspace-write',timeoutMs:30000,
        onEvent:e=>{if(s.client===client)this.event(s,e);},onApproval:r=>this.approval(s,client,r),onFailure:()=>{if(s.client===client&&!s.stopping){s.view.status='error';s.view.error='native_connection_closed';this.revoke(s);this.cancelQueue(s);this.save(s);}}});
      s.client=client;await client.connect();
      if(s.nativeId) await client.resume(s.nativeId);else{await client.create();s.nativeId=client.threadId;}
      s.view.status='idle';s.ready=false;this.save(s);
    } catch(error) {s.view.status='error';s.view.error=(error as Error).message;this.save(s);if(s.client){await s.client.close();s.client=undefined;}throw error;}
  }
  async send(actor:NativeActor,id:string,text:string) {
    const s=this.owned(actor,id);if(typeof text!=='string'||!text.trim()||text.length>32000)throw new Error('native_invalid_message');
    return this.serial(s,async()=>{
      if(s.stopping)throw new Error('native_stopping');await this.connect(s);
      const message={id:randomUUID(),role:'user' as const,text,state:'queued' as const};s.view.messages.push(message);
      if(s.view.title==='Codex')s.view.title=text.slice(0,60);
      s.queue.push({id:message.id,text});this.save(s);await this.flush(s);
    });
  }
  private async flush(s:Session) {
    if(s.stopping||!s.client||!s.queue.length)return;
    if(s.client.activeTurnId&&!s.ready)return;
    const messages=s.queue.splice(0);const text=messages.map(m=>m.text).join('\n\n');
    try {
      if(s.client.activeTurnId)await s.client.steer(text);else {s.ready=false;s.view.status='running';await s.client.start(text);}
      for(const entry of messages){const m=s.view.messages.find(m=>m.id===entry.id);if(m)m.state='sent';}
    }catch(error){for(const entry of messages){const m=s.view.messages.find(m=>m.id===entry.id);if(m)m.state='unknown';}s.view.status='error';s.view.error=(error as Error).message;throw error;}
    finally{this.save(s);}
  }
  private event(s:Session,e:NativeEvent) {
    if(e.method==='serverRequest/resolved'){
      for(const [token,p] of s.pending)if(p.requestId===String(e.params?.requestId)){clearTimeout(p.timer);s.pending.delete(token);p.resolve({decision:'decline'});}
      this.save(s);return;
    }
    if(e.params?.threadId!==s.nativeId)return;
    this.options.onEvent?.(s.view.id,e);
    if(e.method==='turn/started'){s.turnId=e.params.turn.id;s.view.status='running';s.ready=false;s.items.clear();}
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
    s.pending.delete(token);clearTimeout(p.timer);p.resolve({decision:decision==='allow'?'accept':'decline'});this.save(s);
  }
  private revoke(s:Session){for(const p of s.pending.values()){clearTimeout(p.timer);p.resolve({decision:'decline'});}s.pending.clear();}
  private cancelQueue(s:Session){for(const q of s.queue){const m=s.view.messages.find(m=>m.id===q.id);if(m)m.state='cancelled';}s.queue=[];}
  async interrupt(actor:NativeActor,id:string){const s=this.owned(actor,id);s.stopping=true;this.revoke(s);this.cancelQueue(s);try{await s.lock;if(s.client?.activeTurnId)await s.client.interrupt();}finally{s.stopping=false;this.save(s);}}
  async disconnect(actor:NativeActor,id:string){const s=this.owned(actor,id);s.stopping=true;this.revoke(s);this.cancelQueue(s);try{await s.lock;await s.client?.close();s.client=undefined;s.view.status='disconnected';}finally{s.stopping=false;this.save(s);}}
  async dispose(){if(this.disposed)return;for(const s of this.sessions.values())await this.disconnect({requestSource:'user',actorId:this.options.profileId},s.view.id);this.disposed=true;for(const timer of this.notices.values())clearTimeout(timer);this.db.close();}
}
