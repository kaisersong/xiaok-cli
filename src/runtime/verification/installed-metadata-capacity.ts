import {randomUUID} from 'node:crypto';
import {assertInstalledControllerLifetime,type InstalledControllerLifetime} from './installed-controller-lifetime.js';
import {assertInstalledSharedCapacity,type createInstalledSharedCapacity} from './installed-shared-capacity.js';
import {createInstalledControllerMetadataSource,readInstalledMetadataSource} from './installed-metadata-source.js';
import {parseMetadataCapacityAllocation,type MetadataCapacityAllocation} from './metadata-capacity-protocol.js';
/** Fixed controller metadata owner. This exposes no arbitrary session/partition
 * issuer and does not make the unconnected Main/receiver writers protected. */
export function createInstalledMetadataCapacity(input:{lifetime:InstalledControllerLifetime;sharedCapacity:ReturnType<typeof createInstalledSharedCapacity>}){
 const {lifetime,sharedCapacity}=input;assertInstalledControllerLifetime(lifetime);assertInstalledSharedCapacity(sharedCapacity,lifetime);const db=lifetime.database,source=createInstalledControllerMetadataSource(lifetime),capacity=sharedCapacity.capacity;let closed=false;
 function current(){if(closed)throw Error('installed_metadata_closed');assertInstalledControllerLifetime(lifetime);assertInstalledSharedCapacity(sharedCapacity,lifetime);}
 return Object.freeze({
  initializeController():Readonly<MetadataCapacityAllocation>{current();const facts=readInstalledMetadataSource(source,db,lifetime.manifest.authorityId);let row=db.prepare('SELECT revision,record_json FROM controller_metadata_resources WHERE resource_id=?').get(facts.resourceId) as {revision:number;record_json:string}|undefined;let prepared:Readonly<MetadataCapacityAllocation>;
   if(row){const existing=parseMetadataCapacityAllocation(JSON.parse(row.record_json));if(existing.state==='confirmed'&&existing.writerGeneration===lifetime.serviceEpoch&&existing.beneficiaryCensusHash===facts.beneficiaryCensusHash&&db.pragma('max_page_count',{simple:true})===existing.usableMaximumPageCount)return existing;if(existing.state==='prepared'&&existing.writerGeneration!==lifetime.serviceEpoch){capacity.recoverControllerMetadata(source);row=db.prepare('SELECT revision,record_json FROM controller_metadata_resources WHERE resource_id=?').get(facts.resourceId) as {revision:number;record_json:string};}}
   if(row&&parseMetadataCapacityAllocation(JSON.parse(row.record_json)).state==='prepared'){prepared=parseMetadataCapacityAllocation(JSON.parse(row.record_json));if(prepared.writerGeneration!==lifetime.serviceEpoch||prepared.beneficiaryCensusHash!==facts.beneficiaryCensusHash)throw Error('installed_metadata_pending');}
   else prepared=capacity.prepareControllerMetadata(source,{requestId:randomUUID(),resourceId:facts.resourceId,expectedRevision:row?.revision??0,minimumPageCount:facts.pageCount});
   current();return capacity.applyControllerMetadata(source,{requestId:prepared.requestId,resourceId:prepared.resourceId,intentId:prepared.intentId,allocationDigest:prepared.allocationDigest});
  },
  close(){closed=true;},
 });
}
