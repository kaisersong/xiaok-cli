// Fixed constructor identity only; no Native/Host/B permission is asserted here.
import {afterEach,expect,it,vi} from 'vitest';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createRequire} from 'node:module';
import * as original from '../../electron/kswarm-service.js';
import {scope,services,cleanups,childFixture} from '../support/kswarm-owned-preparation-fixture.js';
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
