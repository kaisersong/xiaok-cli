import {readCurrentLoopPublishedCandidate,isLoopPublicationNotCurrent,type CurrentLoopPublishedCandidate} from '../../src/runtime/loop/published-candidate.js';
import {readCurrentLoopPublicationSet,isLoopPublicationSetNotCurrent,type CurrentLoopPublicationSet} from '../../src/runtime/loop/published-set.js';
import {completionConsumerOwner} from '../../src/runtime/verification/completion-consumer-owner.js';
import {readInstalledCurrentOwner} from '../../src/runtime/verification/installed-owner-state.js';
import {loopHostSubjectOwner} from '../../src/runtime/verification/loop-host-subject.js';
import {canonicalVerificationJson as json} from '../../src/runtime/verification/protocol.js';
import {captureLoopProducerValue} from './loop-scan-publication-body.js';
import {publicationFields,publicationIdentity} from './loop-publication-attempt.js';
import type {LoopStore} from './loop-store.js';
import type {TaskSnapshot} from '../../src/runtime/task-host/types.js';
import type {LoopBusinessProjectionTarget,LoopBusinessProjection} from './loop-business-projection.js';
import type {AssistantCandidatePromotionTargets,AssistantPromotionTargetInput} from './assistant-candidate-promotion.js';
import {parseAssistantPromotionIntent,type AssistantPromotionIntent} from './assistant-promotion-intent.js';
import type {LoopCandidateBody} from '../../src/runtime/verification/loop-application-binding.js';
import {freezeProjection,type LoopProjectionRows} from './loop-business-projection.js';
import type {AssistantCandidate} from './assistant-types.js';
const negativeCompletionReads=new WeakSet<Error>();
function completionNotCurrent(message:string,cause?:unknown):Error{const error=Error(message,{cause});negativeCompletionReads.add(error);return error;}
export function isLoopCompletionNotCurrent(error:unknown):error is Error{return error instanceof Error&&negativeCompletionReads.has(error);}
async function completionCandidateRead<T>(read:()=>Promise<T>):Promise<T>{try{return await read();}catch(error){if(isLoopPublicationNotCurrent(error)||isLoopPublicationSetNotCurrent(error))throw completionNotCurrent(error.message,error);throw error;}}
const memberJson=(value:unknown)=>json(value===undefined?null:JSON.parse(JSON.stringify(value)));
type Source='user'|'agent'|'scheduler';
interface Action {runId:string;requestSource:Source;signal?:AbortSignal}
export interface LoopBusinessInspection {runId:string;businessState:'success';observation:Readonly<CurrentLoopPublicationSet>}
type Result=Readonly<LoopBusinessProjection>|Readonly<LoopBusinessInspection>;
export interface LoopCompletionRequest extends Action {loopId:string;logicalRunKey:string|null}
interface CompletionRead {store:LoopStore;request:Readonly<LoopCompletionRequest>;check():void}
const completions=new WeakMap<object,CompletionRead>();
function captureCompletionRequest(raw:LoopCompletionRequest):Readonly<LoopCompletionRequest>{
 const d=Object.getOwnPropertyDescriptors(raw);
 if(Reflect.ownKeys(raw).some(k=>typeof k!=='string')||Object.values(d).some(v=>!('value'in v)))throw Error('loop_completion_input');
 const {signal:s,...rest}=d,input=captureLoopProducerValue(Object.fromEntries(Object.entries(rest).map(([k,v])=>[k,v.value])));
 publicationFields(input,['runId','loopId','logicalRunKey','requestSource']);publicationIdentity(input.runId);publicationIdentity(input.loopId);
 if(input.logicalRunKey!==null&&(typeof input.logicalRunKey!=='string'||!input.logicalRunKey||input.logicalRunKey.trim()!==input.logicalRunKey||input.logicalRunKey.length>4096))throw Error('loop_completion_logical_key');
 if(!['user','scheduler'].includes(input.requestSource))throw Error('loop_completion_source');const signal=s?.value;
 if(signal!==undefined&&!(signal instanceof AbortSignal))throw Error('loop_completion_signal');signal?.throwIfAborted();
 return Object.freeze({...input,...(signal?{signal}:{})}) as Readonly<LoopCompletionRequest>;
}
/** Single read consumption, never a business publication or durable write ticket. */
export function consumeLoopCompletedRun(store:LoopStore,raw:LoopCompletionRequest,token:object):()=>void{
 const entry=completions.get(token);completions.delete(token);
 if(!entry||entry.store!==store)throw Error('loop_completion_ticket');
 const input=captureCompletionRequest(raw),original=entry.request;
 if(input.runId!==original.runId||input.loopId!==original.loopId||input.logicalRunKey!==original.logicalRunKey||input.requestSource!==original.requestSource||input.signal!==original.signal)throw Error('loop_completion_ticket');
 entry.check();return entry.check;
}
interface ProjectionWrite {store:LoopStore;target:Readonly<LoopBusinessProjectionTarget>;observation:Readonly<CurrentLoopPublicationSet>;now:number;source:Source;signal:AbortSignal}
type PromotionTarget=Readonly<Pick<LoopBusinessProjectionTarget,'runId'|'vector'|'rows'>>;
interface PromotionWrite {store:LoopStore;mode:'ordinary'|'protected';target:PromotionTarget;before:Readonly<AssistantPromotionIntent>|undefined;after:Readonly<AssistantPromotionIntent>;member:AssistantCandidate;source:Source;signal:AbortSignal;check():void}
const promotions=new WeakMap<object,PromotionWrite>();
export function consumeAssistantPromotionWrite(store:LoopStore,token:object):PromotionWrite{const entry=promotions.get(token);promotions.delete(token);if(!entry||entry.store!==store)throw Error('assistant_promotion_ticket');entry.signal.throwIfAborted();return entry;}
const writes=new WeakMap<object,ProjectionWrite>();
export function consumeLoopBusinessProjection(store:LoopStore,raw:unknown):ProjectionWrite{
 if(!raw||typeof raw!=='object')throw Error('loop_projection_ticket');const d=Object.getOwnPropertyDescriptors(raw),token=d.ticket?.value,entry=token&&typeof token==='object'?writes.get(token):undefined;
 if(token&&typeof token==='object')writes.delete(token);
 if(!entry||entry.store!==store)throw Error('loop_projection_ticket');
 if(Reflect.ownKeys(raw).some(k=>typeof k!=='string')||Object.values(d).some(v=>!('value' in v)))throw Error('loop_projection_input');
 const {ticket:_,...rest}=d,value=captureLoopProducerValue(Object.fromEntries(Object.entries(rest).map(([k,v])=>[k,v.value])));publicationFields(value,['runId','requestSource']);
 if(value.runId!==entry.target.runId||value.requestSource!==entry.source)throw Error('loop_projection_ticket');entry.signal.throwIfAborted();return entry;
}
/** Fixed Main receiver readers are the only token issuers. A returned journal
 * remains historical data; future consumers need a new current observation. */
export function createLoopBusinessPublicationHost(options:{store:LoopStore;assertAdmission():void;now?:()=>number;taskPort?:{recoverTask(taskId:string):Promise<TaskSnapshot|undefined>};assistantTargets?:AssistantCandidatePromotionTargets;assistantProjectCwd?:(projectId:string)=>string|undefined}){
 const store=options.store,admission=options.assertAdmission.bind(options),now=options.now??Date.now,read=store.getLoopBusinessProjectionTarget.bind(store),apply=store.applyLoopBusinessProjection.bind(store),recover=options.taskPort?.recoverTask.bind(options.taskPort);
 const lifetime=new AbortController(),pending=new Set<Promise<unknown>>();let closed=false,closing:Promise<void>|undefined;
 function admit(){if(closed)throw Error('loop_projection_closed');const result:unknown=admission();if(result!==undefined){void Promise.resolve(result).catch(()=>{});throw Error('loop_projection_admission_sync');}if(closed)throw Error('loop_projection_closed');}
 const targetPorts=options.assistantTargets?Object.freeze({ensureMemory:options.assistantTargets.ensureMemory.bind(options.assistantTargets),ensureKnowledge:options.assistantTargets.ensureKnowledge.bind(options.assistantTargets),ensureFollowUp:options.assistantTargets.ensureFollowUp.bind(options.assistantTargets)}):undefined,projectCwd=options.assistantProjectCwd?.bind(options);
 async function project(runId:string,source:Source,signal:AbortSignal|undefined,inspection:boolean,consume?:(target:Readonly<LoopBusinessProjectionTarget>,active:AbortSignal,current:()=>void,guard:()=>void,payloads:readonly Readonly<CurrentLoopPublishedCandidate>[])=>unknown):Promise<any>{
  const active=signal?AbortSignal.any([signal,lifetime.signal]):lifetime.signal;active.throwIfAborted();admit();const target=read(runId),routes=target.candidates.map(c=>json(readInstalledCurrentOwner(loopHostSubjectOwner(c.binding.subject))));
  function current(){active.throwIfAborted();admit();if(read(runId).vector!==target.vector||target.candidates.some((c,i)=>json(readInstalledCurrentOwner(loopHostSubjectOwner(c.binding.subject)))!==routes[i]))throw completionNotCurrent('loop_projection_changed');active.throwIfAborted();}
  for(const expected of target.executions){if(!recover)throw Error('loop_projection_task_reader_required');const actual=await recover(expected.taskId);current();if(!actual||actual.status!=='completed'||json(actual)!==json(expected))throw completionNotCurrent('loop_projection_task_changed');}
  const payloads:Readonly<CurrentLoopPublishedCandidate>[]=[];
  for(let i=0;i<target.candidates.length;i++){
   const result=await completionCandidateRead(()=>readCurrentLoopPublishedCandidate(target.candidates[i].binding,active));current();const original=target.publications[i].observation!;
   if(result.operationId!==original.operationId||result.businessRevision!==original.businessRevision||result.fullTupleHash!==original.fullTupleHash||json(result.owner)!==json(original.owner))throw completionNotCurrent('loop_projection_publication_changed');payloads.push(result);
  }
  const observation=await completionCandidateRead(()=>readCurrentLoopPublicationSet(target.candidates.map(c=>c.binding),active));current();
  if(observation.publications.length!==payloads.length||observation.publications.some((p,i)=>json(p)!==json({owner:payloads[i].owner,businessRevision:payloads[i].businessRevision,operationId:payloads[i].operationId,fullTupleHash:payloads[i].fullTupleHash,application:payloads[i].application})))throw completionNotCurrent('loop_projection_publication_changed');
  if(consume)return consume(target,active,current,()=>{active.throwIfAborted();admit();if(target.candidates.some((c,i)=>json(readInstalledCurrentOwner(loopHostSubjectOwner(c.binding.subject)))!==routes[i]))throw completionNotCurrent('loop_projection_changed');active.throwIfAborted();},payloads);
  if(inspection)return Object.freeze({runId,businessState:'success' as const,observation});
  const timestamp=now();current();const token=Object.freeze({});writes.set(token,{store,target,observation,now:timestamp,source,signal:active});
  try{return apply({ticket:token,runId,requestSource:source});}finally{writes.delete(token);}
 }
 function act(raw:Action,inspection:boolean):Promise<Result>{
  try{const d=Object.getOwnPropertyDescriptors(raw);if(Reflect.ownKeys(raw).some(k=>typeof k!=='string')||Object.values(d).some(v=>!('value' in v)))throw Error('loop_projection_input');const {signal:s,...rest}=d,input=captureLoopProducerValue(Object.fromEntries(Object.entries(rest).map(([k,v])=>[k,v.value])));publicationFields(input,['runId','requestSource']);publicationIdentity(input.runId);if(!['user','scheduler'].includes(input.requestSource))throw Error('loop_projection_source');const signal=s?.value as AbortSignal|undefined;if(signal!==undefined&&!(signal instanceof AbortSignal))throw Error('loop_projection_signal');admit();const work=Promise.resolve().then(()=>project(input.runId,input.requestSource,signal,inspection));pending.add(work);void work.then(()=>pending.delete(work),()=>pending.delete(work));return work;}catch(e){return Promise.reject(e);}
 }
 function track<T>(work:Promise<T>):Promise<T>{pending.add(work);void work.then(()=>pending.delete(work),()=>pending.delete(work));return work;}
 function prepareCompletedRun(raw:LoopCompletionRequest):Promise<object>{
  try{
   const input=captureCompletionRequest(raw);admit();
   return track(Promise.resolve().then(async()=>{
    const active=input.signal?AbortSignal.any([input.signal,lifetime.signal]):lifetime.signal;
    const subject=()=>{
     active.throwIfAborted();
     const run=store.getLoopRun(input.runId),definition=store.getLoopDefinition(input.loopId);
     if(!run||run.status!=='success'||run.loopId!==input.loopId||(run.logicalRunKey??null)!==input.logicalRunKey||definition?.status!=='active')throw completionNotCurrent('loop_completion_subject');
    };
    const issue=(check:()=>void)=>{subject();check();const token=Object.freeze({});completions.set(token,{store,request:input,check:()=>{subject();check();}});return token;};
    subject();
    const rootOwner=completionConsumerOwner({ownerKind:'loop_run',ownerId:input.runId});
    const initialRoute=readInstalledCurrentOwner(rootOwner);
    if(initialRoute.kind==='unavailable')throw completionNotCurrent('loop_completion_unavailable');
    if(store.getLoopRunPublicationBasis(input.runId)||store.getLoopPublicationConfiguration(input.loopId)||initialRoute.kind!=='ordinary'){
     return project(input.runId,input.requestSource,input.signal,true,(_target,_active,current)=>issue(current));
    }
    const snapshot=()=>memberJson({run:store.getLoopRun(input.runId),definition:store.getLoopDefinition(input.loopId),stages:store.listLoopStages(input.runId),members:store.listAssistantCandidates().filter(c=>c.runId===input.runId),profile:store.getAssistantProfile('default-personal-assistant'),basis:store.getLoopRunPublicationBasis(input.runId),configuration:store.getLoopPublicationConfiguration(input.loopId)});
    const original=snapshot(),owners=[rootOwner,...store.listLoopStages(input.runId).map(stage=>completionConsumerOwner({ownerKind:'loop_stage',ownerId:stage.id}))];
    const routes=owners.map(owner=>readInstalledCurrentOwner(owner));if(routes.some(route=>route.kind!=='ordinary'))throw completionNotCurrent('loop_completion_required');
    return issue(()=>{admit();active.throwIfAborted();if(snapshot()!==original||owners.some((owner,i)=>json(readInstalledCurrentOwner(owner))!==json(routes[i])))throw completionNotCurrent('loop_completion_changed');});
   }));
  }catch(error){return Promise.reject(error);}
 }
 function promotionAction(raw:{candidateId:string;collectionId?:string;requestSource:Source;signal?:AbortSignal},recovery:boolean):Promise<AssistantCandidate>{
  try{
   const d=Object.getOwnPropertyDescriptors(raw);if(Reflect.ownKeys(raw).some(k=>typeof k!=='string')||Object.values(d).some(v=>!('value'in v)))throw Error('assistant_promotion_input');
   const {signal:s,...rest}=d,input=captureLoopProducerValue(Object.fromEntries(Object.entries(rest).map(([k,v])=>[k,v.value])));
   publicationFields(input,['candidateId','requestSource',...(Object.hasOwn(input,'collectionId')?['collectionId']:[])]);publicationIdentity(input.candidateId);
   if(recovery&&Object.hasOwn(input,'collectionId'))throw Error('assistant_promotion_input');
   if(input.collectionId!==undefined)publicationIdentity(input.collectionId);
   if(input.requestSource!=='user'&&!(recovery&&input.requestSource==='scheduler'))throw Error('assistant_candidate_user_only');
   const signal=s?.value as AbortSignal|undefined;if(signal!==undefined&&!(signal instanceof AbortSignal))throw Error('assistant_promotion_signal');
   admit();if(!targetPorts)throw Error('assistant_promotion_targets');
   return track(Promise.resolve().then(async()=>{
    const member=store.getAssistantCandidate(input.candidateId);if(!member)throw Error('assistant_candidate_not_found');
    const mode=store.getAssistantCandidatePublicationMode(member.id);
    const readPromotion=()=>mode==='ordinary'?store.getOrdinaryAssistantPromotionTarget(member.id):read(member.runId);
    type Consumer=(target:PromotionTarget,active:AbortSignal,current:()=>void,guard:()=>void)=>unknown;
    const inspectPromotion=async(consume:Consumer)=>{
     if(mode==='protected')return project(member.runId,input.requestSource,signal,true,(target,active,current,guard)=>{if(!target.projection)throw Error('assistant_promotion_member');return consume(target,active,current,guard);});
     const active=signal?AbortSignal.any([signal,lifetime.signal]):lifetime.signal;
     const guard=()=>{active.throwIfAborted();admit();if(store.getAssistantCandidatePublicationMode(member.id)!=='ordinary')throw Error('assistant_promotion_changed');active.throwIfAborted();};
     guard();const target=readPromotion();
     const current=()=>{guard();if(readPromotion().vector!==target.vector)throw Error('assistant_promotion_changed');active.throwIfAborted();};
     current();return consume(target,active,current,guard);
    };
    const prior=store.getAssistantPromotionIntent(member.id);
    if(recovery&&!prior)throw Error('assistant_promotion_intent_missing');
    if(prior&&input.collectionId!==undefined&&input.collectionId!==prior.target.collectionId)throw Error('assistant_promotion_target_conflict');
    let intent:Readonly<AssistantPromotionIntent>;let readyVector:string,original:AssistantCandidate;let recheck:()=>void;
    await inspectPromotion((target,active,current,guard)=>{
     const actual=store.getAssistantCandidate(member.id);if(memberJson(actual)!==memberJson(member))throw Error('assistant_promotion_changed');
     if(!target.rows.members.some(m=>m.id===member.id))throw Error('assistant_promotion_member');
     if(prior){if(json(store.getAssistantPromotionIntent(member.id))!==json(prior))throw Error('assistant_promotion_changed');intent=prior;current();readyVector=readPromotion().vector;original=store.getAssistantCandidate(member.id)!;recheck=guard;return;}
     if(!['pending','accept_failed'].includes(member.status))throw Error('assistant_promotion_intent_missing');
     if(member.kind==='knowledge'&&!input.collectionId)throw Error('assistant_candidate_collection_required');
     const cwd=member.projectId?projectCwd?.(member.projectId):undefined;
     if(member.kind==='memory'&&member.scope==='project'&&(!member.projectId||!cwd))throw Error('assistant_candidate_project_cwd_required');
     const targetInput:AssistantPromotionTargetInput={candidateId:member.id,loopRunId:member.runId,targetId:`assistant-${member.kind==='memory'?'memory':member.kind==='knowledge'?'source':'follow-up'}:${member.id}`,title:member.title,content:member.content,scope:member.scope,...(member.projectId?{projectId:member.projectId}:{}),...(cwd?{projectCwd:cwd}:{}),...(input.collectionId?{collectionId:input.collectionId}:{}),provenance:{kind:'assistant_candidate',candidateId:member.id,loopRunId:member.runId,evidenceRefs:member.evidenceRefs.map(r=>({...r}))}};
     const time=now();intent=parseAssistantPromotionIntent({candidateId:member.id,runId:member.runId,revision:1,source:'user',state:'accepting',target:targetInput,targetRef:null,createdAt:time,updatedAt:time});current();
     const token=Object.freeze({});promotions.set(token,{store,mode,target,before:undefined,after:intent,member,source:input.requestSource,signal:active,check:guard});try{store.applyAssistantPromotionWrite(token);}finally{promotions.delete(token);}
     readyVector=readPromotion().vector;original=store.getAssistantCandidate(member.id)!;recheck=guard;
    });

    const active=signal?AbortSignal.any([signal,lifetime.signal]):lifetime.signal;
    active.throwIfAborted();recheck!();
    if(readPromotion().vector!==readyVector!)throw Error('assistant_promotion_changed');
    if(json(store.getAssistantPromotionIntent(member.id))!==json(intent!)||memberJson(store.getAssistantCandidate(member.id))!==memberJson(original!))throw Error('assistant_promotion_changed');
    if(intent!.state==='accepted')return store.getAssistantCandidate(member.id)!;
    const result=await (member.kind==='memory'?targetPorts.ensureMemory:member.kind==='knowledge'?targetPorts.ensureKnowledge:targetPorts.ensureFollowUp)(intent!.target);
    if(!result||typeof result.targetRef!=='string'||!result.targetRef)throw Error('assistant_promotion_target');
    await inspectPromotion((target,active,current,guard)=>{
     if(target.vector!==readyVector!)throw Error('assistant_promotion_changed');
     if(memberJson(store.getAssistantCandidate(member.id))!==memberJson(original!)||json(store.getAssistantPromotionIntent(member.id))!==json(intent!))throw Error('assistant_promotion_changed');
     const time=now(),after=parseAssistantPromotionIntent({...intent!,revision:intent!.revision+1,state:'accepted',targetRef:result.targetRef,updatedAt:time});current();
     const token=Object.freeze({});promotions.set(token,{store,mode,target,before:intent!,after,member:original!,source:input.requestSource,signal:active,check:guard});try{store.applyAssistantPromotionWrite(token);}finally{promotions.delete(token);}
    });return store.getAssistantCandidate(member.id)!;
   }));
  }catch(e){return Promise.reject(e);}
 }
 function readUserTemplateOutput(raw:Action){
  try{
   const d=Object.getOwnPropertyDescriptors(raw);
   if(Reflect.ownKeys(raw).some(k=>typeof k!=='string')||Object.values(d).some(v=>!('value'in v)))throw Error('loop_output_input');
   const {signal:s,...rest}=d,input=captureLoopProducerValue(Object.fromEntries(Object.entries(rest).map(([k,v])=>[k,v.value])));
   publicationFields(input,['runId','requestSource']);publicationIdentity(input.runId);if(input.requestSource!=='user')throw Error('loop_output_source');
   const signal=s?.value;if(signal!==undefined&&!(signal instanceof AbortSignal))throw Error('loop_output_signal');admit();
   return track(Promise.resolve().then(()=>project(input.runId,'user',signal,true,(target,_active,current,_guard,payloads)=>{
    const index=target.candidates.findIndex(c=>c.stageId===null),root=target.candidates[index];
    if(!root||root.binding.contract.kind!=='user-template'||root.binding.body.kind!=='user-template'||!target.projection)throw Error('loop_output_publication');
    current();return Object.freeze({binding:root.binding,payload:payloads[index],assertCurrent:current});
   }))) as Promise<Readonly<{binding:CurrentLoopPublishedCandidate['binding'];payload:Readonly<CurrentLoopPublishedCandidate>;assertCurrent():void}>>;
  }catch(error){return Promise.reject(error);}
 }
 function readAssistantOutput(raw:Action):Promise<Readonly<{runId:string;vector:string;rows:LoopProjectionRows;body:Readonly<LoopCandidateBody>}>>{
  try{const d=Object.getOwnPropertyDescriptors(raw);if(Reflect.ownKeys(raw).some(k=>typeof k!=='string')||Object.values(d).some(v=>!('value'in v)))throw Error('loop_projection_input');const {signal:s,...rest}=d,input=captureLoopProducerValue(Object.fromEntries(Object.entries(rest).map(([k,v])=>[k,v.value])));publicationFields(input,['runId','requestSource']);publicationIdentity(input.runId);if(!['user','scheduler'].includes(input.requestSource))throw Error('loop_projection_source');const signal=s?.value;if(signal!==undefined&&!(signal instanceof AbortSignal))throw Error('loop_projection_signal');admit();return track(Promise.resolve().then(()=>project(input.runId,input.requestSource,signal,true,(target,_active,current)=>{const root=target.candidates.find(c=>c.stageId===null);if(!root||!['assistant-evening','assistant-morning'].includes(root.binding.body.kind))throw Error('assistant_publication_body');current();return freezeProjection({runId:input.runId,vector:target.vector,rows:target.rows,body:root.binding.body});})));}catch(e){return Promise.reject(e);}
 }
 return Object.freeze({prepareCompletedRun,readUserTemplateOutput,acceptAssistantCandidate(raw:{candidateId:string;collectionId?:string;requestSource:Source;signal?:AbortSignal}){return promotionAction(raw,false);},recoverAssistantCandidate(raw:{candidateId:string;requestSource:Source;signal?:AbortSignal}){return promotionAction(raw,true);},readAssistantOutput,project(raw:Action){return act(raw,false) as Promise<Readonly<LoopBusinessProjection>>;},inspect(raw:Action){return act(raw,true) as Promise<Readonly<LoopBusinessInspection>>;},close(){if(!closing){closed=true;lifetime.abort();closing=Promise.allSettled([...pending]).then(()=>{});}return closing;}});
}
