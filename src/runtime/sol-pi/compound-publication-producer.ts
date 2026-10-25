import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {computeSessionHistoryDigest} from '../../ai/runtime/session-store/store.js';
import type {AgentSessionState} from '../../ai/runtime/session.js';
import {getCompoundPublicationOwnerBinding} from './compound-managed-lifecycle.js';
import {getObservationSessionOwnerHostBinding,type ObservationSessionOwner} from './observation-session-owner.js';
import {createProducerWindowQueue,type ProducerQueueScope} from './producer-window-queue.js';
import {inspectConsumedCompoundProviderAttempt,type ProviderAncestorAdmission,type ProviderAncestorAttempt,type ProviderAncestorAttemptFacts} from './compound-provider-admission.js';

export interface CompoundFinalPublicationTicket {readonly opaqueCompoundFinalPublicationTicket:never}
type OwnerBinding=NonNullable<ReturnType<typeof getCompoundPublicationOwnerBinding>>;
type Queue=ReturnType<typeof createProducerWindowQueue>;
interface Producer {owner:ObservationSessionOwner;binding:OwnerBinding;queue:Queue;scope:ProducerQueueScope;turnId:string;producerId:string;kind:'iteration'|'publication';open:boolean;ticket?:CompoundFinalPublicationTicket}
interface FinalPublication {
 readonly facts:Readonly<{session:AgentSessionState;sessionId:string;rootSessionId:string;role:'root'|'child';turnId:string;producerId:string;historyDigest:string}>;
 readonly producer:Producer;
 readonly continuation:ReturnType<Queue['transfer']>;
}
const queues=new WeakMap<object,Queue>(),currentProducer=new AsyncLocalStorage<Producer>();
const finalPublications=new WeakMap<object,FinalPublication>();
type MetadataOrigin=Readonly<{session:AgentSessionState;nativeInvocationId:string}>;
const activeProducers=new WeakMap<object,Set<Producer>>();
const windowOrigins=new WeakMap<object,{producers:ReadonlySet<Producer>;origin:MetadataOrigin;active:boolean}>();
function track(producer:Producer){let set=activeProducers.get(producer.binding.tree);if(!set)activeProducers.set(producer.binding.tree,set=new Set());set.add(producer);}
function closeProducer(producer:Producer){producer.open=false;activeProducers.get(producer.binding.tree)?.delete(producer);}
/** Only an original still-open producer captured before admission closed can
 * carry this origin. The lifecycle separately validates the actual metadata row. */
export function getCompoundPublicationWindowOrigin(tree:object):MetadataOrigin|undefined{
 const producer=currentProducer.getStore(),window=windowOrigins.get(tree);
 return producer?.open&&producer.binding.tree===tree&&window?.active&&window.producers.has(producer)?window.origin:undefined;
}
interface Handoff {owner:ObservationSessionOwner;entry:NonNullable<ReturnType<typeof actual>>;window:ReturnType<Queue['closeAdmission']>;turnId?:string;producer?:Producer;iterationStarted:boolean;released:boolean;finished:ReturnType<typeof deferred>;input:ReturnType<typeof deferred>;signal?:AbortSignal}
const handoffs=new WeakMap<ObservationSessionOwner,Handoff>();
function deferred(){let resolve!:()=>void,reject!:(error:unknown)=>void;const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});void promise.catch(()=>{});return{promise,resolve,reject};}
interface FinalReceiptFacts {ticket:CompoundFinalPublicationTicket;sessionId:string;turnId:string;historyDigest:string;snapshotRevision:number}
interface FinalConsumer {
 register(ticket:CompoundFinalPublicationTicket,notify:(receipt:unknown)=>Promise<void>):Promise<void>;
 inspectReceipt(receipt:unknown):Readonly<FinalReceiptFacts>;
}
const consumers=new WeakMap<ObservationSessionOwner,{turnId:string;consumer:Readonly<FinalConsumer>;used:boolean;settled:boolean;completion:ReturnType<typeof deferred>}>();
/** Fixed main/runtime factory port. Neither registrar nor inspector is exposed
 * on tools, session snapshots or transport options. A previous turn must finish
 * its original receipt before this actual owner can bind a new consumer. */
export function bindCompoundFinalPublicationConsumer(owner:ObservationSessionOwner,turnId:string,consumer:FinalConsumer):void{
 const entry=actual(owner);if(!entry)throw Error('compound_producer_owner_required');
 const previous=consumers.get(owner);
 if(!turnId||previous&&!previous.settled)throw Error('compound_final_consumer_already_bound');
 const register=Object.getOwnPropertyDescriptor(consumer,'register')?.value,inspectReceipt=Object.getOwnPropertyDescriptor(consumer,'inspectReceipt')?.value;
 if(typeof register!=='function'||typeof inspectReceipt!=='function'||inspectReceipt.constructor?.name==='AsyncFunction')throw Error('compound_final_consumer_invalid');
 consumers.set(owner,{turnId,consumer:Object.freeze({register,inspectReceipt}),used:false,settled:false,completion:deferred()});
}
/** Actual root factory admission: wait only for this owner's previous Host tail.
 * Cancelling a new waiter never completes or replaces the original producer. */
export async function waitForCompoundFinalPublication(owner:ObservationSessionOwner,signal?:AbortSignal):Promise<void>{
 const entry=actual(owner);if(!entry)return;
 const previous=consumers.get(owner);if(!previous||previous.settled)return;
 signal?.throwIfAborted();
 await new Promise<void>((resolve,reject)=>{
  const abort=()=>{cleanup();reject(signal?.reason??Error('compound_final_wait_cancelled'));};
  const cleanup=()=>signal?.removeEventListener('abort',abort);
  previous.completion.promise.then(()=>{cleanup();resolve();},error=>{cleanup();reject(error);});
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 });
 signal?.throwIfAborted();entry.binding.assertCurrent();
 if(consumers.get(owner)!==previous||!previous.settled)throw Error('compound_final_consumer_changed');
}
export function hasCompoundFinalPublicationConsumer(owner:ObservationSessionOwner,turnId:string):boolean{
 const consumer=consumers.get(owner);return !!consumer&&consumer.turnId===turnId&&!consumer.used;
}
function actual(owner:ObservationSessionOwner){
 const host=getObservationSessionOwnerHostBinding(owner),binding=getCompoundPublicationOwnerBinding(owner);
 if(!binding)return undefined;
 binding.assertCurrent();if(binding.session!==host.session)throw Error('compound_producer_owner_mismatch');
 let queue=queues.get(binding.tree);if(!queue)queues.set(binding.tree,queue=createProducerWindowQueue());
 return {binding,queue,host};
}
/** Main/runtime-only iteration boundary. The lifetime ends after its actual
 * transport has drained; it does not close the long-lived owner's issuer. */
export async function runCompoundPublicationIteration<T>(owner:ObservationSessionOwner,turnId:string,work:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
 const entry=actual(owner);if(!entry)return work();
 if(!turnId)throw Error('compound_producer_turn_required');
 const handoff=handoffs.get(owner);
 if(handoff?.turnId===turnId&&handoff.producer){
  if(handoff.iterationStarted)throw Error('compound_handoff_iteration_replayed');handoff.iterationStarted=true;
  const producer=handoff.producer;
  return currentProducer.run(producer,async()=>{
   try{entry.binding.assertCurrent();const result=await work();await entry.host.waitForCurrentTransport();if(!handoff.released)throw Error('compound_handoff_not_dispatched');return result;}
   catch(error){handoff.window.fail(error);handoff.finished.reject(error);throw error;}
   finally{closeProducer(producer);handoff.finished.resolve();if(handoffs.get(owner)===handoff)handoffs.delete(owner);}
  });
 }
 return entry.queue.run(scope=>{
  const producer:Producer={owner,binding:entry.binding,queue:entry.queue,scope,turnId,producerId:randomUUID(),kind:'iteration',open:true};track(producer);
  return currentProducer.run(producer,async()=>{
   let settledBodyResult!: T;
   let settledBodyFailure: {
       error: unknown;
   } | undefined;
   try {
       try {
           entry.binding.assertCurrent();
           {
               settledBodyResult = await work();
           }
       }
       catch (error) {
           entry.queue.fail(error);
           throw error;
       }
   }
   catch (error) {
       settledBodyFailure = { error };
   }
   {
       try {
           await entry.host.waitForCurrentTransport();
       }
       catch (error) {
           entry.queue.fail(error);
           throw error;
       }
       finally {
           closeProducer(producer);
       }
   }
   if (settledBodyFailure)
       throw settledBodyFailure.error;
   return settledBodyResult;
  });
 },signal);
}
/** Main owns this one bounded window before freezing the new turn input. It
 * grants scheduling admission only; actual turn preparation/activation remains
 * governed by the original Main and ancestor-journal capabilities. */
export function openCompoundFollowupPublicationWindow(owner:ObservationSessionOwner,signal:AbortSignal,deadline:number,origin?:MetadataOrigin){
 const entry=actual(owner);if(!entry||handoffs.has(owner))throw Error('compound_handoff_owner');
 const window=entry.queue.closeAdmission(),handoff:Handoff={owner,entry,window,iterationStarted:false,released:false,finished:deferred(),input:deferred(),signal};handoffs.set(owner,handoff);
 const captured=origin?{producers:new Set(activeProducers.get(entry.binding.tree)??[]),origin:Object.freeze({session:origin.session,nativeInvocationId:origin.nativeInvocationId}),active:true}:undefined;
 if(captured)windowOrigins.set(entry.binding.tree,captured);
 const clearOrigin=()=>{if(captured)captured.active=false;};
 const interrupted=deferred();
 const fail=(error:unknown)=>{clearOrigin();window.fail(error);handoff.finished.reject(error);handoff.input.reject(error);};
 const interrupt=(error:unknown)=>{if(handoff.turnId)fail(error);else interrupted.reject(error);};
 const abort=()=>interrupt(signal.reason??Error('compound_handoff_cancelled'));
 signal.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>interrupt(Error('compound_publication_window_timeout')),Math.max(1,Math.min(30000,deadline-Date.now())));timer.unref?.();
 const cleanup=()=>{clearOrigin();clearTimeout(timer);signal.removeEventListener('abort',abort);};
 void handoff.finished.promise.then(cleanup,cleanup);if(signal.aborted)abort();
 return Object.freeze({drained:Promise.race([window.drained,interrupted.promise]),
  prepareTurn(turnId:string){entry.binding.assertCurrent();signal.throwIfAborted();if(handoff.turnId||!turnId)throw Error('compound_handoff_turn');handoff.turnId=turnId;},
  fail,
  cancelBeforeActivation(error:unknown){if(handoff.turnId||handoff.producer)throw Error('compound_handoff_already_activated');clearOrigin();window.cancel(error);handoff.finished.resolve();if(handoffs.get(owner)===handoff)handoffs.delete(owner);},
 });
}
/** Runs actual new input installation inside the first iteration's retained
 * slot. It returns after input installation while the slot awaits that exact
 * iteration, rather than holding a slot for the whole long-lived turn. */
export async function runCompoundTurnInput(owner:ObservationSessionOwner,turnId:string,work:()=>Promise<void>):Promise<void>{
 const handoff=handoffs.get(owner);if(!handoff)return work();
 if(handoff.turnId!==turnId||handoff.producer)throw Error('compound_handoff_turn');
 const running=handoff.window.handoff(async scope=>{
  const producer:Producer={owner,binding:handoff.entry.binding,queue:handoff.entry.queue,scope,turnId,producerId:randomUUID(),kind:'iteration',open:true};handoff.producer=producer;track(producer);
  await currentProducer.run(producer,async()=>{handoff.signal?.throwIfAborted();handoff.entry.binding.assertCurrent();await work();});handoff.input.resolve();
  await handoff.finished.promise;
 });
 void running.catch(error=>{handoff.window.fail(error);handoff.input.reject(error);handoff.finished.reject(error);});
 await handoff.input.promise;
}
/** Called at the actual provider's final dispatch boundary, after its original
 * opaque attempt was consumed with the exact body/destination/closure tuple. */
export function releaseCompoundPublicationHandoff(cap:ProviderAncestorAdmission,ticket:ProviderAncestorAttempt,facts:ProviderAncestorAttemptFacts):void{
 const producer=currentProducer.getStore();if(!producer)return;
 const handoff=handoffs.get(producer.owner);if(!handoff)return;
 if(handoff.released)return;
 if(handoff.producer!==producer||!producer.open||!handoff.iterationStarted||handoff.released||producer.binding.providerAdmission!==cap)throw Error('compound_handoff_dispatch');
 if(inspectConsumedCompoundProviderAttempt(cap,ticket,facts)==='semantic')return;
 producer.binding.assertCurrent();handoff.signal?.throwIfAborted();handoff.released=true;
 const origin=windowOrigins.get(producer.binding.tree);if(origin)origin.active=false;
 handoff.window.release();
}
/** Metadata publication produced by an already admitted iteration remains in
 * that producer, including a same-tree recipient. Independent Main publication
 * takes its own slot before changing the recipient's session or serial queue. */
export function runCompoundObservationPublication<T>(owner:ObservationSessionOwner,work:()=>Promise<T>):Promise<T>{
 const entry=actual(owner);if(!entry)return work();
 const prior=currentProducer.getStore();
 const publish=async()=>{entry.binding.assertCurrent();const value=await work();entry.binding.assertCurrent();return value;};
 if(prior?.open&&prior.binding.tree===entry.binding.tree)return prior.queue.inherit(prior.scope,publish);
 return entry.queue.run(scope=>{
  const producer:Producer={owner,binding:entry.binding,queue:entry.queue,scope,turnId:'publication',producerId:randomUUID(),kind:'publication',open:true};track(producer);
  return currentProducer.run(producer,async()=>{try{return await publish();}catch(error){entry.queue.fail(error);throw error;}finally{closeProducer(producer);}});
 });
}
/** The window is keyed by the coordinator's actual tree object, never a caller
 * supplied path or session id. The caller must seal under the original leases
 * after drained resolves; this object grants no execution authority. */
export function closeCompoundPublicationWindow(owner:ObservationSessionOwner){
 const entry=actual(owner);if(!entry)throw Error('compound_producer_owner_required');
 return entry.queue.closeAdmission();
}
/** Called by the actual final iteration after its complete history publisher.
 * It transfers scheduling ownership, so runner return need not await Main's
 * own result/snapshot tail. No JSON copy can finish this retained producer. */
export async function prepareCompoundFinalPublication(owner:ObservationSessionOwner,turnId:string):Promise<CompoundFinalPublicationTicket>{
 const producer=currentProducer.getStore(),entry=actual(owner);
 if(!entry||!producer?.open||producer.kind!=='iteration'||producer.owner!==owner||producer.binding!==entry.binding||producer.turnId!==turnId||producer.ticket)throw Error('compound_final_publication_scope');
 await entry.host.waitForCurrentTransport();entry.binding.assertCurrent();
 if(!producer.open)throw Error('compound_final_publication_scope');
 const snapshot=entry.binding.session.exportSnapshot(),historyDigest=computeSessionHistoryDigest(snapshot);
 if(entry.binding.session.getPublishedHistoryBasis()!==historyDigest)throw Error('compound_final_history_unpublished');
 const ticket=Object.freeze({}) as CompoundFinalPublicationTicket;
 const rootSessionId=entry.binding.tree.sessionIdentity;
 const facts=Object.freeze({session:entry.binding.session,sessionId:snapshot.sessionId,rootSessionId,role:snapshot.sessionId===rootSessionId?'root' as const:'child' as const,turnId,producerId:producer.producerId,historyDigest});
 finalPublications.set(ticket,{facts,producer,continuation:entry.queue.transfer(producer.scope)});producer.ticket=ticket;
 return ticket;
}
export function getCompoundFinalPublicationBinding(ticket:CompoundFinalPublicationTicket){
 const entry=ticket&&typeof ticket==='object'?finalPublications.get(ticket):undefined;
 if(!entry)throw Error('compound_final_publication_ticket');return entry.facts;
}
/** Only the factory-captured consumer receives this ticket's one completion
 * closure. There is intentionally no exported finish(ticket) operation. */
export async function publishCompoundFinalPublication(owner:ObservationSessionOwner,turnId:string):Promise<void>{
 const consumer=consumers.get(owner);
 if(!consumer||consumer.turnId!==turnId||consumer.used)throw Error('compound_final_consumer_missing');
 consumer.used=true;
 const ticket=await prepareCompoundFinalPublication(owner,turnId).catch(error=>{consumer.completion.reject(error);throw error;}),entry=finalPublications.get(ticket)!;
 let notified=false;
 try{
  await consumer.consumer.register(ticket,async receipt=>{
   if(notified||consumers.get(owner)!==consumer)throw Error('compound_final_publication_already_consumed');
   const facts=consumer.consumer.inspectReceipt(receipt),expected=entry.facts;
   if(!facts||facts.ticket!==ticket||facts.sessionId!==expected.sessionId||facts.turnId!==expected.turnId||facts.historyDigest!==expected.historyDigest||!Number.isSafeInteger(facts.snapshotRevision)||facts.snapshotRevision<0)throw Error('compound_final_publication_receipt');
   entry.continuation.complete();notified=true;consumer.settled=true;consumer.completion.resolve();
  });
 }catch(error){entry.continuation.fail(error);consumer.completion.reject(error);throw error;}
}
/** Continues only the transferred tail. It does not reopen the old iteration
 * for new tools or provider dispatch, and does not itself finish the producer. */
export function runCompoundFinalPublication<T>(ticket:CompoundFinalPublicationTicket,work:()=>Promise<T>):Promise<T>{
 const entry=ticket&&typeof ticket==='object'?finalPublications.get(ticket):undefined;
 if(!entry)return Promise.reject(Error('compound_final_publication_ticket'));
 return entry.continuation.run(work);
}
