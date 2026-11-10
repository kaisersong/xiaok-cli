import {readOriginalDesktopContinuityMain} from '../desktop-services.js';
import {originalDesktopRuntimeSourceContext} from './runtime.js';
import {InProcessTaskRuntimeHost} from '../../../src/runtime/task-host/task-runtime-host.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import type {TaskSnapshot} from '../../shared/task-types.js';
import {effectSnapshotHash,digest as continuityDigest} from './store.js';
import {captureCanonicalExportData} from './sync-canonical-export-data.js';
import {freezeCanonicalExportOrigins,assertFrozenCanonicalExportOrigins} from './sync-canonical-export-freeze.js';
import {assertOriginalCanonicalSourceState,assertOriginalCanonicalSourceDraft,finishOriginalCanonicalSourceBootstrap,abortOriginalCanonicalSourceBootstrap} from './sync-canonical-store-owner.js';
import {assertDesktopSyncSourceControls,desktopCanonicalSourceIdentityData} from './sync-device-runtime.js';
import {types as sourceInputTypes} from 'node:util';
import {ContinuitySdkCustody} from './sdk-custody.js';
import type {ContinuityStore} from './store.js';
import type {DesktopSyncDevice} from './sync-device-runtime.js';
import {assertOriginalCanonicalSourceMetadataStage,type CapturedCanonicalSourceState,type CapturedCanonicalSourceDraft} from './sync-canonical-store-owner.js';
import type {CanonicalSyncScope,CanonicalSyncBatch} from './sync-canonical-codec.js';
export interface DesktopCanonicalSourceMetadata {
 readonly kind:'original-desktop-source-proof-data';readonly storeState:CapturedCanonicalSourceState;
 readonly scopes:readonly Readonly<CanonicalSyncScope>[];readonly manifestHash:string;readonly versionCount:number;readonly payloadHashes:readonly string[];
}
const canonicalSourceProofs=new WeakMap<object,{services:object;device:DesktopSyncDevice;assert:()=>{metadata:DesktopCanonicalSourceMetadata;batches:ReadonlyArray<Readonly<CanonicalSyncBatch>>}}>();
function originalCanonicalSource(services:object,device:DesktopSyncDevice,proof:object){const entry=canonicalSourceProofs.get(proof);if(!entry||entry.services!==services||entry.device!==device)throw new Error('canonical_runtime_source_unavailable');return entry.assert();}
/** Source proof only; the fixed main friend must also join the actual raw job. */
export function assertOriginalDesktopCanonicalSource(services:object,device:DesktopSyncDevice,proof:object):DesktopCanonicalSourceMetadata{return originalCanonicalSource(services,device,proof).metadata;}
export function readOriginalDesktopCanonicalSource(services:object,device:DesktopSyncDevice,proof:object):ReadonlyArray<Readonly<CanonicalSyncBatch>>{return originalCanonicalSource(services,device,proof).batches;}

export interface DesktopCanonicalSourceDraftMetadata extends Omit<DesktopCanonicalSourceMetadata,'kind'|'storeState'>{
 readonly kind:'original-desktop-source-draft-data';readonly storeState:CapturedCanonicalSourceDraft;
}
const canonicalSourceDrafts=new WeakMap<object,{services:object;device:DesktopSyncDevice;store:ContinuityStore;metadataStage:()=>void;promote:(component:object)=>object;assert:()=>{metadata:DesktopCanonicalSourceDraftMetadata;batches:ReadonlyArray<Readonly<CanonicalSyncBatch>>}}>();
/** Main bootstrap draft only. Final source assertion/read never accepts this map. */
export function assertOriginalDesktopCanonicalSourceDraft(services:object,device:DesktopSyncDevice,proof:object):DesktopCanonicalSourceDraftMetadata{
 const entry=canonicalSourceDrafts.get(proof);if(!entry||entry.services!==services||entry.device!==device)throw new Error('canonical_runtime_source_draft_unavailable');return entry.assert().metadata;
}

export function assertOriginalDesktopCanonicalSourceDraftForStore(store:ContinuityStore,services:object,device:DesktopSyncDevice,proof:object):DesktopCanonicalSourceDraftMetadata{
 const entry=canonicalSourceDrafts.get(proof);if(!entry||entry.store!==store)throw new Error('canonical_runtime_source_draft_unavailable');return assertOriginalDesktopCanonicalSourceDraft(services,device,proof);
}
/** Fixed metadata friend only; requires the exact original write-stage first. */
export function assertOriginalDesktopCanonicalSourceDraftMetadataStage(store:ContinuityStore,services:object,device:DesktopSyncDevice,proof:object,stage:object):void{
 const entry=canonicalSourceDrafts.get(proof);if(!entry||entry.store!==store||entry.services!==services||entry.device!==device)throw new Error('canonical_runtime_source_draft_unavailable');
 assertOriginalCanonicalSourceMetadataStage(store,device,services,proof,stage);entry.metadataStage();assertOriginalCanonicalSourceMetadataStage(store,device,services,proof,stage);
}

/** Only the actual original DesktopServices tuple may mint these component
 * source proofs. Metadata never substitutes for the fixed sync raw owner. */
export function createOriginalCanonicalMainSource(desktopServices:object){
 const owner=readOriginalDesktopContinuityMain(desktopServices),contextContinuity=owner.runtime,sdk=new ContinuitySdkCustody();
 const inspectSnapshot=FileTaskSnapshotStore.prototype.inspectPersistedTask;
  const sourceReady=()=>{owner.assertCurrent();};
  const prepareCanonicalSource=async(device:DesktopSyncDevice,input:readonly string[]):Promise<object>=>{
    await owner.ready;sourceReady();await contextContinuity.reconcile();
    sourceReady();const context=originalDesktopRuntimeSourceContext(contextContinuity),{service,actor,store}=context;
    const initial=store.captureCanonicalSourceState(device,input),initialState=assertOriginalCanonicalSourceState(store,device,initial),ids=initialState.conversationIds;
    const identity=desktopCanonicalSourceIdentityData(device);
    if(identity.identityHash!==initialState.deviceIdentityHash||identity.deviceId!==initialState.deviceId||identity.logicalProfileId!==initialState.deviceLogicalProfileId)throw new Error('canonical_runtime_source_unavailable');
    const scopes=Object.freeze(ids.map(conversationId=>Object.freeze({rootKeyId:identity.rootKeyId,syncGroupId:identity.syncGroupId,logicalProfileId:identity.logicalProfileId,conversationId,branchId:'canonical-v1'})));
    const captured=new Map<string,TaskSnapshot>();
    for(const id of ids)for(const row of store.db.prepare('SELECT task_id,revoked FROM task_bindings WHERE conversation_id=? ORDER BY task_id').all(id)){
      const taskId=String(row.task_id);if(row.revoked||captured.has(taskId))throw Error('canonical_runtime_source_unavailable');
      const actual=await sdk.invoke<TaskSnapshot|null>(inspectSnapshot,owner.snapshotStore,[taskId]);sourceReady();if(!actual||actual.context?.threadId!==id)throw Error('canonical_runtime_source_unavailable');captured.set(taskId,JSON.parse(JSON.stringify(actual)) as TaskSnapshot);
    }
    const currentSnapshots=():TaskSnapshot[]=>{
      const snapshots:TaskSnapshot[]=[],seen=new Set<string>();
      for(const id of ids)for(const row of store.db.prepare('SELECT task_id,revoked FROM task_bindings WHERE conversation_id=? ORDER BY task_id').all(id)){
        const taskId=String(row.task_id);if(row.revoked||seen.has(taskId))throw new Error('canonical_runtime_source_unavailable');seen.add(taskId);
        const snapshot=captured.get(taskId);const live=InProcessTaskRuntimeHost.prototype.readContinuitySourceSnapshot.call(owner.host,taskId);if(live&&snapshot&&effectSnapshotHash(live)!==effectSnapshotHash(snapshot))throw Error('canonical_runtime_source_changed');if(!snapshot||snapshot.taskId!==taskId||snapshot.context?.threadId!==id)throw new Error('canonical_runtime_source_unavailable');snapshots.push(snapshot);
      }
      return snapshots;
    };
    const snapshots=currentSnapshots(),snapshotHashes=snapshots.map(snapshot=>effectSnapshotHash(snapshot)),batches=captureCanonicalExportData(service,actor,scopes,snapshots),payloadHashes=Object.freeze(batches.map(batch=>continuityDigest(batch)));
    assertOriginalCanonicalSourceState(store,device,initial);sourceReady();if(originalDesktopRuntimeSourceContext(contextContinuity)!==context)throw new Error('canonical_runtime_source_unavailable');
    const frozen=freezeCanonicalExportOrigins(service,actor,scopes,snapshots);
    const component=store.captureCanonicalSourceState(device,ids),storeState=assertOriginalCanonicalSourceState(store,device,component);
    const metadata:DesktopCanonicalSourceMetadata=Object.freeze({kind:'original-desktop-source-proof-data',storeState,scopes,manifestHash:frozen.manifestHash,versionCount:frozen.versionCount,payloadHashes});
    let unavailable=false;
    const assert=()=>{
      if(unavailable)throw new Error('canonical_runtime_source_unavailable');
      try{
      sourceReady();if(originalDesktopRuntimeSourceContext(contextContinuity)!==context)throw new Error('canonical_runtime_source_unavailable');assertOriginalCanonicalSourceState(store,device,component);
      const current=currentSnapshots();if(current.length!==snapshotHashes.length||current.some((snapshot,i)=>effectSnapshotHash(snapshot)!==snapshotHashes[i]))throw new Error('canonical_runtime_source_changed');
      const actual=captureCanonicalExportData(service,actor,scopes,current);if(actual.length!==payloadHashes.length||actual.some((batch,i)=>continuityDigest(batch)!==payloadHashes[i]))throw new Error('canonical_runtime_source_changed');
      assertFrozenCanonicalExportOrigins(service,actor,scopes,current,frozen);assertOriginalCanonicalSourceState(store,device,component);
      sourceReady();if(originalDesktopRuntimeSourceContext(contextContinuity)!==context)throw new Error('canonical_runtime_source_unavailable');return{metadata,batches:actual};
      }catch(error){unavailable=true;throw error;}
    };
    assert();const proof=Object.freeze({kind:'original-desktop-source-proof'});canonicalSourceProofs.set(proof,{services:desktopServices,device,assert});return proof;
  };
  const prepareBootstrapDraft=async(device:DesktopSyncDevice,input:readonly string[],expected?:Readonly<{manifestHash:string;versionCount:number}>):Promise<object>=>{
    await owner.ready;sourceReady();await contextContinuity.reconcile();
    sourceReady();const context=originalDesktopRuntimeSourceContext(contextContinuity),{service,actor,store}=context;
    const initial=store.captureCanonicalSourceDraft(device,input),initialState=assertOriginalCanonicalSourceDraft(store,device,initial),ids=initialState.conversationIds;
    const identity=desktopCanonicalSourceIdentityData(device);
    if(identity.identityHash!==initialState.deviceIdentityHash||identity.deviceId!==initialState.deviceId||identity.logicalProfileId!==initialState.deviceLogicalProfileId)throw new Error('canonical_runtime_source_unavailable');
    const scopes=Object.freeze(ids.map(conversationId=>Object.freeze({rootKeyId:identity.rootKeyId,syncGroupId:identity.syncGroupId,logicalProfileId:identity.logicalProfileId,conversationId,branchId:'canonical-v1'})));
    const captured=new Map<string,TaskSnapshot>();
    for(const id of ids)for(const row of store.db.prepare('SELECT task_id,revoked FROM task_bindings WHERE conversation_id=? ORDER BY task_id').all(id)){
      const taskId=String(row.task_id);if(row.revoked||captured.has(taskId))throw Error('canonical_runtime_source_unavailable');
      const actual=await sdk.invoke<TaskSnapshot|null>(inspectSnapshot,owner.snapshotStore,[taskId]);sourceReady();if(!actual||actual.context?.threadId!==id)throw Error('canonical_runtime_source_unavailable');captured.set(taskId,JSON.parse(JSON.stringify(actual)) as TaskSnapshot);
    }
    const currentSnapshots=():TaskSnapshot[]=>{
      const snapshots:TaskSnapshot[]=[],seen=new Set<string>();
      for(const id of ids)for(const row of store.db.prepare('SELECT task_id,revoked FROM task_bindings WHERE conversation_id=? ORDER BY task_id').all(id)){
        const taskId=String(row.task_id);if(row.revoked||seen.has(taskId))throw new Error('canonical_runtime_source_unavailable');seen.add(taskId);
        const snapshot=captured.get(taskId);const live=InProcessTaskRuntimeHost.prototype.readContinuitySourceSnapshot.call(owner.host,taskId);if(live&&snapshot&&effectSnapshotHash(live)!==effectSnapshotHash(snapshot))throw Error('canonical_runtime_source_changed');if(!snapshot||snapshot.taskId!==taskId||snapshot.context?.threadId!==id)throw new Error('canonical_runtime_source_unavailable');snapshots.push(snapshot);
      }
      return snapshots;
    };
    const snapshots=currentSnapshots(),snapshotHashes=snapshots.map(snapshot=>effectSnapshotHash(snapshot)),batches=captureCanonicalExportData(service,actor,scopes,snapshots),payloadHashes=Object.freeze(batches.map(batch=>continuityDigest(batch)));
    assertOriginalCanonicalSourceDraft(store,device,initial);sourceReady();if(originalDesktopRuntimeSourceContext(contextContinuity)!==context)throw new Error('canonical_runtime_source_unavailable');
    const frozen=expected?assertFrozenCanonicalExportOrigins(service,actor,scopes,snapshots,expected):freezeCanonicalExportOrigins(service,actor,scopes,snapshots);
    const component=store.captureCanonicalSourceDraft(device,ids),storeState=assertOriginalCanonicalSourceDraft(store,device,component);
    const metadata:DesktopCanonicalSourceDraftMetadata=Object.freeze({kind:'original-desktop-source-draft-data',storeState,scopes,manifestHash:frozen.manifestHash,versionCount:frozen.versionCount,payloadHashes});
    let unavailable=false,registered:object|undefined;
    const assert=()=>{
      if(unavailable)throw new Error('canonical_runtime_source_unavailable');
      try{
      sourceReady();if(originalDesktopRuntimeSourceContext(contextContinuity)!==context)throw new Error('canonical_runtime_source_unavailable');registered?assertOriginalCanonicalSourceState(store,device,registered):assertOriginalCanonicalSourceDraft(store,device,component);
      const current=currentSnapshots();if(current.length!==snapshotHashes.length||current.some((snapshot,i)=>effectSnapshotHash(snapshot)!==snapshotHashes[i]))throw new Error('canonical_runtime_source_changed');
      const actual=captureCanonicalExportData(service,actor,scopes,current);if(actual.length!==payloadHashes.length||actual.some((batch,i)=>continuityDigest(batch)!==payloadHashes[i]))throw new Error('canonical_runtime_source_changed');
      assertFrozenCanonicalExportOrigins(service,actor,scopes,current,frozen);registered?assertOriginalCanonicalSourceState(store,device,registered):assertOriginalCanonicalSourceDraft(store,device,component);
      sourceReady();if(originalDesktopRuntimeSourceContext(contextContinuity)!==context)throw new Error('canonical_runtime_source_unavailable');const currentMetadata=registered?Object.freeze({...metadata,kind:'original-desktop-source-proof-data' as const,storeState:assertOriginalCanonicalSourceState(store,device,registered)}):metadata;return{metadata:currentMetadata,batches:actual};
      }catch(error){unavailable=true;throw error;}
    };
    const metadataStage=()=>{
      if(unavailable||registered)throw new Error('canonical_runtime_source_draft_unavailable');
      try{sourceReady();if(originalDesktopRuntimeSourceContext(contextContinuity)!==context)throw new Error('canonical_runtime_source_unavailable');const current=currentSnapshots();if(current.length!==snapshotHashes.length||current.some((snapshot,i)=>effectSnapshotHash(snapshot)!==snapshotHashes[i]))throw new Error('canonical_runtime_source_changed');sourceReady();if(originalDesktopRuntimeSourceContext(contextContinuity)!==context)throw new Error('canonical_runtime_source_unavailable');}
      catch(error){unavailable=true;throw error;}
    };
    assert();const proof=Object.freeze({kind:'original-desktop-source-draft'});
    canonicalSourceDrafts.set(proof,{services:desktopServices,device,store,metadataStage,assert:()=>{if(registered)throw new Error('canonical_runtime_source_draft_unavailable');return assert()as {metadata:DesktopCanonicalSourceDraftMetadata;batches:ReadonlyArray<Readonly<CanonicalSyncBatch>>};},promote:(component:object)=>{
      if(registered||unavailable)throw new Error('canonical_runtime_source_draft_unavailable');assertOriginalCanonicalSourceState(store,device,component);registered=component;
      const current=assert();if(current.metadata.kind!=='original-desktop-source-proof-data')throw new Error('canonical_runtime_source_unavailable');
      const result=Object.freeze({kind:'original-desktop-source-proof'});canonicalSourceProofs.set(result,{services:desktopServices,device,assert:()=>assert()as {metadata:DesktopCanonicalSourceMetadata;batches:ReadonlyArray<Readonly<CanonicalSyncBatch>>}});canonicalSourceDrafts.delete(proof);return result;
    }});return proof;
  };
  const prepareCanonicalSourceDraft=(device:DesktopSyncDevice,input:readonly string[]):Promise<object>=>prepareBootstrapDraft(device,input);
  const bootstrapCanonicalSource=async(device:DesktopSyncDevice,input:readonly string[],source:{requestSource:'user'|'agent'|'scheduler'}):Promise<object>=>{
    if(!source||typeof source!=='object'||sourceInputTypes.isProxy(source)||Object.getOwnPropertySymbols(source).length||![Object.prototype,null].includes(Object.getPrototypeOf(source)))throw new Error('canonical_source_bootstrap_request_denied');
    const fields=Object.getOwnPropertyDescriptors(source),field=fields.requestSource;
    if(Object.keys(fields).length!==1||!field?.enumerable||!('value'in field)||field.value!=='user')throw new Error('canonical_source_bootstrap_request_denied');
    const draft=await prepareBootstrapDraft(device,input),context=originalDesktopRuntimeSourceContext(contextContinuity),metadata=assertOriginalDesktopCanonicalSourceDraftForStore(context.store,desktopServices,device,draft);
    const controls=await device.captureCanonicalSourceControls(metadata.scopes.map(scope=>({conversationId:scope.conversationId,branchId:scope.branchId})),{requestSource:'user'});
    assertOriginalDesktopCanonicalSourceDraftForStore(context.store,desktopServices,device,draft);
    const token=await context.store.bootstrapCanonicalSource(device,desktopServices,draft,controls);
    try{
      const post=await prepareBootstrapDraft(device,metadata.storeState.conversationIds,{manifestHash:metadata.manifestHash,versionCount:metadata.versionCount}),entry=canonicalSourceDrafts.get(post);if(!entry)throw new Error('canonical_runtime_source_unavailable');
      const component=finishOriginalCanonicalSourceBootstrap(context.store,device,desktopServices,post,controls,token),proof=entry.promote(component);
      assertOriginalDesktopCanonicalSource(desktopServices,device,proof);assertDesktopSyncSourceControls(device,controls);assertOriginalDesktopCanonicalSource(desktopServices,device,proof);return proof;
    }catch(error){abortOriginalCanonicalSourceBootstrap(context.store,device,token);throw error;}
  };
 return Object.freeze({prepareCanonicalSource,prepareCanonicalSourceDraft,bootstrapCanonicalSource,close:()=>sdk.waitKnown()});
}
