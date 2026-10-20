import type {ContinuityStore} from './store.js';
import type {DesktopSyncDevice} from './sync-device-runtime.js';
import {assertOriginalDesktopSyncRawOwner} from './sync-device-runtime.js';
import {assertOriginalDesktopCanonicalSource,readOriginalDesktopCanonicalSource,assertOriginalDesktopCanonicalSourceDraftForStore,assertOriginalDesktopCanonicalSourceDraftMetadataStage} from '../desktop-services.js';
/** Fixed original composition root. No injected path, callback, provider or DTO. */
export function assertSourceDraft(store:ContinuityStore,device:DesktopSyncDevice,services:object,draft:object){
 return assertOriginalDesktopCanonicalSourceDraftForStore(store,services,device,draft);
}
export function assertSourceDraftMetadataStage(store:ContinuityStore,device:DesktopSyncDevice,services:object,draft:object,stage:object):void{
 const result=assertOriginalDesktopCanonicalSourceDraftMetadataStage(store,services,device,draft,stage);
 if(result!==undefined)throw new Error('canonical_runtime_source_draft_unavailable');
}
export function assertCanonicalSourceForRawOwner(rawOwner:object,device:DesktopSyncDevice,services:object,proof:object){
 assertOriginalDesktopSyncRawOwner(device,rawOwner);
 const metadata=assertOriginalDesktopCanonicalSource(services,device,proof);
 assertOriginalDesktopSyncRawOwner(device,rawOwner);return metadata;
}
export function readCanonicalSourcePayloadForRawOwner(rawOwner:object,device:DesktopSyncDevice,services:object,proof:object,index:number){
 assertOriginalDesktopSyncRawOwner(device,rawOwner);
 const batches=readOriginalDesktopCanonicalSource(services,device,proof);
 if(!Number.isSafeInteger(index)||index<0||index>=batches.length)throw new Error('canonical_runtime_source_unavailable');
 const batch=batches[index];assertOriginalDesktopSyncRawOwner(device,rawOwner);return batch;
}
