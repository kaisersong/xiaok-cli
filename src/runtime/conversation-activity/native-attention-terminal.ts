import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {z} from 'zod/v3';
import type {WorkWatch,WorkProjection} from './types.js';
import type {NativeTerminalAttentionInventory} from './native-attention-inventory-data.js';
import {readNativeAttentionEnrollment} from './native-attention-source.js';
import {createOrdinaryAttentionFacts} from './ordinary-attention-facts.js';
import {parseCapturedSourceJson} from '../verification/captured-source-json.js';
const key=z.string().min(1).max(256),integer=z.number().int().nonnegative().safe();
const terminalEventSchema=z.object({schemaVersion:z.literal(1),eventId:key,source:z.literal('task_host'),logicalSourceId:key,sourceDataEpoch:key,workId:key,runId:z.string().max(256).optional(),sourceSequence:integer.positive(),
 sourceRevision:z.string().optional(),kind:z.enum(['completed','failed','cancelled']),occurredAt:integer.optional(),businessOutcome:z.enum(['unknown','success','error','cancelled']).optional(),summary:z.string().optional(),evidenceRefs:z.array(key).max(64),executionStarted:z.boolean().optional()}).strict();
/** Only the original verified event and this watch's own receipt can close a
 * terminal Native presentation. Idle/disconnection/snapshot is not this proof. */
export function nativeTerminalInventoryLocked(db:DatabaseSync,watch:WorkWatch,projection:WorkProjection):NativeTerminalAttentionInventory|null {
 const enrollment=readNativeAttentionEnrollment(db,watch);if(!enrollment||!['completed','failed','cancelled'].includes(projection.executionState))return null;
 const bytes=(db.prepare('SELECT data_json FROM work_projections WHERE watch_id=?').get(watch.watchId) as {data_json:string}).data_json;
 const fact=createOrdinaryAttentionFacts(db).read(watch,bytes);if(fact.sourceRef.kind!=='event')throw Error('attention_native_terminal_unverified');
 const row=db.prepare('SELECT e.content_json FROM source_events e JOIN watch_event_receipts r ON e.event_key=r.event_key WHERE r.watch_id=? AND e.event_key=?').get(watch.watchId,fact.sourceRef.id) as {content_json:string}|undefined;
 if(!row||Buffer.byteLength(row.content_json,'utf8')>16*1024)throw Error('attention_native_terminal_unverified');
 const parsed=terminalEventSchema.safeParse(parseCapturedSourceJson(row.content_json));if(!parsed.success)throw Error('attention_native_terminal_unverified');const event=parsed.data;
 const eventKey=createHash('sha256').update(JSON.stringify([event.source,event.logicalSourceId,event.sourceDataEpoch,event.workId,event.runId??'',event.eventId])).digest('hex');
 const outcome=event.kind==='completed'?(event.businessOutcome??'success'):event.kind==='failed'?'error':'cancelled';
 const cursor=db.prepare('SELECT sequence FROM source_cursors WHERE watch_id=?').get(watch.watchId) as {sequence:number}|undefined;
 if(eventKey!==fact.sourceRef.id||event.logicalSourceId!==watch.logicalSourceId||event.sourceDataEpoch!==watch.sourceDataEpoch||event.workId!==watch.workId||(event.runId??'')!==(watch.runId??'')
  ||!cursor||event.sourceSequence>cursor.sequence||event.sourceSequence>projection.sourceSequence||event.kind!==projection.executionState||event.kind!==fact.executionState||outcome!==fact.businessOutcome||outcome!==projection.businessOutcome||outcome==='unknown')throw Error('attention_native_terminal_unverified');
 return {sourceKind:'codex_native_terminal',watchId:watch.watchId,readerIncarnation:enrollment.reference.nativeIncarnation,reference:enrollment.reference,enrollmentIncarnation:enrollment.enrollmentIncarnation,bindingDigest:enrollment.bindingDigest,
  taskStatus:event.kind,businessOutcome:outcome,questions:[],terminalReceipt:{factId:fact.factId,revision:fact.revision,eventKey}};
}
