// Actual original Node/SQLite/Net endpoint; controlled upper Source and marker.
// This does not qualify NativeMain, Host IO, authenticated grants or product drain.
import {afterEach,expect,it} from 'vitest';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {createOwnedKSwarmBusiness,readOwnedKSwarmPreparationFacet,readOwnedKSwarmBusinessRemoteError} from '../../../src/runtime/conversation-activity/owned-kswarm-business.js';
const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)};
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
for(const bodyMode of ['held','reject','reject-undefined'])it('uses one original child for all five RPCs and retains the actual Net '+bodyMode+' completion',async()=>{
 const root=mkdtempSync(join(tmpdir(),'dsh-preparation-client-')),ksRoot=resolve('../../kswarm');
 const child=spawn(process.execPath,[join(ksRoot,'test/fixtures/owned-preparation-family/entry.js')],{cwd:ksRoot,stdio:['pipe','pipe','pipe','ipc'],env:{...process.env,PREPARATION_FAMILY_FIXTURE_ROOT:root,PREPARATION_FAMILY_BODY_MODE:bodyMode,ELECTRON_RUN_AS_NODE:'1'}});
 let output='',closed=false;child.stdout!.on('data',chunk=>{output+=String(chunk);});child.stderr!.on('data',chunk=>{output+=String(chunk);});
 const exit=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(yes=>child.once('close',(code,signal)=>{closed=true;yes({code,signal});}));
 cleanups.push(async()=>{let signals=0;if(!closed)child.stdin!.write('release\nclose\n');const timer=setTimeout(()=>{if(!closed){signals++;child.kill('SIGTERM');}},2000),last=setTimeout(()=>{if(!closed){signals++;child.kill('SIGKILL');}},4000);try{const result=await exit;console.log(JSON.stringify({fixture:'upper-preparation-original-child',pid:child.pid,...result,signals,reaped:true,notNativeQualification:true,notProductDrain:true}));expect(signals,output).toBe(0);expect(result.code,output).toBe(bodyMode==='held'?0:1);}finally{clearTimeout(timer);clearTimeout(last);rmSync(root,{recursive:true,force:true,maxRetries:5});}});
 const ready=await new Promise<any>((yes,no)=>{const timer=setTimeout(()=>{child.off('message',message);no(Error('original preparation ready timeout '+output));},5000);function message(frame:any){if(frame.protocol==='fixture_ready'){clearTimeout(timer);child.off('message',message);yes(frame);}}child.on('message',message);child.once('error',error=>{clearTimeout(timer);child.off('message',message);no(error);});});
 const owner={},userProof=Object.freeze({}),proof=Object.freeze({}),custody=Object.freeze(Object.create(null)),signal=new AbortController();let observer:((cut:unknown)=>void)|undefined,producerClosed=false;
 const source={resolveWork(candidate:object,audience:any){if(candidate!==proof||audience.serviceOwner!==owner||audience.projectId!=='p')throw Error('original_preparation_required');return{workId:'d'.repeat(64),sourceIncarnation:'f'.repeat(64),custody};},observeWork(value:object,callback:(cut:unknown)=>void){if(value!==custody)throw Error('original_custody_required');observer=callback;},sealWork(value:object){if(value!==custody)throw Error('original_custody_required');/* This controlled Source already accepted its future ACK publisher. */}};
 const preparationAdmission=(candidate:object,audience:any)=>{if(candidate!==proof||audience.serviceOwner!==owner||audience.projectId!=='p'||producerClosed)throw Error('original_preparation_required');};
 const client=createOwnedKSwarmBusiness({child,scope,serviceOwner:owner,isCurrent:()=>!closed&&child.connected===true,preparationSource:source,preparationAdmission,admit(candidate,audience){if(candidate!==userProof||audience.serviceOwner!==owner||audience.projectId!=='p')throw Error('original_user_required');}});
 const context={requestSource:'user' as const,admission:userProof,signal:signal.signal},plan:any=await client.readPlan('p',context);
 const {defaultDispatchActionRecord}=createRequire(import.meta.url)(join(ksRoot,'src/core/default-dispatch-action-data.js'));
 const fact=defaultDispatchActionRecord({scope,projectId:'p',planRevision:plan.plan.revision,dispatchGeneration:plan.plan.dispatchGeneration,bindingDigest:plan.plan.bindingDigest,taskSetDigest:plan.plan.taskSetDigest}),captured:any=await client.captureDefaultDispatch('p',fact,context),childData=captured.operation.children[0];
 const work=readOwnedKSwarmPreparationFacet(client,source,preparationAdmission).openWork('p',{childKey:childData.childKey,payloadHash:childData.payloadHash},{requestSource:'scheduler',preparationProof:proof,signal:signal.signal});
 const basis:any=await work.readBasis();expect(basis.ok).toBe(true);const prepared:any=await work.prepareIntent({scope,writerStoreId:ready.writerStoreId,projectId:'p',bindingDigest:basis.child.bindingDigest,childKey:childData.childKey,payloadHash:childData.payloadHash,hostId:'host',targetParticipantId:'desktop',targetIncarnation:'controlled-native-target',inputMapperVersion:'kswarm_task_handoff_prompt_v1',inputDigest:'e'.repeat(64)});expect(prepared.ok).toBe(true);
 const intent=prepared.preparation,sent:any=await work.admitSend({preparationIntentDigest:intent.intentDigest,sourceIncarnation:'f'.repeat(64)});expect(sent.sendStatus).toBe('send_started');
 let drained=false,failure:any;const drain=client.sealAndDrainPrefix().then(()=>{drained=true;},error=>{failure=error;});
 try{
  const cut:any=await work.readCall({admissionId:sent.preparation.admissionId,preparationIntentDigest:intent.intentDigest});expect(cut.ok).toBe(true);
  const marker={version:1,contract:'ordinary_default_dispatch_task_preparation_v1',scope:intent.scope,projectId:intent.projectId,kswarmTaskId:intent.kswarmTaskId,runId:intent.runId,businessExecutionGeneration:intent.businessExecutionGeneration,childKey:intent.childKey,payloadHash:intent.payloadHash,bindingDigest:intent.bindingDigest,hostId:intent.hostId,inputDigest:intent.inputDigest,taskId:intent.taskId,sessionId:intent.sessionId,preparationId:intent.preparationId,preparedContentDigest:'a'.repeat(64)};
  const ack:any=await work.acknowledge({preparationIntentDigest:intent.intentDigest,fact:marker});expect(ack.ok).toBe(true);expect(ack.preparation.state).toBe('prepared');observer!({disposition:'ack_registered'});producerClosed=true;
  await delay(20);expect(drained).toBe(false);child.stdin!.write('release\n');await drain;if(bodyMode==='held'){expect(drained).toBe(true);expect(failure).toBeUndefined();}else{expect(drained).toBe(false);const remote=readOwnedKSwarmBusinessRemoteError(failure)??readOwnedKSwarmBusinessRemoteError(failure.cause??failure.errors?.[0]);expect(remote?.message).toContain(bodyMode==='reject'?'controlled late body failure':'business operation failed');}
 }finally{child.stdin!.write('release\n');if(!producerClosed)observer!({disposition:'no_ack'});await drain.catch(()=>{});}
},15000);
