import {readInstalledCurrentOwner} from '../verification/installed-owner-state.js';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {PersistedSessionSnapshot} from '../../ai/runtime/session-store/store.js';
import type {SessionExecutionLease} from '../../ai/runtime/session-store/execution-authority.js';
import {captureIntentData,hasProtectedIntentProducerHistory} from './intent-commit-boundary.js';
import {canonicalVerificationJson as json} from '../verification/protocol.js';
import {applyIntentStepUpdate} from './dispatcher.js';
import {assertSessionWriteOwnership} from './ownership.js';
import {parseIntentProducerAction,type IntentProducerAction} from './producer-report.js';
export type {IntentProducerOrigin,IntentProducerAction,IntentProducerReport} from './producer-report.js';
export interface IntentProducerActionInput {instanceId:string;sessionId:string;intentId:string;expectedLedgerHash:string;requestSource:'user'|'agent'|'scheduler';action:IntentProducerAction;now:number}
const id=(v:unknown)=>typeof v==='string'&&v.length>0&&Buffer.byteLength(v)<=160&&!/[\x00-\x1f\x7f]/.test(v);
function shape(v:unknown,keys:string):asserts v is Record<string,any>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==keys.split(' ').sort().join(','))throw Error('intent_producer_shape');}
export function captureIntentProducerRequest(raw:IntentProducerActionInput&{lease:SessionExecutionLease}){
 if(!raw||typeof raw!=='object')throw Error('intent_producer_input');const d=Object.getOwnPropertyDescriptors(raw);if(Reflect.ownKeys(raw).some(k=>typeof k!=='string')||Object.values(d).some(x=>!('value'in x))||!d.lease)throw Error('intent_producer_accessor');
 const {lease,...data}=d,rawData=Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v.value]));
 // Request fields have no optional-undefined semantics; unlike old snapshots,
 // extra undefined keys must not disappear before the exact shape check.
 const input=captureIntentData(rawData) as unknown as IntentProducerActionInput;json(rawData);
 shape(input,'instanceId sessionId intentId expectedLedgerHash requestSource action now');
 if(!id(input.instanceId)||!id(input.sessionId)||!id(input.intentId)||!/^[a-f0-9]{64}$/.test(input.expectedLedgerHash)||!['user','agent','scheduler'].includes(input.requestSource)||!Number.isSafeInteger(input.now)||input.now<0)throw Error('intent_producer_input');
 input.action=parseIntentProducerAction(input.action);
 return {input,lease:lease.value as SessionExecutionLease};
}
export function intentProducerLedgerHash(ledger:unknown):string{return createHash('sha256').update(json(captureIntentData(ledger))).digest('hex');}
export function intentProducerRouteVector(ledger:PersistedSessionSnapshot['intentDelegation']):string{
 if(!ledger)throw Error('intent_producer_session');const ids=new Set(ledger.intents.map(i=>i.intentId));if(ledger.latestPlan)ids.add(ledger.latestPlan.intentId);if(ledger.activeIntentId)ids.add(ledger.activeIntentId);
 return json([...ids].sort().map(ownerId=>({ownerId,route:readInstalledCurrentOwner({ownerKind:'intent',ownerId})})));
}
export function assertIntentProducerRoutesCurrent(ledger:PersistedSessionSnapshot['intentDelegation'],original:string):void{if(intentProducerRouteVector(ledger)!==original)throw Error('intent_producer_route_changed');}
/** Called only by actual SessionStore primitive under its original lease/save lock.
 * These are model reports, never proof of a producer side effect or current business. */
export function applyIntentProducerAction(previous:PersistedSessionSnapshot,input:IntentProducerActionInput,originalRoutes:string):PersistedSessionSnapshot{
 let protectedMode=(JSON.parse(originalRoutes) as Array<{route:{kind:string}}>).some(v=>v.route.kind!=='ordinary');
 const next=captureIntentData(previous),ledger=next.intentDelegation;
 if(!ledger||next.sessionId!==input.sessionId)throw Error('intent_producer_session');
 const index=ledger.intents.findIndex(i=>i.intentId===input.intentId),record=ledger.intents[index];if(!record||ledger.activeIntentId!==record.intentId)throw Error('intent_producer_intent');
 protectedMode ||= hasProtectedIntentProducerHistory(ledger);
 assertSessionWriteOwnership(ledger,input.instanceId,'record intent producer report');
 const reports=record.producerReports??[],a=input.action,prior=reports.find(r=>r.action.origin.providerInvocationId===a.origin.providerInvocationId&&r.action.origin.toolInvocationId===a.origin.toolInvocationId);
 if(prior){if(!isDeepStrictEqual(prior.action,a)||prior.now!==input.now||prior.requestSource!==input.requestSource)throw Error('intent_producer_replay_conflict');return next;}
 if(intentProducerLedgerHash(ledger)!==input.expectedLedgerHash)throw Error('intent_producer_stale');
 if(input.now<record.updatedAt||['completed','cancelled','failed','publication_pending'].includes(record.overallStatus))throw Error('intent_producer_terminal');
 const stage=record.stages.find(s=>s.stageId===record.activeStageId);if(!stage)throw Error('intent_producer_stage');
 let updated=record,artifactId:string|null=null;
 if(a.kind==='step-report'){
  updated=applyIntentStepUpdate(record,{stepId:a.stepId,status:a.status,now:input.now});
  if(protectedMode&&a.status==='failed'){updated.stages.find(s=>s.stageId===stage.stageId)!.status='waiting_user';updated.overallStatus='waiting_user';}
  if(protectedMode&&a.status==='completed'&&(updated.stages.find(s=>s.stageId===stage.stageId)?.status==='completed'||updated.activeStageId!==stage.stageId||updated.overallStatus==='completed')){
   const ended=updated.stages.find(s=>s.stageId===stage.stageId)!;ended.status='publication_pending';ended.structuralValidation=stage.structuralValidation;ended.semanticValidation=stage.semanticValidation;
   updated.activeStageId=stage.stageId;updated.activeStepId=stage.activeStepId;updated.steps=ended.steps;updated.overallStatus='publication_pending';
   // The ordinary reducer's next-stage projection is not an execution fact.
   updated.stages=updated.stages.map(s=>s.stageId===stage.stageId?s:record.stages.find(old=>old.stageId===s.stageId)!);
  }
  updated.latestBreadcrumb=a.breadcrumb;if(a.blockedReason!==null)updated.blockedReason=a.blockedReason;
  ledger.breadcrumbs.push({intentId:record.intentId,stepId:a.stepId,status:a.status,message:a.breadcrumb,createdAt:input.now});
  if(a.receiptNote!==null)ledger.receipt={intentId:record.intentId,stepId:a.stepId,note:a.receiptNote,createdAt:input.now};
 }else{
  if(a.stageId!==stage.stageId)throw Error('intent_producer_stage');artifactId=`artifact_${randomUUID()}`;
  updated.artifacts=[...(updated.artifacts??[]),{artifactId,stageId:a.stageId,kind:a.kindOfArtifact,storage:a.storage,label:a.label,...(a.path===null?{}:{path:a.path}),...(a.inlineValue===null?{}:{inlineValue:a.inlineValue}),...(a.summary===null?{}:{summary:a.summary}),structuralValidation:protectedMode?'pending':a.reportedStructuralValidation,semanticValidation:protectedMode?'pending':a.reportedSemanticValidation,createdAt:input.now}];stage.latestArtifactId=artifactId;if(!protectedMode){stage.structuralValidation=a.reportedStructuralValidation;stage.semanticValidation=a.reportedSemanticValidation;}
 }
 updated.producerReports=[...reports,{protectionMode:protectedMode?'protected':'ordinary',action:captureIntentData(a),requestSource:input.requestSource,now:input.now,artifactId}];updated.updatedAt=input.now;
 updated=captureIntentData(updated);ledger.intents[index]=updated;ledger.latestPlan=captureIntentData(updated);ledger.updatedAt=Math.max(ledger.updatedAt,input.now);next.updatedAt=Math.max(next.updatedAt,input.now);return next;
}
