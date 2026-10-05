import '../../support/installed-controller-fixture.js';
import {it,expect,vi} from 'vitest';
import {installedControllerFixture} from '../../support/installed-controller-fixture.js';
import * as commands from '../../../src/runtime/verification/execution-command-dispatch.js';
it('admits every actual approved blackbox member through the fixed original run command',async()=>{
 const f=await installedControllerFixture(),signal=new AbortController().signal,invocation={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'};
 const command=vi.spyOn(commands,'executeExecutionPreparationCommand');
 try{
  const recipe={kind:'blackbox' as const,cases:['one','two'].map(id=>({id,inputBase64:Buffer.from(id).toString('base64'),expectedOutputBase64:Buffer.from('finished').toString('base64'),sideEffects:[]}))},compiled=f.composition.privateHost.recipes.compile(recipe),obligation={obligationId:'original',predicateId:'blackbox',predicateVersion:'1',semantics:'current-subject',definitionHash:compiled.definitionHash,requiredCheckIds:compiled.requiredCheckIds};
  const enrollment=await f.invoke('completion.prepare-owner',{enrollment:{ownerKind:'task',ownerId:'task',invocations:[invocation]},registration:{migrationEpoch:1,obligations:[{obligation,recipe}],source:{kind:'new-owner'}}},f.peer,signal) as any;
  await f.invoke('completion.authorize-owner',{challengeId:enrollment.challengeId},f.peer,signal);
  const challenge=await f.material.prepare({purpose:'isolated-command',invocation,materials:[{path:'/workspace/a',byteLimit:1}],exactCommand:{argv:['/bin/true'],cwdRelative:'.'},expiresAt:105000},f.peer,signal),grant=await f.material.authorize(challenge.challengeId,f.peer,signal),staged=await f.material.stage({grantHandle:grant,invocation},f.peer,signal);
  const prepared=await f.operations.prepare({mountPlanHandle:staged.mountPlanHandle,obligationId:'original',expectedAttemptEpoch:0,requestSource:'agent'},f.peer,signal);
  const complete=await f.operations.dispatch({operationHandle:prepared.operationHandle},f.peer,signal);
  expect(complete.currentVerification).toBe('valid');expect(command).toHaveBeenCalledTimes(3);expect(f.database.prepare('SELECT COUNT(*) n FROM verification_run_executions').get()).toEqual({n:3});expect(f.containers.size).toBe(0);expect(f.volumes.size).toBe(0);
 }finally{command.mockRestore();await f.close();}
});
