import {types} from 'node:util';
import {captureGithubOpaqueRecord} from '../../src/runtime/multi-agent/dsh-github-read-data.js';
import {captureDispatchBusinessData} from '../../src/runtime/conversation-activity/dispatch-business-data.js';
import {dshAJson} from '../../src/runtime/multi-agent/dsh-admission-data.js';
import {createIntrinsicSet,settleIntrinsicOperations} from '../../src/runtime/verification/intrinsic-async-collection.js';
import {retainSourceErrorTails} from '../../src/runtime/verification/source-error-tails.js';
import {assertStandardIpcPromise} from '../../src/runtime/verification/native-ipc-promise.js';
import type {KSwarmDshAdmission,KSwarmDshAudience,KSwarmDshContext,KSwarmDshOperation,KSwarmDshReplyView} from '../../src/runtime/conversation-activity/owned-kswarm-business.js';
import {readOriginalMainDshBootstrapAuthority,type MainDshBootstrapAuthority} from './main-dsh-bootstrap-authority.js';
import {readOriginalDshAdmissionPort,readOriginalDshClaimedCommand,type DshClaimedCommandView} from './desktop-multi-agent-store.js';
import {readOriginalDshDraftModelResult,type DshDraftModelResult} from './main-dsh-draft-model-source.js';
import {readOriginalMainDshBudgetAuthoritySource} from './main-dsh-budget-authority-source.js';
import {readOriginalDshBudgetRuntimeBinding,readOriginalDshBudgetPort,takeOriginalDshDraftAdmission,assertOriginalDshDraftAdmissionCurrent,readOriginalDshBudgetCommitProof,assertOriginalDshBudgetCommitProofCurrent} from './harness-optimization-service.js';
import {readKSwarmOwnedDshServiceScope,getKSwarmOwnedDshTransport,readOriginalKSwarmDshReply} from './kswarm-service.js';
const apply=Reflect.apply,freeze=Object.freeze,create=Object.create,define=Object.defineProperty,descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn,isProxy=types.isProxy,isPromise=types.isPromise;
const signalAborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted')!.get!,signalReason=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'reason')!.get!;
const NativePromise=Promise,then=Promise.prototype.then,get=WeakMap.prototype.get,set=WeakMap.prototype.set,NativeError=Error;
function fail(code='DSH_MAIN_BUSINESS_SOURCE_REQUIRED'):never{throw new NativeError(code);}
interface Frame {proof:object;operation:KSwarmDshOperation;input:unknown;holder:Record<string,unknown>;active:boolean;settlement?:boolean;claim?:DshClaimedCommandView;auditCommand?:Readonly<Record<string,unknown>>;originalClaim?:object;slotOwnerVersion?:number;draftResult?:DshDraftModelResult;draftReceipt?:object;draftModelSource?:object;draftModelToken?:object;budget?:{port:object;reserveProof:object;receipt:object};signal:AbortSignal;finish():void}
export interface MainDshBusinessDelivery {readonly reply:unknown;readonly observation:KSwarmDshReplyView;release():void}
export interface MainDshBusinessSource {
 readonly admission:KSwarmDshAdmission;
 bindService(service:object):void;bindStore(store:object):void;
 prepareOwner(signal:AbortSignal):Promise<MainDshBusinessDelivery>;
 sendClaim(claim:object,signal:AbortSignal):Promise<MainDshBusinessDelivery>;
 readOwnerBasis(originalDelivery:object,signal:AbortSignal):Promise<MainDshBusinessDelivery>;
 readDraftSlot(originalDelivery:object,signal:AbortSignal):Promise<MainDshBusinessDelivery>;
 reconcileCommand(commandId:string,signal:AbortSignal):Promise<MainDshBusinessDelivery>;
 reconcileControl(operationId:string,ownerDomain:string,signal:AbortSignal):Promise<MainDshBusinessDelivery>;
 stageDraft(originalModelSource:object,originalModelResult:object,signal:AbortSignal):Promise<MainDshBusinessDelivery>;
 commitDraft(originalModelSource:object,originalModelResult:object,signal:AbortSignal):Promise<MainDshBusinessDelivery>;
 readDraft(originalModelSource:object,originalModelResult:object,signal:AbortSignal):Promise<MainDshBusinessDelivery>;
 stopAccepting():void;close():Promise<void>;
}
const businessSources=new WeakMap<object,{realm:object;runtime:object;budgetSource:object;store():object|undefined;local():void}>();
const businessDeliveries=new WeakMap<object,{source:object;delivery:MainDshBusinessDelivery;frame:Frame}>();
/** Original Source-owned resource contract. Its functions are not wire DTOs;
 * callers retain the actual delivery until the original release consumer. */
export function readOriginalMainDshBusinessDelivery(source:unknown,delivery:unknown):MainDshBusinessDelivery {
 const row=apply(get,businessDeliveries,[delivery]) as {source:object;delivery:MainDshBusinessDelivery;frame:Frame}|undefined;
 if(!row||row.source!==source)fail('DSH_MAIN_ORIGINAL_DELIVERY_REQUIRED');return row.delivery;
}
/** Original accepted B facts only. This reader survives normal effect-source
 * withdrawal so the ledger can record actual committed work without sending. */
export function readOriginalMainDshBusinessSettlement(delivery:unknown,realm:unknown,store:unknown,runtime:unknown,budgetSource:unknown):Readonly<{
 reply:unknown;observation:KSwarmDshReplyView;command:Readonly<Record<string,unknown>>;
 budgetReservation:DshClaimedCommandView['budgetReservation'];assertKnown():void;waitKnown():Promise<void>;
}> {
 const row=apply(get,businessDeliveries,[delivery]) as {source:object;delivery:MainDshBusinessDelivery;frame:Frame}|undefined;
 const source=row?apply(get,businessSources,[row.source]) as {realm:object;runtime:object;budgetSource:object;store():object|undefined}|undefined:undefined;
 if(!row||!source||source.realm!==realm||source.store()!==store||source.runtime!==runtime||source.budgetSource!==budgetSource||!(row.frame.operation==='read_dsh_basis'&&row.frame.settlement||(row.frame.operation==='apply_dsh_command'||row.frame.operation==='prepare_dsh_slot')&&row.frame.claim))fail('DSH_MAIN_ORIGINAL_SETTLEMENT_REQUIRED');
 const command=row.frame.claim?.command??row.frame.auditCommand;if(!command)fail('DSH_MAIN_ORIGINAL_SETTLEMENT_REQUIRED');
 return freeze({reply:row.delivery.reply,observation:row.delivery.observation,command,budgetReservation:row.frame.claim?.budgetReservation??null,assertKnown:row.delivery.observation.assertKnown,waitKnown:row.delivery.observation.waitKnown});
}
/** Original B read-slot facts associated with the exact accepted A claim.
 * This is historical identity plus SDK fate; A separately checks current
 * business authority without re-consuming a reservation or claim. */
export function readOriginalMainDshDraftSlot(delivery:unknown,realm:unknown,store:unknown,originalClaim:unknown):Readonly<{
 reply:unknown;observation:KSwarmDshReplyView;command:Readonly<Record<string,unknown>>;
 runtime:object;budgetSource:object;ownerVersion:number;assertKnown():void;waitKnown():Promise<void>;
}> {
 const row=apply(get,businessDeliveries,[delivery]) as {source:object;delivery:MainDshBusinessDelivery;frame:Frame}|undefined;
 const source=row?apply(get,businessSources,[row.source]) as {realm:object;runtime:object;budgetSource:object;store():object|undefined}|undefined:undefined;
 if(!row||!source||!Number.isSafeInteger(row.frame.slotOwnerVersion)||row.frame.slotOwnerVersion!<1||source.realm!==realm||source.store()!==store||row.frame.operation!=='read_dsh_slot'||!row.frame.settlement||row.frame.originalClaim!==originalClaim||!row.frame.claim)fail('DSH_MAIN_ORIGINAL_DRAFT_SLOT_REQUIRED');
 row.delivery.observation.assertKnown();
 return freeze({reply:row.delivery.reply,observation:row.delivery.observation,command:row.frame.claim.command,runtime:source.runtime,budgetSource:source.budgetSource,ownerVersion:row.frame.slotOwnerVersion!,assertKnown:row.delivery.observation.assertKnown,waitKnown:row.delivery.observation.waitKnown});
}
/** Original committed draft facts, for negative accounting only. The exact
 * model result and owned B read reply must agree on the committed artifact. */
export function readOriginalMainDshCompletedDraft(delivery:unknown,realm:unknown,store:unknown,runtime:unknown,budgetSource:unknown,modelSource:unknown,modelToken:unknown) {
 const row=apply(get,businessDeliveries,[delivery]) as {source:object;delivery:MainDshBusinessDelivery;frame:Frame}|undefined;
 const birth=row?apply(get,businessSources,[row.source]) as {realm:object;runtime:object;budgetSource:object;store():object|undefined}|undefined:undefined;
 if(!row||!birth||birth.realm!==realm||birth.store()!==store||birth.runtime!==runtime||birth.budgetSource!==budgetSource||row.frame.operation!=='read_dsh_draft'||!row.frame.settlement||row.frame.draftModelSource!==modelSource||row.frame.draftModelToken!==modelToken)fail('DSH_MAIN_ORIGINAL_COMPLETED_DRAFT_REQUIRED');
 const model=readOriginalDshDraftModelResult(modelSource,modelToken,realm,store,runtime,budgetSource),candidate=model.candidate;
 const observed=row.delivery.observation;observed.assertKnown();
 const output=captureDispatchBusinessData(observed.output) as Record<string,unknown>,draft=output.draft as Record<string,unknown>|undefined,receipt=draft?.receipt as Record<string,unknown>|undefined,proof=candidate.budgetCommitProof as Record<string,unknown>;
 if(output.ok!==true||!draft||draft.state!=='committed'||draft.draftCommitKey!==candidate.draftCommitKey||draft.artifactId!==candidate.artifactId||draft.payloadHash!==candidate.payloadHash||draft.contentHash!==candidate.content.contentHash||!receipt||receipt.kind!=='dsh_draft_commit_receipt'||receipt.draftCommitKey!==candidate.draftCommitKey||receipt.artifactId!==candidate.artifactId||receipt.budgetProofId!==proof.proofId)fail('DSH_MAIN_DRAFT_COMMIT_CONFLICT');
 return freeze({candidate,assertKnown(){observed.assertKnown();model.assertKnown();},async waitKnown(){await observed.waitKnown();await model.waitKnown();}});
}
/** Exact frozen Main Source handle only, not a caller method table. */
export function readOriginalMainDshBusinessSource(source:unknown,realm:unknown,runtime:unknown,budgetSource:unknown,store:unknown):MainDshBusinessSource {
 const row=apply(get,businessSources,[source]) as {realm:object;runtime:object;budgetSource:object;store():object|undefined;local():void}|undefined;
 if(!row||row.realm!==realm||row.runtime!==runtime||row.budgetSource!==budgetSource||row.store()!==store||!store)fail();row.local();return source as MainDshBusinessSource;
}
/** Exact original composition. This Source never grants arbitrary wire data:
 * positive commands come only from a private, committed A claim and funded
 * original budget receipt. A cold ID remains reconciliation data. */
export function createMainDshBusinessSource(raw:unknown):MainDshBusinessSource {
 const options=captureGithubOpaqueRecord(raw,['realm','runtime','budgetSource']),realm=options.realm as MainDshBootstrapAuthority,runtime=options.runtime as object,budgetSource=options.budgetSource as object;
 let composition:typeof import('./main-room-root-admission.js')|undefined;
 let store:object|undefined,service:object|undefined,accepting=true,closed=false,closing:Promise<void>|undefined,sequence=0,ownerDomain:Readonly<{domainId:string;instance:string}>|undefined,first:unknown,firstPresent=false;
 const roots=createIntrinsicSet<Promise<void>>(),tails=createIntrinsicSet<Promise<void>>(),seen=createIntrinsicSet<unknown>(),unknown=createIntrinsicSet<unknown>(),frames=new WeakMap<object,Frame>(),deliveries=new WeakMap<object,Frame>();
 const remember=(raw:unknown)=>{if(!firstPresent){firstPresent=true;first=raw;}};
 function inventory(raw:unknown):void{retainSourceErrorTails(raw,(value,kind)=>{if(kind==='unknown'){unknown.add(value);return;}if(seen.has(value))return;seen.add(value);let complete!:()=>void;const done=new NativePromise<void>(yes=>{complete=yes;});tails.add(done);try{assertStandardIpcPromise(value,'DSH_MAIN_BUSINESS_SDK_UNKNOWN');apply(then,value,[(value:unknown)=>end(value,false),(error:unknown)=>end(error,true)]);}catch(error){remember(error);unknown.add(value);tails.delete(done);complete();}function end(value:unknown,rejected:boolean){if(rejected)remember(value);try{inventory(value);}catch(error){remember(error);unknown.add(value);}finally{tails.delete(done);complete();}}});}
 function slot(holder:Record<string,unknown>,label:string):Record<string,unknown>{const slot=create(null);define(holder,String(++sequence),{__proto__:null,value:slot,enumerable:true} as PropertyDescriptor);define(slot,'label',{__proto__:null,value:label,enumerable:true} as PropertyDescriptor);return slot;}
 function sync<T>(holder:Record<string,unknown>,label:string,fn:Function,args:unknown[],receiver?:unknown,requireVoid=false):T{const owner=slot(holder,label);let raw:unknown;try{raw=apply(fn,receiver,args);define(owner,'raw',{__proto__:null,value:raw,enumerable:true} as PropertyDescriptor);}catch(error){define(owner,'error',{__proto__:null,value:error,enumerable:true} as PropertyDescriptor);inventory(error);throw error;}if(isPromise(raw)||raw&&typeof raw==='object'&&isProxy(raw)||requireVoid&&raw!==undefined){unknown.add(raw);inventory(raw);fail('DSH_MAIN_BUSINESS_SDK_UNKNOWN');}return raw as T;}
 function joined<T>(holder:Record<string,unknown>,label:string,fn:Function,args:unknown[],receiver?:unknown):Promise<{value:T}>{const owner=slot(holder,label);let raw:unknown;try{raw=apply(fn,receiver,args);define(owner,'raw',{__proto__:null,value:raw,enumerable:true} as PropertyDescriptor);assertStandardIpcPromise(raw,'DSH_MAIN_BUSINESS_SDK_UNKNOWN');}catch(error){if(raw!==undefined){unknown.add(raw);inventory(raw);}inventory(error);return new NativePromise((_yes,no)=>no(error));}return new NativePromise((yes,no)=>{try{apply(then,raw,[(value:T)=>yes(freeze(Object.assign(create(null),{value}))),(error:unknown)=>{inventory(error);no(error);}]);}catch(error){unknown.add(raw);inventory(raw);inventory(error);no(error);}});}
 function begin(){let complete!:()=>void;const completion=new NativePromise<void>(yes=>{complete=yes;});roots.add(completion);let finished=false;return()=>{if(!finished){finished=true;roots.delete(completion);complete();}};}
 function local(){if(!accepting||closed||unknown.size)fail('DSH_MAIN_BUSINESS_CLOSED');}
 function transient(work:(holder:Record<string,unknown>)=>void){local();const finish=begin(),holder=create(null);try{work(holder);}catch(error){remember(error);inventory(error);throw error;}finally{finish();}}
 function bindService(candidate:object){transient(holder=>{if(service&&service!==candidate)fail();const scope=sync<ReturnType<typeof readKSwarmOwnedDshServiceScope>>(holder,'serviceScope',readKSwarmOwnedDshServiceScope,[candidate,admission]),budget=sync<ReturnType<typeof readOriginalDshBudgetRuntimeBinding>>(holder,'budgetBinding',readOriginalDshBudgetRuntimeBinding,[runtime,budgetSource]);if(scope.profileId!==budget.profileId||scope.workspaceId!==budget.workspaceId)fail();local();service=candidate;});}
 function bindStore(candidate:object){transient(holder=>{if(store&&store!==candidate)fail();sync(holder,'store',readOriginalDshAdmissionPort,[candidate,realm]);sync(holder,'budgetSource',readOriginalMainDshBudgetAuthoritySource,[budgetSource,realm,candidate]);local();store=candidate;});}
 async function ensureComposition(row:Frame){if(!composition)composition=(await joined<typeof import('./main-room-root-admission.js')>(row.holder,'compositionModule',()=>import('./main-room-root-admission.js'),[])).value;}
 function current(frame:Frame){local();if(!frame.active||!store||!service)fail();if(sync<boolean>(frame.holder,'signalAborted',signalAborted,[],frame.signal))throw sync<unknown>(frame.holder,'signalReason',signalReason,[],frame.signal);const native=sync<ReturnType<typeof readOriginalMainDshBootstrapAuthority>>(frame.holder,'main',readOriginalMainDshBootstrapAuthority,[realm,store,realm]);if(!composition)fail('DSH_MAIN_COMPOSITION_REQUIRED');const readonlySettlement=frame.settlement===true&&['read_dsh_domain','read_dsh_basis','read_dsh_slot','read_dsh_draft'].includes(frame.operation);if(!readonlySettlement)sync(frame.holder,'composition',composition.assertOriginalMainDshPhysicalComposition,[realm,store,runtime,budgetSource]);sync(frame.holder,'mainCurrent',native.assertCurrent,[],undefined,true);if(frame.claim&&!frame.settlement){sync(frame.holder,'claimCurrent',frame.claim.assertCurrent,[],undefined,true);sync(frame.holder,'claimLocal',frame.claim.assertLocal,[],undefined,true);}if(frame.draftResult){sync(frame.holder,'draftCurrent',frame.draftResult.assertCurrent,[],frame.draftResult,true);if(!frame.draftReceipt)fail();const port=sync<ReturnType<typeof readOriginalDshBudgetPort>>(frame.holder,'commitBudgetPort',readOriginalDshBudgetPort,[runtime,budgetSource]);sync(frame.holder,'commitBudgetCurrent',assertOriginalDshBudgetCommitProofCurrent,[port,frame.draftReceipt],undefined,true);}if(frame.budget)sync(frame.holder,'budgetCurrent',assertOriginalDshDraftAdmissionCurrent,[frame.budget.port,frame.budget.reserveProof,frame.budget.receipt],undefined,true);local();if(!frame.active)fail();}
 const admission:KSwarmDshAdmission=(proof,audience)=>{
  const frame=apply(get,frames,[proof]) as Frame|undefined;if(!frame)fail();
  // The original client already captured closed data. No audience property is
  // consulted until private proof membership succeeds.
  const value=captureGithubOpaqueRecord(audience,['operation','scope','serviceOwner','projectId','input','sessionNonce','instance']) as unknown as KSwarmDshAudience;
  if(value.operation!==frame.operation||value.serviceOwner!==service||value.projectId!=='@dsh-domain'||dshAJson(value.input)!==dshAJson(frame.input))fail();
  const binding=sync<ReturnType<typeof readOriginalDshBudgetRuntimeBinding>>(frame.holder,'budgetScope',readOriginalDshBudgetRuntimeBinding,[runtime,budgetSource]);
  if(value.scope.profileId!==binding.profileId||value.scope.workspaceId!==binding.workspaceId)fail();current(frame);
 };
 function frame(operation:KSwarmDshOperation,input:unknown,signal:AbortSignal):Frame{
  local();if(!store||!service)fail();const finish=begin(),holder=create(null);
  try{
   if(isProxy(signal))fail();const aborted=sync<unknown>(holder,'signalBrand',signalAborted,[],signal);if(typeof aborted!=='boolean')fail();if(aborted)throw sync(holder,'signalReason',signalReason,[],signal);
   const row:Frame={proof:freeze(create(null)),operation,input:captureDispatchBusinessData(input,raw=>inventory(raw)),holder,active:true,signal,finish};apply(set,frames,[row.proof,row]);return row;
  }catch(error){inventory(error);finish();throw error;}
 }
 function release(row:Frame){if(row.active){row.active=false;row.finish();}}
 async function call(row:Frame,method:Function,receiver:unknown):Promise<MainDshBusinessDelivery>{
  try{current(row);const context:KSwarmDshContext=freeze({requestSource:'scheduler',admission:row.proof,signal:row.signal});const args=row.operation==='prepare_dsh_owner'?[context]:[row.input,context];const reply=(await joined<unknown>(row.holder,'businessReply',method,args,receiver)).value;
   const observed=sync<KSwarmDshReplyView>(row.holder,'replyIdentity',readOriginalKSwarmDshReply,[service!,admission,reply]);await joined(row.holder,'replyKnown',observed.waitKnown,[],observed);sync(row.holder,'replyKnownFinal',observed.assertKnown,[],observed,true);sync(row.holder,'replyCurrent',observed.assertCurrent,[],observed,true);current(row);
   const delivery=freeze(Object.assign(create(null),{reply,observation:observed,release(){release(row);}}));apply(set,deliveries,[delivery,row]);apply(set,businessDeliveries,[delivery,{source,delivery,frame:row}]);return delivery;
  }catch(error){remember(error);inventory(error);release(row);throw new NativeError('DSH_MAIN_BUSINESS_DELIVERY_FAILED',{cause:error});}
 }
 async function prepareOwner(signal:AbortSignal):Promise<MainDshBusinessDelivery>{
  const preparation=frame('prepare_dsh_owner',null,signal);let prepared:MainDshBusinessDelivery|undefined;
  try{await ensureComposition(preparation);current(preparation);const port=sync<ReturnType<typeof getKSwarmOwnedDshTransport>>(preparation.holder,'transport',getKSwarmOwnedDshTransport,[service!,admission]);const binding=sync<ReturnType<typeof readOriginalDshBudgetRuntimeBinding>>(preparation.holder,'domainScope',readOriginalDshBudgetRuntimeBinding,[runtime,budgetSource]);prepared=await call(preparation,port.prepareOwner,port);prepared.release();const read=frame('read_dsh_domain',{data:{scope:{profileId:binding.profileId,workspaceId:binding.workspaceId}},budget:null},signal),delivery=await call(read,port.readDomain,port);const output=captureDispatchBusinessData(delivery.observation.output) as Record<string,unknown>,domain=output.domain as Record<string,unknown>;if(output.ok!==true||!domain||domain.kind!=='kswarm_dsh'||typeof domain.domainId!=='string'||!domain.domainId){delivery.release();fail('DSH_MAIN_OWNER_DOMAIN_UNCONFIRMED');}ownerDomain=freeze({domainId:domain.domainId,instance:delivery.observation.instance});return delivery;
  }catch(error){prepared?.release();release(preparation);throw error;}
 }
 async function sendClaim(originalClaim:object,signal:AbortSignal):Promise<MainDshBusinessDelivery>{
  const row=frame('apply_dsh_command',{data:null,budget:null},signal);
  try{await ensureComposition(row);current(row);const claim=sync<DshClaimedCommandView>(row.holder,'claim',readOriginalDshClaimedCommand,[realm,store!,realm,originalClaim]);row.claim=claim;row.originalClaim=originalClaim;
   if(!ownerDomain||ownerDomain.domainId!==claim.expectedOwnerDomainId)fail('DSH_MAIN_OWNER_DOMAIN_UNCONFIRMED');const data=claim.command;let budget:unknown=null;if(claim.operation!=='apply_dsh_control'&&(data.action==='create_draft_work'||data.action==='append_input'||data.action==='prepare_draft')){
    if(!claim.budgetReservation)fail('DSH_MAIN_BUDGET_RESERVATION_REQUIRED');const port=sync<ReturnType<typeof readOriginalDshBudgetPort>>(row.holder,'budgetPort',readOriginalDshBudgetPort,[runtime,budgetSource]);const refs=claim.budgetReservation;budget=sync(row.holder,'takeBudget',takeOriginalDshDraftAdmission,[port,refs.reserveProof,refs.receipt]);row.budget={port,reserveProof:refs.reserveProof,receipt:refs.receipt};
   }
   if(claim.operation==='prepare_dsh_slot'&&data.action!=='prepare_draft'||claim.operation==='apply_dsh_control'&&claim.budgetReservation!==null)fail('DSH_MAIN_COMMAND_CLASS_CONFLICT');row.operation=claim.operation;row.input=captureDispatchBusinessData({data,budget});current(row);const port=sync<ReturnType<typeof getKSwarmOwnedDshTransport>>(row.holder,'transport',getKSwarmOwnedDshTransport,[service!,admission]);const hello=(await joined<Awaited<ReturnType<typeof port.prepareHello>>>(row.holder,'ownerHello',port.prepareHello,[],port)).value;sync(row.holder,'ownerHelloCurrent',port.assertHelloCurrent,[hello],port,true);if(hello.boot!==ownerDomain.instance)fail('DSH_MAIN_OWNER_DOMAIN_UNCONFIRMED');return await call(row,row.operation==='prepare_dsh_slot'?port.prepareSlot:row.operation==='apply_dsh_control'?port.applyControl:port.applyCommand,port);
  }catch(error){remember(error);inventory(error);release(row);throw new NativeError('DSH_MAIN_BUSINESS_DELIVERY_FAILED',{cause:error});}
 }
 async function readOwnerBasis(originalDelivery:object,signal:AbortSignal):Promise<MainDshBusinessDelivery>{
  const prior=apply(get,deliveries,[originalDelivery]) as Frame|undefined;
  if(!prior?.claim||prior.operation==='apply_dsh_control')fail('DSH_MAIN_ORIGINAL_DELIVERY_REQUIRED');
  const command=prior.claim.command;
  const row=frame('read_dsh_basis',{data:{scope:prior.claim.scope,thread:command.thread,bindingId:command.bindingId,generation:1,operationKey:prior.claim.operationKey},budget:null},signal);row.settlement=true;row.claim=prior.claim;
  try{await ensureComposition(row);current(row);const port=sync<ReturnType<typeof getKSwarmOwnedDshTransport>>(row.holder,'basisTransport',getKSwarmOwnedDshTransport,[service!,admission]);return await call(row,port.readBasis,port);}catch(error){remember(error);inventory(error);release(row);throw new NativeError('DSH_MAIN_BUSINESS_DELIVERY_FAILED',{cause:error});}
 }
 async function readDraftSlot(originalDelivery:object,signal:AbortSignal):Promise<MainDshBusinessDelivery>{
  const prior=apply(get,deliveries,[originalDelivery]) as Frame|undefined;
  if(!prior?.claim||!prior.originalClaim||prior.operation!=='prepare_dsh_slot')fail('DSH_MAIN_ORIGINAL_DRAFT_SLOT_REQUIRED');
  const actual=readOriginalMainDshBusinessDelivery(source,originalDelivery);actual.observation.assertKnown();
  const output=captureDispatchBusinessData(actual.observation.output) as Record<string,unknown>,slot=output.slot as Record<string,unknown>|undefined,receipt=output.receipt as Record<string,unknown>|undefined;
  if(output.ok!==true||!slot||typeof slot.draftCommitKey!=='string'||!receipt||typeof receipt.ownerVersion!=='number'||!Number.isSafeInteger(receipt.ownerVersion)||receipt.ownerVersion<1)fail('DSH_MAIN_ORIGINAL_DRAFT_SLOT_REQUIRED');
  const command=prior.claim.command;
  const row=frame('read_dsh_slot',{data:{scope:prior.claim.scope,thread:command.thread,bindingId:command.bindingId,generation:1,ownerWorkId:command.targetWorkId,draftCommitKey:slot.draftCommitKey},budget:null},signal);
  row.settlement=true;row.claim=prior.claim;row.originalClaim=prior.originalClaim;row.slotOwnerVersion=receipt.ownerVersion as number;
  try{await ensureComposition(row);current(row);const port=sync<ReturnType<typeof getKSwarmOwnedDshTransport>>(row.holder,'draftSlotTransport',getKSwarmOwnedDshTransport,[service!,admission]);return await call(row,port.readSlot,port);}
  catch(error){remember(error);inventory(error);release(row);throw new NativeError('DSH_MAIN_DRAFT_SLOT_READ_FAILED',{cause:error});}
 }
 async function reconcileCommand(commandId:string,signal:AbortSignal):Promise<MainDshBusinessDelivery>{
  // A durable command is used solely as an original read-only query. It never
  // reconstructs a warm reservation, claim, send or execution permission.
  const row=frame('read_dsh_basis',{data:null,budget:null},signal);row.settlement=true;
  try{
   if(typeof commandId!=='string'||!commandId||commandId.length>256)fail('DSH_MAIN_COMMAND_ID_INVALID');
   await ensureComposition(row);current(row);
   const a=sync<ReturnType<typeof readOriginalDshAdmissionPort>>(row.holder,'originalA',readOriginalDshAdmissionPort,[store!,realm]);
   const proof=sync<object>(row.holder,'readCommandFrame',realm.openReadHistory,[{schemaVersion:1,query:{kind:'command',commandId}}],realm);
   const history=sync<Record<string,unknown>>(row.holder,'readCommand',a.readOperation,[proof,{requestSource:'scheduler'}],a);
   const captured=captureDispatchBusinessData(history) as Record<string,unknown>,outbox=captured.command as Record<string,unknown>|null,command=outbox?.command as Record<string,unknown>|undefined;
   if(captured.ok!==true||!outbox||!command||command.commandId!==commandId||typeof command.bindingId!=='string'||!command.thread||!command.scope||typeof command.operationKey!=='string'||command.action==='prepare_draft')fail('DSH_MAIN_COMMAND_RECONCILIATION_UNAVAILABLE');
   row.auditCommand=freeze(command);row.input=captureDispatchBusinessData({data:{scope:command.scope,thread:command.thread,bindingId:command.bindingId,generation:1,operationKey:command.operationKey,commandId},budget:null});
   current(row);const port=sync<ReturnType<typeof getKSwarmOwnedDshTransport>>(row.holder,'reconcileTransport',getKSwarmOwnedDshTransport,[service!,admission]);return await call(row,port.readBasis,port);
  }catch(error){remember(error);inventory(error);release(row);throw new NativeError('DSH_MAIN_BUSINESS_RECONCILIATION_FAILED');}
 }
 async function reconcileControl(operationId:string,ownerDomainId:string,signal:AbortSignal):Promise<MainDshBusinessDelivery>{
  // Reconcile only actual owner facts. History identifies the query; it cannot
  // recreate a claim, transmit a control or recover an execution permission.
  const row=frame('read_dsh_domain',{data:null,budget:null},signal);row.settlement=true;
  try{
   if(typeof operationId!=='string'||!operationId||operationId.length>256||typeof ownerDomainId!=='string'||!ownerDomainId||ownerDomainId.length>256)fail('DSH_MAIN_CONTROL_ID_INVALID');
   await ensureComposition(row);current(row);
   const a=sync<ReturnType<typeof readOriginalDshAdmissionPort>>(row.holder,'originalA',readOriginalDshAdmissionPort,[store!,realm]);
   const proof=sync<object>(row.holder,'readControlFrame',realm.openReadHistory,[{schemaVersion:1,query:{kind:'control',operationId,ownerDomain:ownerDomainId}}],realm);
   const history=sync<Record<string,unknown>>(row.holder,'readControl',a.readOperation,[proof,{requestSource:'scheduler'}],a);
   const captured=captureDispatchBusinessData(history) as Record<string,unknown>,target=captured.control as Record<string,unknown>|null;
   if(captured.ok!==true||!target||target.operationId!==operationId||target.ownerDomain!==ownerDomainId||typeof target.controlId!=='string')fail('DSH_MAIN_CONTROL_RECONCILIATION_UNAVAILABLE');
   const binding=sync<ReturnType<typeof readOriginalDshBudgetRuntimeBinding>>(row.holder,'domainScope',readOriginalDshBudgetRuntimeBinding,[runtime,budgetSource]);
   row.input=captureDispatchBusinessData({data:{scope:{profileId:binding.profileId,workspaceId:binding.workspaceId}},budget:null});
   current(row);const port=sync<ReturnType<typeof getKSwarmOwnedDshTransport>>(row.holder,'reconcileControlTransport',getKSwarmOwnedDshTransport,[service!,admission]);return await call(row,port.readDomain,port);
  }catch(error){remember(error);inventory(error);release(row);throw new NativeError('DSH_MAIN_CONTROL_RECONCILIATION_FAILED',{cause:error});}
 }
 async function draftCall(operation:'stage_dsh_draft'|'commit_dsh_draft'|'read_dsh_draft',modelSource:object,modelToken:object,signal:AbortSignal):Promise<MainDshBusinessDelivery>{
  const result=readOriginalDshDraftModelResult(modelSource,modelToken,realm,store,runtime,budgetSource),candidate=result.candidate;
  const read=operation==='read_dsh_draft';
  const row=frame(operation,{data:read?{scope:candidate.scope,thread:candidate.thread,bindingId:candidate.bindingId,generation:1,ownerWorkId:candidate.ownerWorkId,draftCommitKey:candidate.draftCommitKey}:candidate,budget:null},signal);
  row.draftModelSource=modelSource;row.draftModelToken=modelToken;
  try{
   await ensureComposition(row);
   if(read)row.settlement=true;
   else{
    row.draftResult=result;row.draftReceipt=result.budgetCommitReceipt;
    const port=sync<ReturnType<typeof readOriginalDshBudgetPort>>(row.holder,'commitBudgetPort',readOriginalDshBudgetPort,[runtime,budgetSource]);
    const proof=sync<ReturnType<typeof readOriginalDshBudgetCommitProof>>(row.holder,'commitProof',readOriginalDshBudgetCommitProof,[port,result.budgetCommitReceipt]);
    row.input=captureDispatchBusinessData({data:candidate,budget:proof});
   }
   current(row);const port=sync<ReturnType<typeof getKSwarmOwnedDshTransport>>(row.holder,'draftTransport',getKSwarmOwnedDshTransport,[service!,admission]);
   return await call(row,read?port.readDraft:operation==='stage_dsh_draft'?port.stageDraft:port.commitDraft,port);
  }catch(error){remember(error);inventory(error);release(row);throw new NativeError('DSH_MAIN_DRAFT_DELIVERY_FAILED',{cause:error});}
 }
 const stageDraft=(modelSource:object,modelResult:object,signal:AbortSignal)=>draftCall('stage_dsh_draft',modelSource,modelResult,signal);
 const commitDraft=(modelSource:object,modelResult:object,signal:AbortSignal)=>draftCall('commit_dsh_draft',modelSource,modelResult,signal);
 const readDraft=(modelSource:object,modelResult:object,signal:AbortSignal)=>draftCall('read_dsh_draft',modelSource,modelResult,signal);
 function stopAccepting(){accepting=false;}
 function close():Promise<void>{if(closing)return closing;stopAccepting();closing=(async()=>{while(roots.size||tails.size){await settleIntrinsicOperations(roots.snapshot(),row=>row);await settleIntrinsicOperations(tails.snapshot(),row=>row);}if(unknown.size)throw new NativeError('DSH_MAIN_BUSINESS_FATE_UNKNOWN',{cause:first});closed=true;})();return closing;}
 const source=freeze({admission,bindService,bindStore,prepareOwner,sendClaim,readOwnerBasis,readDraftSlot,reconcileCommand,reconcileControl,stageDraft,commitDraft,readDraft,stopAccepting,close});apply(set,businessSources,[source,{realm,runtime,budgetSource,store:()=>store,local}]);return source;
}
