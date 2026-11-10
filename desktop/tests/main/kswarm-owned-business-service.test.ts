import {afterEach,expect,it,vi} from 'vitest';
import * as original from '../../electron/kswarm-service.js';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},services:original.KSwarmService[]=[],cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{const failures:unknown[]=[];for(const service of services.splice(0))try{await original.sealAndDrainKSwarmServiceInstance(service);}catch(error){failures.push(error);}for(const cleanup of cleanups.splice(0))try{await cleanup();}catch(error){failures.push(error);}vi.unstubAllGlobals();vi.unstubAllEnvs();if(failures.length)throw new AggregateError(failures,'service fixture cleanup failed');});
const port=()=>{const method=(original as any).getKSwarmOwnedBusinessTransport;expect(method).toBeTypeOf('function');return method as (service:object,admission:Function)=>any;};
it('reads only the exact original business constructor scope before start without granting a transport',async()=>{
 const read=(original as any).readKSwarmOwnedBusinessServiceScope;expect(read).toBeTypeOf('function');let hooks=0;const fake=new Proxy({},{get(){hooks++;throw Error('trap');},getOwnPropertyDescriptor(){hooks++;throw Error('trap');}});expect(()=>read(fake,fake)).toThrow();expect(hooks).toBe(0);
 const admission=()=>{},configuration=()=>{},service=original.createKSwarmService({desktopProjectScope:scope,ownedBusinessAdmission:admission,ownedControlAdmission:configuration});services.push(service);
 expect(read(service,admission)).toEqual(scope);expect(()=>read(service,configuration)).toThrow();expect(()=>read(service,()=>{})).toThrow();expect(()=>port()(service,admission)).toThrow(/UNAVAILABLE/);
 await original.sealAndDrainKSwarmServiceInstance(service);services.splice(services.indexOf(service),1);expect(()=>read(service,admission)).toThrow(/CLOSED/);
});
it('validates the original constructor scope before accessing any getter',()=>{
 let hooks=0;const raw=Object.defineProperty({workspaceId:scope.workspaceId},'profileId',{enumerable:true,get(){hooks++;return scope.profileId;}});
 let caught:unknown;try{services.push(original.createKSwarmService({desktopProjectScope:raw as any}));}catch(error){caught=error;}console.log(JSON.stringify({fixture:'original-service-scope',mode:'getter',hooks,rejected:!!caught}));expect(hooks).toBe(0);expect(caught).toBeDefined();
});

async function fixture({hold=false,attached=false,authority=true,onAdmit=()=>{},rawOnCapture=undefined as undefined|(()=>unknown),nativeMode='',seed=undefined as undefined|{root:string;action:any}}={}){
 const root=seed?.root??mkdtempSync(join(tmpdir(),'dsh-original-business-service-')),entry=resolve(nativeMode?'../../kswarm/src/server/index.js':'../../kswarm/test/fixtures/owned-default-dispatch-business/service-entry.js'),children:Array<{child:ChildProcess;closed:Promise<{code:number|null;signal:NodeJS.Signals|null}>}>=[],frames:any[]=[],proofs=new WeakMap<object,{op:string;input:unknown}>();
 let healthy=attached,live=true,release:(()=>void)|undefined,output='',failSend=false;const messages:any[]=[];let service:original.KSwarmService;
 const admission=(proof:object,audience:any)=>{const owned=proofs.get(proof);if(!live||!owned||audience.serviceOwner!==service||audience.projectId!=='p'||audience.operation!==owned.op||JSON.stringify(audience.input)!==JSON.stringify(owned.input))throw Error('fixture_private_command_required');onAdmit();};
 vi.stubEnv('KSWARM_SERVER_PATH',entry);vi.stubGlobal('fetch',vi.fn(async(input:unknown)=>{const url=String(input);if(url.includes(':4400/health'))return new Response(JSON.stringify({ok:healthy,features:['dynamic_workflows'],service:{entryPath:entry,sourceHash:original.computeKSwarmServiceSourceHash(entry)}}),{status:healthy?200:503});if(url.endsWith('/agents'))return new Response(JSON.stringify({agents:[]}));return new Response(JSON.stringify({ok:true}));}));
 service=original.createKSwarmService({desktopProjectScope:scope,...(authority?{ownedBusinessAdmission:admission}:{}),findPortOwner:async()=>null,spawnProcess:((_command,_args,options)=>{
  const child=spawn(process.execPath,[...(nativeMode?['-r',resolve('../../kswarm/test/fixtures/owned-default-dispatch-business/sdk-preload.cjs')]:[]),entry],{...options,env:{...process.env,DISPATCH_BUSINESS_TEST_ROOT:root,...(nativeMode?{HOME:root,USERPROFILE:root,XIAOK_CONFIG_DIR:join(root,'config'),KSWARM_DATA_ROOT:root,KSWARM_PORT:'0',BROKER_URL:'http://127.0.0.1:9',KSWARM_DESKTOP_PROFILE_ID:scope.profileId,KSWARM_DESKTOP_WORKSPACE_ID:scope.workspaceId,XIAOK_DISABLE_GLOBAL_PLUGINS:'1',DISPATCH_BUSINESS_SDK_MODE:nativeMode}:{})}}),closed=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(yes=>child.once('close',(code,signal)=>{healthy=false;yes({code,signal});}));children.push({child,closed});
  // The original service can restart after exit, before stdio close. The
  // controlled health source must stop reporting that exited process healthy.
  child.once('exit',()=>{healthy=false;});
  child.stdout!.on('data',chunk=>{output+=String(chunk);if(String(chunk).includes(nativeMode?'KSwarm API server started on port':'OWNED_BUSINESS_SERVICE_READY'))healthy=true;});child.stderr!.on('data',chunk=>{output+=String(chunk);});
  child.on('message',frame=>messages.push(frame));const send=child.send!.bind(child);Object.defineProperty(child,'send',{configurable:true,value:(frame:any,callback:any)=>{frames.push(frame);const raw=send(frame,error=>{if(failSend&&frame.op==='capture_default_dispatch'){failSend=false;callback(Error('original parent send failure'));}else if(hold&&frame.op==='capture_default_dispatch')release=()=>callback(error);else callback(error);});return frame.op==='capture_default_dispatch'&&rawOnCapture?rawOnCapture():raw;}});return child;
 }) as typeof spawn});services.push(service);
 cleanups.push(async()=>{release?.();for(const owned of children){const result=await owned.closed;console.log(JSON.stringify({fixture:'original-business-service-child',pid:owned.child.pid,...result,nativeMode,childCloseObserved:true,notWholeServiceQualification:true}));expect(result.code,output).toBe(nativeMode?75:0);}if(!seed)rmSync(root,{recursive:true,force:true});});
 await service.start();const action=seed?.action??(children.length?JSON.parse(readFileSync(join(root,'ready.json'),'utf8')).action:undefined);
 const context=(op:string,input:unknown=null)=>{const admission=Object.freeze({});proofs.set(admission,{op,input});return{requestSource:'user' as const,admission,signal:new AbortController().signal};};
 return{root,service,admission,children,frames,messages,action,context,release:()=>release?.(),revoke:()=>{live=false;},injectSendError:()=>{failSend=true;},get held(){return !!release;}};
}
it('connects its original actual child through the pinned internal facade and rejects substituted command data',async()=>{
 const f=await fixture(),api=port()(f.service,f.admission);expect((await api.readPlan('p',f.context('read_plan'))).ok).toBe(true);
 await expect(api.captureDefaultDispatch('p',f.action,{...f.context('capture_default_dispatch',f.action),requestSource:'agent'})).rejects.toThrow();
 const command=f.context('capture_default_dispatch',f.action);await expect(api.captureDefaultDispatch('p',{...f.action,actorId:'agent:bad'},command)).rejects.toThrow();
 const first=await api.captureDefaultDispatch('p',f.action,command);expect(first.ok).toBe(true);expect(await api.captureDefaultDispatch('p',f.action,command)).toEqual(first);
 expect(await api.readOperation('p',{planRevision:f.action.planRevision,dispatchGeneration:f.action.dispatchGeneration},f.context('read_operation',{planRevision:f.action.planRevision,dispatchGeneration:f.action.dispatchGeneration}))).toEqual(first);
 expect(f.children).toHaveLength(1);
},15000);
it('does not run a later child current SDK after its final private command admission',async()=>{
 const f=await fixture(),api=port()(f.service,f.admission),child=f.children[0]!.child;let connected=child.connected,reads=0,revoked=false;
 Object.defineProperty(child,'connected',{configurable:true,get(){const stack=Error().stack??'';if(!revoked&&stack.includes('kswarm-service')&&/at (?:Object\.)?admit \(/.test(stack)&&++reads===8){revoked=true;f.revoke();}return connected;},set(value){connected=value;}});
 await api.readPlan('p',f.context('read_plan')).catch(()=>{});console.log(JSON.stringify({fixture:'business-service-final-admission-sdk',revoked,reads,requests:f.frames.filter(frame=>frame.type==='request').length}));
 expect(revoked).toBe(true);expect(f.frames.filter(frame=>frame.type==='request')).toHaveLength(0);
},15000);
it('joins its original held parent callback before stop may terminate the owned child',async()=>{
 const f=await fixture({hold:true}),api=port()(f.service,f.admission);let error:unknown;const call=api.captureDefaultDispatch('p',f.action,f.context('capture_default_dispatch',f.action)).catch((caught:unknown)=>{error=caught;});
 for(let n=0;n<100&&!f.held;n++)await new Promise(resolve=>setTimeout(resolve,5));expect(f.held).toBe(true);
 let done=false;const stop=f.service.stop().then(()=>{done=true;},()=>{done=true;});
 try{await new Promise(resolve=>setTimeout(resolve,40));expect(done).toBe(false);expect(()=>process.kill(f.children[0]!.child.pid!,0)).not.toThrow();}finally{f.release();await call;await stop;}
 expect(error).toBeDefined();await expect(api.readPlan('p',f.context('read_plan'))).rejects.toThrow();
},15000);
it('refuses a Proxy original constructor scope without enumeration or property hooks',()=>{
 let hooks=0;const raw=new Proxy(scope,{ownKeys(){hooks++;return Reflect.ownKeys(scope);},get(){hooks++;return scope.profileId;},getOwnPropertyDescriptor(_target,key){hooks++;return Object.getOwnPropertyDescriptor(scope,key);}});
 let caught:unknown;try{services.push(original.createKSwarmService({desktopProjectScope:raw}));}catch(error){caught=error;}console.log(JSON.stringify({fixture:'original-service-scope',mode:'proxy',hooks,rejected:!!caught}));expect(hooks).toBe(0);expect(caught).toBeDefined();
});
it('cannot wash a failed original retirement through an inherited Array then',async()=>{
 const f=await fixture(),api=port()(f.service,f.admission);f.injectSendError();await expect(api.captureDefaultDispatch('p',f.action,f.context('capture_default_dispatch',f.action))).rejects.toThrow('original parent send failure');
 const prior=Object.getOwnPropertyDescriptor(Array.prototype,'then');let hooks=0,caught:unknown;
 Object.defineProperty(Array.prototype,'then',{configurable:true,value:function(resolve:(value:unknown)=>void){hooks++;resolve(Object.setPrototypeOf([],null));}});
 try{try{await f.service.stop();}catch(error){caught=error;}}
 finally{if(prior)Object.defineProperty(Array.prototype,'then',prior);else delete (Array.prototype as any).then;await original.sealAndDrainKSwarmServiceInstance(f.service).catch(()=>{});services.splice(services.indexOf(f.service),1);}
 console.log(JSON.stringify({fixture:'business-retirement-array-then',hooks,stopRejected:!!caught}));expect(hooks).toBe(0);expect(caught).toBeDefined();expect(String(caught)).toContain('stop_unconfirmed');
},15000);
it('refuses ownership handoff after child exit while its original parent callback is still held',async()=>{
 const f=await fixture({hold:true}),api=port()(f.service,f.admission),work=api.captureDefaultDispatch('p',f.action,f.context('capture_default_dispatch',f.action)).catch(()=>{});
 for(let n=0;n<100&&(!f.held||!f.messages.some(row=>row.type==='response'&&row.op==='capture_default_dispatch'));n++)await new Promise(resolve=>setTimeout(resolve,5));expect(f.held).toBe(true);
 f.children[0]!.child.kill('SIGTERM');expect((await f.children[0]!.closed).code).toBe(0);let caught:unknown;
 try{try{f.service.bindActivityOwner({} as any);}catch(error){caught=error;}}
 finally{f.release();await work;await original.sealAndDrainKSwarmServiceInstance(f.service).catch(()=>{});services.splice(services.indexOf(f.service),1);}
 console.log(JSON.stringify({fixture:'business-handoff-held-callback',handoffRejected:!!caught}));expect(caught).toBeDefined();expect(String(caught)).toContain('handoff');
},15000);
it('cannot automatically replace an exited child before its old original parent callback settles',async()=>{
 const f=await fixture({hold:true}),api=port()(f.service,f.admission),work=api.captureDefaultDispatch('p',f.action,f.context('capture_default_dispatch',f.action)).catch(()=>{});
 for(let n=0;n<100&&(!f.held||!f.messages.some(row=>row.type==='response'&&row.op==='capture_default_dispatch'));n++)await new Promise(resolve=>setTimeout(resolve,5));expect(f.held).toBe(true);
 f.children[0]!.child.kill('SIGTERM');await f.children[0]!.closed;
 try{await new Promise(resolve=>setTimeout(resolve,2150));expect(f.children).toHaveLength(1);}
 finally{f.release();await work;}
 try{for(let n=0;n<250;n++){try{port()(f.service,f.admission);break;}catch{}await new Promise(resolve=>setTimeout(resolve,10));}expect(f.children).toHaveLength(2);await expect(api.readPlan('p',f.context('read_plan'))).rejects.toThrow();}
 finally{await original.sealAndDrainKSwarmServiceInstance(f.service).catch(()=>{});services.splice(services.indexOf(f.service),1);}
},15000);
it('does not dynamically read Promise then while wrapping the original business result',async()=>{
 const previous=Object.getOwnPropertyDescriptor(Promise.prototype,'then')!;let hooks=0,armed=true;
 const f=await fixture({onAdmit(){if(armed){armed=false;Object.defineProperty(Promise.prototype,'then',{configurable:true,get(){hooks++;return previous.value;}});}}}),api=port()(f.service,f.admission);
 try{expect((await api.readPlan('p',f.context('read_plan'))).ok).toBe(true);}finally{Object.defineProperty(Promise.prototype,'then',previous);}
 console.log(JSON.stringify({fixture:'business-original-result-observer',thenGetterHooks:hooks}));expect(hooks).toBe(0);
},15000);
it('cannot deliver an already-fulfilled Core result after the original service transport was synchronously retired',async()=>{
 let admissions=0,attempted=false;let f:Awaited<ReturnType<typeof fixture>>;
 f=await fixture({onAdmit(){if(++admissions===6)queueMicrotask(()=>{attempted=true;try{f.service.bindActivityOwner({} as any);}catch{}});}});
 const api=port()(f.service,f.admission);let result:unknown,caught:unknown;try{result=await api.readPlan('p',f.context('read_plan'));}catch(error){caught=error;}
 console.log(JSON.stringify({fixture:'business-result-after-retirement',admissions,attempted,fulfilled:result!==undefined,rejected:!!caught}));
 expect(attempted).toBe(true);expect(caught).toBeDefined();expect(result).toBeUndefined();
},15000);
for(const closing of ['restart','instance'])it('joins original parent callback before '+closing+' and never revives its old facade',async()=>{
 const f=await fixture({hold:true}),api=port()(f.service,f.admission),work=api.captureDefaultDispatch('p',f.action,f.context('capture_default_dispatch',f.action)).catch(()=>{});
 for(let n=0;n<100&&!f.held;n++)await new Promise(resolve=>setTimeout(resolve,5));expect(f.held).toBe(true);
 let done=false;const operation=(closing==='restart'?f.service.restart():original.sealAndDrainKSwarmServiceInstance(f.service)).then(()=>{done=true;},error=>{done=true;throw error;});
 try{await new Promise(resolve=>setTimeout(resolve,40));expect(done).toBe(false);expect(f.children).toHaveLength(1);expect(()=>process.kill(f.children[0]!.child.pid!,0)).not.toThrow();}
 finally{f.release();await work;await operation;}
 await expect(api.readPlan('p',f.context('read_plan'))).rejects.toThrow();
 if(closing==='restart'){
  expect(f.children).toHaveLength(2);const next=port()(f.service,f.admission),hello=await next.prepareHello();next.assertHelloCurrent(hello);
  const lookup={planRevision:f.action.planRevision,dispatchGeneration:f.action.dispatchGeneration};expect((await next.readOperation('p',lookup,f.context('read_operation',lookup))).ok).toBe(true);
 }
},15000);
it('cannot obtain a transport by adopting an attached service or omitting constructor authority',async()=>{
 for(const settings of [{attached:true},{authority:false}]){const f=await fixture(settings);expect(()=>port()(f.service,f.admission)).toThrow();expect(f.frames).toHaveLength(0);if(settings.attached)expect(f.children).toHaveLength(0);}
},15000);
it('joins both actual parent SDK raw and callback before a failed stop can terminate its original child',async()=>{
 let releaseRaw!:()=>void;const raw=new Promise<void>(yes=>{releaseRaw=yes;}),f=await fixture({hold:true,rawOnCapture:()=>raw}),api=port()(f.service,f.admission);
 await expect(api.captureDefaultDispatch('p',f.action,f.context('capture_default_dispatch',f.action))).rejects.toThrow(/SEND_RETURN_UNCONFIRMED/);
 for(let n=0;n<100&&!f.held;n++)await new Promise(resolve=>setTimeout(resolve,5));expect(f.held).toBe(true);
 let done=false,caught:unknown;const stop=f.service.stop().then(()=>{done=true;},error=>{done=true;caught=error;});
 try{await new Promise(resolve=>setTimeout(resolve,20));expect(done).toBe(false);releaseRaw();await new Promise(resolve=>setTimeout(resolve,20));expect(done).toBe(false);expect(()=>process.kill(f.children[0]!.child.pid!,0)).not.toThrow();}
 finally{releaseRaw();f.release();await stop;await original.sealAndDrainKSwarmServiceInstance(f.service).catch(()=>{});services.splice(services.indexOf(f.service),1);}
 expect(caught).toBeDefined();
},15000);
for(const nativeMode of ['commit-before','commit-after','post-bookkeeping'])it('keeps actual Server '+nativeMode+' cause and its parent callback after EXIT75 through the original service',async()=>{
 const seed=await fixture();await seed.service.stop();const f=await fixture({nativeMode,seed,hold:true}),api=port()(f.service,f.admission);
 let caught:any;const work=api.captureDefaultDispatch('p',f.action,f.context('capture_default_dispatch',f.action)).catch((error:unknown)=>{caught=error;});
 expect((await f.children[0]!.closed).code).toBe(75);await work;let done=false,closeError:unknown;const close=original.sealAndDrainKSwarmServiceInstance(f.service).then(()=>{done=true;},error=>{done=true;closeError=error;});
 try{expect(caught).toMatchObject({remoteError:{durableCommitted:nativeMode==='post-bookkeeping'}});expect(String(caught.remoteError.code)).toBe(nativeMode==='post-bookkeeping'?'persistence_post_commit_failure':'DISPATCH_BUSINESS_REMOTE_ERROR');await new Promise(resolve=>setTimeout(resolve,30));expect(f.held).toBe(true);expect(done).toBe(false);}
 finally{f.release();await close;services.splice(services.indexOf(f.service),1);}
 expect(closeError).toBeDefined();
},15000);
it('checks original service identity before any supplied service property',()=>{
 let hooks=0;const fake=new Proxy({},{get(){hooks++;throw Error('trap');},ownKeys(){hooks++;throw Error('trap');}});
 expect(()=>port()(fake,()=>{})).toThrow(/ORIGINAL_SERVICE/);expect(hooks).toBe(0);
});
it('keeps absent, foreign or not-started admission unavailable without spawning or HTTP',()=>{
 const spawn=vi.fn(()=>{throw Error('no_spawn');}),http=vi.fn(()=>{throw Error('no_http');});vi.stubGlobal('fetch',http);
 const admission=()=>{},service=original.createKSwarmService({desktopProjectScope:scope,spawnProcess:spawn as any,ownedBusinessAdmission:admission} as any);services.push(service);
 expect(()=>port()(service,()=>{})).toThrow(/ADMISSION/);expect(()=>port()(service,admission)).toThrow(/UNAVAILABLE/);
 const absent=original.createKSwarmService({desktopProjectScope:scope,spawnProcess:spawn as any});services.push(absent);expect(()=>port()(absent,admission)).toThrow(/ADMISSION/);
 expect(spawn).not.toHaveBeenCalled();expect(http).not.toHaveBeenCalled();
});

it('keeps the original DSH constructor scope separate from user/config/preparation and refuses transport before actual child startup',async()=>{const admission=()=>{},user=()=>{},service=original.createKSwarmService({desktopProjectScope:scope,ownedDshAdmission:admission,ownedBusinessAdmission:user});services.push(service);expect(original.readKSwarmOwnedDshServiceScope(service,admission)).toEqual(scope);expect(()=>original.readKSwarmOwnedDshServiceScope(service,user)).toThrow('DSH_BUSINESS_ORIGINAL_SERVICE_REQUIRED');expect(()=>original.getKSwarmOwnedDshTransport(service,admission)).toThrow('DSH_BUSINESS_UNAVAILABLE');let traps=0;const fake=new Proxy({},{get(){traps++;throw Error('get');},getOwnPropertyDescriptor(){traps++;throw Error('descriptor');}});expect(()=>original.readKSwarmOwnedDshServiceScope(fake,fake as never)).toThrow('DSH_BUSINESS_ORIGINAL_SERVICE_REQUIRED');expect(traps).toBe(0);await original.sealAndDrainKSwarmServiceInstance(service);services.splice(services.indexOf(service),1);expect(()=>original.readKSwarmOwnedDshServiceScope(service,admission)).toThrow('DSH_BUSINESS_ORIGINAL_SERVICE_CLOSED');});
