import {createIntentNativeContractHost} from '../../src/runtime/intent-delegation/native-contract-host.js';
import {intentBusinessContractHash} from '../../src/runtime/verification/intent-business-contract.js';
import {intentOriginalRegistrationHash} from '../../src/runtime/verification/intent-contract-enrollment.js';
import type {FileSessionStore} from '../../src/ai/runtime/session-store/file-store.js';
import type {AgentSessionState} from '../../src/ai/runtime/session.js';
import type {createProductObservationOwner} from '../../src/runtime/sol-pi/product-bootstrap.js';
import {createIntentPlan} from '../../src/ai/intent-delegation/planner.js';
export async function registerProductIntentNativeFixture(f:{store:FileSessionStore;product:Awaited<ReturnType<typeof createProductObservationOwner>>;sessionId:string;session:AgentSessionState},controller:{call:{mockImplementation(implementation:(method:string,payload:any)=>Promise<any>):unknown}},publishRoute:()=>void,cleanup:Array<()=>unknown>){
 const host=createIntentNativeContractHost({store:f.store,authority:f.product.executionAuthority!,sessionId:f.sessionId,instanceId:'actual-host',assertAdmission(){f.product.executionSignal.throwIfAborted();f.product.owner.assertSession(f.session);}});cleanup.push(()=>host.close());
 const planned=createIntentPlan({sessionId:f.sessionId,instanceId:'actual-host',input:'请写报告，然后生成幻灯片',skills:[]});if(planned.kind!=='plan')throw Error('fixture_plan');
 const definition={version:1 as const,obligations:[{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject' as const,recipe:{kind:'artifact-content' as const,checks:[{id:'content',path:'result.md',sha256:'a'.repeat(64),structure:'utf8' as const}]}}]},requests=new Map<string,any>(),challenges=new Map<string,any>();
 controller.call.mockImplementation(async(method:string,payload:any)=>{
  if(method==='completion.prepare-owner-request'){const {requestId,...proposal}=payload,challengeId=`challenge-${requests.size}`,challenge={challengeId,canonicalReview:{version:1,purpose:'completion-owner-enrollment',authorityId:'authority',challengeId,principal:{uid:501,auditSessionId:1,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555'},profileSlot:'default',deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1,validUntil:1000},...proposal}},row={challenge,committed:false};requests.set(requestId,row);challenges.set(challengeId,row);return {created:true,challenge};}
  if(method==='completion.authorize-owner'){const row=challenges.get(payload.challengeId);row.committed=true;const e=row.challenge.canonicalReview.enrollment;row.owner={profileId:'profile',ownerKind:e.ownerKind,ownerId:e.ownerId};publishRoute();return {owner:row.owner,readGrant:{id:'read',secret:'a'.repeat(64)}};}
  if(method==='completion.recover-owner-request'){const row=requests.get(payload.requestId);return row?.committed?{state:'committed',challenge:row.challenge,owner:row.owner}:{state:'not_prepared'};}
  const row=[...requests.values()].find(value=>value.committed&&value.challenge.canonicalReview.enrollment.intentContract.subject.stageId===payload.subject.stageId);if(!row)throw Error('fixture_not_registered');
  const {enrollment,registration}=row.challenge.canonicalReview,binding=enrollment.intentContract;
  if(method==='completion.read-intent-contract')return {...binding,owner:row.owner,contractHash:intentBusinessContractHash(binding.contract),registrationHash:intentOriginalRegistrationHash(registration)};
  if(method==='publication.observeIntentDependencies'){if(binding.subject.stageId!==planned.plan.stages[0].stageId)throw Error('fixture_first_stage_only');return {subject:binding.subject,owner:row.owner,contractHash:intentBusinessContractHash(binding.contract),registrationHash:intentOriginalRegistrationHash(registration),clock:{domainId:'clock',qualificationEpoch:1,lowerBound:1,upperBound:2,evidenceHash:'b'.repeat(64)},publications:[]};}
  throw Error('unexpected '+method);
 });
 const row=await host.reserve({plan:planned.plan,definition:{verification:definition,stages:planned.plan.stages.map(stage=>({order:stage.order,templateId:stage.templateId,verification:definition}))},requestSource:'user'});
 for(const _ of row.subjects)await host.advance({intentId:row.intentId,requestSource:'user'});
 return {host,row,planned};
}
