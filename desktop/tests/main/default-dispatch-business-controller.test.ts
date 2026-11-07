// Controlled Native SDK surface + actual original service/Node/SQLite.
// This is not a production NativeMain authorization or complete runtime test.
import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import * as fileIo from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {createDefaultDispatchPreparationNativeSource} from '../../electron/default-dispatch-preparation-native-source.js';
import {createDefaultDispatchPreparationOwner} from '../../electron/default-dispatch-preparation-owner.js';
import * as preparationOwners from '../../electron/default-dispatch-preparation-owner.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {createTaskSourceWriterPopulation} from '../../../src/runtime/task-host/task-runtime-host.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {buildKSwarmTaskCreateInputCandidates,KSWARM_TASK_INPUT_MAPPER_VERSION} from '../../electron/kswarm-task-input.js';
import {originalChildPreparationInputDigest} from '../../../src/runtime/task-host/default-dispatch-preparation.js';
import {MainUserSubmissionOwner} from '../../electron/main-user-submission.js';
import {createKSwarmService,sealAndDrainKSwarmServiceInstance,computeKSwarmServiceSourceHash} from '../../electron/kswarm-service.js';
const native=vi.hoisted(()=>({ready:true,windows:[] as any[]}));
vi.mock('electron',()=>({app:{isReady(){return native.ready;}},BrowserWindow:{getAllWindows(){return native.windows;},fromId(id:number){return native.windows.find(w=>w.id===id);},fromWebContents(contents:unknown){return native.windows.find(w=>w.webContents===contents);}},webContents:{fromId(id:number){return native.windows.map(w=>w.webContents).find(c=>c.id===id);}}}));
const load=()=>import('../../electron/default-dispatch-business-controller.js');
const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();vi.unstubAllEnvs();vi.unstubAllGlobals();native.windows=[];native.ready=true;});
function view(){const contents=Object.assign(new EventEmitter(),{id:2,session:{},mainFrame:{url:'file:///owned/index.html'},isDestroyed:()=>false,isLoadingMainFrame:()=>false,isLoading:()=>false,getURL:()=>"file:///owned/index.html"}),window=Object.assign(new EventEmitter(),{id:1,webContents:contents,isDestroyed:()=>false});native.windows=[window];return{window,contents,event:{sender:contents,senderFrame:contents.mainFrame}};}
it('captures closed controller constructor fields once before any supplied getter',async()=>{
 const {createDefaultDispatchBusinessController:create}=await load(),v=view();let hooks=0;const options=Object.defineProperty({window:v.window,isTrustedUrl:()=>true},'scope',{enumerable:true,get(){hooks++;return scope;}});
 expect(()=>create(options as never)).toThrow();expect(hooks).toBe(0);
});
it('does not read an inherited descriptor when a required constructor field is missing',async()=>{
 const {createDefaultDispatchBusinessController:create}=await load(),v=view(),previous=Object.getOwnPropertyDescriptor(Object.prototype,'isTrustedUrl');let hooks=0;
 Object.defineProperty(Object.prototype,'isTrustedUrl',{configurable:true,get(){hooks++;return {enumerable:true,value:()=>true};}});
 try{expect(()=>create({window:v.window,scope,extra:true} as never)).toThrow();}finally{if(previous)Object.defineProperty(Object.prototype,'isTrustedUrl',previous);else delete (Object.prototype as any).isTrustedUrl;}expect(hooks).toBe(0);
});
it('does not install an inherited optional preparation recipient or invoke its getter',async()=>{
 const {createDefaultDispatchBusinessController:create}=await load(),v=view(),previous=Object.getOwnPropertyDescriptor(Object.prototype,'preparationRecipient');let getters=0;
 Object.defineProperty(Object.prototype,'preparationRecipient',{configurable:true,get(){getters++;return{value:Object.freeze({})};}});
 try{const controller=create({window:v.window as never,scope,isTrustedUrl:()=>true});controller.seal();await controller.drain();}finally{if(previous)Object.defineProperty(Object.prototype,'preparationRecipient',previous);else delete (Object.prototype as any).preparationRecipient;}expect(getters).toBe(0);
});
async function original({start=true,bindA=true,onFrame=(_frame:any)=>{},holdCapture=false,observe=false,extraTasks=false}={}){
 const {createDefaultDispatchBusinessController}=await load(),v=view(),preparationNative=observe?createDefaultDispatchPreparationNativeSource({window:v.window as never,scope,isTrustedUrl:url=>url==='file:///owned/index.html'}):undefined,observationOwner=preparationNative?createDefaultDispatchPreparationOwner(preparationNative):undefined,preparationRecipient=observationOwner??Object.freeze(Object.create(null)),controller=createDefaultDispatchBusinessController({window:v.window as never,scope,isTrustedUrl:url=>url==='file:///owned/index.html',preparationRecipient});
 const root=mkdtempSync(join(tmpdir(),'dispatch-main-controller-')),entry=resolve(observe?'../../kswarm/test/fixtures/owned-preparation-family/entry.js':'../../kswarm/test/fixtures/owned-default-dispatch-business/service-entry.js');let actualChild:ReturnType<typeof spawn>|undefined;let healthy=false,output='',release:(()=>void)|undefined;const children:Array<{pid:number|undefined;closed:Promise<number|null>}>=[],frames:any[]=[],messages:any[]=[],sendCallbacks:any[]=[];
 const expectedFixtureSeedFailures=new Set<unknown>();if(observe)vi.stubEnv('XIAOK_CONFIG_DIR',join(root,'fixture-config'));
 function failureLeaves(error:unknown,seen=new Set<unknown>()):unknown[]{if(seen.has(error))return[];seen.add(error);if(!error||typeof error!=='object')return[error];const cause=Object.getOwnPropertyDescriptor(error,'cause'),errors=Object.getOwnPropertyDescriptor(error,'errors');if(errors&&'value'in errors&&Array.isArray(errors.value)){const leaves:unknown[]=[];for(let n=0;n<errors.value.length;n++)leaves.push(...failureLeaves(errors.value[n],seen));return leaves;}if(cause&&'value'in cause)return failureLeaves(cause.value,seen);return[error];}
 const service=createKSwarmService({desktopProjectScope:scope,ownedBusinessAdmission:controller.businessAdmission,...(observationOwner?{ownedPreparationSource:observationOwner.transportSource,ownedPreparationAdmission:observationOwner.transportAdmission}:{}),findPortOwner:async()=>null,spawnProcess:((_cmd,_args,options)=>{
  const child=spawn(process.execPath,observe?['--input-type=module','-e',"process.on('SIGTERM',()=>process.stdin.emit('data',Buffer.from('release\\nclose\\n')));await import("+JSON.stringify(pathToFileURL(entry).href)+");"]:[entry],{...options,env:{...process.env,DISPATCH_BUSINESS_TEST_ROOT:root,PREPARATION_FAMILY_FIXTURE_ROOT:root,PREPARATION_FAMILY_EXTRA_TASKS:extraTasks?'1':undefined},...(observe?{stdio:['pipe','pipe','pipe','ipc'] as ['pipe','pipe','pipe','ipc']}:{})}),closed=new Promise<number|null>(yes=>child.once('close',code=>{healthy=false;yes(code);}));actualChild=child;children.push({pid:child.pid,closed});child.once('exit',()=>{healthy=false;});child.stdout!.on('data',chunk=>{output+=chunk;if(String(chunk).includes('OWNED_BUSINESS_SERVICE_READY'))healthy=true;});child.stderr!.on('data',chunk=>{output+=chunk;});child.on('message',(frame:any)=>{messages.push(frame);if(frame.protocol==='fixture_ready')healthy=true;});const send=child.send!.bind(child);Object.defineProperty(child,'send',{configurable:true,value:(frame:any,callback:any)=>{frames.push(frame);onFrame(frame);return send(frame,error=>{if(holdCapture&&frame.type==='request'&&frame.op==='capture_default_dispatch')release=()=>{release=undefined;callback(error);};else{sendCallbacks.push(frame);callback(error);}});}});return child;
 }) as typeof spawn});
 const store=observationOwner?new FileTaskSnapshotStore(join(root,'tasks')):undefined,population=store?createTaskSourceWriterPopulation(store):undefined;
 if(observationOwner){observationOwner.bindService(service);const host=population!.createHost({defaultDispatchPreparationSource:observationOwner.hostSource,materialRegistry:new MaterialRegistry({workspaceRoot:join(root,'workspace'),maxBytes:1024}),runner:async()=>{throw Error('observation must not execute');}});observationOwner.bindOriginalHost(population,host);}
 const owner=new MainUserSubmissionOwner({dataRoot:root,...scope,defaultDispatchSource:controller.observationSource,defaultDispatchUserAdmission:controller.userAdmission});
 cleanups.push(async()=>{release?.();controller.seal();observationOwner?.seal();try{await observationOwner?.drain();await population?.close();await sealAndDrainKSwarmServiceInstance(service).catch(error=>{const leaves=failureLeaves(error);if(!leaves.length||!leaves.every(leaf=>expectedFixtureSeedFailures.has(leaf)))throw error;console.log(JSON.stringify({fixture:'intent-seed-known-original-close-error',matchedOriginalCauseIdentity:true,notProductDrain:true}));});}finally{await controller.drain();owner.seal();for(const child of children){expect(await child.closed,output).toBe(0);console.log(JSON.stringify({test:'main-controller-owned-node',pid:child.pid,code:0,reaped:true,notNativeMainProof:true}));}rmSync(root,{recursive:true,force:true});}});
 controller.bindService(service);if(bindA)controller.bindUserOwner(owner);
 vi.stubEnv('KSWARM_SERVER_PATH',entry);vi.stubGlobal('fetch',vi.fn(async(input:unknown)=>String(input).includes(':4400/health')?new Response(JSON.stringify({ok:healthy,features:['dynamic_workflows'],service:{entryPath:entry,sourceHash:computeKSwarmServiceSourceHash(entry)}}),{status:healthy?200:503}):Response.json({ok:true,agents:[]})));
 if(start)await service.start();return{...v,controller,service,owner,observationOwner,store,population,preparationRecipient,root,children,get child(){return actualChild!;},recordFixtureSeedRetirement(error:unknown){for(const leaf of failureLeaves(error))expectedFixtureSeedFailures.add(leaf);},frames,messages,sendCallbacks,release:()=>release?.(),get held(){return !!release;}};
}
it('hands off only original normal-capture observation requests to its fixed recipient before user delivery release',async()=>{
 const f=await original(),{takeOriginalDefaultDispatchObservationRequests:take,consumeOriginalDefaultDispatchObservationRequest:consume}=await load();
 const invocation=f.controller.openCurrentPlan(f.event as never,'p','user');cleanups.push(async()=>invocation.release());const value:any=await invocation.run();expect(value.ok).toBe(true);
 let getters=0;const fake=new Proxy({},{get(){getters++;throw Error('foreign request getter');},getPrototypeOf(){getters++;throw Error('foreign request prototype');}});
 expect(()=>take(f.controller,fake,f.preparationRecipient,f.service)).toThrow();expect(()=>take({...f.controller},invocation,f.preparationRecipient,f.service)).toThrow();expect(()=>take(f.controller,invocation,{},f.service)).toThrow();expect(()=>take(f.controller,invocation,f.preparationRecipient,fake)).toThrow();expect(getters).toBe(0);
 const requests=take(f.controller,invocation,f.preparationRecipient,f.service);expect(requests).toHaveLength(value.operation.children.length);expect(()=>take(f.controller,invocation,f.preparationRecipient,f.service)).toThrow();
 expect(()=>consume(f.controller,fake,f.preparationRecipient,f.service)).toThrow();expect(()=>consume(f.controller,{...requests[0]},f.preparationRecipient,f.service)).toThrow();expect(getters).toBe(0);
 const first=consume(f.controller,requests[0],f.preparationRecipient,f.service);expect(first.data.childKey).toBe(value.operation.children[0].childKey);expect(first.data.parentId).toBe(value.operation.parentId);expect(first.data.scope).toEqual(scope);expect(()=>consume(f.controller,requests[0],f.preparationRecipient,f.service)).toThrow();
 invocation.release();for(let i=1;i<requests.length;i++)expect(()=>consume(f.controller,requests[i],f.preparationRecipient,f.service)).toThrow();expect(first.data.childKey).toBe(value.operation.children[0].childKey);expect(()=>f.controller.businessAdmission(requests[0],{} as never)).toThrow();
},15000);
it('never hands off a captured observation after real user Native revocation',async()=>{
 const f=await original(),{takeOriginalDefaultDispatchObservationRequests:take}=await load(),invocation=f.controller.openCurrentPlan(f.event as never,'p','user');cleanups.push(async()=>invocation.release());expect((await invocation.run() as any).ok).toBe(true);
 f.contents.emit('did-start-navigation',{},f.contents.mainFrame.url,false,true,1,1);expect(()=>take(f.controller,invocation,f.preparationRecipient,f.service)).toThrow();invocation.release();
},15000);
it('observes the real same-client B basis under its independent Native owner after the short user delivery releases',async()=>{
 const f=await original({observe:true}),invocation=f.controller.openCurrentPlan(f.event as never,'p','user');cleanups.push(async()=>invocation.release());const receipt:any=await invocation.run();expect(receipt.ok).toBe(true);
 const observe=(preparationOwners as any).observeOriginalDefaultDispatchPreparation;expect(observe).toBeTypeOf('function');
 const result=observe(f.observationOwner,f.controller,invocation);invocation.release();const observations=await result;expect(observations).toHaveLength(receipt.operation.children.length);
 for(let i=0;i<observations.length;i++)expect(observations[i]).toEqual({childKey:receipt.operation.children[i].childKey,status:'unavailable',reason:'preparation_intent_missing'});
 expect(f.frames.filter(frame=>frame.type==='request').map(frame=>frame.op)).toEqual(['read_plan','capture_default_dispatch','read_preparation_basis']);
 expect(readdirSync(f.root)).not.toContain('tasks');
},15000);
it('observes all original children through one real client without competing for its short RPC slot',async()=>{
 const f=await original({observe:true,extraTasks:true}),invocation=f.controller.openCurrentPlan(f.event as never,'p','user');cleanups.push(async()=>invocation.release());const receipt:any=await invocation.run();expect(receipt.operation.children).toHaveLength(3);
 const result=preparationOwners.observeOriginalDefaultDispatchPreparation(f.observationOwner,f.controller,invocation);invocation.release();const observed=await result;expect(observed).toHaveLength(3);
 for(let i=0;i<observed.length;i++)expect(observed[i]).toEqual({childKey:receipt.operation.children[i].childKey,status:'unavailable',reason:'preparation_intent_missing'});
 expect(f.children).toHaveLength(1);expect(f.frames.filter(frame=>frame.type==='request'&&frame.op==='read_preparation_basis')).toHaveLength(3);
},15000);
async function seedOriginalPreparation(f:Awaited<ReturnType<typeof original>>){
 // Fixture authority only: send one original authenticated B intent, then
 // retire the intentionally desynchronised client and reopen the durable B.
 // This is not Native Main qualification for first prepare/ACK/launch.
 const invocation=f.controller.openCurrentPlan(f.event as never,'p','user');await invocation.run();const observing=preparationOwners.observeOriginalDefaultDispatchPreparation(f.observationOwner,f.controller,invocation);invocation.release();await observing;
 const basisMessage=f.messages.find(row=>row.type==='response'&&row.op==='read_preparation_basis'&&row.result?.ok),child=basisMessage.result.child,wire=f.frames.find(row=>row.type==='request'&&row.op==='read_preparation_basis');
 const {runtimePreparationIntent}=createRequire(import.meta.url)(resolve('../../kswarm/src/core/default-dispatch-runtime-data.js'));
 const target={scope,writerStoreId:child.writerStoreId,projectId:'p',bindingDigest:child.bindingDigest,childKey:child.id,payloadHash:child.payloadHash,hostId:'fixture-original-host',targetParticipantId:'desktop',targetIncarnation:'fixture-original-target',inputMapperVersion:KSWARM_TASK_INPUT_MAPPER_VERSION,inputDigest:'e'.repeat(64)};
 const prototype=runtimePreparationIntent(child,target),input=buildKSwarmTaskCreateInputCandidates({execution:child.payload.execution,runId:prototype.runId,targetParticipantId:'desktop'})[0]!;target.inputDigest=originalChildPreparationInputDigest(input);
 const seed={...wire,id:wire.id+1,op:'prepare_intent',input:target};await new Promise<void>((yes,no)=>f.child.send(seed,error=>error?no(error):yes()));
 let response:any;for(let i=0;i<1000;i++){response=f.messages.find(row=>row.type==='response'&&row.id===seed.id&&row.op==='prepare_intent');if(response)break;await new Promise(yes=>setTimeout(yes,5));}expect(response?.result?.ok).toBe(true);const intent=response.result.preparation;
 await f.service.stop().catch(error=>{f.recordFixtureSeedRetirement(error);console.log(JSON.stringify({fixture:'intent-seed-retired-out-of-band-client',notProductDrain:true}));});await f.service.start();
 const proof=Object.freeze({}),data={scope,projectId:'p',taskId:child.taskId,runId:intent.runId,businessExecutionGeneration:child.businessExecutionGeneration,childKey:child.id,payloadHash:child.payloadHash,bindingDigest:child.bindingDigest,hostId:intent.hostId,input};
 const seedHost=f.population!.createHost({defaultDispatchPreparationSource:{resolve(candidate){if(candidate!==proof)throw Error('fixture seed only');return{data,assertCurrent(){}};}},materialRegistry:new MaterialRegistry({workspaceRoot:join(f.root,'seed-workspace'),maxBytes:1024}),runner:async()=>{throw Error('fixture seed must not execute');},now:()=>1});
 const prepared=await seedHost.prepareDefaultDispatchTask(proof,'scheduler');await f.population!.retireHost(seedHost);return prepared.fact;
}
it('reads the original prepared checkpoint through actual Native-owner B basis and uncached Host IO',async()=>{
 const f=await original({observe:true}),fact=await seedOriginalPreparation(f),invocation=f.controller.openCurrentPlan(f.event as never,'p','user');cleanups.push(async()=>invocation.release());await invocation.run();const result=preparationOwners.observeOriginalDefaultDispatchPreparation(f.observationOwner,f.controller,invocation);invocation.release();const observed=await result;
 expect(observed).toHaveLength(1);expect(observed[0]).toEqual({childKey:fact.childKey,status:'present',fact});
 const path=join(f.root,'tasks','snapshots',fact.taskId+'.json'),snapshot=JSON.parse(readFileSync(path,'utf8'));snapshot.prompt+=' changed outside original store cache';writeFileSync(path,JSON.stringify(snapshot));
 const again=f.controller.openCurrentPlan(f.event as never,'p','user');cleanups.push(async()=>again.release());await again.run();const changed=preparationOwners.observeOriginalDefaultDispatchPreparation(f.observationOwner,f.controller,again);again.release();expect((await changed)[0]?.status).toBe('unavailable');
},20000);
for(const revoke of [false,true])it('keeps accepted Host observation behind the actual original writer SDK on '+(revoke?'navigation revoke':'normal seal'),async()=>{
 const f=await original({observe:true});await seedOriginalPreparation(f);const probe=await fileIo.open(join(f.root,'writer-sdk-probe'),'w'),prototype=Object.getPrototypeOf(probe),sync=prototype.sync;await probe.close();let entered!:()=>void,release!:()=>void,hits=0;
 const ready=new Promise<void>(yes=>{entered=yes;}),held=new Promise<void>(yes=>{release=yes;});let armed=true;
 prototype.sync=function(...args:unknown[]){const raw=Reflect.apply(sync,this,args);if(!armed)return raw;armed=false;hits++;entered();return raw.then(async(value:unknown)=>{await held;return value;});};
 let writing:Promise<unknown>|undefined,observing:Promise<readonly preparationOwners.DefaultDispatchPreparationObservation[]>|undefined,closing:Promise<void>|undefined;
 try{
  writing=f.store!.saveWithReceipt({taskId:'ordinary-writer-gate',sessionId:'ordinary-writer-session',status:'understanding',prompt:'Actual original writer SDK gate',materials:[],events:[],createdAt:1,updatedAt:1});await ready;prototype.sync=sync;expect(hits).toBe(1);
  const invocation=f.controller.openCurrentPlan(f.event as never,'p','user');cleanups.push(async()=>invocation.release());await invocation.run();const before=f.messages.filter(row=>row.type==='response'&&row.op==='read_preparation_basis').length;
  observing=preparationOwners.observeOriginalDefaultDispatchPreparation(f.observationOwner,f.controller,invocation);invocation.release();
  let actual:any;for(let n=0;n<1000;n++){const replies=f.messages.filter(row=>row.type==='response'&&row.op==='read_preparation_basis');actual=replies[before];if(actual&&f.sendCallbacks.some(row=>row.type==='request'&&row.op===actual.op&&row.id===actual.id))break;await new Promise(yes=>setTimeout(yes,5));}expect(actual?.result?.ok).toBe(true);await new Promise(yes=>setTimeout(yes,1));
  const listeners=f.contents.listenerCount('did-start-navigation');expect(listeners).toBeGreaterThan(0);let ownerClosed=false,observed=false;void observing.then(()=>{observed=true;});f.observationOwner!.seal();closing=f.observationOwner!.drain().then(()=>{ownerClosed=true;});
  if(revoke)f.contents.emit('did-start-navigation',{},f.contents.mainFrame.url,false,true,1,1);await new Promise(yes=>setTimeout(yes,20));expect(ownerClosed).toBe(false);expect(observed).toBe(false);expect(f.contents.listenerCount('did-start-navigation')).toBe(listeners);
  release();await writing;const value=await observing;await closing;expect(value[0]?.status).toBe(revoke?'unavailable':'present');expect(f.contents.listenerCount('did-start-navigation')).toBeLessThan(listeners);
 }finally{prototype.sync=sync;release?.();await writing;await observing;await closing;}
},20000);

it('keeps empty command authority default-deny and rejects a fake service before its properties',async()=>{
 const f=await original({start:false});let hooks=0;const raw=new Proxy({},{get(){hooks++;throw Error('candidate getter executed');}});expect(()=>f.controller.businessAdmission(raw,raw as never)).toThrow();expect(()=>f.controller.bindService(raw as never)).toThrow();expect(f.children).toHaveLength(0);expect(hooks).toBe(0);
});
it('rejects non-user ingress before inspecting an event or producing a service request',async()=>{
 const f=await original({start:false});let hooks=0;const event=new Proxy({},{get(){hooks++;throw Error('forbidden event');}});
 for(const source of ['agent','scheduler'] as const)await expect(f.controller.dispatchCurrentPlan(event as never,'p',source)).rejects.toThrow();expect(hooks).toBe(0);expect(f.frames).toHaveLength(0);
});
it('requires its exact original A constructor ports and never creates an A owner for the caller',async()=>{
 const f=await original({start:false,bindA:false}),other=new MainUserSubmissionOwner({dataRoot:f.root,...scope});expect(()=>f.controller.bindUserOwner(other)).toThrow();await expect(f.controller.dispatchCurrentPlan(f.event as never,'p','user')).rejects.toThrow();expect(f.children).toHaveLength(0);other.seal();
});
it('reads the actual B plan, captures original A, and reuses the actual SQLite parent without a random batch',async()=>{
 const f=await original(),first:any=await f.controller.dispatchCurrentPlan(f.event as never,'p','user'),second=await f.controller.dispatchCurrentPlan(f.event as never,'p','user');expect(first.ok).toBe(true);expect(first.operation.parentId).toMatch(/^default-dispatch-parent:/);expect(second).toEqual(first);
 expect(f.frames.filter(frame=>frame.type==='request').map(frame=>frame.op)).toEqual(['read_plan','capture_default_dispatch','read_plan','capture_default_dispatch']);expect(readdirSync(join(f.root,'conversation-projects','user-submissions')).filter(name=>name.endsWith('.json'))).toHaveLength(1);
},15000);
it('keeps the controller bootstrap separate from a user command and rejects copied controller/service membership',async()=>{
 const f=await original({start:false}),{readDefaultDispatchControllerBootstrap:read}=await load();let hooks=0;const fake=new Proxy({},{get(){hooks++;throw Error('trap');}});
 expect(()=>read(fake,fake)).toThrow();expect(()=>read({...f.controller},f.service)).toThrow();expect(()=>read(f.controller,fake)).toThrow();expect(hooks).toBe(0);
 const birth=read(f.controller,f.service);expect(birth.scope).toEqual(scope);expect(birth.source.window).toBe(f.window);expect(()=>birth.assertCurrent()).not.toThrow();expect(()=>f.controller.businessAdmission(birth,{} as never)).toThrow();f.controller.seal();expect(()=>birth.assertLocal()).toThrow();
});
it('does not create A or capture B after the original read SDK synchronously revokes the Native user frame',async()=>{
 let f:Awaited<ReturnType<typeof original>>,armed=true;f=await original({onFrame(frame){if(armed&&frame.type==='request'&&frame.op==='read_plan'){armed=false;f.contents.emit('did-start-navigation',{},f.contents.mainFrame.url,false,true,1,1);}}});
 await expect(f.controller.dispatchCurrentPlan(f.event as never,'p','user')).rejects.toThrow();expect(armed).toBe(false);expect(f.frames.filter(frame=>frame.op==='capture_default_dispatch')).toHaveLength(0);expect(readdirSync(join(f.root,'conversation-projects','user-submissions')).filter(name=>name.endsWith('.json'))).toHaveLength(0);
},15000);
it('can reconcile a real B capture committed after a late user cancellation without a fresh random action',async()=>{
 let f:Awaited<ReturnType<typeof original>>,armed=true;f=await original({onFrame(frame){if(armed&&frame.type==='request'&&frame.op==='capture_default_dispatch'){armed=false;f.contents.emit('did-start-navigation',{},f.contents.mainFrame.url,false,true,1,1);}}});
 await expect(f.controller.dispatchCurrentPlan(f.event as never,'p','user')).rejects.toThrow();expect(armed).toBe(false);
 for(let n=0;n<1000&&!f.messages.some(frame=>frame.type==='response'&&frame.op==='capture_default_dispatch');n++)await new Promise(resolve=>setTimeout(resolve,5));expect(f.messages.some(frame=>frame.type==='response'&&frame.op==='capture_default_dispatch')).toBe(true);
 f.contents.emit('did-stop-loading');const result:any=await f.controller.dispatchCurrentPlan(f.event as never,'p','user');expect(result.ok).toBe(true);expect(readdirSync(join(f.root,'conversation-projects','user-submissions')).filter(name=>name.endsWith('.json'))).toHaveLength(1);
 expect(f.messages.filter(frame=>frame.type==='response'&&frame.op==='capture_default_dispatch').map(frame=>frame.result.operation.parentId)).toEqual([result.operation.parentId,result.operation.parentId]);
},15000);
it('keeps service physical callback custody separate from a drained controller input admission',async()=>{
 const f=await original({holdCapture:true}),call=f.controller.dispatchCurrentPlan(f.event as never,'p','user').catch(()=>{});for(let n=0;n<1000&&!f.held;n++)await new Promise(resolve=>setTimeout(resolve,5));expect(f.held).toBe(true);
 f.controller.seal();await f.controller.drain();await call;let physicalClosed=false;const physical=sealAndDrainKSwarmServiceInstance(f.service).then(()=>{physicalClosed=true;});
 try{await new Promise(resolve=>setTimeout(resolve,30));expect(physicalClosed).toBe(false);expect(()=>process.kill(f.children[0]!.pid!,0)).not.toThrow();console.log(JSON.stringify({test:'controller-input-versus-service-physical',controllerInputDrained:true,servicePhysicalClosed:physicalClosed,heldCallback:f.held,notWholeNativeDrain:true}));}finally{f.release();await physical;}
},15000);
it('keeps the original delivery frame and Root alive after business work until its explicit output release',async()=>{
 const f=await original(),invocation=(f.controller as any).openCurrentPlan(f.event,'p','user');cleanups.push(async()=>invocation.release());const work=invocation.run();expect(invocation.run()).toBe(work);const value=await work;expect(value.ok).toBe(true);invocation.assertCurrent();
 let drained=false;const drain=f.controller.drain().then(()=>{drained=true;});await new Promise(yes=>setTimeout(yes,20));expect(drained).toBe(false);expect(()=>invocation.assertCurrent()).toThrow();invocation.release();await drain;expect(f.frames.filter(frame=>frame.type==='request')).toHaveLength(2);
},15000);
it('withdraws a completed original business result after Native navigation before IPC delivery',async()=>{
 const f=await original(),invocation=(f.controller as any).openCurrentPlan(f.event,'p','user');cleanups.push(async()=>invocation.release());expect((await invocation.run()).ok).toBe(true);f.contents.emit('did-start-navigation',{},f.contents.mainFrame.url,false,true,1,1);expect(()=>invocation.assertCurrent()).toThrow();invocation.release();
},15000);
it('seals an original unopened run without inventing a pending producer or sending a request',async()=>{
 const f=await original({start:false}),invocation=(f.controller as any).openCurrentPlan(f.event,'p','user');cleanups.push(async()=>invocation.release());f.controller.seal();await f.controller.drain();await expect(invocation.run()).rejects.toThrow();expect(f.frames).toHaveLength(0);expect(f.children).toHaveLength(0);
});
for(const field of ['sender','senderFrame'])it('owns a held Native event '+field+' SDK raw after refusing final output',async()=>{
 const f=await original(),invocation=f.controller.openCurrentPlan(f.event as never,'p','user');cleanups.push(async()=>invocation.release());expect((await invocation.run() as any).ok).toBe(true);let release!:()=>void;const raw=new Promise<void>(yes=>{release=yes;});
 Object.defineProperty(f.event,field,{configurable:true,get(){return raw;}});expect(()=>invocation.assertCurrent()).toThrow();invocation.release();let drained=false;const drain=f.controller.drain().then(()=>{drained=true;},()=>{drained=true;});try{await new Promise(yes=>setTimeout(yes,20));expect(drained).toBe(false);}finally{release();await drain;}
},15000);
