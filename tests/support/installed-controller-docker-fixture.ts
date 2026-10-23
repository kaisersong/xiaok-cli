import './installed-controller-fixture.js';
import {vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import type {Database} from 'better-sqlite3';
import * as controller from '../../src/runtime/verification/installed-controller.js';
import type {BlackboxObservation,IndependentRecipeSpec} from '../../src/runtime/verification/independent-recipes.js';
import type {QuiescenceExpectation} from '../../src/runtime/isolated-execution/physical-quiescence.js';
import type {ValidationMaterialDraft,ValidationMaterialInvocation} from '../../src/runtime/verification/product-material-authorization.js';
import {installedControllerFixture} from './installed-controller-fixture.js';
import {canonicalVerificationJson as json} from '../../src/runtime/verification/protocol.js';

type CaseCapture=Parameters<typeof controller.recordInstalledCaseResult>[1];
function deferred<T>(){
 let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;
 const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
 // Cases may finish before their consumer reaches caseResult().
 void promise.catch(()=>{});
 return {promise,resolve,reject};
}

/** Actual installed issuer, actual Docker and actual operation/run owners.
 * OS identity/native approval/qualification remain the existing fixture leaves.
 * Pause only after the real executor settles, so assertions precede parent drain.
 */
export async function installedControllerDockerFixture(options:{
 socketPath:string;imageId:string;recipe:Extract<IndependentRecipeSpec,{kind:'blackbox'}>;
 command:ValidationMaterialDraft['exactCommand'];invocation:ValidationMaterialInvocation;
 fault?:'revoke-after-capture'|'archive-failure';
 onCaseAdmission?(expected:QuiescenceExpectation,database:Database):void;
 onCaseCapture?(result:CaseCapture):void;
}){
 const cases=new Map(options.recipe.cases.map(test=>[test.id,{result:deferred<BlackboxObservation>(),resume:deferred<void>()}])),caller=new AbortController();
 let paused:ReturnType<typeof deferred<void>>|undefined,finishing=false;
 async function publish(caseId:string,outcome:{result:BlackboxObservation}|{error:unknown}){
  const item=cases.get(caseId);if(!item)throw Error('fixture_unregistered_case');
  paused=item.resume;
  if('result' in outcome)item.result.resolve(outcome.result);else item.result.reject(outcome.error);
  if(!finishing)await item.resume.promise;
 }
 const f=await installedControllerFixture({docker:{socketPath:options.socketPath,imageId:options.imageId},
  onBlackboxResult:result=>publish(result.caseId,{result}),
  onBlackboxError:(error,request)=>publish(request.caseId,{error}),
 });
 const actualRegister=controller.registerInstalledCaseExecution,actualRecord=controller.recordInstalledCaseResult,actualRead=controller.readInstalledApprovedRecipe;
 let revoked=false,sourceRunId:string|undefined;
 const ownedExpectations=new Map<string,QuiescenceExpectation>();
 function remember(expected:QuiescenceExpectation){
  const prior=ownedExpectations.get(expected.executionIdentity);
  if(prior&&json(prior)!==json(expected))throw Error('fixture_cleanup_execution_changed');
  ownedExpectations.set(expected.executionIdentity,Object.freeze({...expected}));
 }
 const register=vi.spyOn(controller,'registerInstalledCaseExecution').mockImplementation((assembly,binding,expected,database)=>{
  actualRegister(assembly,binding,expected,database);
  if(assembly===f.operationInput.assembly){remember(expected);options.onCaseAdmission?.(expected,database);}
 });
 const capture=vi.spyOn(controller,'recordInstalledCaseResult').mockImplementation((assembly,result)=>{
  if(assembly===f.operationInput.assembly)options.onCaseCapture?.(result);
  actualRecord(assembly,result);
  if(assembly===f.operationInput.assembly&&options.fault==='revoke-after-capture'){
   f.material.revoke(material.challengeId,f.peer);revoked=true;
  }
 });
 const approval=vi.spyOn(controller,'readInstalledApprovedRecipe').mockImplementation((assembly,binding)=>{
  try{return actualRead(assembly,binding);}catch(error){
   // Preserve the original fixture's error text only after real admission rejects.
   if(assembly===f.operationInput.assembly&&revoked&&error instanceof Error&&error.message==='verification_attempt_admission')throw Error('actual approval revoked',{cause:error});
   throw error;
  }
 });
 let dispatch:ReturnType<typeof f.operations.dispatch>|undefined;
 let material:Awaited<ReturnType<typeof f.material.prepare>>;
 let closing:Promise<void>|undefined;
 function finish(){finishing=true;for(const item of cases.values())item.resume.resolve();return dispatch;}
 async function closeOwned(failure?:{error:unknown}){
  caller.abort(Error('fixture_closing'));finish();
  let dispatchFailure:{error:unknown}|undefined;const cleanupErrors:unknown[]=[];
  try{
   try{await dispatch;}catch(error){dispatchFailure={error};}
   // Cancels an undispatched prepared parent before raw cleanup, without closing raw/DB.
   try{await f.operations.close();}catch(error){cleanupErrors.push(error);}
   for(const expected of [...ownedExpectations.values()].reverse()){
    try{
     if(!sourceRunId)throw Error('fixture_cleanup_run_missing');
     const member=f.database.prepare<[string,string],{expected_json:string}>('SELECT expected_json FROM verification_run_executions WHERE source_run_id=? AND execution_id=?').get(sourceRunId,expected.executionIdentity);
     if(!member||member.expected_json!==json(expected))throw Error('fixture_cleanup_registration_missing');
     await f.raw.cleanupExecution(expected);
    }catch(error){cleanupErrors.push(new Error('fixture_execution_cleanup:'+expected.executionIdentity,{cause:error}));}
   }
   // Retain this fixture's directory when explicit cleanup failed, for reconciliation.
   try{await f.close(cleanupErrors.length>0);}catch(error){cleanupErrors.push(error);}
   if(cleanupErrors.length){
    const errors:unknown[]=[];if(failure)errors.push(failure.error);
    if(dispatchFailure&&!errors.includes(dispatchFailure.error))errors.push(dispatchFailure.error);
    throw new AggregateError([...errors,...cleanupErrors],'docker_fixture_cleanup:'+f.root);
   }
  }
  finally{approval.mockRestore();capture.mockRestore();register.mockRestore();}
 }
 function close(failure?:{error:unknown}){return closing??=closeOwned(failure);}
 try{
  const compiled=f.composition.privateHost.recipes.compile(options.recipe),enrollment=f.composition.privateHost.enrollment;
  const preparedOwner=enrollment.prepare({enrollment:{ownerKind:'task',ownerId:'docker-live-'+randomUUID(),invocations:[options.invocation]},registration:{migrationEpoch:1,
   obligations:[{obligation:{obligationId:'original',predicateId:'blackbox',predicateVersion:'1',semantics:'current-subject',definitionHash:compiled.definitionHash,requiredCheckIds:compiled.requiredCheckIds},recipe:options.recipe}],source:{kind:'new-owner'}}},f.peer);
  const signal=caller.signal;
  await enrollment.authorize(preparedOwner.challengeId,f.peer,signal);
  // Real material admission requires a selected file. The existing broker leaf
  // supplies its fixed byte "x"; all case inputs still come from the original recipe.
  material=await f.material.prepare({purpose:'isolated-command',invocation:options.invocation,materials:[{path:join(f.root,'fixture-input'),byteLimit:1}],exactCommand:options.command,expiresAt:105000},f.peer,signal);
  const grant=await f.material.authorize(material.challengeId,f.peer,signal),staged=await f.material.stage({grantHandle:grant,invocation:options.invocation},f.peer,signal);
  const prepared=await f.operations.prepare({mountPlanHandle:staged.mountPlanHandle,obligationId:'original',expectedAttemptEpoch:0,requestSource:'agent'},f.peer,signal);
  sourceRunId=prepared.sourceRunId;
  const parent=f.database.prepare<[string],{expected_json:string}>('SELECT expected_json FROM verification_run_executions WHERE source_run_id=?').all(sourceRunId);
  if(parent.length!==1)throw Error('fixture_cleanup_parent_census');
  const parentExpected:QuiescenceExpectation=JSON.parse(parent[0].expected_json);
  remember(f.raw.readExecution(parentExpected).expected);
  if(options.fault==='archive-failure')f.database.exec(`CREATE TRIGGER fixture_case_archive_failure BEFORE INSERT ON verification_execution_transcripts
   WHEN NOT EXISTS (SELECT 1 FROM verification_operations WHERE json_extract(record_json,'$.binding.expected.executionIdentity')=NEW.execution_id)
   BEGIN SELECT RAISE(ABORT,'archive durable capacity rejected'); END`);
  return {...f,prepared,
   start(){if(dispatch)throw Error('fixture_dispatch_started');dispatch=f.operations.dispatch({operationHandle:prepared.operationHandle},f.peer,signal);void dispatch.catch(()=>{});},
   caseResult(caseId:string){
    if(!dispatch)throw Error('fixture_dispatch_not_started');const item=cases.get(caseId);if(!item)throw Error('fixture_unregistered_case');
    paused?.resolve();return Promise.race([item.result.promise,dispatch.then(()=>{throw Error('fixture_case_not_executed');})]);
   },
   finish,close,
  };
 }catch(error){await close({error});throw error;}
}
