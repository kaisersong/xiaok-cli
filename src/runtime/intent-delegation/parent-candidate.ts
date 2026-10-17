import {readInstalledCurrentOwner} from '../verification/installed-owner-state.js';
import {readIntentPublicationRowFacts,intentPublicationFactArray,intentPublicationFactObject,type IntentPublicationCandidate,type IntentPublicationReaderLedgerData} from './publication-candidate-journal.js';
import {parseIntentReceiverAttempts} from './receiver-publication-journal.js';
import {canonicalVerificationJson as json} from '../verification/protocol.js';
import {intentHostSubjectOwner} from '../verification/intent-host-subject.js';
import {parseIntentBusinessProjection,assertIntentCandidateFactSource} from './business-projection.js';
import {parseIntentNativeContracts} from './native-contract-journal.js';
import type {IntentCandidateBody,IntentStagePublicationReference} from '../verification/intent-application-binding.js';
import type {SessionIntentLedger} from './types.js';
/** Deterministic historical facts, not an issuer or a current authority check. */
export function deriveIntentParentBody(ledger:IntentPublicationReaderLedgerData,intentId:string,refs:readonly Readonly<IntentStagePublicationReference>[]):Extract<IntentCandidateBody,{kind:'intent-parent'}>{
 const record=ledger.intents.find(r=>r.intentId===intentId),native=parseIntentNativeContracts(ledger.nativeContracts,ledger.sessionId).find(r=>r.intentId===intentId);
 if(!record||!native)throw Error('intent_parent_source');
 const sourceStages=intentPublicationFactArray(record.stages,'intent_parent_source');
 if(sourceStages.length!==native.contract.stages.length||sourceStages.some(value=>intentPublicationFactObject(value,'intent_parent_source').status!=='completed')||native.subjects.some(s=>s.attempts.at(-1)?.phase!=='enrolled')||refs.length!==native.contract.stages.length)throw Error('intent_parent_source');
 const children=native.contract.stages.map((stage,i)=>{
  const child=readIntentPublicationRowFacts(ledger,intentId,stage.stageId),ref=refs[i];
  if(!child||child.body.kind!=='intent-stage'||!child.businessProjection)throw Error('intent_parent_stage_projection');
  const projection=parseIntentBusinessProjection(child.businessProjection,child,ledger)!,fact=projection.publications[0],application=child.applicationAttempts.at(-1),receiver=parseIntentReceiverAttempts(child.receiverAttempts,child).find(r=>r.requestId===projection.receiverRequestId);
  assertIntentCandidateFactSource(ledger,child);
  if(!receiver?.observation||receiver.status!=='committed'||application?.phase!=='ready'||json(ref.subject)!==json({version:1,sessionId:ledger.sessionId,intentId,stageId:stage.stageId})||ref.candidateId!==child.id||ref.candidateRevision!==child.candidateRevision||ref.bindingHash!==child.bindingHash||ref.immutablePayloadHash!==fact.payloadHash||ref.operationId!==fact.operationId||ref.fullTupleHash!==fact.fullTupleHash||ref.committedBusinessRevision!==fact.businessRevision||json(fact.owner)!==json({...intentHostSubjectOwner(ref.subject),profileId:JSON.parse(application.route!).owner.profileId}))throw Error('intent_parent_reference');
  return {child,owner:fact.owner};
 });
 return {kind:'intent-parent',summary:children.at(-1)!.child.body.summary,stages:refs,artifacts:children.flatMap(({child,owner})=>child.body.artifacts.map(a=>({...a,selection:a.selection.kind==='local'?{...a.selection,kind:'inherited' as const,originOwner:owner,originalObligationId:a.selection.obligationId}:a.selection})))};
}

/** Rejection-only route fence, including every original child before parent side effects. */
export function assertIntentParentRoutesCurrent(ledger:SessionIntentLedger,candidate:IntentPublicationCandidate):void;
export function assertIntentParentRoutesCurrent(ledger:IntentPublicationReaderLedgerData,candidate:IntentPublicationCandidate):void;
export function assertIntentParentRoutesCurrent(ledger:IntentPublicationReaderLedgerData,candidate:IntentPublicationCandidate):void{
 if(candidate.stageId!==null)return;
 const native=parseIntentNativeContracts(ledger.nativeContracts,ledger.sessionId).find(r=>r.intentId===candidate.intentId);
 if(!native)throw Error('intent_parent_route');
 for(const stage of native.contract.stages){
  const child=readIntentPublicationRowFacts(ledger,candidate.intentId,stage.stageId),application=child?.applicationAttempts.at(-1);
  const owner=intentHostSubjectOwner({version:1,sessionId:ledger.sessionId,intentId:candidate.intentId,stageId:stage.stageId});
  if(!child||application?.phase!=='ready'||!application.route||json(readInstalledCurrentOwner(owner))!==application.route)throw Error('intent_parent_route');
 }
}
