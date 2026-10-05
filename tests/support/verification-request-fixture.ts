import {verifiedOperationFixture} from './verified-operation-fixture.js';
export async function verificationRequestFixture(onQualified?:()=>void|Promise<void>,onClock?:()=>void,onRunCurrent?:()=>void){
 const f=await verifiedOperationFixture('loop-application',{onQualified,onClock,onRunCurrent}),signal=new AbortController().signal;
 const invocation={sessionIdentity:'request-session',compoundOperationId:'request-operation',validationInvocationId:'request-validation'};
 const registration=JSON.parse((f.database.prepare('SELECT registration_json FROM owner_enrollment_intents').get() as {registration_json:string}).registration_json);
 const challenge=await f.composition.public.invoke('completion.prepare-owner',{enrollment:{ownerKind:f.owner.ownerKind,ownerId:f.owner.ownerId,invocations:[invocation]},registration},f.peer) as {challengeId:string};
 await f.composition.public.invoke('completion.authorize-owner',{challengeId:challenge.challengeId},f.peer);
 const materials=await f.material.prepare({purpose:'isolated-command',invocation,materials:[{path:'/workspace/a',byteLimit:1}],exactCommand:{argv:['/bin/true'],cwdRelative:'.'},expiresAt:105000},f.peer,signal);
 const grant=await f.material.authorize(materials.challengeId,f.peer,signal),staged=await f.material.stage({grantHandle:grant,invocation},f.peer,signal);
 const query={requestId:'original-request',invocation,obligationId:'original'},request={...query,expectedAttemptEpoch:1,requestSource:'user',mountPlanHandle:staged.mountPlanHandle};
 return {...f,query,request,authorizationId:materials.challengeId};
}
