import {afterEach,expect,it} from 'vitest';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync,readFileSync,realpathSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {DesktopMultiAgentStore} from '../../electron/desktop-multi-agent-store.js';
import {ConversationActivityOwnerClient} from '../../../src/runtime/conversation-activity/owner-client.js';
import {mintCanonicalDesktopConfigBirth,bindCanonicalDesktopConfigBirth} from '../../../src/runtime/conversation-activity/source-supervisor.js';
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
async function fixture(options:{kind?:'desktop'|'cli';mode?:'canonical'|'generic'|'import-entry';ipc?:boolean;sdk?:'then'|'iterator'|'raw'|'false'|'thenable'|'throw'|'async'|'bound-async'|'proxy'}={}){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'ce-'))),identityPath=join(root,'groups.sqlite'),store=new DesktopMultiAgentStore(identityPath);store.close();const initialHash=createHash('sha256').update(readFileSync(identityPath)).digest('hex');
 const configPath=join(root,'owner.json'),kind=options.kind??'desktop',config={schemaVersion:1,dataRoot:root,profileId:'canonical-fixture',actorId:'desktop-user:canonical-fixture',identity:{kind,path:kind==='desktop'?identityPath:root}};
 writeFileSync(configPath,JSON.stringify(config),{mode:0o600});const entry=resolve('dist/main/src/runtime/conversation-activity/owner-entry.js'),runtime=resolve('dist/main/src/runtime/conversation-activity/owner-runtime.js'),generic=resolve('tests/e2e/fixtures/ordinary-activity-owner-entry.mjs');
 const mode=options.mode??'canonical',ipc=options.ipc!==false,preload=options.sdk?['--require',resolve('tests/e2e/fixtures/canonical-config-sdk-preload.cjs')]:[],child=spawn(process.execPath,[...preload,...(mode==='canonical'?[entry,configPath]:[generic,configPath,runtime,mode,entry])],{stdio:ipc?['ignore','pipe','pipe','ipc']:['ignore','pipe','pipe'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1',...(options.sdk?{CANONICAL_SDK_FIXTURE_ROOT:root,CANONICAL_SDK_FIXTURE_MODE:options.sdk}:{})}});
 let closedObserved=false,exitObserved=false;let stderr='';let stdout='';child.stdout!.on('data',chunk=>{stdout+=chunk;});child.once('exit',(code,signal)=>{exitObserved=true;console.log(JSON.stringify({test:'canonical-owned-exit-observed',pid:child.pid,code,signal,stdoutBytes:Buffer.byteLength(stdout)}));});const frames:Record<string,unknown>[]=[];child.stderr!.on('data',chunk=>{stderr+=chunk;});child.on('message',frame=>frames.push(frame as Record<string,unknown>));const closed=new Promise<void>(yes=>child.once('close',(code,signal)=>{closedObserved=true;console.log(JSON.stringify({test:'canonical-config-entry',pid:child.pid,code,signal,kind,mode,ipc,reaped:true,fixtureSignalForCleanup:true,notNativeMainProof:true}));yes();}));
 const client=new ConversationActivityOwnerClient(root,'producer');
 cleanups.push(async()=>{
  writeFileSync(join(root,'release-sdk-hello'),'1');writeFileSync(join(root,'release-sdk-raw'),'1');client.dispose();if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await Promise.race([closed,delay(300)]);
  if(!closedObserved){
   let absent=false;try{process.kill(child.pid!,0);}catch(error){absent=(error as NodeJS.ErrnoException).code==='ESRCH';}
   // Both Node 22.22.0 and 24.16.0 were separately reproduced with a minimal
   // spawn/disconnect program. This is fixture OS cleanup, never a production
   // ChildProcess.close witness, and the original parent-disconnect assertions
   // remain above this cleanup. Unknown profiles still fail this fixture.
   const knownSdkProfile=process.platform==='darwin'&&['22.22.0','24.16.0'].includes(process.versions.node);
   if(options.sdk==='iterator'&&knownSdkProfile&&exitObserved&&absent&&!child.connected&&child.stdout?.destroyed&&child.stderr?.destroyed){
    console.log(JSON.stringify({test:'canonical-fixture-disconnect-sdk-cleanup',pid:child.pid,exitCode:child.exitCode,exitObserved,processAbsent:true,stdioClosed:true,closeEventObserved:false,reapedAtExit:true,notProductionClose:true,notProductionDrain:true}));
   }else{console.log(JSON.stringify({test:'canonical-owned-fixture-cleanup-escalation',pid:child.pid,forced:true,notProductionDrain:true}));if(!absent)child.kill('SIGKILL');await Promise.race([closed,delay(1000)]);if(!closedObserved)throw Error('canonical_fixture_close_event_unconfirmed');}
  }
  const hash=createHash('sha256').update(readFileSync(identityPath)).digest('hex');expect(hash).toBe(initialHash);rmSync(root,{recursive:true,force:true,maxRetries:3});
 });
 let ready=false;for(let n=0;n<400;n++){if(child.exitCode!==null||child.signalCode!==null)throw Error('canonical entry startup failed: '+stderr);try{const status=await client.request<{ready:boolean;pid:number}>('status');if(status.ready){expect(status.pid).toBe(child.pid);ready=true;break;}}catch{}await delay(10);}expect(ready,'original ordinary owner must be ready before judging C1').toBe(true);
 return {child,client,frames,root,config,closed,async file(name:string){for(let n=0;n<400;n++){const target=join(root,name);if(existsSync(target))return JSON.parse(readFileSync(target,'utf8'));await delay(5);}throw Error('SDK fixture marker absent: '+name);},async hello(){for(let n=0;n<100;n++){const frame=frames.find(row=>row.protocol==='activity_desktop_config_v1'&&row.type==='daemon_hello');if(frame)return frame;await delay(10);}throw Error('C1_CANONICAL_HELLO_ABSENT');}};
}
it('actual canonical desktop owner with inherited IPC has a bounded hello, without making Native Main claims',async()=>{
 const f=await fixture(),hello=await f.hello();expect(Object.keys(hello).sort()).toEqual(['daemonBoot','installChallenge','ownerEpoch','protocol','type']);expect(hello.daemonBoot).toMatch(/^[a-f0-9]{64}$/);expect(hello.installChallenge).toMatch(/^[a-f0-9]{64}$/);expect(hello.ownerEpoch).toBe((await f.client.request<{ownerEpoch:string}>('status')).ownerEpoch);expect(f.frames.some(row=>row.type==='installed'||row.type==='response')).toBe(false);
});
it.each(['generic','import-entry'] as const)('ordinary %s desktop wrapper with actual worker IPC cannot install a configuration endpoint',async mode=>{
 const f=await fixture({mode});await delay(30);expect(f.frames).toEqual([]);await expect(f.client.request('desktopConfigInstall' as never,{role:'desktop',requestSource:'user'})).rejects.toThrow();
});
it('canonical CLI identity with IPC keeps ordinary service and gets no desktop configuration hello',async()=>{
 const f=await fixture({kind:'cli'});await delay(30);expect(f.frames).toEqual([]);await expect(f.client.request('desktopConfigInstall' as never,{role:'desktop',requestSource:'user'})).rejects.toThrow();
});
it('canonical desktop owner without IPC still starts the original ordinary service',async()=>{
 const f=await fixture({ipc:false});expect(f.child.channel).toBeUndefined();expect(f.frames).toEqual([]);expect((await f.client.request<{ready:boolean}>('status')).ready).toBe(true);
});

it.skipIf(process.platform==='win32')('actual SIGTERM cannot use a mutable then to exit before the original hello SDK callback is released',async()=>{
 const f=await fixture({sdk:'then'});await f.hello();await f.file('sdk-hello-held.json');writeFileSync(join(f.root,'arm-sdk-hook'),'1');await f.file('sdk-hook-armed.json');f.child.kill('SIGTERM');await delay(80);const exitedEarly=f.child.exitCode!==null||f.child.signalCode!==null;console.log(JSON.stringify({test:'canonical-stop-held-original-SDK',exitedEarly,code:f.child.exitCode,released:existsSync(join(f.root,'sdk-hello-released.json'))}));writeFileSync(join(f.root,'release-sdk-hello'),'1');await f.closed;expect(exitedEarly).toBe(false);expect(f.child.exitCode).toBe(0);
});
it('actual parent disconnect cannot skip original endpoint listener cleanup through mutable Array iteration',async()=>{
 const f=await fixture({sdk:'iterator'});await f.hello();await f.file('sdk-hello-held.json');writeFileSync(join(f.root,'arm-sdk-hook'),'1');await f.file('sdk-hook-armed.json');f.child.disconnect();writeFileSync(join(f.root,'release-sdk-hello'),'1');const listeners=await f.file('sdk-after-drain-listeners.json');console.log(JSON.stringify({test:'canonical-disconnect-listeners',...listeners}));expect(listeners.message).toBe(0);expect(listeners.disconnect).toBe(0);expect((await f.client.request<{ready:boolean}>('status')).ready).toBe(true);
});

it.skipIf(process.platform==='win32')('valid false backpressure waits the actual original callback and then stops normally',async()=>{
 const f=await fixture({sdk:'false'});await f.hello();await f.file('sdk-hello-held.json');f.child.kill('SIGTERM');await delay(50);expect(f.child.exitCode).toBeNull();writeFileSync(join(f.root,'release-sdk-hello'),'1');await f.closed;expect(f.child.exitCode).toBe(0);
});
it.skipIf(process.platform==='win32')('standard SDK raw remains owned after its callback and settles only as an unconfirmed contract failure',async()=>{
 const f=await fixture({sdk:'raw'});await f.hello();await f.file('sdk-hello-held.json');await f.file('sdk-raw-held.json');f.child.kill('SIGTERM');writeFileSync(join(f.root,'release-sdk-hello'),'1');await f.file('sdk-hello-released.json');await delay(50);expect(f.child.exitCode).toBeNull();expect(existsSync(join(f.root,'sdk-then-read.json'))).toBe(false);writeFileSync(join(f.root,'release-sdk-raw'),'1');await f.closed;expect(f.child.exitCode).toBe(1);expect(existsSync(join(f.root,'sdk-then-read.json'))).toBe(false);
});
for(const sdk of ['thenable','throw'] as const)it.skipIf(process.platform==='win32')('SDK '+sdk+' cannot turn real hello receipt into a healthy shutdown or execute a then getter',async()=>{
 const f=await fixture({sdk});await f.hello();await f.file('sdk-hello-held.json');f.child.kill('SIGTERM');await delay(50);expect(f.child.exitCode).toBeNull();expect(existsSync(join(f.root,'sdk-then-read.json'))).toBe(false);writeFileSync(join(f.root,'release-sdk-hello'),'1');await f.closed;expect(f.child.exitCode).toBe(1);expect(existsSync(join(f.root,'sdk-then-read.json'))).toBe(false);expect(existsSync(join(f.root,'sdk-hello-released.json'))).toBe(true);
});
it.each(['async','bound-async','proxy'] as const)('canonical entry pre-rejects an explicit %s SDK before any body or trap',async sdk=>{
 const f=await fixture({sdk});await delay(25);expect(f.frames).toEqual([]);expect(existsSync(join(f.root,'sdk-forbidden-body.json'))).toBe(false);
});

it('ordinary worker argv, fake birth and fake supervisor cannot read supplied identity getters or register an endpoint',()=>{
 let hooks=0;const fake=new Proxy({},{get(){hooks++;throw Error('fake birth property');},getPrototypeOf(){hooks++;throw Error('fake birth prototype');}}),config={get identity(){hooks++;throw Error('fake identity');}};
 expect(mintCanonicalDesktopConfigBirth()).toBeUndefined();expect(()=>bindCanonicalDesktopConfigBirth(fake,fake as never,'unread-config',config as never)).toThrow('activity_config_original_birth_required');expect(hooks).toBe(0);
});

it('even the canonical parent descriptor cannot install or invoke in the birth-only slice',async()=>{
 const f=await fixture();await f.hello();f.child.send({protocol:'activity_desktop_config_v1',type:'install',role:'desktop',requestSource:'user',scope:{profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},token:'copied-reader-token'});
 for(let n=0;n<100&&!f.frames.some(row=>row.type==='fault');n++)await delay(5);expect(f.frames.find(row=>row.type==='fault')).toEqual({protocol:'activity_desktop_config_v1',type:'fault',code:'activity_config_not_installed'});f.child.send({protocol:'activity_desktop_config_v1',type:'invoke',op:'prepare_initial_plan_writer'});await delay(25);expect(f.frames.filter(row=>row.type==='fault')).toHaveLength(1);expect(f.frames.some(row=>row.type==='installed'||row.type==='response')).toBe(false);expect((await f.client.request<{ready:boolean}>('status')).ready).toBe(true);
});
