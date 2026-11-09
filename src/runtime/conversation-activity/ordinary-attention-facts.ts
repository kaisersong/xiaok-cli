import {createHash,randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {z} from 'zod/v3';
import type {WorkEvent,WorkProjection,WorkWatch} from './types.js';
import {nativeInventorySnapshotSchema,type NativeInventorySnapshot} from './native-attention-inventory-data.js';

// Presentation evidence in the original activity transaction, not execution authority.
export const ORDINARY_ATTENTION_FACT_SQL=`
CREATE TABLE IF NOT EXISTS activity_state_facts(
 watch_id TEXT NOT NULL,incarnation TEXT NOT NULL,revision INTEGER NOT NULL,
 fact_digest TEXT NOT NULL,data_json TEXT NOT NULL,PRIMARY KEY(watch_id,revision));
CREATE TABLE IF NOT EXISTS activity_state_heads(
 watch_id TEXT PRIMARY KEY,incarnation TEXT NOT NULL UNIQUE,revision INTEGER NOT NULL,
 binding_digest TEXT NOT NULL,projection_digest TEXT NOT NULL,fact_digest TEXT NOT NULL,
 FOREIGN KEY(watch_id,revision) REFERENCES activity_state_facts(watch_id,revision));
CREATE TRIGGER IF NOT EXISTS activity_state_fact_insert BEFORE INSERT ON activity_state_facts
 WHEN EXISTS(SELECT 1 FROM activity_state_facts WHERE watch_id=NEW.watch_id AND revision=NEW.revision)
 BEGIN SELECT RAISE(ABORT,'attention_fact_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_state_fact_update BEFORE UPDATE ON activity_state_facts
 BEGIN SELECT RAISE(ABORT,'attention_fact_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_state_fact_delete BEFORE DELETE ON activity_state_facts
 BEGIN SELECT RAISE(ABORT,'attention_fact_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_state_head_insert BEFORE INSERT ON activity_state_heads
 WHEN NEW.revision<>1 OR EXISTS(SELECT 1 FROM activity_state_heads WHERE watch_id=NEW.watch_id OR incarnation=NEW.incarnation)
 BEGIN SELECT RAISE(ABORT,'attention_fact_head_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_state_head_delete BEFORE DELETE ON activity_state_heads
 BEGIN SELECT RAISE(ABORT,'attention_fact_head_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_state_head_update BEFORE UPDATE ON activity_state_heads
 WHEN NEW.watch_id IS NOT OLD.watch_id OR NEW.incarnation IS NOT OLD.incarnation OR NEW.binding_digest IS NOT OLD.binding_digest
 OR NOT ((NEW.revision=OLD.revision AND NEW.fact_digest=OLD.fact_digest)
 OR (NEW.revision=OLD.revision+1 AND NEW.fact_digest<>OLD.fact_digest
 AND EXISTS(SELECT 1 FROM activity_state_facts f WHERE f.watch_id=NEW.watch_id AND f.incarnation=NEW.incarnation AND f.revision=NEW.revision AND f.fact_digest=NEW.fact_digest)))
 BEGIN SELECT RAISE(ABORT,'attention_fact_head_immutable'); END;
`;
const key=z.string().min(1).max(256),digest=z.string().regex(/^[a-f0-9]{64}$/),revision=z.number().int().positive().safe();
const coreSchema=z.object({executionState:z.enum(['accepted','queued','running','blocked','input_required','completed','failed','cancelled']),
 businessOutcome:z.enum(['unknown','success','error','cancelled'])}).strict();
type StateCore=z.infer<typeof coreSchema>;
export type OrdinaryStateWitness = {kind:'bind'|'event'|'snapshot';id:string;core:StateCore;invalidatesNativeOwnership?:true}
 |{kind:'native_inventory';id:string;core:StateCore;native:NativeInventorySnapshot;invalidatesNativeOwnership?:never};
const factV1Schema=coreSchema.extend({schemaVersion:z.literal(1),watchId:key,factId:key,incarnation:z.string().uuid(),revision,bindingDigest:digest,
 sourceRef:z.object({kind:z.enum(['bind','event','snapshot']),id:key}).strict()}).strict();
const factV2Schema=coreSchema.extend({schemaVersion:z.literal(2),watchId:key,factId:key,incarnation:z.string().uuid(),revision,bindingDigest:digest,
 sourceRef:z.object({kind:z.literal('native_inventory'),id:key,native:nativeInventorySnapshotSchema}).strict()}).strict().superRefine((value,context)=>{
 if(!['running','input_required'].includes(value.executionState)||value.businessOutcome!=='unknown'||(value.executionState==='input_required')!==(value.sourceRef.native.questions.length>0))context.addIssue({code:z.ZodIssueCode.custom,message:'attention_native_fact_invalid'});
});
const factSchema=z.union([factV1Schema,factV2Schema]);
export type OrdinaryStateFact=z.infer<typeof factSchema>;
export {factSchema as ordinaryStateFactSchema};
const headSchema=z.object({watch_id:key,incarnation:z.string().uuid(),revision,binding_digest:digest,projection_digest:digest,fact_digest:digest}).strict();
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const core=(projection:Pick<WorkProjection,'executionState'|'businessOutcome'>):StateCore=>coreSchema.parse({executionState:projection.executionState,
 businessOutcome:projection.executionState==='completed'?projection.businessOutcome:projection.executionState==='failed'?'error':projection.executionState==='cancelled'?'cancelled':'unknown'});
const binding=(watch:WorkWatch)=>hash(JSON.stringify([watch.watchId,watch.operationId,watch.source,watch.logicalSourceId,watch.sourceDataEpoch,watch.workId,watch.runId??'',watch.actualExecutionThreadId??'',
 watch.origin.profileId,watch.origin.workspaceId,watch.origin.threadId,watch.origin.actorId]));

/** Independent source semantics, never inferred backwards from the final
 * projection (which may preserve an older terminal latch). */
export function ordinaryEventWitness(event:WorkEvent,watch:WorkWatch,eventKey:string):Exclude<OrdinaryStateWitness,{kind:'native_inventory'}>|undefined{
 let state:WorkProjection['executionState']|undefined;
 if(event.kind==='started')state='running';
 else if(['accepted','blocked','input_required','completed','failed','cancelled'].includes(event.kind))state=event.kind as WorkProjection['executionState'];
 else if(watch.source==='mcp'&&event.kind==='progress'||watch.source==='kswarm'&&event.executionStarted===true)state='running';
 if(watch.source==='kswarm'&&state==='accepted'&&event.executionStarted===true)state='running';
 return state?{kind:'event',id:eventKey,core:core({executionState:state,businessOutcome:event.businessOutcome??(state==='completed'?'success':'unknown')})}:undefined;
}

export function createOrdinaryAttentionFacts(db:DatabaseSync){
 function current(watch:WorkWatch){
  const raw=db.prepare('SELECT * FROM activity_state_heads WHERE watch_id=?').get(watch.watchId);
  if(!raw){if(db.prepare('SELECT 1 FROM activity_state_facts WHERE watch_id=? LIMIT 1').get(watch.watchId))throw Error('attention_fact_head_integrity_failed');return null;}
  const head=headSchema.parse(raw),row=db.prepare('SELECT data_json,fact_digest FROM activity_state_facts WHERE watch_id=? AND revision=?').get(watch.watchId,head.revision) as {data_json:string;fact_digest:string}|undefined;
  if(!row||hash(row.data_json)!==head.fact_digest||row.fact_digest!==head.fact_digest)throw Error('attention_fact_integrity_failed');
  const fact=factSchema.parse(JSON.parse(row.data_json));
  if(fact.watchId!==watch.watchId||fact.incarnation!==head.incarnation||fact.revision!==head.revision||fact.bindingDigest!==head.binding_digest||binding(watch)!==head.binding_digest)throw Error('attention_fact_integrity_failed');
  return {head,fact};
 }
 return Object.freeze({
  advance(watch:WorkWatch,previousBytes:string|null,next:WorkProjection,witness?:OrdinaryStateWitness|false){
   const existing=current(watch),verified=Boolean(existing&&previousBytes&&existing.head.projection_digest===hash(previousBytes)),nextCore=core(next);
   if(witness===false)return;
   // An incomplete/noise update cannot heal an old writer's missing witness.
   if(witness){if(JSON.stringify(coreSchema.parse(witness.core))!==JSON.stringify(nextCore))return;}
   else if(!verified||JSON.stringify(core(existing!.fact))!==JSON.stringify(nextCore))return;
   const nativeChanged=witness&&witness.kind==='native_inventory'&&(existing?.fact.schemaVersion!==2||JSON.stringify(existing.fact.sourceRef.native)!==JSON.stringify(witness.native));
   const changed=!existing||!verified||JSON.stringify(core(existing.fact))!==JSON.stringify(nextCore)||Boolean(nativeChanged)||Boolean(witness&&witness.invalidatesNativeOwnership);
   if(changed&&!witness)return;
   const nextRevision=changed?(existing?.head.revision??0)+1:existing!.head.revision;
   if(!Number.isSafeInteger(nextRevision))throw Error('attention_fact_version_exhausted');
   const incarnation=existing?.head.incarnation??randomUUID(),bindingDigest=binding(watch),projectionDigest=hash(JSON.stringify(next));
   let factDigest=existing?.head.fact_digest;
   if(changed){
    const source=witness!;
    const fact=factSchema.parse({...nextCore,schemaVersion:source.kind==='native_inventory'?2:1,watchId:watch.watchId,incarnation,revision:nextRevision,bindingDigest,
     factId:`ordinary-state:${incarnation}:${nextRevision}`,sourceRef:source.kind==='native_inventory'?{kind:source.kind,id:source.id,native:source.native}:{kind:source.kind,id:source.id}}),data=JSON.stringify(fact);factDigest=hash(data);
    db.prepare('INSERT INTO activity_state_facts VALUES(?,?,?,?,?)').run(watch.watchId,incarnation,nextRevision,factDigest,data);
   }
   if(existing){const result=db.prepare('UPDATE activity_state_heads SET revision=?,projection_digest=?,fact_digest=? WHERE watch_id=? AND revision=? AND incarnation=?')
    .run(nextRevision,projectionDigest,factDigest!,watch.watchId,existing.head.revision,incarnation);if(result.changes!==1)throw Error('attention_fact_conflict');}
   else db.prepare('INSERT INTO activity_state_heads VALUES(?,?,?,?,?,?)').run(watch.watchId,incarnation,nextRevision,bindingDigest,projectionDigest,factDigest!);
  },
  read(watch:WorkWatch,projectionBytes:string):OrdinaryStateFact{
   const existing=current(watch);if(!existing||existing.head.projection_digest!==hash(projectionBytes))throw Error('attention_source_unverified');return existing.fact;
  },
 });
}
