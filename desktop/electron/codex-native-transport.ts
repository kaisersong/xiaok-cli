import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { types } from 'node:util';
import { hasOriginalMainSdkBridgeInstallation } from '../../src/runtime/verification/original-main-sdk-bridge.js';
import { createOriginalCodexProcessSourceTicket } from './codex-process-source.js';
import { createOriginalSourceProcess, listenOriginalToolProcess, sealOriginalToolProcessListeners,
  retainOriginalToolProcessValue, waitOriginalToolProcessPhysical, terminateOriginalToolProcess } from '../../src/runtime/verification/original-process-sdk.js';
import { createRoomTurnCustody, type RoomTurnCustody } from '../../src/runtime/verification/original-sdk-custody.js';

const launchMembers = new WeakMap<object, Readonly<{command:string;argv:readonly string[];options:Readonly<import('node:child_process').SpawnOptions>;assertCurrent():void;assertLocal():void}>>();
const launchGet=WeakMap.prototype.get,launchSet=WeakMap.prototype.set,launchApply=Reflect.apply;
const launchDescriptors=Object.getOwnPropertyDescriptors,launchDescriptor=Object.getOwnPropertyDescriptor;
const launchPrototype=Object.getPrototypeOf,launchOwn=Object.hasOwn,launchIsProxy=types.isProxy;
const launchKeys=Reflect.ownKeys,launchIsArray=Array.isArray;
/** Passive private birth reader; the Service reader separately proves ownership. */
export function readOriginalCodexProcessLaunch(probe:unknown) {
  const row=launchApply(launchGet,launchMembers,[probe]) as Readonly<{command:string;argv:readonly string[];options:Readonly<import('node:child_process').SpawnOptions>;assertCurrent():void;assertLocal():void}>|undefined;
  if(!row)throw Error('CODEX_PROCESS_ORIGINAL_LAUNCH_REQUIRED');return row;
}

export function resolveLaunch(entry: string, args: string[] = [], platform: string = process.platform) {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(entry)) throw new Error('Use a real JS/executable entry, not a Windows shim');
  return /\.[cm]?js$/i.test(entry) ? { command: process.execPath, args: [entry, ...args] } : { command: entry, args };
}

export interface NativeEvent { method: string; params: any; seq?: number }
export interface NativeOptions {
  executable: string; prefixArgs?: string[]; cwd: string; timeoutMs?: number;
  sandbox?: 'read-only' | 'workspace-write';
  onEvent?: (event: NativeEvent) => void;
  onApproval?: (request: any) => Promise<any>;
  onFailure?: (error: Error) => void;
}
// Internal transport. Approval policy belongs to the main-process service.
export class SessionProbe {
  threadId: string | null = null; activeTurnId: string | null = null; exited = false; events: NativeEvent[] = []; cursor = 0;
  options: NativeOptions & { timeoutMs: number };
  #child?: ChildProcessWithoutNullStreams; #pending = new Map<number, any>(); #waiters = new Set<any>(); #next = 0; #failure:unknown; #failurePresent=false; #closing?: Promise<void>; #exitPromise?: Promise<void>; #starting = false; #binding = false;
  #processTicket?: object;
  #qualifiedOptions?: NativeOptions & {timeoutMs:number};
  #processAttempt?: object;
  #callbackStocks: RoomTurnCustody[]=[];
  constructor(options: NativeOptions) {
    const qualified=hasOriginalMainSdkBridgeInstallation();
    if(qualified) {
      if(new.target!==SessionProbe||!options||typeof options!=='object'||launchIsProxy(options)||(launchPrototype(options)!==Object.prototype&&launchPrototype(options)!==null))throw Error('CODEX_PROCESS_LAUNCH_INVALID');
      const fields=launchDescriptors(options);
      for(const name of launchKeys(fields)){
        const field=launchDescriptor(fields,name)?.value as PropertyDescriptor|undefined;
        if(typeof name!=='string'||(name!=='executable'&&name!=='prefixArgs'&&name!=='cwd'&&name!=='timeoutMs'&&name!=='sandbox'&&name!=='onEvent'&&name!=='onApproval'&&name!=='onFailure')||!field||!launchOwn(field,'value'))throw Error('CODEX_PROCESS_LAUNCH_INVALID');
      }
      const executable=launchDescriptor(fields,'executable')?.value?.value,cwd=launchDescriptor(fields,'cwd')?.value?.value;
      const prefix=launchDescriptor(fields,'prefixArgs')?.value?.value as unknown;
      if(typeof executable!=='string'||typeof cwd!=='string')throw Error('CODEX_PROCESS_LAUNCH_INVALID');
      if(prefix!==undefined){
        if(!launchIsArray(prefix)||launchIsProxy(prefix)||launchPrototype(prefix)!==Array.prototype)throw Error('CODEX_PROCESS_LAUNCH_INVALID');
        for(let i=0;i<prefix.length;i++){const field=launchDescriptor(prefix,String(i));if(!field||!launchOwn(field,'value')||typeof field.value!=='string')throw Error('CODEX_PROCESS_LAUNCH_INVALID');}
      }
    }
    this.options = { timeoutMs: 30000, ...options };
    if(qualified){
      const prefixArgs=this.options.prefixArgs?Object.freeze([...this.options.prefixArgs]):undefined;
      const fixed=Object.freeze({...this.options,prefixArgs}) as NativeOptions & {timeoutMs:number};this.options=fixed;this.#qualifiedOptions=fixed;
      const launch=resolveLaunch(fixed.executable,prefixArgs?[...prefixArgs]:[]);
      const argv=Object.freeze([...launch.args]),env=Object.freeze({...process.env,ELECTRON_RUN_AS_NODE:'1'});
      const spawnOptions=Object.freeze({cwd:fixed.cwd,stdio:'pipe' as const,detached:process.platform!=='win32',windowsHide:true,env});
      let retired=false;
      const assertLocal=()=>{if(retired||launchDescriptor(this,'options')?.value!==fixed||this.#closing||this.#failurePresent){retired=true;throw Error('CODEX_PROCESS_ORIGINAL_LAUNCH_RETIRED');}};
      launchApply(launchSet,launchMembers,[this,Object.freeze({command:launch.command,argv,options:spawnOptions,assertCurrent:assertLocal,assertLocal})]);
    }
  }
  #settings():NativeOptions & {timeoutMs:number}{return this.#qualifiedOptions??this.options;}
  get pid() { return this.#child?.pid; }
  #retain<T>(raw:T):T {if(this.#processAttempt)retainOriginalToolProcessValue(this.#processAttempt,raw);return raw;}
  #syncCallback(fn:Function|undefined,args:unknown[]):void {
    if(!fn)return;
    if(!this.#processAttempt){Reflect.apply(fn,this.#settings(),args);return;}
    const stock=createRoomTurnCustody();this.#callbackStocks.push(stock);
    stock.syncVoid(fn,this.#settings(),args);
  }
  async #asyncCallback<T>(fn:Function,args:unknown[]):Promise<T> {
    if(!this.#processAttempt)return Reflect.apply(fn,this.#settings(),args) as T;
    const stock=createRoomTurnCustody();this.#callbackStocks.push(stock);
    let failed=false,primary:unknown,value!:T,cleanupFailed=false,secondary:unknown;
    try{value=await stock.sdk<T>(fn,this.#settings(),args);}catch(error){failed=true;primary=error;}
    try{await stock.waitPhysicalKnown();}catch(error){cleanupFailed=true;secondary=error;}
    if(failed&&cleanupFailed)throw new AggregateError([primary,secondary],'CODEX_CALLBACK_PHYSICAL_UNCONFIRMED',{cause:primary});
    if(failed)throw primary;if(cleanupFailed)throw secondary;return value;
  }
  #assert() { if (this.#failurePresent) throw this.#failure; if (!this.#child) throw new Error('connection closed'); }
  #fail(error: unknown) {
    this.#retain(error);
    if (this.#failurePresent) return;
    this.#failurePresent=true;this.#failure = error;
    for (const p of this.#pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.#pending.clear();
    try{this.#syncCallback(this.#settings().onFailure,[error]);}catch(secondary){this.#retain(secondary);}
    for (const w of [...this.#waiters])try{w.finish(error,undefined,true);}catch(secondary){this.#retain(secondary);}
  }
  #send(message: any) { this.#assert();try{this.#retain(this.#child!.stdin.write(JSON.stringify(message) + '\n'));}catch(error){this.#retain(error);throw error;} }
  #request(method: string, params: any): Promise<any> {
    this.#assert(); const id = ++this.#next;
    return this.#retain(new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#fail(new Error(`RPC timeout: ${method}`)); void this.close().catch(() => {});
      }, this.#settings().timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      try { this.#send({ id, method, params }); } catch (e) { this.#fail(e as Error); }
    }));
  }
  #event(message: NativeEvent) {
    const event = { ...message, seq: ++this.cursor }; this.events.push(event);
    if (this.events.length > 1024) this.events.shift();
    if (event.params?.threadId === this.threadId) {
      if (event.method === 'turn/started') this.activeTurnId = event.params.turn.id;
      if (event.method === 'turn/completed' && event.params.turn.id === this.activeTurnId) this.activeTurnId = null;
    }
    this.#syncCallback(this.#settings().onEvent,[event]);
    for (const w of [...this.#waiters]) if (event.seq! > w.after && event.method === w.method && w.predicate(event)) w.finish(null, event);
  }
  #receive(message: any) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('invalid protocol message');
    if (message.method && message.id !== undefined) {
      const method = message.method;
      const result = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(method) ? { decision: 'decline' }
        : method === 'item/permissions/requestApproval' ? { permissions: {}, scope: 'turn' }
        : method === 'mcpServer/elicitation/request' ? { action: 'decline', content: null } : null;
      const approval=(async () => {
        let decision = result;
        try { const approval=this.#settings().onApproval;if (approval) decision = await this.#retain(this.#asyncCallback(approval,[message])); } catch(error) { this.#retain(error); /* default deny */ }
        if (this.#failurePresent) return;
        this.#send(decision ? { id: message.id, result: decision } : { id: message.id, error: { code: -32601, message: 'Unsupported server request' } });
        this.#event({ method: 'probe/approval', params: { method, threadId: message.params?.threadId, turnId: message.params?.turnId, decision: decision?.decision === 'accept' ? 'accept' : result ? 'decline' : 'unsupported' } });
      })();this.#retain(approval);this.#retain(approval.catch(error => this.#fail(error)));
    } else if (message.method) this.#event(message);
    else {
      const pending = this.#pending.get(message.id); if (!pending) return;
      clearTimeout(pending.timer); this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(`RPC error ${message.error.code}: ${message.error.message}`)); else pending.resolve(message.result);
    }
  }
  async connect() {
    if (this.#child || this.#failurePresent) throw new Error('connection already used');
    if(hasOriginalMainSdkBridgeInstallation())this.#processTicket=createOriginalCodexProcessSourceTicket(this);
    const launch = resolveLaunch(this.#settings().executable, this.#settings().prefixArgs);
    if(this.#processTicket){
      const created=await createOriginalSourceProcess(this.#processTicket);this.#processAttempt=created.attempt;
      const handle=created.handle;
      if(!handle.stdin||!handle.stdout||!handle.stderr)throw Error('CODEX_PROCESS_STDIO_REQUIRED');
      this.#child=handle as ChildProcessWithoutNullStreams;
    }else this.#child = spawn(launch.command, launch.args, { cwd: this.#settings().cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    const listen=(endpoint:'child'|'stdin'|'stdout'|'stderr',event:string,handler:(...args:any[])=>void)=>{
      if(this.#processAttempt)listenOriginalToolProcess(this.#processAttempt,endpoint,event,handler);
      else (endpoint==='child'?this.#child!:this.#child![endpoint]).on(event,handler);
    };
    this.#exitPromise = this.#retain(new Promise(resolve => listen('child','close', () => { this.exited = true; this.#fail(new Error('connection closed: process exited')); resolve(); })));
    listen('child','error', error => this.#fail(error));
    listen('stdin','error', error => this.#fail(error));
    if(this.#processAttempt)listen('stderr','data',()=>{});else this.#child.stderr.resume();
    let buffer = Buffer.alloc(0);
    listen('stdout','data', chunk => {
      if (this.#failurePresent) return;
      try {
        buffer = Buffer.concat([buffer, chunk]);
        let end;
        while ((end = buffer.indexOf(10)) !== -1) {
          if (end > 1024 * 1024) throw new Error('protocol frame exceeds limit');
          const line = buffer.subarray(0, end).toString('utf8'); buffer = buffer.subarray(end + 1);
          if (line.trim()) this.#receive(JSON.parse(line));
        }
        if (buffer.length > 1024 * 1024) throw new Error('protocol frame exceeds limit');
      } catch(error) { this.#fail(this.#processAttempt?error:new Error('invalid or oversized protocol frame')); void this.close().catch(() => {}); }
    });
    if(this.#processAttempt)sealOriginalToolProcessListeners(this.#processAttempt);
    const initialized = await this.#request('initialize', { clientInfo: { name: 'xiaok_native_validation', version: '1' }, capabilities: { experimentalApi: true } });
    this.#send({ method: 'initialized' }); return initialized;
  }
  async #bind(method: string, extra: Record<string, unknown> = {}) {
    this.#assert(); if (this.threadId || this.#binding) throw new Error('thread already bound or binding');
    this.#binding = true;
    try {
      const r = await this.#request(method, { cwd: this.#settings().cwd, sandbox: this.#settings().sandbox ?? 'read-only', approvalPolicy: 'untrusted', approvalsReviewer: 'user', ...extra });
      this.threadId = r.thread.id; return r;
    } finally { this.#binding = false; }
  }
  create() { return this.#bind('thread/start', { ephemeral: false }); }
  resume(threadId: string) { return this.#bind('thread/resume', { threadId }); }
  async start(text: string) {
    this.#assert(); if (!this.threadId) throw new Error('no bound thread');
    if (this.#starting || this.activeTurnId) throw new Error('active turn already exists');
    this.#starting = true; const after = this.cursor;
    try {
      const r = await this.#request('turn/start', { threadId: this.threadId, input: [{ type: 'text', text, text_elements: [] }] });
      if (!this.events.some(e => e.seq! > after && e.method === 'turn/completed' && e.params.threadId === this.threadId && e.params.turn.id === r.turn.id)) this.activeTurnId = r.turn.id;
      return { turnId: r.turn.id };
    } finally { this.#starting = false; }
  }
  async steer(text: string) {
    this.#assert(); if (!this.activeTurnId) throw new Error('no active turn');
    return this.#request('turn/steer', { threadId: this.threadId, expectedTurnId: this.activeTurnId, input: [{ type: 'text', text, text_elements: [] }] });
  }
  async interrupt() {
    this.#assert(); if (!this.activeTurnId) throw new Error('no active turn');
    const turnId = this.activeTurnId, after = this.cursor;
    const terminal = (e: NativeEvent) => e.params.threadId === this.threadId && e.params.turn.id === turnId;
    const deadline = Date.now() + 3000;
    for (;;) {
      const completed = this.events.find(e => e.seq! > after && e.method === 'turn/completed' && terminal(e));
      if (completed) return completed;
      try { await this.#request('turn/interrupt', { threadId: this.threadId, turnId }); break; }
      catch (error) {
        // A rejected interrupt had no effect. Retry only this explicit startup
        // precondition, never timeouts, transport errors or arbitrary mutations.
        if ((error as Error).message !== 'RPC error -32600: no active turn to interrupt' || Date.now() >= deadline) throw error;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    return this.waitFor('turn/completed', terminal, { after });
  }
  async waitFor(method: string, predicate: (event: NativeEvent) => boolean = () => true, { timeoutMs = this.#settings().timeoutMs, after = 0 } = {}): Promise<NativeEvent> {
    this.#assert();
    const found = this.events.find(e => e.seq! > after && e.method === method && predicate(e)); if (found) return found;
    return this.#retain(new Promise((resolve, reject) => {
      const w = { method, predicate, after, finish: (error: unknown, result?: NativeEvent, failed = error !== null) => { clearTimeout(timer); this.#waiters.delete(w); failed ? reject(error) : resolve(result!); } };
      const timer = setTimeout(() => w.finish(new Error(`event timeout: ${method}`)), timeoutMs); this.#waiters.add(w);
    }));
  }
  async close() {
    if (this.#closing) return this.#closing;
    this.#fail(new Error('connection closed'));
    this.#closing = (async () => {
      if (!this.#child) return;
      if (!this.pid) { await this.#exitPromise; return; }
      const kill = (signal: NodeJS.Signals) => {
        try {
          if(this.#processAttempt){
            // Negative control of this exact original handle creates no taskkill
            // sibling. It proves no hidden descendant/domain has stopped.
            const raw=terminateOriginalToolProcess(this.#processAttempt,signal);this.#retain(raw);
            void raw.catch(error=>this.#retain(error));return;
          }
          if (process.platform !== 'win32') process.kill(-this.pid!, signal);
          else spawn('taskkill', ['/pid', String(this.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
        } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e; }
      };
      kill('SIGTERM');
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const timer = setTimeout(() => { try { kill('SIGKILL'); } catch {} }, 1000);
      try {
        await Promise.race([this.#exitPromise, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('process cleanup timeout; exit not confirmed')), 5000); })]);
      } finally { clearTimeout(timer); clearTimeout(deadline); }
      // The wrapper may exit before descendants; target only this probe's group.
      if (!this.#processAttempt&&process.platform !== 'win32') kill('SIGKILL');
      if(this.#processAttempt){
        const failures:unknown[]=[];let offset=0;
        while(offset<this.#callbackStocks.length){const stock=this.#callbackStocks[offset++]!;try{await stock.waitPhysicalKnown();}catch(error){failures.push(error);}}
        try{await waitOriginalToolProcessPhysical(this.#processAttempt);}catch(error){failures.push(error);}
        if(failures.length)throw new AggregateError(failures,'CODEX_PROCESS_PHYSICAL_UNCONFIRMED',{cause:failures[0]});
      }
    })();
    return this.#closing;
  }
}
