import {readInstalledCurrentOwner} from '../../src/runtime/verification/installed-owner-state.js';
import {loopHostSubjectOwner} from '../../src/runtime/verification/loop-host-subject.js';
import {completionConsumerOwner} from '../../src/runtime/verification/completion-consumer-owner.js';
import {canonicalVerificationJson as json} from '../../src/runtime/verification/protocol.js';
import {createLoopBusinessPublicationHost,consumeLoopCompletedRun,type LoopCompletionRequest} from './loop-business-publication-host.js';
import {captureLoopProducerValue} from './loop-scan-publication-body.js';
import {publicationFields,publicationIdentity} from './loop-publication-attempt.js';
import {assistantTrigger} from './assistant-runtime.js';
import type {LoopStore} from './loop-store.js';
import type {TimedActionStore,LoopTimedRows,LoopTimedTarget} from './timed-action-store.js';
import type {LoopTimedActionDecision} from './timed-action-types.js';
import type {TaskSnapshot} from '../../src/runtime/task-host/types.js';
export type LoopTimedMode='normal'|'reused'|'stale';
export type LoopTimedOutcome='success'|'publication_pending'|'failed'|'blocked'|'rejected';
export interface LoopTimedReceipt {
 version:1;revision:number;actionId:string;timedRunId:string;loopId:string;loopRunId:string|null;mode:LoopTimedMode;
 disposition:'pending'|'committed'|'rejected';outcome:LoopTimedOutcome;original:LoopTimedRows;after:LoopTimedRows;
 pendingAction:LoopTimedRows['action']|null;decision:LoopTimedActionDecision|null;loopIdentity:string|null;
}
interface Request {actionId:string;timedRunId:string;loopRunId?:string;mode:LoopTimedMode;requestSource:'user'|'agent'|'scheduler';signal?:AbortSignal}
interface Write {loopId:string;target:Readonly<LoopTimedTarget>;previous:Readonly<LoopTimedReceipt>|undefined;loopRunId:string|null;mode:LoopTimedMode;outcome:LoopTimedOutcome;decision:LoopTimedActionDecision|null;loopIdentity:string|null;now:number;check():void;consume():()=>void}
const tickets=new WeakMap<object,{store:TimedActionStore;write:Write}>();
export function consumeLoopTimedCompletion(store:TimedActionStore,ticket:object):Write {const entry=tickets.get(ticket);tickets.delete(ticket);if(!entry||entry.store!==store)throw Error('loop_timed_ticket');entry.write.check();return entry.write;}
export type LoopTimedResult={status:'retry_pending'}|{status:'applied'|'already_applied';disposition:LoopTimedReceipt['disposition'];outcome:LoopTimedOutcome;receipt:Readonly<LoopTimedReceipt>};
const encoded=(v:unknown)=>json(JSON.parse(JSON.stringify(v)));
/** Fixed Main owner. Every asynchronous request remains tracked through the
 * actual business host close; a timeout is never a database drain receipt. */
export function createLoopTimedCompletionHost(options:{timedStore:TimedActionStore;loopStore:LoopStore;captureAdmission():()=>void;taskPort?:{recoverTask(taskId:string):Promise<TaskSnapshot|undefined>};now?:()=>number}){
 const {timedStore,loopStore}=options,now=options.now??Date.now,capture=options.captureAdmission.bind(options),lifetime=new AbortController(),pending=new Set<Promise<unknown>>();let closed=false;
 async function execute(raw:Request):Promise<LoopTimedResult>{
  const d=Object.getOwnPropertyDescriptors(raw);if(Reflect.ownKeys(raw).some(k=>typeof k!=='string')||Object.values(d).some(v=>!('value'in v)))throw Error('loop_timed_input');
  const {signal:s,...rest}=d,input=captureLoopProducerValue(Object.fromEntries(Object.entries(rest).map(([k,v])=>[k,v.value]))) as Omit<Request,'signal'>;
  publicationFields(input,['actionId','timedRunId','mode','requestSource',...(Object.hasOwn(input,'loopRunId')?['loopRunId']:[])]);publicationIdentity(input.actionId);publicationIdentity(input.timedRunId);if(input.loopRunId!==undefined)publicationIdentity(input.loopRunId);
  if(input.requestSource!=='scheduler'||!['normal','reused','stale'].includes(input.mode))throw Error('loop_timed_source');if(s?.value!==undefined&&!(s.value instanceof AbortSignal))throw Error('loop_timed_signal');
  const previous=timedStore.getLoopTimedReceipt(input.timedRunId);
  if(previous){if(previous.actionId!==input.actionId||input.loopRunId!==undefined&&previous.loopRunId!==input.loopRunId||input.mode!=='stale'&&previous.mode!==input.mode)throw Error('loop_timed_receipt_identity');if(previous.disposition!=='pending')return {status:'already_applied',disposition:previous.disposition,outcome:previous.outcome,receipt:previous};}
  const signal=s?.value?AbortSignal.any([s.value,lifetime.signal]):lifetime.signal,admission=capture();
  const admit=()=>{if(closed)throw Error('loop_timed_closed');signal.throwIfAborted();const value:unknown=admission();if(value!==undefined){void Promise.resolve(value).catch(()=>{});throw Error('loop_timed_admission_sync');}signal.throwIfAborted();};admit();
  const target=timedStore.getLoopTimedTarget(input.actionId,input.timedRunId),timestamp=now();
  if(target.run.executorKind!=='loop')throw Error('loop_timed_executor');
  const claimed=target.run.decision?.originalAction as typeof target.action|undefined;
  const loopId=previous?.loopId??(claimed?.executor.kind==='loop'?claimed.executor.loopId:target.action.executor.kind==='loop'?target.action.executor.loopId:undefined);
  if(!loopId)return {status:'retry_pending'};
  const identity=(action:typeof target.action)=>encoded(Object.fromEntries(['id','executor','trigger','policy','source','ownerKind','ownerId','createdByTaskId','createdAt'].map(key=>[key,(action as any)[key]])));
  const changed=!!claimed&&identity(claimed)!==identity(target.action);
  const current=()=>{admit();if(timedStore.getLoopTimedTarget(input.actionId,input.timedRunId).vector!==target.vector)throw Error('loop_timed_changed');};current();
  if(!previous&&target.run.status==='publication_pending')return {status:'retry_pending'}; // legacy requires the original migration proof
  const existing=loopStore.findLoopRunsByTimedActionRunId(input.timedRunId);
  if(existing.length>1)throw Error('loop_timed_multiple_runs');
  const runId=previous?.loopRunId??input.loopRunId??existing[0]?.id;
  const run=runId?loopStore.getLoopRun(runId):undefined;
  if(run&&run.loopId!==loopId)throw Error('loop_timed_run_identity');
  if(run){
   if(!previous&&input.mode==='reused'){
    const profile=loopStore.getAssistantProfile('default-personal-assistant'),kind=run.loopId==='personal-assistant-evening-reflection'?'evening':run.loopId==='personal-assistant-morning-briefing'?'morning':undefined;
    const context=target.run.decision?.context as {scheduledDueAt?:unknown}|undefined;
    if(!profile||!kind||typeof context?.scheduledDueAt!=='number'||run.logicalRunKey!==assistantTrigger({assistantKind:kind,profile,trigger:{kind:'scheduled',scheduledDueAt:context.scheduledDueAt},now:timestamp}).logicalRunKey)throw Error('loop_timed_reuse_identity');
   }else if(!previous&&(existing[0]?.id!==run.id||run.trigger.timedActionId!==input.actionId||run.trigger.timedActionRunId!==input.timedRunId))throw Error('loop_timed_run_identity');
  }else if(input.loopRunId)throw Error('loop_timed_run_identity');
  const basis=run?loopStore.getLoopRunPublicationBasis(run.id):undefined;
  const configChanged=!!basis&&encoded(basis.configuration)!==encoded(loopStore.getLoopPublicationConfiguration(basis.loopId)??null);
  const candidates=run?loopStore.listLoopPublicationCandidates(run.id):[];
  const owners=run?[completionConsumerOwner({ownerKind:'loop_run',ownerId:run.id}),...loopStore.listLoopStages(run.id).map(stage=>completionConsumerOwner({ownerKind:'loop_stage',ownerId:stage.id})),...candidates.map(c=>loopHostSubjectOwner(c.binding.subject))]:[];
  const routes=owners.map(owner=>readInstalledCurrentOwner(owner));
  const routeChanged=candidates.some(candidate=>{const original=loopStore.listLoopPublicationAttempts(candidate.candidateId).find(attempt=>attempt.status==='committed');if(!original?.routeJson)return false;const prior=JSON.parse(original.routeJson),current=readInstalledCurrentOwner(loopHostSubjectOwner(candidate.binding.subject));return current.kind!=='unavailable'&&current.kind!=='pending'&&(current.kind==='ordinary'||prior.authorityId!==current.authorityId||encoded(prior.owner)!==encoded(current.owner));});
  const inactive=!!run&&loopStore.getLoopDefinition(loopId)?.status!=='active';
  const lost=!previous&&(target.action.status!=='active'||target.action.lockedRunId!==input.timedRunId||target.deleted||changed||configChanged||inactive||routeChanged);
  let outcome:LoopTimedOutcome,decision:LoopTimedActionDecision|null=null;
  if(lost)outcome='rejected';
  else{
   if(routes.some(route=>route.kind==='unavailable'||route.kind==='pending'))return {status:'retry_pending'};
   if(!run||run.loopId!==loopId)return {status:'retry_pending'};
   if(previous){const original=previous.loopIdentity?JSON.parse(previous.loopIdentity).run:undefined;if(!original||['id','loopId','logicalRunKey','trigger','startedAt'].some(key=>encoded((original as any)[key]??null)!==encoded((run as any)[key]??null)))throw Error('loop_timed_receipt_identity');}
   const lifecycle=loopStore.getLoopRunLifecycle(run.id);
   if(run.status==='failed'||run.status==='blocked')outcome=run.status;
   else if(run.status==='success')outcome='success';
   else if(lifecycle?.businessState==='publication_pending')outcome='publication_pending';
   else return {status:'retry_pending'};
   decision={loopRunId:run.id,loopStatus:outcome,...((previous?.mode??input.mode)==='reused'?{reused:true}:{}),...(run.nextActionKind?{nextActionKind:run.nextActionKind}:{}),...(run.nextActionSummary??run.message?{nextActionSummary:run.nextActionSummary??run.message}: {})};
  }
  const snapshot=()=>encoded({routes:owners.map(owner=>readInstalledCurrentOwner(owner)),definition:loopStore.getLoopDefinition(loopId),run:runId?loopStore.getLoopRun(runId):null,stages:runId?loopStore.listLoopStages(runId):[],basis:runId?loopStore.getLoopRunPublicationBasis(runId):null,configuration:loopStore.getLoopPublicationConfiguration(loopId),owners,candidates:runId?loopStore.listLoopPublicationCandidates(runId):[],members:runId?loopStore.listAssistantCandidates().filter(c=>c.runId===runId):[]});
  if(previous){
   const original=previous.loopIdentity?JSON.parse(previous.loopIdentity):null,actual=JSON.parse(snapshot());
   const pick=(value:Record<string,unknown>,keys:string[])=>Object.fromEntries(keys.map(key=>[key,value[key]??null]));
   const immutable=(value:any)=>({basis:value.basis??null,configuration:value.configuration??null,candidates:value.candidates??null,definition:value.definition?pick(value.definition,['id','origin','createdAt']):null,stages:value.stages.map((stage:any)=>pick(stage,['id','runId','loopId','stageKind','startedAt'])),members:value.members.map((member:any)=>pick(member,['id','runId','kind','title','content','scope','projectId','confidence','evidenceRefs','dedupeKey','createdAt']))});
   if(!original||encoded(immutable(original))!==encoded(immutable(actual)))throw Error('loop_timed_receipt_identity');
   for(let i=0;i<original.routes.length;i++){const prior=original.routes[i];if(prior.kind==='ordinary')continue;const index=actual.owners.findIndex((owner:any)=>encoded(owner)===encoded(original.owners[i]));const route=actual.routes[index];if(!route||route.kind==='ordinary'||prior.authorityId!==route.authorityId||encoded(prior.owner)!==encoded(route.owner))throw Error('loop_timed_receipt_identity');}
  }
  const loopIdentity=snapshot(),checkLoop=()=>{admit();if(snapshot()!==loopIdentity)throw Error('loop_timed_loop_changed');};
  const business=createLoopBusinessPublicationHost({store:loopStore,assertAdmission:admit,taskPort:options.taskPort});let ticket:object|undefined,completionInput:LoopCompletionRequest|undefined;
  try{
   if(outcome==='success'&&run){
    completionInput={runId:run.id,loopId:run.loopId,logicalRunKey:run.logicalRunKey??null,requestSource:'scheduler',signal};
    try{ticket=await business.prepareCompletedRun(completionInput);}catch{current();checkLoop();outcome='publication_pending';decision={...decision!,loopStatus:'publication_pending'};}
   }
   current();checkLoop();if(previous&&outcome!=='success')return {status:'retry_pending'};
   const token=Object.freeze({}),write:Write={loopId,target,previous,loopRunId:run?.id??null,mode:previous?.mode??input.mode,outcome,decision,loopIdentity,now:timestamp,check:current,consume(){current();checkLoop();const check=ticket&&completionInput?consumeLoopCompletedRun(loopStore,completionInput,ticket):()=>{};return()=>{checkLoop();check();};}};
   tickets.set(token,{store:timedStore,write});try{const receipt=timedStore.applyLoopTimedCompletion(token);return {status:'applied',disposition:receipt.disposition,outcome:receipt.outcome,receipt};}finally{tickets.delete(token);}
  }catch{const receipt=timedStore.getLoopTimedReceipt(input.timedRunId);if(receipt&&receipt.disposition!=='pending')return{status:'already_applied',disposition:receipt.disposition,outcome:receipt.outcome,receipt};return{status:'retry_pending'};}
  finally{await business.close();}
 }
 function finalize(input:Request):Promise<LoopTimedResult>{if(closed)return Promise.reject(Error('loop_timed_closed'));const work=execute(input);pending.add(work);void work.then(()=>pending.delete(work),()=>pending.delete(work));return work;}
 return Object.freeze({finalize,async reconcile(signal?:AbortSignal){for(const row of timedStore.listLoopTimedReconciliation()){if(closed||signal?.aborted)break;try{await finalize({actionId:row.actionId,timedRunId:row.timedRunId,mode:'stale',requestSource:'scheduler',...(signal?{signal}:{})});}catch{/* Keep the original durable population for the next tick. */}}},async close(){closed=true;lifetime.abort(Error('loop_timed_closed'));await Promise.allSettled([...pending]);}});
}
export type LoopTimedCompletionHost=ReturnType<typeof createLoopTimedCompletionHost>;
