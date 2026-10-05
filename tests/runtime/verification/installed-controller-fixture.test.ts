import '../../support/installed-controller-fixture.js';
import {it,expect,vi} from 'vitest';
import * as commands from '../../../src/runtime/verification/execution-command-dispatch.js';
import {createHash} from 'node:crypto';
import {createApprovedVerificationOperations} from '../../../src/runtime/verification/approved-verification-operation.js';
import {installedControllerFixture} from '../../support/installed-controller-fixture.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
it('retains real installed authority and artifact reader through prepare, dispatch, proof and drain',async()=>{
 const f=await installedControllerFixture(),hash=(text:string)=>createHash('sha256').update(text).digest('hex'),invocation={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'},signal=new AbortController().signal;
 try{
  expect(Object.keys(f.operationInput)).not.toEqual(expect.arrayContaining(['clock','assertCurrent','ensureQualified','onActualResult','registerActualOutput']));
  expect(()=>createApprovedVerificationOperations({...f.operationInput,assembly:{}} as never)).toThrow('installed_assembly_identity');
  let calls=0;expect(()=>createApprovedVerificationOperations({...f.operationInput,clock(){calls++;f.database.exec('COMMIT');}} as never)).toThrow('verification_operation_ports');expect(calls).toBe(0);
  const recipe={kind:'artifact-content',checks:[{id:'content',path:'result',sha256:hash('result'),structure:'bytes'}]},obligation={obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject',definitionHash:hash(json(recipe)),requiredCheckIds:['content']};
  const e=await f.invoke('completion.prepare-owner',{enrollment:{ownerKind:'task',ownerId:'task',invocations:[invocation]},registration:{migrationEpoch:1,obligations:[{obligation,recipe}],source:{kind:'new-owner'}}},f.peer,signal) as any;
  const {owner}=await f.invoke('completion.authorize-owner',{challengeId:e.challengeId},f.peer,signal) as any;
  const c=await f.invoke('materials.prepare',{purpose:'isolated-command',invocation,materials:[{path:'/workspace/a',byteLimit:1}],exactCommand:{argv:['/bin/true'],cwdRelative:'.'},expiresAt:105000},f.peer,signal) as any;
  const grant=await f.invoke('materials.authorize',{challengeId:c.challengeId},f.peer,signal),staged=await f.invoke('materials.stage',{grantHandle:grant,invocation},f.peer,signal) as any;
  const commandSpy=vi.spyOn(commands,'executeExecutionPreparationCommand');
  const prepared=await f.invoke('verification.prepare',{mountPlanHandle:staged.mountPlanHandle,obligationId:'original',expectedAttemptEpoch:0,requestSource:'agent'},f.peer,signal) as any;
  expect(commandSpy).toHaveBeenCalledOnce();commandSpy.mockRestore();
  const completed=await f.invoke('verification.dispatch',{operationHandle:prepared.operationHandle},f.peer,signal) as any;
  expect(completed.currentVerification).toBe('valid');expect(f.operations.stageVerifiedPayload(owner)).toHaveProperty('immutablePayloadHash');expect(f.containers.size).toBe(0);expect(f.volumes.size).toBe(0);
 }finally{await f.close();}
});

import {verifiedOperationFixture} from '../../support/verified-operation-fixture.js';
it('verification.prepare durably attaches its material to the same actual raw execution and operation',async()=>{const f=await verifiedOperationFixture('loop-application');try{
 const row=f.database.prepare('SELECT record_json,state FROM material_mount_plan_handoffs').get() as any;
 expect(row.state).toBe('attached');const operation=JSON.parse((f.database.prepare('SELECT record_json FROM verification_operations').get() as any).record_json);
 expect(JSON.parse(row.record_json).expected).toEqual(operation.binding.expected);
 }finally{await f.close();}});
