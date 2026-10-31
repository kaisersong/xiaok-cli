import '../../support/installed-controller-fixture.js';
import {it,expect,vi} from 'vitest';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {installedControllerFixture} from '../../support/installed-controller-fixture.js';
import * as compositions from '../../../src/runtime/verification/completion-composition.js';
import * as artifacts from '../../../src/runtime/verification/approved-artifact-reader.js';
import type {IndependentRecipeSpec,RecipeBinding} from '../../../src/runtime/verification/independent-recipes.js';
import type {QuiescenceExpectation} from '../../../src/runtime/isolated-execution/physical-quiescence.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
const socket=process.env.SOL_PI_DOCKER_PROBE_SOCKET,image=process.env.SOL_PI_DOCKER_PROBE_IMAGE;
it.skipIf(!socket||!image)('reads actual Docker artifact through raw HEAD/TAR and approved path port; fixture approval is not OS qualification',async()=>{
 const invocation={sessionIdentity:'artifact-dev',compoundOperationId:randomUUID(),validationInvocationId:randomUUID()},command={argv:['/bin/sh','-c',"printf 'audited actual body' > /artifacts/report.txt"],cwdRelative:'.'},caller=new AbortController();
 let release!:()=>void,observed!:(binding:RecipeBinding)=>void;
 const resume=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<RecipeBinding>(resolve=>{observed=resolve;});
 const actualComposition=compositions.createVerificationCompletionComposition,actualReader=artifacts.createApprovedRecipeArtifactReader;
 let live=true,revocationFailure:Error|undefined,revocationAsserted=false;
 // Pause the original recipe callback, after actual dispatch/archive/output registration; never replace its result.
 const compositionConstruction=vi.spyOn(compositions,'createVerificationCompletionComposition').mockImplementation(options=>actualComposition({...options,recipePorts:{...options.recipePorts,async readArtifact(binding,path,limits){observed(binding);await resume;return options.recipePorts.readArtifact(binding,path,limits);}}}));
 const readerConstruction=vi.spyOn(artifacts,'createApprovedRecipeArtifactReader').mockImplementation(options=>actualReader({...options,readApprovedRecipeBinding(binding){try{return options.readApprovedRecipeBinding(binding);}catch(error){if(!live&&error instanceof Error&&error.message==='verification_attempt_admission'){revocationFailure??=new Error('fixture material revoked',{cause:error});throw revocationFailure;}throw error;}}}));
 let f:Awaited<ReturnType<typeof installedControllerFixture>>|undefined,expected:QuiescenceExpectation|undefined,resourceId:string|undefined,challengeId:string|undefined,failure:{error:unknown}|undefined;
 let settledOutcome:Promise<{failed:boolean;error:unknown}>|undefined;
 try{
  f=await installedControllerFixture({docker:{socketPath:socket!,imageId:image!}});
  const raw=f.raw,reader=f.artifacts,signal=caller.signal,recipe:IndependentRecipeSpec={kind:'artifact-content',checks:[{id:'check',path:'report.txt',sha256:createHash('sha256').update('audited actual body').digest('hex'),structure:'bytes'}]},compiled=f.composition.privateHost.recipes.compile(recipe),enrollment=f.composition.privateHost.enrollment;
  const ownerReview=enrollment.prepare({enrollment:{ownerKind:'task',ownerId:'artifact-live-'+randomUUID(),invocations:[invocation]},registration:{migrationEpoch:1,obligations:[{obligation:{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject',definitionHash:compiled.definitionHash,requiredCheckIds:compiled.requiredCheckIds},recipe}],source:{kind:'new-owner'}}},f.peer);
  await enrollment.authorize(ownerReview.challengeId,f.peer,signal);
  const challenge=await f.material.prepare({purpose:'isolated-command',invocation,materials:[{path:join(f.root,'fixture-input'),byteLimit:1}],exactCommand:command,expiresAt:105000},f.peer,signal);challengeId=challenge.challengeId;
  const grant=await f.material.authorize(challenge.challengeId,f.peer,signal),staged=await f.material.stage({grantHandle:grant,invocation},f.peer,signal);
  const resource=f.database.prepare<[string],{resource_id:string}>('SELECT resource_id FROM broker_staging_intents WHERE scope_digest=?').get(staged.scopeDigest);if(!resource)throw Error('fixture_staging_missing');resourceId=resource.resource_id;
  const prepared=await f.operations.prepare({mountPlanHandle:staged.mountPlanHandle,obligationId:'original',expectedAttemptEpoch:0,requestSource:'agent'},f.peer,signal);
  const row=f.database.prepare<[string],{record_json:string}>('SELECT record_json FROM verification_operations WHERE id=?').get(prepared.operationHandle.id);if(!row)throw Error('fixture_operation_missing');
  const record:{binding:RecipeBinding}=JSON.parse(row.record_json);f.composition.privateHost.readApprovedRecipeBinding(record.binding);expected=raw.readExecution(record.binding.expected).expected;
  const dispatch=f.operations.dispatch({operationHandle:prepared.operationHandle},f.peer,signal);
  settledOutcome=dispatch.then(()=>({failed:false,error:undefined}),(error:unknown)=>({failed:true,error}));
  const binding=await Promise.race([ready,dispatch.then(()=>{throw Error('fixture_artifact_read_missing');})]);
  if(json(binding.expected)!==json(expected))throw Error('fixture_artifact_execution_changed');
  expect((await raw.inspectExecutionFacts(expected)).exitCode).toBe(0);
  await expect(reader.readArtifact(binding,'other.txt')).rejects.toThrow('recipe_artifact_path');await expect(reader.readArtifact(binding,'report.txt',{maxBytes:2})).rejects.toThrow('docker_artifact_limit');expect((await reader.readArtifact(binding,'report.txt',{maxBytes:64})).toString()).toBe('audited actual body');f.material.revoke(challenge.challengeId,f.peer);challengeId=undefined;live=false;await expect(reader.readArtifact(binding,'report.txt')).rejects.toThrow('fixture material revoked');revocationAsserted=true;
 }catch(error){failure={error};throw error;}
 finally{
  const errors:unknown[]=[],closingReason=Error('artifact_live_fixture_closing');
  if(!revocationAsserted)caller.abort(closingReason);release();
  const outcome=await settledOutcome;
  if(revocationAsserted){
   if(!outcome?.failed)errors.push(Error('fixture_revocation_dispatch_fulfilled'));
   else if(!revocationFailure||outcome.error!==revocationFailure)errors.push(outcome.error);
  }else if(outcome?.failed&&outcome.error!==closingReason)errors.push(outcome.error);
  caller.abort(closingReason);
  if(f){
   try{await f.operations.close();}catch(error){errors.push(error);}
   if(expected)try{if(f.raw.readExecution(expected).state==='prepared')f.raw.cancelPreparedExecution(expected);await f.raw.cleanupExecution(expected);}catch(error){errors.push(error);}
   if(challengeId)try{f.material.revoke(challengeId,f.peer);}catch(error){errors.push(error);}
   if(resourceId)try{await f.stack.privateHost.materialCleanup.cleanupResource(resourceId);}catch(error){errors.push(error);}
   try{await f.close(errors.length>0);}catch(error){errors.push(error);}
  }
  for(const spy of [readerConstruction,compositionConstruction])try{spy.mockRestore();}catch(error){errors.push(error);}
  if(errors.length)throw new AggregateError([...(failure?[failure.error]:[]),...errors],'artifact_live_fixture_cleanup');
 }
},30000);
