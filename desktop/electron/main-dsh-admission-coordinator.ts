import {readOriginalMainDshBrokerControlSource} from './main-dsh-broker-control-source.js';
import {createMainDshDraftLaunchSource,sealOriginalMainDshDraftLaunch} from './dsh-draft-root-source.js';
import {readOriginalMainDshDraftAdmissionCached as readOriginalMainDshDraftAdmission} from './main-dsh-physical-composition.js';
import {createMainDshDraftModelSource} from './main-dsh-draft-model-source.js';
import {types} from 'node:util';
import {captureGithubOpaqueRecord} from '../../src/runtime/multi-agent/dsh-github-read-data.js';
import {captureDispatchBusinessData} from '../../src/runtime/conversation-activity/dispatch-business-data.js';
import {retainSourceErrorTails} from '../../src/runtime/verification/source-error-tails.js';
import {assertStandardIpcPromise} from '../../src/runtime/verification/native-ipc-promise.js';
import {createIntrinsicSet,settleIntrinsicOperations,appendIntrinsic,aggregateIntrinsicErrors} from '../../src/runtime/verification/intrinsic-async-collection.js';
import {readOriginalDshAdmissionPort,readOriginalDshAdmissionPlans,readOriginalDshDesktopState,readOriginalDshClaimedCommand} from './desktop-multi-agent-store.js';
import {readOriginalMainDshBootstrapAuthority,type MainDshBootstrapAuthority} from './main-dsh-bootstrap-authority.js';
import {readOriginalMainDshModelSource} from './main-dsh-model-source.js';
import {readOriginalMainDshBudgetAuthoritySource,type MainDshBudgetAuthoritySource} from './main-dsh-budget-authority-source.js';
import {readOriginalDshBudgetPort,readOriginalDshBudgetRuntimeBinding} from './harness-optimization-service.js';
import {readOriginalMainDshBusinessSource,readOriginalMainDshBusinessDelivery,type MainDshBusinessDelivery} from './main-dsh-business-source.js';
const apply=Reflect.apply,get=WeakMap.prototype.get,set=WeakMap.prototype.set,descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn,keys=Reflect.ownKeys;
const freeze=Object.freeze,create=Object.create,define=Object.defineProperty,NativePromise=Promise,then=Promise.prototype.then,NativeError=Error,NativeAbort=AbortController,abort=AbortController.prototype.abort;
const isProxy=types.isProxy,isPromise=types.isPromise;
function fail(code='DSH_ADMISSION_COORDINATOR_REQUIRED'):never{throw new NativeError(code);}
function method(receiver:object,key:string):Function{const row=descriptor(receiver,key);if(!row||!own(row,'value')||typeof row.value!=='function'||isProxy(row.value))fail();return row.value;}
function record(raw:unknown):Record<string,unknown>{const value=captureDispatchBusinessData(raw);if(!value||typeof value!=='object'||Array.isArray(value))fail('DSH_ADMISSION_RESULT_INVALID');return value as Record<string,unknown>;}
export interface MainDshAdmissionCoordinator {runScan(originalScan:object):Promise<void>;reconcileOwners():Promise<void>;stopAccepting():void;close():Promise<void>}
const coordinators=new WeakMap<object,{realm:object;store:object;runtime:object;budgetSource:object;local():void}>();
/** A genuine composition handle only; no queue, data or caller verifier can
 * mint model, budget, business or Native execution permissions. */
export function readOriginalMainDshAdmissionCoordinator(candidate:unknown,realm:unknown,store:unknown,runtime:unknown,budgetSource:unknown):MainDshAdmissionCoordinator {
 const row=apply(get,coordinators,[candidate]) as {realm:object;store:object;runtime:object;budgetSource:object;local():void}|undefined;
 if(!row||row.realm!==realm||row.store!==store||row.runtime!==runtime||row.budgetSource!==budgetSource)fail();row.local();return candidate as MainDshAdmissionCoordinator;
}
/** Runs inside the existing Source controller tick. A owns durable intents,
 * the original ledger owns money, and B owns work. There is no second timer,
 * queue, retry policy or durable execution state here. */
export function createMainDshAdmissionCoordinator(raw:unknown):MainDshAdmissionCoordinator {
 if(!raw||typeof raw!=='object'||isProxy(raw))fail();
 const options=captureGithubOpaqueRecord(raw,['realm','store','runtime','budgetSource','businessSource','modelSource',...(descriptor(raw,'brokerSource')?['brokerSource']:[])]);
 const realm=options.realm as MainDshBootstrapAuthority,store=options.store as object,runtime=options.runtime as object,budgetSource=options.budgetSource as MainDshBudgetAuthoritySource;
 const port=readOriginalDshAdmissionPort(store,realm);
 readOriginalMainDshBudgetAuthoritySource(budgetSource,realm,store);
 const model=readOriginalMainDshModelSource(options.modelSource,realm,store,runtime,budgetSource),business=readOriginalMainDshBusinessSource(options.businessSource,realm,runtime,budgetSource,store);
 const broker=options.brokerSource===undefined||options.brokerSource===null?null:readOriginalMainDshBrokerControlSource(options.brokerSource,realm,store),reconcileBroker=broker?method(broker,'reconcileControls'):null;
 const draftLaunch=createMainDshDraftLaunchSource({realm,store,runtime,budgetSource,businessSource:business}),draftModel=createMainDshDraftModelSource({realm,store,runtime,budgetSource,businessSource:business,modelSource:model});
 const budgetPort=readOriginalDshBudgetPort(runtime,budgetSource),binding=readOriginalDshBudgetRuntimeBinding(runtime,budgetSource),scope=freeze({profileId:binding.profileId,workspaceId:binding.workspaceId});
 const reserveAssessment=method(port,'reserveAssessment'),importCandidate=method(port,'importAssessmentCandidate'),prepareAdmission=method(port,'prepareAdmission'),commitAdmission=method(port,'commitAdmission'),finalizeAdmission=method(port,'finalizeAdmission');
 const claimCommand=method(port,'claimCommand'),importOwnerReceipt=method(port,'importOwnerReceipt'),importControlReceipt=method(port,'importControlReceipt');
 const assess=method(model,'runAssessment'),observe=method(budgetPort,'observe'),syncPolicy=method(budgetPort,'syncWorkPolicy'),reserveWork=method(budgetPort,'reserveDraftAdmission'),bindWork=method(budgetPort,'bindDraftWork'),observeWork=method(budgetPort,'observeWork'),prepareDraft=method(port,'prepareDraft'),closeWork=method(budgetPort,'closeWork');
 const send=method(business,'sendClaim'),basis=method(business,'readOwnerBasis'),reconcile=method(business,'reconcileCommand'),reconcileControl=method(business,'reconcileControl'),readSlot=method(business,'readDraftSlot'),stageDraft=method(business,'stageDraft'),commitDraft=method(business,'commitDraft'),readDraft=method(business,'readDraft');
 const roots=createIntrinsicSet<Promise<void>>(),tails=createIntrinsicSet<Promise<void>>(),seen=createIntrinsicSet<unknown>(),unknown=createIntrinsicSet<unknown>(),controllers=createIntrinsicSet<AbortController>();
 const scans=new WeakMap<object,Promise<void>>();let accepting=true,closed=false,closing:Promise<void>|undefined,reconciling:Promise<void>|undefined,sequence=0,first:unknown,present=false;
 const remember=(raw:unknown)=>{if(!present){present=true;first=raw;}};
 function inventory(raw:unknown):void{retainSourceErrorTails(raw,(value,kind)=>{
  if(kind==='unknown'){unknown.add(value);return;}if(seen.has(value))return;seen.add(value);
  let complete!:()=>void;const completion=new NativePromise<void>(yes=>{complete=yes;});tails.add(completion);
  try{assertStandardIpcPromise(value,'DSH_ADMISSION_SDK_UNCONFIRMED');apply(then,value,[(result:unknown)=>end(result),(error:unknown)=>{remember(error);end(error);}]);}
  catch(error){remember(error);unknown.add(value);tails.delete(completion);complete();}
  function end(value:unknown){try{inventory(value);}catch(error){remember(error);unknown.add(value);}finally{tails.delete(completion);complete();}}
 });}
 function local(){if(!accepting||closed||unknown.size)fail('DSH_ADMISSION_COORDINATOR_CLOSED');}
 function slot(holder:object,label:string):object{const row=create(null);define(holder,String(++sequence),{__proto__:null,value:row} as PropertyDescriptor);define(row,'label',{__proto__:null,value:label} as PropertyDescriptor);return row;}
 function sync<T>(holder:object,label:string,fn:Function,receiver:unknown,args:unknown[],voidResult=false):T {
  const row=slot(holder,label);let raw:unknown;
  try{raw=apply(fn,receiver,args);define(row,'raw',{__proto__:null,value:raw} as PropertyDescriptor);}catch(error){define(row,'error',{__proto__:null,value:error} as PropertyDescriptor);inventory(error);throw error;}
  if(isPromise(raw)||raw&&typeof raw==='object'&&isProxy(raw)||voidResult&&raw!==undefined){unknown.add(raw);inventory(raw);fail('DSH_ADMISSION_SDK_UNCONFIRMED');}return raw as T;
 }
 function promiseChildren(raw:object){const names=keys(raw);for(let i=0;i<names.length;i++){const key=names[i]!,row=descriptor(raw,key);if(key==='constructor'&&row&&own(row,'value')&&row.value===NativePromise)continue;if(!row||!own(row,'value'))unknown.add(raw);else inventory(row.value);}}
 function joined<T>(holder:object,label:string,fn:Function,receiver:unknown,args:unknown[],delivery=false):Promise<{value:T}>{
  const owner=slot(holder,label);let raw:unknown;
  try{raw=apply(fn,receiver,args);define(owner,'raw',{__proto__:null,value:raw} as PropertyDescriptor);assertStandardIpcPromise(raw,'DSH_ADMISSION_SDK_UNCONFIRMED');promiseChildren(raw);}
  catch(error){if(raw!==undefined){unknown.add(raw);inventory(raw);}inventory(error);return new NativePromise((_yes,no)=>no(error));}
  return new NativePromise((yes,no)=>{try{apply(then,raw,[(value:T)=>{try{promiseChildren(raw as object);if(delivery)readOriginalMainDshBusinessDelivery(business,value);else inventory(value);yes(freeze(Object.assign(create(null),{value})));}catch(error){inventory(error);no(error);}},(error:unknown)=>{inventory(error);no(error);}]);}catch(error){unknown.add(raw);inventory(error);no(error);}});
 }
 function current(holder:object){local();const native=sync<ReturnType<typeof readOriginalMainDshBootstrapAuthority>>(holder,'main',readOriginalMainDshBootstrapAuthority,undefined,[realm,store,realm]);sync(holder,'mainCurrent',native.assertCurrent,undefined,[],true);sync(holder,'mainLocal',native.assertLocal,undefined,[],true);local();}
 function operation(work:(holder:object,signal:AbortSignal)=>Promise<void>):Promise<void>{local();let complete!:()=>void;const root=new NativePromise<void>(yes=>{complete=yes;});roots.add(root);const controller=new NativeAbort();controllers.add(controller);const holder=create(null);return(async()=>{try{current(holder);await work(holder,controller.signal);}catch(error){remember(error);inventory(error);throw error;}finally{controllers.delete(controller);roots.delete(root);complete();}})();}
 const context=freeze({requestSource:'scheduler' as const});
 const state=()=>readOriginalDshDesktopState(realm,store,realm,scope);
 function release(holder:object,delivery:MainDshBusinessDelivery){sync(holder,'releaseDelivery',delivery.release,delivery,[],true);}
 async function bookOwner(holder:object,delivery:MainDshBusinessDelivery){
  const book=(await joined<Awaited<ReturnType<MainDshBudgetAuthoritySource['openDraftBinding']>>>(holder,'bookAuthority',budgetSource.openDraftBinding,budgetSource,[delivery,runtime])).value;
  await joined(holder,'bookWork',bindWork,budgetPort,[book.bindInput,book.bindProof]);
 }
 async function prepareOwnerDraft(holder:object,delivery:MainDshBusinessDelivery,commandId:string):Promise<void>{
  const read=sync<ReturnType<MainDshBudgetAuthoritySource['openDraftWorkRead']>>(holder,'draftWorkRead',budgetSource.openDraftWorkRead,budgetSource,[delivery,runtime]);
  const budgetWorkSnapshot=(await joined<object>(holder,'currentDraftWork',observeWork,budgetPort,[read.readInput,read.readProof])).value;
  const refs={ownerObservation:delivery.reply as object,budgetWorkSnapshot},data={commandId};
  const result=sync<Record<string,unknown>>(holder,'prepareDraft',prepareDraft,port,[realm.openDraftPrepare(data,refs),context]);
  if(result.state!=='funding_required')return;
  const fund=sync<ReturnType<MainDshBudgetAuthoritySource['openDraftAdmission']>>(holder,'draftPreparationFunding',budgetSource.openDraftAdmission,budgetSource,[result.proposal]);
  await joined(holder,'draftPreparationPolicy',syncPolicy,budgetPort,[fund.policyInput,fund.policyProof]);
  const budgetReservation=(await joined<object>(holder,'draftPreparationReserve',reserveWork,budgetPort,[fund.reserveInput,fund.reserveProof])).value;
  sync(holder,'commitDraftPreparation',prepareDraft,port,[realm.openDraftPrepare(data,{...refs,admissionProposal:result.proposal as object,budgetReservation,budgetReserveProof:fund.reserveProof}),context]);
 }
 async function executeOwnerDraft(holder:object,signal:AbortSignal,claim:object,prepared:MainDshBusinessDelivery,originalBasis:MainDshBusinessDelivery):Promise<void>{
  const slot=(await joined<MainDshBusinessDelivery>(holder,'readDraftSlot',readSlot,business,[prepared,signal],true)).value;
  let launch:object|undefined,bodyFailure:{error:unknown}|undefined;
  try{
   launch=(await joined<object>(holder,'draftNativeLaunch',draftLaunch.open,draftLaunch,[claim,slot])).value;
   const token=(await joined<object>(holder,'draftModel',draftModel.runDraft,draftModel,[launch])).value;
   const staged=(await joined<MainDshBusinessDelivery>(holder,'stageDraft',stageDraft,business,[draftModel,token,signal],true)).value;
   try{if(record(staged.observation.output).ok!==true)fail('DSH_ADMISSION_DRAFT_STAGE_UNCONFIRMED');}finally{release(holder,staged);}
   const committed=(await joined<MainDshBusinessDelivery>(holder,'commitDraft',commitDraft,business,[draftModel,token,signal],true)).value;
   try{if(record(committed.observation.output).ok!==true)fail('DSH_ADMISSION_DRAFT_COMMIT_UNCONFIRMED');}finally{release(holder,committed);}
   const confirmed=(await joined<MainDshBusinessDelivery>(holder,'readCommittedDraft',readDraft,business,[draftModel,token,signal],true)).value;
   try{
    const output=record(confirmed.observation.output);if(output.ok!==true||record(output.draft).state!=='committed')fail('DSH_ADMISSION_DRAFT_COMMIT_UNCONFIRMED');
    sync(holder,'sealDraftSource',sealOriginalMainDshDraftLaunch,undefined,[launch,realm,store,runtime,budgetSource,business],true);
    const close=(await joined<Awaited<ReturnType<MainDshBudgetAuthoritySource['openCompletedDraftWork']>>>(holder,'completedWorkAuthority',budgetSource.openCompletedDraftWork,budgetSource,[originalBasis,confirmed,runtime,launch,draftModel,token,business])).value;
    await joined(holder,'closeCompletedWork',closeWork,budgetPort,[close.closeInput,close.closeProof]);
   }finally{release(holder,confirmed);}
  }catch(error){bodyFailure={error};}
  // Cleanup owns negative physical facts too. Native capacity and the fund's
  // conservative money settlement remain independent authorities.
  const cleanupErrors:unknown[]=[];
  if(launch){
   try{sync(holder,'sealFinishedDraftSource',sealOriginalMainDshDraftLaunch,undefined,[launch,realm,store,runtime,budgetSource,business],true);}catch(error){appendIntrinsic(cleanupErrors,error);}
   try{
    const native=sync<ReturnType<typeof readOriginalMainDshDraftAdmission>>(holder,'draftNativeOwner',readOriginalMainDshDraftAdmission,undefined,[realm,store,runtime,budgetSource,business]);
    await joined(holder,'finishDraftNative',native.finish,native,[launch,draftModel]);
   }catch(error){appendIntrinsic(cleanupErrors,error);}
  }
  try{release(holder,slot);}catch(error){appendIntrinsic(cleanupErrors,error);}
  if(bodyFailure){
   if(cleanupErrors.length){const all:unknown[]=[];appendIntrinsic(all,bodyFailure.error);for(let i=0;i<cleanupErrors.length;i++)appendIntrinsic(all,cleanupErrors[i]);const failure=aggregateIntrinsicErrors(all,'DSH_DRAFT_PHYSICAL_CLEANUP_UNCONFIRMED');define(failure,'cause',{__proto__:null,value:bodyFailure.error,configurable:true,writable:true} as PropertyDescriptor);throw failure;}
   throw bodyFailure.error;
  }
  if(cleanupErrors.length)throw aggregateIntrinsicErrors(cleanupErrors,'DSH_DRAFT_PHYSICAL_CLEANUP_UNCONFIRMED');
 }
 async function reconcileOne(holder:object,signal:AbortSignal,commandId:string){
  const delivery=(await joined<MainDshBusinessDelivery>(holder,'reconcileOwner',reconcile,business,[commandId,signal],true)).value;
  try{await joined(holder,'importOwnerReceipt',importOwnerReceipt,port,[realm.openOwnerReconcile({commandId},{ownerObservation:delivery.reply as object}),context]);await bookOwner(holder,delivery);}finally{release(holder,delivery);}
 }
 async function reconcileControlOne(holder:object,signal:AbortSignal,operationId:string,ownerDomain:string){
  const a=port,read=method(a,'readOperation');
  const history=record(sync(holder,'controlHistory',read,a,[realm.openReadHistory({schemaVersion:1,query:{kind:'control',operationId,ownerDomain}}),context]));
  const target=record(history.control);if(history.ok!==true||typeof target.controlId!=='string')fail('DSH_ADMISSION_OWNER_CONTROL_UNCONFIRMED');
  const delivery=(await joined<MainDshBusinessDelivery>(holder,'reconcileControl',reconcileControl,business,[operationId,ownerDomain,signal],true)).value;
  try{
   const output=record(delivery.observation.output),heads=output.controlHeads;
   if(output.ok!==true||!Array.isArray(heads))fail('DSH_ADMISSION_OWNER_CONTROL_UNCONFIRMED');
   let selected:Record<string,unknown>|undefined;
   for(let i=0;i<heads.length;i++){const head=record(heads[i]);if(head.id===target.controlId){if(selected)fail('DSH_ADMISSION_OWNER_CONTROL_CONFLICT');selected=head;}}
   if(!selected||typeof selected.recordDigest!=='string')fail('DSH_ADMISSION_OWNER_CONTROL_UNCONFIRMED');
   await joined(holder,'importControlReconciliation',importControlReceipt,port,[realm.openControlReceipt({operationId,ownerDomain,receiptId:'dsh-owner-control:'+selected.recordDigest},{ownerObservation:delivery.reply as object}),context]);
  }finally{release(holder,delivery);}
 }
 async function deliverPending(holder:object,signal:AbortSignal){
  if(broker&&reconcileBroker)await joined(holder,'reconcileBrokerControl',reconcileBroker,broker,[signal]);
  const snapshot=state(),pending=snapshot.pendingOwnerCommands;
  for(let i=0;i<pending.length;i++){
   const item=pending[i]!;let workDomain=false;for(let j=0;j<snapshot.authorizations.ownerDomains.length;j++){const domain=snapshot.authorizations.ownerDomains[j]!;if(domain.kind==='work'&&domain.domainId===item.ownerDomain)workDomain=true;}
   if(!workDomain)continue;current(holder);
   if(item.reconcileOnly){if(item.operation==='apply_dsh_control')await reconcileControlOne(holder,signal,item.commandId,item.ownerDomain);else await reconcileOne(holder,signal,item.commandId);continue;}
   const claim=sync<object>(holder,'claim',claimCommand,port,[realm.openClaimCommand({commandId:item.commandId,expectedDeliveryRevision:item.deliveryRevision}),context]);
   const view=sync<ReturnType<typeof readOriginalDshClaimedCommand>>(holder,'claimed',readOriginalDshClaimedCommand,undefined,[realm,store,realm,claim]);
   if(view.operation!=='apply_dsh_control'&&!view.budgetReservation){await reconcileOne(holder,signal,item.commandId);continue;}
   const delivery=(await joined<MainDshBusinessDelivery>(holder,'sendOwner',send,business,[claim,signal],true)).value;
   try{
    if(view.operation==='apply_dsh_control'){
     const output=record(delivery.observation.output),control=record(output.control);if(output.ok!==true||typeof control.recordDigest!=='string')fail('DSH_ADMISSION_OWNER_CONTROL_UNCONFIRMED');
     await joined(holder,'importControl',importControlReceipt,port,[realm.openControlReceipt({operationId:item.commandId,ownerDomain:item.ownerDomain,receiptId:'dsh-owner-control:'+control.recordDigest},{ownerObservation:delivery.reply as object}),context]);
    }else if(view.operation==='apply_dsh_command'){
     const output=record(delivery.observation.output),receipt=record(output.receipt);
     if(receipt.result==='blocked'){await joined(holder,'importBlockedOwner',importOwnerReceipt,port,[realm.openOwnerReconcile({commandId:item.commandId},{ownerObservation:delivery.reply as object}),context]);await bookOwner(holder,delivery);continue;}
     const read=(await joined<MainDshBusinessDelivery>(holder,'readOwnerBasis',basis,business,[delivery,signal],true)).value;
     try{await joined(holder,'importOwner',importOwnerReceipt,port,[realm.openOwnerReconcile({commandId:item.commandId},{ownerObservation:read.reply as object}),context]);await bookOwner(holder,read);await prepareOwnerDraft(holder,read,item.commandId);await deliverPending(holder,signal);}finally{release(holder,read);}
    }else if(view.operation==='prepare_dsh_slot'){
     const receipt=record(record(delivery.observation.output).receipt);if(receipt.result==='blocked'){await joined(holder,'importBlockedSlot',importOwnerReceipt,port,[realm.openOwnerReconcile({commandId:item.commandId},{ownerObservation:delivery.reply as object}),context]);await bookOwner(holder,delivery);continue;}
     const read=(await joined<MainDshBusinessDelivery>(holder,'readPreparedDraftBasis',basis,business,[delivery,signal],true)).value;
     try{await joined(holder,'importDraftPreparation',importOwnerReceipt,port,[realm.openOwnerReconcile({commandId:item.commandId},{ownerObservation:read.reply as object}),context]);await bookOwner(holder,read);await executeOwnerDraft(holder,signal,claim,delivery,read);}finally{release(holder,read);}
    }
   }finally{release(holder,delivery);}
  }
  // Newly prepared slot commands remain in A's original outbox. The existing
  // tick consumes that same queue; no second scheduler or durable state.
  const after=state().pendingOwnerCommands;
  for(let i=0;i<after.length;i++)if(after[i]!.operation==='prepare_dsh_slot'&&!after[i]!.reconcileOnly){await deliverPending(holder,signal);break;}
 }
 async function evaluateScan(holder:object,signal:AbortSignal,scan:object){
  await deliverPending(holder,signal);current(holder);
  const plans=sync<ReturnType<typeof readOriginalDshAdmissionPlans>>(holder,'plans',readOriginalDshAdmissionPlans,undefined,[realm,store,realm,scan]);
  for(let i=0;i<plans.length;i++){
   const plan=plans[i]!;if(plan.disposition==='review'||plan.disposition==='reconcile')continue;current(holder);sync(holder,'planCurrent',plan.assertCurrent,undefined,[],true);
   const policy=sync<ReturnType<MainDshBudgetAuthoritySource['openSchedulerWorkPolicy']>>(holder,'initialWorkPolicy',budgetSource.openSchedulerWorkPolicy,budgetSource,[plan.mandateId]);
   await joined(holder,'synchronizeWorkPolicy',syncPolicy,budgetPort,[policy.policyInput,policy.policyProof]);
   let candidateId=plan.candidateId;
   if(plan.disposition==='assess'){
    const result=record(sync(holder,'reserveAssessment',reserveAssessment,port,[realm.openAssessmentReserve({schemaVersion:1,bindingId:plan.bindingId,inputId:plan.inputId,proofVersion:plan.proofVersion,mandateId:plan.mandateId,requestedVersion:plan.requestedVersion,expectedSelectionRevision:plan.expectedSelectionRevision},{sourceScan:scan}),context]));
    const attempt=record(result.attempt);if(result.ok!==true||typeof attempt.attemptId!=='string')fail('DSH_ADMISSION_ASSESSMENT_UNCONFIRMED');
    const modelAttempt=(await joined<object>(holder,'assessment',assess,model,[attempt.attemptId])).value;
    const imported=record((await joined(holder,'importAssessment',importCandidate,port,[realm.openAssessmentResult({attemptId:attempt.attemptId},{modelAttempt}),context])).value);
    const candidate=record(imported.candidate);if(imported.ok!==true||typeof candidate.candidateId!=='string')fail('DSH_ADMISSION_ASSESSMENT_UNCONFIRMED');candidateId=candidate.candidateId;
   }
   if(!candidateId)continue;current(holder);
   const read=sync<ReturnType<MainDshBudgetAuthoritySource['openSchedulerObservation']>>(holder,'budgetAudience',budgetSource.openSchedulerObservation,budgetSource,[plan.mandateId]);
   const budgetObservation=(await joined<object>(holder,'freshBudget',observe,budgetPort,[read.readInput,read.readProof])).value;
   const data={schemaVersion:1,bindingId:plan.bindingId,inputId:plan.inputId,proofVersion:plan.proofVersion,mandateId:plan.mandateId,candidateId,expectedSelectionRevision:plan.expectedSelectionRevision,expectedBindingRevision:plan.expectedBindingRevision};
   const refs={sourceScan:scan,budgetObservation},prepared=sync<Record<string,unknown>>(holder,'prepareAdmission',prepareAdmission,port,[realm.openAdmissionCommit(data,refs),context]);
   if(prepared.state!=='funding_required'){
    if(prepared.state==='reconcile')await deliverPending(holder,signal);
    else sync(holder,'finalizeDecision',finalizeAdmission,port,[realm.openAdmissionCommit(data,refs),context]);continue;
   }
   const fund=sync<ReturnType<MainDshBudgetAuthoritySource['openDraftAdmission']>>(holder,'fundingAuthority',budgetSource.openDraftAdmission,budgetSource,[prepared.proposal]);
   await joined(holder,'workPolicy',syncPolicy,budgetPort,[fund.policyInput,fund.policyProof]);
   const budgetReservation=(await joined<object>(holder,'workReserve',reserveWork,budgetPort,[fund.reserveInput,fund.reserveProof])).value;
   current(holder);
   sync(holder,'commitAdmission',commitAdmission,port,[realm.openAdmissionCommit(data,{...refs,admissionProposal:prepared.proposal as object,budgetReservation,budgetReserveProof:fund.reserveProof}),context]);
   await deliverPending(holder,signal);
  }
 }
 function runScan(originalScan:object):Promise<void>{local();const existing=apply(get,scans,[originalScan]) as Promise<void>|undefined;if(existing)return existing;const result=operation((holder,signal)=>evaluateScan(holder,signal,originalScan));apply(set,scans,[originalScan,result]);return result;}
 function reconcileOwners():Promise<void>{if(reconciling)return reconciling;const result=operation(deliverPending);reconciling=result;apply(then,result,[()=>{reconciling=undefined;},()=>{reconciling=undefined;}]);return result;}
 function stopAccepting(){accepting=false;draftLaunch.stopAccepting();draftModel.stopAccepting();const all=controllers.snapshot();for(let i=0;i<all.length;i++)try{apply(abort,all[i],[new NativeError('DSH_ADMISSION_COORDINATOR_CLOSED')]);}catch(error){remember(error);inventory(error);unknown.add(error);}}
 function close():Promise<void>{if(closing)return closing;stopAccepting();closing=(async()=>{while(roots.size||tails.size){await settleIntrinsicOperations(roots.snapshot(),value=>value);await settleIntrinsicOperations(tails.snapshot(),value=>value);}await draftModel.close();await draftLaunch.close();if(unknown.size)throw new NativeError('DSH_ADMISSION_COORDINATOR_FATE_UNKNOWN',{cause:first});closed=true;})();return closing;}
 const coordinator=freeze({runScan,reconcileOwners,stopAccepting,close});apply(set,coordinators,[coordinator,{realm,store,runtime,budgetSource,local}]);return coordinator;
}
