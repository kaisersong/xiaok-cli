// Fixed constructor identity only; no Native/Host/B permission is asserted here.
import {afterEach,expect,it,vi} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createRequire} from 'node:module';
import * as original from '../../electron/kswarm-service.js';
import {RoomWorkspaceLocalStore,prepareWorkspaceRoot,workspaceDigest} from '../../electron/room-workspace-local.js';
import {createRoomWorkspaceRuntime,readOriginalRoomProjectRootBinding,readOriginalRoomProjectRoot,assertOriginalRoomProjectRootCurrent,revalidateOriginalRoomProjectRoot} from '../../electron/room-workspace-runtime.js';
import {createKSwarmRuntimeBridge,readOriginalKSwarmHandoffRoot,readOriginalKSwarmHandoffRootBinding,assertOriginalKSwarmHandoffRootCurrent,revalidateOriginalKSwarmHandoffRoot} from '../../electron/kswarm-runtime-bridge.js';
const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},services:original.KSwarmService[]=[];
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{try{for(const cleanup of cleanups.splice(0).reverse())await cleanup();for(const service of services.splice(0))await original.sealAndDrainKSwarmServiceInstance(service);}finally{vi.unstubAllGlobals();vi.unstubAllEnvs();}});
function source(){let calls=0;return{port:{resolveWork(){calls++;throw Error('no original work');},observeWork(){calls++;},sealWork(){calls++;}},get calls(){return calls;}};}
it('pins only exact original preparation constructor identities without granting a pre-start transport',async()=>{
 const read=(original as any).readKSwarmOwnedPreparationServiceScope,get=(original as any).getKSwarmOwnedPreparationTransport;expect(read).toBeTypeOf('function');expect(get).toBeTypeOf('function');
 const f=source(),admission=()=>{},user=()=>{},service=original.createKSwarmService({desktopProjectScope:scope,ownedPreparationSource:f.port,ownedPreparationAdmission:admission,ownedBusinessAdmission:user} as any);services.push(service);
 expect(read(service,f.port,admission)).toEqual(scope);expect(()=>get(service,f.port,admission)).toThrow(/UNAVAILABLE/);expect(()=>read(service,f.port,user)).toThrow();expect(()=>read(service,source().port,admission)).toThrow();
 let traps=0;const fake=new Proxy({},{get(){traps++;throw Error('candidate get');},getOwnPropertyDescriptor(){traps++;throw Error('candidate descriptor');}});
 expect(()=>read(fake,f.port,admission)).toThrow();expect(()=>read({...service},f.port,admission)).toThrow();expect(()=>read(service,fake,admission)).toThrow();expect(traps).toBe(0);expect(f.calls).toBe(0);
 await original.sealAndDrainKSwarmServiceInstance(service);services.splice(services.indexOf(service),1);expect(()=>read(service,f.port,admission)).toThrow(/CLOSED/);
});
it('rejects half bundles and accessor preparation constructor options without invoking their getters',()=>{
 const f=source(),admission=()=>{};let getters=0;
 for(const pair of [{ownedPreparationSource:f.port},{ownedPreparationAdmission:admission},Object.defineProperty({ownedPreparationAdmission:admission},'ownedPreparationSource',{get(){getters++;return f.port;}}),Object.defineProperty({ownedPreparationSource:f.port},'ownedPreparationAdmission',{get(){getters++;return admission;}})]){
  const options=Object.create(null,Object.getOwnPropertyDescriptors(pair));Object.defineProperty(options,'desktopProjectScope',{value:scope});
  expect(()=>{const service=original.createKSwarmService(options);services.push(service);}).toThrow('DISPATCH_PREPARATION_FIXED_SOURCE_REQUIRED');
 }
 expect(getters).toBe(0);expect(f.calls).toBe(0);
});

async function childFixture(userEnabled:boolean,beforeStart?:(source:any)=>void){
 const root=mkdtempSync(join(tmpdir(),'dsh-service-preparation-')),entry=resolve('../../kswarm/test/fixtures/owned-preparation-family/entry.js');
 let healthy=false,child:ChildProcess|undefined,output='',closed:Promise<{code:number|null;signal:NodeJS.Signals|null}>|undefined,ready:any,observer:((cut:unknown)=>void)|undefined,ackRelease:(()=>void)|undefined,sourceClosed=false,cut=false;
 const proof=Object.freeze({}),custody=Object.freeze(Object.create(null)),signal=new AbortController(),frames:any[]=[],userProofs=new WeakMap<object,{operation:string;input:unknown}>();
 let service:original.KSwarmService;
 const preparationSource={resolveWork(this:unknown,candidate:object,audience:any){if(this!==preparationSource)throw Error('original_source_receiver_required');if(candidate!==proof||audience.serviceOwner!==service||audience.projectId!=='p'||sourceClosed)throw Error('controlled_original_preparation_required');return{workId:'d'.repeat(64),sourceIncarnation:'f'.repeat(64),custody};},observeWork(this:unknown,value:object,callback:(cut:unknown)=>void){if(this!==preparationSource)throw Error('original_source_receiver_required');if(value!==custody)throw Error('controlled_custody_required');observer=callback;},sealWork(this:unknown,value:object){if(this!==preparationSource)throw Error('original_source_receiver_required');if(value!==custody)throw Error('controlled_custody_required');sourceClosed=true;/* Accepted future ACK still belongs to this controlled Source. */}};
 const admission=(candidate:object,audience:any)=>{if(candidate!==proof||audience.serviceOwner!==service||audience.projectId!=='p')throw Error('controlled_original_preparation_required');if(sourceClosed&&audience.operation!=='read_prepare_call'&&audience.operation!=='ack_prepared')throw Error('controlled_preparation_closed');};
 const userAdmission=(candidate:object,audience:any)=>{const row=userProofs.get(candidate);if(!row||audience.serviceOwner!==service||audience.operation!==row.operation||JSON.stringify(audience.input)!==JSON.stringify(row.input))throw Error('controlled_user_required');};
 vi.stubEnv('KSWARM_SERVER_PATH',entry);
 vi.stubGlobal('fetch',vi.fn(async(input:unknown)=>{const url=String(input);if(url.includes(':4400/health'))return new Response(JSON.stringify({ok:healthy,features:['dynamic_workflows'],service:{entryPath:entry,sourceHash:original.computeKSwarmServiceSourceHash(entry)}}),{status:healthy?200:503});if(url.endsWith('/execution-start-admission'))return new Response(JSON.stringify({ok:true,protocol:'ordinary_project_execution_start_read_v1',projectId:'p',classification:'legacy_ordinary',bindingDigest:null,scope}));if(url.endsWith('/agents'))return new Response(JSON.stringify({agents:[]}));return new Response(JSON.stringify({ok:true}));}));
 service=original.createKSwarmService({desktopProjectScope:scope,ownedPreparationSource:preparationSource,ownedPreparationAdmission:admission,...(userEnabled?{ownedBusinessAdmission:userAdmission}:{}),findPortOwner:async()=>null,spawnProcess:((_command,_args,options)=>{
  if(child)throw Error('fixture must retain a single child');
  // This fixture adapter closes the existing original endpoint through its
  // own stdin control after the service has drained the business prefix.
  const adapter="process.on('SIGTERM',()=>process.stdin.emit('data',Buffer.from('release\\nclose\\n')));await import("+JSON.stringify(pathToFileURL(entry).href)+");";
  child=spawn(process.execPath,['--input-type=module','-e',adapter],{...options,stdio:['pipe','pipe','pipe','ipc'],env:{...options?.env,PREPARATION_FAMILY_FIXTURE_ROOT:root,ELECTRON_RUN_AS_NODE:'1'}});
  closed=new Promise(yes=>child!.once('close',(code,signal)=>{healthy=false;yes({code,signal});}));child.stdout!.on('data',chunk=>{output+=String(chunk);});child.stderr!.on('data',chunk=>{output+=String(chunk);});
  child.on('message',(message:any)=>{if(message.protocol==='fixture_ready'){ready=message;healthy=true;}});
  const send=child.send!.bind(child);Object.defineProperty(child,'send',{value:(frame:any,callback:any)=>{frames.push(frame);return send(frame,error=>{if(frame.op==='ack_prepared')ackRelease=()=>callback(error);else callback(error);});}});return child;
 }) as typeof spawn});
 cleanups.push(async()=>{ackRelease?.();if(!cut){observer?.({disposition:'no_ack'});cut=true;}child?.stdin?.write('release\n');await original.sealAndDrainKSwarmServiceInstance(service);const result=await closed!;console.log(JSON.stringify({fixture:'service-preparation-original-child',pid:child?.pid,...result,reaped:true,notNativeQualification:true,notWholeResourceDrain:true}));expect(result.code,output).toBe(0);expect(result.signal).toBe(null);rmSync(root,{recursive:true,force:true,maxRetries:5});});
 beforeStart?.(preparationSource);await service.start();expect(ready,output).toBeDefined();
 const facet=original.getKSwarmOwnedPreparationTransport(service,preparationSource,admission),context={requestSource:'scheduler' as const,preparationProof:proof,signal:signal.signal};
 return{root,service,source:preparationSource,admission,userAdmission,frames,ready,facet,context,open(lookup:any){return facet.openWork('p',lookup,context);},user(operation:string,input:unknown=null){const admission=Object.freeze({});userProofs.set(admission,{operation,input});return{requestSource:'user' as const,admission,signal:signal.signal};},noAck(){observer!({disposition:'no_ack'});cut=true;},cut(){observer!({disposition:'ack_registered'});cut=true;},release(){child!.stdin!.write('release\n');ackRelease?.();},get ackHeld(){return !!ackRelease;},get child(){return child!;}};
}
it('installs the preparation-only facet on its one actual child while the user transport remains denied',async()=>{
 const f=await childFixture(false),work=f.open({childKey:'default-dispatch-child:'+'1'.repeat(64),payloadHash:'2'.repeat(64)});
 const basis:any=await work.readBasis();expect(basis.ok).toBe(false);expect(f.frames.filter(row=>row.family==='preparation'&&row.op==='read_preparation_basis')).toHaveLength(1);
 expect(()=>original.getKSwarmOwnedBusinessTransport(f.service,f.admission)).toThrow('DISPATCH_BUSINESS_ORIGINAL_ADMISSION_REQUIRED');
},15000);
it('reads only original accepted Work identity during normal service retirement',async()=>{
 const f=await childFixture(false),work=f.open({childKey:'default-dispatch-child:'+'1'.repeat(64),payloadHash:'2'.repeat(64)}),read=(original as any).readOriginalPreparationAcceptedWorkBinding;
 expect(read).toBeTypeOf('function');const binding=read(f.service,f.source,f.admission,work);expect(binding.scope).toEqual(scope);binding.assertCurrent();
 let traps=0;const fake=new Proxy({},{get(){traps++;throw Error('foreign work getter');},getOwnPropertyDescriptor(){traps++;throw Error('foreign work descriptor');}});
 for(const args of [[fake,f.source,f.admission,work],[f.service,fake,f.admission,work],[f.service,f.source,()=>{},work],[f.service,f.source,f.admission,fake],[f.service,f.source,f.admission,{...work}]])expect(()=>read(...args)).toThrow();expect(traps).toBe(0);
 expect((await work.readBasis() as any).ok).toBe(false);let stopped=false;const stopping=f.service.stop().then(()=>{stopped=true;});
 try{await delay(20);expect(stopped).toBe(false);expect(()=>original.getKSwarmOwnedPreparationTransport(f.service,f.source,f.admission)).toThrow();binding.assertCurrent();}
 finally{f.noAck();await stopping;}expect(()=>binding.assertCurrent()).toThrow();
},15000);
it('keeps accepted genuine readCall and ACK alive across service seal and joins their actual parent callback',async()=>{
 const f=await childFixture(true),user=original.getKSwarmOwnedBusinessTransport(f.service,f.userAdmission),plan:any=await user.readPlan('p',f.user('read_plan'));
 const {defaultDispatchActionRecord}=createRequire(import.meta.url)(resolve('../../kswarm/src/core/default-dispatch-action-data.js'));
 const action=defaultDispatchActionRecord({scope,projectId:'p',planRevision:plan.plan.revision,dispatchGeneration:plan.plan.dispatchGeneration,bindingDigest:plan.plan.bindingDigest,taskSetDigest:plan.plan.taskSetDigest}),captured:any=await user.captureDefaultDispatch('p',action,f.user('capture_default_dispatch',action)),target=captured.operation.children[0];
 const work=f.open({childKey:target.childKey,payloadHash:target.payloadHash}),basis:any=await work.readBasis();expect(basis.ok).toBe(true);
 const prepared:any=await work.prepareIntent({scope,writerStoreId:f.ready.writerStoreId,projectId:'p',bindingDigest:basis.child.bindingDigest,childKey:target.childKey,payloadHash:target.payloadHash,hostId:'host',targetParticipantId:'desktop',targetIncarnation:'controlled-native-target',inputMapperVersion:'kswarm_task_handoff_prompt_v1',inputDigest:'e'.repeat(64)}),intent=prepared.preparation;
 const sent:any=await work.admitSend({preparationIntentDigest:intent.intentDigest,sourceIncarnation:'f'.repeat(64)});expect(sent.sendStatus).toBe('send_started');
 let stopped=false;const stop=f.service.stop().then(()=>{stopped=true;});
 try{
  expect(()=>f.open({childKey:target.childKey,payloadHash:target.payloadHash})).toThrow();await expect(work.prepareIntent({late:true})).rejects.toThrow();
  const current:any=await work.readCall({admissionId:sent.preparation.admissionId,preparationIntentDigest:intent.intentDigest});expect(current.ok).toBe(true);
  const marker={version:1,contract:'ordinary_default_dispatch_task_preparation_v1',scope:intent.scope,projectId:intent.projectId,kswarmTaskId:intent.kswarmTaskId,runId:intent.runId,businessExecutionGeneration:intent.businessExecutionGeneration,childKey:intent.childKey,payloadHash:intent.payloadHash,bindingDigest:intent.bindingDigest,hostId:intent.hostId,inputDigest:intent.inputDigest,taskId:intent.taskId,sessionId:intent.sessionId,preparationId:intent.preparationId,preparedContentDigest:'a'.repeat(64)};
  const ack=work.acknowledge({preparationIntentDigest:intent.intentDigest,fact:marker});for(let n=0;n<100&&!f.ackHeld;n++)await delay(5);expect(f.ackHeld).toBe(true);f.cut();await delay(20);expect(stopped).toBe(false);expect(()=>process.kill(f.child.pid!,0)).not.toThrow();
  // Rejection of a new prepared fact cannot wash the original ACK SDK tail.
  // The controlled marker does not supply Native Host/effect permission.
  f.release();const result:any=await ack;expect(result).toMatchObject({ok:false,error:'DURABLE_DISPATCH_HOST_EFFECT_PERMISSION_UNAVAILABLE'});expect(result.preparation).toBeUndefined();await stop;expect(stopped).toBe(true);
  const business=f.frames.filter(row=>row.protocol==='kswarm_dispatch_business_v1');expect(new Set(business.map(row=>row.nonce)).size).toBe(1);expect(business.find(row=>row.type==='seal_prefix').throughId).toBe(7);
 }finally{f.release();await stop;}
},15000);

it('keeps its original constructor Source methods when their mutable public slots change before actual spawn',async()=>{
 let lateCalls=0;cleanups.push(async()=>{expect(lateCalls).toBe(0);});
 const f=await childFixture(false,source=>{for(const name of ['resolveWork','observeWork','sealWork'])source[name]=()=>{lateCalls++;throw Error('late Source slot must not run');};});
 let work:ReturnType<typeof f.open>|undefined,error:unknown;try{work=f.open({childKey:'default-dispatch-child:'+'1'.repeat(64),payloadHash:'2'.repeat(64)});}catch(reason){error=reason;}
 expect(lateCalls).toBe(0);expect(error).toBeUndefined();expect((await work!.readBasis() as any).ok).toBe(false);
});

it('rejects malformed or unpaired independent Host settlement constructors before calling getters',()=>{
 const f=source();let calls=0;const sync={resolveRegistration(){calls++;},resolveNoEffectSettlement(){calls++;}},admission=()=>{};
 for(const host of [new Proxy(sync,{}),{...sync,resolveRegistration:async()=>{}},Object.defineProperty({...sync},'resolveRegistration',{get(){calls++;return sync.resolveRegistration;}})]){
  expect(()=>{const service=original.createKSwarmService({desktopProjectScope:scope,ownedPreparationSource:f.port,ownedPreparationAdmission:admission,ownedHostSettlementSource:host} as any);services.push(service);}).toThrow('DISPATCH_PREPARATION_HOST_SOURCE_REQUIRED');
 }
 expect(()=>{const service=original.createKSwarmService({desktopProjectScope:scope,ownedHostSettlementSource:sync} as any);services.push(service);}).toThrow('DISPATCH_PREPARATION_HOST_SOURCE_REQUIRED');expect(calls).toBe(0);
});

it('keeps original identity passive, checks the actual child, and makes local checks SDK-free',async()=>{
 let traps=0;const fake=new Proxy({},{get(){traps++;throw Error('foreign get');},getOwnPropertyDescriptor(){traps++;throw Error('foreign descriptor');}});
 expect(()=>original.readOriginalKSwarmServiceIdentity(fake)).toThrow('KSWARM_ORIGINAL_SERVICE_REQUIRED');expect(traps).toBe(0);
 const dormant=original.createKSwarmService({desktopProjectScope:scope});services.push(dormant);
 const before=original.readOriginalKSwarmServiceIdentity(dormant);expect(before.scope).toEqual(scope);expect(()=>before.assertCurrent()).toThrow(/NOT_CURRENT/);expect(()=>before.assertLocal()).toThrow(/NOT_CURRENT/);
 expect(original.readOriginalKSwarmServiceIdentity(dormant).constructorId).toBe(before.constructorId);
 const f=await childFixture(false),live=original.readOriginalKSwarmServiceIdentity(f.service);live.assertCurrent();live.assertLocal();
 const prior=Object.getOwnPropertyDescriptor(f.child,'connected');let reads=0;
 const raw=Object.freeze({unexpected:'connected'});
 Object.defineProperty(f.child,'connected',{configurable:true,get(){reads++;return raw;}});
 try{live.assertLocal();expect(reads).toBe(0);let failure:unknown;try{live.assertCurrent();}catch(error){failure=error;}expect(failure).toBeInstanceOf(Error);expect((failure as Error).cause).toBe(raw);expect(reads).toBe(1);}finally{if(prior)Object.defineProperty(f.child,'connected',prior);else Reflect.deleteProperty(f.child,'connected');}
 await original.sealAndDrainKSwarmServiceInstance(f.service);expect(()=>live.assertLocal()).toThrow(/NOT_CURRENT/);
},15000);

it('creates a direct candidate only at the original accepted handoff and revokes it on changed file bytes',async()=>{
 const f=await childFixture(false),handoffPath=join(f.root,'direct-handoff.json'),raw=JSON.stringify({kind:'kswarm_task_handoff_v1',runId:'run-1',project:{id:'p',name:'P',goal:'G'},task:{id:'task-1',title:'T'}});writeFileSync(handoffPath,raw);
 let proof:object|undefined,started!:()=>void,finish!:()=>void;
 const ready=new Promise<void>(yes=>{started=yes;}),held=new Promise<void>(yes=>{finish=yes;});
 const publicRead=f.service.readProjectExecutionStart,publicAssert=f.service.assertProjectExecutionStartRead;
 f.service.readProjectExecutionStart=async()=>{throw Error('replaced public read');};f.service.assertProjectExecutionStartRead=()=>{throw Error('replaced public assert');};
 const bridge=createKSwarmRuntimeBridge({kswarmService:f.service,allowedRoots:[f.root],async runDesktopTask(input){proof=input.originalRootCandidate;started();await held;return{summary:'accepted fixture'};},async submitResult(){return new Response('{}');}});
 const pending=bridge.handleTaskHandoff({handoffPath,projectId:'p',taskId:'task-1',runId:'run-1'});
 try{
  await ready;expect(proof).toBeDefined();readOriginalKSwarmHandoffRootBinding(bridge,f.service);
  const view=readOriginalKSwarmHandoffRoot(bridge,proof!);expect(view).toMatchObject({kind:'original_kswarm_handoff_root_candidate_v1',candidateOnly:true,scope,projectId:'p',taskId:'task-1',runId:'run-1'});assertOriginalKSwarmHandoffRootCurrent(bridge,proof!);await revalidateOriginalKSwarmHandoffRoot(bridge,proof!);
  expect(()=>readOriginalKSwarmHandoffRoot({...bridge},proof!)).toThrow();expect(()=>readOriginalKSwarmHandoffRoot(bridge,{})).toThrow();
  writeFileSync(handoffPath,raw+' ');await expect(revalidateOriginalKSwarmHandoffRoot(bridge,proof!)).rejects.toThrow('KSWARM_DIRECT_HANDOFF_CHANGED');writeFileSync(handoffPath,raw);expect(()=>assertOriginalKSwarmHandoffRootCurrent(bridge,proof!)).toThrow('KSWARM_DIRECT_HANDOFF_CHANGED');
 }finally{finish();await pending;f.service.readProjectExecutionStart=publicRead;f.service.assertProjectExecutionStartRead=publicAssert;}
 expect(()=>readOriginalKSwarmHandoffRoot(bridge,proof!)).toThrow();
},15000);

it('keeps Room project acceptance separate from discussion and direct handoff candidates',async()=>{
 const f=await childFixture(false),store=new RoomWorkspaceLocalStore(join(f.root,'room-local.sqlite')),physical=await prepareWorkspaceRoot(f.root);
 store.prepareBinding({...physical,bindingId:'b',roomId:'r',workspaceId:'w',hostId:'h',generation:1,requestId:'q',payloadDigest:workspaceDigest('binding',physical),createdBy:'user.local'});store.activateBinding('b',{workspaceId:'w',activeBindingId:'b',generation:1});
 const config={activeBindingId:'b',workspaceId:'w',originHostId:'h',generation:1,revision:3,phase:'active'};
 const broker={async get(){return{ok:true,config};},async request(_roomId:string,action:string,input:any){if(action==='acquire')return{ok:true,claim:{...config,...input,roomId:'r',workspaceRevision:3,bindingId:'b',claimId:'claim',protocolVersion:1,hostIncarnation:1,instructionsRevision:0,executionState:'admitted',authorizationState:'valid'}};return{ok:true};}};
 let proof:object|undefined,started!:()=>void,finish!:()=>void;
 const ready=new Promise<void>(yes=>{started=yes;}),held=new Promise<void>(yes=>{finish=yes;});
 const runtime=createRoomWorkspaceRuntime({kswarmService:f.service,store,broker,wake:{async claimWake(){return{};},async completeWake(){return{};}},async execute(){throw Error('discussion must not execute');},async ensureProtocol(){},projectAdapter:{async resolve(){return{mapping:{workFolder:realpathSync(f.root),artifactsDir:realpathSync(f.root),mappingRevision:1},task:{id:'p__t'}};},async dispatch(){return{ok:true};},async authorize(){return{};}} as any,async executeProject(input){proof=input.originalRootCandidate;started();await held;await input.workspace.port.release(input.workspace.context,{executorInstanceId:input.workspace.context.executorInstanceId,kind:'resources-disposed',verified:true});}});
 try{
  await runtime.prepareProjectTask({roomId:'r',projectId:'p',taskId:'p__t',logicalAgentId:'a',requestId:'source'});
  const context=store.getRecord<any>('project-execution','claim')!.context;
  const pending=runtime.runProjectTask({handoff:{kind:'kswarm_task_handoff_v1',runId:context.runId,project:{id:'p',name:'P',goal:'G'},task:{id:'p__t',title:'T'},workspaceContext:context},targetParticipantId:'a'});
  try{await ready;expect(proof).toBeDefined();readOriginalRoomProjectRootBinding(runtime,f.service);expect(readOriginalRoomProjectRoot(runtime,proof!)).toMatchObject({kind:'original_room_project_root_candidate_v1',candidateOnly:true,scope,roomId:'r',projectId:'p',taskId:'p__t',claimId:'claim'});assertOriginalRoomProjectRootCurrent(runtime,proof!);await revalidateOriginalRoomProjectRoot(runtime,proof!);expect(()=>readOriginalRoomProjectRoot(runtime,{})).toThrow();expect(()=>readOriginalKSwarmHandoffRoot(runtime,proof!)).toThrow();}finally{finish();expect(await pending).toEqual({ok:true});}
  expect(()=>readOriginalRoomProjectRoot(runtime,proof!)).toThrow(/NOT_CURRENT/);
 }finally{finish();await runtime.shutdown();store.close();}
},15000);
