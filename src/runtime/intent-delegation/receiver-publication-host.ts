import {assertIntentParentRoutesCurrent} from './parent-candidate.js';
import {assertCompoundRootIntentHistory} from '../sol-pi/compound-provider-admission.js';
import {captureIntentStageContext} from './stage-context.js';
import {readCurrentIntentPublicationCompletion} from './published-dependencies.js';
import {projectIntentBusinessLedger,assertIntentCandidateFactSource,type IntentBusinessProjection} from './business-projection.js';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {captureIntentData} from './data.js';
import {intentNativeLedgerHash,parseIntentNativeContracts} from './native-contract-journal.js';
import {parseIntentPublicationCandidates,intentPublicationTarget,type IntentPublicationCandidate} from './publication-candidate-journal.js';
import {parseIntentReceiverAttempts,type IntentReceiverMutation,type IntentReceiverAction} from './receiver-publication-journal.js';
import {readIntentPublicationFileFacts} from './publication-host.js';
import {assertSessionWriteOwnership} from './ownership.js';
import {createInstalledCompletionPublisher} from '../verification/installed-completion-publication.js';
import {createInstalledIntentApplicationClient} from '../verification/installed-intent-application.js';
import {readInstalledCurrentOwner} from '../verification/installed-owner-state.js';
import {intentHostSubjectOwner} from '../verification/intent-host-subject.js';
import {canonicalVerificationJson as json} from '../verification/protocol.js';
import type {SessionStore} from '../../ai/runtime/session-store/store.js';
import type {SessionExecutionAuthority,SessionExecutionLease} from '../../ai/runtime/session-store/execution-authority.js';
type ReceiverLedgerData = NonNullable<ReturnType<NonNullable<SessionStore['getIntentNativeLedgerSync']>>>;
interface ReceiverCandidateRowData { readonly id?: unknown }
interface ReceiverStageData { readonly status?: unknown }
function receiverCandidateRows(value: unknown): unknown[] { if (!Array.isArray(value)) throw Error('intent_receiver_candidate_data'); return value; }
function receiverCandidateRow(value: unknown): asserts value is ReceiverCandidateRowData { if (value === null || typeof value !== 'object') throw Error('intent_receiver_candidate_data'); }
function receiverStageRows(value: unknown): unknown[] { if (!Array.isArray(value)) throw Error('intent_receiver_current'); return value; }
function receiverStageRow(value: unknown): asserts value is ReceiverStageData { if (value === null || typeof value !== 'object') throw Error('intent_receiver_current'); }
export interface IntentReceiverWriteInput {ticket:object;lease:SessionExecutionLease}
const writes=new WeakMap<object,{store:SessionStore;lease:SessionExecutionLease;input:IntentReceiverMutation;signal:AbortSignal}>();
/** Consume-only entry. Ordinary data cannot create a receiver journal write. */
export function consumeIntentReceiverWrite(store:SessionStore,raw:IntentReceiverWriteInput){
 if(!raw||typeof raw!=='object')throw Error('intent_receiver_ticket');const descriptors=Object.getOwnPropertyDescriptors(raw);if(Reflect.ownKeys(raw).length!==2||!descriptors.ticket||!descriptors.lease||Object.values(descriptors).some(d=>!('value'in d)))throw Error('intent_receiver_ticket');
 const ticket=descriptors.ticket.value;if(!ticket||typeof ticket!=='object')throw Error('intent_receiver_ticket');const entry=writes.get(ticket);writes.delete(ticket);if(!entry||entry.store!==store||entry.lease!==descriptors.lease.value)throw Error('intent_receiver_ticket');entry.signal.throwIfAborted();return {input:captureIntentData(entry.input),lease:entry.lease};
}
/** Fixed native publisher. Historical status is not business completion authority. */
export function createIntentReceiverPublicationHost(options:{store:SessionStore;authority:SessionExecutionAuthority;sessionId:string;instanceId:string;workspaceRoot:string;assertAdmission():void;now?:()=>number}){
 const {store,sessionId,instanceId}=options,workspace=resolve(options.workspaceRoot),admission=options.assertAdmission,clock=options.now??Date.now;
 const read=store.getIntentNativeLedgerSync?.bind(store),write=store.recordIntentReceiverPublication?.bind(store),checkLease=store.assertIntentNativeLease?.bind(store),acquire=options.authority.acquire.bind(options.authority);
 if(!read||!write||!checkLease)throw Error('intent_receiver_store');const readLedger=read,saveWrite=write,assertLease=checkLease,lifetime=new AbortController();let closed=false,claiming=false,checking=false,active:Promise<unknown>|undefined;
 const closeReason=Error('intent_receiver_closed');let closeDrain:Promise<void>|undefined;const writerFailures=new Set<unknown>();
 function load(){const ledger=readLedger(sessionId);if(!ledger)throw Error('intent_receiver_session');parseIntentPublicationCandidates(ledger);return ledger;}
 function admit(signal:AbortSignal){signal.throwIfAborted();if(closed||checking)throw Error('intent_receiver_closed_or_reentrant');checking=true;try{const result:unknown=admission();if(result!==undefined){void Promise.resolve(result).catch(()=>{});throw Error('intent_receiver_admission_sync');}}finally{checking=false;}signal.throwIfAborted();if(closed)throw Error('intent_receiver_closed');}
 function exact(ledger:ReceiverLedgerData,signal:AbortSignal){admit(signal);if(intentNativeLedgerHash(load())!==intentNativeLedgerHash(ledger))throw Error('intent_receiver_basis');}
 function candidate(ledger:ReceiverLedgerData,id:string){const c=parseIntentPublicationCandidates(ledger).find(c=>c.id===id);if(!c)throw Error('intent_receiver_candidate');return c;}
 function route(ledger:ReceiverLedgerData,c:IntentPublicationCandidate,original:string){assertIntentParentRoutesCurrent(ledger,c);const binding=intentPublicationTarget(ledger,c);if(json(readInstalledCurrentOwner(intentHostSubjectOwner(binding.subject)))!==original)throw Error('intent_receiver_route');return binding;}
 function fresh(ledger:ReceiverLedgerData,c:IntentPublicationCandidate,original:string,signal:AbortSignal){exact(ledger,signal);route(ledger,c,original);const native=parseIntentNativeContracts(ledger.nativeContracts,sessionId).find(n=>n.intentId===c.intentId),record=ledger.intents.find(r=>r.intentId===c.intentId);if(!native||native.subjects.some(s=>s.attempts.at(-1)?.phase!=='enrolled')||ledger.activeIntentId!==c.intentId||(c.stageId===null?!record||receiverStageRows(record.stages).some(s=>{receiverStageRow(s);return s.status!=='completed';}):record?.activeStageId!==c.stageId)||record?.overallStatus!=='publication_pending'||json(readIntentPublicationFileFacts(ledger,workspace,c))!==json(c.fileObservations))throw Error('intent_receiver_current');exact(ledger,signal);route(ledger,c,original);signal.throwIfAborted();}
 async function application(ledger:ReceiverLedgerData,c:IntentPublicationCandidate,original:string,signal:AbortSignal){fresh(ledger,c,original,signal);const binding=route(ledger,c,original),client=createInstalledIntentApplicationClient(binding,'user');try{fresh(ledger,c,original,signal);const result=await client.inspect(signal);fresh(ledger,c,original,signal);if(result.state!=='active'||result.pendingTransitionId!==null||!result.current||result.current.revision!==c.applicationAttempts.at(-1)?.observation?.current?.revision||json(result.current.binding)!==json(binding))throw Error('intent_receiver_application');}finally{client.dispose();}}
 function capture(raw:unknown){if(!raw||typeof raw!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))throw Error('intent_receiver_input');const d=Object.getOwnPropertyDescriptors(raw);if(Reflect.ownKeys(raw).some(k=>typeof k!=='string')||Object.values(d).some(v=>!('value'in v)))throw Error('intent_receiver_accessor');const {signal,...rest}=d,v=captureIntentData(Object.fromEntries(Object.entries(rest).map(([k,p])=>[k,p.value])));if(Object.keys(rest).sort().join(',')!=='candidateId,requestSource'||typeof v.candidateId!=='string'||!v.candidateId||!['user','scheduler'].includes(v.requestSource)||signal&&!(signal.value instanceof AbortSignal))throw Error('intent_receiver_input');return {value:v,signal:signal?AbortSignal.any([lifetime.signal,signal.value]):lifetime.signal};}
 function tracked<T>(signal:AbortSignal,work:()=>Promise<T>){if(closed||claiming||active)return Promise.reject(Error('intent_receiver_busy_or_closed'));claiming=true;try{admit(signal);}catch(error){return Promise.reject(error);}finally{claiming=false;}const task=Promise.resolve().then(()=>{admit(signal);return work();});active=task;void task.then(()=>{if(active===task)active=undefined;},error=>{if(active===task)active=undefined;if(error!==closeReason)writerFailures.add(error);});return task;}
 async function run(candidateId:string,source:'user'|'scheduler',signal:AbortSignal,mode:'publish'|'recover'|'retry'|'project'){
  let projectionGuard:(()=>void)|undefined;
  const guard=()=>{admit(signal);assertSessionWriteOwnership(load(),instanceId,'intent receiver publication');projectionGuard?.();};
  const lease=await acquire({kind:source==='user'?'direct-mutation':'recovery',invocationId:'intent-receiver-'+randomUUID(),signal,assertAdmission:guard});
  try{return await lease.trackInFlight(Promise.resolve().then(async()=>{
   guard();assertLease(sessionId,source,lease);let ledger=load(),c=candidate(ledger,candidateId),row=parseIntentReceiverAttempts(c.receiverAttempts,c).at(-1);
   const original=row?.route??c.applicationAttempts.at(-1)?.route;if(!original)throw Error('intent_receiver_application');
   const history=()=>{exact(ledger,signal);route(ledger,c,original);signal.throwIfAborted();};
   async function save(action:IntentReceiverAction){const time=clock();if(!Number.isSafeInteger(time)||time<0)throw Error('intent_receiver_time');history();if(['reserve','prepared','authorizing'].includes(action.kind))fresh(ledger,c,original!,signal);const ticket=Object.freeze({});writes.set(ticket,{store,lease,signal,input:{publicationAction:'receiver',sessionId,instanceId,candidateId,expectedLedgerHash:intentNativeLedgerHash(ledger),requestSource:source,now:time,action:captureIntentData(action)}});const before=ledger;try{c=await saveWrite({ticket,lease});}finally{writes.delete(ticket);}const expected=captureIntentData(before);expected.publicationCandidates=receiverCandidateRows(expected.publicationCandidates).map(r=>{receiverCandidateRow(r);return r.id===c.id?c:r;});row=parseIntentReceiverAttempts(c.receiverAttempts,c).at(-1);expected.updatedAt=Math.max(expected.updatedAt,row!.updatedAt);if(intentNativeLedgerHash(load())!==intentNativeLedgerHash(expected))throw Error('intent_receiver_basis');ledger=load();history();}
   if(mode==='project'){
    if(source!=='user'||!row||row.status!=='committed')throw Error('intent_projection_receiver');history();
    const binding=route(ledger,c,original),stage=binding.contract.stages.find(s=>s.stageId===c.stageId)!,subjects=[binding.subject,...(c.stageId===null?binding.contract.stages.map(s=>s.stageId):stage.dependsOnStageIds).map(stageId=>({...binding.subject,stageId}))];
    const originals=subjects.map(subject=>{const local=parseIntentPublicationCandidates(ledger).find(p=>p.intentId===subject.intentId&&p.stageId===subject.stageId),originalRoute=local?.applicationAttempts.at(-1)?.route;if(!local||!originalRoute)throw Error('intent_projection_dependency');return {local,originalRoute};});
    // This closure can only reject; the original lease calls it again at actual Store write/readback boundaries.
    projectionGuard=()=>{signal.throwIfAborted();if(!c.businessProjection)assertCompoundRootIntentHistory(store,sessionId);for(const {local,originalRoute} of originals){assertIntentCandidateFactSource(ledger,local);route(ledger,local,originalRoute);if(json(readIntentPublicationFileFacts(ledger,workspace,local))!==json(local.fileObservations))throw Error('intent_projection_files');}signal.throwIfAborted();};
    history();projectionGuard();const observed=await readCurrentIntentPublicationCompletion(binding.subject,signal);history();projectionGuard();
    const publications=observed.publications.map(p=>({owner:p.owner,operationId:p.operationId,fullTupleHash:p.fullTupleHash,businessRevision:p.businessRevision,payloadHash:p.payloadHash,bindingHash:p.application.bindingHash,applicationRevision:p.application.revision,candidateRevision:p.application.binding.candidateRevision,registrationHash:p.registration.registrationHash}));
    if(observed.scope!=='self-and-dependencies'||observed.publications.length!==originals.length||observed.publications.some((p,i)=>json(p.application.binding)!==json(intentPublicationTarget(ledger,originals[i].local))))throw Error('intent_projection_binding');
    if(c.businessProjection){if(json(publications)!==json(c.businessProjection.publications))throw Error('intent_projection_changed');history();projectionGuard();return c.businessProjection;}
    const at=clock();if(!Number.isSafeInteger(at)||at<ledger.updatedAt)throw Error('intent_projection_time');history();projectionGuard();const projection:IntentBusinessProjection={version:1,candidateId:c.id,receiverRequestId:row.requestId,appliedAt:at,clock:observed.clock,publications};
    const preliminary=projectIntentBusinessLedger(ledger,c.id,projection),nextStage=preliminary.intents.find(r=>r.intentId===c.intentId)!.activeStageId,snapshot=store.loadSync?.(sessionId);if(!snapshot)throw Error('intent_stage_context_store');projection.nextStageContext=c.stageId!==null&&nextStage!==c.stageId?captureIntentStageContext(snapshot,nextStage):null;const expected=projectIntentBusinessLedger(ledger,c.id,projection);history();projectionGuard();const ticket=Object.freeze({});writes.set(ticket,{store,lease,signal,input:{publicationAction:'receiver',sessionId,instanceId,candidateId,expectedLedgerHash:intentNativeLedgerHash(ledger),requestSource:'user',now:at,action:{kind:'project',projection}}});
    try{c=await saveWrite({ticket,lease});}finally{writes.delete(ticket);}if(intentNativeLedgerHash(load())!==intentNativeLedgerHash(expected))throw Error('intent_projection_readback');ledger=load();history();projectionGuard();return c.businessProjection!;
   }
   history();if(mode==='retry'&&(!row||!['not_prepared','not_approved'].includes(row.status)))throw Error('intent_receiver_retry');const freshRequest=!row||mode==='retry';
   if(freshRequest){if(source!=='user'||mode==='recover'||row&&!['not_prepared','not_approved'].includes(row.status))throw Error('intent_receiver_retry');await application(ledger,c,original,signal);await save({kind:'reserve',route:original});}
   if(!row)throw Error('intent_receiver_missing');if(['committed','cancelled','not_prepared','not_approved'].includes(row.status)){history();return row;}
   history();const binding=route(ledger,c,original),publisher=createInstalledCompletionPublisher(intentHostSubjectOwner(binding.subject),'user');
   try{history();if(freshRequest){await application(ledger,c,original,signal);const challenge=await publisher.prepareRequest(row.requestId,signal);history();await save({kind:'prepared',challenge});await application(ledger,c,original,signal);await save({kind:'authorizing'});fresh(ledger,c,original,signal);const observation=await publisher.approve(challenge,signal);history();await save({kind:'observe',challenge,observation});}
    else{const fact=await publisher.recoverRequest(row.requestId,signal);history();if(fact.status==='settlement_exists'){const observation=await publisher.reconcile(fact.challenge,signal);history();await save({kind:'observe',challenge:fact.challenge,observation});}else await save({kind:'retire',fact});}
    return row!;
   }finally{publisher.dispose();}
  }));}finally{await lease.releaseAfterDrain();}
 }
 return Object.freeze({
  get(candidateId:string){admit(lifetime.signal);const c=candidate(load(),candidateId);return parseIntentReceiverAttempts(c.receiverAttempts,c).at(-1);},
  list(candidateId:string){admit(lifetime.signal);const c=candidate(load(),candidateId);return Object.freeze(parseIntentReceiverAttempts(c.receiverAttempts,c));},
  publish(raw:{candidateId:string;requestSource:'user';signal?:AbortSignal}){const {value,signal}=capture(raw);if(value.requestSource!=='user')return Promise.reject(Error('intent_receiver_source'));return tracked(signal,()=>run(value.candidateId,'user',signal,'publish'));},
  project(raw:{candidateId:string;requestSource:'user';signal?:AbortSignal}){const {value,signal}=capture(raw);if(value.requestSource!=='user')return Promise.reject(Error('intent_receiver_source'));return tracked(signal,()=>run(value.candidateId,'user',signal,'project'));},
  retry(raw:{candidateId:string;requestSource:'user';signal?:AbortSignal}){const {value,signal}=capture(raw);if(value.requestSource!=='user')return Promise.reject(Error('intent_receiver_source'));return tracked(signal,()=>run(value.candidateId,'user',signal,'retry'));},
  recover(raw:{candidateId:string;requestSource:'user'|'scheduler';signal?:AbortSignal}){const {value,signal}=capture(raw);return tracked(signal,()=>run(value.candidateId,value.requestSource,signal,'recover'));},
  async close(){
   if(!closeDrain){closed=true;const original=active;closeDrain=Promise.resolve().then(async()=>{
    const results=await Promise.allSettled(original?[original]:[]),errors=[...new Set([...writerFailures,...results.flatMap(r=>r.status==='rejected'&&r.reason!==closeReason?[r.reason]:[])])];
    if(errors.length)throw new AggregateError(errors,'intent_receiver physical cleanup failed');
   });lifetime.abort(closeReason);}
   await closeDrain.catch(()=>{});
  },
  waitForClosedResources(){return closeDrain??Promise.reject(Error('intent_receiver_cleanup_not_started'));}
 });
}
