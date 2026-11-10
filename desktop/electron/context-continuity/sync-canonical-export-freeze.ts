import {createHash} from 'node:crypto';
import type {ContinuityActor,ContinuityService} from './service.js';
import type {TaskSnapshot} from '../../shared/task-types.js';
import type {CanonicalSyncBatch,CanonicalSyncScope} from './sync-canonical-codec.js';
import {captureCanonicalExportData} from './sync-canonical-export-data.js';
import {digest,effectSnapshotHash} from './store.js';

// Original operations-table metadata only. This does not mint a source lease,
// prove an OS bootstrap, authenticate a job, or authorize AEAD/network sends.
const kind='canonicalExportVersionV1';
const stable=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const hash=(value:unknown)=>createHash('sha256').update(stable(value)).digest('hex');
const conflict=()=>new Error('canonical_export_origin_conflict');
type FrozenOrigins=Readonly<{manifestHash:string;versionCount:number}>;

function records(service:ContinuityService,batches:ReadonlyArray<Readonly<CanonicalSyncBatch>>,snapshots:readonly TaskSnapshot[]){
 const db=service.store.db,raw=new Map(snapshots.map(snapshot=>[snapshot.taskId,snapshot]));
 return batches.flatMap(batch=>batch.messages.flatMap(message=>message.versions.map(version=>{
  const snapshot=raw.get(message.sourceId);if(!snapshot||snapshot.sessionId!==message.sourceEpoch)throw conflict();
  // Stable per-source/version evidence: never whole Store/conversation revision
  // or this operation's own row. New clean Tasks must not rewrite old origins.
  const sourceEvidence={snapshotHash:effectSnapshotHash(snapshot),
   version:db.prepare("SELECT a.id,a.conversation_id,a.sequence,a.source_kind,a.source_id,a.source_epoch,a.source_message_id,a.deleted,v.revision,v.source_revision,json_extract(v.record,'$.messageId') AS record_id,json_extract(v.record,'$.revision') AS record_revision,json_extract(v.record,'$.contentHash') AS content_hash,json_extract(v.record,'$.role') AS role FROM message_anchors a JOIN message_versions v ON v.message_id=a.id WHERE a.id=? AND v.revision=?").get(message.messageId,version.revision),
   binding:db.prepare('SELECT * FROM task_bindings WHERE task_id=?').get(message.sourceId),
   inputHash:digest(db.prepare('SELECT * FROM task_public_inputs WHERE task_id=?').get(message.sourceId)),
   presentation:db.prepare('SELECT * FROM task_presentation_sources WHERE task_id=?').get(message.sourceId),
   sourceBindings:db.prepare('SELECT * FROM source_bindings WHERE id=? ORDER BY kind,epoch').all(message.sourceId),
   cursor:db.prepare('SELECT * FROM source_cursors WHERE source_kind=? AND source_id=? AND source_epoch=?').get(message.sourceKind,message.sourceId,message.sourceEpoch),
   settlement:db.prepare('SELECT * FROM source_settlements WHERE task_id=?').get(message.sourceId),
   owner:db.prepare('SELECT * FROM effect_owner_receipts WHERE task_id=?').get(message.sourceId),
   // Keep both original history-ledger forms exactly; event_count/prefix_hash
   // may mean a raw snapshot or the original public canonical source set.
   references:db.prepare('SELECT * FROM context_dependencies WHERE task_id=? ORDER BY ref_id').all(message.sourceId),
   history:db.prepare('SELECT * FROM task_history_dependencies WHERE task_id=? ORDER BY source_task_id').all(message.sourceId),
   effects:db.prepare('SELECT * FROM effect_history_dependencies WHERE task_id=? ORDER BY source_task_id').all(message.sourceId),
   ancestors:version.dependencies.map(dep=>({manifest:dep,
    versions:dep.versions.map(entry=>db.prepare("SELECT a.id,a.source_kind,a.source_id,a.source_epoch,a.source_message_id,a.deleted,v.revision,v.source_revision,json_extract(v.record,'$.contentHash') AS content_hash FROM message_anchors a JOIN message_versions v ON v.message_id=a.id WHERE a.id=? AND v.revision=?").get(entry.messageId,entry.revision)),
    reference:dep.kind==='reference'?{ref:db.prepare('SELECT * FROM context_refs WHERE id=?').get(dep.reference.refId),grant:db.prepare('SELECT * FROM read_grants WHERE id=?').get(dep.reference.grantId),entries:db.prepare('SELECT * FROM context_ref_entries WHERE ref_id=? ORDER BY position').all(dep.reference.refId)}:null,
   })),
  };
  const value=JSON.parse(stable({schemaVersion:1,scope:batch.scope,messageId:message.messageId,revision:version.revision,sourceKind:message.sourceKind,sourceId:message.sourceId,sourceEpoch:message.sourceEpoch,sourceMessageId:message.sourceMessageId,sourceRevision:version.sourceRevision,contentHash:version.contentHash,originHash:version.originHash,dependencies:version.dependencies,sourceClosureHash:hash(['xiaok/canonical-export-source-closure/v1',sourceEvidence])}));
  return {id:hash(['xiaok/canonical-export-version-id/v1',batch.scope,message.messageId,version.revision]),value};
 }))).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}

/** Durable immutable metadata through the actual original Store transaction.
 * Public body validation happens before and after that actual COMMIT only. */
export function freezeCanonicalExportOrigins(service:ContinuityService,actor:ContinuityActor,scopes:readonly CanonicalSyncScope[],snapshots:readonly TaskSnapshot[]):FrozenOrigins{
 const batches=captureCanonicalExportData(service,actor,scopes,snapshots),intended=records(service,batches,snapshots),stamp=hash(intended),db=service.store.db;
 service.store.transaction(()=>{
  service.assertActor(actor,true);
  for(const batch of batches){const current=service.requireConversationMetadata(actor,batch.scope.conversationId),{title,mode,createdAt,updatedAt,revision,coverage}=current;if(stable({title,mode,createdAt,updatedAt,revision,coverage})!==stable(batch.conversation))throw conflict();}
  if(hash(records(service,batches,snapshots))!==stamp)throw conflict();
  for(const row of intended){
   try{const prior=service.store.existingOperation<typeof row.value>(kind,row.id,row.value);if(prior&&stable(prior.result)!==stable(row.value))throw conflict();service.store.operation(kind,row.id,row.value,()=>row.value);}
   catch(error){if(error instanceof Error&&error.message==='operation_conflict')throw conflict();throw error;}
  }
 });
 // This check cannot run under a metadata write permit. If COMMIT threw, this
 // line is never reached, even if SQLite actually committed before the throw.
 if(db.isTransaction)throw conflict();const current=captureCanonicalExportData(service,actor,scopes,snapshots);
 if(hash(current)!==hash(batches)||hash(records(service,current,snapshots))!==stamp)throw conflict();
 for(const row of intended){const prior=service.store.existingOperation<typeof row.value>(kind,row.id,row.value);if(!prior||stable(prior.result)!==stable(row.value))throw conflict();}
 return Object.freeze({manifestHash:hash(['xiaok/canonical-export-origins/v1',intended]),versionCount:intended.length});
}

/** Read-only exact original metadata assertion. Never creates a new COMMIT. */
export function assertFrozenCanonicalExportOrigins(service:ContinuityService,actor:ContinuityActor,scopes:readonly CanonicalSyncScope[],snapshots:readonly TaskSnapshot[],expected:FrozenOrigins):FrozenOrigins{
 const batches=captureCanonicalExportData(service,actor,scopes,snapshots),intended=records(service,batches,snapshots),current=Object.freeze({manifestHash:hash(['xiaok/canonical-export-origins/v1',intended]),versionCount:intended.length});
 if(stable(current)!==stable(expected))throw conflict();
 for(const row of intended){
  try{const prior=service.store.existingOperation<typeof row.value>(kind,row.id,row.value);if(!prior||stable(prior.result)!==stable(row.value))throw conflict();}
  catch{throw conflict();}
 }
 return current;
}
