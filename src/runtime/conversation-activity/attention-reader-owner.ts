import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {ConversationActivityStore} from './store.js';
import type {ActivityActor,ActivityThreadIdentity,ConversationActivityService} from './service.js';
import type {WorkWatch} from './types.js';
import {attentionInventorySchema} from './attention-canonical-state.js';
import {nativeAttentionReferenceSchema,nativeAttentionBindingDigest,type NativeAttentionReference} from './native-attention-source.js';

const key=z.string().min(1).max(256),uuid=z.string().uuid();
const prepareSchema=z.object({threadId:key,operationId:key,creationIdempotencyKey:key}).strict();
const referenceSchema=z.object({endpointId:key,generation:z.enum(['v1','v2']),taskId:key,originalOperation:z.literal('tools/call')}).strict();
const bindingSchema=z.object({operationId:key,watchId:key,logicalSourceId:key,sourceDataEpoch:key,workId:key,runId:key.optional()}).strict();
type Reference=z.infer<typeof referenceSchema>;
export interface McpAttentionReaderSlot {watchId:string;readerIncarnation:string;reference:Reference;sourceKind?:never}
export interface NativeAttentionReaderSlot {sourceKind:'codex_native_approval';watchId:string;readerIncarnation:string;reference:NativeAttentionReference;
 sourceLeaseId:string;enrollmentIncarnation:string;bindingDigest:string;mode:'live'|'terminal'}
export type AttentionReaderSlot=McpAttentionReaderSlot|NativeAttentionReaderSlot;
export type NativeReaderAction='qualify'|'begin'|'finalize'|'abort';
export interface NativeReaderAuthorization {context?:object;action:NativeReaderAction;watchId:string;roundId?:string}
export interface AttentionReaderClient {role?:'user'|'producer';active:boolean;instanceId?:string}
interface Registration {client:AttentionReaderClient;endpointId:string;incarnation:string}
interface Birth {client:AttentionReaderClient;ref:string;input:z.infer<typeof prepareSchema>;phase:'preparing'|'ready'|'binding'|'bound';lease?:McpLease}
interface McpLease {kind:'mcp';birth:Birth;registration:Registration;watchId:string;identity:string;reference:Reference}
interface NativeLease {kind:'native';client:AttentionReaderClient;watchId:string;identity:string;reference:NativeAttentionReference;sourceLeaseId:string;
 enrollmentIncarnation:string;bindingDigest:string;registration:{incarnation:string};mode:'live'|'terminal'}
type Lease=McpLease|NativeLease;
interface Round {id:string;client:AttentionReaderClient;lease:Lease;leases:Lease[];slots:AttentionReaderSlot[];capture:ReturnType<ConversationActivityStore['captureAttentionRead']>;phase:'pending'|'finalizing'}
const identity=(watch:WorkWatch,reference:Reference)=>JSON.stringify([watch.watchId,watch.operationId,watch.source,watch.logicalSourceId,watch.sourceDataEpoch,watch.workId,watch.runId??'',watch.generation,watch.origin,reference]);

/** Private lifecycle registry of the ORIGINAL socket owner. It has no database
 * writer, polling, executor or arbitrary transaction callback of its own. */
export class ActivityAttentionReaders {
 private readonly births=new Map<string,Birth>();
 private readonly claims=new Map<AttentionReaderClient,Set<string>>();
 private readonly registrations=new Map<AttentionReaderClient,Map<string,Registration>>();
 private readonly leases=new Map<string,Lease>();
 private readonly rounds=new Map<string,Round>();
 private readonly nativePending=new Map<string,object>();
 constructor(private readonly options:{store:ConversationActivityStore;service:ConversationActivityService;actor:ActivityActor;ownerEpoch:string;
  assertProducer(client:AttentionReaderClient,threadId?:string):void;assertNativeProducer?(client:AttentionReaderClient,threadId:string|undefined,authorization:NativeReaderAuthorization):void;assertNativeCleanupOwner?(client:AttentionReaderClient,roundId:string,context?:object):void;getThread(threadId:string):ActivityThreadIdentity|null}){}
 hasBirth(operationId:string):boolean{return this.births.has(operationId);}
 noteMcpRegistration(client:AttentionReaderClient,raw:Record<string,unknown>):void{
  this.options.assertProducer(client);if(raw.config!==undefined)return;
  const endpointId=key.parse(raw.endpointId);let claims=this.claims.get(client);if(!claims)this.claims.set(client,claims=new Set());claims.add(endpointId);
 }
 private assertBirth(client:AttentionReaderClient,operationId:string,ref:string):Birth{
  const birth=this.births.get(operationId);
  if(!birth||birth.client!==client||birth.ref!==ref)throw Error('attention_reader_forbidden');
  this.options.assertProducer(client,birth.input.threadId);
  const association=this.options.store.getAssociation(operationId),thread=this.options.getThread(birth.input.threadId);
  if(!association||!thread||thread.deleteState!=='none'||thread.profileId!==association.origin.profileId||thread.workspaceId!==association.origin.workspaceId)throw Error('attention_reader_forbidden');
  return birth;
 }
 async prepare(client:AttentionReaderClient,raw:Record<string,unknown>){
  const input=prepareSchema.parse(raw);this.options.assertProducer(client,input.threadId);
  const previous=this.births.get(input.operationId);
  if(previous){if(previous.client!==client||JSON.stringify(previous.input)!==JSON.stringify(input))throw Error('attention_reader_forbidden');
   this.assertBirth(client,input.operationId,previous.ref);if(previous.phase==='preparing'||previous.phase==='binding')throw Error('attention_reader_busy');return {schemaVersion:1,sourceBirthRef:previous.ref};}
  if(this.options.store.getAssociation(input.operationId))throw Error('attention_reader_forbidden');
  const birth:Birth={client,input,ref:randomUUID(),phase:'preparing'};this.births.set(input.operationId,birth);
  try{
   await this.options.service.prepareAssociation(input,this.options.actor);
   if(this.births.get(input.operationId)!==birth)throw Error('attention_reader_forbidden');
   this.assertBirth(client,input.operationId,birth.ref);birth.phase='ready';return {schemaVersion:1,sourceBirthRef:birth.ref};
  }catch(error){if(this.births.get(input.operationId)===birth)this.births.delete(input.operationId);throw error;}
 }
 register(client:AttentionReaderClient,raw:Record<string,unknown>){
  const input=z.object({endpointId:key,sourceIncarnation:uuid}).strict().parse(raw);this.options.assertProducer(client);
  if(!this.claims.get(client)?.has(input.endpointId))throw Error('attention_reader_forbidden');
  let entries=this.registrations.get(client);if(!entries)this.registrations.set(client,entries=new Map());
  const old=entries.get(input.endpointId);if(old?.incarnation===input.sourceIncarnation)return {schemaVersion:1,readerIncarnation:old.incarnation};
  if(old)for(const [id,round] of this.rounds)if(round.leases.some(lease=>lease.registration===old))this.rounds.delete(id);
  entries.set(input.endpointId,{client,endpointId:input.endpointId,incarnation:input.sourceIncarnation});
  return {schemaVersion:1,readerIncarnation:input.sourceIncarnation};
 }
 async bind(client:AttentionReaderClient,raw:Record<string,unknown>){
  const input=z.object({sourceBirthRef:uuid,binding:bindingSchema,reference:referenceSchema}).strict().parse(raw),birth=this.assertBirth(client,input.binding.operationId,input.sourceBirthRef);
  if(birth.phase==='preparing'||birth.phase==='binding')throw Error('attention_reader_busy');
  if(input.binding.logicalSourceId!==input.reference.endpointId||input.binding.workId!==input.reference.taskId)throw Error('attention_reader_forbidden');
  const registration=this.registrations.get(client)?.get(input.reference.endpointId);if(!registration)throw Error('attention_inventory_unavailable');
  if(birth.phase==='bound'){
   const watch=this.options.store.getWatch(input.binding.watchId),lease=birth.lease;
   if(!watch||!lease||lease.watchId!==watch.watchId||identity(watch,input.reference)!==lease.identity)throw Error('attention_reader_forbidden');
   return watch; // A new registration cannot requalify an old bound watch.
  }
  if(this.options.store.getWatch(input.binding.watchId))throw Error('attention_reader_forbidden');
  birth.phase='binding';
  try{
   const watch=await this.options.service.bindWork({...input.binding,source:'mcp'},input.reference as Parameters<ConversationActivityService['bindWork']>[1]);
   if(this.births.get(input.binding.operationId)!==birth||this.assertBirth(client,input.binding.operationId,input.sourceBirthRef)!==birth)throw Error('attention_reader_forbidden');
   const lease:McpLease={kind:'mcp',birth,registration,watchId:watch.watchId,identity:identity(watch,input.reference),reference:input.reference};
   birth.lease=lease;birth.phase='bound';this.leases.set(watch.watchId,lease);
   // This acknowledges the original association, not a reader qualification.
   // begin must still validate the exact current registration after this await.
   return watch;
  }catch(error){if(this.births.get(input.binding.operationId)===birth&&birth.phase==='binding')this.births.delete(input.binding.operationId);throw error;}
 }
 private nativeClient(client:AttentionReaderClient,threadId:string,watchId:string,action:NativeReaderAction,context?:object,roundId?:string):void{
  this.options.assertProducer(client,threadId);
  if(!this.options.assertNativeProducer)throw Error('activity_native_source_forbidden');
  this.options.assertNativeProducer(client,threadId,{context,action,watchId,...(roundId?{roundId}:{})});
 }
 private nativeIdentity(watch:WorkWatch):string{return JSON.stringify([nativeAttentionBindingDigest(watch),watch.generation,watch.status]);}
 private slot(lease:Lease):AttentionReaderSlot{
  if(lease.kind==='mcp')return {watchId:lease.watchId,readerIncarnation:lease.registration.incarnation,reference:lease.reference};
  const terminal=this.options.store.readNativeTerminalAttentionInventory(lease.watchId);
  if(lease.mode==='terminal'&&!terminal)throw Error('attention_native_terminal_unverified');
  return {sourceKind:'codex_native_approval',watchId:lease.watchId,readerIncarnation:lease.registration.incarnation,reference:lease.reference,
   sourceLeaseId:lease.sourceLeaseId,enrollmentIncarnation:lease.enrollmentIncarnation,bindingDigest:lease.bindingDigest,mode:terminal?'terminal':'live'};
 }
 async qualifyNative(client:AttentionReaderClient,raw:Record<string,unknown>,context?:object){
  const referenceSchema=z.custom<NativeAttentionReference>(value=>nativeAttentionReferenceSchema.safeParse(value).success).transform(value=>nativeAttentionReferenceSchema.parse(value));
  const input=z.object({watchId:key,reference:referenceSchema.optional()}).strict().parse(raw);
  const watch=this.options.store.getWatch(input.watchId);if(!watch||watch.status!=='active'||watch.source!=='task_host')throw Error('attention_reader_forbidden');
  this.nativeClient(client,watch.origin.threadId,watch.watchId,'qualify',context);
  if(this.nativePending.has(watch.watchId))throw Error('attention_reader_busy');
  const existing=this.leases.get(watch.watchId);
  if(existing&&(existing.kind!=='native'||existing.client!==client))throw Error('attention_reader_busy');
  if(existing){
   this.currentLease(client,watch.watchId,context,'qualify');
   if(input.reference&&JSON.stringify(input.reference)!==JSON.stringify(existing.reference))throw Error('activity_native_source_binding_conflict');
   if(!input.reference&&!this.options.store.readNativeTerminalAttentionInventory(watch.watchId))throw Error('attention_native_terminal_unverified');
   return this.slot(existing);
  }
  const reservation={};this.nativePending.set(watch.watchId,reservation);const expected=this.nativeIdentity(watch);
  try{
   await this.options.service.authorizeRead(watch.watchId,this.options.actor);
   this.nativeClient(client,watch.origin.threadId,watch.watchId,'qualify',context);const current=this.options.store.getWatch(watch.watchId);
   if(this.nativePending.get(watch.watchId)!==reservation||!current||this.nativeIdentity(current)!==expected||this.leases.has(watch.watchId))throw Error('attention_reader_forbidden');
   const terminal=input.reference?null:this.options.store.readNativeTerminalAttentionInventory(watch.watchId);
   if(!input.reference&&!terminal)throw Error('attention_native_terminal_unverified');
   const reference=input.reference??terminal!.reference;
   const {enrollment,delivery}=this.options.store.enrollNativeAttentionSource(watch.watchId,reference);this.options.store.revokeNativeAttentionDelivery(delivery);
   const lease:NativeLease={kind:'native',client,watchId:watch.watchId,identity:expected,reference,enrollmentIncarnation:enrollment.enrollmentIncarnation,bindingDigest:enrollment.bindingDigest,sourceLeaseId:randomUUID(),registration:{incarnation:reference.nativeIncarnation},mode:input.reference?'live':'terminal'};
   this.leases.set(watch.watchId,lease);return this.slot(lease);
  }finally{if(this.nativePending.get(watch.watchId)===reservation)this.nativePending.delete(watch.watchId);}
 }
 forget(client:AttentionReaderClient,raw:Record<string,unknown>){
  const input=z.object({operationId:key,sourceBirthRef:uuid}).strict().parse(raw),birth=this.assertBirth(client,input.operationId,input.sourceBirthRef);
  this.options.service.forgetUnboundAssociation(input.operationId);
  const forgotten=!this.options.store.getAssociation(input.operationId);if(forgotten)this.invalidateBirth(birth);return {forgotten};
 }
 private currentLease(client:AttentionReaderClient,watchId:string,context?:object,action:NativeReaderAction='begin',roundId?:string):Lease{
  const lease=this.leases.get(watchId);if(!lease)throw Error('attention_reader_forbidden');
  if(lease.kind==='native'){
   const watch=this.options.store.getWatch(watchId);if(lease.client!==client||!watch)throw Error('attention_reader_forbidden');this.nativeClient(client,watch.origin.threadId,watchId,action,context,roundId);
   const enrollment=this.options.store.getNativeAttentionEnrollment(watchId);
   if(watch.status!=='active'||this.nativeIdentity(watch)!==lease.identity||!enrollment||enrollment.enrollmentIncarnation!==lease.enrollmentIncarnation||enrollment.bindingDigest!==lease.bindingDigest||JSON.stringify(enrollment.reference)!==JSON.stringify(lease.reference))throw Error('attention_inventory_unavailable');
   if(lease.mode==='terminal'&&!this.options.store.readNativeTerminalAttentionInventory(watchId))throw Error('attention_native_terminal_unverified');
   this.options.service.assertCurrentUserRead(watchId,this.options.actor);return lease;
  }
  if(lease.birth.client!==client)throw Error('attention_reader_forbidden');
  this.assertBirth(client,lease.birth.input.operationId,lease.birth.ref);
  const watch=this.options.store.getWatch(watchId),reference=this.options.store.getMcpReference(watchId);
  if(!watch||watch.status!=='active'||!reference||identity(watch,reference)!==lease.identity||this.registrations.get(client)?.get(lease.registration.endpointId)!==lease.registration)throw Error('attention_inventory_unavailable');
  this.options.service.assertCurrentUserRead(watchId,this.options.actor);return lease;
 }
 async begin(client:AttentionReaderClient,raw:Record<string,unknown>,context?:object){
  const {watchId}=z.object({watchId:key}).strict().parse(raw),lease=this.currentLease(client,watchId,context),capture=this.options.store.captureAttentionRead(watchId),leases:Lease[]=[];
  for(const member of capture.members){
   if(member.deleted||member.watch.status==='stopped')continue;
   const current=this.currentLease(client,member.watch.watchId,context);
   if(current.kind!==lease.kind||current.kind==='mcp'&&lease.kind==='mcp'&&current.registration!==lease.registration
    ||current.kind==='native'&&lease.kind==='native'&&JSON.stringify(current.reference)!==JSON.stringify(lease.reference))throw Error('attention_inventory_unavailable');
   if(!await this.options.service.canReadSource(member.watch.watchId))throw Error('activity_source_forbidden');
   if(this.currentLease(client,member.watch.watchId,context)!==current)throw Error('attention_inventory_unavailable');leases.push(current);
  }
  for(const item of leases)if(this.currentLease(client,item.watchId,context)!==item)throw Error('attention_inventory_unavailable');
  if(this.options.store.getAttentionSourceSnapshot(watchId).membershipDigest!==capture.membershipDigest)throw Error('attention_source_conflict');
  for(const [id,round] of this.rounds)if(round.client===client&&round.lease.watchId===watchId)this.rounds.delete(id);
  if(this.rounds.size>=128)throw Error('attention_read_capacity');
  const slots=leases.map(item=>this.slot(item));
  const round:Round={id:randomUUID(),client,lease,leases,slots,capture,phase:'pending'};this.rounds.set(round.id,round);
  const readerSlots=slots.filter(slot=>slot.sourceKind!=='codex_native_approval'||slot.mode==='live');
  return {schemaVersion:1,roundId:round.id,ownerEpoch:this.options.ownerEpoch,readerSlots,...(lease.kind==='native'?{memberSlots:slots}:{})};
 }
 abort(client:AttentionReaderClient,raw:Record<string,unknown>,context?:object){
  const {roundId}=z.object({roundId:uuid}).strict().parse(raw),round=this.rounds.get(roundId);this.options.assertProducer(client);
  if(!round||round.client!==client)throw Error('attention_round_conflict');
  // Local MCP and Native share one real client; only the fixed Native owner may
  // retire that owner's ticket. A revoked source is not a reason to leak it.
  if(round.lease.kind==='native')this.options.assertNativeCleanupOwner?.(client,roundId,context);
  try{for(const lease of round.leases)this.currentLease(client,lease.watchId,context,'abort',roundId);return {aborted:true};}
  finally{if(this.rounds.get(roundId)===round)this.rounds.delete(roundId);}
 }
 async finalize(client:AttentionReaderClient,raw:Record<string,unknown>,context?:object){
  this.options.assertProducer(client);
  const input=z.object({roundId:uuid,inventories:z.array(z.unknown()).max(512),dismiss:z.object({expectedProjectionVersion:z.number().int().nonnegative().safe(),expectedPresentationIncarnation:uuid}).strict().optional()}).strict().parse(raw);
  const round=this.rounds.get(input.roundId);if(!round||round.client!==client||round.phase!=='pending')throw Error('attention_round_conflict');
  // Reject a foreign local operation before changing/consuming its ticket.
  if(round.lease.kind==='native')this.currentLease(client,round.lease.watchId,context,'finalize',input.roundId);
  round.phase='finalizing';
  const current=()=>{
   this.options.assertProducer(client);if(this.rounds.get(input.roundId)!==round||round.phase!=='finalizing')throw Error('attention_round_conflict');
   for(const lease of round.leases)if(this.currentLease(client,lease.watchId,context,'finalize',input.roundId)!==lease)throw Error('attention_inventory_unavailable');
  };
  try{
   current();
   const inventories=input.inventories.map(raw=>{
    if(raw&&typeof raw==='object'&&!Array.isArray(raw)&&'sourceKind'in raw&&raw.sourceKind==='codex_native_approval'){
     const {sourceLeaseId,...body}=raw as Record<string,unknown>,slot=round.slots.find(slot=>slot.watchId===body.watchId);
     if(!slot||slot.sourceKind!=='codex_native_approval'||slot.mode!=='live'||sourceLeaseId!==slot.sourceLeaseId)throw Error('attention_inventory_incomplete');
     const parsed=attentionInventorySchema.safeParse(body);if(!parsed.success)throw Error('attention_inventory_invalid');return parsed.data;
    }
    const parsed=attentionInventorySchema.safeParse(raw);if(!parsed.success)throw Error('attention_inventory_invalid');return parsed.data;
   });
   const byWatch=new Map(inventories.map(item=>[item.watchId,item]));
   const liveSlots=round.slots.filter(slot=>slot.sourceKind!=='codex_native_approval'||slot.mode==='live');
   if(byWatch.size!==inventories.length||byWatch.size!==liveSlots.length||liveSlots.some(slot=>byWatch.get(slot.watchId)?.readerIncarnation!==slot.readerIncarnation))throw Error('attention_inventory_incomplete');
   for(const slot of liveSlots){const item=byWatch.get(slot.watchId)!;if((slot.sourceKind==='codex_native_approval')!==('sourceKind'in item))throw Error('attention_inventory_source_conflict');}
   for(const lease of round.leases){current();await this.options.service.authorizeRead(lease.watchId,this.options.actor);current();}
   current();
   const result=this.options.store.finalizeAttentionReadRound(round.lease.watchId,{expectedMembershipDigest:round.capture.membershipDigest,expectedProjectionVersion:round.capture.projectionVersion,
    expectedPresentationIncarnation:round.capture.presentationIncarnation,inventories,...(input.dismiss?{dismiss:input.dismiss}:{})});
   if(input.dismiss&&result.dismissed&&!result.dismissConflict)this.options.service.publishAttentionChange(round.lease.watchId,this.options.actor);
   return result;
  }finally{if(this.rounds.get(input.roundId)===round)this.rounds.delete(input.roundId);}
 }
 private invalidateBirth(birth:Birth):void{
  if(this.births.get(birth.input.operationId)===birth)this.births.delete(birth.input.operationId);
  if(birth.lease&&this.leases.get(birth.lease.watchId)===birth.lease)this.leases.delete(birth.lease.watchId);
  for(const [id,round] of this.rounds)if(round.leases.some(lease=>lease.kind==='mcp'&&lease.birth===birth))this.rounds.delete(id);
 }
 disconnected(client:AttentionReaderClient):void{
  for(const birth of this.births.values())if(birth.client===client)this.invalidateBirth(birth);
  this.claims.delete(client);this.registrations.delete(client);
  for(const [id,lease] of this.leases)if(lease.kind==='native'&&lease.client===client)this.leases.delete(id);
  for(const [id,round] of this.rounds)if(round.client===client)this.rounds.delete(id);
 }
 seal():void{this.births.clear();this.claims.clear();this.registrations.clear();this.leases.clear();this.rounds.clear();this.nativePending.clear();}
}
