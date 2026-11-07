import {createHash,randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {z} from 'zod/v3';
import type {WorkWatch} from './types.js';
import type {NativeApprovalOwnerMetadata} from '../task-host/native-approval-owner.js';

const key=z.string().min(1).max(256),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const nativeAttentionReferenceSchema=z.object({sourceKind:z.literal('codex_native_approval'),taskId:key,taskSessionId:key,executionThreadId:key,
 nativeSessionId:key,nativeThreadId:key,nativeTurnId:key,nativeGeneration:z.number().int().positive().safe(),nativeIncarnation:z.string().uuid()}).strict();
export type NativeAttentionReference=z.infer<typeof nativeAttentionReferenceSchema>;
export const nativeApprovalOwnerMatchesReference=(owner:NativeApprovalOwnerMetadata,reference:NativeAttentionReference)=>
 owner.taskSessionId===reference.taskSessionId&&owner.nativeIncarnation===reference.nativeIncarnation&&owner.nativeSessionId===reference.nativeSessionId
 &&owner.nativeThreadId===reference.nativeThreadId&&owner.nativeTurnId===reference.nativeTurnId&&owner.nativeTurnGeneration===reference.nativeGeneration;
export interface NativeAttentionEnrollment {watchId:string;enrollmentIncarnation:string;bindingDigest:string;reference:NativeAttentionReference;coverageLost:boolean}
/** Opaque VM-local delivery, not a serialized enrollment or Native execution grant. */
export type NativeActivitySourceDelivery=Readonly<{watchId:string;enrollmentIncarnation:string}>;
export const NATIVE_ATTENTION_SOURCE_SQL=`
CREATE TABLE IF NOT EXISTS activity_attention_native_sources(
 watch_id TEXT PRIMARY KEY REFERENCES work_watches(watch_id),source_kind TEXT NOT NULL CHECK(source_kind='codex_native_approval'),
 enrollment_incarnation TEXT NOT NULL UNIQUE,binding_digest TEXT NOT NULL,reference_json TEXT NOT NULL,digest TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS activity_native_source_insert BEFORE INSERT ON activity_attention_native_sources
 WHEN EXISTS(SELECT 1 FROM activity_attention_native_sources WHERE watch_id=NEW.watch_id OR enrollment_incarnation=NEW.enrollment_incarnation)
 BEGIN SELECT RAISE(ABORT,'activity_native_source_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_native_source_update BEFORE UPDATE ON activity_attention_native_sources
 BEGIN SELECT RAISE(ABORT,'activity_native_source_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_native_source_delete BEFORE DELETE ON activity_attention_native_sources
 BEGIN SELECT RAISE(ABORT,'activity_native_source_immutable'); END;
CREATE TABLE IF NOT EXISTS activity_attention_native_coverage_lost(watch_id TEXT PRIMARY KEY REFERENCES activity_attention_native_sources(watch_id),enrollment_incarnation TEXT NOT NULL,event_key TEXT NOT NULL,digest TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS activity_native_coverage_insert BEFORE INSERT ON activity_attention_native_coverage_lost
 WHEN EXISTS(SELECT 1 FROM activity_attention_native_coverage_lost WHERE watch_id=NEW.watch_id) BEGIN SELECT RAISE(ABORT,'activity_native_coverage_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_native_coverage_update BEFORE UPDATE ON activity_attention_native_coverage_lost BEGIN SELECT RAISE(ABORT,'activity_native_coverage_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_native_coverage_delete BEFORE DELETE ON activity_attention_native_coverage_lost BEGIN SELECT RAISE(ABORT,'activity_native_coverage_immutable'); END;
CREATE TABLE IF NOT EXISTS activity_attention_native_inventory_heads(watch_id TEXT PRIMARY KEY REFERENCES activity_attention_native_sources(watch_id),enrollment_incarnation TEXT NOT NULL,inventory_revision INTEGER NOT NULL,inventory_digest TEXT NOT NULL,questions_json TEXT NOT NULL,digest TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS activity_native_inventory_delete BEFORE DELETE ON activity_attention_native_inventory_heads BEGIN SELECT RAISE(ABORT,'activity_native_inventory_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_native_inventory_insert BEFORE INSERT ON activity_attention_native_inventory_heads
 WHEN EXISTS(SELECT 1 FROM activity_attention_native_inventory_heads WHERE watch_id=NEW.watch_id) BEGIN SELECT RAISE(ABORT,'activity_native_inventory_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_native_inventory_update BEFORE UPDATE ON activity_attention_native_inventory_heads
 WHEN NEW.watch_id IS NOT OLD.watch_id OR NEW.enrollment_incarnation IS NOT OLD.enrollment_incarnation OR NEW.inventory_revision<OLD.inventory_revision
 OR (NEW.inventory_revision=OLD.inventory_revision AND (NEW.inventory_digest<>OLD.inventory_digest OR NEW.questions_json<>OLD.questions_json OR NEW.digest<>OLD.digest))
 BEGIN SELECT RAISE(ABORT,'activity_native_inventory_immutable'); END;
`;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const nativeAttentionBindingDigest=(watch:WorkWatch)=>hash([watch.watchId,watch.operationId,watch.source,watch.logicalSourceId,watch.sourceDataEpoch,watch.workId,watch.runId??'',watch.actualExecutionThreadId??'',
 watch.origin.profileId,watch.origin.workspaceId,watch.origin.threadId,watch.origin.actorId]);
const rowSchema=z.object({watch_id:key,source_kind:z.literal('codex_native_approval'),enrollment_incarnation:z.string().uuid(),binding_digest:digest,reference_json:z.string(),digest}).strict();
export function readNativeAttentionEnrollment(db:DatabaseSync,watch:WorkWatch):NativeAttentionEnrollment|null {
 const table=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='activity_attention_native_sources'").get();
 if(!table){if((db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version>=5)throw Error('activity_native_source_integrity_failed');return null;}
 const raw=db.prepare('SELECT * FROM activity_attention_native_sources WHERE watch_id=?').get(watch.watchId);if(!raw)return null;
 if((db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version!==5)throw Error('activity_native_source_integrity_failed');
 const row=rowSchema.parse(raw),reference=nativeAttentionReferenceSchema.parse(JSON.parse(row.reference_json));
 if(row.digest!==hash([row.watch_id,row.enrollment_incarnation,row.binding_digest,row.reference_json])||row.binding_digest!==nativeAttentionBindingDigest(watch))throw Error('activity_native_source_integrity_failed');
 const lost=db.prepare('SELECT * FROM activity_attention_native_coverage_lost WHERE watch_id=?').get(watch.watchId) as {watch_id:string;enrollment_incarnation:string;event_key:string;digest:string}|undefined;
 if(lost&&(lost.enrollment_incarnation!==row.enrollment_incarnation||lost.digest!==hash([lost.watch_id,lost.enrollment_incarnation,lost.event_key])))throw Error('activity_native_source_integrity_failed');
 return Object.freeze({watchId:row.watch_id,enrollmentIncarnation:row.enrollment_incarnation,bindingDigest:row.binding_digest,reference:Object.freeze(reference),coverageLost:Boolean(lost)});
}
export function markNativeAttentionCoverageLostLocked(db:DatabaseSync,watch:WorkWatch,eventKey:string):void {
 const enrollment=readNativeAttentionEnrollment(db,watch);if(!enrollment||enrollment.coverageLost)return;
 if(!db.prepare('SELECT 1 FROM source_events e JOIN watch_event_receipts r ON e.event_key=r.event_key WHERE r.watch_id=? AND e.event_key=?').get(watch.watchId,eventKey))throw Error('activity_native_source_receipt_missing');
 db.prepare('INSERT INTO activity_attention_native_coverage_lost VALUES(?,?,?,?)').run(watch.watchId,enrollment.enrollmentIncarnation,eventKey,hash([watch.watchId,enrollment.enrollmentIncarnation,eventKey]));
}
export function markNativeAttentionCoverageUnknownLocked(db:DatabaseSync,watch:WorkWatch,kind:'gap'|'snapshot'|'schema_invalid',observation:unknown):void {
 const enrollment=readNativeAttentionEnrollment(db,watch);if(!enrollment||enrollment.coverageLost)return;
 const reference=kind+':'+hash(observation);
 db.prepare('INSERT INTO activity_attention_native_coverage_lost VALUES(?,?,?,?)').run(watch.watchId,enrollment.enrollmentIncarnation,reference,hash([watch.watchId,enrollment.enrollmentIncarnation,reference]));
}
/** Fixed metadata operation on the original connection, inside its original
 * transaction. The original source factory supplies verified owner facts. */
export function enrollNativeAttentionSourceLocked(db:DatabaseSync,watch:WorkWatch,raw:unknown):NativeAttentionEnrollment {
 const parsed=nativeAttentionReferenceSchema.safeParse(raw);if(!parsed.success)throw Error('activity_native_source_reference_invalid');const reference=parsed.data;
 if(watch.source!=='task_host'||watch.status!=='active'||reference.taskId!==watch.workId||reference.taskSessionId!==watch.sourceDataEpoch||reference.executionThreadId!==(watch.actualExecutionThreadId??watch.origin.threadId))throw Error('activity_native_source_binding_conflict');
 const old=readNativeAttentionEnrollment(db,watch);
 if(old){if(JSON.stringify(old.reference)!==JSON.stringify(reference))throw Error('activity_native_source_binding_conflict');return old;}
 const enrollmentIncarnation=randomUUID(),bindingDigest=nativeAttentionBindingDigest(watch),referenceJson=JSON.stringify(reference);
 db.exec('PRAGMA user_version=5');
 db.prepare('INSERT INTO activity_attention_native_sources VALUES(?,?,?,?,?,?)').run(watch.watchId,'codex_native_approval',enrollmentIncarnation,bindingDigest,referenceJson,hash([watch.watchId,enrollmentIncarnation,bindingDigest,referenceJson]));
 return readNativeAttentionEnrollment(db,watch)!;
}
