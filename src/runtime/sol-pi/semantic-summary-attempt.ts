import {AsyncLocalStorage} from 'node:async_hooks';
import {isDeepStrictEqual} from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import type { SessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
import { assertSynchronousSessionHook, computeSessionHistoryDigest, type PersistedSessionSnapshot, type SessionStore } from '../../ai/runtime/session-store/store.js';
import { describeProductObservationPolicy, type ProductObservationPolicy } from './product-bootstrap.js';
import { measureRequestCapacity, checkRequestCapacity, type VerifiedCapacityProfile } from './capacity-admission.js';
import { computeSemanticRequestCostUpperBound } from './semantic-policy.js';
import { reserveSemanticCompaction, transitionSemanticReservation, commitSemanticCompaction, type SemanticCompactionLedger, type SemanticReservation } from './semantic-compaction-ledger.js';
import { readSemanticSnapshotCandidate, type SemanticSnapshotCandidate } from './semantic-snapshot.js';
import { qualifySemanticPrice, assertSemanticPriceQualification, semanticPriceEvidenceRevision, type SemanticPriceQualification, type SemanticPriceBinding } from './semantic-price-qualification.js';
import { createSingleRequestHttpsFetch } from './single-request-https.js';

export interface SemanticSummaryAttempt { readonly opaqueSemanticSummaryAttempt: never }
interface Input {
 policy: ProductObservationPolicy; store: SessionStore; lease: SessionExecutionLease;
 logicalInvocationId?:string;sessionId: string; sourceSnapshot: PersistedSessionSnapshot; operationId: string;
 destination: string; serializedBody: string; capacityProfile: VerifiedCapacityProfile; signal?: AbortSignal;
 assertBoundaryCurrent?: () => void;
}
interface State { input: Input; qualification: 'test-fixture'|'official-deepseek-recipe';
 priceQualification?:SemanticPriceQualification;priceBinding:SemanticPriceBinding;
 reservation:SemanticReservation;providerScopeUsed?:boolean;maxOutputTokens: number; finished: boolean; resolved: boolean; committed?: boolean; fetch?: typeof fetch }
const attempts = new WeakMap<object, State>();
const grants = new WeakMap<object, { sessionId: string; grantId: string }>();
function denied(reason = 'INVALID'): never { throw Error(`SEMANTIC_SUMMARY_${reason}`); }
function current(attempt: SemanticSummaryAttempt): State {
 const value=attempt && attempts.get(attempt);if(!value)denied();return value;
}
/** Host-only budget barrier. A serialized/restored policy cannot mint an attempt. */
export async function prepareSemanticSummaryAttempt(input: Input): Promise<SemanticSummaryAttempt> {
 input={...input,sourceSnapshot:structuredClone(input.sourceSnapshot)};
 input.lease.assertCurrent();input.signal?.throwIfAborted();
 assertSynchronousSessionHook(input.assertBoundaryCurrent);
 const description=describeProductObservationPolicy(input.policy), policy=description.semanticCompaction;
 if(!policy || policy.expiresAt<=Date.now() || policy.pricing.validUntil<=Date.now()
   || description.destination.url!==input.destination || input.sourceSnapshot.sessionId!==input.sessionId
   || !input.store.compareAndSave)denied();
 let binding=grants.get(input.policy);
 if(binding && binding.sessionId!==input.sessionId)denied('GRANT_SESSION');
 if(!binding){binding={sessionId:input.sessionId,grantId:`semantic_${randomUUID()}`};grants.set(input.policy,binding);}
 const measured=measureRequestCapacity(input.capacityProfile,{destination:input.destination,model:description.model,serializedBody:input.serializedBody});
 checkRequestCapacity(input.capacityProfile,{destination:input.destination,model:description.model,serializedBody:input.serializedBody});
 const body=JSON.parse(input.serializedBody);
 if(body.max_tokens!==policy.maxOutputTokens || (body.tools && (!Array.isArray(body.tools)||body.tools.length)) || body.tool_choice!==undefined)denied('REQUEST_SHAPE');
 const maximumCostUnits=computeSemanticRequestCostUpperBound(policy,measured.inputTokenUpperBound,measured.actualOutputReserve);
 const priceBinding:SemanticPriceBinding={operationId:input.operationId,serializedBody:input.serializedBody,model:description.model,
  priceRevision:policy.priceRevision,inputTokenUpperBound:measured.inputTokenUpperBound,outputTokenUpperBound:measured.actualOutputReserve,
  expiresAt:Math.min(policy.expiresAt,policy.pricing.validUntil)};
 let priceQualification:SemanticPriceQualification|undefined;
 try{if(measured.qualification==='official-deepseek-recipe')priceQualification=await qualifySemanticPrice(priceBinding,input.lease,input.signal);}
 catch(error){input.signal?.throwIfAborted();throw Error('SEMANTIC_PRICE_UNAVAILABLE',{cause:error});}
 let snapshot=await input.store.load(input.sessionId);
 if(!snapshot || snapshot.storeRevision!==input.sourceSnapshot.storeRevision
   || computeSessionHistoryDigest(snapshot)!==computeSessionHistoryDigest(input.sourceSnapshot))denied('STALE_SOURCE');
 let ledger:SemanticCompactionLedger=snapshot.semanticCompaction??{version:1,currency:policy.currency,generation:0,policies:[],reservations:[],commits:[]};
 if(ledger.currency!==policy.currency || ledger.reservations.some(r=>r.operationId===input.operationId))denied('DUPLICATE_OR_CURRENCY');
 ledger=structuredClone(ledger);
 if(!ledger.policies.some(p=>p.grantId===binding!.grantId))ledger.policies.push({grantId:binding.grantId,maxCalls:policy.maxCalls,maxCostUnits:policy.maxCostUnits,expiresAt:policy.expiresAt});
 ledger=reserveSemanticCompaction(ledger,{operationId:input.operationId,grantId:binding.grantId,
  bodyDigest:createHash('sha256').update(input.serializedBody).digest('hex'),sourceHistoryDigest:computeSessionHistoryDigest(snapshot),
  model:description.model,priceRevision:priceQualification?semanticPriceEvidenceRevision(priceQualification,priceBinding):policy.priceRevision,maximumCostUnits},Date.now());
 const persist=async(next:SemanticCompactionLedger)=>{
  input.lease.assertCurrent();input.signal?.throwIfAborted();
  if(priceQualification)assertSemanticPriceQualification(priceQualification,priceBinding);
  const nextSnapshot={...snapshot!,semanticCompaction:next};
  const receipt=await input.store.compareAndSave!({expectedStoreRevision:snapshot!.storeRevision??0,
   expectedHistoryDigest:computeSessionHistoryDigest(snapshot!),nextSnapshot,lease:input.lease,beforeCommit:()=>{
    assertSynchronousSessionHook(input.assertBoundaryCurrent);
    input.lease.assertCurrent();input.signal?.throwIfAborted();
    if(priceQualification)assertSemanticPriceQualification(priceQualification,priceBinding);
    const live=describeProductObservationPolicy(input.policy).semanticCompaction;
    if(!live || Date.now()>=live.expiresAt || Date.now()>=live.pricing.validUntil)denied('EXPIRED');
   }});
  snapshot={...nextSnapshot,...receipt};
 };
 await persist(ledger);
 // Charge before a capability escapes; a crash here cannot make the budget reusable.
 const dispatched=transitionSemanticReservation(ledger,input.operationId,'dispatched');
 await persist(dispatched);
 const attempt=Object.freeze(Object.create(null)) as SemanticSummaryAttempt;
 attempts.set(attempt,{input,reservation:structuredClone(dispatched.reservations.find(row=>row.operationId===input.operationId)!),priceBinding,priceQualification,qualification:measured.qualification,maxOutputTokens:policy.maxOutputTokens,finished:false,resolved:false});
 return attempt;
}
/** Actual adapter path. Test counter capabilities never produce a live provider transport. */
export function resolveSemanticSummaryAttempt(attempt: SemanticSummaryAttempt): {fetch:typeof fetch;maxOutputTokens:number} {
 const value=current(attempt);
 if(value.qualification!=='official-deepseek-recipe'||!value.priceQualification)denied('QUALIFICATION');
 assertSemanticPriceQualification(value.priceQualification,value.priceBinding);
 if(value.finished || value.resolved)denied('ALREADY_USED');
 value.input.lease.assertCurrent();value.resolved=true;
 const raw=createSingleRequestHttpsFetch({destination:value.input.destination,expectedBody:value.input.serializedBody,
  timeoutMs:120000,maxResponseBytes:16*1024*1024,signal:value.input.signal,
  trackPhysicalDrain:work=>{value.input.lease.trackInFlight(work);}});
 let claimed=false;
 const guarded:typeof fetch=async(input,init)=>{
  if(claimed || value.finished)denied('ALREADY_USED');claimed=true;
  value.input.lease.assertCurrent();value.input.signal?.throwIfAborted();
  assertSynchronousSessionHook(value.input.assertBoundaryCurrent);
  const policy=describeProductObservationPolicy(value.input.policy).semanticCompaction;
  if(!policy || Date.now()>=policy.expiresAt || Date.now()>=policy.pricing.validUntil)denied('EXPIRED');
  assertSemanticPriceQualification(value.priceQualification!,value.priceBinding);
  return raw(input,init);
 };
 value.fetch=guarded;return {fetch:guarded,maxOutputTokens:value.maxOutputTokens};
}
/** Failure remains charged. This never rewrites conversation history or refunds money. */
export async function finishSemanticSummaryAttempt(attempt:SemanticSummaryAttempt,status:'settled'|'unknown'):Promise<PersistedSessionSnapshot>{
 const value=current(attempt);if(value.finished)denied('ALREADY_FINISHED');
 value.input.lease.assertCurrent();
 const snapshot=await value.input.store.load(value.input.sessionId);
 if(!snapshot?.semanticCompaction || !value.input.store.compareAndSave)denied('MISSING_LEDGER');
 const nextSnapshot={...snapshot,semanticCompaction:transitionSemanticReservation(snapshot.semanticCompaction,value.input.operationId,status)};
 const receipt=await value.input.store.compareAndSave({expectedStoreRevision:snapshot.storeRevision??0,
  expectedHistoryDigest:computeSessionHistoryDigest(snapshot),nextSnapshot,lease:value.input.lease});
 value.finished=true;return {...nextSnapshot,...receipt};
}

/** Commit only a host-built strict candidate; budget was already persisted independently. */
export async function commitSemanticSummarySnapshot(attempt:SemanticSummaryAttempt,candidate:SemanticSnapshotCandidate):Promise<PersistedSessionSnapshot>{
 const value=current(attempt);if(!value.finished||value.committed)denied('NOT_SETTLED');
 value.input.lease.assertCurrent();value.input.signal?.throwIfAborted();
 const policy=describeProductObservationPolicy(value.input.policy).semanticCompaction;
 if(!policy||Date.now()>=policy.expiresAt||Date.now()>=policy.pricing.validUntil)denied('EXPIRED');
 const prepared=readSemanticSnapshotCandidate(candidate);
 const snapshot=await value.input.store.load(value.input.sessionId);
 const expected=computeSessionHistoryDigest(value.input.sourceSnapshot);
 if(!snapshot?.semanticCompaction||!value.input.store.compareAndSave||prepared.snapshot.sessionId!==value.input.sessionId
  || prepared.sourceHistoryDigest!==expected||computeSessionHistoryDigest(snapshot)!==expected)denied('STALE_SOURCE');
 const semanticCompaction=commitSemanticCompaction(snapshot.semanticCompaction,{operationId:value.input.operationId,
  sourceHistoryDigest:expected,nextHistoryDigest:computeSessionHistoryDigest(prepared.snapshot),anchorDigest:prepared.anchorDigest});
 const nextSnapshot={...snapshot,messages:prepared.snapshot.messages,usage:prepared.snapshot.usage,compactions:prepared.snapshot.compactions,semanticCompaction};
 const receipt=await value.input.store.compareAndSave({expectedStoreRevision:snapshot.storeRevision??0,expectedHistoryDigest:expected,nextSnapshot,lease:value.input.lease,beforeCommit:()=>{
  assertSynchronousSessionHook(value.input.assertBoundaryCurrent);
  readSemanticSnapshotCandidate(candidate);value.input.lease.assertCurrent();value.input.signal?.throwIfAborted();
  const live=describeProductObservationPolicy(value.input.policy).semanticCompaction;
  if(!live || Date.now()>=live.expiresAt || Date.now()>=live.pricing.validUntil)denied('EXPIRED');
 }});
 value.committed=true;return {...nextSnapshot,...receipt};
}

/** Borrowing is confined to the original summary runner's dynamic extent. The
 * caller never receives a lease from a getter or a serialized reservation. */
export interface SemanticSummaryProviderScope {readonly opaqueSemanticSummaryProviderScope:true}
interface ProviderScopeState {attempt:SemanticSummaryAttempt;open:boolean;reserved:boolean;consumed:boolean;transport?:'drained'|'unknown'|'cancelled_before_send'}
const providerScopeContext=new AsyncLocalStorage<SemanticSummaryProviderScope>();
const providerScopes=new WeakMap<object,ProviderScopeState>();
function activeScope(scope:SemanticSummaryProviderScope){
 const entry=providerScopes.get(scope);if(!entry?.open)denied('PROVIDER_SCOPE_CLOSED');
 const value=current(entry.attempt);if(value.finished)denied('ALREADY_FINISHED');value.input.lease.assertCurrent();value.input.signal?.throwIfAborted();
 if(value.qualification!=='official-deepseek-recipe'||!value.resolved||!value.priceQualification)denied('QUALIFICATION');
 assertSemanticPriceQualification(value.priceQualification,value.priceBinding);assertSynchronousSessionHook(value.input.assertBoundaryCurrent);
 return {entry,value};
}
export async function withSemanticSummaryProviderScope<T>(attempt:SemanticSummaryAttempt,work:()=>Promise<T>):Promise<T>{
 const value=current(attempt);if(value.finished||value.providerScopeUsed)denied('PROVIDER_SCOPE_USED');value.input.lease.assertCurrent();value.providerScopeUsed=true;
 const scope=Object.freeze({opaqueSemanticSummaryProviderScope:true as const}),entry:ProviderScopeState={attempt,open:true,reserved:false,consumed:false};providerScopes.set(scope,entry);
 try{return await providerScopeContext.run(scope,work);}finally{entry.open=false;}
}
export function reserveActiveSemanticSummaryProviderScope(facts:{sessionIdentity:string;logicalInvocationId:string;serializedBodySha256:string;destination:string}):SemanticSummaryProviderScope|undefined{
 const scope=providerScopeContext.getStore();if(!scope)return;
 const {entry,value}=activeScope(scope);
 if(entry.reserved||!value.input.logicalInvocationId||value.input.logicalInvocationId!==facts.logicalInvocationId||value.input.sessionId!==facts.sessionIdentity||value.input.destination!==facts.destination||value.reservation.bodyDigest!==facts.serializedBodySha256)denied('PROVIDER_SCOPE_BINDING');
 entry.reserved=true;return scope;
}
export function inspectSemanticSummaryProviderLease(scope:SemanticSummaryProviderScope,visit:(lease:SessionExecutionLease)=>void):void{
 const {value}=activeScope(scope);const result:unknown=visit(value.input.lease);if(result!==undefined){if(result&&typeof (result as PromiseLike<unknown>).then==='function')void Promise.resolve(result).catch(()=>{});denied('PROVIDER_SCOPE_ASYNC_VISITOR');}activeScope(scope);
}
export function matchesSemanticSummaryProviderReservation(scope:SemanticSummaryProviderScope,snapshot:PersistedSessionSnapshot,reservation:SemanticReservation,lease:SessionExecutionLease):boolean{
 const {value}=activeScope(scope);return value.input.lease===lease&&snapshot.sessionId===value.input.sessionId&&reservation.status==='dispatched'&&isDeepStrictEqual(reservation,value.reservation);
}
export function consumeSemanticSummaryProviderScope(scope:SemanticSummaryProviderScope):void{
 const {entry}=activeScope(scope);if(!entry.reserved||entry.consumed||entry.transport)denied('PROVIDER_SCOPE_USED');entry.consumed=true;
}
export function settleSemanticSummaryProviderScope(scope:SemanticSummaryProviderScope,state:'drained'|'unknown'|'cancelled_before_send'):void{
 const entry=providerScopes.get(scope);if(!entry||!entry.reserved||entry.transport||!['drained','unknown','cancelled_before_send'].includes(state)||(state==='drained'&&!entry.consumed)||(state==='cancelled_before_send'&&entry.consumed))denied('PROVIDER_SCOPE_SETTLEMENT');entry.transport=state;
}
