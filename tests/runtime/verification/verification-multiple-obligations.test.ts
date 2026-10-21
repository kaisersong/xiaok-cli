import '../../support/installed-controller-fixture.js';
import {expect,it} from 'vitest';
import {verifiedOperationFixture} from '../../support/verified-operation-fixture.js';

it('keeps both current-subject obligations current after actual sequential material, prepare and dispatch operations',async()=>{
 const f=await verifiedOperationFixture();try{
  const invocations=[{sessionIdentity:'s',compoundOperationId:'multi-original',validationInvocationId:'multi-original'},{sessionIdentity:'s',compoundOperationId:'multi-second',validationInvocationId:'multi-second'}],signal=new AbortController().signal;
  const prior=JSON.parse((f.database.prepare('SELECT registration_json FROM owner_enrollment_intents').get() as {registration_json:string}).registration_json);
  const registration={...prior,obligations:[...prior.obligations,{...prior.obligations[0],obligation:{...prior.obligations[0].obligation,obligationId:'second'}}]};
  const proposal=await f.composition.public.invoke('completion.prepare-owner',{enrollment:{ownerKind:f.owner.ownerKind,ownerId:f.owner.ownerId,invocations},registration},f.peer) as {challengeId:string};
  await f.composition.public.invoke('completion.authorize-owner',{challengeId:proposal.challengeId},f.peer);
  const verify=async(obligationId:string,expectedAttemptEpoch:number)=>{
   const invocation=invocations[obligationId==='original'?0:1];
   const challenge=await f.material.prepare({purpose:'isolated-command',invocation,materials:[{path:'/workspace/a',byteLimit:1}],exactCommand:{argv:['/bin/true'],cwdRelative:'.'},expiresAt:105000},f.peer,signal);
   const grant=await f.material.authorize(challenge.challengeId,f.peer,signal),staged=await f.material.stage({grantHandle:grant,invocation},f.peer,signal);
   const prepared=await f.operations.prepare({mountPlanHandle:staged.mountPlanHandle,obligationId,expectedAttemptEpoch,requestSource:'user'},f.peer,signal);
   await f.operations.dispatch({operationHandle:prepared.operationHandle},f.peer,signal);
   return f.database.prepare('SELECT attempt_id,facts_json,proof_json FROM obligation_attempts WHERE obligation_id=? ORDER BY epoch DESC LIMIT 1').get(obligationId) as {attempt_id:string;facts_json:string;proof_json:string|null};
  };
  const first=await verify('original',1);expect(first.proof_json).not.toBeNull();
  const second=await verify('second',0);expect(second.proof_json).not.toBeNull();
  // These are real operation-issued subject facts, not a manually reused subject cap.
  const firstFacts=JSON.parse(first.facts_json),secondFacts=JSON.parse(second.facts_json);
  console.log('same-material sequential facts',JSON.stringify({firstSubject:firstFacts.subjectId,secondSubject:secondFacts.subjectId,firstContentRoot:firstFacts.contentRoot,secondContentRoot:secondFacts.contentRoot}));
  const dependencies=f.composition.privateHost.authorityService.getCurrentDependencies(f.owner);
  expect(dependencies.map(d=>d.obligationId).sort()).toEqual(['original','second']);
  expect(new Set(dependencies.map(d=>d.activeAttemptId))).toEqual(new Set([first.attempt_id,second.attempt_id]));
  const executions=f.database.prepare('SELECT * FROM execution_attempts ORDER BY execution_id').all();
  await f.operations.close();const recovered=f.recreateOperations();
  const staged=recovered.stageVerifiedPayload(f.owner);
  const payload=JSON.parse(f.composition.privateHost.payloads.read(staged.payloadId,f.owner).toString('utf8'));
  expect(payload.evaluations).toHaveLength(2);
  expect(payload.evaluations.map((item:{artifacts:{bytesBase64:string}[]})=>Buffer.from(item.artifacts[0].bytesBase64,'base64').toString())).toEqual(['result','result']);
  expect(f.database.prepare('SELECT * FROM execution_attempts ORDER BY execution_id').all()).toEqual(executions);

 }finally{await f.close();}
});

it('does not reactivate a historical same-content subject after a different real command has become current',async()=>{
 const f=await verifiedOperationFixture();try{
  const signal=new AbortController().signal,registration=JSON.parse((f.database.prepare('SELECT registration_json FROM owner_enrollment_intents').get() as {registration_json:string}).registration_json);
  const original=JSON.parse((f.database.prepare('SELECT facts_json FROM obligation_attempts WHERE obligation_id=? ORDER BY epoch DESC LIMIT 1').get('original') as {facts_json:string}).facts_json).subjectId;
  const verify=async(epoch:number,argv:string[])=>{
   const invocation={sessionIdentity:'s',compoundOperationId:`command-${epoch}`,validationInvocationId:`command-${epoch}`};
   const proposal=await f.composition.public.invoke('completion.prepare-owner',{enrollment:{ownerKind:f.owner.ownerKind,ownerId:f.owner.ownerId,invocations:[invocation]},registration},f.peer) as {challengeId:string};await f.composition.public.invoke('completion.authorize-owner',{challengeId:proposal.challengeId},f.peer);
   const challenge=await f.material.prepare({purpose:'isolated-command',invocation,materials:[{path:'/workspace/a',byteLimit:1}],exactCommand:{argv,cwdRelative:'.'},expiresAt:105000},f.peer,signal),grant=await f.material.authorize(challenge.challengeId,f.peer,signal),staged=await f.material.stage({grantHandle:grant,invocation},f.peer,signal);
   const p=await f.operations.prepare({mountPlanHandle:staged.mountPlanHandle,obligationId:'original',expectedAttemptEpoch:epoch,requestSource:'user'},f.peer,signal);await f.operations.dispatch({operationHandle:p.operationHandle},f.peer,signal);
   return f.composition.privateHost.authorityService.getCurrentDependencies(f.owner)[0].subjectId;
  };
  const different=await verify(1,['/bin/true','different']),returned=await verify(2,['/bin/true']);expect(different).not.toBe(original);expect(returned).not.toBe(different);expect(returned).not.toBe(original);
 }finally{await f.close();}
});
