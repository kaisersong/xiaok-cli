import {captureIntentSnapshot} from './intent-snapshot-data.js';
export {captureIntentSnapshot} from './intent-snapshot-data.js';
import {assertIntentVerificationRetained} from './verification-execution-journal.js';
import {assertIntentPublicationRetained} from './publication-candidate-journal.js';
import {assertIntentNativeJournalRetained,assertNoIntentNativeJournal} from './native-contract-journal.js';
import {isDeepStrictEqual} from 'node:util';
import {readInstalledCurrentOwner} from '../verification/installed-owner-state.js';
import type {PersistedSessionSnapshot} from '../../ai/runtime/session-store/store.js';
import {createIntentLedgerRecord, cloneIntentRecord, type SessionIntentLedger} from './types.js';
export interface IntentExecutionTerminal {
 kind:'turn'|'step';identity:string;status:'stopped'|'completed'|'failed';
 requestSource:'user'|'agent'|'scheduler';recordedAt:number;
}
export interface IntentExecutionTerminalInput extends IntentExecutionTerminal {sessionId:string;intentId:string}
import {captureIntentData} from './data.js';
export {captureIntentData} from './data.js';

const id=(v:unknown)=>typeof v==='string'&&v.length>0&&Buffer.byteLength(v)<=160&&!/[\x00-\x1f\x7f]/.test(v);
export function parseIntentExecutionInput(raw:unknown):IntentExecutionTerminalInput {
 const v=captureIntentData(raw) as IntentExecutionTerminalInput;
 if(!v||typeof v!=='object'||Object.keys(v).sort().join(',')!=='identity,intentId,kind,recordedAt,requestSource,sessionId,status'||!id(v.sessionId)||!id(v.intentId)||!id(v.identity)||!['turn','step'].includes(v.kind)||!['stopped','completed','failed'].includes(v.status)||!['user','agent','scheduler'].includes(v.requestSource)||!Number.isSafeInteger(v.recordedAt)||v.recordedAt<0)throw Error('intent_execution_input');
 return v;
}
function terminals(record:any):IntentExecutionTerminal[]{
 const values=record.executionTerminals??[];if(!Array.isArray(values))throw Error('intent_execution_records');const keys=new Set<string>();
 for(const v of values){parseIntentExecutionInput({...v,sessionId:record.sessionId,intentId:record.intentId});if(Object.keys(v).sort().join(',')!=='identity,kind,recordedAt,requestSource,status')throw Error('intent_execution_record');const key=JSON.stringify([v.kind,v.identity]);if(keys.has(key))throw Error('intent_execution_duplicate');keys.add(key);if(v.kind==='step'&&!record.stages.some((s:any)=>s.steps.some((step:any)=>step.stepId===v.identity)))throw Error('intent_execution_step');}
 return values;
}
function records(ledger:SessionIntentLedger|undefined):Map<string,any>{
 const result=new Map<string,any>();if(ledger===undefined)return result;
 if(!ledger||!Array.isArray(ledger.intents))throw Error('intent_commit_ledger');
 for(const record of ledger.intents){if(!record||!id(record.intentId)||result.has(record.intentId))throw Error('intent_commit_identity');terminals(record);result.set(record.intentId,record);}return result;
}
function mirrors(ledger:SessionIntentLedger,sessionId:string){
 const map=records(ledger);if(ledger.sessionId!==sessionId||ledger.activeIntentId!==undefined&&!map.has(ledger.activeIntentId))throw Error('intent_commit_identity');
 if(ledger.latestPlan!==null&&(!ledger.latestPlan||!isDeepStrictEqual(ledger.latestPlan,map.get(ledger.latestPlan.intentId))))throw Error('intent_commit_mirror');
 for(const record of map.values()){const stage=record.stages.find((s:any)=>s.stageId===record.activeStageId);if(record.sessionId!==sessionId||!stage||record.activeStepId!==stage.activeStepId||!isDeepStrictEqual(record.steps,stage.steps))throw Error('intent_commit_mirror');}
}
function baseline(ledger:SessionIntentLedger|undefined){
 if(!ledger)return null;const value=captureIntentData(ledger) as any;delete value.updatedAt;delete value.publicationCandidates;delete value.verificationExecutions;
 for(const record of [...value.intents,...(value.latestPlan?[value.latestPlan]:[])]){delete record.executionTerminals;delete record.updatedAt;}return value;
}
/** Initial protected data must be the original constructor draft, not arbitrary history. */
function assertInitialDraft(ledger:SessionIntentLedger):void {
 const pick=(value:any,keys:string)=>Object.fromEntries(keys.split(' ').filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));
 const draftRecords=ledger.intents.map(record=>{
  const plan:any=pick(record,'intentId instanceId sessionId rawIntent normalizedIntent providedSourcePaths intentType deliverable finalDeliverable explicitConstraints delegationBoundary riskTier intentMode segmentationConfidence templateId');
  plan.stages=record.stages.map(stage=>({...pick(stage,'stageId order label intentType deliverable templateId riskTier dependsOnStageIds'),steps:stage.steps.map(step=>({...pick(step,'stepId key order role skillName dependsOn riskTier'),status:'planned'}))}));
  plan.steps=plan.stages[0]?.steps??[];
  if(!Number.isSafeInteger(record.createdAt)||record.createdAt<0)throw Error('intent_initial_draft');
  const expected=captureIntentData(cloneIntentRecord(createIntentLedgerRecord(plan,record.createdAt)));
  if(!isDeepStrictEqual(record,expected))throw Error('intent_initial_draft');
  return expected;
 });
 const first=draftRecords[0],last=draftRecords.at(-1);
 if(!first||!last)throw Error('intent_initial_draft');
 const expected=captureIntentData({sessionId:ledger.sessionId,instanceId:first.instanceId,activeIntentId:last.intentId,latestPlan:last,intents:draftRecords,breadcrumbs:[],receipt:null,salvage:null,ownership:{state:'owned',ownerInstanceId:first.instanceId,updatedAt:first.createdAt},updatedAt:last.createdAt});
 if(!isDeepStrictEqual(ledger,expected))throw Error('intent_initial_draft');
}
export function hasProtectedIntentProducerHistory(ledger:PersistedSessionSnapshot['intentDelegation']):boolean {
 return (ledger?.nativeContracts?.length??0)>0 || [...(ledger?.intents??[]),...(ledger?.latestPlan?[ledger.latestPlan]:[])].some(row=>row.producerReports?.some(report=>report.protectionMode!=='ordinary'));
}
/** Called inside both actual store locks. This is a deny boundary, not a grant. */
export function assertIntentSessionCommit(previous:PersistedSessionSnapshot|null,next:PersistedSessionSnapshot,forkSource?:PersistedSessionSnapshot,executionPrimitive=false,producerPrimitive=false,nativePrimitive=false,publicationPrimitive=false,verificationPrimitive=false,receiverPrimitive:boolean|'projection'=false):void{
 assertIntentVerificationRetained(previous?.intentDelegation,next.intentDelegation,verificationPrimitive);if(forkSource?.intentDelegation?.verificationExecutions?.length)throw Error('intent_verification_fork');
 assertIntentPublicationRetained(previous?.intentDelegation,next.intentDelegation,receiverPrimitive==='projection'?'projection':receiverPrimitive?'receiver':publicationPrimitive&&!verificationPrimitive);if(forkSource?.intentDelegation?.publicationCandidates?.length)throw Error('intent_candidate_fork');
 assertIntentNativeJournalRetained(previous?.intentDelegation,next.intentDelegation,next.sessionId,nativePrimitive);if(forkSource)assertNoIntentNativeJournal(forkSource);
 const old=records(previous?.intentDelegation),incoming=records(next.intentDelegation),fork=records(forkSource?.intentDelegation);
 for(const [ledger,rows] of [[previous?.intentDelegation,old],[forkSource?.intentDelegation,fork]] as const){const mirror=ledger?.latestPlan;if(mirror&&!isDeepStrictEqual(mirror.producerReports??[],rows.get(mirror.intentId)?.producerReports??[]))throw Error('intent_producer_original_mirror');}
 for(const [key,value] of incoming){const before=old.get(key);if(!executionPrimitive&&!isDeepStrictEqual(terminals(value),before?terminals(before):[]))throw Error('intent_execution_requires_primitive');if(before){const prior=terminals(before),after=terminals(value);if(prior.some((v,i)=>!isDeepStrictEqual(v,after[i])))throw Error('intent_execution_immutable');}}
 for(const [key,value] of old)if(terminals(value).length&&!incoming.has(key))throw Error('intent_execution_immutable');
 for(const [key,value] of incoming){const prior=old.get(key)?.producerReports??[],after=value.producerReports??[];if(!producerPrimitive&&!isDeepStrictEqual(prior,after)||prior.some((v:unknown,i:number)=>!isDeepStrictEqual(v,after[i])))throw Error('intent_producer_requires_primitive');}
 for(const [key,value] of old)if(value.producerReports?.length&&!incoming.has(key))throw Error('intent_producer_immutable');
 const nextMirror=next.intentDelegation?.latestPlan;
 if(nextMirror&&!isDeepStrictEqual(nextMirror.producerReports??[],incoming.get(nextMirror.intentId)?.producerReports??[]))throw Error('intent_producer_mirror');
 if(nextMirror){const prior=old.get(nextMirror.intentId);const values=terminals(nextMirror);if(!executionPrimitive&&!isDeepStrictEqual(values,prior?terminals(prior):[]))throw Error('intent_execution_requires_primitive');if(values.length&&!isDeepStrictEqual(values,terminals(incoming.get(nextMirror.intentId)??{})))throw Error('intent_execution_mirror');}
 const identities=new Set([...old.keys(),...incoming.keys(),...fork.keys()]);
 for(const ledger of [previous?.intentDelegation,next.intentDelegation,forkSource?.intentDelegation]){if(ledger?.latestPlan){if(!id(ledger.latestPlan.intentId))throw Error('intent_commit_identity');identities.add(ledger.latestPlan.intentId);}if(ledger?.activeIntentId){if(!id(ledger.activeIntentId))throw Error('intent_commit_identity');identities.add(ledger.activeIntentId);}}
 let protectedLedger=[previous?.intentDelegation,next.intentDelegation,forkSource?.intentDelegation].some(hasProtectedIntentProducerHistory);
 for(const ownerId of identities){const route=readInstalledCurrentOwner({ownerKind:'intent',ownerId});if(route.kind!=='ordinary')protectedLedger=true;}
 if(!protectedLedger)return;
 if(fork.size)throw Error('intent_protected_fork');
 if(next.intentDelegation)mirrors(next.intentDelegation,next.sessionId);
 if(previous?.intentDelegation){if(!producerPrimitive&&!nativePrimitive&&receiverPrimitive!=='projection'&&!isDeepStrictEqual(baseline(previous.intentDelegation),baseline(next.intentDelegation)))throw Error('intent_completion_requires_publication');}
 else if(next.intentDelegation&&!nativePrimitive)assertInitialDraft(next.intentDelegation);
}
/** Store-private call path constructs from locked current state, never supplied nextSnapshot. */
export function appendIntentExecutionTerminal(previous:PersistedSessionSnapshot,input:IntentExecutionTerminalInput):PersistedSessionSnapshot {
 const next=captureIntentSnapshot(previous),ledger=next.intentDelegation;
 if(!ledger||next.sessionId!==input.sessionId)throw Error('intent_execution_session');
 mirrors(ledger,next.sessionId);const record=ledger.intents.find(i=>i.intentId===input.intentId);if(!record)throw Error('intent_execution_missing');
 if(input.kind==='step'&&!record.stages.some(s=>s.steps.some(step=>step.stepId===input.identity)))throw Error('intent_execution_step');
 const original=terminals(record),existing=original.find(v=>v.kind===input.kind&&v.identity===input.identity);
 if(existing){if(existing.status!==input.status||existing.recordedAt!==input.recordedAt)throw Error('intent_execution_conflict');return next;}
 if(input.requestSource==='scheduler')throw Error('intent_execution_source');
 if(input.recordedAt<record.createdAt)throw Error('intent_execution_time');
 const {sessionId:_,intentId:__,...event}=input;record.executionTerminals=[...original,event];record.updatedAt=Math.max(record.updatedAt,input.recordedAt);
 if(ledger.latestPlan?.intentId===record.intentId)ledger.latestPlan=captureIntentData(record);
 ledger.updatedAt=Math.max(ledger.updatedAt,input.recordedAt);next.updatedAt=Math.max(next.updatedAt,input.recordedAt);return next;
}
export function captureIntentExecutionRequest(raw:IntentExecutionTerminalInput&{lease:import('../../ai/runtime/session-store/execution-authority.js').SessionExecutionLease}){
 if(!raw||typeof raw!=='object')throw Error('intent_execution_input');const descriptors=Object.getOwnPropertyDescriptors(raw);
 if(Reflect.ownKeys(raw).some(k=>typeof k!=='string')||Object.values(descriptors).some(d=>!('value'in d)))throw Error('intent_execution_accessor');
 const {lease,...data}=descriptors;if(!lease)throw Error('intent_execution_lease');
 return {input:parseIntentExecutionInput(Object.fromEntries(Object.entries(data).map(([k,d])=>[k,d.value]))),lease:lease.value as import('../../ai/runtime/session-store/execution-authority.js').SessionExecutionLease};
}
