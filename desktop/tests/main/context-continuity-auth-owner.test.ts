// @vitest-environment node
// Real-entry AuthOwner factory qualification and contract tests per design
// 2026-10-19-context-continuity-main-auth-owner-v3 (three-seat consensus
// original-main-auth-owner-design-v3). Synthetic-issuer flows run only
// through the test-tree fixture; production openAuthOwner never accepts
// issuer/env overrides.
import {afterEach,expect,it} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {openAuthOwner,AuthOwnerController,verifyAuthOwnerBinary,type AuthOwnerCloseObservation} from '../../electron/context-continuity/auth-owner.js';
import {openFixtureAuthOwner,startSyntheticIssuer,temporaryStateRoot,type FixtureWorker,type SyntheticIssuer} from './helpers/auth-owner-fixture.js';

const execFileAsync=promisify(execFile);
const binary=process.env.XIAOK_AUTH_OWNER_TEST_BINARY;
const native=it.skipIf(!binary||process.platform!=='darwin'||process.arch!=='arm64');
const cleanup:Array<()=>unknown|Promise<unknown>>=[];
afterEach(async()=>{for(const action of cleanup.splice(0).reverse())await action();});
const sha256=(file:string)=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function temporary(prefix='xiaok-auth-owner-test-'){const root=fs.mkdtempSync(path.join(os.tmpdir(),prefix));cleanup.push(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:3}));return root;}
async function copyBinaryMutation(mutate:(target:string)=>void){
  const root=temporary();const target=path.join(root,'codex-app-server');
  fs.copyFileSync(binary!,target);fs.chmodSync(target,0o700);mutate(target);return target;
}
async function holdPorts(ports:number[]){
  const sockets=new Set<net.Socket>();
  const servers=ports.map(()=>net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));}));
  await Promise.all(servers.map((server,index)=>new Promise<void>(resolve=>server.listen(ports[index],'127.0.0.1',resolve))));
  cleanup.push(async()=>{
    for(const socket of sockets)socket.destroy();
    await Promise.all(servers.map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));
  });
  return servers;
}
async function startAttacker(){
  const seen:{method:string;url:string;authorization?:string}[]=[];
  const server=http.createServer((req,res)=>{seen.push({method:req.method!,url:req.url!,authorization:req.headers.authorization});res.writeHead(200);res.end('attacker-ack');});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  cleanup.push(()=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());}));
  return {origin:`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`,seen};
}
async function waitFor<T>(predicate:()=>T|undefined,timeoutMs=10000,message='condition'):Promise<T>{
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){const value=predicate();if(value!==undefined)return value;await new Promise(resolve=>setTimeout(resolve,25));}
  throw new Error(`timeout waiting for ${message}`);
}
async function driveBrowserLogin(worker:FixtureWorker,authUrl:string){
  const auth=new URL(authUrl),callback=new URL(auth.searchParams.get('redirect_uri')!);
  callback.searchParams.set('state',auth.searchParams.get('state')!);callback.searchParams.set('code','synthetic-authorization-code');
  const response=await fetch(callback,{redirect:'manual',signal:AbortSignal.timeout(5000)});
  if(response.headers.get('location'))await fetch(response.headers.get('location')!,{redirect:'manual',signal:AbortSignal.timeout(5000)}).then(page=>page.text());
  return waitFor(()=>worker.controller.status().state==='logged_in'?worker.controller.status():undefined,10000,'logged_in');
}
const settle=(partial:Partial<AuthOwnerCloseObservation>):AuthOwnerCloseObservation=>({exitCode:0,exitSignal:null,stdoutEnded:true,stderrEnded:true,writesSettled:true,parserSettled:true,groupExited:true,homeIdentityOk:true,usedFallbackKill:false,timedOut:false,...partial});

it('export surface is exactly the declared production entries',async()=>{
  const module=await import('../../electron/context-continuity/auth-owner.js');
  expect(Object.keys(module).sort()).toEqual(['AuthOwnerController','openAuthOwner','verifyAuthOwnerBinary'].sort());
});
it('close settlement requires exit0, no signal, drained pipes, settled parser and group exit',()=>{
  expect(AuthOwnerController.settleClose(settle({}))).toBe('closed');
  expect(AuthOwnerController.settleClose(settle({exitCode:1}))).toBe('close_failed');
  expect(AuthOwnerController.settleClose(settle({exitSignal:'SIGKILL',usedFallbackKill:true}))).toBe('close_unknown');
  expect(AuthOwnerController.settleClose(settle({exitSignal:'SIGTERM',usedFallbackKill:true}))).toBe('close_unknown');
  expect(AuthOwnerController.settleClose(settle({groupExited:false,timedOut:true}))).toBe('close_unknown');
  expect(AuthOwnerController.settleClose(settle({stdoutEnded:false}))).toBe('close_failed');
  expect(AuthOwnerController.settleClose(settle({stderrEnded:false}))).toBe('close_failed');
  expect(AuthOwnerController.settleClose(settle({writesSettled:false}))).toBe('close_failed');
  expect(AuthOwnerController.settleClose(settle({parserSettled:false}))).toBe('close_failed');
  expect(AuthOwnerController.settleClose(settle({homeIdentityOk:false}))).toBe('close_failed');
  expect(AuthOwnerController.settleClose(settle({exitCode:1,groupExited:true}))).toBe('close_failed');
  expect(AuthOwnerController.settleClose(settle({exitCode:0,exitSignal:null,groupExited:false}))).toBe('close_unknown');
});
it('stream framing splits chunked lines, rejects oversize lines and buffers, and reports EOF residual',()=>{
  const line=JSON.stringify({id:1,payload:'frame-split-marker'})+'\n';
  const first=AuthOwnerController.parseStreamChunk(Buffer.alloc(0),Buffer.from(line.slice(0,10)));
  expect(first.lines).toEqual([]);
  const second=AuthOwnerController.parseStreamChunk(first.buffer,Buffer.from(line.slice(10)+JSON.stringify({method:'n'})+'\npart'));
  expect(second.lines.map(value=>JSON.parse(value)).map(frame=>({id:frame.id,method:frame.method}))).toEqual([{id:1},{method:'n'}]);
  expect(second.buffer.toString()).toBe('part');
  expect(AuthOwnerController.finishParse(second.buffer).error).toBe('auth_owner_frame_residual');
  expect(AuthOwnerController.finishParse(Buffer.alloc(0)).error).toBeUndefined();
  const oversize=AuthOwnerController.parseStreamChunk(Buffer.alloc(0),Buffer.concat([Buffer.alloc(1024*1024+1),Buffer.from('\n')]));
  expect(oversize.error).toBe('auth_owner_frame_limit');
  const pendingOversize=AuthOwnerController.parseStreamChunk(Buffer.alloc(0),Buffer.alloc(1024*1024+1));
  expect(pendingOversize.error).toBe('auth_owner_frame_limit');
});
it('binary qualification fails closed for wrong hash, symlink, wrong basename and unqualified platforms',async()=>{
  const wrongHash=await copyBinaryMutation(target=>{const bytes=fs.readFileSync(target);bytes[bytes.length-1]^=0xff;fs.writeFileSync(target,bytes);});
  expect(verifyAuthOwnerBinary(wrongHash)).toMatchObject({ok:false,reason:'auth_owner_binary_unqualified'});
  const root=temporary();fs.mkdirSync(path.join(root,'payload'));
  const real=path.join(root,'payload','codex-app-server');fs.copyFileSync(binary!,real);fs.chmodSync(real,0o700);
  const link=path.join(root,'codex-app-server');fs.symlinkSync('payload/codex-app-server',link);
  expect(verifyAuthOwnerBinary(link)).toMatchObject({ok:false,reason:'auth_owner_binary_unqualified'});
  const wrongName=await copyBinaryMutation(()=>{});
  const renamed=path.join(path.dirname(wrongName),'other-name');fs.renameSync(wrongName,renamed);
  expect(verifyAuthOwnerBinary(renamed)).toMatchObject({ok:false,reason:'auth_owner_binary_unqualified'});
  expect(verifyAuthOwnerBinary('codex-app-server')).toMatchObject({ok:false,reason:'auth_owner_binary_unqualified'});
  expect(verifyAuthOwnerBinary('../codex-app-server')).toMatchObject({ok:false,reason:'auth_owner_binary_unqualified'});
  expect(AuthOwnerController.assertCloseSettlement('closed')).toBeUndefined();
  expect(()=>AuthOwnerController.assertCloseSettlement('close_unknown')).toThrow('auth_owner_close_close_unknown');
  expect(()=>AuthOwnerController.assertCloseSettlement('close_failed')).toThrow('auth_owner_close_close_failed');
  const platform=Object.getOwnPropertyDescriptor(process,'platform')!;
  const arch=Object.getOwnPropertyDescriptor(process,'arch')!;
  Object.defineProperty(process,'platform',{value:'win32'});
  Object.defineProperty(process,'arch',{value:'x64'});
  try{expect(verifyAuthOwnerBinary(real)).toMatchObject({ok:false,reason:'auth_owner_platform_unqualified'});}
  finally{Object.defineProperty(process,'platform',platform);Object.defineProperty(process,'arch',arch);}
  expect(verifyAuthOwnerBinary(real)).toEqual({ok:true,reason:undefined});
});
it('production tree never references issuer overrides or the test fixture',async()=>{
  const forbidden=['CODEX_APP_SERVER_LOGIN_ISSUER','CODEX_REFRESH_TOKEN_URL_OVERRIDE','CODEX_REVOKE_TOKEN_URL_OVERRIDE','chatgpt_base_url','auth-owner-fixture'];
  const walk=(directory:string):string[]=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(directory,entry.name)):[path.join(directory,entry.name)]);
  for(const file of walk(path.join(import.meta.dirname,'..','..','electron'))){
    if(!/\.(ts|cjs|mjs|json)$/.test(file))continue;
    const text=fs.readFileSync(file,'utf8');
    for(const marker of forbidden)expect(text.includes(marker),`${file} must not contain ${marker}`).toBe(false);
  }
});
it('packaging maps the auth binary resource and never packages the test tree',()=>{
  const builder=JSON.parse(fs.readFileSync(path.join(import.meta.dirname,'..','..','electron-builder.json'),'utf8'));
  const resources=JSON.stringify(builder.extraResources);
  expect(resources.includes('continuity-auth')).toBe(true);
  expect(resources.includes('tests')).toBe(false);
  const verifier=fs.readFileSync(path.join(import.meta.dirname,'..','..','scripts','verify-packaged-continuity-resources.cjs'),'utf8');
  expect(verifier.includes('continuity-auth')).toBe(true);
});

native('production factory rejects unqualified binaries without spawning',async()=>{
  const stateRoot=temporary();
  const wrongHash=await copyBinaryMutation(target=>{const bytes=fs.readFileSync(target);bytes[bytes.length-1]^=0xff;fs.writeFileSync(target,bytes);});
  await expect(openAuthOwner({stateRoot,profileId:'profile_a',dataRoot:stateRoot,authOwnerBinary:wrongHash})).rejects.toThrow('auth_owner_binary_unqualified');
  // A relative path qualifies a different file than it would execute.
  await expect(openAuthOwner({stateRoot,profileId:'profile_a2',dataRoot:stateRoot,authOwnerBinary:'codex-app-server'})).rejects.toThrow('auth_owner_binary_unqualified');
  const servicesSource=fs.readFileSync(path.join(import.meta.dirname,'..','..','electron','desktop-services.ts'),'utf8');
  const disposeGate=servicesSource.indexOf('AuthOwnerController.assertCloseSettlement(settlement)');
  expect(disposeGate).toBeGreaterThan(-1);
  expect(disposeGate).toBeLessThan(servicesSource.indexOf('await contextContinuity.close();',disposeGate));
},30000);
native('production factory verifies exact home config bytes and refuses drift on later births',async()=>{
  const stateRoot=temporary();
  const opened=await openAuthOwner({stateRoot,profileId:'profile_b',dataRoot:stateRoot,authOwnerBinary:binary!,appVersion:'test'});
  expect(opened.readClosure().pid).toBeTruthy();
  const homeRoot=path.join(stateRoot,'auth-owner');
  const configPath=path.join(homeRoot,fs.readdirSync(homeRoot)[0],'config.toml');
  expect(fs.readFileSync(configPath,'utf8')).toBe('cli_auth_credentials_store = "file"\n[features]\nshell_snapshot = false\n');
  await opened.closeAndDrain();
  fs.writeFileSync(configPath,'cli_auth_credentials_store = "keychain"\n');
  await expect(openAuthOwner({stateRoot,profileId:'profile_b',dataRoot:stateRoot,authOwnerBinary:binary!})).rejects.toThrow('auth_owner_config_drift');
},45000);
native('production worker spawns with fixed env, initializes, reports logged-out and closes on real EOF exit0',async()=>{
  const stateRoot=temporary();const openedUrls:string[]=[];
  const opened=await openAuthOwner({stateRoot,profileId:'profile_c',dataRoot:stateRoot,authOwnerBinary:binary!,appVersion:'test',openExternal:url=>{openedUrls.push(url);}});
  const closure=opened.readClosure();expect(closure.pid).toBeTruthy();
  const {stdout}=await execFileAsync('ps',['eww',String(closure.pid)]);
  expect(stdout).toContain(`CODEX_HOME=`);
  expect(stdout).not.toContain('CODEX_APP_SERVER_LOGIN_ISSUER');
  expect(stdout).not.toContain('CODEX_REFRESH_TOKEN_URL_OVERRIDE');
  expect(stdout).not.toContain('CODEX_REVOKE_TOKEN_URL_OVERRIDE');
  expect(opened.controller.status().state).toBe('logged_out');
  const attempt=await opened.controller.startLogin();
  expect(new URL(attempt.authUrl).protocol).toBe('https:');
  expect(openedUrls).toEqual([attempt.authUrl]);
  expect(opened.controller.status().state).toBe('logging_in');
  await opened.controller.cancelLogin();
  expect(opened.controller.status().state).toBe('logged_out');
  expect(await opened.closeAndDrain()).toBe('closed');
  expect(()=>process.kill(closure.pid!,0)).toThrow();
  expect(()=>process.kill(-closure.pid!,0)).toThrow();
},45000);
native('login start surfaces the fixed error when both callback ports are occupied',async()=>{
  await holdPorts([1455,1457]);
  const stateRoot=temporary();
  const opened=await openAuthOwner({stateRoot,profileId:'profile_d',dataRoot:stateRoot,authOwnerBinary:binary!,appVersion:'test',openExternal:()=>{}});
  await expect(opened.controller.startLogin()).rejects.toThrow(/already in use|AddrInUse|login/);
  expect(opened.controller.status().state).toBe('logged_out');
  expect(await opened.closeAndDrain()).toBe('closed');
},60000);
native('SIGSTOP worker makes production close settle close_unknown via the fallback kill',async()=>{
  const stateRoot=temporary();
  const opened=await openAuthOwner({stateRoot,profileId:'profile_e',dataRoot:stateRoot,authOwnerBinary:binary!,appVersion:'test'});
  const pid=opened.readClosure().pid!;
  process.kill(pid,'SIGSTOP');
  expect(await opened.closeAndDrain()).toBe('close_unknown');
  expect(()=>process.kill(pid,0)).toThrow();
},30000);

native('fixture synthetic login completes, authorizedFetch serves only the native audience, and logout invalidates',async()=>{
  const stateRoot=temporaryStateRoot();cleanup.push(()=>fs.rmSync(stateRoot,{recursive:true,force:true}));
  const issuer:SyntheticIssuer=await startSyntheticIssuer();cleanup.push(()=>issuer.close());
  const worker=await openFixtureAuthOwner({binary:binary!,stateRoot,profileId:'profile_f',dataRoot:stateRoot,issuerOrigin:issuer.origin});
  cleanup.push(()=>worker.close());
  expect(worker.controller.status().state).toBe('logged_out');
  const attempt=await worker.controller.startLogin();
  expect(new URL(attempt.authUrl).origin).toBe(issuer.origin);
  const status=await driveBrowserLogin(worker,attempt.authUrl);
  expect(status.state).toBe('logged_in');
  expect(JSON.stringify(status)).not.toContain('CANARY');
  const result=await worker.controller.authorizedFetch({url:`${issuer.origin}/backend-api/wham/echo`});
  expect(result.status).toBe(200);
  expect(result.bodyText).toContain('"ok":true');
  const echo=issuer.requests.find(request=>request.url==='/backend-api/wham/echo');
  expect(echo?.authorization).toContain('Bearer ');
  expect(worker.stderrText()).not.toContain('CANARY');
  await worker.controller.logout();
  expect(worker.controller.status().state).toBe('logged_out');
  await expect(fs.promises.access(path.join(worker.home,'auth.json'))).rejects.toThrow();
  await expect(worker.controller.authorizedFetch({url:`${issuer.origin}/backend-api/wham/echo`})).rejects.toThrow('credential_unavailable');
},60000);
native('authorizedFetch never sends credentials to an unqualified target and never follows redirects',async()=>{
  const stateRoot=temporaryStateRoot();cleanup.push(()=>fs.rmSync(stateRoot,{recursive:true,force:true}));
  const issuer=await startSyntheticIssuer();cleanup.push(()=>issuer.close());
  const attacker=await startAttacker();
  const worker=await openFixtureAuthOwner({binary:binary!,stateRoot,profileId:'profile_g',dataRoot:stateRoot,issuerOrigin:issuer.origin});
  cleanup.push(()=>worker.close());
  const attempt=await worker.controller.startLogin();
  await driveBrowserLogin(worker,attempt.authUrl);
  await expect(worker.controller.authorizedFetch({url:`${attacker.origin}/steal`})).rejects.toThrow('credential_target_rejected');
  expect(attacker.seen).toEqual([]);
  issuer.setRedirectTarget('/backend-api/wham/redirect',`${attacker.origin}/bounce`);
  await expect(worker.controller.authorizedFetch({url:`${issuer.origin}/backend-api/wham/redirect`})).rejects.toThrow('credential_redirect_rejected');
  expect(attacker.seen).toEqual([]);
  const after=issuer.requests.filter(request=>request.url.startsWith('/backend-api'));
  expect(after.length).toBeGreaterThanOrEqual(1);
},60000);
native('login generation drops cancelled, unknown and post-logout completions',async()=>{
  const stateRoot=temporaryStateRoot();cleanup.push(()=>fs.rmSync(stateRoot,{recursive:true,force:true}));
  const issuer=await startSyntheticIssuer();cleanup.push(()=>issuer.close());
  const worker=await openFixtureAuthOwner({binary:binary!,stateRoot,profileId:'profile_h',dataRoot:stateRoot,issuerOrigin:issuer.origin});
  cleanup.push(()=>worker.close());
  worker.injectNotification({method:'account/login/completed',params:{loginId:'unknown-login',success:true}});
  expect(worker.controller.status().state).toBe('logged_out');
  const attempt=await worker.controller.startLogin();
  expect(worker.controller.status().state).toBe('logging_in');
  await worker.controller.cancelLogin();
  worker.injectNotification({method:'account/login/completed',params:{loginId:attempt.loginId,success:true}});
  expect(worker.controller.status().state).toBe('logged_out');
  const second=await worker.controller.startLogin();
  await worker.controller.logout();
  worker.injectNotification({method:'account/login/completed',params:{loginId:second.loginId,success:true}});
  expect(worker.controller.status().state).toBe('logged_out');
},45000);
native('a completion already past its sync check cannot outpace a later cancel or logout',async()=>{
  const stateRoot=temporaryStateRoot();cleanup.push(()=>fs.rmSync(stateRoot,{recursive:true,force:true}));
  const issuer=await startSyntheticIssuer();cleanup.push(()=>issuer.close());
  const worker=await openFixtureAuthOwner({binary:binary!,stateRoot,profileId:'profile_j',dataRoot:stateRoot,issuerOrigin:issuer.origin});
  cleanup.push(()=>worker.close());
  for(const revocation of ['cancel','logout'] as const){
    if(worker.controller.status().state!=='logged_out')throw new Error('precondition');
    const attempt=await worker.controller.startLogin();
    let releaseRead:()=>void=()=>{};
    const gate=new Promise<void>(resolve=>{releaseRead=resolve;});
    const originalCall=worker.port.call.bind(worker.port);
    worker.port.call=(method,params,timeout)=>{
      const started=originalCall(method,params,timeout);
      return method==='account/read'?gate.then(()=>started):started;
    };
    // The completion passes the synchronous loginId check; its account read
    // is then held while the revocation lands.
    worker.injectNotification({method:'account/login/completed',params:{loginId:attempt.loginId,success:true}});
    await new Promise(resolve=>setTimeout(resolve,150));
    if(revocation==='cancel')await worker.controller.cancelLogin();
    else await worker.controller.logout();
    releaseRead();
    await new Promise(resolve=>setTimeout(resolve,150));
    worker.port.call=originalCall;
    expect(worker.controller.status().state,revocation).toBe('logged_out');
    expect(JSON.stringify(worker.controller.status())).not.toContain('logged_in');
  }
},60000);
native('a superseded attempt cannot revoke a newer login when its browser open fails late',async()=>{
  const stateRoot=temporaryStateRoot();cleanup.push(()=>fs.rmSync(stateRoot,{recursive:true,force:true}));
  const issuer=await startSyntheticIssuer();cleanup.push(()=>issuer.close());
  const worker=await openFixtureAuthOwner({binary:binary!,stateRoot,profileId:'profile_k',dataRoot:stateRoot,issuerOrigin:issuer.origin});
  cleanup.push(()=>worker.close());
  // Attempt A: gate the browser open, then cancel A and start B.
  let releaseA:()=>void=()=>{};
  const gateA=new Promise<void>(resolve=>{releaseA=resolve;});
  worker.setOpenExternal(()=>gateA.then(()=>{throw new Error('browser missing');}));
  const attemptAPromise=worker.controller.startLogin().catch(error=>String(error));
  await new Promise(resolve=>setTimeout(resolve,150));
  await worker.controller.cancelLogin();
  worker.setOpenExternal(()=>{});
  const attemptB=await worker.controller.startLogin();
  expect(worker.controller.status().state).toBe('logging_in');
  releaseA();
  await expect(attemptAPromise).resolves.toContain('auth_owner_login_cancelled');
  // B keeps its registration: the late failure of A must not cancel it.
  expect(worker.controller.status().state).toBe('logging_in');
  await worker.controller.cancelLogin();
  void attemptB;
},45000);
native('a same-generation replacement keeps its login when the old attempt browser fails late',async()=>{
  const stateRoot=temporaryStateRoot();cleanup.push(()=>fs.rmSync(stateRoot,{recursive:true,force:true}));
  const issuer=await startSyntheticIssuer();cleanup.push(()=>issuer.close());
  const worker=await openFixtureAuthOwner({binary:binary!,stateRoot,profileId:'profile_n',dataRoot:stateRoot,issuerOrigin:issuer.origin});
  cleanup.push(()=>worker.close());
  let releaseA:()=>void=()=>{};
  const gateA=new Promise<void>(resolve=>{releaseA=resolve;});
  worker.setOpenExternal(()=>gateA.then(()=>{throw new Error('browser missing');}));
  const attemptAPromise=worker.controller.startLogin().catch(error=>String(error));
  await new Promise(resolve=>setTimeout(resolve,150));
  // A fails through its own completion without changing the generation.
  const early=worker.framesRef().find(frame=>(frame as {result?:{loginId?:string}}).result?.loginId) as {result:{loginId:string}}|undefined;
  const loginIdA=(early as {result:{loginId:string}}|undefined)?.result?.loginId;
  expect(loginIdA).toBeTruthy();
  worker.injectNotification({method:'account/login/completed',params:{loginId:loginIdA,success:false}});
  await new Promise(resolve=>setTimeout(resolve,100));
  expect(worker.controller.status().state).toBe('logged_out');
  worker.setOpenExternal(()=>{});
  const attemptB=await worker.controller.startLogin();
  expect(worker.controller.status().state).toBe('logging_in');
  releaseA();
  await expect(attemptAPromise).resolves.toContain('auth_owner_login_cancelled');
  expect(worker.controller.status().state).toBe('logging_in');
  await worker.controller.cancelLogin();
  void attemptB;
},45000);
native('an old attempt late browser success or failure never touches the newer login projection',async()=>{
  const stateRoot=temporaryStateRoot();cleanup.push(()=>fs.rmSync(stateRoot,{recursive:true,force:true}));
  const issuer=await startSyntheticIssuer();cleanup.push(()=>issuer.close());
  const worker=await openFixtureAuthOwner({binary:binary!,stateRoot,profileId:'profile_p',dataRoot:stateRoot,issuerOrigin:issuer.origin});
  cleanup.push(()=>worker.close());
  for(const lateOutcome of ['resolve','reject'] as const){
    expect(worker.controller.status().state).toBe('logged_out');
    let releaseA:()=>void=()=>{};
    const gateA=new Promise<void>(resolve=>{releaseA=resolve;});
    worker.setOpenExternal(()=>gateA.then(()=>{if(lateOutcome==='reject')throw new Error('browser missing');}));
    const attemptAPromise=worker.controller.startLogin().catch(error=>String(error));
    await new Promise(resolve=>setTimeout(resolve,150));
    const frame=worker.framesRef().find(entry=>(entry as {result?:{loginId?:string}}).result?.loginId) as {result:{loginId:string}};
    worker.injectNotification({method:'account/login/completed',params:{loginId:frame.result.loginId,success:false}});
    await new Promise(resolve=>setTimeout(resolve,100));
    worker.setOpenExternal(()=>{});
    const attemptB=await worker.controller.startLogin();
    expect(worker.controller.status().state).toBe('logging_in');
    releaseA();
    const settled=await attemptAPromise;
    expect(settled).toContain('auth_owner_login_cancelled');
    // The newer attempt keeps its own login projection either way.
    expect(worker.controller.status().state).toBe('logging_in');
    await worker.controller.cancelLogin();
    void attemptB;
  }
},60000);
native('concurrent registered attempts keep independent projections through failures and late logouts',async()=>{
  const stateRoot=temporaryStateRoot();cleanup.push(()=>fs.rmSync(stateRoot,{recursive:true,force:true}));
  const issuer=await startSyntheticIssuer();cleanup.push(()=>issuer.close());
  const worker=await openFixtureAuthOwner({binary:binary!,stateRoot,profileId:'profile_q',dataRoot:stateRoot,issuerOrigin:issuer.origin});
  cleanup.push(()=>worker.close());
  // Two attempts both register before either completes: A then B.
  worker.setOpenExternal(()=>{});
  const attemptA=await worker.controller.startLogin();
  const attemptB=await worker.controller.startLogin();
  expect(worker.controller.status().state).toBe('logging_in');
  // A's failed completion must not cancel B's newer registration.
  worker.injectNotification({method:'account/login/completed',params:{loginId:attemptA.loginId,success:false}});
  await new Promise(resolve=>setTimeout(resolve,100));
  expect(worker.controller.status().state).toBe('logging_in');
  // A late logout response must not overwrite the newer projection either.
  let releaseLogout:()=>void=()=>{};
  const gate=new Promise<void>(resolve=>{releaseLogout=resolve;});
  const originalCall=worker.port.call.bind(worker.port);
  worker.port.call=(method,params,timeout)=>{
    const started=originalCall(method,params,timeout);
    return method==='account/logout'?gate.then(()=>started):started;
  };
  const logoutPending=worker.controller.logout().catch(error=>String(error));
  await new Promise(resolve=>setTimeout(resolve,150));
  const attemptC=await worker.controller.startLogin();
  expect(worker.controller.status().state).toBe('logging_in');
  releaseLogout();
  await logoutPending;
  worker.port.call=originalCall;
  expect(worker.controller.status().state).toBe('logging_in');
  await worker.controller.cancelLogin();
  void attemptB;void attemptC;
},60000);
native('a late logout response cannot overwrite a login that completed after it started',async()=>{
  const stateRoot=temporaryStateRoot();cleanup.push(()=>fs.rmSync(stateRoot,{recursive:true,force:true}));
  const issuer=await startSyntheticIssuer();cleanup.push(()=>issuer.close());
  const worker=await openFixtureAuthOwner({binary:binary!,stateRoot,profileId:'profile_r',dataRoot:stateRoot,issuerOrigin:issuer.origin});
  cleanup.push(()=>worker.close());
  let releaseLogout:()=>void=()=>{};
  const gate=new Promise<void>(resolve=>{releaseLogout=resolve;});
  const originalCall=worker.port.call.bind(worker.port);
  worker.port.call=(method,params,timeout)=>{
    const started=originalCall(method,params,timeout);
    return method==='account/logout'?gate.then(()=>started):started;
  };
  const logoutPending=worker.controller.logout().catch(error=>String(error));
  await new Promise(resolve=>setTimeout(resolve,150));
  // A new login starts and completes while the logout response is held.
  const attempt=await worker.controller.startLogin();
  worker.injectNotification({method:'account/login/completed',params:{loginId:attempt.loginId,success:true}});
  await waitFor(()=>worker.controller.status().state==='logged_in'?true:undefined,10000,'logged_in');
  releaseLogout();
  await logoutPending;
  worker.port.call=originalCall;
  expect(worker.controller.status().state).toBe('logged_in');
  await worker.controller.logout();
},60000);
it('the snapshot single-flight joins only its own generation and never adopts a revoked answer',async()=>{
  // Scripted-port unit test of the production controller: concurrent
  // same-generation fetches share one request, and a revocation landing
  // while that answer is held makes every waiter fail closed.
  let snapshotCalls=0;
  let releaseFirst:()=>void=()=>{};
  const firstGate=new Promise<void>(resolve=>{releaseFirst=resolve;});
  let loggedIn=false;
  const port={call:async(method:string)=>{
    if(method==='account/read')return loggedIn?{result:{account:{account_id:'synthetic-account-a'}}}:{error:{message:'xiaok_auth_unavailable'}};
    if(method==='account/logout'){loggedIn=false;return {result:{}};}
    if(method==='xiaok/auth/snapshot'){
      snapshotCalls+=1;
      await firstGate;
      return {result:{accessToken:'HELD_GENERATION_TOKEN'}};
    }
    return {result:{}};
  },addNotificationHandler:()=>{},alive:()=>true};
  const portWithLogin={...port,call:async(method:string)=>{
    if(method==='account/login/start')return {result:{authUrl:'https://auth.example.invalid/oauth/authorize?redirect_uri=https%3A%2F%2Fauth.example.invalid%2Fcb',loginId:'login-unit'}};
    return port.call(method);
  }};
  const controller=new AuthOwnerController({port:portWithLogin as never,openExternal:()=>{}});
  await controller.startLogin();
  // Two concurrent authorizedFetch calls join the single in-flight request.
  const a=controller.authorizedFetch({url:'https://auth.example.invalid/api'}).catch(error=>String(error));
  await new Promise(resolve=>setTimeout(resolve,50));
  const b=controller.authorizedFetch({url:'https://auth.example.invalid/api'}).catch(error=>String(error));
  await new Promise(resolve=>setTimeout(resolve,100));
  expect(snapshotCalls).toBe(1);
  await controller.logout();
  releaseFirst();
  expect(await a).toBe('Error: credential_stale');
  expect(await b).toBe('Error: credential_stale');
  expect(snapshotCalls).toBe(1);
});
it('a snapshot answer held across generations is never adopted by a newer generation',async()=>{
  // Cross-generation double-caller negative control: the first snapshot answer
  // is held past a logout plus a fresh login; the newer generation must start
  // its own snapshot request, reject the held answer as stale, and dispatch
  // only the newer generation's token.
  let snapshotCalls=0;
  let releaseFirst:()=>void=()=>{};
  const firstGate=new Promise<void>(resolve=>{releaseFirst=resolve;});
  let releaseSecond:()=>void=()=>{};
  const secondGate=new Promise<void>(resolve=>{releaseSecond=resolve;});
  let loggedIn=false;
  let loginSerial=0;
  const dispatched:string[]=[];
  const fetchImpl=(url:string,init?:RequestInit)=>{
    dispatched.push((init?.headers as {Authorization?:string}).Authorization??'');
    return Promise.resolve(new Response('{"ok":true}',{status:200,headers:{'content-type':'application/json'}}));
  };
  const port={call:async(method:string)=>{
    if(method==='account/read')return loggedIn?{result:{account:{account_id:'synthetic-account-g'}}}:{error:{message:'xiaok_auth_unavailable'}};
    if(method==='account/logout'){loggedIn=false;return {result:{}};}
    if(method==='account/login/start'){loginSerial++;return {result:{authUrl:'https://auth.example.invalid/oauth/authorize?redirect_uri=https%3A%2F%2Fauth.example.invalid%2Fcb',loginId:`login-unit-${loginSerial}`}};}
    if(method==='xiaok/auth/snapshot'){
      const seq=++snapshotCalls;
      await (seq===1?firstGate:secondGate);
      return {result:{accessToken:seq===1?'HELD_GENERATION_TOKEN':'NEW_GENERATION_TOKEN'}};
    }
    return {result:{}};
  },addNotificationHandler:()=>{},alive:()=>true};
  const controller=new AuthOwnerController({port:port as never,openExternal:()=>{},fetchImpl});
  await controller.startLogin();
  const first=controller.authorizedFetch({url:'https://auth.example.invalid/api'}).catch(error=>String(error));
  await new Promise(resolve=>setTimeout(resolve,50));
  expect(snapshotCalls).toBe(1);
  expect(dispatched).toEqual([]);
  // The native logout succeeds while the old answer is still held; a fresh
  // login then opens a new credential generation out from under the flight.
  await controller.logout();
  await controller.startLogin();
  expect(controller.status().state).toBe('logging_in');
  const second=controller.authorizedFetch({url:'https://auth.example.invalid/api'}).catch(error=>String(error));
  await new Promise(resolve=>setTimeout(resolve,50));
  expect(snapshotCalls).toBe(2);
  expect(dispatched).toEqual([]);
  releaseFirst();
  expect(await first).toBe('Error: credential_stale');
  expect(dispatched).toEqual([]);
  releaseSecond();
  expect(await second).toMatchObject({status:200});
  // Only the new generation's token ever reaches dispatch.
  expect(dispatched).toEqual(['Bearer NEW_GENERATION_TOKEN']);
  expect(snapshotCalls).toBe(2);
});
it('after a gated logout the completed login keeps its projection and credential access',async()=>{
  let loggedIn=false;
  let releaseLogout:()=>void=()=>{};
  const logoutGate=new Promise<void>(resolve=>{releaseLogout=resolve;});
  let notify:(notification:{method:string;params?:any})=>void=()=>{};
  let loginSerial=0;
  const dispatched:string[]=[];
  const fetchImpl=(url:string,init?:RequestInit)=>{
    dispatched.push((init?.headers as {Authorization?:string}).Authorization??'');
    return Promise.resolve(new Response('{"ok":true}',{status:200,headers:{'content-type':'application/json'}}));
  };
  const port={call:async(method:string)=>{
    if(method==='account/read')return loggedIn?{result:{account:{account_id:'synthetic-account-h'}}}:{error:{message:'xiaok_auth_unavailable'}};
    if(method==='account/logout'){loggedIn=false;return {result:{}};}
    if(method==='account/login/start'){loginSerial++;return {result:{authUrl:'https://auth.example.invalid/oauth/authorize?redirect_uri=https%3A%2F%2Fauth.example.invalid%2Fcb',loginId:`login-cycle-${loginSerial}`}};}
    if(method==='xiaok/auth/snapshot')return {result:{accessToken:'FINAL_USER_TOKEN'}};
    return {result:{}};
  },addNotificationHandler:(handler:(notification:{method:string;params?:any})=>void)=>{notify=handler;},alive:()=>true};
  const controller=new AuthOwnerController({port:port as never,openExternal:()=>{},fetchImpl});
  await controller.startLogin();
  notify({method:'account/login/completed',params:{loginId:'login-cycle-1',success:true}});
  await waitFor(()=>controller.status().state==='logged_in'?controller.status():undefined,5000,'first logged_in');
  // Gate the native logout response, then run a full succeeding login to
  // completion (completed) while that old response is still undelivered.
  const baseCall=port.call.bind(port);
  port.call=(method:string,params?:unknown,timeout?:number)=>{
    const started=baseCall(method,params,timeout);
    return method==='account/logout'?logoutGate.then(()=>started):started;
  };
  const logoutPending=controller.logout().catch(error=>String(error));
  await new Promise(resolve=>setTimeout(resolve,50));
  const attempt=await controller.startLogin();
  expect(controller.status().state).toBe('logging_in');
  notify({method:'account/login/completed',params:{loginId:attempt.loginId,success:true}});
  await waitFor(()=>controller.status().state==='logged_in'?controller.status():undefined,5000,'second logged_in');
  // The retained login keeps full credential dispatch; the stale-gate cannot
  // interfere because the new generation's snapshot answers its own request.
  expect(await controller.authorizedFetch({url:'https://auth.example.invalid/api'})).toMatchObject({status:200});
  expect(dispatched).toEqual(['Bearer FINAL_USER_TOKEN']);
  // The late logout response lands last: the completed login must survive it.
  releaseLogout();
  expect(await logoutPending).toBeUndefined();
  expect(controller.status().state).toBe('logged_in');
  expect(await controller.authorizedFetch({url:'https://auth.example.invalid/api'})).toMatchObject({status:200});
  expect(dispatched).toEqual(['Bearer FINAL_USER_TOKEN','Bearer FINAL_USER_TOKEN']);
});
it('a native login read during a gated logout keeps its projection after the response lands',async()=>{
  // The startLogin account-present branch establishes logged_in straight from
  // the real native session; that login was established after the logout
  // started, so the late response must never overwrite it (and the kept
  // identity keeps full credential dispatch).
  let loggedIn=false;
  let loginSerial=0;
  let releaseLogout:()=>void=()=>{};
  const logoutGate=new Promise<void>(resolve=>{releaseLogout=resolve;});
  const dispatched:string[]=[];
  const fetchImpl=(url:string,init?:RequestInit)=>{
    dispatched.push((init?.headers as {Authorization?:string}).Authorization??'');
    return Promise.resolve(new Response('{"ok":true}',{status:200}));
  };
  const basePort={call:async(method:string)=>{
    if(method==='account/read')return loggedIn?{result:{account:{account_id:'native-account-c'}}}:{error:{message:'xiaok_auth_unavailable'}};
    if(method==='account/logout'){loggedIn=false;return {result:{}};}
    if(method==='account/login/start'){loginSerial++;return {result:{authUrl:'https://auth.example.invalid/oauth/authorize?redirect_uri=https%3A%2F%2Fauth.example.invalid%2Fcb',loginId:`login-native-${loginSerial}`}};}
    if(method==='xiaok/auth/snapshot')return {result:{accessToken:'NATIVE_USER_TOKEN'}};
    return {result:{}};
  }};
  let external:()=>Promise<void>|void=()=>{};
  const port={...basePort,call:async(method:string,params?:unknown,timeout?:number)=>{
    const started=await basePort.call(method,params,timeout);
    return method==='account/logout'?logoutGate.then(()=>started):started;
  },addNotificationHandler:()=>{},alive:()=>true};
  const controller=new AuthOwnerController({port:port as never,openExternal:url=>external(),fetchImpl});
  // The logout starts first: everything below belongs to the post-logout era.
  const logoutPending=controller.logout().catch(error=>String(error));
  await new Promise(resolve=>setTimeout(resolve,50));
  // C registers while the logout response is held; the browser open stalls so
  // the attempt stays superseded mid-flight.
  let releaseC:()=>void=()=>{};
  const gateC=new Promise<void>(resolve=>{releaseC=resolve;});
  external=()=>gateC.then(()=>{});
  const attemptCPromise=controller.startLogin().catch(error=>String(error));
  await waitFor(()=>controller.status().state==='logging_in'?true:undefined,5000,'C logging_in');
  // The native session is genuinely logged in with C even though the
  // controller has not delivered any completed notification.
  loggedIn=true;
  const rejected=await controller.startLogin().catch(error=>String(error));
  expect(rejected).toContain('auth_owner_already_logged_in');
  expect(controller.status().state).toBe('logged_in');
  expect(controller.status().account?.accountId).toBe('native-account-c');
  // C's superseded browser continuation must not revoke the native login.
  external=()=>{};
  releaseC();
  expect(await attemptCPromise).toContain('auth_owner_login_cancelled');
  expect(controller.status().state).toBe('logged_in');
  // Credentials keep flowing for the identity that was read.
  await expect(controller.authorizedFetch({url:'https://auth.example.invalid/api'})).resolves.toMatchObject({status:200});
  expect(dispatched).toEqual(['Bearer NATIVE_USER_TOKEN']);
  // The gated logout response lands last: the post-logout login survives it.
  releaseLogout();
  expect(await logoutPending).toBeUndefined();
  expect(controller.status().state).toBe('logged_in');
  expect(await controller.authorizedFetch({url:'https://auth.example.invalid/api'})).toMatchObject({status:200});
  expect(dispatched).toEqual(['Bearer NATIVE_USER_TOKEN','Bearer NATIVE_USER_TOKEN']);
});
native('a synchronous close from the status callback prevents the browser open',async()=>{
  const stateRoot=temporaryStateRoot();cleanup.push(()=>fs.rmSync(stateRoot,{recursive:true,force:true}));
  const issuer=await startSyntheticIssuer();cleanup.push(()=>issuer.close());
  let opened=0;
  const worker=await openFixtureAuthOwner({binary:binary!,stateRoot,profileId:'profile_o',dataRoot:stateRoot,issuerOrigin:issuer.origin,
    onStatus:status=>{if(status.state==='logging_in')worker.controller.markClosed();}});
  cleanup.push(()=>worker.close());
  worker.setOpenExternal(()=>{opened++;});
  await expect(worker.controller.startLogin()).rejects.toThrow('auth_owner_login_cancelled');
  expect(opened).toBe(0);
  expect(worker.controller.status().state).toBe('logged_out');
},45000);
native('closing the worker aborts an in-flight login start without opening a browser',async()=>{
  const stateRoot=temporaryStateRoot();cleanup.push(()=>fs.rmSync(stateRoot,{recursive:true,force:true}));
  const issuer=await startSyntheticIssuer();cleanup.push(()=>issuer.close());
  const worker=await openFixtureAuthOwner({binary:binary!,stateRoot,profileId:'profile_l',dataRoot:stateRoot,issuerOrigin:issuer.origin});
  let releaseRead:()=>void=()=>{};
  const gate=new Promise<void>(resolve=>{releaseRead=resolve;});
  const originalCall=worker.port.call.bind(worker.port);
  worker.port.call=(method,params,timeout)=>{
    const started=originalCall(method,params,timeout);
    return method==='account/read'?gate.then(()=>started):started;
  };
  const pending=worker.controller.startLogin().catch(error=>String(error));
  await new Promise(resolve=>setTimeout(resolve,150));
  // The production closeAndDrain marks the controller closed before draining;
  // drive the same seam, then physically close the fixture worker.
  worker.controller.markClosed();
  const closing=worker.close();
  releaseRead();
  await expect(pending).resolves.toContain('auth_owner_login_cancelled');
  expect(worker.controller.status().state).toBe('logged_out');
  await closing;
},45000);
native('stale early completions never consume a later attempt capacity',async()=>{
  const stateRoot=temporaryStateRoot();cleanup.push(()=>fs.rmSync(stateRoot,{recursive:true,force:true}));
  const issuer=await startSyntheticIssuer();cleanup.push(()=>issuer.close());
  const worker=await openFixtureAuthOwner({binary:binary!,stateRoot,profileId:'profile_m',dataRoot:stateRoot,issuerOrigin:issuer.origin});
  cleanup.push(()=>worker.close());
  const originalCall=worker.port.call.bind(worker.port);
  for(let round=0;round<4;round++){
    let releaseStart:()=>void=()=>{};
    const gate=new Promise<void>(resolve=>{releaseStart=resolve;});
    worker.port.call=(method,params,timeout)=>{
      const started=originalCall(method,params,timeout);
      return method==='account/login/start'?gate.then(()=>started):started;
    };
    const pending=worker.controller.startLogin().catch(error=>String(error));
    await new Promise(resolve=>setTimeout(resolve,120));
    worker.injectNotification({method:'account/login/completed',params:{loginId:`stale-${round}`,success:false}});
    worker.injectNotification({method:'account/login/completed',params:{loginId:`stale2-${round}`,success:false}});
    releaseStart();
    await pending;
    await worker.controller.cancelLogin();
  }
  worker.port.call=originalCall;
  const attempt=await worker.controller.startLogin();
  await driveBrowserLogin(worker,attempt.authUrl);
  expect(worker.controller.status().state).toBe('logged_in');
},60000);
native('a revocation between snapshot await and dispatch fails closed without dispatching',async()=>{
  const stateRoot=temporaryStateRoot();cleanup.push(()=>fs.rmSync(stateRoot,{recursive:true,force:true}));
  const issuer=await startSyntheticIssuer();cleanup.push(()=>issuer.close());
  const worker=await openFixtureAuthOwner({binary:binary!,stateRoot,profileId:'profile_i',dataRoot:stateRoot,issuerOrigin:issuer.origin});
  cleanup.push(()=>worker.close());
  const attempt=await worker.controller.startLogin();
  await driveBrowserLogin(worker,attempt.authUrl);
  let releaseSnapshot:()=>void=()=>{};
  const gate=new Promise<void>(resolve=>{releaseSnapshot=resolve;});
  const originalCall=worker.port.call.bind(worker.port);
  // The snapshot request starts immediately (the token is really fetched),
  // but its answer is held until the revocation has landed.
  worker.port.call=(method,params,timeout)=>{
    const started=originalCall(method,params,timeout);
    return method==='xiaok/auth/snapshot'?gate.then(()=>started):started;
  };
  const pendingFetch=worker.controller.authorizedFetch({url:`${issuer.origin}/backend-api/wham/echo`});
  await new Promise(resolve=>setTimeout(resolve,150));
  await worker.controller.logout();
  releaseSnapshot();
  await expect(pendingFetch).rejects.toThrow('credential_stale');
  expect(issuer.requests.filter(request=>request.url==='/backend-api/wham/echo').length).toBe(0);
},60000);
