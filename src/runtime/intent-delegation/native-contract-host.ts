import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {createInstalledVerificationClient} from '../verification/controller-client.js';
import {createOwnerEnrollmentClient} from '../verification/completion-client.js';
import {readInstalledCurrentOwner} from '../verification/installed-owner-state.js';
import {intentHostSubjectOwner} from '../verification/intent-host-subject.js';
import {intentContractOriginalRegistration,intentOriginalRegistrationHash} from '../verification/intent-contract-enrollment.js';
import {canonicalVerificationJson as json} from '../verification/protocol.js';
import {captureIntentData} from './intent-commit-boundary.js';
import {intentNativeLedgerHash,parseIntentNativeContracts,type IntentNativeContractRecord,type IntentNativeDefinition,type AdvanceIntentNativeInput} from './native-contract-journal.js';
import {assertSessionWriteOwnership} from './ownership.js';
import type {IntentPlanDraft} from './types.js';
import type {StoredSessionIntentLedgerInput} from './stored-intent-clone.js';
import type {SessionStore} from '../../ai/runtime/session-store/store.js';
import type {SessionExecutionAuthority,SessionExecutionLease,SessionExecutionKind} from '../../ai/runtime/session-store/execution-authority.js';

interface Action {intentId:string;requestSource:'user'|'scheduler';signal?:AbortSignal}
interface NativePredictionAttemptData {requestId?:unknown;phase?:unknown;retirementReason?:unknown}
interface NativePredictionSubjectData {stageId?:unknown;attempts:NativePredictionAttemptData[]}
interface NativePredictionRowData {intentId?:unknown;revision:number;updatedAt?:unknown;subjects:NativePredictionSubjectData[]}
function isNativePredictionObject(value:unknown):value is Record<string,unknown>{
 return value!==null&&typeof value==='object'&&!Array.isArray(value);
}
function nativePredictionObject(value:unknown):Record<string,unknown>{
 if(!isNativePredictionObject(value))throw Error('intent_native_prediction_data');return value;
}
function assertNativePredictionData(value:unknown,sessionId:string):asserts value is NativePredictionRowData[]|null|undefined{
 // Keep the original nullish read/!.find behavior; this proves no presence.
 if(value===null||value===undefined)return;
 // Validate the actual complete public journal, discarding its frozen copy.
 parseIntentNativeContracts(value,sessionId);
 if(!Array.isArray(value))throw Error('intent_native_prediction_data');
 for(const raw of value){
  const row=nativePredictionObject(raw);if(typeof row.revision!=='number'||!Array.isArray(row.subjects))throw Error('intent_native_prediction_data');
  const subjects:readonly unknown[]=row.subjects;
  for(const rawSubject of subjects){
   const subject=nativePredictionObject(rawSubject);if(!Array.isArray(subject.attempts))throw Error('intent_native_prediction_data');
   const attempts:readonly unknown[]=subject.attempts;
   for(const attempt of attempts)nativePredictionObject(attempt);
  }
 }
}
const validId=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=160&&!/[\x00-\x1f\x7f]/.test(value);
/** Actual product host only. Its journal records facts; it never grants execution. */
export function createIntentNativeContractHost(options:{store:SessionStore;authority:SessionExecutionAuthority;sessionId:string;instanceId:string;assertAdmission:()=>void;now?:()=>number}){
 const descriptors=Object.getOwnPropertyDescriptors(options);if(![Object.prototype,null].includes(Object.getPrototypeOf(options))||Reflect.ownKeys(options).some(k=>typeof k!=='string')||Object.values(descriptors).some(d=>!('value'in d))||Object.keys(descriptors).some(k=>!['store','authority','sessionId','instanceId','assertAdmission','now'].includes(k)))throw Error('intent_native_host_options');
 const {sessionId,instanceId}=options,admission=options.assertAdmission,now=options.now??Date.now;if(typeof admission!=='function'||typeof now!=='function')throw Error('intent_native_host_options');
 if(!validId(sessionId)||!validId(instanceId))throw Error('intent_native_host_identity');
 const checkLease=options.store.assertIntentNativeLease?.bind(options.store);
 const read=options.store.getIntentNativeLedgerSync?.bind(options.store),reserve=options.store.reserveIntentNativeContract?.bind(options.store),advance=options.store.advanceIntentNativeContractSubject?.bind(options.store),retry=options.store.retryIntentNativeContractSubject?.bind(options.store),acquire=options.authority.acquire.bind(options.authority);
 if(!read||!reserve||!advance||!retry||!checkLease)throw Error('intent_native_host_store');
 const assertLease=checkLease;
 const load=read,reserveRecord=reserve,advanceRecord=advance,retryRecord=retry,lifetime=new AbortController();
 let claiming=false;
 let closed=false,active:Promise<unknown>|undefined,checking=false;
 const closeReason=Error('intent_native_host_closed');let closeDrain:Promise<void>|undefined;const writerFailures=new Set<unknown>();
 function admit(signal?:AbortSignal){
  if(closed)throw closeReason;signal?.throwIfAborted();if(checking)throw Error('intent_native_admission_reentrant');checking=true;
  try{const result:unknown=admission();if(result!==undefined){void Promise.resolve(result).catch(()=>{});throw Error('intent_native_admission_sync');}}finally{checking=false;}
  if(closed)throw closeReason;signal?.throwIfAborted();
 }
 function time(){const value:unknown=now();if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0){if(value&&typeof value==='object')void Promise.resolve(value).catch(()=>{});throw Error('intent_native_host_time');}return value;}
 function get(intentId:string){if(!validId(intentId))throw Error('intent_native_host_identity');const row=parseIntentNativeContracts(load(sessionId)?.nativeContracts,sessionId).find(r=>r.intentId===intentId);if(!row)throw Error('intent_native_missing');return row;}
 function basis(row:IntentNativeContractRecord){const ledger=load(sessionId);if(!ledger)throw Error('intent_native_session');assertSessionWriteOwnership(ledger,instanceId,'advance intent native contract');if(ledger.activeIntentId!==row.intentId||!isDeepStrictEqual(ledger.intents.find(r=>r.intentId===row.intentId),row.originalDraft))throw Error('intent_native_basis_changed');return ledger;}
 function exact(expected:StoredSessionIntentLedgerInput|undefined,signal?:AbortSignal){admit(signal);if(intentNativeLedgerHash(load(sessionId))!==intentNativeLedgerHash(expected))throw Error('intent_native_basis_changed');}
 function parseAction(raw:Action,keys='intentId requestSource'):{input:Omit<Action,'signal'>;signal:AbortSignal}{
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))throw Error('intent_native_host_input');const d=Object.getOwnPropertyDescriptors(raw);if(Reflect.ownKeys(raw).some(k=>typeof k!=='string')||Object.values(d).some(v=>!('value'in v)))throw Error('intent_native_host_input');const {signal,...rest}=d,input=captureIntentData(Object.fromEntries(Object.entries(rest).map(([k,v])=>[k,v.value]))) as Omit<Action,'signal'>;
  if(Object.keys(input).sort().join(',')!==keys.split(' ').sort().join(',')||!validId(input.intentId)||!['user','scheduler'].includes(input.requestSource)||signal&&!(signal.value instanceof AbortSignal))throw Error('intent_native_host_source');return {input,signal:signal?AbortSignal.any([lifetime.signal,signal.value as AbortSignal]):lifetime.signal};
 }
 function tracked<T>(signal:AbortSignal,work:()=>Promise<T>):Promise<T>{
  if(closed)return Promise.reject(Error('intent_native_host_closed'));
  if(claiming||active)return Promise.reject(Error('intent_native_host_busy'));
  claiming=true;try{admit(signal);}catch(error){return Promise.reject(error);}finally{claiming=false;}
  const task=Promise.resolve().then(()=>{admit(signal);return work();});active=task;void task.then(()=>{if(active===task)active=undefined;},error=>{if(active===task)active=undefined;if(error!==closeReason)writerFailures.add(error);});return task;
 }
 async function leased<T>(kind:SessionExecutionKind,signal:AbortSignal,work:(lease:SessionExecutionLease)=>Promise<T>,guard:()=>void=()=>admit(signal)):Promise<T>{
  const lease=await acquire({invocationId:`intent-native-${randomUUID()}`,kind,signal,assertAdmission:guard});try{guard();return await lease.trackInFlight(work(lease));}finally{await lease.releaseAfterDrain();}
 }
 async function savePhase(row:IntentNativeContractRecord,stageId:string|null,phase:AdvanceIntentNativeInput['phase'],retirementReason:AdvanceIntentNativeInput['retirementReason'],source:'user'|'scheduler',signal:AbortSignal,terminal?:{expected:StoredSessionIntentLedgerInput;lease:SessionExecutionLease;setGuard(guard:()=>void):void},captureCommitted?:(expected:StoredSessionIntentLedgerInput)=>void){
  let guard=()=>admit(signal);
  const commit=async(lease:SessionExecutionLease)=>{
   admit(signal);assertLease(sessionId,source,lease);
   const before=load(sessionId);if(!before)throw Error('intent_native_session');
   // Classify the remote result against the original pre-await ledger while
   // holding the same lease that will write this terminal fact.
   if(terminal&&(intentNativeLedgerHash(before)!==intentNativeLedgerHash(terminal.expected)||before.activeIntentId!==row.intentId||!isDeepStrictEqual(before.intents.find(r=>r.intentId===row.intentId),row.originalDraft))){phase='stale';retirementReason=null;}
   const timestamp=time();admit(signal);const subject=row.subjects.find(s=>s.stageId===stageId);if(!subject)throw Error('intent_native_subjects');
   const input={sessionId,instanceId,intentId:row.intentId,stageId,expectedRevision:row.revision,expectedRequestId:subject.attempts.at(-1)!.requestId,phase,retirementReason,requestSource:source,now:timestamp};
   const after=captureIntentData(before);assertNativePredictionData(after.nativeContracts,sessionId);
   const predicted=after.nativeContracts!.find(r=>r.intentId===row.intentId)!;predicted.revision++;predicted.updatedAt=timestamp;after.updatedAt=timestamp;const attempt=predicted.subjects.find(s=>s.stageId===stageId)!.attempts.at(-1)!;attempt.phase=phase;attempt.retirementReason=retirementReason;
   const allowed=[intentNativeLedgerHash(before),intentNativeLedgerHash(after)];guard=()=>{admit(signal);if(!allowed.includes(intentNativeLedgerHash(load(sessionId))))throw Error('intent_native_basis_changed');};terminal?.setGuard(guard);
   guard();const result=await advanceRecord({...input,lease});guard();captureCommitted?.(after);return result;
  };
  return terminal?commit(terminal.lease):leased(phase==='enrolling'?'direct-mutation':'recovery',signal,commit,()=>guard());
 }
 async function run(input:Omit<Action,'signal'>,signal:AbortSignal,fresh:boolean){
  let row=get(input.intentId);const subject=row.subjects.find(s=>s.attempts.at(-1)!.phase!=='enrolled');if(!subject)return row;const attempt=subject.attempts.at(-1)!;
  if(attempt.phase!=='enrolling'&&!(fresh&&attempt.phase==='reserved'))return row;
  const freshRequest=attempt.phase==='reserved';
  let expected:StoredSessionIntentLedgerInput|undefined;
  if(freshRequest){basis(row);row=await savePhase(row,subject.stageId,'enrolling',null,input.requestSource,signal,undefined,next=>{expected=next;});}
  expected??=load(sessionId);if(!expected)throw Error('intent_native_session');
  const originalExpected=expected;
  assertSessionWriteOwnership(expected,instanceId,'recover intent native contract');
  const target={version:1 as const,sessionId,intentId:row.intentId,stageId:subject.stageId},intentContract={subject:target,contract:row.contract},owner=intentHostSubjectOwner(target),registration=intentContractOriginalRegistration(intentContract),request={requestId:attempt.requestId,enrollment:{...owner,intentContract,invocations:[]},registration};
  let guard=()=>admit(signal);
  return leased(freshRequest?'direct-mutation':'recovery',signal,async lease=>{
   assertLease(sessionId,input.requestSource,lease);admit(signal);
   if(freshRequest)exact(originalExpected,signal);
   const client=createInstalledVerificationClient(),enrollment=createOwnerEnrollmentClient(client.completionTransport);
   try{
    if(freshRequest){
     const prepared=await enrollment.prepareRequest(request,signal);
     exact(originalExpected,signal);assertLease(sessionId,input.requestSource,lease);
     if(prepared.created){await enrollment.authorize(prepared.challenge,signal);admit(signal);}
    }
    const result=await enrollment.recoverRequest(request,signal);admit(signal);
    const terminal={expected:originalExpected,lease,setGuard(next:()=>void){guard=next;}};
    if(result.state==='committed'){
     // Only the final parent can supply the complete graph registration.
     if(subject.stageId===null){const actual=await enrollment.readIntentContract({subject:target},signal);admit(signal);
      if(!isDeepStrictEqual(actual.contract,row.contract)||actual.registrationHash!==intentOriginalRegistrationHash(registration)||!isDeepStrictEqual(actual.owner,result.owner))throw Error('intent_native_receipt_changed');}
     return savePhase(row,subject.stageId,'enrolled',null,input.requestSource,signal,terminal);
    }
    return savePhase(row,subject.stageId,'retired',result.state==='not_prepared'?'not_prepared':'not_approved',input.requestSource,signal,terminal);
   }finally{client.dispose();}
  },()=>guard());
 }

 return Object.freeze({
  reserve(raw:{plan:IntentPlanDraft;definition:IntentNativeDefinition;requestSource:'user'}){let input:typeof raw;try{input=captureIntentData(raw);if(Object.keys(input).sort().join(',')!=='definition,plan,requestSource'||input.requestSource!=='user')throw Error('intent_native_host_source');}catch(error){return Promise.reject(error);}return tracked(lifetime.signal,async()=>{const timestamp=time();admit(lifetime.signal);const expected=load(sessionId);return leased('direct-mutation',lifetime.signal,lease=>reserveRecord({sessionId,instanceId,...input,expectedLedgerHash:intentNativeLedgerHash(expected),now:timestamp,lease}));});},
  advance(raw:Action){try{const {input,signal}=parseAction(raw);if(input.requestSource!=='user')throw Error('intent_native_host_source');return tracked(signal,()=>run(input,signal,true));}catch(error){return Promise.reject(error);}},
  recover(raw:Action){try{const {input,signal}=parseAction(raw);return tracked(signal,()=>run(input,signal,false));}catch(error){return Promise.reject(error);}},
  retrySubject(raw:Action&{stageId:string|null}){try{const {input,signal}=parseAction(raw,'intentId requestSource stageId'),stageId=(input as Action&{stageId:string|null}).stageId;if(input.requestSource!=='user'||stageId!==null&&!validId(stageId))throw Error('intent_native_host_source');return tracked(signal,async()=>{
   const row=get(input.intentId),subject=row.subjects.find(s=>s.stageId===stageId),attempt=subject?.attempts.at(-1);if(!attempt||attempt.phase!=='retired')throw Error('intent_native_retry');
   const expected=basis(row),target={version:1 as const,sessionId,intentId:row.intentId,stageId},intentContract={subject:target,contract:row.contract},request={requestId:attempt.requestId,enrollment:{...intentHostSubjectOwner(target),intentContract,invocations:[]},registration:intentContractOriginalRegistration(intentContract)};
   let guard=()=>exact(expected,signal);
   return leased('direct-mutation',signal,async lease=>{
    assertLease(sessionId,'user',lease);exact(expected,signal);const client=createInstalledVerificationClient();
    try{
     const result=await createOwnerEnrollmentClient(client.completionTransport).recoverRequest(request,signal);if(result.state!==attempt.retirementReason)throw Error('intent_native_retry');exact(expected,signal);const timestamp=time();exact(expected,signal);
     guard=()=>{admit(signal);const actual=load(sessionId);if(intentNativeLedgerHash(actual)===intentNativeLedgerHash(expected))return;
      // Accept only the exact Store-generated reserved append, never another writer.
      const currentData=actual?.nativeContracts;assertNativePredictionData(currentData,sessionId);
      const current=currentData?.find(r=>r.intentId===row.intentId)?.subjects.find(s=>s.stageId===stageId)?.attempts.at(-1);if(!current||current.requestId===attempt.requestId)throw Error('intent_native_basis_changed');const after=captureIntentData(expected);assertNativePredictionData(after.nativeContracts,sessionId);
      const record=after.nativeContracts!.find(r=>r.intentId===row.intentId)!;record.revision++;record.updatedAt=timestamp;after.updatedAt=timestamp;record.subjects.find(s=>s.stageId===stageId)!.attempts.push({requestId:current.requestId,phase:'reserved',retirementReason:null});if(intentNativeLedgerHash(actual)!==intentNativeLedgerHash(after))throw Error('intent_native_basis_changed');
     };
     const appended=await retryRecord({sessionId,instanceId,intentId:row.intentId,expectedRevision:row.revision,expectedRequestId:attempt.requestId,stageId,requestSource:'user',now:timestamp,lease});guard();return appended;
    }finally{client.dispose();}
   },()=>guard());
  });}catch(error){return Promise.reject(error);}},
  get(intentId:string){admit(lifetime.signal);return get(intentId);},
  list(){admit(lifetime.signal);return parseIntentNativeContracts(load(sessionId)?.nativeContracts,sessionId);},
  async close(){
   if(!closeDrain){closed=true;const original=active;closeDrain=Promise.resolve().then(async()=>{
    const results=await Promise.allSettled(original?[original]:[]),errors=[...new Set([...writerFailures,...results.flatMap(r=>r.status==='rejected'&&r.reason!==closeReason?[r.reason]:[])])];
    if(errors.length)throw new AggregateError(errors,'intent native host physical cleanup failed');
   });lifetime.abort(closeReason);}
   await closeDrain.catch(()=>{});
  },
  waitForClosedResources(){return closeDrain??Promise.reject(Error('intent_native_cleanup_not_started'));},
 });
}
