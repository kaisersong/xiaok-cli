import '../../support/installed-controller-fixture.js';
import {it,expect,vi} from 'vitest';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {installedControllerFixture} from '../../support/installed-controller-fixture.js';
import * as transcripts from '../../../src/runtime/verification/execution-transcripts.js';
import {readBrokerStagingCapacitySource} from '../../../src/runtime/isolated-execution/broker-staging.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
import type {QuiescenceExpectation} from '../../../src/runtime/isolated-execution/physical-quiescence.js';
import type {IndependentRecipeSpec} from '../../../src/runtime/verification/independent-recipes.js';
const socket=process.env.SOL_PI_DOCKER_PROBE_SOCKET,image=process.env.SOL_PI_DOCKER_PROBE_IMAGE;
it.skipIf(!socket||!image)('persists actual attached Docker bytes through production raw runner and restarts the immutable store (dev only)',async()=>{
 const read={},remove={},invocation={sessionIdentity:'dev-transcript',compoundOperationId:randomUUID(),validationInvocationId:randomUUID()},command={argv:['/bin/sh','-c',"printf 'raw stdout';printf 'raw stderr' >&2;exit 7"],cwdRelative:'.'};
 const actualStore=transcripts.createExecutionTranscriptStore;
 // Retain the original native-access leaves; installed construction still registers the real returned store.
 const construction=vi.spyOn(transcripts,'createExecutionTranscriptStore').mockImplementation(options=>actualStore({...options,access:{assertRead(_m,a){if(a!==read)throw Error('read');},assertDelete(_m,a){if(a!==remove)throw Error('delete');}}}));
 let f:Awaited<ReturnType<typeof installedControllerFixture>>|undefined,expected:QuiescenceExpectation|undefined,resourceId:string|undefined,challengeId:string|undefined,failure:{error:unknown}|undefined,executionCleaned=false;
 try{
  f=await installedControllerFixture({docker:{socketPath:socket!,imageId:image!}});
  const runner=f.raw;let db=f.database,store=f.stack.privateHost.transcripts;
  const signal=new AbortController().signal,recipe:IndependentRecipeSpec={kind:'artifact-content',checks:[{id:'unused',path:'unused',sha256:'a'.repeat(64),structure:'bytes'}]},compiled=f.composition.privateHost.recipes.compile(recipe),enrollment=f.composition.privateHost.enrollment;
  const ownerReview=enrollment.prepare({enrollment:{ownerKind:'task',ownerId:'transcript-live-'+randomUUID(),invocations:[invocation]},registration:{migrationEpoch:1,obligations:[{obligation:{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject',definitionHash:compiled.definitionHash,requiredCheckIds:compiled.requiredCheckIds},recipe}],source:{kind:'new-owner'}}},f.peer);
  const {owner}=await enrollment.authorize(ownerReview.challengeId,f.peer,signal),ownerKey=json(owner);
  const challenge=await f.material.prepare({purpose:'isolated-command',invocation,materials:[{path:join(f.root,'fixture-input'),byteLimit:1}],exactCommand:command,expiresAt:105000},f.peer,signal);challengeId=challenge.challengeId;
  const grant=await f.material.authorize(challenge.challengeId,f.peer,signal),staged=await f.material.stage({grantHandle:grant,invocation},f.peer,signal),plan=f.material.consumeMountPlan(staged.mountPlanHandle,f.peer).plan;
  resourceId=readBrokerStagingCapacitySource(plan,db).resourceId;
  expected=runner.reserveExecution({...invocation,ownerKey,scopeDigest:staged.scopeDigest,command,materializedInput:plan}).expected;
  const result=await runner.dispatchExecution(expected),actual=await runner.inspectExecutionFacts(expected);expect(actual.exitCode).toBe(7);
  const receipt=await f.stack.privateHost.execution.privateHost.quiescence.inspectExecution(expected),recorded=store.record({ownerKey,expected,output:result.output,receipt});
  // Releasing the old installed owner requires a real restart to register the next store issuer.
  // Drain our Docker resources first so a failed restart cannot orphan live containers/volumes.
  await runner.cleanupExecution(expected);executionCleaned=true;f.material.revoke(challenge.challengeId,f.peer);challengeId=undefined;
  await f.stack.privateHost.materialCleanup.cleanupResource(resourceId);resourceId=undefined;
  store.close();const root=f.root,receiverKeys=f.keys;await f.close(true);f=undefined;
  f=await installedControllerFixture({existingRoot:root,expectedReceiverKeys:receiverKeys,recoveryOnly:true,docker:{socketPath:socket!,imageId:image!}});
  db=f.database;store=f.stack.privateHost.transcripts;
  const saved=store.read(recorded.resourceId,read);expect(saved.manifest).toMatchObject({scope:'isolated-execution',exitCode:7,complete:true,truncated:false});expect(saved.stdout.toString()).toBe('raw stdout');expect(saved.stderr.toString()).toBe('raw stderr');store.delete(recorded.resourceId,{requestSource:'user',authorization:remove});expect(db.prepare("SELECT COUNT(*) n FROM verification_blob_reservations WHERE state='reserved'").get()).toEqual({n:0});
 }catch(error){failure={error};throw error;}
 finally{
  const errors:unknown[]=[];
  if(f){
   if(expected&&!executionCleaned)try{if(f.raw.readExecution(expected).state==='prepared')f.raw.cancelPreparedExecution(expected);await f.raw.cleanupExecution(expected);executionCleaned=true;}catch(error){errors.push(error);}
   if(challengeId)try{f.material.revoke(challengeId,f.peer);}catch(error){errors.push(error);}
   if(resourceId)try{await f.stack.privateHost.materialCleanup.cleanupResource(resourceId);}catch(error){errors.push(error);}
   try{await f.close(errors.length>0);}catch(error){errors.push(error);}
  }
  try{construction.mockRestore();}catch(error){errors.push(error);}
  if(errors.length)throw new AggregateError([...(failure?[failure.error]:[]),...errors],'transcript_live_fixture_cleanup');
 }
},30000);
