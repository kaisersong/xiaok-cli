// AuthOwner worker factory: Electron main owns the dedicated pinned auth-owner
// native binary (feature xiaok-auth-owner-only, restriction
// xiaok-auth-owner-v1) as the single owner of user codex credentials. Design:
// 2026-10-19-context-continuity-main-auth-owner-v3 (three-seat consensus
// original-main-auth-owner-design-v3). This module exports exactly
// openAuthOwner, AuthOwnerController and verifyAuthOwnerBinary: no exported
// entry accepts issuer/env/config overrides, and the synthetic-issuer spawn
// wiring lives only in the test tree.
import {spawn, type ChildProcess} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const QUALIFIED_BINARY={platform:'darwin' as string,arch:'arm64' as string,sha256:'5319f2e03161415f75a88ccf251fc43fbc9a86c62481e2f8430f6b831cd54c6c',restriction:'xiaok-auth-owner-v1'};
const EXPECTED_CONFIG_BYTES='cli_auth_credentials_store = "file"\n[features]\nshell_snapshot = false\n';
const FRAME_LIMIT=1024*1024;
const RPC_TIMEOUT_MS=15000;

export type AuthOwnerLoginState='logged_out'|'logging_in'|'logged_in';
export interface AuthOwnerAccountProjection{accountId?:string}
export interface AuthOwnerStatus{state:AuthOwnerLoginState;account?:AuthOwnerAccountProjection}
export interface AuthorizedFetchRequest{url:string;method?:string;headers?:Record<string,string>;body?:string}
export interface AuthorizedFetchResult{status:number;headers:Record<string,string>;bodyText:string}
export interface AuthOwnerPort{call(method:string,params?:unknown,timeoutMs?:number):Promise<any>;addNotificationHandler(handler:(notification:{method:string;params?:any})=>void):void;alive():boolean}
export interface AuthOwnerCloseObservation{exitCode:number|null;exitSignal:string|null;stdoutEnded:boolean;stderrEnded:boolean;writesSettled:boolean;parserSettled:boolean;groupExited:boolean;homeIdentityOk:boolean;usedFallbackKill:boolean;timedOut:boolean}
export type AuthOwnerCloseSettlement='closed'|'close_failed'|'close_unknown';
export interface AuthOwnerOptions{stateRoot:string;profileId:string;dataRoot:string;authOwnerBinary?:string;resourcesRoot?:string;appVersion?:string;onStatus?:(status:AuthOwnerStatus)=>void;openExternal?:(url:string)=>Promise<void>|void}
export interface AuthOwnerHandle{controller:AuthOwnerController;closeAndDrain():Promise<AuthOwnerCloseSettlement>;readClosure():{settlement:AuthOwnerCloseSettlement|null;pid:number|null;testOnly:false}}

function failure(code:string):Error{return new Error(code);}
function sha256File(file:string):string{return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}

export function verifyAuthOwnerBinary(binaryPath:string):{ok:boolean;reason?:string}{
  const platform=process.platform as string,arch=process.arch as string;
  if(platform!==QUALIFIED_BINARY.platform||arch!==QUALIFIED_BINARY.arch)return {ok:false,reason:'auth_owner_platform_unqualified'};
  const expectedBasename=platform==='win32'?'codex-app-server.exe':'codex-app-server';
  // A relative path would be qualified against the main cwd but executed
  // against the worker cwd: the verified file and the spawned file could be
  // two different binaries. Only one resolved absolute path may be used for
  // both the qualification and the spawn.
  if(!path.isAbsolute(binaryPath))return {ok:false,reason:'auth_owner_binary_unqualified'};
  try{
    const stats=fs.lstatSync(binaryPath);
    if(stats.isSymbolicLink()||!stats.isFile())return {ok:false,reason:'auth_owner_binary_unqualified'};
    if(path.basename(binaryPath)!==expectedBasename)return {ok:false,reason:'auth_owner_binary_unqualified'};
    if(sha256File(binaryPath)!==QUALIFIED_BINARY.sha256)return {ok:false,reason:'auth_owner_binary_unqualified'};
    return {ok:true,reason:undefined};
  }catch{return {ok:false,reason:'auth_owner_binary_unqualified'};}
}

export class AuthOwnerController{
  static parseStreamChunk(buffer:Buffer,chunk:Buffer):{buffer:Buffer;lines:string[];error?:string}{
    let combined:Buffer=Buffer.concat([buffer,chunk]);
    const lines:string[]=[];
    while(true){
      const end=combined.indexOf(10);
      if(end<0)break;
      if(end>FRAME_LIMIT)return {buffer:Buffer.alloc(0),lines,error:'auth_owner_frame_limit'};
      const line=combined.subarray(0,end).toString('utf8');
      combined=Buffer.from(combined.subarray(end+1));
      if(line.trim())lines.push(line);
    }
    if(combined.length>FRAME_LIMIT)return {buffer:Buffer.alloc(0),lines,error:'auth_owner_frame_limit'};
    return {buffer:combined,lines};
  }
  static finishParse(buffer:Buffer):{error?:string}{
    return buffer.length>0?{error:'auth_owner_frame_residual'}:{};
  }
  /** Production dispose gate: only a graceful `closed` settlement may let
   * durable stores close; anything else propagates as a failure. */
  static assertCloseSettlement(settlement:AuthOwnerCloseSettlement){
    if(settlement!=='closed')throw failure(`auth_owner_close_${settlement}`);
  }
  static settleClose(observation:AuthOwnerCloseObservation):AuthOwnerCloseSettlement{
    if(observation.usedFallbackKill||observation.timedOut||!observation.groupExited)return 'close_unknown';
    if(observation.exitCode===0&&observation.exitSignal===null&&observation.stdoutEnded&&observation.stderrEnded&&observation.writesSettled&&observation.parserSettled&&observation.homeIdentityOk)return 'closed';
    return 'close_failed';
  }
  readonly #port:AuthOwnerPort;
  readonly #openExternal:(url:string)=>Promise<void>|void;
  readonly #fetchImpl:(url:string,init?:RequestInit)=>Promise<Response>;
  readonly #onStatus?:(status:AuthOwnerStatus)=>void;
  #state:AuthOwnerLoginState='logged_out';
  #account:AuthOwnerAccountProjection|undefined;
  #loginGeneration=0;
  #validLoginIds=new Set<string>();
  #loginAttempts=new Map<string,number>();
  #attemptGenerations=new Map<number,number>();
  #credentialGeneration=0;
  #snapshot:{accessToken:string;generation:number}|null=null;
  #audienceOrigin:string|null=null;
  // Every startLogin attempt carries a monotonic token. Async continuations
  // may only mutate state while their attempt is still the current attempt:
  // a superseded attempt must never revoke, buffer for, or unblock a newer
  // one, even when both share one login generation.
  #attemptSerial=0;
  #currentAttempt=0;
  // Which attempt owns the current `logging_in` projection: an aborting
  // attempt may only reset a login state that is still its own.
  #loggingAttempt=0;
  // The login generation at which the current `logged_in` was established: a
  // late logout response may only reset a login that predates its own call.
  #loggedGeneration=0;
  #earlyCompletions:Array<{notification:{method:string;params?:any};attempt:number}>=[];

  #refreshInFlight:{generation:number;promise:Promise<{accessToken:string}>}|null=null;
  #consumers=new Set<string>();
  #closed=false;
  constructor(options:{port:AuthOwnerPort;openExternal?:(url:string)=>Promise<void>|void;fetchImpl?:(url:string,init?:RequestInit)=>Promise<Response>;onStatus?:(status:AuthOwnerStatus)=>void}){
    this.#port=options.port;
    this.#openExternal=options.openExternal??(()=>{throw failure('auth_owner_open_external_unavailable');});
    this.#fetchImpl=options.fetchImpl??((url,init)=>fetch(url,init));
    this.#onStatus=options.onStatus;
    this.#port.addNotificationHandler(notification=>this.#handleNotification(notification));
  }
  status():Readonly<AuthOwnerStatus>{return Object.freeze({state:this.#state,account:this.#account});}
  /** Reconciles the real native login state (e.g. credentials persisted by a
   * previous worker incarnation) into the status projection. */
  async reconcileLoginState():Promise<Readonly<AuthOwnerStatus>>{
    if(this.#closed||!this.#port.alive())return this.status();
    if(this.#state!=='logged_out')return this.status();
    const generation=this.#loginGeneration;
    const account=await this.#readAccount();
    if(generation!==this.#loginGeneration)return this.status();
    if(account){this.#loggedGeneration=this.#loginGeneration;this.#setState('logged_in',account);}
    return this.status();
  }
  registerConsumer(id:string):void{this.#consumers.add(id);}
  releaseConsumer(id:string):void{this.#consumers.delete(id);}
  /** Removes attempt-generation registrations that can never matter again:
   * generations below the current login generation have no live projection
   * and no live continuation, so entries are dead weight only. */
  #sweepAttemptGenerations(){
    for(const [attempt,generation] of Array.from(this.#attemptGenerations)){
      if(generation<this.#loginGeneration)this.#attemptGenerations.delete(attempt);
    }
  }
  #setState(state:AuthOwnerLoginState,account?:AuthOwnerAccountProjection){
    this.#state=state;this.#account=account;
    this.#onStatus?.(this.status());
  }
  async #readAccount():Promise<AuthOwnerAccountProjection|undefined>{
    const response=await this.#port.call('account/read',{refreshToken:false});
    const account=response?.result?.account;
    if(!account||typeof account!=='object')return undefined;
    const projection:AuthOwnerAccountProjection={};
    if(typeof account.account_id==='string')projection.accountId=account.account_id;
    else if(typeof account.id==='string')projection.accountId=account.id;
    return projection;
  }
  async startLogin():Promise<{authUrl:string;loginId:string}>{
    if(this.#closed||!this.#port.alive())throw failure('auth_owner_unavailable');
    if(this.#currentAttempt!==0)throw failure('auth_owner_login_busy');
    const attempt=++this.#attemptSerial;
    this.#currentAttempt=attempt;
    const generation=this.#loginGeneration;
    const current=()=>this.#currentAttempt===attempt&&!this.#closed&&generation===this.#loginGeneration;
    try{
      // Reconcile the real native login state before issuing a new attempt.
      const account=await this.#readAccount();
      if(!current())throw failure('auth_owner_login_cancelled');
      if(account){this.#loggedGeneration=generation;this.#setState('logged_in',account);throw failure('auth_owner_already_logged_in');}
      const response=await this.#port.call('account/login/start',{type:'chatgpt'});
      if(!current())throw failure('auth_owner_login_cancelled');
      if(response?.error)throw failure(`auth_owner_login_start_failed:${response.error.message??'unknown'}`);
      const authUrl:string=response?.result?.authUrl,loginId:string=response?.result?.loginId;
      if(typeof authUrl!=='string'||typeof loginId!=='string')throw failure('auth_owner_login_start_failed:malformed');
      let audienceOrigin:string;
      try{audienceOrigin=new URL(authUrl).origin;}catch{throw failure('auth_owner_login_start_failed:malformed');}
      this.#validLoginIds.add(loginId);
      this.#loginAttempts.set(loginId,attempt);
      this.#attemptGenerations.set(attempt,generation);
      this.#audienceOrigin=audienceOrigin;
      this.#loggingAttempt=attempt;
      this.#setState('logging_in');
      // A completion notification can overtake the start response on the
      // wire; buffered entries belong to the waiting attempt and never
      // consume a later attempt's capacity.
      const early=this.#takeEarlyCompletions(attempt);
      this.#currentAttempt=0;
      // The status callback runs synchronously and may legitimately trigger a
      // close or revoke: re-check before any external side effect.
      if(this.#attemptSerial!==attempt||this.#closed||generation!==this.#loginGeneration){
        this.#validLoginIds.delete(loginId);
        this.#loginAttempts.delete(loginId);
        this.#attemptGenerations.delete(attempt);
        if(this.#state==='logging_in'&&(this.#closed||this.#loggingAttempt===attempt))this.#setState('logged_out');
        throw failure('auth_owner_login_cancelled');
      }
      try{await this.#openExternal(authUrl);}
      catch{
        // Only the still-current attempt may revoke on its own failure; a
        // superseded attempt (newer serial, revoked generation or closed
        // worker) must not cancel a newer login.
        if(this.#attemptSerial!==attempt||this.#closed||generation!==this.#loginGeneration)throw failure('auth_owner_login_cancelled');
        await this.#cancelUnderGeneration();throw failure('auth_owner_open_external_failed');
      }
      if(this.#attemptSerial!==attempt||this.#closed||generation!==this.#loginGeneration){
        if(this.#state==='logging_in'&&(this.#closed||this.#loggingAttempt===attempt))this.#setState('logged_out');
        throw failure('auth_owner_login_cancelled');
      }
      for(const notification of early)this.#handleNotification(notification);
      return {authUrl,loginId};
    }finally{
      if(this.#currentAttempt===attempt)this.#currentAttempt=0;
      this.#earlyCompletions=this.#earlyCompletions.filter(entry=>entry.attempt!==attempt);
    }
  }
  async #cancelUnderGeneration(){
    this.#loginGeneration++;this.#validLoginIds.clear();this.#loginAttempts.clear();this.#earlyCompletions.length=0;this.#audienceOrigin=null;
    this.#sweepAttemptGenerations();
    this.#loggingAttempt=0;
    this.#setState('logged_out');
    await this.#port.call('account/login/cancel').catch(()=>{});
  }
  async cancelLogin(){await this.#cancelUnderGeneration();}
  async logout(){
    const superseded=this.#loginGeneration;
    this.#loginGeneration++;this.#validLoginIds.clear();this.#loginAttempts.clear();this.#earlyCompletions.length=0;this.#loggingAttempt=0;
    this.#sweepAttemptGenerations();
    this.#credentialGeneration++;this.#snapshot=null;this.#audienceOrigin=null;
    this.#refreshInFlight=null;
    const response=await this.#port.call('account/logout',null);
    if(response?.error)throw failure(`auth_owner_logout_failed:${response.error.message??'unknown'}`);
    // A login that completed (loggedGeneration) or is still registering
    // (a newer attempt's generation) while the logout response was in flight
    // owns the projection now; only a pre-logout projection may be reset.
    const loggingOwnerGeneration=this.#state==='logging_in'?this.#attemptGenerations.get(this.#loggingAttempt)??0:0;
    if(this.#loggedGeneration<=superseded&&loggingOwnerGeneration<=superseded)this.#setState('logged_out');
  }
  #takeEarlyCompletions(attempt:number){
    const kept=this.#earlyCompletions.filter(entry=>entry.attempt===attempt).map(entry=>entry.notification);
    this.#earlyCompletions.length=0;
    return kept;
  }
  #handleNotification(notification:{method:string;params?:any}){
    if(notification.method!=='account/login/completed')return;
    const loginId=notification.params?.loginId;
    if(typeof loginId!=='string')return;
    if(!this.#validLoginIds.has(loginId)){
      // Hold a completion that may belong to an in-flight start whose response
      // has not registered its loginId yet; unknown ids drop after the match.
      const waiting=this.#currentAttempt;
      if(waiting!==0&&this.#earlyCompletions.length<4)this.#earlyCompletions.push({notification,attempt:waiting});
      return;
    }
    const generation=this.#loginGeneration;
    const owner=this.#loginAttempts.get(loginId)??0;
    this.#validLoginIds.delete(loginId);
    this.#loginAttempts.delete(loginId);
    if(notification.params?.success!==true){
      // Only the attempt that owns the current projection may reset it; a
      // failed concurrent login must not cancel a newer registered attempt.
      if(this.#loggingAttempt===owner){this.#setState('logged_out');this.#loggingAttempt=0;}
      this.#attemptGenerations.delete(owner);
      return;
    }
    this.#readAccount().then(account=>{
      // A cancel, logout or close that landed while the account read was in
      // flight invalidated this generation: the completion must never
      // re-project logged_in afterwards.
      if(this.#closed||generation!==this.#loginGeneration)return;
      this.#loggingAttempt=0;
      this.#loggedGeneration=generation;
      this.#setState('logged_in',account);
      this.#attemptGenerations.delete(owner);
    }).catch(()=>{
      if(this.#closed||generation!==this.#loginGeneration)return;
      this.#loggingAttempt=0;
      this.#loggedGeneration=generation;
      this.#setState('logged_in');
      this.#attemptGenerations.delete(owner);
    });
  }
  async authorizedFetch(request:AuthorizedFetchRequest):Promise<AuthorizedFetchResult>{
    if(this.#closed||!this.#port.alive())throw failure('credential_unavailable');
    const audience=this.#audienceOrigin;
    if(!audience)throw failure('credential_unavailable');
    let target:URL;
    try{target=new URL(request.url);}catch{throw failure('credential_target_rejected');}
    const loopback=target.hostname==='127.0.0.1'||target.hostname==='localhost'||target.hostname==='::1';
    if(target.protocol!=='https:'&&!loopback)throw failure('credential_target_rejected');
    if(target.origin!==audience)throw failure('credential_target_rejected');
    let snapshot=this.#snapshot&&this.#snapshot.generation===this.#credentialGeneration?this.#snapshot:null;
    if(!snapshot){
      // The single-flight refresh is bound to the credential generation that
      // started it: a joiner from another generation must never adopt an
      // older request's token as its own.
      let flight=this.#refreshInFlight;
      if(flight&&flight.generation!==this.#credentialGeneration)flight=null;
      if(!flight){
        const generation=this.#credentialGeneration;
        const promise=this.#port.call('xiaok/auth/snapshot',{refresh:false}).then(response=>{
          const token=response?.result?.accessToken;
          if(typeof token!=='string'||!token)throw failure('credential_unavailable');
          return {accessToken:token};
        });
        flight={generation,promise};
        this.#refreshInFlight=flight;
        void promise.catch(()=>{}).finally(()=>{if(this.#refreshInFlight===flight)this.#refreshInFlight=null;});
      }
      const fresh=await flight.promise;
      // A revocation that landed while the answer was in flight must
      // invalidate it here, before the token is ever retained for dispatch.
      if(flight.generation!==this.#credentialGeneration)throw failure('credential_stale');
      snapshot={accessToken:fresh.accessToken,generation:flight.generation};
      this.#snapshot=snapshot;
    }
    // Synchronous dispatch gate: no awaits between these checks and the fetch
    // call, so a revocation that already happened cannot be overtaken.
    if(this.#closed||!this.#port.alive()||this.#credentialGeneration!==this.#snapshot?.generation)throw failure('credential_stale');
    let response:Response;
    try{
      response=await this.#fetchImpl(request.url,{method:request.method??'GET',headers:{...request.headers,Authorization:`Bearer ${snapshot.accessToken}`},body:request.body,redirect:'manual'});
    }catch{throw failure('credential_dispatch_failed');}
    if(response.status>=300&&response.status<400)throw failure('credential_redirect_rejected');
    const headers:Record<string,string>={};
    for(const name of ['content-type','retry-after']){const value=response.headers.get(name);if(value)headers[name]=value;}
    const bodyText=await response.text();
    if(bodyText.length>FRAME_LIMIT)throw failure('auth_owner_frame_limit');
    return {status:response.status,headers,bodyText};
  }
  markClosed(){
    this.#closed=true;
    // Closing invalidates the login generation too: an in-flight start whose
    // awaits resume afterwards must not launch OAuth or open a browser.
    this.#loginGeneration++;this.#validLoginIds.clear();this.#loginAttempts.clear();this.#earlyCompletions.length=0;this.#currentAttempt=0;this.#loggingAttempt=0;
    this.#sweepAttemptGenerations();
    this.#credentialGeneration++;this.#snapshot=null;this.#audienceOrigin=null;
  }
}

class AuthOwnerWorker{
  readonly #child:ChildProcess;
  readonly #pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();
  readonly #notifiers=new Set<(notification:{method:string;params?:any})=>void>();
  readonly #writes=new Set<Promise<void>>();
  #buffer=Buffer.alloc(0);
  #exited=false;#exitCode:number|null=null;#exitSignal:string|null=null;
  #stdoutEnded=false;#stderrEnded=false;#frameError:string|undefined;
  readonly pid:number;
  constructor(binary:string,cwd:string,home:string){
    this.#child=spawn(binary,['--strict-config'],{cwd,detached:true,stdio:['pipe','pipe','pipe'],
      env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',CODEX_HOME:home,XIAOK_NATIVE_ISOLATED_V1:'1'}});
    this.pid=this.#child.pid!;
    this.#child.stdout?.on('data',(chunk:Buffer)=>{
      if(this.#frameError)return;
      const fed=AuthOwnerController.parseStreamChunk(this.#buffer,chunk);
      this.#buffer=Buffer.from(fed.buffer);
      if(fed.error){this.#frameError=fed.error;this.#failPending(failure(fed.error));return;}
      for(const line of fed.lines){
        let frame:any;
        try{frame=JSON.parse(line);}catch{this.#frameError='auth_owner_frame_parse';this.#failPending(failure(this.#frameError));return;}
        if(frame&&typeof frame.id==='number'&&this.#pending.has(frame.id)){
          const entry=this.#pending.get(frame.id)!;this.#pending.delete(frame.id);clearTimeout(entry.timer);entry.resolve(frame);
        }else if(frame&&typeof frame.method==='string')for(const notify of this.#notifiers)notify(frame);
      }
    });
    this.#child.stdout?.on('end',()=>{this.#stdoutEnded=true;});
    this.#child.stderr?.on('data',()=>{});
    this.#child.stderr?.on('end',()=>{this.#stderrEnded=true;});
    this.#child.on('exit',(code,signal)=>{this.#exited=true;this.#exitCode=code;this.#exitSignal=signal;});
    this.#child.stdin?.on('error',()=>{});
  }
  #failPending(error:Error){for(const entry of this.#pending.values()){clearTimeout(entry.timer);entry.reject(error);}this.#pending.clear();}
  #writePush(payload:string):Promise<void>{
    const tracked=new Promise<void>((resolve,reject)=>{
      const stdin=this.#child.stdin;
      if(!stdin||stdin.destroyed)return reject(failure('auth_owner_stdin_closed'));
      stdin.write(payload,error=>{if(error)reject(failure('auth_owner_stdin_write_failed'));else resolve();});
    });
    this.#writes.add(tracked);
    tracked.finally(()=>{this.#writes.delete(tracked);}).catch(()=>{});
    return tracked;
  }
  async waitForPendingDrain(timeoutMs:number):Promise<boolean>{
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline&&this.#pending.size>0)await new Promise(resolve=>setTimeout(resolve,25));
    return this.#pending.size===0;
  }
  call(method:string,params?:unknown,timeoutMs=RPC_TIMEOUT_MS):Promise<any>{
    return new Promise((resolve,reject)=>{
      if(this.#exited||!this.#child.stdin||this.#child.stdin.destroyed)return reject(failure('auth_owner_worker_closed'));
      const id=Math.floor(crypto.randomInt(1,2**31));
      const timer=setTimeout(()=>{this.#pending.delete(id);reject(failure('auth_owner_response_timeout'));},timeoutMs);
      this.#pending.set(id,{resolve,reject,timer});
      this.#writePush(JSON.stringify({id,method,params})+'\n').catch(error=>{clearTimeout(timer);this.#pending.delete(id);reject(error);});
    });
  }
  addNotificationHandler(handler:(notification:{method:string;params?:any})=>void){this.#notifiers.add(handler);}
  alive(){return !this.#exited;}
  failPendingPublic(){this.#failPending(failure('auth_owner_worker_closed'));}
  async initialize(appVersion:string){
    const initialized=await this.call('initialize',{clientInfo:{name:'xiaok-desktop-auth-owner',version:appVersion},capabilities:{experimentalApi:true}});
    if(initialized?.error)throw failure(`auth_owner_initialize_failed:${initialized.error.message??'unknown'}`);
    await this.#writePush(JSON.stringify({method:'initialized'})+'\n');
  }
  async waitForExit(timeoutMs:number):Promise<{code:number|null;signal:string|null}|null>{
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline){
      if(this.#exited)return {code:this.#exitCode,signal:this.#exitSignal};
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    return null;
  }
  async waitForPipeEnds(timeoutMs:number):Promise<boolean>{
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline){
      if(this.#stdoutEnded&&this.#stderrEnded)return true;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    return this.#stdoutEnded&&this.#stderrEnded;
  }
  async groupExited(timeoutMs=2000):Promise<boolean>{
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline){
      try{process.kill(-this.pid,0);await new Promise(resolve=>setTimeout(resolve,25));}
      catch{return true;}
    }
    try{process.kill(-this.pid,0);return false;}catch{return true;}
  }
  killGroup(signal:NodeJS.Signals){try{process.kill(-this.pid,signal);}catch{/* already gone */}}
  async endStdin(){await new Promise<void>(resolve=>{const stdin=this.#child.stdin;if(!stdin)return resolve();stdin.write('',()=>{stdin.end(()=>resolve());});});}
  async settleWrites(timeoutMs:number):Promise<boolean>{
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline&&this.#writes.size>0)await new Promise(resolve=>setTimeout(resolve,25));
    return this.#writes.size===0;
  }
  buildObservation(partial:Pick<AuthOwnerCloseObservation,'writesSettled'|'groupExited'|'homeIdentityOk'|'usedFallbackKill'|'timedOut'>):AuthOwnerCloseObservation{
    const finished=AuthOwnerController.finishParse(this.#buffer);
    return {...partial,parserSettled:!this.#frameError&&!finished.error,exitCode:this.#exitCode,exitSignal:this.#exitSignal,stdoutEnded:this.#stdoutEnded,stderrEnded:this.#stderrEnded};
  }
}

function assertHome(home:string):{dev:number;ino:number}{
  const stats=fs.lstatSync(home);
  if(stats.isSymbolicLink()||!stats.isDirectory())throw failure('auth_owner_home_replaced');
  if(stats.uid!==process.getuid?.()||((stats.mode&0o077)!==0))throw failure('auth_owner_home_replaced');
  return {dev:stats.dev,ino:stats.ino};
}

export async function openAuthOwner(options:AuthOwnerOptions):Promise<AuthOwnerHandle>{
  const binaryPath=options.authOwnerBinary??(options.resourcesRoot?path.join(options.resourcesRoot,'continuity-auth',`${QUALIFIED_BINARY.platform}-${QUALIFIED_BINARY.arch}`,'codex-app-server'):null);
  if(!binaryPath)throw failure('auth_owner_binary_unqualified');
  const resolvedBinary=path.resolve(binaryPath);
  const verification=verifyAuthOwnerBinary(resolvedBinary);
  if(!verification.ok)throw failure(verification.reason!);
  const dataRootRealpath=fs.realpathSync(options.dataRoot);
  const binding=crypto.createHash('sha256').update(JSON.stringify({profileId:options.profileId,dataRootRealpath,kind:'production'})).digest('hex');
  const home=path.join(options.stateRoot,'auth-owner',binding);
  if(!fs.existsSync(home))fs.mkdirSync(home,{recursive:true,mode:0o700});
  const identity=assertHome(home);
  const configPath=path.join(home,'config.toml');
  if(fs.existsSync(configPath)){
    if(fs.readFileSync(configPath,'utf8')!==EXPECTED_CONFIG_BYTES)throw failure('auth_owner_config_drift');
  }else{
    fs.writeFileSync(configPath,EXPECTED_CONFIG_BYTES,{mode:0o600});
  }
  // The pinned auth-owner role requires the process cwd to be exactly
  // $CODEX_HOME/workspace; the vault birth accepts it as an empty 0700 dir.
  const workspace=path.join(home,'workspace');
  if(!fs.existsSync(workspace))fs.mkdirSync(workspace,{mode:0o700});
  const workspaceStats=fs.lstatSync(workspace);
  if(workspaceStats.isSymbolicLink()||!workspaceStats.isDirectory()||(workspaceStats.mode&0o077)!==0||fs.readdirSync(workspace).length!==0)throw failure('auth_owner_home_replaced');
  const recheck=assertHome(home);
  if(recheck.dev!==identity.dev||recheck.ino!==identity.ino)throw failure('auth_owner_home_replaced');
  const worker=new AuthOwnerWorker(resolvedBinary,workspace,home);
  let settlement:AuthOwnerCloseSettlement|null=null;
  const controller=new AuthOwnerController({
    port:{call:(method,params,timeout)=>worker.call(method,params,timeout),addNotificationHandler:handler=>worker.addNotificationHandler(handler),alive:()=>worker.alive()},
    openExternal:options.openExternal??(async url=>{
      const electron=await import('electron') as typeof import('electron');
      await electron.shell.openExternal(url);
    }),
    onStatus:options.onStatus,
  });
  try{await worker.initialize(options.appVersion??'0');}
  catch(error){worker.killGroup('SIGKILL');controller.markClosed();throw error;}
  let closeInFlight:Promise<AuthOwnerCloseSettlement>|null=null;
  const closeAndDrain=():Promise<AuthOwnerCloseSettlement>=>{
    if(settlement)return Promise.resolve(settlement);
    closeInFlight??=(async():Promise<AuthOwnerCloseSettlement>=>{
      controller.markClosed();
      // In-flight RPCs settle on their own or are classified as closed once
      // their timeout budget elapses; EOF then happens only after writes settle.
      await worker.waitForPendingDrain(3000);
      worker.failPendingPublic();
      const writesSettled=await worker.settleWrites(5000);
      // A jammed stdin must not block the close forever: a bounded end attempt
      // falls through to the signal fallback.
      const stdinEnded=await Promise.race([worker.endStdin().then(()=>true),new Promise<boolean>(resolve=>setTimeout(()=>resolve(false),5000))]);
      let exitResult=stdinEnded?await worker.waitForExit(10000):null;
      let usedFallbackKill=false,timedOut=!stdinEnded;
      if(!exitResult){
        // Any fallback signal already voids the graceful drain.
        usedFallbackKill=true;
        worker.killGroup('SIGTERM');
        exitResult=await worker.waitForExit(1000);
        if(!exitResult){
          worker.killGroup('SIGKILL');
          exitResult=await worker.waitForExit(5000);
          if(!exitResult)timedOut=true;
        }
      }
      const pipesEnded=await worker.waitForPipeEnds(5000);
      if(!pipesEnded)timedOut=true;
      const groupExited=await worker.groupExited(2000);
      let homeIdentityOk=true;
      try{const after=assertHome(home);homeIdentityOk=after.dev===identity.dev&&after.ino===identity.ino;}catch{homeIdentityOk=false;}
      const observation=worker.buildObservation({writesSettled,groupExited,homeIdentityOk,usedFallbackKill,timedOut});
      settlement=AuthOwnerController.settleClose(observation);
      return settlement;
    })();
    return closeInFlight;
  };
  return {controller,closeAndDrain,readClosure:()=>({settlement,pid:worker.pid,testOnly:false as const})};
}
