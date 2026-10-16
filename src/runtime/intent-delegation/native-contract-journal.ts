import type { StoredSessionSnapshot } from '../../ai/runtime/session-store/stored-snapshot-types.js';
import type { StoredSessionIntentLedgerInput } from './stored-intent-clone.js';
import {intentHostSubjectOwner} from '../verification/intent-host-subject.js';
import {intentContractOriginalRegistration} from '../verification/intent-contract-enrollment.js';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {canonicalVerificationJson as json} from '../verification/protocol.js';
import {parseIntentBusinessContract,intentBusinessContractHash,type IntentBusinessContract} from '../verification/intent-business-contract.js';
import {parseGoalVerificationDefinition,type GoalVerificationDefinition} from '../goal/verification-definition.js';
import {captureIntentData} from './data.js';
import {createEmptySessionIntentLedger,createIntentLedgerRecord,type IntentPlanDraft,type IntentLedgerRecord,type SessionIntentLedger} from './types.js';
import {assertSessionWriteOwnership,resumeSessionOwnership,takeoverSessionOwnership,releaseSessionOwnership} from './ownership.js';
import type {PersistedSessionSnapshot} from '../../ai/runtime/session-store/store.js';
import type {SessionExecutionLease} from '../../ai/runtime/session-store/execution-authority.js';

export type IntentNativePhase='reserved'|'enrolling'|'enrolled'|'retired'|'stale';
export interface IntentNativeAttempt {requestId:string;phase:IntentNativePhase;retirementReason:null|'not_prepared'|'not_approved'}
export interface IntentNativeContractRecord {version:1;id:string;revision:number;intentId:string;contract:Readonly<IntentBusinessContract>;contractHash:string;originalDraft:IntentLedgerRecord;originalDraftHash:string;originalSource:'user';subjects:Array<{stageId:string|null;attempts:IntentNativeAttempt[]}>;createdAt:number;updatedAt:number}
export interface IntentNativeDefinition {verification:GoalVerificationDefinition;stages:Array<{order:number;templateId:string;verification:GoalVerificationDefinition}>}
interface Base {sessionId:string;instanceId:string;requestSource:'user'|'scheduler';now:number}
export interface ReserveIntentNativeInput extends Base {requestSource:'user';expectedLedgerHash:string;plan:IntentPlanDraft;definition:IntentNativeDefinition}
export interface AdvanceIntentNativeInput extends Base {intentId:string;expectedRevision:number;expectedRequestId:string;stageId:string|null;phase:IntentNativePhase;retirementReason:null|'not_prepared'|'not_approved'}
export interface RetryIntentNativeInput extends Base {requestSource:'user';intentId:string;expectedRevision:number;expectedRequestId:string;stageId:string|null}
export interface IntentOwnershipInput extends Base {requestSource:'user';expectedLedgerHash:string;action:'resume'|'takeover'|'release';confirmHighRisk:boolean}
export type IntentNativeMutation=({nativeAction:'reserve'}&ReserveIntentNativeInput)|({nativeAction:'advance'}&AdvanceIntentNativeInput)|({nativeAction:'retry'}&RetryIntentNativeInput)|({nativeAction:'ownership'}&IntentOwnershipInput);
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&Buffer.byteLength(v)<=160&&!/[\x00-\x1f\x7f]/.test(v);
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function shape(v:unknown,keys:string):asserts v is Record<string,any>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==keys.split(' ').sort().join(','))throw Error('intent_native_shape');}
function freeze<T>(v:T):T{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
export function freezeIntentNativeLedger(value:SessionIntentLedger|undefined):SessionIntentLedger|undefined;
export function freezeIntentNativeLedger(value:StoredSessionSnapshot['intentDelegation']):StoredSessionSnapshot['intentDelegation'];
export function freezeIntentNativeLedger(value:SessionIntentLedger|StoredSessionSnapshot['intentDelegation']):SessionIntentLedger|StoredSessionSnapshot['intentDelegation']{return value===undefined?undefined:freeze(captureIntentData(value));}
const digest=(domain:string,v:unknown)=>createHash('sha256').update(domain+'\0').update(json(captureIntentData(v))).digest('hex');
export const intentNativeLedgerHash=(v:StoredSessionIntentLedgerInput|undefined)=>digest('xiaok-intent-native-ledger-v1',v??null);
const draftHash=(v:IntentLedgerRecord)=>digest('xiaok-intent-native-draft-v1',v);
function pristine(contract:Readonly<IntentBusinessContract>,instanceId:string,now:number):IntentLedgerRecord{
 const {version:_,verification:__,...body}=contract;
 const stages=body.stages.map(({verification,...stage})=>({...stage,steps:stage.steps.map(step=>({...step,status:'planned' as const}))}));
 return captureIntentData(createIntentLedgerRecord({...body,stages,steps:stages[0].steps,instanceId,continuationMode:'new_intent'} as IntentPlanDraft,now));
}
function contractFromPlan(plan:IntentPlanDraft,definition:IntentNativeDefinition):Readonly<IntentBusinessContract>{
 shape(definition,'verification stages');if(!Array.isArray(definition.stages)||!Array.isArray(plan.stages)||definition.stages.length!==plan.stages.length)throw Error('intent_native_definitions');
 const {instanceId,continuationMode,steps,...body}=plan;if(!id(instanceId)||continuationMode!=='new_intent')throw Error('intent_native_draft');
 const stages=plan.stages.map((stage,i)=>{const d=definition.stages[i];shape(d,'order templateId verification');if(d.order!==stage.order||d.templateId!==stage.templateId)throw Error('intent_native_definitions');return {...stage,steps:stage.steps.map(({status,...step})=>{if(status!=='planned')throw Error('intent_native_draft');return step;}),verification:parseGoalVerificationDefinition(d.verification)};});
 const contract=parseIntentBusinessContract({version:1,...body,providedSourcePaths:body.providedSourcePaths??[],stages,verification:parseGoalVerificationDefinition(definition.verification)});
 const {version:_,verification:__,...plain}=contract;
 const expectedStages=plain.stages.map(({verification,...stage})=>({...stage,steps:stage.steps.map(step=>({...step,status:'planned'}))}));
 const expected:any={...plain,instanceId,continuationMode:'new_intent',stages:expectedStages,steps:expectedStages[0].steps};if(plan.providedSourcePaths===undefined)delete expected.providedSourcePaths;
 if(!isDeepStrictEqual(captureIntentData(plan),captureIntentData(expected)))throw Error('intent_native_draft');
 // Preflight the full original enrollment and registration body, never truncate it.
 // The actual controller still checks its full principal/deadline review envelope.
 for(const stageId of [...contract.stages.map(s=>s.stageId),null]){const subject={version:1 as const,sessionId:contract.sessionId,intentId:contract.intentId,stageId},intentContract={subject,contract},enrollment={...intentHostSubjectOwner(subject),invocations:[],intentContract},registration=intentContractOriginalRegistration(intentContract);if(Buffer.byteLength(json({enrollment,registration}).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')))>65536)throw Error('intent_native_review_limit');}
 return contract;
}
export function parseIntentNativeContracts(raw:unknown,sessionId:string):IntentNativeContractRecord[]{
 if(raw===undefined)return [];
 const values=captureIntentData(raw);if(!Array.isArray(values))throw Error('intent_native_journal');const intents=new Set<string>(),ids=new Set<string>(),requests=new Set<string>();
 const result=values.map(value=>{
  shape(value,'version id revision intentId contract contractHash originalDraft originalDraftHash originalSource subjects createdAt updatedAt');
  if(value.version!==1||!id(value.id)||ids.has(value.id)||!id(value.intentId)||intents.has(value.intentId)||value.originalSource!=='user'||!Number.isSafeInteger(value.revision)||value.revision<1||!Number.isSafeInteger(value.createdAt)||value.createdAt<0||!Number.isSafeInteger(value.updatedAt)||value.updatedAt<value.createdAt)throw Error('intent_native_journal');ids.add(value.id);intents.add(value.intentId);
  const contract=parseIntentBusinessContract(value.contract);if(contract.sessionId!==sessionId||contract.intentId!==value.intentId||value.contractHash!==intentBusinessContractHash(contract)||!id(value.originalDraft?.instanceId)||!isDeepStrictEqual(value.originalDraft,pristine(contract,value.originalDraft.instanceId,value.createdAt))||value.originalDraftHash!==draftHash(value.originalDraft))throw Error('intent_native_journal_binding');
  const subjects=[...contract.stages.map(s=>s.stageId),null];if(!Array.isArray(value.subjects)||value.subjects.length!==subjects.length)throw Error('intent_native_subjects');
  value.subjects.forEach((subject:any,index:number)=>{shape(subject,'stageId attempts');if(subject.stageId!==subjects[index]||!Array.isArray(subject.attempts)||!subject.attempts.length||subject.attempts.length>32)throw Error('intent_native_subjects');subject.attempts.forEach((a:any,i:number)=>{shape(a,'requestId phase retirementReason');if(!id(a.requestId)||requests.has(a.requestId)||!['reserved','enrolling','enrolled','retired','stale'].includes(a.phase)||(a.phase==='retired'?!['not_prepared','not_approved'].includes(a.retirementReason):a.retirementReason!==null)||i<subject.attempts.length-1&&a.phase!=='retired')throw Error('intent_native_attempt');requests.add(a.requestId);});});
  return {...value,contract} as IntentNativeContractRecord;
 });return freeze(result);
}
export function assertIntentNativeJournalRetained(previous:SessionIntentLedger|undefined,next:SessionIntentLedger|undefined,sessionId:string,nativeMutation=false):void{
 const before=parseIntentNativeContracts(previous?.nativeContracts,sessionId),after=parseIntentNativeContracts(next?.nativeContracts,sessionId);
 if(!nativeMutation&&!isDeepStrictEqual(before,after))throw Error('intent_native_requires_primitive');
}
export interface IntentNativeAbsenceData {readonly sessionId:string;readonly intentDelegation?:{readonly nativeContracts?:unknown}}
export function assertNoIntentNativeJournal(snapshot:PersistedSessionSnapshot|undefined|null):void;
export function assertNoIntentNativeJournal(snapshot:IntentNativeAbsenceData|undefined|null):void;
export function assertNoIntentNativeJournal(snapshot:IntentNativeAbsenceData|undefined|null):void{
 if(snapshot&&snapshot.intentDelegation&&Object.hasOwn(snapshot.intentDelegation,'nativeContracts')){parseIntentNativeContracts(snapshot.intentDelegation.nativeContracts,snapshot.sessionId);const current=snapshot.intentDelegation.nativeContracts;if(current!==undefined&&current!==null){if(!Array.isArray(current))throw Error('intent_native_journal');if(current.length)throw Error('intent_native_journal_retained');}}
}
export function captureIntentNativeRequest<K extends IntentNativeMutation['nativeAction']>(kind:K,raw:Omit<Extract<IntentNativeMutation,{nativeAction:K}>,'nativeAction'>&{lease:SessionExecutionLease}):{input:IntentNativeMutation;lease:SessionExecutionLease}{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))throw Error('intent_native_shape');
 const d=Object.getOwnPropertyDescriptors(raw);if(Reflect.ownKeys(raw).some(k=>typeof k!=='string')||Object.values(d).some(v=>!('value'in v))||!d.lease)throw Error('intent_native_accessor');const {lease,...rest}=d,body=Object.fromEntries(Object.entries(rest).map(([k,v])=>[k,v.value]));const v=captureIntentData(body);json(body);
 shape(v,'sessionId instanceId requestSource now '+({reserve:'expectedLedgerHash plan definition',advance:'intentId expectedRevision expectedRequestId stageId phase retirementReason',retry:'intentId expectedRevision expectedRequestId stageId',ownership:'expectedLedgerHash action confirmHighRisk'}[kind]));
 if(!id(v.sessionId)||!id(v.instanceId)||!Number.isSafeInteger(v.now)||v.now<0||!['user','scheduler'].includes(v.requestSource)||kind!=='advance'&&v.requestSource!=='user')throw Error('intent_native_source');
 if(kind==='reserve'||kind==='ownership'){if(!hash(v.expectedLedgerHash))throw Error('intent_native_hash');}
 if(kind==='advance'||kind==='retry'){if(!id(v.intentId)||!id(v.expectedRequestId)||!Number.isSafeInteger(v.expectedRevision)||v.expectedRevision<1||v.stageId!==null&&!id(v.stageId))throw Error('intent_native_cas');}
 if(kind==='ownership'&&(!['resume','takeover','release'].includes(v.action)||typeof v.confirmHighRisk!=='boolean'))throw Error('intent_native_ownership');
 return {input:{...v,nativeAction:kind} as IntentNativeMutation,lease:lease.value as SessionExecutionLease};
}
export function applyIntentNativeMutation(previous:PersistedSessionSnapshot,input:IntentNativeMutation):PersistedSessionSnapshot;
export function applyIntentNativeMutation(previous:StoredSessionSnapshot,input:IntentNativeMutation):StoredSessionSnapshot;
/** Store-private reducer: source/lease must be checked by the actual lock owner. */
export function applyIntentNativeMutation(previous:StoredSessionSnapshot,input:IntentNativeMutation):StoredSessionSnapshot{
 const next=captureIntentData(previous);if(!next.intentDelegation&&input.nativeAction==='reserve')next.intentDelegation=createEmptySessionIntentLedger(next.sessionId,next.updatedAt);const ledger=next.intentDelegation;if(!ledger||input.sessionId!==next.sessionId)throw Error('intent_native_session');
 const records=captureIntentData(parseIntentNativeContracts(ledger.nativeContracts,next.sessionId));if(input.now<ledger.updatedAt)throw Error('intent_native_time');
 if(input.nativeAction==='ownership'){
  if(intentNativeLedgerHash(ledger)!==input.expectedLedgerHash)throw Error('intent_native_stale');
  const changed=input.action==='release'?releaseSessionOwnership(ledger,input.instanceId,input.now):input.action==='resume'?resumeSessionOwnership(ledger,input.instanceId,input.now):takeoverSessionOwnership(ledger,input.instanceId,{now:input.now,confirmHighRisk:input.confirmHighRisk});
  ledger.ownership=captureIntentData(changed.ownership);ledger.instanceId=changed.instanceId;ledger.updatedAt=changed.updatedAt;next.updatedAt=Math.max(next.updatedAt,input.now);return next;
 }
 assertSessionWriteOwnership(ledger,input.instanceId,'reserve intent native contract',{allowInitialClaim:input.nativeAction==='reserve'});
 if(input.nativeAction==='reserve'){
  const contract=contractFromPlan(input.plan,input.definition);if(contract.sessionId!==input.sessionId)throw Error('intent_native_session');
  const existing=records.find(r=>r.intentId===contract.intentId);
  if(existing){if(!isDeepStrictEqual(existing.contract,contract)||!isDeepStrictEqual(existing.originalDraft,pristine(contract,input.plan.instanceId,existing.createdAt))||!isDeepStrictEqual(ledger.intents.find(r=>r.intentId===contract.intentId),existing.originalDraft))throw Error('intent_native_conflict');return next;}
  if(records.some(record=>{const phases=record.subjects.map(s=>s.attempts.at(-1)!.phase);return phases.includes('enrolling')||(!phases.includes('stale')&&phases.some(phase=>phase!=='enrolled'));}))throw Error('intent_native_pending');
  if(intentNativeLedgerHash(previous.intentDelegation)!==input.expectedLedgerHash||ledger.intents.some(r=>r.intentId===contract.intentId))throw Error('intent_native_stale');
  const draft=pristine(contract,input.plan.instanceId,input.now),row:IntentNativeContractRecord={version:1,id:randomUUID(),revision:1,intentId:contract.intentId,contract,contractHash:intentBusinessContractHash(contract),originalDraft:draft,originalDraftHash:draftHash(draft),originalSource:'user',subjects:[...contract.stages.map(s=>s.stageId),null].map(stageId=>({stageId,attempts:[{requestId:randomUUID(),phase:'reserved',retirementReason:null}]})),createdAt:input.now,updatedAt:input.now};
  if(!ledger.ownership.ownerInstanceId){ledger.ownership={state:'owned',ownerInstanceId:input.instanceId,updatedAt:input.now};ledger.instanceId=input.instanceId;}
  ledger.intents.push(captureIntentData(draft));ledger.activeIntentId=draft.intentId;ledger.latestPlan=captureIntentData(draft);records.push(row);
 }else{
  const row=records.find(r=>r.intentId===input.intentId);if(!row||row.revision!==input.expectedRevision)throw Error('intent_native_stale');const subject=row.subjects.find(s=>s.stageId===input.stageId),attempt=subject?.attempts.at(-1);if(!subject||!attempt||attempt.requestId!==input.expectedRequestId)throw Error('intent_native_stale');
  if(input.nativeAction==='retry'){if(attempt.phase!=='retired'||subject.attempts.length>=32)throw Error('intent_native_retry');subject.attempts.push({requestId:randomUUID(),phase:'reserved',retirementReason:null});}
  else {if(attempt.phase!=='reserved'&&attempt.phase!=='enrolling'||attempt.phase==='reserved'&&(input.phase!=='enrolling'||input.requestSource!=='user')||attempt.phase==='enrolling'&&!['enrolled','retired','stale'].includes(input.phase)||(input.phase==='retired'?!['not_prepared','not_approved'].includes(input.retirementReason??''):input.retirementReason!==null))throw Error('intent_native_phase');attempt.phase=input.phase;attempt.retirementReason=input.retirementReason;}
  row.revision++;row.updatedAt=input.now;
 }
 ledger.nativeContracts=records;ledger.updatedAt=input.now;next.updatedAt=Math.max(next.updatedAt,input.now);parseIntentNativeContracts(records,input.sessionId);return next;
}
