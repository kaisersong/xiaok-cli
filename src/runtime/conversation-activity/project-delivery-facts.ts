import {createHash,randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {z} from 'zod/v3';
import type {WorkWatch,WorkProjection} from './types.js';
import {projectActivityAttention} from './attention-projector.js';
import {createOrdinaryAttentionFacts} from './ordinary-attention-facts.js';
import {parseScopedProjectActivityPage} from './project-scoped-activity-data.js';
import {parseProjectDeliveryHeadData,type ProjectDeliveryHead} from './project-delivery-data.js';

// Original activity-connection metadata. This helper never grants a source
// capability, advances business state, performs HTTP or presents ready by itself.
export const PROJECT_DELIVERY_FACT_SQL=`
CREATE TABLE IF NOT EXISTS activity_project_delivery_namespaces(
 anchor_id TEXT PRIMARY KEY,namespace_id TEXT NOT NULL UNIQUE,profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 project_id TEXT NOT NULL,source_epoch TEXT NOT NULL,source_incarnation TEXT NOT NULL,binding_digest TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS activity_project_delivery_facts(
 anchor_id TEXT NOT NULL,source_incarnation TEXT NOT NULL,revision INTEGER NOT NULL,fact_id TEXT NOT NULL,
 record_digest TEXT NOT NULL,data_json TEXT NOT NULL,data_digest TEXT NOT NULL,
 PRIMARY KEY(anchor_id,source_incarnation,revision));
CREATE TABLE IF NOT EXISTS activity_project_delivery_heads(
 anchor_id TEXT PRIMARY KEY,source_incarnation TEXT NOT NULL,revision INTEGER NOT NULL,record_digest TEXT NOT NULL,
 FOREIGN KEY(anchor_id,source_incarnation,revision) REFERENCES activity_project_delivery_facts(anchor_id,source_incarnation,revision));
CREATE TABLE IF NOT EXISTS activity_project_delivery_witnesses(
 watch_id TEXT PRIMARY KEY,anchor_id TEXT NOT NULL,binding_digest TEXT NOT NULL,projection_digest TEXT NOT NULL,
 ordinary_fact_id TEXT NOT NULL,source_incarnation TEXT NOT NULL,revision INTEGER NOT NULL,record_digest TEXT NOT NULL,demand_id TEXT NOT NULL,
 FOREIGN KEY(anchor_id,source_incarnation,revision) REFERENCES activity_project_delivery_facts(anchor_id,source_incarnation,revision));
CREATE INDEX IF NOT EXISTS activity_project_delivery_witness_anchor ON activity_project_delivery_witnesses(anchor_id);
${['namespaces','facts'].map(table=>`
CREATE TRIGGER IF NOT EXISTS activity_project_delivery_${table}_update BEFORE UPDATE ON activity_project_delivery_${table} BEGIN SELECT RAISE(ABORT,'project_delivery_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_project_delivery_${table}_delete BEFORE DELETE ON activity_project_delivery_${table} BEGIN SELECT RAISE(ABORT,'project_delivery_immutable'); END;`).join('')}
CREATE TRIGGER IF NOT EXISTS activity_project_delivery_namespace_insert BEFORE INSERT ON activity_project_delivery_namespaces
 WHEN EXISTS(SELECT 1 FROM activity_project_delivery_namespaces WHERE anchor_id=NEW.anchor_id OR namespace_id=NEW.namespace_id)
 BEGIN SELECT RAISE(ABORT,'project_delivery_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_project_delivery_fact_insert BEFORE INSERT ON activity_project_delivery_facts
 WHEN EXISTS(SELECT 1 FROM activity_project_delivery_facts WHERE anchor_id=NEW.anchor_id AND source_incarnation=NEW.source_incarnation AND revision=NEW.revision)
 BEGIN SELECT RAISE(ABORT,'project_delivery_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_project_delivery_head_delete BEFORE DELETE ON activity_project_delivery_heads BEGIN SELECT RAISE(ABORT,'project_delivery_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_project_delivery_head_insert BEFORE INSERT ON activity_project_delivery_heads
 WHEN EXISTS(SELECT 1 FROM activity_project_delivery_heads WHERE anchor_id=NEW.anchor_id)
 BEGIN SELECT RAISE(ABORT,'project_delivery_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_project_delivery_head_update BEFORE UPDATE ON activity_project_delivery_heads
 WHEN NEW.anchor_id IS NOT OLD.anchor_id OR NEW.source_incarnation IS NOT OLD.source_incarnation OR NEW.revision<=OLD.revision
 BEGIN SELECT RAISE(ABORT,'project_delivery_immutable'); END;
`;
const key=z.string().min(1).max(256),digest=z.string().regex(/^[a-f0-9]{64}$/),uuid=z.string().uuid(),revision=z.number().int().positive().safe();
const namespaceSchema=z.object({anchor_id:key,namespace_id:uuid,profile_id:key,workspace_id:key,project_id:key,source_epoch:key,source_incarnation:uuid,binding_digest:digest}).strict();
const headSchema=z.object({anchor_id:key,source_incarnation:uuid,revision,record_digest:digest}).strict();
const factSchema=headSchema.extend({fact_id:key,data_json:z.string().max(65536),data_digest:digest}).strict();
const witnessSchema=z.object({watch_id:key,anchor_id:key,binding_digest:digest,projection_digest:digest,ordinary_fact_id:key,source_incarnation:uuid,revision,record_digest:digest,demand_id:uuid}).strict();
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const binding=(watch:WorkWatch)=>sha(JSON.stringify([watch.watchId,watch.operationId,watch.source,watch.logicalSourceId,watch.sourceDataEpoch,watch.workId,watch.runId??'',watch.actualExecutionThreadId??'',watch.generation,watch.status,
 watch.origin.profileId,watch.origin.workspaceId,watch.origin.threadId,watch.origin.actorId]));
interface SourceContext {watch:WorkWatch;projection:WorkProjection;members:Array<{watch:WorkWatch;deleted:number}>;membershipDigest:string}

/** Any surviving reserved row prevents damaged storage becoming legacy. */
export function hasProjectDeliveryLineage(db:DatabaseSync,anchorId:string):boolean{
 return Boolean(db.prepare(`SELECT 1 FROM activity_project_delivery_namespaces WHERE anchor_id=?
  UNION ALL SELECT 1 FROM activity_project_delivery_heads WHERE anchor_id=?
  UNION ALL SELECT 1 FROM activity_project_delivery_facts WHERE anchor_id=?
  UNION ALL SELECT 1 FROM activity_project_delivery_witnesses WHERE anchor_id=? LIMIT 1`).get(anchorId,anchorId,anchorId,anchorId));
}

/** Both calls run under the ORIGINAL store transaction. `source` is its fixed
 * full-membership query, never a caller-supplied DTO or RPC callback. Source
 * authority/currentness and presentation CAS remain above this data helper. */
export function createProjectDeliveryFacts(db:DatabaseSync,source:(watchId:string)=>SourceContext){
 const ordinary=createOrdinaryAttentionFacts(db);
 function context(watchId:string){
  if(typeof watchId!=='string')throw Error('project_delivery_source_unverified');key.parse(watchId);
  const state=source(watchId),watch=state.watch;if(watch.source!=='kswarm'||watch.status!=='active')throw Error('project_delivery_source_unverified');
  const anchorId=projectActivityAttention(watch,state.projection).anchorFactId;
  const members=state.members.filter(member=>!member.deleted&&member.watch.status==='active');if(!members.length)throw Error('project_delivery_source_unverified');
  return{...state,anchorId,members};
 }
 function current(state:ReturnType<typeof context>){
  const raw=db.prepare('SELECT * FROM activity_project_delivery_namespaces WHERE anchor_id=?').get(state.anchorId),namespace=raw?namespaceSchema.parse(raw):undefined;
  const row=db.prepare('SELECT * FROM activity_project_delivery_heads WHERE anchor_id=?').get(state.anchorId),head=row?headSchema.parse(row):undefined;
  if(!namespace&&!head){if(hasProjectDeliveryLineage(db,state.anchorId))throw Error('project_delivery_integrity_failed');return undefined;}
  if(!namespace||!head||namespace.profile_id!==state.watch.origin.profileId||namespace.workspace_id!==state.watch.origin.workspaceId||namespace.project_id!==state.watch.workId
    ||namespace.source_epoch!==state.watch.sourceDataEpoch||namespace.source_incarnation!==head.source_incarnation)throw Error('project_delivery_integrity_failed');
  const factRaw=db.prepare('SELECT * FROM activity_project_delivery_facts WHERE anchor_id=? AND source_incarnation=? AND revision=?').get(state.anchorId,head.source_incarnation,head.revision);
  if(!factRaw)throw Error('project_delivery_integrity_failed');const fact=factSchema.parse(factRaw);
  if(fact.data_digest!==sha(fact.data_json)||fact.record_digest!==head.record_digest)throw Error('project_delivery_integrity_failed');
  const value=parseProjectDeliveryHeadData(JSON.parse(fact.data_json),{projectId:state.watch.workId,sourceDataEpoch:state.watch.sourceDataEpoch});
  if(!value||value.incarnation!==head.source_incarnation||value.deliveryRevision!==head.revision||value.recordDigest!==head.record_digest||value.factId!==fact.fact_id)throw Error('project_delivery_integrity_failed');
  return{namespace,head,value};
 }
 function projection(watch:WorkWatch){
  const row=db.prepare('SELECT data_json FROM work_projections WHERE watch_id=?').get(watch.watchId) as{data_json:string}|undefined;
  if(!row)throw Error('project_delivery_source_unverified');const fact=ordinary.read(watch,row.data_json),data=JSON.parse(row.data_json) as WorkProjection;
  if(data.watchId!==watch.watchId||data.freshness!=='fresh')throw Error('project_delivery_source_unverified');return{bytes:row.data_json,fact,data};
 }
 function revoke(anchorId:string){
  db.prepare('DELETE FROM activity_project_delivery_witnesses WHERE anchor_id=?').run(anchorId);
  if(db.prepare('SELECT 1 FROM activity_project_delivery_witnesses WHERE anchor_id=? LIMIT 1').get(anchorId))throw Error('project_delivery_invalidation_conflict');
 }
 return Object.freeze({
  accept(watchId:string,raw:unknown,after:number,demandId:string){
   if(typeof demandId!=='string')throw Error('project_delivery_source_unverified');uuid.parse(demandId);const state=context(watchId),old=current(state),watch=state.watch;
   const body=parseScopedProjectActivityPage(raw,{projectId:watch.workId,sourceDataEpoch:watch.sourceDataEpoch,after,profileId:watch.origin.profileId,workspaceId:watch.origin.workspaceId});
   if(body.page.nextCursor!==body.page.headSeq)throw Error('project_delivery_coverage_incomplete');
   if(old&&old.namespace.binding_digest!==body.bindingDigest)throw Error('project_delivery_integrity_failed');
   if(body.page.delivery.status!=='current'){
    revoke(state.anchorId);return;
   }
   const head=body.page.delivery.head,data=JSON.stringify(head),dataDigest=sha(data);
   if(old&&(old.head.source_incarnation!==head.incarnation||head.deliveryRevision<old.head.revision))throw Error('project_delivery_revision_conflict');
   if(old&&head.deliveryRevision===old.head.revision&&(head.recordDigest!==old.head.record_digest||JSON.stringify(old.value)!==data))throw Error('project_delivery_revision_conflict');
   const members=state.members.map(member=>({watch:member.watch,...projection(member.watch)}));
   if(members.some(member=>member.watch.source!=='kswarm'||member.watch.workId!==watch.workId||member.watch.sourceDataEpoch!==watch.sourceDataEpoch||member.watch.origin.profileId!==watch.origin.profileId||member.watch.origin.workspaceId!==watch.origin.workspaceId||member.data.sourceSequence!==body.page.headSeq))throw Error('project_delivery_source_unverified');
   const changed=(result:{changes:number|bigint})=>{if(result.changes!==1&&result.changes!==1n)throw Error('project_delivery_write_conflict');};
   if(!old)changed(db.prepare('INSERT INTO activity_project_delivery_namespaces VALUES(?,?,?,?,?,?,?,?)').run(state.anchorId,randomUUID(),watch.origin.profileId,watch.origin.workspaceId,watch.workId,watch.sourceDataEpoch,head.incarnation,body.bindingDigest));
   if(!old||head.deliveryRevision>old.head.revision){
    changed(db.prepare('INSERT INTO activity_project_delivery_facts VALUES(?,?,?,?,?,?,?)').run(state.anchorId,head.incarnation,head.deliveryRevision,head.factId,head.recordDigest,data,dataDigest));
    if(old)changed(db.prepare('UPDATE activity_project_delivery_heads SET revision=?,record_digest=? WHERE anchor_id=? AND source_incarnation=? AND revision=?').run(head.deliveryRevision,head.recordDigest,state.anchorId,head.incarnation,old.head.revision));
    else changed(db.prepare('INSERT INTO activity_project_delivery_heads VALUES(?,?,?,?)').run(state.anchorId,head.incarnation,head.deliveryRevision,head.recordDigest));
   }
   for(const member of members)changed(db.prepare(`INSERT INTO activity_project_delivery_witnesses VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(watch_id) DO UPDATE SET
    anchor_id=excluded.anchor_id,binding_digest=excluded.binding_digest,projection_digest=excluded.projection_digest,ordinary_fact_id=excluded.ordinary_fact_id,
    source_incarnation=excluded.source_incarnation,revision=excluded.revision,record_digest=excluded.record_digest,demand_id=excluded.demand_id`)
    .run(member.watch.watchId,state.anchorId,binding(member.watch),sha(member.bytes),member.fact.factId,head.incarnation,head.deliveryRevision,head.recordDigest,demandId));
   if(source(watchId).membershipDigest!==state.membershipDigest)throw Error('project_delivery_source_conflict');
  },
  read(watchId:string,demandId:string){
   if(typeof demandId!=='string')throw Error('project_delivery_source_unverified');uuid.parse(demandId);const state=context(watchId),value=current(state);if(!value)return null;
   const witnesses=state.members.map(member=>{
    const raw=db.prepare('SELECT * FROM activity_project_delivery_witnesses WHERE watch_id=?').get(member.watch.watchId);
    if(!raw)throw Error('project_delivery_source_unverified');const witness=witnessSchema.parse(raw),actual=projection(member.watch);
    if(witness.anchor_id!==state.anchorId||witness.binding_digest!==binding(member.watch)||witness.projection_digest!==sha(actual.bytes)||witness.ordinary_fact_id!==actual.fact.factId||witness.demand_id!==demandId
      ||witness.source_incarnation!==value.head.source_incarnation||witness.revision!==value.head.revision||witness.record_digest!==value.head.record_digest)throw Error('project_delivery_source_unverified');
    return witness;
   });
   return{head:value.value,namespaceIncarnation:value.namespace.namespace_id,bindingDigest:value.namespace.binding_digest,membershipDigest:state.membershipDigest,witnessDigest:sha(JSON.stringify(witnesses.sort((a,b)=>a.watch_id<b.watch_id?-1:a.watch_id>b.watch_id?1:0)))};
  },
  invalidate(watchId:string){const state=context(watchId);revoke(state.anchorId);},
 });
}
