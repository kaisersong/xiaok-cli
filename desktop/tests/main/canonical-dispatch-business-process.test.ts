import {afterEach,expect,it} from 'vitest';
import {ownedConfigDaemonFixture} from '../support/owned-config-daemon-fixture.js';
import {existsSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {MainUserSubmissionOwner} from '../../electron/main-user-submission.js';
const protocol='activity_dispatch_business_v1',cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
async function original(mode?:string,seedDispatch=false){
 const f=await ownedConfigDaemonFixture(close=>cleanups.push(close),{seedDispatch,...(mode?{daemonPreload:resolve('tests/e2e/fixtures/canonical-dispatch-sdk.cjs'),daemonEnv:{BUSINESS_SDK_MODE:mode}}:{})}),frames:Array<Record<string,any>>=[];
 f.child.on('message',raw=>{if((raw as any)?.protocol===protocol)frames.push(raw as any);});
 const get=(type:string,id?:number)=>f.wait(()=>frames.find(row=>row.type===type&&(id===undefined||row.id===id)));
 const probe={protocol,type:'probe',scope:f.scope,mainLaunchNonce:'e'.repeat(64)};f.child.send(probe);
 const hello=await get('hello_ack'),session={protocol,scope:f.scope,mainLaunchNonce:probe.mainLaunchNonce,daemonBoot:hello.daemonBoot,ownerEpoch:hello.ownerEpoch,connectionIncarnation:hello.connectionIncarnation,targetGeneration:hello.targetGeneration,childBoot:hello.childBoot};
 return{...f,businessFrames:frames,getBusiness:get,businessSession:session};
}
it('original canonical daemon owns an independent business hello and readonly request without preparing a writer',async()=>{
 const f=await original();expect(f.businessSession.targetGeneration).toBeGreaterThan(0);expect(f.businessSession.childBoot).toMatch(/^[a-f0-9]{64}$/);expect(f.floor()).toBe(0);
 f.child.send({...f.businessSession,type:'request',id:1,op:'read_plan',projectId:'p',input:null});const reply=await f.getBusiness('response',1);expect(reply.result).toMatchObject({ok:false});expect(f.floor()).toBe(0);
 f.child.send({...f.businessSession,type:'seal_prefix',throughId:1,sealNonce:'f'.repeat(64)});expect((await f.getBusiness('prefix_drained')).throughId).toBe(1);
},15000);
it('rechecks its private command after the final real child current SDK reenters revocation',async()=>{
 const f=await original('last-current');f.child.send({...f.businessSession,type:'request',id:1,op:'read_plan',projectId:'p',input:null});
 await f.wait(()=>existsSync(join(f.root,'business-last-current.json'))?true:undefined);await f.getBusiness('response',1);
 expect(existsSync(join(f.root,'business-request-after-revoke.json'))).toBe(false);
},15000);
it('constructs the original target audience without consulting a replaced Array iterator',async()=>{
 const f=await original('audience-iterator');expect(f.businessSession.targetGeneration).toBe(1);expect(f.businessSession.childBoot).not.toBe('9'.repeat(64));
 expect(existsSync(join(f.root,'business-audience-iterator.json'))).toBe(false);
},15000);
it('removes the real business message listener attached after an invalid setup raw settles',async()=>{
 const f=await ownedConfigDaemonFixture(close=>cleanups.push(close),{daemonPreload:resolve('tests/e2e/fixtures/canonical-dispatch-sdk.cjs'),daemonEnv:{BUSINESS_SDK_MODE:'late-attach'}});
 expect(existsSync(join(f.root,'held-business-setup.json'))).toBe(true);f.child.kill('SIGTERM');await delay(25);expect(f.child.exitCode).toBeNull();
 writeFileSync(join(f.root,'release-business-setup'),'1');await f.closed;
 expect(JSON.parse(readFileSync(join(f.root,'business-listeners-after-off.json'),'utf8')).count).toBe(0);
 expect(existsSync(join(f.root,'business-late-attached.json'))).toBe(true);
 // A new, final off must occur after the SDK actually attaches its listener.
 expect(JSON.parse(readFileSync(join(f.root,'business-listeners-after-off.json'),'utf8')).lateAttachObserved).toBe(true);
},15000);
it('does not produce a new fault after close has reserved and begun listener teardown',async()=>{
 const f=await original('late-close');f.child.kill('SIGTERM');await f.wait(()=>existsSync(join(f.root,'held-business-off.json'))?true:undefined);
 f.child.send({protocol,type:'invalid-during-close'});await f.wait(()=>existsSync(join(f.root,'business-late-message.json'))?true:undefined);await delay(25);
 try{expect(existsSync(join(f.root,'business-fault-invoked.json'))).toBe(false);expect(existsSync(join(f.root,'held-business-fault.json'))).toBe(false);}finally{writeFileSync(join(f.root,'release-business-off'),'1');writeFileSync(join(f.root,'release-business-fault'),'1');await f.closed;}
},15000);
it('entry owns the original response tail before a synchronous shutdown with a poisoned inherited constructor',async()=>{
 const f=await original('constructor-close');f.child.send({...f.businessSession,type:'request',id:1,op:'read_plan',projectId:'p',input:null});await f.getBusiness('response',1);
 await f.wait(()=>existsSync(join(f.root,'held-business-response.json'))?true:undefined);await delay(40);
 try{expect(f.child.exitCode).toBeNull();expect(existsSync(join(f.root,'business-forbidden-constructor.json'))).toBe(false);}finally{writeFileSync(join(f.root,'release-business-response'),'1');await f.closed;}
},15000);
it('joins the upper original response callback before sourceRestart can kill or replace its KSwarm target',async()=>{
 const f=await original('held-response');f.child.send({...f.businessSession,type:'request',id:1,op:'read_plan',projectId:'p',input:null});await f.getBusiness('response',1);await f.wait(()=>existsSync(join(f.root,'held-business-response.json'))?true:undefined);
 const names=()=>readdirSync(f.root).filter(name=>/^sidecar-kswarm-[0-9]+\.json$/.test(name)),old=JSON.parse(readFileSync(join(f.root,names()[0]!),'utf8'));
 let finished=false;const restart=f.client.request('sourceRestart',{name:'kswarm',ownerEpoch:f.businessSession.ownerEpoch}).then(value=>{finished=true;return value;},error=>{finished=true;throw error;});
 await f.wait(()=>existsSync(join(f.root,'business-lower-prefix-drained.json'))?true:undefined);await delay(120);
 let alive=true;try{process.kill(old.pid,0);}catch{alive=false;}
 console.log(JSON.stringify({test:'canonical-business-upper-restart-barrier',oldPid:old.pid,alive,finished,targets:names().length,notWholeNativeDrain:true}));
 try{expect(existsSync(join(f.root,'business-lower-signaled.json'))).toBe(false);expect(alive).toBe(true);expect(finished).toBe(false);expect(names()).toHaveLength(1);}finally{writeFileSync(join(f.root,'release-business-response'),'1');await restart;}
},15000);
it('retains a known handle tail introduced by the original off SDK while its first close snapshot waits',async()=>{
 const f=await original('late-handle');f.child.kill('SIGTERM');await f.wait(()=>existsSync(join(f.root,'held-business-handle.json'))?true:undefined);writeFileSync(join(f.root,'release-business-off'),'1');await delay(60);
 try{expect(f.child.exitCode).toBeNull();}finally{writeFileSync(join(f.root,'release-business-handle'),'1');await f.closed;}expect(f.child.exitCode).toBe(1);
},15000);
it('independent business traffic cannot poison the actual configuration session on the same original descriptor',async()=>{
 const f=await original(),installed=await f.install();expect(installed.type).toBe('installed');
 f.child.send({...f.businessSession,type:'request',id:1,op:'read_plan',projectId:'p',input:null});await f.getBusiness('response',1);
 f.send({...f.session(installed),type:'offer',offerId:1,op:'inspect_writer'});const challenge=await f.get('command_challenge',1);f.send({...challenge,type:'invoke'});expect((await f.get('command_result',1)).result).toMatchObject({ok:true});expect(f.floor()).toBe(0);
},15000);
it('carries original Main A canonical action into the actual daemon and SQLite, reusing one operation',async()=>{
 const f=await original(undefined,true);let id=0;
 const call=async(op:string,input:unknown)=>{f.child.send({...f.businessSession,type:'request',id:++id,op,projectId:'p',input});const reply=await f.getBusiness('response',id);expect(reply.error).toBeUndefined();return reply.result;};
 const plan=await call('read_plan',null);expect(plan.ok).toBe(true);const head=plan.plan,observation=Object.freeze({}),user=Object.freeze({}),actor={requestSource:'user' as const,actorId:'desktop-user:'+f.scope.profileId};
 const options={dataRoot:f.root,...f.scope,defaultDispatchSource:{resolve(frame:object){if(frame!==observation)throw Error('foreign B observation');return{data:{scope:f.scope,projectId:'p',planRevision:head.revision,dispatchGeneration:head.dispatchGeneration,bindingDigest:head.bindingDigest,taskSetDigest:head.taskSetDigest},assertCurrent(){}};}},defaultDispatchUserAdmission(frame:object,current:typeof actor){if(frame!==user||current.actorId!==actor.actorId||current.requestSource!=='user')throw Error('foreign controlled user');}};
 const a=new MainUserSubmissionOwner(options),action=a.readDefaultDispatchAction(a.captureDefaultDispatch(observation,user,actor),actor),captured=await call('capture_default_dispatch',action);expect(captured.ok).toBe(true);
 const reopened=new MainUserSubmissionOwner(options),again=reopened.readDefaultDispatchAction(reopened.captureDefaultDispatch(observation,user,actor),actor);expect(again).toEqual(action);
 expect(await call('capture_default_dispatch',again)).toEqual(captured);expect(await call('read_operation',{planRevision:action.planRevision,dispatchGeneration:action.dispatchGeneration})).toEqual(captured);
 console.log(JSON.stringify({test:'canonical-business-original-A-and-B',requests:id,reused:true,notNativeMainProof:true}));a.seal();reopened.seal();
 f.child.send({...f.businessSession,type:'seal_prefix',throughId:id,sealNonce:'f'.repeat(64)});await f.getBusiness('prefix_drained');
},15000);
