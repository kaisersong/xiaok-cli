import {deriveIntentParentBody} from './parent-candidate.js';
import type {IntentStageContext} from './stage-context.js';
import {isDeepStrictEqual} from 'node:util';
import {captureIntentData} from './data.js';
import {applyIntentStepUpdate} from './dispatcher.js';
import {intentPublicationTarget,applyIntentPublicationMutation,type IntentPublicationCandidate} from './publication-candidate-journal.js';
import {intentNativeLedgerHash} from './native-contract-journal.js';
import {intentHostSubjectOwner} from '../verification/intent-host-subject.js';
import {canonicalVerificationJson as json} from '../verification/protocol.js';
import type {SessionIntentLedger} from './types.js';
import type {PersistedSessionSnapshot} from '../../ai/runtime/session-store/store.js';
import type {ReceiverClockEvidence} from '../verification/receiver-store.js';
import type {VerificationOwner} from '../verification/proof-authority.js';
export interface IntentBusinessProjection {
 nextStageContext?:IntentStageContext|null;
 version:1;candidateId:string;receiverRequestId:string;appliedAt:number;clock:Readonly<ReceiverClockEvidence>;
 publications:Array<{owner:Readonly<VerificationOwner>;operationId:string;fullTupleHash:string;businessRevision:number;payloadHash:string;bindingHash:string;applicationRevision:number;candidateRevision:number;registrationHash:string}>;
}
const shape=(v:unknown,keys:string)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==keys.split(' ').sort().join(','))throw Error('intent_projection_shape');};
const id=(v:unknown)=>typeof v==='string'&&!!v&&Buffer.byteLength(v)<=160&&!/[\x00-\x1f\x7f]/.test(v);
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function parseIntentBusinessProjection(raw:unknown,candidate:IntentPublicationCandidate,ledger:SessionIntentLedger):IntentBusinessProjection|undefined{
 if(raw===undefined)return undefined;const row=captureIntentData(raw) as IntentBusinessProjection;shape(row,'version candidateId receiverRequestId appliedAt clock publications'+(Object.hasOwn(row,'nextStageContext')?' nextStageContext':''));
 if(row.nextStageContext!==undefined&&row.nextStageContext!==null){shape(row.nextStageContext,'stageId messageCount messagesHash');if(!id(row.nextStageContext.stageId)||!Number.isSafeInteger(row.nextStageContext.messageCount)||row.nextStageContext.messageCount<0||!hash(row.nextStageContext.messagesHash))throw Error('intent_stage_context_shape');}
 const receiver=candidate.receiverAttempts?.find(r=>r.requestId===row.receiverRequestId),binding=intentPublicationTarget(ledger,candidate),stage=binding.contract.stages.find(s=>s.stageId===candidate.stageId)!;
 if(row.version!==1||row.candidateId!==candidate.id||!receiver||receiver.status!=='committed'||!receiver.observation||!Number.isSafeInteger(row.appliedAt)||row.appliedAt<receiver.updatedAt)throw Error('intent_projection_original');
 shape(row.clock,'domainId qualificationEpoch lowerBound upperBound evidenceHash');if(!id(row.clock.domainId)||!hash(row.clock.evidenceHash)||![row.clock.qualificationEpoch,row.clock.lowerBound,row.clock.upperBound].every(v=>Number.isSafeInteger(v)&&v>=0)||row.clock.upperBound<row.clock.lowerBound)throw Error('intent_projection_clock');
 const ids=[candidate.stageId,...(candidate.stageId===null?binding.contract.stages.map(s=>s.stageId):stage.dependsOnStageIds)];if(!Array.isArray(row.publications)||row.publications.length!==ids.length)throw Error('intent_projection_inventory');
 row.publications.forEach((p,i)=>{shape(p,'owner operationId fullTupleHash businessRevision payloadHash bindingHash applicationRevision candidateRevision registrationHash');shape(p.owner,'profileId ownerKind ownerId');const local=i===0?candidate:ledger.publicationCandidates?.find(c=>c.intentId===candidate.intentId&&c.stageId===ids[i]),application=local?.applicationAttempts.at(-1),route=application?.route&&JSON.parse(application.route);
  if(!local||!route||application?.phase!=='ready'||json(p.owner)!==json({...intentHostSubjectOwner({...binding.subject,stageId:ids[i]}),profileId:route.owner.profileId})||!id(p.operationId)||![p.fullTupleHash,p.payloadHash,p.bindingHash,p.registrationHash].every(hash)||![p.businessRevision,p.applicationRevision,p.candidateRevision].every(v=>Number.isSafeInteger(v)&&v>=1)||p.bindingHash!==local.bindingHash||p.candidateRevision!==local.candidateRevision||p.applicationRevision!==application.observation?.current?.revision||p.registrationHash!==application.observation.registrationHash)throw Error('intent_projection_binding');
  const fact=i===0?receiver.observation:local.receiverAttempts?.find(r=>r.status==='committed')?.observation;if(!fact||p.operationId!==fact.operationId||p.fullTupleHash!==fact.fullTupleHash||p.businessRevision!==fact.businessRevision||i>0&&!local.businessProjection)throw Error('intent_projection_receiver');
 });if(candidate.businessProjection)assertIntentCandidateFactSource(ledger,candidate);return row;
}
/** Unique deterministic cache projection. Actual write authority remains the fixed host's private ticket. */
export function projectIntentBusinessLedger(ledger:SessionIntentLedger,candidateId:string,raw:IntentBusinessProjection):SessionIntentLedger{
 const next=captureIntentData(ledger),candidate=next.publicationCandidates?.find(c=>c.id===candidateId);if(!candidate)throw Error('intent_projection_candidate');const projection=parseIntentBusinessProjection(raw,candidate,next)!;
 if(candidate.businessProjection){if(!isDeepStrictEqual(candidate.businessProjection,projection))throw Error('intent_projection_immutable');return next;}
 const index=next.intents.findIndex(r=>r.intentId===candidate.intentId),record=next.intents[index],stage=record?.stages.find(s=>s.stageId===candidate.stageId);
 if(candidate.stageId===null){
  if(!record||next.activeIntentId!==record.intentId||record.overallStatus!=='publication_pending'||record.stages.some(s=>s.status!=='completed')||projection.appliedAt<next.updatedAt||projection.nextStageContext!==undefined&&projection.nextStageContext!==null)throw Error('intent_projection_current');
  assertIntentCandidateFactSource(next,candidate);const updated={...record,overallStatus:'completed' as const};next.intents[index]=updated;next.latestPlan=captureIntentData(updated);next.updatedAt=projection.appliedAt;candidate.businessProjection=projection;return next;
 }
 if(!record||!stage||next.activeIntentId!==record.intentId||record.activeStageId!==stage.stageId||record.overallStatus!=='publication_pending'||stage.status!=='publication_pending'||stage.steps.some(s=>s.status!=='completed')||projection.appliedAt<next.updatedAt)throw Error('intent_projection_current');
 // Reuse the original complete candidate capture, including every report/artifact/selection.
 const snapshot={sessionId:next.sessionId,intentDelegation:next,updatedAt:next.updatedAt} as PersistedSessionSnapshot;
 applyIntentPublicationMutation(snapshot,{publicationAction:'reserve',sessionId:next.sessionId,instanceId:next.ownership.ownerInstanceId!,expectedLedgerHash:intentNativeLedgerHash(next),requestSource:'user',now:projection.appliedAt,artifactSelections:candidate.body.artifacts.map(a=>({artifactId:a.artifactId,obligationId:a.selection.obligationId,path:a.selection.path})),fileObservations:candidate.fileObservations});
 let updated=applyIntentStepUpdate(record,{stepId:record.activeStepId,status:'completed',now:projection.appliedAt});if(updated.overallStatus==='completed')updated.overallStatus='publication_pending';
 const completed=updated.stages.find(s=>s.stageId===stage.stageId)!;updated.artifacts=updated.artifacts?.map(a=>a.stageId===stage.stageId?{...a,structuralValidation:completed.structuralValidation,semanticValidation:completed.semanticValidation}:a);
 if(projection.nextStageContext!==undefined){const nextStage=updated.activeStageId===stage.stageId?undefined:updated.stages.find(s=>s.stageId===updated.activeStageId);if(nextStage){if(projection.nextStageContext?.stageId!==nextStage.stageId)throw Error('intent_stage_context_stage');nextStage.needsFreshContextHandoff=false;}else if(projection.nextStageContext!==null)throw Error('intent_stage_context_stage');}
 updated=captureIntentData(updated);next.intents[index]=updated;next.latestPlan=captureIntentData(updated);next.updatedAt=projection.appliedAt;candidate.businessProjection=projection;return next;
}
export function assertIntentBusinessProjectionTransition(before:SessionIntentLedger|undefined,after:SessionIntentLedger|undefined){
 if(!before||!after)throw Error('intent_projection_original');const changed=after.publicationCandidates?.filter(c=>!isDeepStrictEqual(c.businessProjection,before.publicationCandidates?.find(r=>r.id===c.id)?.businessProjection))??[];
 if(changed.length!==1||!changed[0].businessProjection||!isDeepStrictEqual(projectIntentBusinessLedger(before,changed[0].id,changed[0].businessProjection),after))throw Error('intent_projection_transition');
}

/** Pure comparison of historical producer facts; no status or permission is granted. */
export function assertIntentCandidateFactSource(ledger:SessionIntentLedger,candidate:IntentPublicationCandidate){
 const record=ledger.intents.find(r=>r.intentId===candidate.intentId),stage=record?.stages.find(s=>s.stageId===candidate.stageId),body=candidate.body;
 if(candidate.stageId===null){if(body.kind!=='intent-parent'||json(deriveIntentParentBody(ledger,candidate.intentId,body.stages))!==json(body)||candidate.businessProjection&&record?.overallStatus!=='completed')throw Error('intent_projection_source');return;}
 if(!record||!stage||body.kind!=='intent-stage')throw Error('intent_projection_source');
 const reports=(record.producerReports??[]).filter(r=>r.action.kind==='artifact-report'?r.action.stageId===stage.stageId:stage.steps.some(s=>s.stepId===(r.action as {stepId:string}).stepId)),terminals=(record.executionTerminals??[]).filter(r=>r.kind==='step'&&stage.steps.some(s=>s.stepId===r.identity)),artifacts=(record.artifacts??[]).filter(a=>a.stageId===stage.stageId);
 if(json(reports)!==json(body.producerReports??[])||json(terminals)!==json(body.executionReports)||artifacts.length!==body.artifacts.length)throw Error('intent_projection_source');
 artifacts.forEach((a,i)=>{const b=body.artifacts[i];if(a.artifactId!==b.artifactId||a.stageId!==b.stageId||a.kind!==b.kind||a.label!==b.label||(a.summary??null)!==b.summary||a.createdAt!==b.createdAt||json(a.storage==='inline'?{kind:'inline',text:a.inlineValue??''}:{kind:'file',originalPath:a.path})!==json(b.content))throw Error('intent_projection_source');});
 if(candidate.businessProjection){const semantic=stage.steps.some(s=>s.key==='validate')?'passed':'pending';if(stage.status!=='completed'||stage.steps.some(s=>s.status!=='completed')||stage.structuralValidation!=='passed'||stage.semanticValidation!==semantic||artifacts.some(a=>a.structuralValidation!=='passed'||a.semanticValidation!==semantic))throw Error('intent_projection_overlay');}
}
