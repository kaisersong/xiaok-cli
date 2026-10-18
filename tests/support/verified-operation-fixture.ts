import {createHash} from 'node:crypto';
import {installedControllerFixture} from './installed-controller-fixture.js';
import {createApprovedVerificationOperations} from '../../src/runtime/verification/approved-verification-operation.js';
import {createLoopApplicationBinding} from '../../src/runtime/verification/loop-application-binding.js';
import {loopHostSubjectOwner} from '../../src/runtime/verification/loop-host-subject.js';
import {createApplicationBindingAuthority} from '../../src/runtime/verification/application-binding-authority.js';
import {applicationBindingReviewBytes} from '../../src/runtime/verification/application-binding-review.js';
import {canonicalVerificationJson as json} from '../../src/runtime/verification/protocol.js';
const FixtureCleanupError=Error,defineFixtureCleanupData=Object.defineProperty;
function fixtureReservationCleanupFailure(cause:unknown,cleanupError:unknown):Error{
 const failure=new FixtureCleanupError('fixture_metadata_reservation_cleanup_unknown');
 defineFixtureCleanupData(failure,'cause',{__proto__:null,value:cause,enumerable:false,writable:false,configurable:false} as PropertyDescriptor);
 defineFixtureCleanupData(failure,'cleanupError',{__proto__:null,value:cleanupError,enumerable:false,writable:false,configurable:false} as PropertyDescriptor);
 return failure;
}
const H='a'.repeat(64),hash=(text:string|Buffer)=>createHash('sha256').update(text).digest('hex'),invocation={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'};
/** Actual installed start mints all private owners; only native/engine leaves are fixtures. */
export async function verifiedOperationFixture(mode:string='dispatch',fixtureOptions:{controllerMetadataMinimumBytes?:number;onClock?:()=>void;onQualified?:()=>void|Promise<void>;onRunCurrent?:()=>void;onAuthorityQualified?:()=>void}={}){
 const artifact=mode==='maximum-artifact'?Buffer.alloc(12*1024**2-32768,97):mode==='large-artifact'?Buffer.alloc(300*1024,97):Buffer.from('result');
 const f=await installedControllerFixture({artifact,incompleteOutput:mode==='incomplete-output',onClock:fixtureOptions.onClock,onQualified:fixtureOptions.onQualified,onAuthorityQualified:fixtureOptions.onAuthorityQualified}),peer=f.peer,material=f.material,command={argv:['/bin/true'],cwdRelative:'.'};
  if(fixtureOptions.controllerMetadataMinimumBytes!==undefined){try{f.reserveControllerMetadata(fixtureOptions.controllerMetadataMinimumBytes);}catch(error){try{await f.close();}catch(cleanupError){throw fixtureReservationCleanupFailure(error,cleanupError);}throw error;}}
  const checks=[{id:'content',path:'result',sha256:hash(artifact),structure:'bytes'},...(mode==='maximum-artifact'?[{id:'content-second',path:'second-result',sha256:hash(artifact),structure:'bytes'}]:[])];
  const recipe={kind:'artifact-content',checks},obligation={obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject',definitionHash:hash(json(recipe)),requiredCheckIds:checks.map(check=>check.id)};
  const loopSubject={kind:'loop-run' as const,loopId:'artifact-evidence-regression',runId:'loop-run',stage:null};
  const registration={migrationEpoch:1,obligations:[{obligation,recipe}],source:{kind:'new-owner'}};
  const loopMode=mode==='loop-application';
  const ownerEnrollment=loopMode?{...loopHostSubjectOwner(loopSubject),loopSubject,invocations:[]}:{ownerKind:mode==='goal-application'?'goal':'task',ownerId:mode==='goal-application'?'goal':'task',invocations:[invocation]};
  const enrollment=await f.composition.public.invoke('completion.prepare-owner',{enrollment:ownerEnrollment,registration},peer) as any;
  const {owner}=await f.composition.public.invoke('completion.authorize-owner',{challengeId:enrollment.challengeId},peer) as any;
  if(loopMode){
   const binding=createLoopApplicationBinding({version:1,kind:'loop',subject:loopSubject,candidateId:'first-batch',candidateRevision:1,originalTriggerJson:'{"kind":"manual"}',logicalRunKey:null,
    contract:{version:1,kind:'builtin-diagnostic',scanner:'artifact-evidence-regression',objective:'Publish original report',completionCriterion:'Verify complete original content'},
    body:{kind:'builtin-diagnostic',scanner:'artifact-evidence-regression',observedAt:1000,summary:'Original report',nextActionKind:'none',nextActionSummary:null,diagnostic:{kind:'artifact-evidence-regression',scannedOwnerCount:0,openAnomalyCount:0,resolvedAnomalyCount:0,anomalies:[]},artifacts:[{selection:{kind:'local',obligationId:'original',path:'result'},sha256:hash(artifact),size:artifact.length}]}});
   const application=createApplicationBindingAuthority({database:f.database,authorityId:'authority',completion:f.composition,clock:f.clock,assertCurrent(){},resolvePrincipal:p=>({...p,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid' as const}),async approve(review){return {uid:peer.uid,auditSessionId:peer.auditSessionId,reviewHash:hash(applicationBindingReviewBytes(review))};}});
   try{const prepared=application.prepare({requestSource:'user',binding},peer);await application.authorize({requestSource:'user',challengeId:prepared.challengeId},peer,new AbortController().signal);}finally{application.close();}
   const append=await f.composition.public.invoke('completion.prepare-owner',{enrollment:{...loopHostSubjectOwner(loopSubject),invocations:[invocation]},registration},peer) as any;
   await f.composition.public.invoke('completion.authorize-owner',{challengeId:append.challengeId},peer);
  }
  if(mode==='goal-application'){const binding={version:1 as const,kind:'goal' as const,sessionId:invocation.sessionIdentity,goalId:'goal',epoch:1,objective:'original goal',completionCriterion:null,expectedEvidenceKinds:['answer' as const]};f.composition.privateHost.authorityHost.beginApplicationTransition({owner,transitionId:'goal-first',previousBindingHash:null,binding,registrationHash:H});f.composition.privateHost.authorityHost.finishApplicationTransition(owner,'goal-first',()=>{});}

  const challenge=await material.prepare({purpose:'isolated-command',invocation,materials:[{path:'/workspace/a',byteLimit:1}],exactCommand:command,expiresAt:105000},peer,new AbortController().signal),grant=await material.authorize(challenge.challengeId,peer,new AbortController().signal),staged=await material.stage({grantHandle:grant,invocation},peer,new AbortController().signal);
  let operations=f.operations;
  const prepared=await operations.prepare({mountPlanHandle:staged.mountPlanHandle,obligationId:'original',expectedAttemptEpoch:0,requestSource:'agent'},peer,new AbortController().signal);
  await operations.dispatch({operationHandle:prepared.operationHandle},peer,new AbortController().signal);
  return {...f,owner,operations,recreateOperations(){operations=createApprovedVerificationOperations(f.operationInput);return operations;},async close(preserveRoot=false){await operations.close();await f.close(preserveRoot);}};
}
