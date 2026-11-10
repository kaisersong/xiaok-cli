import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {z} from 'zod/v3';
import type {WorkWatch,WorkProjection} from './types.js';
import {readNativeAttentionEnrollment,nativeApprovalOwnerMatchesReference} from './native-attention-source.js';
import {nativeInventorySnapshot,type NativeAttentionInventory} from './native-attention-inventory-data.js';
import {nativeApprovalOwnerSchema} from '../task-host/native-approval-owner.js';
import {createOrdinaryAttentionFacts} from './ordinary-attention-facts.js';
import {saveActivityProjectionLocked,refreshActivityCardLocked} from './activity-projection-locked.js';
import {parseCapturedSourceJson} from '../verification/captured-source-json.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const headSchema=z.object({watch_id:z.string(),enrollment_incarnation:z.string().uuid(),inventory_revision:z.number().int().nonnegative().safe(),inventory_digest:digest,questions_json:z.string(),digest}).strict();

/** Original store transaction only. Input admission/current VM or authenticated
 * source lease is owned above this fixed SQL operation, never by these hashes. */
export function reconcileNativeInventoryLocked(db:DatabaseSync,watch:WorkWatch,projection:WorkProjection,inventory:NativeAttentionInventory):void {
 const enrollment=readNativeAttentionEnrollment(db,watch);
 if(!enrollment||inventory.watchId!==watch.watchId||inventory.enrollmentIncarnation!==enrollment.enrollmentIncarnation||inventory.bindingDigest!==enrollment.bindingDigest
  ||JSON.stringify(inventory.reference)!==JSON.stringify(enrollment.reference))throw Error('attention_native_inventory_binding_conflict');
 if(enrollment.coverageLost||['activity_history_gap','activity_schema_invalid'].includes(projection.errorCode??''))throw Error('attention_native_coverage_unknown');
 const bytes=(db.prepare('SELECT data_json FROM work_projections WHERE watch_id=?').get(watch.watchId) as {data_json:string}).data_json;
 const ordinary=createOrdinaryAttentionFacts(db),fact=ordinary.read(watch,bytes),snapshot=nativeInventorySnapshot(inventory),questionsJson=JSON.stringify(snapshot.questions);
 const raw=db.prepare('SELECT * FROM activity_attention_native_inventory_heads WHERE watch_id=?').get(watch.watchId),head=raw?headSchema.parse(raw):null;
 if(head){
  if(head.enrollment_incarnation!==enrollment.enrollmentIncarnation||head.digest!==hash([head.watch_id,head.enrollment_incarnation,head.inventory_revision,head.inventory_digest,head.questions_json]))throw Error('attention_native_inventory_integrity_failed');
  if(snapshot.inventoryRevision<head.inventory_revision||snapshot.inventoryRevision===head.inventory_revision&&(snapshot.inventoryDigest!==head.inventory_digest||questionsJson!==head.questions_json))throw Error('attention_native_inventory_conflict');
 }
 if(projection.executionState==='input_required'){
  let owned=fact.schemaVersion===2&&fact.sourceRef.native.enrollmentIncarnation===enrollment.enrollmentIncarnation&&JSON.stringify(fact.sourceRef.native.reference)===JSON.stringify(enrollment.reference)&&fact.sourceRef.native.questions.length>0;
  if(!owned&&fact.sourceRef.kind==='event'){
   const row=db.prepare('SELECT e.content_json FROM source_events e JOIN watch_event_receipts r ON e.event_key=r.event_key WHERE r.watch_id=? AND e.event_key=?').get(watch.watchId,fact.sourceRef.id) as {content_json:string}|undefined;
   if(row&&Buffer.byteLength(row.content_json,'utf8')<=16*1024){
    const event=parseCapturedSourceJson(row.content_json) as Record<string,any>,owner=nativeApprovalOwnerSchema.safeParse(event.questionOwner);
    owned=event.schemaVersion===2&&event.kind==='input_required'&&event.source==='task_host'&&event.logicalSourceId===watch.logicalSourceId&&event.sourceDataEpoch===watch.sourceDataEpoch&&event.workId===watch.workId&&(event.runId??'')===(watch.runId??'')
     &&Number.isSafeInteger(event.sourceSequence)&&event.sourceSequence<=projection.sourceSequence&&hash([event.source,event.logicalSourceId,event.sourceDataEpoch,event.workId,event.runId??'',event.eventId])===fact.sourceRef.id
     &&owner.success&&owner.data.approvalToken===event.questionId&&nativeApprovalOwnerMatchesReference(owner.data,enrollment.reference);
   }
  }
  if(!owned)throw Error('attention_native_coverage_unknown');
 }
 if(!['accepted','queued','running','input_required','blocked'].includes(projection.executionState))throw Error('attention_native_inventory_terminal_requires_receipt');
 const checksum=hash([watch.watchId,enrollment.enrollmentIncarnation,snapshot.inventoryRevision,snapshot.inventoryDigest,questionsJson]);
 if(head)db.prepare('UPDATE activity_attention_native_inventory_heads SET inventory_revision=?,inventory_digest=?,questions_json=?,digest=? WHERE watch_id=?').run(snapshot.inventoryRevision,snapshot.inventoryDigest,questionsJson,checksum,watch.watchId);
 else db.prepare('INSERT INTO activity_attention_native_inventory_heads VALUES(?,?,?,?,?,?)').run(watch.watchId,enrollment.enrollmentIncarnation,snapshot.inventoryRevision,snapshot.inventoryDigest,questionsJson,checksum);
 // Blocked is an independent original fact; a Native answer cannot erase it.
 if(projection.executionState==='blocked')return;
 const expectedCore={executionState:inventory.questions.length?'input_required' as const:'running' as const,businessOutcome:'unknown' as const};
 const unchanged=fact.schemaVersion===2&&JSON.stringify(fact.sourceRef.native)===JSON.stringify(snapshot)&&projection.executionState===expectedCore.executionState;
 if(unchanged)return;
 const revision=projection.revision+1;if(!Number.isSafeInteger(revision))throw Error('attention_native_inventory_version_exhausted');
 const next={...projection,...expectedCore,revision};
 saveActivityProjectionLocked(db,watch,next,{kind:'native_inventory',id:'native-inventory:'+hash(snapshot),core:expectedCore,native:snapshot});
 refreshActivityCardLocked(db,watch,next);
 ordinary.read(watch,JSON.stringify(next));
}
