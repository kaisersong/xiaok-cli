// Original daemon, original supervised Server/Broker, isolated databases.
// Parent wire and marker are controlled; no NativeMain/Host IO qualification.
import {afterEach,expect,it} from 'vitest';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {compileFunction,constants as vmConstants} from 'node:vm';
// Use Node's real ESM loader for the sibling's Native startup graph.
const importOriginalNodeModule=compileFunction('return import(url)',['url'],{importModuleDynamically:vmConstants.USE_MAIN_CONTEXT_DEFAULT_LOADER}) as (url:string)=>Promise<any>;
import {join,resolve} from 'node:path';
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {ownedConfigDaemonFixture} from '../support/owned-config-daemon-fixture.js';
import {createOwnedCanonicalBusiness,readOwnedCanonicalPreparationFacet} from '../../../src/runtime/conversation-activity/owned-canonical-business.js';
const protocol='activity_dispatch_business_v1',cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
async function original(runtime=false,mode?:string){
 const f=await ownedConfigDaemonFixture(cleanup=>cleanups.push(cleanup),{seedDispatch:true,seedRuntime:runtime,...(mode?{daemonPreload:resolve('tests/e2e/fixtures/canonical-dispatch-sdk.cjs'),daemonEnv:{BUSINESS_SDK_MODE:mode}}:{})}),frames:any[]=[];f.child.on('message',(row:any)=>{if(row?.protocol===protocol)frames.push(row);});
 f.child.send({protocol,type:'probe',scope:f.scope,mainLaunchNonce:'e'.repeat(64)});const hello=await f.wait(()=>frames.find(row=>row.type==='hello_ack'));
 const session={protocol,scope:f.scope,mainLaunchNonce:'e'.repeat(64),daemonBoot:hello.daemonBoot,ownerEpoch:hello.ownerEpoch,connectionIncarnation:hello.connectionIncarnation,targetGeneration:hello.targetGeneration,childBoot:hello.childBoot};let sequence=0;
 async function call(op:string,input:unknown,preparation=false){const id=++sequence;f.child.send({...session,type:'request',id,op,projectId:'p',input,...(preparation?{family:'preparation',workId:'d'.repeat(64),sourceIncarnation:'f'.repeat(64)}:{})});return f.wait(()=>frames.find(row=>row.type==='response'&&row.id===id||row.type==='fault'));}
 const plan=(await call('read_plan',null)).result.plan,{defaultDispatchActionRecord}=createRequire(import.meta.url)(resolve('../../kswarm/src/core/default-dispatch-action-data.js'));
 const fact=defaultDispatchActionRecord({scope:f.scope,projectId:'p',planRevision:plan.revision,dispatchGeneration:plan.dispatchGeneration,bindingDigest:plan.bindingDigest,taskSetDigest:plan.taskSetDigest}),captured=await call('capture_default_dispatch',fact);
 return{...f,frames,session,call,childData:captured.result.operation.children[0],sequence:()=>sequence};
}
it('keeps a preparation work alive across actual daemon RPCs and closes its no-ACK producer before the two-hop prefix',async()=>{
 const f=await original(),lookup={childKey:f.childData.childKey,payloadHash:f.childData.payloadHash};const basis=await f.call('read_preparation_basis',lookup,true);expect(basis.type).toBe('response');expect(basis.result?.ok).toBe(true);expect(basis.family).toBe('preparation');expect(basis.workId).toBe('d'.repeat(64));
 const again=await f.call('read_preparation_basis',lookup,true);expect(again.result).toEqual(basis.result);expect((await f.call('read_plan',null)).result.ok).toBe(true);
 f.child.send({...f.session,type:'seal_prefix',throughId:f.sequence(),sealNonce:'9'.repeat(64)});const marker=await f.wait(()=>f.frames.find(row=>row.type==='prefix_drained'||row.type==='fault'));expect(marker.type).toBe('prefix_drained');expect(marker.throughId).toBe(f.sequence());
},15000);
it('allows the next genuine RPC after delivery while retaining the earlier upper send callback',async()=>{
 const f=await original(false,'held-preparation-response'),lookup={childKey:f.childData.childKey,payloadHash:f.childData.payloadHash};try{
  expect((await f.call('read_preparation_basis',lookup,true)).result?.ok).toBe(true);await f.wait(()=>existsSync(join(f.root,'held-preparation-response.json'))?true:undefined);
  const next=await f.call('read_preparation_basis',lookup,true);expect(next.result?.ok,JSON.stringify(next)).toBe(true);
  f.child.send({...f.session,type:'seal_prefix',throughId:f.sequence(),sealNonce:'9'.repeat(64)});await delay(20);expect(f.frames.some(row=>row.type==='prefix_drained')).toBe(false);
 }finally{writeFileSync(join(f.root,'release-preparation-response'),'1');}
 const marker=await f.wait(()=>f.frames.find(row=>row.type==='prefix_drained'||row.type==='fault'));expect(marker.type).toBe('prefix_drained');
},15000);
it('refuses a positive upper delivery when the original lower session faults after fulfillment',async()=>{
 const f=await original(false,'preparation-late-fault'),reply=await f.call('read_preparation_basis',{childKey:f.childData.childKey,payloadHash:f.childData.payloadHash},true);await f.wait(()=>existsSync(join(f.root,'preparation-delivery-fault.json'))?true:undefined);expect(reply.result?.ok,JSON.stringify(reply)).not.toBe(true);expect(reply.error?.code).toBe('CONTROLLED_LOWER_FAULT');
},15000);
it('uses the actual upper client and both original hops through intent, real Broker send and controlled ACK',async()=>{
 const f=await ownedConfigDaemonFixture(cleanup=>cleanups.push(cleanup),{seedDispatch:true,seedRuntime:true}),owner={},user=Object.freeze({}),proof=Object.freeze({}),custody=Object.freeze(Object.create(null)),signal=new AbortController();let observer:((cut:unknown)=>void)|undefined,closed=false;
 const source={resolveWork(value:object,audience:any){if(value!==proof||audience.serviceOwner!==owner||audience.projectId!=='p')throw Error('controlled_work_required');return{workId:'d'.repeat(64),sourceIncarnation:'f'.repeat(64),custody};},observeWork(value:object,callback:(cut:unknown)=>void){if(value!==custody)throw Error('controlled_custody_required');observer=callback;},sealWork(value:object){if(value!==custody)throw Error('controlled_custody_required');if(!closed)observer!({disposition:'no_ack'});}};
 const admission=(value:object,audience:any)=>{if(value!==proof||audience.serviceOwner!==owner||audience.projectId!=='p')throw Error('controlled_work_required');};
 const client=createOwnedCanonicalBusiness({child:f.child,scope:f.scope,serviceOwner:owner,mainLaunchNonce:'e'.repeat(64),ownerEpoch:f.hello.ownerEpoch as string,isCurrent:()=>f.child.connected===true,preparationSource:source,preparationAdmission:admission,admit(value,audience){if(value!==user||audience.serviceOwner!==owner||audience.projectId!=='p')throw Error('controlled_user_required');}});
 try{
  const context={requestSource:'user' as const,admission:user,signal:signal.signal},plan:any=await client.readPlan('p',context),{defaultDispatchActionRecord}=createRequire(import.meta.url)(resolve('../../kswarm/src/core/default-dispatch-action-data.js')),head=plan.plan;
  const captured:any=await client.captureDefaultDispatch('p',defaultDispatchActionRecord({scope:f.scope,projectId:'p',planRevision:head.revision,dispatchGeneration:head.dispatchGeneration,bindingDigest:head.bindingDigest,taskSetDigest:head.taskSetDigest}),context),child=captured.operation.children[0],work=readOwnedCanonicalPreparationFacet(client,source,admission).openWork('p',{childKey:child.childKey,payloadHash:child.payloadHash},{requestSource:'scheduler',preparationProof:proof,signal:signal.signal});
  const basis:any=await work.readBasis(),config=JSON.parse(readFileSync(join(f.root,'owner.json'),'utf8')),{createBrokerClient}=await importOriginalNodeModule(pathToFileURL(resolve('../../kswarm/src/net/broker-client.js')).href);await createBrokerClient({brokerUrl:config.kswarm.brokerUrl,participantId:'desktop',silent:true}).register();
  const prepared:any=await work.prepareIntent({scope:f.scope,writerStoreId:basis.child.writerStoreId,projectId:'p',bindingDigest:basis.child.bindingDigest,childKey:child.childKey,payloadHash:child.payloadHash,hostId:'host',targetParticipantId:'desktop',targetIncarnation:'controlled-native-target',inputMapperVersion:'kswarm_task_handoff_prompt_v1',inputDigest:'e'.repeat(64)});expect(prepared.ok).toBe(true);const p=prepared.preparation,sent:any=await work.admitSend({preparationIntentDigest:p.intentDigest,sourceIncarnation:'f'.repeat(64)});expect(sent.sendStatus).toBe('send_started');expect((await work.readCall({admissionId:sent.preparation.admissionId,preparationIntentDigest:p.intentDigest}) as any).ok).toBe(true);
  const fact={version:1,contract:'ordinary_default_dispatch_task_preparation_v1',scope:p.scope,projectId:p.projectId,kswarmTaskId:p.kswarmTaskId,runId:p.runId,businessExecutionGeneration:p.businessExecutionGeneration,childKey:p.childKey,payloadHash:p.payloadHash,bindingDigest:p.bindingDigest,hostId:p.hostId,inputDigest:p.inputDigest,taskId:p.taskId,sessionId:p.sessionId,preparationId:p.preparationId,preparedContentDigest:'a'.repeat(64)};
  const ack:any=await work.acknowledge({preparationIntentDigest:p.intentDigest,fact});expect(ack).toMatchObject({ok:false,error:'DURABLE_DISPATCH_HOST_EFFECT_PERMISSION_UNAVAILABLE'});expect(ack.preparation).toBeUndefined();
  // This closes the actual sent ACK wire's future publisher, not a prepared
  // receipt. Native Host/effect qualification is still an unmet parent gate.
  observer!({disposition:'ack_registered'});closed=true;await client.sealAndDrainPrefix();
 }finally{if(!closed)observer?.({disposition:'no_ack'});await client.sealAndDrainPrefix().catch(()=>{});}
},15000);
for(const variant of ['missing-family','user-operation-in-preparation','extra-source','wrong-session'])it('closes the actual canonical role variant '+variant+' before changing original B rows',async()=>{
 const f=await original(),db=new DatabaseSync(join(f.root,'ks','state.sqlite'),{readOnly:true});try{
  const before=db.prepare('SELECT * FROM state_entities ORDER BY collection,entity_key').all(),frame:any={...f.session,type:'request',id:f.sequence()+1,op:'read_preparation_basis',projectId:'p',input:{childKey:f.childData.childKey,payloadHash:f.childData.payloadHash},family:'preparation',workId:'d'.repeat(64),sourceIncarnation:'f'.repeat(64)};
  if(variant==='missing-family')delete frame.family;if(variant==='user-operation-in-preparation'){frame.op='read_plan';frame.input=null;}if(variant==='extra-source')frame.requestSource='scheduler';if(variant==='wrong-session')frame.targetGeneration++;
  f.child.send(frame);const fault=await f.wait(()=>f.frames.find(row=>row.type==='fault'));expect(fault.type).toBe('fault');expect(db.prepare('SELECT * FROM state_entities ORDER BY collection,entity_key').all()).toEqual(before);
 }finally{db.close();}
},15000);
it('does not create a post-prefix publisher or a healthy marker while an earlier preparation response callback is held',async()=>{
 const f=await original(false,'held-preparation-response'),lookup={childKey:f.childData.childKey,payloadHash:f.childData.payloadHash};expect((await f.call('read_preparation_basis',lookup,true)).result?.ok).toBe(true);await f.wait(()=>existsSync(join(f.root,'held-preparation-response.json'))?true:undefined);
 try{f.child.send({...f.session,type:'seal_prefix',throughId:f.sequence(),sealNonce:'9'.repeat(64)});f.child.send({...f.session,type:'request',id:f.sequence()+1,op:'read_preparation_basis',projectId:'p',input:lookup,family:'preparation',workId:'d'.repeat(64),sourceIncarnation:'f'.repeat(64)});const fault=await f.wait(()=>f.frames.find(row=>row.type==='fault'));expect(fault.type).toBe('fault');expect(f.frames.some(row=>row.type==='response'&&row.id===f.sequence()+1)).toBe(false);expect(f.frames.some(row=>row.type==='prefix_drained')).toBe(false);}finally{writeFileSync(join(f.root,'release-preparation-response'),'1');}
 await delay(30);expect(f.frames.some(row=>row.type==='prefix_drained')).toBe(false);
},15000);
it('carries the original durable intent, real Broker send, call read and controlled ACK over the same two-hop work',async()=>{
 const f=await original(true),lookup={childKey:f.childData.childKey,payloadHash:f.childData.payloadHash},basis=(await f.call('read_preparation_basis',lookup,true)).result;expect(basis.ok).toBe(true);
 const config=JSON.parse(readFileSync(join(f.root,'owner.json'),'utf8')),{createBrokerClient}=await importOriginalNodeModule(pathToFileURL(resolve('../../kswarm/src/net/broker-client.js')).href),receiver=createBrokerClient({brokerUrl:config.kswarm.brokerUrl,participantId:'desktop',silent:true});await receiver.register();
 const prepared=await f.call('prepare_intent',{scope:f.scope,writerStoreId:basis.child.writerStoreId,projectId:'p',bindingDigest:basis.child.bindingDigest,childKey:lookup.childKey,payloadHash:lookup.payloadHash,hostId:'host',targetParticipantId:'desktop',targetIncarnation:'controlled-native-target',inputMapperVersion:'kswarm_task_handoff_prompt_v1',inputDigest:'e'.repeat(64)},true);expect(prepared.result?.ok,JSON.stringify(prepared)).toBe(true);
 const intent=prepared.result.preparation,sent=await f.call('admit_send',{preparationIntentDigest:intent.intentDigest,sourceIncarnation:'f'.repeat(64)},true);expect(sent.result?.sendStatus,JSON.stringify(sent)).toBe('send_started');
 const read=await f.call('read_prepare_call',{admissionId:sent.result.preparation.admissionId,preparationIntentDigest:intent.intentDigest},true);expect(read.result?.ok,JSON.stringify(read)).toBe(true);
 const fact={version:1,contract:'ordinary_default_dispatch_task_preparation_v1',scope:intent.scope,projectId:intent.projectId,kswarmTaskId:intent.kswarmTaskId,runId:intent.runId,businessExecutionGeneration:intent.businessExecutionGeneration,childKey:intent.childKey,payloadHash:intent.payloadHash,bindingDigest:intent.bindingDigest,hostId:intent.hostId,inputDigest:intent.inputDigest,taskId:intent.taskId,sessionId:intent.sessionId,preparationId:intent.preparationId,preparedContentDigest:'a'.repeat(64)};
 const acknowledged=await f.call('ack_prepared',{preparationIntentDigest:intent.intentDigest,fact},true);expect(acknowledged.type).toBe('response');expect(acknowledged.result).toMatchObject({ok:false,error:'DURABLE_DISPATCH_HOST_EFFECT_PERMISSION_UNAVAILABLE'});expect(acknowledged.result.preparation).toBeUndefined();
 f.child.send({...f.session,type:'seal_prefix',throughId:f.sequence(),sealNonce:'9'.repeat(64)});const marker=await f.wait(()=>f.frames.find(row=>row.type==='prefix_drained'||row.type==='fault'));expect(marker.type,JSON.stringify(marker)).toBe('prefix_drained');expect(marker.throughId).toBe(f.sequence());
},15000);

for(const held of [false,true])it('settles the original registered Host through both genuine hops before final prefix, held prior='+held,async()=>{
 const f=await original(true,held?'held-preparation-response':undefined),lookup={childKey:f.childData.childKey,payloadHash:f.childData.payloadHash},basis=(await f.call('read_preparation_basis',lookup,true)).result;expect(basis.ok).toBe(true);
 const config=JSON.parse(readFileSync(join(f.root,'owner.json'),'utf8')),{createBrokerClient}=await importOriginalNodeModule(pathToFileURL(resolve('../../kswarm/src/net/broker-client.js')).href),receiver=createBrokerClient({brokerUrl:config.kswarm.brokerUrl,participantId:'desktop',silent:true});await receiver.register();
 const prepared=await f.call('prepare_intent',{scope:f.scope,writerStoreId:basis.child.writerStoreId,projectId:'p',bindingDigest:basis.child.bindingDigest,childKey:lookup.childKey,payloadHash:lookup.payloadHash,hostId:'host',targetParticipantId:'desktop',targetIncarnation:'controlled-native-target',inputMapperVersion:'kswarm_task_handoff_prompt_v1',inputDigest:'e'.repeat(64)},true);expect(prepared.result?.ok,JSON.stringify(prepared)).toBe(true);
 const intent=prepared.result.preparation,sent=await f.call('admit_send',{preparationIntentDigest:intent.intentDigest,sourceIncarnation:'f'.repeat(64)},true);expect(sent.result?.sendStatus,JSON.stringify(sent)).toBe('send_started');
 const read=await f.call('read_prepare_call',{admissionId:sent.result.preparation.admissionId,preparationIntentDigest:intent.intentDigest},true);expect(read.result?.ok,JSON.stringify(read)).toBe(true);
 const registration=await f.call('register_host',{scope:f.scope,projectId:'p',childKey:lookup.childKey,payloadHash:lookup.payloadHash,admissionId:sent.result.preparation.admissionId,preparationIntentDigest:intent.intentDigest,sourceIncarnation:'f'.repeat(64),hostLeaseKey:'4'.repeat(64)},true);expect(registration.result?.ok,JSON.stringify(registration)).toBe(true);
 const {protocolDigest}=createRequire(import.meta.url)(resolve('../../kswarm/src/core/project-protocol.js'));
 const registered=registration.result.hostEffect.registration;
 let finishedDone=false;const finishing=f.call('finish_host_no_effect',{scope:f.scope,projectId:'p',registrationDigest:protocolDigest(registered),hostLeaseKey:registered.hostLeaseKey,sourceIncarnation:'f'.repeat(64),reason:'cancelled'},true).then(value=>{finishedDone=true;return value;});
 if(held){try{await delay(40);expect(finishedDone).toBe(false);const db=new DatabaseSync(join(f.root,'ks','state.sqlite'),{readOnly:true});try{expect(db.prepare('SELECT count(*) n FROM state_entities WHERE entity_key=?').get(registered.id+':no-effect-finish')?.n).toBe(0);}finally{db.close();}}finally{writeFileSync(join(f.root,'release-preparation-response'),'1');}}
 const finished=await finishing;expect(finished.result?.ok,JSON.stringify(finished)).toBe(true);expect(finished.result.hostEffect.noEffectFinish).toMatchObject({disposition:'no_effect',reason:'cancelled'});
 f.child.send({...f.session,type:'seal_prefix',throughId:f.sequence(),sealNonce:'9'.repeat(64)});const marker=await f.wait(()=>f.frames.find(row=>row.type==='prefix_drained'||row.type==='fault'));expect(marker.type,JSON.stringify(marker)).toBe('prefix_drained');expect(marker.throughId).toBe(f.sequence());
},15000);

it('keeps the same registered Host settleable after a known unissued ACK refusal without entering the lower ACK',async()=>{
 const f=await original(true),lookup={childKey:f.childData.childKey,payloadHash:f.childData.payloadHash},basis=(await f.call('read_preparation_basis',lookup,true)).result;expect(basis.ok).toBe(true);
 const config=JSON.parse(readFileSync(join(f.root,'owner.json'),'utf8')),{createBrokerClient}=await importOriginalNodeModule(pathToFileURL(resolve('../../kswarm/src/net/broker-client.js')).href);await createBrokerClient({brokerUrl:config.kswarm.brokerUrl,participantId:'desktop',silent:true}).register();
 const prepared=await f.call('prepare_intent',{scope:f.scope,writerStoreId:basis.child.writerStoreId,projectId:'p',bindingDigest:basis.child.bindingDigest,childKey:lookup.childKey,payloadHash:lookup.payloadHash,hostId:'host',targetParticipantId:'desktop',targetIncarnation:'controlled-native-target',inputMapperVersion:'kswarm_task_handoff_prompt_v1',inputDigest:'e'.repeat(64)},true);expect(prepared.result?.ok,JSON.stringify(prepared)).toBe(true);
 const intent=prepared.result.preparation,sent=await f.call('admit_send',{preparationIntentDigest:intent.intentDigest,sourceIncarnation:'f'.repeat(64)},true);expect(sent.result?.sendStatus,JSON.stringify(sent)).toBe('send_started');expect((await f.call('read_prepare_call',{admissionId:sent.result.preparation.admissionId,preparationIntentDigest:intent.intentDigest},true)).result?.ok).toBe(true);
 const registeredReply=await f.call('register_host',{scope:f.scope,projectId:'p',childKey:lookup.childKey,payloadHash:lookup.payloadHash,admissionId:sent.result.preparation.admissionId,preparationIntentDigest:intent.intentDigest,sourceIncarnation:'f'.repeat(64),hostLeaseKey:'4'.repeat(64)},true);expect(registeredReply.result?.ok,JSON.stringify(registeredReply)).toBe(true);const registered=registeredReply.result.hostEffect.registration;
 const fact={version:1,contract:'ordinary_default_dispatch_task_preparation_v1',scope:intent.scope,projectId:intent.projectId,kswarmTaskId:intent.kswarmTaskId,runId:intent.runId,businessExecutionGeneration:intent.businessExecutionGeneration,childKey:intent.childKey,payloadHash:intent.payloadHash,bindingDigest:intent.bindingDigest,hostId:intent.hostId,inputDigest:intent.inputDigest,taskId:intent.taskId,sessionId:intent.sessionId,preparationId:intent.preparationId,preparedContentDigest:'a'.repeat(64)};
 const denied=await f.call('ack_prepared',{preparationIntentDigest:intent.intentDigest,fact},true);
 const {protocolDigest}=createRequire(import.meta.url)(resolve('../../kswarm/src/core/project-protocol.js'));
 const finished=await f.call('finish_host_no_effect',{scope:f.scope,projectId:'p',registrationDigest:protocolDigest(registered),hostLeaseKey:registered.hostLeaseKey,sourceIncarnation:'f'.repeat(64),reason:'final_gate_denied'},true);
 console.log(JSON.stringify({test:'registered-host-known-ack-refusal',ack:denied.result??denied.error,finish:finished.result??finished.error,notNativeHostQualification:true}));
 expect(denied.result).toMatchObject({ok:false,notInvoked:true});expect(finished.result?.ok,JSON.stringify(finished)).toBe(true);
 const db=new DatabaseSync(join(f.root,'ks','state.sqlite'),{readOnly:true});try{expect(db.prepare('SELECT count(*) n FROM state_entities WHERE entity_key=?').get(lookup.childKey+':prepared')?.n).toBe(0);expect(db.prepare('SELECT count(*) n FROM state_entities WHERE entity_key=?').get(registered.id+':no-effect-finish')?.n).toBe(1);}finally{db.close();}
 f.child.send({...f.session,type:'seal_prefix',throughId:f.sequence(),sealNonce:'9'.repeat(64)});expect((await f.wait(()=>f.frames.find(row=>row.type==='prefix_drained'||row.type==='fault'))).type).toBe('prefix_drained');
},15000);
