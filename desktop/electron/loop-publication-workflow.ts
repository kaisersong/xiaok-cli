import {readInstalledCurrentOwner} from '../../src/runtime/verification/installed-owner-state.js';
import {createInstalledCompletionPublisher} from '../../src/runtime/verification/installed-completion-publication.js';
import {createInstalledLoopApplicationClient} from '../../src/runtime/verification/installed-loop-application.js';
import {loopHostSubjectOwner} from '../../src/runtime/verification/loop-host-subject.js';
import {canonicalVerificationJson as json} from '../../src/runtime/verification/protocol.js';
import {captureLoopProducerValue} from './loop-scan-publication-body.js';
import {parseLoopPublicationAttempt,publicationFields,publicationIdentity,loopPublicationTerminal,type LoopPublicationAttempt} from './loop-publication-attempt.js';
import type {LoopStore} from './loop-store.js';
type Source='user'|'agent'|'scheduler';
interface Start {nativeAttemptId:string;expectedLatestAttemptId:string|null;requestSource:Source;signal?:AbortSignal}
interface Recover {attemptId:string;requestSource:Source;signal?:AbortSignal}
interface Write {store:LoopStore;before:Readonly<LoopPublicationAttempt>;next:Readonly<LoopPublicationAttempt>;source:Source}
const writes=new WeakMap<object,Write>();
interface Coordinator {closed:boolean;work:Map<string,Promise<Readonly<LoopPublicationAttempt>>>;closing?:Promise<void>}
const coordinators=new WeakMap<LoopStore,Coordinator>();

/** Store-only consumption. No exported operation can mint a token from DTOs.
 * Burn before input accessors, source validation, CAS or a failing transaction. */
export function consumeLoopPublicationWrite(store:LoopStore,raw:unknown){
 if(!raw||typeof raw!=='object')throw Error('loop_publication_write_required');
 const descriptors=Object.getOwnPropertyDescriptors(raw),token=descriptors.ticket?.value;
 const entry=token&&typeof token==='object'?writes.get(token):undefined;
 if(token&&typeof token==='object')writes.delete(token);
 if(!entry||entry.store!==store)throw Error('loop_publication_write_required');
 if(Reflect.ownKeys(raw).some(k=>typeof k!=='string')||Object.values(descriptors).some(d=>!('value' in d)))throw Error('loop_publication_write_input');
 const {ticket:ignored,...fields}=descriptors;
 const input=captureLoopProducerValue(Object.fromEntries(Object.entries(fields).map(([key,d])=>[key,d.value])));
 publicationFields(input,['attemptId','expectedRevision','requestSource']);
 if(input.attemptId!==entry.before.attemptId||input.expectedRevision!==entry.before.revision||input.requestSource!==entry.source||!['user','scheduler'].includes(input.requestSource))throw Error('loop_publication_write_binding');
 return entry;
}
function captureAction(raw:Start|Recover,kind:'start'|'recover'){
 if(!raw||typeof raw!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))throw Error('loop_publication_workflow_input');
 const descriptors=Object.getOwnPropertyDescriptors(raw);
 if(Reflect.ownKeys(raw).some(k=>typeof k!=='string')||Object.values(descriptors).some(d=>!('value' in d)))throw Error('loop_publication_workflow_input');
 const {signal:s,...fields}=descriptors,input=captureLoopProducerValue(Object.fromEntries(Object.entries(fields).map(([key,d])=>[key,d.value])));
 publicationFields(input,kind==='start'?['nativeAttemptId','expectedLatestAttemptId','requestSource']:['attemptId','requestSource']);
 publicationIdentity(input[kind==='start'?'nativeAttemptId':'attemptId']);if(kind==='start'&&input.expectedLatestAttemptId!==null)publicationIdentity(input.expectedLatestAttemptId);
 if(!['user','scheduler'].includes(input.requestSource)||kind==='start'&&input.requestSource!=='user')throw Error('loop_publication_workflow_source');
 const signal=s?.value as AbortSignal|undefined;if(signal!==undefined&&!(signal instanceof AbortSignal))throw Error('loop_publication_workflow_signal');signal?.throwIfAborted();
 return {...input,signal} as unknown as Start&Recover;
}
function follow<T>(work:Promise<T>,signal?:AbortSignal):Promise<T>{
 if(!signal)return work;if(signal.aborted)return Promise.reject(signal.reason);
 return new Promise((resolve,reject)=>{const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason);};signal.addEventListener('abort',abort,{once:true});
  void work.then(value=>{signal.removeEventListener('abort',abort);if(signal.aborted)reject(signal.reason);else resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});});
}

/** Main-owned original request lifecycle. Only fixed installed responses mint
 * journal tokens; neither a terminal row nor an observation grants completion. */
export function createLoopPublicationWorkflow(options:{store:LoopStore;assertAdmission:()=>void;now?:()=>number}){
 const store=options.store,admission=options.assertAdmission,now=options.now??Date.now;
 const getTarget=store.getLoopNativeAttemptTarget.bind(store),get=store.getLoopPublicationAttempt.bind(store),list=store.listLoopPublicationAttempts.bind(store),reserve=store.reserveLoopPublicationAttempt.bind(store),advance=store.advanceLoopPublicationAttempt.bind(store),assertCurrent=store.assertLoopNativeAttemptCurrent.bind(store);
 let coordinator=coordinators.get(store);if(!coordinator){coordinator={closed:false,work:new Map()};coordinators.set(store,coordinator);}const owner=coordinator;
 function ingress(){if(owner.closed)throw Error('loop_publication_workflow_closed');}
 function admit(){ingress();const result:unknown=admission();if(result!==undefined){void Promise.resolve(result).catch(()=>{});throw Error('loop_publication_admission_sync');}ingress();}
 function tracked(row:Readonly<LoopPublicationAttempt>,source:Source,signal:AbortSignal|undefined,fresh:boolean){
  admit();const existing=owner.work.get(row.attemptId);if(existing)return follow(existing,signal);
  // Register before running any callback or starting any RPC.
  const work=Promise.resolve().then(()=>run(row,source,signal,fresh));owner.work.set(row.attemptId,work);
  const done=()=>{if(owner.work.get(row.attemptId)===work)owner.work.delete(row.attemptId);};void work.then(done,done);return work;
 }
 async function run(initial:Readonly<LoopPublicationAttempt>,source:Source,signal:AbortSignal|undefined,fresh:boolean){
  signal?.throwIfAborted();admit();let row=initial;
  const target=getTarget(row.nativeAttemptId);
  let publisher:ReturnType<typeof createInstalledCompletionPublisher>|undefined,application:ReturnType<typeof createInstalledLoopApplicationClient>|undefined;
  function routeCurrent(){signal?.throwIfAborted();if(row.routeJson===null||json(readInstalledCurrentOwner(loopHostSubjectOwner(target.binding.subject)))!==row.routeJson)throw Error('loop_publication_workflow_route_changed');}
  function current(){signal?.throwIfAborted();admit();if(row.routeJson!==null)routeCurrent();assertCurrent(row.nativeAttemptId);if(json(get(row.attemptId))!==json(row))throw Error('loop_publication_attempt_conflict');}
  async function binding(){current();application??=createInstalledLoopApplicationClient(target.binding,'scheduler');const result=await application.inspect(signal);current();
   if(result.state!=='active'||result.pendingTransitionId!==null||result.pendingTarget!==null||json(result.current?.binding)!==json(target.binding))throw Error('loop_publication_workflow_application');}
  function save(changes:Pick<LoopPublicationAttempt,'status'>&Partial<Pick<LoopPublicationAttempt,'challenge'|'observation'|'retirement'|'routeJson'>>){
   const timestamp=Math.max(now(),row.updatedAt);signal?.throwIfAborted();if(row.routeJson!==null)routeCurrent();else if(changes.routeJson!==json(readInstalledCurrentOwner(loopHostSubjectOwner(target.binding.subject))))throw Error('loop_publication_workflow_route_changed');if(changes.status==='authorizing')current();
   const next=parseLoopPublicationAttempt({...row,...changes,revision:row.revision+1,updatedAt:timestamp},getTarget(row.nativeAttemptId));
   const token=Object.freeze({});writes.set(token,{store,before:row,next,source});
   try{row=advance({attemptId:row.attemptId,expectedRevision:row.revision,requestSource:source,ticket:token});return row;}finally{writes.delete(token);}
  }
  try{
   if(loopPublicationTerminal(row))return row;
   if(row.routeJson===null){if(fresh)current();const route=readInstalledCurrentOwner(loopHostSubjectOwner(target.binding.subject));save({status:'preparing',routeJson:json(route)});}
   routeCurrent();if(fresh)await binding();
   publisher=createInstalledCompletionPublisher(loopHostSubjectOwner(target.binding.subject),row.requestSource);routeCurrent();
   if(!fresh){
    const result=await publisher.recoverRequest(row.attemptId,signal);routeCurrent();
    if(result.status==='not_prepared')return save({status:'not_prepared',retirement:result});
    // Validate all recovered facts before persisting even the challenge.
    const validated=parseLoopPublicationAttempt({...row,status:'not_approved',challenge:result.challenge,observation:null,retirement:{...result,status:'not_approved'}},target);
    if(row.challenge&&json(row.challenge)!==json(validated.challenge))throw Error('loop_publication_challenge_changed');
    if(result.status==='not_approved')return save({status:'not_approved',challenge:result.challenge,retirement:result});
    if(!row.challenge)save({status:'prepared',challenge:result.challenge});
    admit();routeCurrent();const observed=await publisher.reconcile(result.challenge,signal);routeCurrent();
    if(json(observed.owner)!==json(result.owner)||observed.operationId!==result.operationId||observed.fullTupleHash!==result.fullTupleHash)throw Error('loop_publication_recovery_changed');
    return save({status:observed.status==='unknown'?'pending':observed.status,observation:observed});
   }
   current();const original=await publisher.prepareRequest(row.attemptId,signal);routeCurrent();save({status:'prepared',challenge:original});
   await binding();save({status:'authorizing'});await binding();current();
   const observed=await publisher.approve(original,signal);routeCurrent();
   return save({status:observed.status==='unknown'?'pending':observed.status,observation:observed});
  }finally{try{publisher?.dispose();}finally{application?.dispose();}}
 }
 return Object.freeze({
  start(raw:Start):Promise<Readonly<LoopPublicationAttempt>>{
   try{const input=captureAction(raw,'start');ingress();const target=getTarget(input.nativeAttemptId),previous=list(target.attempt.candidateId).at(-1);
    if((previous?.attemptId??null)!==input.expectedLatestAttemptId)throw Error('loop_publication_attempt_conflict');
    if(previous&&!loopPublicationTerminal(previous)){
     if(previous.nativeAttemptId!==input.nativeAttemptId)throw Error('loop_publication_attempt_target');return tracked(previous,input.requestSource,input.signal,false);
    }
    if(previous&&previous.nativeAttemptId!==input.nativeAttemptId&&previous.status!=='committed')throw Error('loop_publication_attempt_target');
    if(previous?.status==='committed'&&previous.nativeAttemptId===input.nativeAttemptId)return Promise.resolve(previous);
    const timestamp=now();admit();const row=reserve({nativeAttemptId:input.nativeAttemptId,expectedLatestAttemptId:input.expectedLatestAttemptId,requestSource:input.requestSource,now:timestamp});
    return tracked(row,input.requestSource,input.signal,true);
   }catch(error){return Promise.reject(error);}
  },
  recover(raw:Recover):Promise<Readonly<LoopPublicationAttempt>>{
   try{const input=captureAction(raw,'recover');ingress();const row=get(input.attemptId);if(!row)throw Error('loop_publication_attempt_missing');return tracked(row,input.requestSource,input.signal,false);}catch(error){return Promise.reject(error);}
  },
  close():Promise<void>{
   if(!owner.closing){owner.closed=true;owner.closing=Promise.allSettled([...owner.work.values()]).then(()=>{if(coordinators.get(store)===owner)coordinators.delete(store);});}return owner.closing;
  },
 });
}
