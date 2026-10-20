import {createHash,randomUUID} from 'node:crypto';
import {types} from 'node:util';
import {claimOriginalCanonicalStoreChannel,type ContinuityStore,type OriginalCanonicalStoreChannel,digest} from './store.js';
import {assertDesktopSyncDevice,assertDesktopSyncIncoming,assertDesktopSyncStoreAnchor,assertDesktopSyncSourceControls,desktopCanonicalSourceIdentityData,type DesktopSyncDevice} from './sync-device-runtime.js';
import {validateCanonicalBatch,validateCanonicalBundle,type CanonicalSyncBatch,type CanonicalSyncScope} from './sync-canonical-codec.js';
import {captureCanonicalStoreStateWithSourceIntent,type CanonicalStoreState,type CanonicalStickyFact,type CanonicalSourceIntentRow} from './sync-canonical-state.js';
import type {DesktopCanonicalSourceDraftMetadata} from '../desktop-services.js';
import {ContinuityPolicyUnavailable,definitivePolicyDenial} from '../../../src/runtime/context-continuity/policy-denial.js';
import type {ContinuityConversation,ContinuityMessage} from '../../shared/context-continuity-types.js';

type Data=Record<string,any>;
export interface CanonicalStoreSyncBinding {
 importIncoming(incoming:unknown):{conversationIds:string[]};
}
export interface CanonicalStoreSyncOwner {
 readonly binding:CanonicalStoreSyncBinding;
 captureSourceState(device:DesktopSyncDevice,ids:readonly string[]):object;
 bootstrapSource(device:DesktopSyncDevice,services:object,draft:object,controls:unknown):Promise<object>;
 captureSourceDraft(device:DesktopSyncDevice,ids:readonly string[]):object;
 beforeWrite():void;prepareCommit():void;afterCommit(receipt:object):void;writeFailed():void;
 assertScope(id:string):void;assertMutationScope(id:string):void;close():void;databaseClosed():void;
}
export interface CapturedCanonicalSourceState {
 readonly kind:'captured-canonical-store-state-component';readonly storeId:string;readonly profileId:string;readonly storeProfileBindingId:string;
 readonly deviceIdentityHash:string;readonly deviceId:string;readonly deviceLogicalProfileId:string;
 readonly conversationIds:readonly string[];readonly policyHash:string;readonly publicationHash:string;
 readonly capturedStoreHead:Readonly<{sequence:number;hash:string}>;readonly capturedStickyHash:string;
}
export type CapturedCanonicalSourceDraft=Omit<CapturedCanonicalSourceState,'kind'>&{readonly kind:'captured-canonical-store-draft-component'};
const sourceDrafts=new WeakMap<object,{store:ContinuityStore;device:DesktopSyncDevice;assert:()=>CapturedCanonicalSourceDraft}>();
const sourceStates=new WeakMap<object,{store:ContinuityStore;device:DesktopSyncDevice;assert:()=>CapturedCanonicalSourceState}>();
type Bootstrap={services:object;draft:object;controls:unknown;metadata:DesktopCanonicalSourceDraftMetadata;stage:object;expected:CanonicalStoreState;stageId:string;row:CanonicalSourceIntentRow;markers?:Data;friend:typeof import('./sync-canonical-source-friend.js')};
const bootstrapStages=new WeakMap<object,{store:ContinuityStore;device:DesktopSyncDevice;services:object;draft:object;assert:()=>void}>();
const bootstrapPosts=new WeakMap<object,{store:ContinuityStore;device:DesktopSyncDevice;finish:(services:object,draft:object,controls:unknown)=>object;abort:()=>void}>();
const owners=new WeakMap<CanonicalStoreSyncOwner,ContinuityStore>(),reservations=new Map<DesktopSyncDevice,CanonicalOwner>();
const stable=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const hash=(value:unknown)=>createHash('sha256').update(stable(value)).digest('hex');
const unavailable=(reason:string)=>new ContinuityPolicyUnavailable(reason);
const local=(kind:string,scope:CanonicalSyncScope,...ids:unknown[])=>'sync_'+kind+'_'+hash(['xiaok/canonical-origin-local/v1',kind,scope,...ids]);
const localRef=(scope:CanonicalSyncScope,id:string)=>createHash('sha256').update(stable(['xiaok/canonical-origin-local/v1','ref',scope,id])).digest('base64url').slice(0,32);
const equal=(a:unknown,b:unknown)=>stable(a)===stable(b);
const factSubject=(fact:CanonicalStickyFact)=>stable(fact.kind==='dependency'?[fact.kind,fact.table,fact.taskId,fact.sourceId]:[fact.kind,fact.id]);

class CanonicalOwner {
 readonly channel:OriginalCanonicalStoreChannel;readonly device:DesktopSyncDevice;
 readonly bindingIds:{storeId:string;profileId:string};readonly facade:CanonicalStoreSyncOwner;
 #sourceNeedsReconcile=false;#bootstrap?:Bootstrap;
 #closed=false;#busy=false;#state:CanonicalStoreState;#commit:object;
 #base?:{state:CanonicalStoreState;fact:Data};#pending?:{state:CanonicalStoreState;fact:Data};
 #incoming?:unknown;#batches:ReadonlyArray<Readonly<CanonicalSyncBatch>>=[];
 #publication?:{commit:object;incoming:unknown;head:unknown;state:CanonicalStoreState};
 #importing=false;#anchor?:Data;#grantTargets=new Map<string,string>();#grantOrigins=new Map<string,string>();
 constructor(store:ContinuityStore,token:object,device:DesktopSyncDevice){
  this.channel=claimOriginalCanonicalStoreChannel(store,token);this.device=device;assertDesktopSyncDevice(device);
  if(reservations.has(device))throw unavailable('canonical_device_already_bound');
  this.bindingIds={storeId:this.channel.storeId,profileId:hash(['xiaok/canonical-store-profile/v1',this.channel.profileId])};
  const cap=this.channel.currentCommitted();if(!cap)throw unavailable('canonical_commit_unavailable');this.#commit=cap;this.#state=this.channel.assertCommitted(cap);
  const current=this.#fact();this.#assertPersisted(current,this.#state);this.#rememberGrantTargets();
  // A durable bootstrap intent never proves that the prior COMMIT returned.
  this.#sourceNeedsReconcile=!!this.channel.db.prepare("SELECT 1 FROM operations WHERE kind='canonicalSourceBootstrapV1' LIMIT 1").get();
  const binding=Object.freeze({importIncoming:(incoming:unknown)=>this.#import(incoming)});
  this.facade=Object.freeze({binding,captureSourceState:(device:DesktopSyncDevice,ids:readonly string[])=>this.#captureSourceState(device,ids),captureSourceDraft:(device:DesktopSyncDevice,ids:readonly string[])=>this.#captureSourceState(device,ids,true),bootstrapSource:(device:DesktopSyncDevice,services:object,draft:object,controls:unknown)=>this.#bootstrapSource(device,services,draft,controls),beforeWrite:()=>this.#beforeWrite(),prepareCommit:()=>this.#prepareCommit(),afterCommit:(cap:object)=>this.#afterCommit(cap),writeFailed:()=>{this.#publication=undefined;this.#base=undefined;this.#pending=undefined;this.#anchor=undefined;},assertScope:(id:string)=>this.#assertScope(id),assertMutationScope:(id:string)=>this.#assertMutationScope(id),close:()=>{this.#closed=true;this.#publication=undefined;},databaseClosed:()=>{if(reservations.get(device)===this)reservations.delete(device);}});
  owners.set(this.facade,store);reservations.set(device,this);
 }
 #live(){if(this.#closed)throw unavailable('canonical_store_closed');assertDesktopSyncDevice(this.device);}
 #fact():Data{this.#live();const fact=this.device.getCanonicalStoreAnchor(this.bindingIds)as Data;assertDesktopSyncStoreAnchor(this.device,fact);return fact;}
 #get(key:string):Data|undefined{const row=this.channel.db.prepare('SELECT value FROM sync_store_state WHERE key=?').get(key);return row?JSON.parse(String(row.value)):undefined;}
 #set(key:string,value:unknown){this.channel.db.prepare('INSERT OR REPLACE INTO sync_store_state VALUES (?,?)').run(key,stable(value));}
 #identity(fact:Data){return {storeId:fact.storeId,profileId:fact.profileId,identityHash:fact.identityHash,deviceId:fact.deviceId,logicalProfileId:fact.logicalProfileId};}
 #assertPersisted(fact:Data,state:CanonicalStoreState){
  const identity=this.#get('binding'),head=this.#get('head');
  if(fact.head.sequence===0){if(identity||head||this.channel.db.prepare('SELECT 1 FROM sync_scopes LIMIT 1').get())throw unavailable('canonical_store_behind');return;}
  if(!identity||!head||!equal(identity,this.#identity(fact))||!equal(head,fact.head)||fact.policyHash!==state.policyHash||fact.publicationHash!==state.publicationHash)throw unavailable('canonical_store_behind');
 }
 #sourceReady(commit:object){
  this.#live();this.channel.assertIdle();
  if(this.#busy||this.#base||this.#pending||this.#importing||commit!==this.#commit||this.channel.currentCommitted()!==commit)throw unavailable('canonical_source_state_unavailable');
 }
 #localSourceIds(ids:readonly string[]){
  for(const id of ids){const row=this.channel.db.prepare('SELECT deleted FROM conversations WHERE id=?').get(id);if(!row||row.deleted||this.channel.db.prepare('SELECT 1 FROM sync_scopes WHERE conversation_id=?').get(id)||this.channel.db.prepare('SELECT 1 FROM sync_sources WHERE conversation_id=?').get(id))throw unavailable('canonical_source_scope_unavailable');}
 }
 #assertSourceMarkers(expectedBinding:Data|undefined,expectedHead:Data|undefined){
  // These two markers are deliberately outside the semantic rowset hash. Read
  // them together and match the entire private captured identity and head.
  const markers=this.channel.db.prepare("SELECT key,value FROM sync_store_state WHERE key IN ('binding','head') ORDER BY key").all();
  if(!expectedBinding&&!expectedHead){if(markers.length)throw unavailable('canonical_source_state_changed');return;}
  try{if(markers.length!==2||markers[0].key!=='binding'||markers[1].key!=='head'||!equal(JSON.parse(String(markers[0].value)),expectedBinding)||!equal(JSON.parse(String(markers[1].value)),expectedHead))throw unavailable('canonical_source_state_changed');}
  catch{throw unavailable('canonical_source_state_changed');}
 }
 #assertSourceState(commit:object,state:CanonicalStoreState,ids:readonly string[],expectedBinding:Data|undefined,expectedHead:Data|undefined,metadata:CapturedCanonicalSourceState|CapturedCanonicalSourceDraft,draft:boolean):CapturedCanonicalSourceState|CapturedCanonicalSourceDraft{
  if(!draft&&this.#sourceNeedsReconcile)throw unavailable('canonical_source_reconcile_required');
  if(draft&&expectedHead&&!this.#sourceNeedsReconcile)throw unavailable('canonical_source_draft_unavailable');
  this.#sourceReady(commit);const current=this.channel.assertCommitted(commit);
  if(current.policyHash!==state.policyHash||current.publicationHash!==state.publicationHash)throw unavailable('canonical_source_state_changed');
  this.#localSourceIds(ids);this.channel.assertCommitted(commit);this.#assertSourceMarkers(expectedBinding,expectedHead);this.#sourceReady(commit);return metadata;
 }
 #captureSourceState(device:DesktopSyncDevice,input:readonly string[],draft=false):object{
  const commit=this.#commit;this.#sourceReady(commit);if(device!==this.device)throw unavailable('canonical_source_device_mismatch');
  if(!Array.isArray(input)||types.isProxy(input)||Object.getOwnPropertySymbols(input).length)throw unavailable('canonical_source_scope_unavailable');
  const properties=Object.getOwnPropertyDescriptors(input as object),length=properties.length.value;
  if(typeof length!=='number'||length<1||length>16||Object.keys(properties).length!==length+1)throw unavailable('canonical_source_scope_unavailable');
  const ids:string[]=[];for(let i=0;i<length;i++){const entry=properties[String(i)];if(!entry?.enumerable||!('value'in entry)||typeof entry.value!=='string'||!entry.value||entry.value.length>256||/[\u0000-\u001f]/u.test(entry.value)||ids.includes(entry.value))throw unavailable('canonical_source_scope_unavailable');ids.push(entry.value);}
  ids.sort();Object.freeze(ids);const state=this.channel.assertCommitted(commit),fact=this.#fact();
  this.#assertPersisted(fact,state);
  if(!draft&&this.#sourceNeedsReconcile)throw unavailable('canonical_source_reconcile_required');
  if(draft){if(fact.head.sequence!==0&&!this.#sourceNeedsReconcile)throw unavailable('canonical_source_draft_unavailable');this.#assertReconcileSelection(ids);}
  else if(fact.head.sequence===0||fact.policyHash!==state.policyHash||fact.publicationHash!==state.publicationHash)throw unavailable('canonical_source_state_unregistered');
  this.#localSourceIds(ids);assertDesktopSyncStoreAnchor(this.device,fact);this.channel.assertCommitted(commit);this.#sourceReady(commit);
  const metadata=Object.freeze({kind:draft?'captured-canonical-store-draft-component' as const:'captured-canonical-store-state-component' as const,storeId:this.channel.storeId,profileId:this.channel.profileId,storeProfileBindingId:this.bindingIds.profileId,deviceIdentityHash:fact.identityHash,deviceId:fact.deviceId,deviceLogicalProfileId:fact.logicalProfileId,conversationIds:ids,policyHash:state.policyHash,publicationHash:state.publicationHash,capturedStoreHead:Object.freeze({sequence:fact.head.sequence,hash:fact.head.hash}),capturedStickyHash:fact.stickyHash});
  const expectedBinding=fact.head.sequence===0?undefined:Object.freeze(this.#identity(fact)),expectedHead=fact.head.sequence===0?undefined:Object.freeze({sequence:fact.head.sequence,hash:fact.head.hash});
  this.#assertSourceMarkers(expectedBinding,expectedHead);this.#sourceReady(commit);
  const cap=Object.freeze({kind:draft?'original-canonical-store-draft-component':'original-canonical-store-state-component'});
  const entry={store:owners.get(this.facade)!,device:this.device,assert:()=>this.#assertSourceState(commit,state,ids,expectedBinding,expectedHead,metadata,draft)};
  if(draft)sourceDrafts.set(cap,entry as {store:ContinuityStore;device:DesktopSyncDevice;assert:()=>CapturedCanonicalSourceDraft});
  else sourceStates.set(cap,entry as {store:ContinuityStore;device:DesktopSyncDevice;assert:()=>CapturedCanonicalSourceState});return cap;
 }
 #assertReconcileSelection(ids:readonly string[]){
  for(const row of this.channel.db.prepare("SELECT result FROM operations WHERE kind='canonicalSourceBootstrapV1'").all()){
   let scopes:Data[];try{const value=JSON.parse(String(row.result));if(value.schemaVersion!==1||!Array.isArray(value.scopes)||value.scopes.length<1||value.scopes.length>16)throw unavailable('canonical_source_reconcile_required');scopes=value.scopes;}catch{throw unavailable('canonical_source_reconcile_required');}
   const identity=desktopCanonicalSourceIdentityData(this.device);
   for(const scope of scopes)if(scope.rootKeyId!==identity.rootKeyId||scope.syncGroupId!==identity.syncGroupId||scope.logicalProfileId!==identity.logicalProfileId||scope.branchId!=='canonical-v1'||!ids.includes(scope.conversationId))throw unavailable('canonical_source_reconcile_full_selection_required');
  }
 }
 #sourceControls(controls:unknown,metadata:DesktopCanonicalSourceDraftMetadata){
  assertDesktopSyncSourceControls(this.device,controls);const value=controls as Data,identity=desktopCanonicalSourceIdentityData(this.device);
  if(value.identityHash!==identity.identityHash||value.deviceId!==identity.deviceId||value.logicalProfileId!==identity.logicalProfileId||value.rootKeyId!==identity.rootKeyId||value.syncGroupId!==identity.syncGroupId||!Array.isArray(value.scopes)||value.scopes.length!==metadata.scopes.length)throw unavailable('canonical_source_control_scope_mismatch');
  const actual=value.scopes.map((item:Data)=>{const grant=item.grant;if(!grant||grant.ownerDeviceId!==identity.deviceId||grant.logicalProfileId!==identity.logicalProfileId||grant.rootKeyId!==identity.rootKeyId||grant.syncGroupId!==identity.syncGroupId||grant.conversationId!==item.scope.conversationId||grant.branchId!==item.scope.branchId)throw unavailable('canonical_source_control_scope_mismatch');return {rootKeyId:identity.rootKeyId,syncGroupId:identity.syncGroupId,logicalProfileId:identity.logicalProfileId,conversationId:item.scope.conversationId,branchId:item.scope.branchId};});
  if(new Set(actual.map(stable)).size!==actual.length||!equal(actual.map(stable).sort(),metadata.scopes.map(stable).sort()))throw unavailable('canonical_source_control_scope_mismatch');
 }
 #assertBootstrapStage(){
  const stage=this.#bootstrap;if(!stage)throw unavailable('canonical_metadata_stage_unavailable');
  this.channel.assertMetadataStage(stage.stage);
  stage.friend.assertSourceDraftMetadataStage(owners.get(this.facade)!,this.device,stage.services,stage.draft,stage.stage);
  this.#sourceControls(stage.controls,stage.metadata);
  // Last native check can run user-OS callbacks. Recheck real original files,
  // full semantic SQL and both excluded markers AFTER it, before returning.
  stage.friend.assertSourceDraftMetadataStage(owners.get(this.facade)!,this.device,stage.services,stage.draft,stage.stage);
  const state=this.channel.capture();if(state.policyHash!==stage.expected.policyHash||state.publicationHash!==stage.expected.publicationHash)throw unavailable('canonical_source_metadata_changed');
  const fact=stage.markers??this.#base?.fact;if(!fact)throw unavailable('canonical_metadata_stage_unavailable');
  this.#assertSourceMarkers(fact.head.sequence===0?undefined:this.#identity(fact),fact.head.sequence===0?undefined:fact.head);this.channel.assertMetadataStage(stage.stage);
 }
 async #bootstrapSource(device:DesktopSyncDevice,services:object,draft:object,controls:unknown):Promise<object>{
  if(device!==this.device)throw unavailable('canonical_source_device_mismatch');
  const friend=await import('./sync-canonical-source-friend.js');
  const store=owners.get(this.facade)!,metadata=friend.assertSourceDraft(store,device,services,draft),commit=this.#commit;
  this.#sourceReady(commit);this.#sourceControls(controls,metadata);const state=this.channel.assertCommitted(commit),base=this.#fact();this.#assertPersisted(base,state);
  if(metadata.storeState.storeId!==this.bindingIds.storeId||metadata.storeState.storeProfileBindingId!==this.bindingIds.profileId||metadata.storeState.policyHash!==state.policyHash||metadata.storeState.publicationHash!==state.publicationHash||!equal(metadata.storeState.capturedStoreHead,base.head))throw unavailable('canonical_source_bootstrap_mismatch');
  friend.assertSourceDraft(store,device,services,draft);this.#sourceControls(controls,metadata);this.channel.assertCommitted(commit);this.#sourceReady(commit);
  const purpose=base.head.sequence===0?'bootstrap':'reconcile',stageId=hash(['xiaok/canonical-source-stage/v1',this.bindingIds,base.head,metadata.scopes,metadata.manifestHash,metadata.payloadHashes,hash(controls)]);
  const value={schemaVersion:1,purpose,stageId,...this.bindingIds,baseHead:base.head,scopes:metadata.scopes,manifestHash:metadata.manifestHash,payloadHashes:metadata.payloadHashes,controlHash:hash(controls)},row=Object.freeze({kind:purpose==='bootstrap'?'canonicalSourceBootstrapV1':'canonicalSourceReconcileV1',id:stageId,request_hash:digest(value),result:JSON.stringify(value)});
  const expected=captureCanonicalStoreStateWithSourceIntent(this.channel.db,row),stage=this.channel.stage(hash(value));
  const active:Bootstrap={services,draft,controls,metadata,stage,expected:state,stageId,row,friend};
  this.#sourceNeedsReconcile=true;this.#busy=true;this.#bootstrap=active;
  bootstrapStages.set(stage,{store,device,services,draft,assert:()=>{if(this.#bootstrap!==active||!this.#sourceNeedsReconcile)throw unavailable('canonical_metadata_stage_unavailable');this.channel.assertMetadataStage(stage);}});
  try{
   this.channel.importStage(stage,()=>{
    this.#assertBootstrapStage();
    if(purpose==='bootstrap'){
     const fact=this.device.recordCanonicalSourceStoreAnchor(controls,{...this.bindingIds,stageId,manifestHash:metadata.manifestHash,baseHead:base.head})as Data;
     assertDesktopSyncStoreAnchor(this.device,fact);this.#anchor=fact;this.#assertBootstrapStage();
    }
    this.channel.db.prepare('INSERT INTO operations VALUES (?,?,?,?)').run(row.kind,row.id,row.request_hash,row.result);active.expected=expected;this.#assertBootstrapStage();
   });
   const postCommit=this.#commit;this.channel.assertCommitted(postCommit);const token=Object.freeze({kind:'original-canonical-source-post-commit'});let attempted=false;
   bootstrapPosts.set(token,{store,device,abort:()=>{attempted=true;this.#sourceNeedsReconcile=true;},finish:(actualServices,actualDraft,actualControls)=>{
    if(attempted||actualServices!==services||actualControls!==controls||!this.#sourceNeedsReconcile)throw unavailable('canonical_source_bootstrap_unavailable');attempted=true;
    this.#sourceReady(postCommit);const next=friend.assertSourceDraft(store,device,services,actualDraft);this.#sourceControls(controls,next);const current=this.channel.assertCommitted(postCommit),fact=this.#fact();this.#assertPersisted(fact,current);
    if(!equal(next.scopes,metadata.scopes)||next.manifestHash!==metadata.manifestHash||!equal(next.payloadHashes,metadata.payloadHashes)||next.storeState.policyHash!==current.policyHash||next.storeState.publicationHash!==current.publicationHash||!equal(next.storeState.capturedStoreHead,fact.head))throw unavailable('canonical_source_bootstrap_mismatch');
    friend.assertSourceDraft(store,device,services,actualDraft);this.#sourceControls(controls,next);this.channel.assertCommitted(postCommit);this.#sourceReady(postCommit);
    this.#sourceNeedsReconcile=false;
    try{return this.#captureSourceState(device,next.storeState.conversationIds);}catch(error){this.#sourceNeedsReconcile=true;throw error;}
   }});return token;
  }catch(error){this.#sourceNeedsReconcile=true;throw error;}
  finally{bootstrapStages.delete(stage);this.#bootstrap=undefined;this.#busy=false;}
 }
 #beforeWrite(){
  this.#live();this.#publication=undefined;this.#pending=undefined;this.#anchor=undefined;
  const state=this.channel.capture(),fact=this.#fact();
  if(state.policyHash!==this.#state.policyHash||state.publicationHash!==this.#state.publicationHash)throw unavailable('canonical_rows_changed');
  this.#assertPersisted(fact,state);this.#base={state,fact};
 }
 #prepareCommit(){
  this.#live();const base=this.#base;if(!base)throw unavailable('canonical_write_base_unavailable');
  if(this.#batches.length)this.#validateOrigins();
  if(this.#bootstrap)this.#assertBootstrapStage();
  const state=this.channel.capture();let fact=this.#fact();if(this.#bootstrap)this.#assertBootstrapStage();
  if(!equal(fact.head,this.#anchor?.head??base.fact.head))throw unavailable('canonical_store_head_changed');
  if(fact.head.sequence===0){if(this.channel.db.prepare('SELECT 1 FROM sync_scopes LIMIT 1').get())throw unavailable('canonical_stage_unavailable');this.#pending={state,fact};return;}
  const previous=new Map(base.state.stickyFacts.map(value=>[factSubject(value),value.revision]));
  const facts=fact.policyHash===null?state.stickyFacts:state.stickyFacts.filter(value=>(previous.get(factSubject(value))??0)<value.revision);
  // Never allow a transaction to erase a known durable negative fact.
  const next=new Map(state.stickyFacts.map(value=>[factSubject(value),value.revision]));for(const [id,revision]of previous)if((next.get(id)??0)<revision)throw unavailable('canonical_sticky_fact_removed');
  if(fact.policyHash!==state.policyHash||fact.publicationHash!==state.publicationHash||facts.length){
   for(let at=0;at<Math.max(1,facts.length);at+=128){
    const prepared=this.device.recordCanonicalStorePolicy({...this.bindingIds,operationId:randomUUID(),baseHead:fact.head,policyHash:state.policyHash,publicationHash:state.publicationHash,stickyFacts:facts.slice(at,at+128)})as Data;
    assertDesktopSyncStoreAnchor(this.device,prepared);fact=this.#fact();if(this.#bootstrap)this.#assertBootstrapStage();if(!equal(fact.head,prepared.head))throw unavailable('canonical_store_head_changed');
   }
  }
  this.#set('binding',this.#identity(fact));this.#set('head',fact.head);if(this.#bootstrap){this.#bootstrap.markers=fact;this.#assertBootstrapStage();}this.#pending={state,fact};
 }
 #afterCommit(cap:object){
  this.#live();const pending=this.#pending;if(!pending)throw unavailable('canonical_commit_unavailable');
  const state=this.channel.assertCommitted(cap),fact=this.#fact();
  if(state.policyHash!==pending.state.policyHash||state.publicationHash!==pending.state.publicationHash||!equal(fact.head,pending.fact.head))throw unavailable('canonical_commit_unavailable');
  this.#assertPersisted(fact,state);this.#rememberGrantTargets();this.channel.assertCommitted(cap);this.#state=state;this.#commit=cap;this.#base=undefined;this.#pending=undefined;
  if(this.#incoming){try{assertDesktopSyncIncoming(this.device,this.#incoming);this.#publication={commit:cap,incoming:this.#incoming,head:fact.head,state};}catch{/* policy COMMIT remains a fact, without readable publication */}}
 }
 #assertCommon(){
  this.#live();const proof=this.#publication;if(!proof||proof.commit!==this.#commit)throw unavailable('canonical_publication_unavailable');
  assertDesktopSyncIncoming(this.device,proof.incoming);const state=this.channel.assertCommitted(proof.commit),fact=this.#fact();
  if(state.policyHash!==proof.state.policyHash||state.publicationHash!==proof.state.publicationHash||!equal(fact.head,proof.head))throw unavailable('canonical_publication_changed');
  this.#assertPersisted(fact,state);this.#validateOrigins();assertDesktopSyncIncoming(this.device,proof.incoming);this.channel.assertCommitted(proof.commit);
  if(this.#publication!==proof)throw unavailable('canonical_publication_changed');
 }
 #assertScope(id:string){
  this.#assertCommon();this.#assertScopeDependencies(id,new Set());this.#assertCommon();
 }
 #assertScopeDependencies(id:string,seen:Set<string>){
  if(seen.has(id))return;if(seen.size>=16)throw unavailable('canonical_dependency_unavailable');seen.add(id);
  const row=this.channel.db.prepare('SELECT s.*,c.deleted FROM sync_scopes s JOIN conversations c ON c.id=s.conversation_id WHERE s.conversation_id=?').get(id);
  if(!row||row.deleted)throw definitivePolicyDenial();if(this.channel.db.prepare("SELECT 1 FROM sync_revocations WHERE origin_scope=? AND kind='dependency'").get(String(row.origin_scope)))throw definitivePolicyDenial();const scope=JSON.parse(String(row.origin_scope))as CanonicalSyncScope,batch=this.#batches.find(value=>equal(value.scope,scope));
  if(!batch||row.manifest_hash!==batch.manifestHash)throw unavailable('canonical_candidate_unavailable');
  for(const message of batch.messages){if(this.channel.db.prepare('SELECT deleted FROM message_anchors WHERE id=?').get(local('message',batch.scope,message.messageId))?.deleted)continue;for(const version of message.versions)for(const dep of version.dependencies){
   const ancestor=local('conversation',dep.scope);this.#assertScopeDependencies(ancestor,seen);for(const entry of dep.versions){const source=this.channel.db.prepare('SELECT deleted FROM message_anchors WHERE id=?').get(local('message',dep.scope,entry.messageId));if(!source||source.deleted)throw definitivePolicyDenial();}
   if(dep.kind==='reference'){
    if(this.#revoked(dep.scope,'reference',dep.reference.refId))throw definitivePolicyDenial();
    const grant=this.channel.db.prepare('SELECT g.revoked,g.revision,g.target_conversation,s.origin_revision,s.target_scope FROM sync_grants s JOIN read_grants g ON g.id=s.local_grant_id WHERE s.local_grant_id=?').get(local('grant',dep.scope,dep.reference.grantId));
    if(!grant||grant.revoked||grant.revision!==dep.reference.grantRevision||grant.origin_revision!==dep.reference.grantRevision||grant.target_conversation!==id||!equal(JSON.parse(String(grant.target_scope)),batch.scope))throw definitivePolicyDenial();
   }
  }}
 }
 #assertMutationScope(id:string){
  this.#live();const base=this.#base;if(!base||!this.#incoming)throw unavailable('canonical_mutation_base_unavailable');
  assertDesktopSyncIncoming(this.device,this.#incoming);const fact=this.#fact();if(!equal(fact.head,base.fact.head))throw unavailable('canonical_mutation_base_changed');
  const row=this.channel.db.prepare('SELECT deleted FROM conversations WHERE id=?').get(id);if(!row||row.deleted)throw definitivePolicyDenial();this.#assertScopeDependencies(id,new Set());
 }
 #revoked(scope:CanonicalSyncScope,kind:string,id:string):boolean{return !!this.channel.db.prepare('SELECT 1 FROM sync_revocations WHERE origin_scope=? AND kind=? AND origin_id=?').get(stable(scope),kind,id);}
 #recordRemoteRevocations(view:Data,batches:ReadonlyArray<Readonly<CanonicalSyncBatch>>){
  const db=this.channel.db;
  for(const record of view.control.revocations){const rev=record.body;if(rev.type!=='content')continue;
   if(rev.rootKeyId!==view.rootKeyId||rev.syncGroupId!==view.syncGroupId)throw unavailable('canonical_revocation_scope_mismatch');
   for(const batch of batches){if(batch.scope.conversationId!==rev.conversationId||batch.scope.branchId!==rev.branchId)continue;const scope=stable(batch.scope);
    for(const target of rev.targets){
     if(!['conversation','message','reference','grant','dependency'].includes(target.kind))throw unavailable('canonical_revocation_kind_unavailable');
     const id=target.kind==='conversation'||target.kind==='dependency'?local('conversation',batch.scope):target.kind==='reference'?localRef(batch.scope,target.id):local(target.kind,batch.scope,target.id),prior=db.prepare('SELECT revision,record_hash FROM sync_revocations WHERE origin_scope=? AND kind=? AND origin_id=?').get(scope,target.kind,target.id),recordHash=hash(record);
     if(prior&&Number(prior.revision)>rev.sequence)continue;if(prior&&Number(prior.revision)===rev.sequence){if(prior.record_hash!==recordHash)throw unavailable('canonical_revocation_conflict');continue;}
     db.prepare('INSERT OR REPLACE INTO sync_revocations VALUES (?,?,?,?,?,?)').run(scope,target.kind,target.id,id,rev.sequence,recordHash);
     db.prepare('UPDATE conversations SET policy_revision=policy_revision+1 WHERE id=?').run(local('conversation',batch.scope));
    }
   }
  }
 }
 #grantIdentity(row:Data):string{return stable([row.conversation_id,row.origin_id,row.target_scope,row.ref_id,row.target_conversation]);}
 #rememberGrantTargets(){const rows=this.channel.db.prepare('SELECT s.*,g.ref_id,g.target_conversation FROM sync_grants s JOIN read_grants g ON g.id=s.local_grant_id').all();this.#grantTargets=new Map(rows.map(row=>[String(row.local_grant_id),String(row.target_scope)]));this.#grantOrigins=new Map(rows.map(row=>[String(row.local_grant_id),this.#grantIdentity(row)]));}
 #checkCoverage(batches:ReadonlyArray<Readonly<CanonicalSyncBatch>>){
  const db=this.channel.db;
  for(const batch of batches){
   const id=local('conversation',batch.scope),messages=new Map(batch.messages.map(message=>[message.messageId,message]));
   for(const row of db.prepare('SELECT s.origin_message_id,s.revision,s.origin_hash FROM sync_versions s JOIN message_anchors a ON a.id=s.message_id WHERE a.conversation_id=?').all(id)){
    const message=messages.get(String(row.origin_message_id)),version=message?.versions[Number(row.revision)-1];if(!version||version.originHash!==row.origin_hash)throw unavailable('canonical_snapshot_coverage_changed');
   }
   for(const row of db.prepare('SELECT origin_ref_id FROM sync_refs WHERE conversation_id=?').all(id))if(!batch.references.some(ref=>ref.refId===row.origin_ref_id))throw unavailable('canonical_snapshot_coverage_changed');
   for(const row of db.prepare('SELECT origin_id FROM sync_grants WHERE conversation_id=?').all(id))if(!batch.grants.some(grant=>grant.grantId===row.origin_id))throw unavailable('canonical_snapshot_coverage_changed');
  }
 }
 #validateOrigins(){
  const db=this.channel.db;
  for(const [id,identity]of this.#grantOrigins){const row=db.prepare('SELECT s.*,g.ref_id,g.target_conversation FROM sync_grants s JOIN read_grants g ON g.id=s.local_grant_id WHERE s.local_grant_id=?').get(id);if(!row||this.#grantIdentity(row)!==identity)throw unavailable('canonical_origin_grant_rebound');}
  for(const batch of this.#batches){
   const id=local('conversation',batch.scope),scope=db.prepare('SELECT origin_scope,manifest_hash FROM sync_scopes WHERE conversation_id=?').get(id);if(!scope||scope.origin_scope!==stable(batch.scope)||scope.manifest_hash!==batch.manifestHash)throw unavailable('canonical_origin_mismatch');
   if(db.prepare('SELECT COUNT(*) AS n FROM message_anchors WHERE conversation_id=?').get(id)!.n!==batch.messages.length||db.prepare('SELECT COUNT(*) AS n FROM sync_refs WHERE conversation_id=?').get(id)!.n!==batch.references.length)throw unavailable('canonical_origin_coverage_mismatch');
   if(db.prepare('SELECT 1 FROM task_bindings WHERE conversation_id=?').get(id)||db.prepare('SELECT 1 FROM conversation_execution WHERE conversation_id=?').get(id))throw unavailable('canonical_import_execution_conflict');
   const sources=new Set<string>();let count=0;
   for(const message of batch.messages){
    const mid=local('message',batch.scope,message.messageId),sid=local('source',batch.scope,message.sourceKind,message.sourceId,message.sourceEpoch),anchor=db.prepare('SELECT * FROM message_anchors WHERE id=?').get(mid),source=db.prepare('SELECT * FROM sync_sources WHERE local_source_id=?').get(sid);sources.add(sid);
    if(!anchor||anchor.conversation_id!==id||anchor.sequence!==message.sequence||anchor.source_kind!==message.sourceKind||anchor.source_id!==sid||anchor.source_epoch!==message.sourceEpoch||anchor.source_message_id!==message.sourceMessageId||anchor.latest_revision!==message.versions.length||anchor.execution_state!=='unknown'||![0,1].includes(Number(anchor.deleted)))throw unavailable('canonical_origin_mismatch');
    if(!source||source.conversation_id!==id||source.source_kind!==message.sourceKind||source.origin_id!==message.sourceId||source.origin_epoch!==message.sourceEpoch||db.prepare('SELECT conversation_id FROM source_bindings WHERE kind=? AND id=? AND epoch=?').get(message.sourceKind,sid,message.sourceEpoch)?.conversation_id!==id)throw unavailable('canonical_origin_mismatch');
    if(db.prepare('SELECT COUNT(*) AS n FROM message_versions WHERE message_id=?').get(mid)!.n!==message.versions.length)throw unavailable('canonical_origin_coverage_mismatch');
    for(const version of message.versions){
     count++;const row=db.prepare('SELECT v.source_revision,v.record,s.origin_message_id,s.origin_hash,s.dependencies FROM message_versions v JOIN sync_versions s ON s.message_id=v.message_id AND s.revision=v.revision WHERE v.message_id=? AND v.revision=?').get(mid,version.revision);
     if(!row||row.source_revision!==version.sourceRevision||row.origin_message_id!==message.messageId||row.origin_hash!==version.originHash||row.dependencies!==stable(version.dependencies))throw unavailable('canonical_origin_mismatch');
     const expected:ContinuityMessage={messageId:mid,revision:version.revision,sequence:message.sequence,role:version.role,text:version.text,contentHash:version.contentHash,sourceKind:message.sourceKind,sourceId:sid,sourceMessageId:message.sourceMessageId,observedAt:version.observedAt,executionState:'unknown'};
     if(anchor.deleted?String(row.record)!=='{}':!equal(JSON.parse(String(row.record)),expected))throw unavailable('canonical_origin_body_mismatch');
    }
   }
   if(db.prepare('SELECT COUNT(*) AS n FROM sync_sources WHERE conversation_id=?').get(id)!.n!==sources.size||db.prepare('SELECT COUNT(*) AS n FROM sync_versions s JOIN message_anchors a ON a.id=s.message_id WHERE a.conversation_id=?').get(id)!.n!==count)throw unavailable('canonical_origin_coverage_mismatch');
   for(const ref of batch.references){
    const rid=localRef(batch.scope,ref.refId),row=db.prepare('SELECT r.*,s.conversation_id AS origin_conversation,s.origin_ref_id,s.origin_hash FROM context_refs r JOIN sync_refs s ON s.local_ref_id=r.id WHERE r.id=?').get(rid),entries=ref.entries.map(entry=>[local('message',batch.scope,entry.messageId),entry.revision,entry.contentHash]);
    if(!row||row.conversation_id!==id||row.origin_conversation!==id||row.origin_ref_id!==ref.refId||row.origin_hash!==ref.contentHash||row.snapshot_revision!==ref.snapshotRevision||row.content_hash!==digest(entries))throw unavailable('canonical_origin_reference_mismatch');
    const actual=db.prepare('SELECT position,message_id,revision FROM context_ref_entries WHERE ref_id=? ORDER BY position').all(rid);if(actual.length!==entries.length||actual.some((entry,i)=>entry.position!==i||entry.message_id!==entries[i][0]||entry.revision!==entries[i][1]))throw unavailable('canonical_origin_reference_mismatch');
   }
   if(db.prepare('SELECT 1 FROM sync_grants s LEFT JOIN read_grants g ON g.id=s.local_grant_id WHERE s.conversation_id=? AND g.id IS NULL LIMIT 1').get(id))throw unavailable('canonical_origin_grant_mismatch');
   for(const stored of db.prepare('SELECT s.*,g.ref_id,g.target_conversation,g.revision,g.revoked FROM sync_grants s JOIN read_grants g ON g.id=s.local_grant_id WHERE s.conversation_id=?').all(id)){
    const grant=batch.grants.find(value=>value.grantId===stored.origin_id);if(!grant||stored.local_grant_id!==local('grant',batch.scope,grant.grantId)||stored.ref_id!==localRef(batch.scope,grant.refId)||stored.origin_revision!==grant.revision)throw unavailable('canonical_origin_grant_mismatch');
    const target=JSON.parse(String(stored.target_scope))as CanonicalSyncScope,known=this.#grantTargets.get(String(stored.local_grant_id));
    if(known!==undefined?known!==stable(target):!this.#importing||this.#batches.filter(value=>value.scope.conversationId===grant.targetConversationId).length!==1||!this.#batches.some(value=>equal(value.scope,target)))throw unavailable('canonical_origin_grant_target_mismatch');
    if(target.rootKeyId!==batch.scope.rootKeyId||target.syncGroupId!==batch.scope.syncGroupId||target.logicalProfileId!==batch.scope.logicalProfileId||target.conversationId!==grant.targetConversationId||stored.target_conversation!==local('conversation',target)||db.prepare('SELECT origin_scope FROM sync_scopes WHERE conversation_id=?').get(String(stored.target_conversation))?.origin_scope!==stable(target))throw unavailable('canonical_origin_grant_target_mismatch');
    if(![0,1].includes(Number(stored.revoked))||(stored.revoked?Number(stored.revision)<grant.revision:stored.revision!==grant.revision||grant.revoked||this.#revoked(batch.scope,'grant',grant.grantId)))throw unavailable('canonical_origin_grant_mismatch');
   }

  }
 }
 #selected(incoming:unknown):ReadonlyArray<Readonly<CanonicalSyncBatch>>{
  assertDesktopSyncIncoming(this.device,incoming);const view=incoming as Data;
  return validateCanonicalBundle(view.scopes.map((item:Data)=>{
   const expected:CanonicalSyncScope={rootKeyId:view.rootKeyId,syncGroupId:view.syncGroupId,logicalProfileId:view.logicalProfileId,conversationId:item.scope.conversationId,branchId:item.scope.branchId};
   if(item.scope.logicalProfileId!==view.logicalProfileId||item.candidate.header.eventType!=='canonical-snapshot-v1'||item.candidate.header.conversationId!==expected.conversationId||item.candidate.header.branchId!==expected.branchId)throw unavailable('canonical_scope_mismatch');
   return validateCanonicalBatch(item.candidate.payload,expected);
  }));
 }
 #import(incoming:unknown):{conversationIds:string[]}{
  this.#live();if(this.#busy)throw unavailable('canonical_import_busy');this.#busy=true;
  const previousIncoming=this.#incoming,previousBatches=this.#batches;
  try{
   const batches=this.#selected(incoming);this.#checkCoverage(batches);const view=incoming as Data,planHash=hash(batches.map(batch=>[batch.scope,batch.manifestHash])),stage=this.channel.stage(planHash),stageId=randomUUID();
   const current=this.#fact();this.#assertPersisted(current,this.channel.capture());
   this.#incoming=incoming;this.#batches=batches;this.#importing=true;
   this.channel.importStage(stage,()=>{
    this.channel.assertStage(stage);assertDesktopSyncIncoming(this.device,incoming);
    const anchored=this.device.recordCanonicalStoreAnchor(incoming,{...this.bindingIds,stageId,manifestHash:planHash,baseHead:current.head})as Data;assertDesktopSyncStoreAnchor(this.device,anchored);this.#anchor=anchored;
    this.#recordRemoteRevocations(view,batches);this.#apply(batches,view,stageId);assertDesktopSyncIncoming(this.device,incoming);this.channel.assertStage(stage);
   });
   this.#assertCommon();return {conversationIds:batches.map(batch=>local('conversation',batch.scope))};
  }catch(error){this.#publication=undefined;this.#incoming=previousIncoming;this.#batches=previousBatches;throw error;}
  finally{this.#busy=false;this.#importing=false;}
 }
 #apply(batches:ReadonlyArray<Readonly<CanonicalSyncBatch>>,view:Data,stageId:string){
  const db=this.channel.db;
  // Install all scope identities before cross-scope refs/grants. A grant's
  // target must have exactly one selected full scope; ambiguity always denies.
  for(const batch of batches){
   const id=local('conversation',batch.scope),prior=db.prepare('SELECT deleted FROM conversations WHERE id=?').get(id),scopeRevoked=this.#revoked(batch.scope,'conversation',batch.scope.conversationId);if(prior?.deleted&&!scopeRevoked)throw definitivePolicyDenial();
   const candidate=view.scopes.find((item:Data)=>item.scope.conversationId===batch.scope.conversationId&&item.scope.branchId===batch.scope.branchId);
   const c:ContinuityConversation={id,...batch.conversation,status:'idle',starred:false,gtdBucket:'inbox',pinnedAt:null,currentTaskId:null,taskIds:[]};
   if(!prior)db.prepare('INSERT INTO conversations(id,record) VALUES (?,?)').run(id,JSON.stringify(c));if(scopeRevoked)db.prepare('UPDATE conversations SET record=?,deleted=1 WHERE id=?').run(JSON.stringify({id}),id);
   db.prepare('INSERT OR REPLACE INTO sync_scopes VALUES (?,?,?,?,?)').run(id,stable(batch.scope),batch.manifestHash,candidate.candidate.eventHash,stageId);
   for(const message of batch.messages){
    const messageId=local('message',batch.scope,message.messageId),sourceId=local('source',batch.scope,message.sourceKind,message.sourceId,message.sourceEpoch),anchor=db.prepare('SELECT * FROM message_anchors WHERE id=?').get(messageId),messageRevoked=scopeRevoked||this.#revoked(batch.scope,'message',message.messageId);if(anchor?.deleted&&!messageRevoked)throw definitivePolicyDenial();
    const source=db.prepare('SELECT * FROM sync_sources WHERE local_source_id=?').get(sourceId);if(source&&(source.conversation_id!==id||source.origin_id!==message.sourceId||source.origin_epoch!==message.sourceEpoch||source.source_kind!==message.sourceKind))throw unavailable('canonical_source_conflict');
    db.prepare('INSERT OR IGNORE INTO sync_sources VALUES (?,?,?,?,?)').run(sourceId,id,message.sourceKind,message.sourceId,message.sourceEpoch);db.prepare('INSERT OR IGNORE INTO source_bindings VALUES (?,?,?,?)').run(message.sourceKind,sourceId,message.sourceEpoch,id);
    if(!anchor)db.prepare('INSERT INTO message_anchors VALUES (?,?,?,?,?,?,?,?,?,0)').run(messageId,id,message.sequence,message.sourceKind,sourceId,message.sourceEpoch,message.sourceMessageId,message.versions.length,'unknown');
    else if(anchor.conversation_id!==id||anchor.sequence!==message.sequence||anchor.source_id!==sourceId||anchor.source_epoch!==message.sourceEpoch||anchor.source_message_id!==message.sourceMessageId||Number(anchor.latest_revision)>message.versions.length)throw unavailable('canonical_source_conflict');
    for(const version of message.versions){
     const record:ContinuityMessage={messageId,revision:version.revision,sequence:message.sequence,role:version.role,text:version.text,contentHash:version.contentHash,sourceKind:message.sourceKind,sourceId,sourceMessageId:message.sourceMessageId,observedAt:version.observedAt,executionState:'unknown'};
     const priorVersion=db.prepare('SELECT v.source_revision,v.record,s.origin_hash FROM message_versions v LEFT JOIN sync_versions s ON s.message_id=v.message_id AND s.revision=v.revision WHERE v.message_id=? AND v.revision=?').get(messageId,version.revision);
     if(priorVersion){const previous=JSON.parse(String(priorVersion.record));if(priorVersion.source_revision!==version.sourceRevision||priorVersion.origin_hash!==version.originHash||!messageRevoked&&(previous.contentHash!==record.contentHash||previous.text!==record.text||previous.role!==record.role))throw unavailable('canonical_immutable_conflict');if(!equal(previous,messageRevoked?{}:record))db.prepare('UPDATE message_versions SET record=? WHERE message_id=? AND revision=?').run(JSON.stringify(messageRevoked?{}:record),messageId,version.revision);}
     else{db.prepare('INSERT INTO message_versions VALUES (?,?,?,?)').run(messageId,version.revision,version.sourceRevision,JSON.stringify(messageRevoked?{}:record));db.prepare('INSERT INTO sync_versions VALUES (?,?,?,?,?)').run(messageId,version.revision,message.messageId,version.originHash,stable(version.dependencies));}
    }
    db.prepare("UPDATE message_anchors SET latest_revision=?,execution_state='unknown',deleted=? WHERE id=?").run(message.versions.length,messageRevoked?1:0,messageId);
   }
   for(const ref of batch.references){
    const refId=localRef(batch.scope,ref.refId),entries=ref.entries.map(entry=>[local('message',batch.scope,entry.messageId),entry.revision,entry.contentHash]),contentHash=digest(entries),priorRef=db.prepare('SELECT * FROM context_refs WHERE id=?').get(refId);
    if(priorRef){if(priorRef.conversation_id!==id||priorRef.snapshot_revision!==ref.snapshotRevision||priorRef.content_hash!==contentHash)throw unavailable('canonical_reference_conflict');}
    else{db.prepare('INSERT INTO context_refs VALUES (?,?,?,?)').run(refId,id,ref.snapshotRevision,contentHash);entries.forEach((entry,position)=>db.prepare('INSERT INTO context_ref_entries VALUES (?,?,?,?)').run(refId,position,String(entry[0]),Number(entry[1])));db.prepare('INSERT INTO sync_refs VALUES (?,?,?,?)').run(refId,id,ref.refId,ref.contentHash);}
   }
  }
  for(const batch of batches)for(const grant of batch.grants){
   const targets=batches.filter(value=>value.scope.conversationId===grant.targetConversationId);if(targets.length>1)throw unavailable('canonical_grant_target_ambiguous');if(!targets.length)continue;
   const target=targets[0].scope,id=local('grant',batch.scope,grant.grantId),refId=localRef(batch.scope,grant.refId),targetId=local('conversation',target),remoteRevoked=this.#revoked(batch.scope,'grant',grant.grantId),revoked=grant.revoked||remoteRevoked,existing=db.prepare('SELECT * FROM read_grants WHERE id=?').get(id);
   if(existing){if(existing.ref_id!==refId||existing.target_conversation!==targetId||existing.revoked&&!revoked||Number(existing.revision)>grant.revision&&!remoteRevoked)throw definitivePolicyDenial();db.prepare('UPDATE read_grants SET revoked=?,revision=? WHERE id=?').run(revoked?1:0,Math.max(grant.revision,Number(existing.revision)),id);}
   else db.prepare('INSERT INTO read_grants VALUES (?,?,?,?,?)').run(id,refId,targetId,grant.revision,revoked?1:0);
   db.prepare('INSERT OR REPLACE INTO sync_grants VALUES (?,?,?,?,?)').run(id,local('conversation',batch.scope),grant.grantId,grant.revision,stable(target));
  }
 }
}

/** Fixed original-store factory only. No caller guard/provider or verified DTO. */
export function createCanonicalStoreSyncOwner(store:ContinuityStore,token:object,device:DesktopSyncDevice):CanonicalStoreSyncOwner{return new CanonicalOwner(store,token,device).facade;}
export function assertOriginalCanonicalStoreSyncOwner(store:ContinuityStore,owner:CanonicalStoreSyncOwner):void{if(owners.get(owner)!==store)throw unavailable('canonical_store_binding_unavailable');}

/** Exact committed Store COMPONENT. Captured OS metadata must still be joined
 * with the original raw job's current private OS/control proof at final sinks. */
export function assertOriginalCanonicalSourceState(store:ContinuityStore,device:DesktopSyncDevice,cap:object):CapturedCanonicalSourceState{const entry=sourceStates.get(cap);if(!entry||entry.store!==store||entry.device!==device)throw unavailable('canonical_source_state_unavailable');return entry.assert();}

/** Bootstrap draft COMPONENT only. Never a registered Store/body/send proof. */
export function assertOriginalCanonicalSourceDraft(store:ContinuityStore,device:DesktopSyncDevice,cap:object):CapturedCanonicalSourceDraft{const entry=sourceDrafts.get(cap);if(!entry||entry.store!==store||entry.device!==device)throw unavailable('canonical_source_draft_unavailable');return entry.assert();}

/** Stage capability works only inside that exact original top-level write. */
export function assertOriginalCanonicalSourceMetadataStage(store:ContinuityStore,device:DesktopSyncDevice,services:object,draft:object,stage:object):void{
 const entry=bootstrapStages.get(stage);if(!entry||entry.store!==store||entry.device!==device||entry.services!==services||entry.draft!==draft)throw unavailable('canonical_metadata_stage_unavailable');entry.assert();
}
export function finishOriginalCanonicalSourceBootstrap(store:ContinuityStore,device:DesktopSyncDevice,services:object,draft:object,controls:unknown,token:object):object{
 const entry=bootstrapPosts.get(token);if(!entry||entry.store!==store||entry.device!==device)throw unavailable('canonical_source_bootstrap_unavailable');return entry.finish(services,draft,controls);
}
export function abortOriginalCanonicalSourceBootstrap(store:ContinuityStore,device:DesktopSyncDevice,token:object):void{
 const entry=bootstrapPosts.get(token);if(!entry||entry.store!==store||entry.device!==device)throw unavailable('canonical_source_bootstrap_unavailable');entry.abort();
}
