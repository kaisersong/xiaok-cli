import {types} from 'node:util';
import type {ActivityActor} from './service.js';
import type {ConversationWorkView,WorkWatch} from './types.js';
import type {AttentionReaderSlot} from './attention-reader-owner.js';
import type {AttentionInventory} from './attention-canonical-state.js';
import {projectUnavailableActivityAttention} from './attention-projector.js';
import {assertBeforeEffects} from '../verification/before-effects.js';

export interface AttentionInventoryReader {
 hasBinding(watchId:string):boolean;
 collect(slot:AttentionReaderSlot,actor:ActivityActor):Promise<AttentionInventory>;
 assertCurrent(slot:AttentionReaderSlot,actor:ActivityActor):unknown;
 /** Retains the actual collected owner frame separately from its live lease. */
 assertCollectedCurrent?(inventory:AttentionInventory,actor:ActivityActor):void;
}
export interface AttentionReadResult {view:ConversationWorkView;presentationIncarnation:string;dismissed:boolean;dismissConflict:boolean}
export interface AttentionDismiss {expectedProjectionVersion:number;expectedPresentationIncarnation:string}


/** Freeze only actual project outputs. Descriptor inspection precedes values,
 * so a later outer transport check cannot invoke a replaced getter or proxy. */
function freezeProjectOutput(value:unknown,parents=new Set<object>(),budget={nodes:0},depth=0):void{
 if(++budget.nodes>100000||depth>64)throw Error('attention_output_invalid');
 if(value===null||value===undefined||['string','number','boolean'].includes(typeof value))return;
 if(typeof value!=='object'||types.isProxy(value)||parents.has(value)||Object.getOwnPropertySymbols(value).length)throw Error('attention_output_invalid');
 if(!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('attention_output_invalid');
 parents.add(value);
 for(const field of Object.values(Object.getOwnPropertyDescriptors(value))){if(!Object.hasOwn(field,'value'))throw Error('attention_output_invalid');freezeProjectOutput(field.value,parents,budget,depth+1);}
 parents.delete(value);Object.freeze(value);
}

/** One-shot coordination of original owners. No database, poller, background
 * command, source authority or version counter lives here. */
export class AttentionWorkReader {
 private readonly projectOutputs=new WeakSet<object>();
 private readonly deliveryGuards=new WeakMap<ConversationWorkView,(actor:ActivityActor)=>void>();
 private readonly lanes=new Map<string,Promise<void>>();
 private readonly reads=new Map<string,Promise<ConversationWorkView>>();
 private readonly callerReads=new WeakMap<ActivityActor,Map<string,Promise<ConversationWorkView>>>();
 constructor(private readonly options:{reader:AttentionInventoryReader;
  base(watchId:string,actor:ActivityActor):Promise<ConversationWorkView>;
  assertNative(watch:WorkWatch,actor:ActivityActor):void;
  begin(watchId:string,actor:ActivityActor):Promise<{roundId:string;readerSlots:AttentionReaderSlot[];memberSlots?:AttentionReaderSlot[]}>;
  finalize(input:Record<string,unknown>,actor:ActivityActor):Promise<AttentionReadResult>;
  abort(roundId:string,actor:ActivityActor):Promise<unknown>|unknown;
  /** Fixed local finalizer over the original Sources/Store facts. No HTTP or
   * caller-supplied inventory is collected by this coordinator. */
  project?(watchId:string,actor:ActivityActor,dismiss?:AttentionDismiss):Promise<{view:ConversationWorkView;assertCurrent(actor:ActivityActor):void}>;
  onError?(error:unknown):void}){}
 private anchor(watch:WorkWatch):string{return JSON.stringify([watch.origin.profileId,watch.origin.workspaceId,watch.source,watch.logicalSourceId,watch.sourceDataEpoch,watch.workId,watch.runId??'']);}
 private async read(watchId:string,actor:ActivityActor,dismiss?:AttentionDismiss):Promise<ConversationWorkView>{
  const initial=await this.options.base(watchId,actor);this.options.assertNative(initial.watch,actor);
  if(!(initial.watch.source==='kswarm'&&this.options.project)&&!this.options.reader.hasBinding(watchId))return this.readRound(watchId,actor,dismiss);
  const key=this.anchor(initial.watch),previous=this.lanes.get(key);let release!:()=>void;
  const reserved=new Promise<void>(resolve=>{release=resolve;});this.lanes.set(key,reserved);
  try{
   if(previous)await previous;
   // Queue admission is only a location hint. Reauthorize the actual native
   // watch after waiting and never run a new anchor under an old lane.
   const current=await this.options.base(watchId,actor);this.options.assertNative(current.watch,actor);
   if(this.anchor(current.watch)!==key)throw Error('attention_source_conflict');
   return await this.readRound(watchId,actor,dismiss,key);
  }finally{release();if(this.lanes.get(key)===reserved)this.lanes.delete(key);}
 }
 private async readRound(watchId:string,actor:ActivityActor,dismiss?:AttentionDismiss,expectedAnchor?:string):Promise<ConversationWorkView>{
  const base=await this.options.base(watchId,actor);this.options.assertNative(base.watch,actor);
  if(expectedAnchor!==undefined&&this.anchor(base.watch)!==expectedAnchor)throw Error('attention_source_conflict');
  const project=base.watch.source==='kswarm'?this.options.project:undefined;
  if(!project&&!this.options.reader.hasBinding(watchId)){
   if(dismiss)throw Error('attention_inventory_unavailable');
   return base.watch.source==='mcp'&&base.presentation?{...base,presentation:{...base.presentation,protocolUnavailable:true}}:base;
  }
  let round:{roundId:string;readerSlots:AttentionReaderSlot[];memberSlots?:AttentionReaderSlot[]}|undefined,finalized=false;
  const collected:AttentionInventory[]=[];
  const guard=()=>{for(const slot of round?.memberSlots??round?.readerSlots??[])this.options.reader.assertCurrent(slot,actor);for(const inventory of collected)this.options.reader.assertCollectedCurrent?.(inventory,actor);};
  try{
   if(project){
    const result=await project(watchId,actor,dismiss);
    this.options.assertNative(result.view.watch,actor);assertBeforeEffects(()=>result.assertCurrent(actor));
    if(this.anchor(result.view.watch)!==this.anchor(base.watch))throw Error('attention_source_conflict');
    this.deliveryGuards.set(result.view,currentActor=>assertBeforeEffects(()=>result.assertCurrent(currentActor)));
    return result.view;
   }
   round=await this.options.begin(watchId,actor);this.options.assertNative(base.watch,actor);guard();
   if(base.watch.source==='task_host'&&!round.memberSlots)throw Error('attention_inventory_incomplete');
   const inventories:Array<AttentionInventory&{sourceLeaseId?:string}>=[];
   const resources=new Map<string,AttentionInventory>();
   for(const slot of round.readerSlots){
    this.options.reader.assertCurrent(slot,actor);
    const key=slot.sourceKind==='codex_native_approval'?JSON.stringify([slot.sourceKind,slot.readerIncarnation,slot.reference]):JSON.stringify(['mcp_task',slot.readerIncarnation,slot.reference.endpointId,slot.reference.generation,slot.reference.taskId,slot.reference.originalOperation]);
    let inventory=resources.get(key);if(!inventory){inventory=await this.options.reader.collect(slot,actor);resources.set(key,inventory);collected.push(inventory);}
    guard();this.options.reader.assertCurrent(slot,actor);
    if(slot.sourceKind==='codex_native_approval'){
     if(!('sourceKind'in inventory)||inventory.sourceKind!=='codex_native_approval')throw Error('attention_inventory_source_conflict');
     inventories.push({...inventory,watchId:slot.watchId,readerIncarnation:slot.readerIncarnation,enrollmentIncarnation:slot.enrollmentIncarnation,bindingDigest:slot.bindingDigest,sourceLeaseId:slot.sourceLeaseId});
    }else{if('sourceKind'in inventory)throw Error('attention_inventory_source_conflict');inventories.push({...inventory,watchId:slot.watchId,readerIncarnation:slot.readerIncarnation});}
   }
   guard();
   this.options.assertNative(base.watch,actor);
   const result=await this.options.finalize({roundId:round.roundId,inventories,...(dismiss?{dismiss}:{})},actor);
   finalized=true;
   guard();
   this.options.assertNative(result.view.watch,actor);
   if(dismiss&&result.dismissConflict)throw Error('attention_projection_conflict');
   const view={...result.view,attentionState:{presentationIncarnation:result.presentationIncarnation,dismissed:result.dismissed}};
   const slots=round.memberSlots??round.readerSlots;this.deliveryGuards.set(view,currentActor=>{for(const slot of slots)this.options.reader.assertCurrent(slot,currentActor);for(const inventory of collected)this.options.reader.assertCollectedCurrent?.(inventory,currentActor);});return view;
  }catch(error){
   if(dismiss)throw error;
   try{this.options.onError?.(error);}catch{/* A source read remains unavailable. */}
   const current=await this.options.base(watchId,actor);this.options.assertNative(current.watch,actor);
   return {watch:current.watch,projection:{...current.projection,executionState:'accepted',businessOutcome:'unknown',freshness:'unavailable',summary:undefined,evidenceRefs:[],sourceSequence:0,
    lastProgressAt:null,lastHeartbeatAt:null,lastReportAt:null,errorCode:error instanceof Error&&error.message==='activity_source_forbidden'?'activity_source_forbidden':'attention_inventory_unavailable'},
    presentation:{...projectUnavailableActivityAttention(current.watch,current.projection.revision),protocolUnavailable:true}};
  }finally{
   // Successful finalize consumes the ticket on its original owner. A redundant
   // network abort would add an await after the last physical-reader check.
   if(round&&!finalized)try{await this.options.abort(round.roundId,actor);}catch{/* Supersession or owner sealing already retired the round. */}
   this.options.assertNative(base.watch,actor);
   if(finalized&&round)guard();
  }
 }
 private deliver(view:ConversationWorkView,actor:ActivityActor):ConversationWorkView{
  this.options.assertNative(view.watch,actor);this.deliveryGuards.get(view)?.(actor);
  if(view.watch.source==='kswarm'&&this.options.project){freezeProjectOutput(view);this.projectOutputs.add(view);}
  return view;
 }
 /** Original object only; this does not read HTTP or mint a source grant. */
 assertProjectReadCurrent(raw:unknown,actor:ActivityActor):void{
  if(!raw||typeof raw!=='object'||!this.projectOutputs.has(raw))throw Error('attention_output_foreign');
  const view=raw as ConversationWorkView;this.options.assertNative(view.watch,actor);this.deliveryGuards.get(view)?.(actor);
 }
 private getFrom(reads:Map<string,Promise<ConversationWorkView>>,watchId:string,actor:ActivityActor):Promise<ConversationWorkView>{
  let pending=reads.get(watchId);
  if(!pending){pending=Promise.resolve().then(()=>this.read(watchId,actor));reads.set(watchId,pending);
   const current=pending;void current.then(()=>{if(reads.get(watchId)===current)reads.delete(watchId);},()=>{if(reads.get(watchId)===current)reads.delete(watchId);});}
  return pending.then(view=>this.deliver(view,actor));
 }
 private dismissFrom(reads:Map<string,Promise<ConversationWorkView>>,watchId:string,input:AttentionDismiss,actor:ActivityActor):Promise<ConversationWorkView>{
  const previous=reads.get(watchId),pending=Promise.resolve().then(async()=>{if(previous)try{await previous;}catch{/* Reauthorize a fresh round. */}return this.read(watchId,actor,input);});
  reads.set(watchId,pending);void pending.then(()=>{if(reads.get(watchId)===pending)reads.delete(watchId);},()=>{if(reads.get(watchId)===pending)reads.delete(watchId);});return pending.then(view=>this.deliver(view,actor));
 }
 private readsFor(actor:ActivityActor){let reads=this.callerReads.get(actor);if(!reads){reads=new Map();this.callerReads.set(actor,reads);}return reads;}
 getWork(watchId:string,actor:ActivityActor):Promise<ConversationWorkView>{return this.getFrom(this.reads,watchId,actor);}
 dismiss(watchId:string,input:AttentionDismiss,actor:ActivityActor):Promise<ConversationWorkView>{return this.dismissFrom(this.reads,watchId,input,actor);}
 /** Presentation authority stays with the actual caller. Physical source IO
  * is shared separately by Sources; all callers retain the same anchor lane. */
 getWorkForCaller(watchId:string,actor:ActivityActor){return this.getFrom(this.readsFor(actor),watchId,actor);}
 dismissForCaller(watchId:string,input:AttentionDismiss,actor:ActivityActor){return this.dismissFrom(this.readsFor(actor),watchId,input,actor);}

}
