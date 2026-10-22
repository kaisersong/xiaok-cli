import {expect,it} from 'vitest';
import {verifiedOperationFixture} from '../../support/verified-operation-fixture.js';
import {createApprovedPublicationOperations} from '../../../src/runtime/verification/approved-publication-operation.js';
import {createControllerOperationRouting} from '../../../src/runtime/verification/controller-operation-routing.js';

const retainedOwners:Record<string,any>[]=[];
it.for(['task','intent','goal','project','kswarm-invocation','foreign-profile-field','forged-operation','missing-owner','absent'] as const)('current payload contract rejects crossed authority before grants or payload work: %s',(mode,ctx)=>{
 if(retainedOwners.some(owner=>owner.closed!==true))throw Error('current_payload_previous_owner_unconfirmed');
 const owned:Record<string,any>={errors:[]};retainedOwners.push(owned);
 let fixture:Awaited<ReturnType<typeof verifiedOperationFixture>>|undefined,operation:ReturnType<typeof createApprovedPublicationOperations>|undefined;
 let bodyFailure:{error:unknown}|undefined,hookFailure:{error:unknown}|undefined;
 const scenario=Promise.resolve().then(async()=>{
 if(hookFailure)throw hookFailure.error;
 try{
  ctx.signal.throwIfAborted();
  owned.fixturePromise=verifiedOperationFixture('loop-application',{onAcquired(actual){owned.installed=actual;}});fixture=await owned.fixturePromise;owned.fixture=fixture;ctx.signal.throwIfAborted();
  const f=fixture!;let queries=0,approvals=0;
  operation=createApprovedPublicationOperations({database:f.database,authorityId:'authority',completion:f.composition,verification:f.operations,receiverIdentity:f.receiverIdentity,
   receiver:{async call(){queries++;throw Error('unexpected_receiver_query');},async stagePayload(){throw Error('unexpected_upload');}},clock:f.clock,assertCurrent(){},
   resolvePrincipal:p=>({...p,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid'}),async approve(){approvals++;throw Error('unexpected_approval');}});owned.operation=operation;
  const before=f.database.prepare('SELECT COUNT(*) n FROM completion_access_grants').get();
  const payload:any={ownerKind:'loop',ownerId:f.owner.ownerId};
  if(['task','intent','goal','project','kswarm-invocation'].includes(mode))payload.ownerKind=mode;
  if(mode==='foreign-profile-field')payload.profileId='foreign';
  if(mode==='forged-operation')payload.operationId='forged';
  if(mode==='missing-owner')delete payload.ownerId;
  if(mode==='absent'){
   const result=await operation.readCurrentOwnerPayload(payload,f.peer,ctx.signal);
   expect(result.observation.owner).toEqual(f.owner);expect(result.observation.publication).toEqual({status:'absent'});expect(result.page).toBeNull();
  }else{
   await expect(operation.readCurrentOwnerPayload(payload,f.peer,ctx.signal)).rejects.toThrow();
   expect(f.database.prepare('SELECT COUNT(*) n FROM completion_access_grants').get()).toEqual(before);
  }
  expect(queries).toBe(0);expect(approvals).toBe(0);
 }catch(error){bodyFailure={error};owned.bodyFailure=bodyFailure;}
 finally{
  try{await operation?.close();}catch(error){owned.errors.push(error);}
  if(!fixture){owned.partial=true;try{await owned.installed?.close(true);}catch(error){owned.errors.push(error);}owned.errors.push(Error('current_payload_setup_owner_unconfirmed'));}
  if(!owned.errors.length)try{await fixture?.close();}catch(error){owned.errors.push(error);}
  if(owned.errors.length){const failures=[...(bodyFailure?[bodyFailure.error]:[]),...owned.errors];if(failures.length===1)throw failures[0];throw new AggregateError(failures,'current_payload_operation_cleanup_unconfirmed',{cause:failures[0]});}
  owned.closed=true;
 }
 if(bodyFailure)throw bodyFailure.error;
 });
 owned.scenario=scenario;try{ctx.onTestFinished(()=>scenario);}catch(error){hookFailure={error};owned.hookFailure=hookFailure;}return scenario;
});
it('rejects a missing new handler before renewal or execution fallback',async()=>{
 let renewals=0,executions=0;
 const unused=():never=>{throw Error('unexpected_sibling');};
 const router=createControllerOperationRouting({assertCurrent(){},async renew(){renewals++;},publication:{prepare:unused,approve:unused,reconcile:unused,recoverExpired:unused,observeOwner:unused,readOwnerPayload:unused},verification:{prepare:unused,dispatch:unused},completion:{invoke:unused},execution:{async invoke(){executions++;}}});
 await expect(router.invoke('publication.readCurrentOwnerPayload',{ownerKind:'loop',ownerId:'loop'},{uid:501,gid:20,auditSessionId:1},new AbortController().signal)).rejects.toThrow('controller_publication_method');
 expect(renewals).toBe(0);expect(executions).toBe(0);
});
