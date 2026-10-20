// Test-only AuthOwner fixture: spawns the real qualified binary with the
// synthetic-issuer environment that production never sets. This module lives
// in the test tree; production code under desktop/electron must never import
// it (asserted by context-continuity-auth-owner.test.ts). The credential home
// uses a fixture namespace disjoint from the production auth-owner namespace.
import {spawn, type ChildProcess} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {AuthOwnerController, type AuthOwnerPort, verifyAuthOwnerBinary} from '../../../electron/context-continuity/auth-owner.js';

export interface IssuerRequest {method: string; url: string; authorization?: string; body: string}
export interface SyntheticIssuer {
  origin: string;
  requests: IssuerRequest[];
  tokens: {id_token: string; access_token: string; refresh_token: string; token_type: string; expires_in: number};
  redirectPathFor: (path: string) => string | undefined;
  setRedirectTarget: (path: string, target: string) => void;
  close(): Promise<void>;
}
export function tokensFor(label='fixture'){
  const claims={email:'synthetic@example.invalid',sub:`synthetic-user-${label}`,exp:Math.floor(Date.now()/1000)+3600,
    'https://api.openai.com/auth':{chatgpt_account_id:`synthetic-account-${label}`,chatgpt_user_id:`synthetic-user-${label}`,chatgpt_plan_type:'plus'}};
  const jwt=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
  return {id_token:`${jwt({alg:'none'})}.${jwt(claims)}.SYNTHETIC_SIGNATURE`,
    access_token:`SYNTHETIC_OAUTH_ACCESS_CANARY_${label}`,refresh_token:`SYNTHETIC_OAUTH_REFRESH_CANARY_${label}`,token_type:'Bearer',expires_in:3600};
}
export async function startSyntheticIssuer(label='fixture'):Promise<SyntheticIssuer>{
  const requests:IssuerRequest[]=[];const tokens=tokensFor(label);
  // The accounts/check list must include the account the tokens claim, or the
  // native rejects the login completion (xiaok_auth_login_failed).
  const claimedAccount=`synthetic-account-${label}`;
  const redirects=new Map<string,string>();
  const server=http.createServer({maxHeaderSize:128*1024},async(req,res)=>{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);
    const body=Buffer.concat(chunks).toString();
    requests.push({method:req.method!,url:req.url!,authorization:req.headers.authorization,body});
    const target=redirects.get(req.url!);
    if(target){res.writeHead(302,{location:target});res.end();return;}
    if(req.method==='POST'&&req.url==='/oauth/token'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(tokens));return;}
    if(req.method==='POST'&&req.url==='/oauth/revoke'){res.writeHead(200);res.end('{}');return;}
    if(req.method==='GET'&&req.url==='/backend-api/wham/accounts/check'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({accounts:[{id:claimedAccount,workspace_backend_origin:'https://chatgpt.com',account_routing_override:'NO_CONSTRAINT'}]}));return;}
    if(req.method==='GET'&&req.url==='/backend-api/wham/config/bundle'){res.writeHead(200,{'content-type':'application/json'});res.end('{}');return;}
    if(req.method==='GET'&&req.url==='/backend-api/wham/settings/user'){res.writeHead(200,{'content-type':'application/json'});res.end('{"commit_attribution_enabled":false}');return;}
    if(req.method==='GET'&&req.url==='/backend-api/wham/echo'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,sawAuthorization:!!req.headers.authorization}));return;}
    res.writeHead(404);res.end();
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {origin:`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`,requests,tokens,
    redirectPathFor:search=>redirects.get(search),setRedirectTarget:(search,target)=>redirects.set(search,target),
    close:()=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());})};
}
export interface FixtureWorker {
  port: AuthOwnerPort;
  controller: AuthOwnerController;
  home: string;
  child: ChildProcess;
  stderrText(): string;
  framesRef():unknown[];
  setOpenExternal(fn:(url:string)=>Promise<void>|void):void;
  injectNotification(notification: {method: string; params?: unknown}): void;
  close(): Promise<{code: number | null; signal: string | null}>;
}
export async function openFixtureAuthOwner(options:{binary:string; stateRoot:string; profileId:string; dataRoot:string; issuerOrigin:string; onStatus?:(status:{state:string;account?:{accountId?:string}})=>void}):Promise<FixtureWorker>{
  const verification=verifyAuthOwnerBinary(options.binary);
  if(!verification.ok)throw new Error(`fixture_binary_unqualified:${verification.reason}`);
  const binding=crypto.createHash('sha256').update(JSON.stringify({profileId:options.profileId,dataRootRealpath:fs.realpathSync(options.dataRoot),kind:'fixture'})).digest('hex');
  const home=path.join(options.stateRoot,'auth-owner-fixture',binding);
  fs.mkdirSync(home,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(home,'config.toml'),`chatgpt_base_url = "${options.issuerOrigin}/backend-api"\ncli_auth_credentials_store = "file"\n[features]\nshell_snapshot = false\n`,{mode:0o600});
  // The pinned role requires cwd == $CODEX_HOME/workspace.
  const workspace=path.join(home,'workspace');
  fs.mkdirSync(workspace,{mode:0o700});
  const child=spawn(options.binary,['--strict-config'],{cwd:workspace,detached:true,stdio:['pipe','pipe','pipe'],
    env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',CODEX_HOME:home,XIAOK_NATIVE_ISOLATED_V1:'1',
      CODEX_APP_SERVER_LOGIN_ISSUER:options.issuerOrigin,
      CODEX_REFRESH_TOKEN_URL_OVERRIDE:`${options.issuerOrigin}/oauth/token`,
      CODEX_REVOKE_TOKEN_URL_OVERRIDE:`${options.issuerOrigin}/oauth/revoke`}});
  let stderr='';child.stderr.setEncoding('utf8').on('data',chunk=>{stderr+=chunk;});
  let exited=false,exitCode:number|null=null,exitSignal:string|null=null;
  child.on('exit',(code,signal)=>{exited=true;exitCode=code;exitSignal=signal;});
  const writes=new Set<unknown>();let writeFailed=false;
  let buffer=Buffer.alloc(0);const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();
  const frames:unknown[]=[];
  const notifiers=new Set<(notification:{method:string;params?:any})=>void>();
  const failFrame=(error:Error)=>{for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(error);}pending.clear();};
  child.stdout.on('data',(bytes:Buffer)=>{
    try{
      const fed=AuthOwnerController.parseStreamChunk(buffer,bytes);
      buffer=fed.buffer;
      if(fed.error)throw new Error(fed.error);
      for(const line of fed.lines){const frame=JSON.parse(line);frames.push(frame);
        if(frame.id!==undefined&&pending.has(frame.id)){const entry=pending.get(frame.id)!;pending.delete(frame.id);clearTimeout(entry.timer);entry.resolve(frame);}
        else if(frame.method)for(const notify of notifiers)notify(frame);}
    }catch(error){failFrame(error as Error);}
  });
  let nextId=0;
  const call=(method:string,params:unknown,timeoutMs=15000)=>new Promise<any>((resolve,reject)=>{
    if(exited||writeFailed||child.stdin.destroyed)return reject(new Error('fixture_worker_closed'));
    const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`fixture_response_timeout:${method}:${stderr.slice(-400)}`));},timeoutMs);
    pending.set(id,{resolve,reject,timer});
    const payload=JSON.stringify({id,method,params})+'\n';
    child.stdin.write(payload,error=>{if(error){writeFailed=true;clearTimeout(timer);pending.delete(id);reject(new Error('fixture_stdin_write_failed'));}});
  });
  const port:AuthOwnerPort={call,addNotificationHandler:handler=>notifiers.add(handler),alive:()=>!exited};
  const initialized=await call('initialize',{clientInfo:{name:'xiaok-desktop-auth-owner-fixture',version:'0'},capabilities:{experimentalApi:true}});
  if(initialized.error)throw new Error(`fixture_initialize_failed:${JSON.stringify(initialized.error)}`);
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('fixture_stdin_write_failed')),5000);child.stdin.write(JSON.stringify({method:'initialized'})+'\n',()=>{clearTimeout(timer);resolve();});});
  let currentExternal:(url:string)=>Promise<void>|void=()=>{};
  const controller=new AuthOwnerController({port,openExternal:url=>currentExternal(url),onStatus:options.onStatus});
  return {port,controller,home,child,stderrText:()=>stderr,framesRef:()=>frames,setOpenExternal:(fn:(url:string)=>Promise<void>|void)=>{currentExternal=fn;},
    injectNotification:notification=>{for(const notify of notifiers)notify(notification);},
    close:()=>new Promise(resolve=>{
      (async()=>{
        for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(new Error('fixture_worker_closed'));}pending.clear();
        child.stdin.write('',()=>{child.stdin.end();});
      })();
      const done=()=>resolve({code:exitCode,signal:exitSignal});
      if(exited)return done();
      child.once('exit',done);
      setTimeout(()=>{try{process.kill(-child.pid!,'SIGKILL');}catch{}setTimeout(done,500);},8000).unref();
    })};
}
export function temporaryStateRoot(prefix='xiaok-auth-owner-fixture-'){return fs.mkdtempSync(path.join(os.tmpdir(),prefix));}
