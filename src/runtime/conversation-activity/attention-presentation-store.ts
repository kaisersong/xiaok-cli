import {createHash,randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {z} from 'zod/v3';
import {ATTENTION_CATALOG_DIGEST,attentionFactSchema} from './attention-catalog.js';
import {projectWorkAttention,workAttentionSchema,type WorkAttention} from './attention-projector.js';
import {attentionInventorySchema,canonicalAttentionState,canonicalOrdinaryAttentionState,type AttentionCanonicalInventory} from './attention-canonical-state.js';
import {createOrdinaryAttentionFacts} from './ordinary-attention-facts.js';
import {reconcileNativeInventoryLocked} from './native-attention-reconciliation.js';
import {nativeTerminalInventoryLocked} from './native-attention-terminal.js';
import {createProjectDeliveryFacts,hasProjectDeliveryLineage} from './project-delivery-facts.js';

// Metadata on the ORIGINAL activity connection. This is not a business owner,
// source authority, permission store, scheduler or notification loop.
export const ATTENTION_PRESENTATION_SQL=`
CREATE TABLE IF NOT EXISTS activity_attention_namespaces(
 profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL,anchor_id TEXT NOT NULL,incarnation TEXT NOT NULL UNIQUE,
 PRIMARY KEY(profile_id,workspace_id,anchor_id));
CREATE TABLE IF NOT EXISTS activity_attention_heads(
 profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL,anchor_id TEXT NOT NULL,
 incarnation TEXT NOT NULL UNIQUE,version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version>=1 AND version<=9007199254740991),
 source_digest TEXT NOT NULL,membership_digest TEXT NOT NULL,body_digest TEXT NOT NULL,
 dismissed_version INTEGER NOT NULL CHECK(dismissed_version=0 OR dismissed_version=version),
 PRIMARY KEY(profile_id,workspace_id,anchor_id),
 FOREIGN KEY(profile_id,workspace_id,anchor_id) REFERENCES activity_attention_namespaces(profile_id,workspace_id,anchor_id));
CREATE TABLE IF NOT EXISTS activity_attention_bodies(
 profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL,anchor_id TEXT NOT NULL,data_json TEXT NOT NULL,
 PRIMARY KEY(profile_id,workspace_id,anchor_id),
 FOREIGN KEY(profile_id,workspace_id,anchor_id) REFERENCES activity_attention_heads(profile_id,workspace_id,anchor_id));
CREATE INDEX IF NOT EXISTS activity_attention_membership ON work_watches(profile_id,
 json_extract(data_json,'$.origin.workspaceId'),json_extract(data_json,'$.source'),json_extract(data_json,'$.logicalSourceId'),
 json_extract(data_json,'$.sourceDataEpoch'),json_extract(data_json,'$.workId'),COALESCE(json_extract(data_json,'$.runId'),''));
CREATE TRIGGER IF NOT EXISTS activity_attention_namespace_delete BEFORE DELETE ON activity_attention_namespaces
 BEGIN SELECT RAISE(ABORT,'attention_namespace_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_attention_namespace_update BEFORE UPDATE ON activity_attention_namespaces
 BEGIN SELECT RAISE(ABORT,'attention_namespace_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_attention_namespace_insert BEFORE INSERT ON activity_attention_namespaces
 WHEN EXISTS(SELECT 1 FROM activity_attention_namespaces WHERE (profile_id=NEW.profile_id AND workspace_id=NEW.workspace_id AND anchor_id=NEW.anchor_id) OR incarnation=NEW.incarnation)
 BEGIN SELECT RAISE(ABORT,'attention_namespace_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_attention_head_delete BEFORE DELETE ON activity_attention_heads
 BEGIN SELECT RAISE(ABORT,'attention_head_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_attention_head_insert BEFORE INSERT ON activity_attention_heads
 WHEN EXISTS(SELECT 1 FROM activity_attention_heads WHERE (profile_id=NEW.profile_id AND workspace_id=NEW.workspace_id AND anchor_id=NEW.anchor_id) OR incarnation=NEW.incarnation)
 BEGIN SELECT RAISE(ABORT,'attention_head_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_attention_head_update BEFORE UPDATE ON activity_attention_heads
 WHEN NEW.profile_id IS NOT OLD.profile_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.anchor_id IS NOT OLD.anchor_id
 OR NEW.incarnation IS NOT OLD.incarnation
 OR NOT ((NEW.version=OLD.version AND NEW.source_digest=OLD.source_digest AND NEW.dismissed_version>=OLD.dismissed_version)
 OR (NEW.version=OLD.version+1 AND NEW.source_digest IS NOT OLD.source_digest AND NEW.dismissed_version=0))
 BEGIN SELECT RAISE(ABORT,'attention_head_immutable'); END;
`;
const key=z.string().min(1).max(256),revision=z.number().int().nonnegative().safe(),digestSchema=z.string().regex(/^[a-f0-9]{64}$/),incarnationSchema=z.string().uuid();
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const originSchema=z.object({profileId:key,workspaceId:key,threadId:key,actorId:key}).strict();
const watchSchema=z.object({operationId:key,watchId:key,source:z.enum(['kswarm','task_host','agent_group','mcp']),logicalSourceId:key,sourceDataEpoch:key,workId:key,
 runId:z.string().max(256).optional(),actualExecutionThreadId:key.optional(),origin:originSchema,status:z.enum(['active','stopped']),generation:revision,
 preference:z.enum(['normal','critical_only','quiet']),policyRevision:revision,nextReportDueAt:z.number().finite()}).strict();
const projectionSchema=z.object({watchId:key,executionState:z.enum(['accepted','queued','running','blocked','input_required','completed','failed','cancelled']),
 businessOutcome:z.enum(['unknown','success','error','cancelled']),freshness:z.enum(['fresh','reconnecting','stale','unavailable']),sourceSequence:revision,revision,
 lastProgressAt:z.number().nullable(),lastHeartbeatAt:z.number().nullable(),lastReportAt:z.number().nullable(),summary:z.string().optional(),errorCode:z.string().optional(),evidenceRefs:z.array(key).max(64)}).strict();
const headSchema=z.object({profile_id:key,workspace_id:key,anchor_id:key,incarnation:incarnationSchema,version:revision.refine(v=>v>0),source_digest:digestSchema,membership_digest:digestSchema,body_digest:digestSchema,dismissed_version:revision}).strict()
 .refine(v=>v.dismissed_version===0||v.dismissed_version===v.version);
const rebuildSchema=z.object({expectedMembershipDigest:digestSchema,expectedProjectionVersion:revision,expectedPresentationIncarnation:incarnationSchema.nullable(),
 sourceFacts:z.array(attentionFactSchema).max(512),questions:workAttentionSchema.shape.questions,deliveryStage:workAttentionSchema.shape.deliveryStage}).strict();
export type AttentionPresentationRebuild=z.infer<typeof rebuildSchema>;
const finalizeSchema=z.object({expectedMembershipDigest:digestSchema,expectedProjectionVersion:revision,expectedPresentationIncarnation:incarnationSchema.nullable(),
 inventories:z.array(attentionInventorySchema).max(512),dismiss:z.object({expectedProjectionVersion:revision,expectedPresentationIncarnation:incarnationSchema}).strict().optional()}).strict();
export type AttentionReadFinalization=z.infer<typeof finalizeSchema>;
const projectFinalizeSchema=finalizeSchema.omit({inventories:true}).extend({demandId:incarnationSchema}).strict();
export type ProjectAttentionFinalization=Omit<z.infer<typeof projectFinalizeSchema>,'demandId'>;
type Head=z.infer<typeof headSchema>;
export interface AttentionPresentationSnapshot {
 anchorFactId:string;presentationIncarnation:string;projectionVersion:number;dismissed:boolean;presentation:WorkAttention|null;
}

/** The only transaction callback is the original store's private primitive. */
export function createAttentionPresentationStore(db:DatabaseSync,transaction:<T>(action:()=>T)=>T){
 function source(watchId:string){
  key.parse(watchId);
  const row=db.prepare('SELECT data_json FROM work_watches WHERE watch_id=?').get(watchId) as {data_json:string}|undefined;
  if(!row)throw Error('activity_watch_not_found');const watch=watchSchema.parse(JSON.parse(row.data_json));
  if(watch.watchId!==watchId)throw Error('attention_source_identity_conflict');
  if(db.prepare('SELECT 1 FROM thread_tombstones WHERE profile_id=? AND thread_id=?').get(watch.origin.profileId,watch.origin.threadId))throw Error('activity_thread_deleted');
  const projectionRow=db.prepare('SELECT data_json FROM work_projections WHERE watch_id=?').get(watchId) as {data_json:string}|undefined;
  if(!projectionRow)throw Error('attention_source_unavailable');const projection=projectionSchema.parse(JSON.parse(projectionRow.data_json));
  if(projection.watchId!==watchId)throw Error('attention_source_identity_conflict');
  const anchor={kind:'activity' as const,source:watch.source,logicalSourceId:watch.logicalSourceId,sourceDataEpoch:watch.sourceDataEpoch,workId:watch.workId,runId:watch.runId??''};
  const base={schemaVersion:1 as const,scope:{profileId:watch.origin.profileId,workspaceId:watch.origin.workspaceId},anchor,workRef:watch.workId,
   factRevision:projection.revision,projectionVersion:0,executionState:watch.status==='stopped'?'cancelled':projection.executionState,
   watchStopped:watch.status==='stopped',freshness:projection.freshness,sourceFacts:[],questions:[],deliveryStage:'none'};
  const anchorId=projectWorkAttention(base).anchorFactId;
  // Full native membership, not just revisions of the caller's previous list.
  // Schema4 old writers do not know a new membership counter, so read actual
  // original watch/projection rows in the final original transaction instead.
  const rows=db.prepare(`SELECT w.watch_id,w.data_json AS watch_json,p.data_json AS projection_json,json_extract(p.data_json,'$.revision') AS source_revision,json_extract(p.data_json,'$.watchId') AS projection_watch_id,
   EXISTS(SELECT 1 FROM thread_tombstones t WHERE t.profile_id=w.profile_id AND t.thread_id=w.thread_id) AS deleted
   FROM work_watches w LEFT JOIN work_projections p ON p.watch_id=w.watch_id WHERE w.profile_id=?
   AND json_extract(w.data_json,'$.origin.workspaceId')=? AND json_extract(w.data_json,'$.source')=? AND json_extract(w.data_json,'$.logicalSourceId')=?
   AND json_extract(w.data_json,'$.sourceDataEpoch')=? AND json_extract(w.data_json,'$.workId')=? AND COALESCE(json_extract(w.data_json,'$.runId'),'')=? LIMIT 513`)
   .all(watch.origin.profileId,watch.origin.workspaceId,watch.source,watch.logicalSourceId,watch.sourceDataEpoch,watch.workId,watch.runId??'') as Array<{watch_id:string;watch_json:string;projection_json:string;source_revision:unknown;projection_watch_id:unknown;deleted:number}>;
  if(rows.length>512||rows.reduce((n,row)=>n+Buffer.byteLength(row.watch_json,'utf8'),0)>2*1024*1024)throw Error('attention_membership_capacity_exceeded');
  const members=rows.map(row=>{const item=watchSchema.parse(JSON.parse(row.watch_json));
    if(item.watchId!==row.watch_id||row.projection_watch_id!==item.watchId||item.origin.profileId!==watch.origin.profileId)throw Error('attention_source_identity_conflict');
    return {watch:item,sourceRevision:revision.parse(row.source_revision),projectionDigest:hash(row.projection_json),deleted:row.deleted};})
   .sort((a,b)=>compare(a.watch.watchId,b.watch.watchId));
  return {watch,projection,members,base,anchorId,membershipDigest:hash(members),ids:[watch.origin.profileId,watch.origin.workspaceId,anchorId]};
 }
 function head(ids:string[]):Head|null{
  const namespace=db.prepare('SELECT incarnation FROM activity_attention_namespaces WHERE profile_id=? AND workspace_id=? AND anchor_id=?').get(...ids) as {incarnation:string}|undefined;
  const row=db.prepare('SELECT * FROM activity_attention_heads WHERE profile_id=? AND workspace_id=? AND anchor_id=?').get(...ids);
  if(Boolean(namespace)!==Boolean(row))throw Error('attention_head_integrity_failed');
  if(!row)return null;const value=headSchema.parse(row);
  if(value.incarnation!==namespace?.incarnation)throw Error('attention_head_integrity_failed');return value;
 }
 function snapshot(current:Head):AttentionPresentationSnapshot{
  const row=db.prepare('SELECT data_json FROM activity_attention_bodies WHERE profile_id=? AND workspace_id=? AND anchor_id=?').get(current.profile_id,current.workspace_id,current.anchor_id) as {data_json:string}|undefined;
  if(row&&createHash('sha256').update(row.data_json).digest('hex')!==current.body_digest)throw Error('attention_cache_integrity_failed');
  const presentation=row?workAttentionSchema.parse(JSON.parse(row.data_json)):null;
  if(presentation&&(presentation.anchorFactId!==current.anchor_id||presentation.projectionVersion!==current.version))throw Error('attention_cache_integrity_failed');
  return {anchorFactId:current.anchor_id,presentationIncarnation:current.incarnation,projectionVersion:current.version,dismissed:current.dismissed_version===current.version,presentation};
 }
 function rebuildLocked(watchId:string,input:AttentionPresentationRebuild,canonicalRef?:{factId:string;revision:number},aggregate?:{executionState:z.infer<typeof projectionSchema>['executionState'];freshness:z.infer<typeof projectionSchema>['freshness']},sourceIdentity?:unknown){
   const state=source(watchId),current=head(state.ids);
   if(state.membershipDigest!==input.expectedMembershipDigest)throw Error('attention_source_conflict');
   if((current?.version??0)!==input.expectedProjectionVersion||(current?.incarnation??null)!==input.expectedPresentationIncarnation)throw Error('attention_projection_conflict');
   const calculated=projectWorkAttention({...state.base,...aggregate,sourceFacts:input.sourceFacts,questions:input.questions,deliveryStage:input.deliveryStage});
   if(canonicalRef){calculated.factRevision=canonicalRef.revision;calculated.sourceSetDigest=hash([calculated.sourceSetDigest,canonicalRef]);}
   if(sourceIdentity!==undefined)calculated.sourceSetDigest=hash([calculated.sourceSetDigest,sourceIdentity]);
   const sourceDigest=hash(['attention-cache-v1',ATTENTION_CATALOG_DIGEST,calculated.sourceSetDigest]);
   const changed=!current||current.source_digest!==sourceDigest,version=changed?(current?.version??0)+1:current.version;
   if(!Number.isSafeInteger(version))throw Error('attention_version_exhausted');
   const presentation={...calculated,projectionVersion:version},data=JSON.stringify(presentation);
   if(Buffer.byteLength(data,'utf8')>256*1024)throw Error('attention_capacity_exceeded');
   const incarnation=current?.incarnation??randomUUID(),dismissed=current&&!changed?current.dismissed_version:0,bodyDigest=createHash('sha256').update(data).digest('hex');
   if(current){const updated=db.prepare('UPDATE activity_attention_heads SET version=?,source_digest=?,membership_digest=?,body_digest=?,dismissed_version=? WHERE profile_id=? AND workspace_id=? AND anchor_id=? AND version=? AND incarnation=?')
    .run(version,sourceDigest,state.membershipDigest,bodyDigest,dismissed,...state.ids,current.version,current.incarnation);
    if(updated.changes!==1)throw Error('attention_projection_conflict');}
   else{if(db.prepare('INSERT INTO activity_attention_namespaces VALUES(?,?,?,?)').run(...state.ids,incarnation).changes!==1)throw Error('attention_projection_conflict');
    if(db.prepare('INSERT INTO activity_attention_heads VALUES(?,?,?,?,?,?,?,?,?)').run(...state.ids,incarnation,version,sourceDigest,state.membershipDigest,bodyDigest,dismissed).changes!==1)throw Error('attention_projection_conflict');}
   if(db.prepare('INSERT INTO activity_attention_bodies VALUES(?,?,?,?) ON CONFLICT(profile_id,workspace_id,anchor_id) DO UPDATE SET data_json=excluded.data_json').run(...state.ids,data).changes!==1)throw Error('attention_projection_conflict');
   return snapshot(head(state.ids)!);
 }
 function dismissLocked(watchId:string,expectedVersion:number,expectedIncarnation:string){
   const state=source(watchId),current=head(state.ids);
   if(!current||current.version!==expectedVersion||current.incarnation!==expectedIncarnation)throw Error('attention_projection_conflict');
   if(current.membership_digest!==state.membershipDigest)throw Error('attention_source_conflict');
   const updated=db.prepare('UPDATE activity_attention_heads SET dismissed_version=version WHERE profile_id=? AND workspace_id=? AND anchor_id=? AND version=? AND incarnation=?').run(...state.ids,expectedVersion,expectedIncarnation);
   if(updated.changes!==1)throw Error('attention_projection_conflict');return snapshot(head(state.ids)!);
 }
 function assertGenericProject(state:ReturnType<typeof source>){
  if(state.watch.source==='kswarm'&&hasProjectDeliveryLineage(db,state.anchorId))throw Error('project_delivery_source_required');
 }
 return Object.freeze({
  captureRead(watchId:string){return transaction(()=>{const state=source(watchId),current=head(state.ids);return {watch:state.watch,projection:state.projection,members:state.members,
   membershipDigest:state.membershipDigest,projectionVersion:current?.version??0,presentationIncarnation:current?.incarnation??null};});},
  sourceSnapshot(watchId:string){return transaction(()=>{const state=source(watchId),current=head(state.ids);return {membershipDigest:state.membershipDigest,sourceRevision:state.projection.revision,projectionVersion:current?.version??0,presentationIncarnation:current?.incarnation??null};});},
  read(watchId:string){return transaction(()=>{const state=source(watchId),current=head(state.ids);if(current&&current.membership_digest!==state.membershipDigest)throw Error('attention_source_conflict');return current?snapshot(current):null;});},
  readHead(watchId:string){return transaction(()=>{const state=source(watchId);return head(state.ids);});},
  rebuild(watchId:string,raw:AttentionPresentationRebuild){const input=rebuildSchema.parse(raw);return transaction(()=>{assertGenericProject(source(watchId));return rebuildLocked(watchId,input);});},
  dismiss(watchId:string,expectedVersion:number,expectedIncarnation:string){revision.parse(expectedVersion);incarnationSchema.parse(expectedIncarnation);return transaction(()=>{assertGenericProject(source(watchId));return dismissLocked(watchId,expectedVersion,expectedIncarnation);});},
  finalizeProjectRead(watchId:string,raw:z.infer<typeof projectFinalizeSchema>){const input=projectFinalizeSchema.parse(raw);return transaction(()=>{
   const state=source(watchId),current=head(state.ids);
   if(state.watch.source!=='kswarm'||state.watch.status!=='active')throw Error('project_delivery_source_unverified');
   if(state.membershipDigest!==input.expectedMembershipDigest)throw Error('attention_source_conflict');
   if((current?.version??0)!==input.expectedProjectionVersion||(current?.incarnation??null)!==input.expectedPresentationIncarnation)throw Error('attention_projection_conflict');
   const delivery=createProjectDeliveryFacts(db,source).read(watchId,input.demandId);if(!delivery)throw Error('project_delivery_source_unverified');
   const members=state.members.filter(member=>!member.deleted&&member.watch.status==='active'),ordinary=createOrdinaryAttentionFacts(db);
   const facts=members.map(member=>{
    const row=db.prepare('SELECT data_json FROM work_projections WHERE watch_id=?').get(member.watch.watchId) as{data_json:string}|undefined;
    if(!row)throw Error('project_delivery_source_unverified');return ordinary.read(member.watch,row.data_json);
   });
   const canonical=canonicalOrdinaryAttentionState(db,state.anchorId,facts),deliveryHead=delivery.head;
   const diagnostics=deliveryHead.core.diagnostics.map(reasonCode=>({profile:'activity' as const,schemaVersion:1,factId:deliveryHead.factId,revision:deliveryHead.deliveryRevision,reasonCode,evidenceRefs:[deliveryHead.factId]}));
   const readyFacts=deliveryHead.core.stage==='ready_for_acceptance'?[{profile:'activity' as const,schemaVersion:1,factId:deliveryHead.factId,revision:deliveryHead.deliveryRevision,reasonCode:'ordinary_ready',evidenceRefs:[deliveryHead.factId]}]:[];
   const freshness=deliveryHead.core.stage==='unavailable'?'unavailable' as const:'fresh' as const;
   let result=rebuildLocked(watchId,{expectedMembershipDigest:state.membershipDigest,expectedProjectionVersion:input.expectedProjectionVersion,expectedPresentationIncarnation:input.expectedPresentationIncarnation,
    sourceFacts:[...canonical.sourceFacts,...diagnostics,...readyFacts],questions:[],deliveryStage:deliveryHead.core.stage==='ready_for_acceptance'?'ready_for_acceptance':'none'},canonical.canonicalRef,
    {executionState:facts[0].executionState,freshness},[delivery.namespaceIncarnation,deliveryHead.incarnation,deliveryHead.deliveryRevision,deliveryHead.factId,deliveryHead.recordDigest,delivery.bindingDigest]);
   let dismissConflict=false;
   if(input.dismiss){dismissConflict=result.projectionVersion!==input.dismiss.expectedProjectionVersion||result.presentationIncarnation!==input.dismiss.expectedPresentationIncarnation;
    if(!dismissConflict)result=dismissLocked(watchId,input.dismiss.expectedProjectionVersion,input.dismiss.expectedPresentationIncarnation);}
   return{view:{watch:state.watch,projection:state.projection,presentation:result.presentation!},presentationIncarnation:result.presentationIncarnation,projectionVersion:result.projectionVersion,dismissed:result.dismissed,dismissConflict,
    membershipDigest:state.membershipDigest,witnessDigest:delivery.witnessDigest};
  });},
  finalizeRead(watchId:string,raw:AttentionReadFinalization){const input=finalizeSchema.parse(raw);return transaction(()=>{
   const state=source(watchId),current=head(state.ids);
   assertGenericProject(state);
   if(state.watch.status!=='active')throw Error('attention_source_unverified');
   if(state.membershipDigest!==input.expectedMembershipDigest)throw Error('attention_source_conflict');
   if((current?.version??0)!==input.expectedProjectionVersion||(current?.incarnation??null)!==input.expectedPresentationIncarnation)throw Error('attention_projection_conflict');
   const members=state.members.filter(member=>!member.deleted&&member.watch.status==='active'),inventories:AttentionCanonicalInventory[]=[...input.inventories];
   for(const member of members)if(member.watch.source==='task_host'){
    const row=db.prepare('SELECT data_json FROM work_projections WHERE watch_id=?').get(member.watch.watchId) as {data_json:string};
    const terminal=nativeTerminalInventoryLocked(db,member.watch,projectionSchema.parse(JSON.parse(row.data_json)));
    if(terminal){if(inventories.some(item=>item.watchId===member.watch.watchId))throw Error('attention_inventory_source_conflict');inventories.push(terminal);}
   }
   const inventoryByWatch=new Map(inventories.map(item=>[item.watchId,item]));
   if(inventoryByWatch.size!==inventories.length||inventoryByWatch.size!==members.length||members.some(member=>!inventoryByWatch.has(member.watch.watchId)))throw Error('attention_inventory_incomplete');
   const first=inventories[0];if(!first)throw Error('attention_inventory_incomplete');
   const inventoryCore=(item:typeof first)=>hash([item.taskStatus,item.businessOutcome,[...item.questions].sort((a,b)=>compare(a.inputId,b.inputId)),
    'sourceKind'in item?item.sourceKind==='codex_native_approval'?[item.sourceKind,item.reference,item.inventoryRevision,item.inventoryDigest]:[item.sourceKind,item.reference,item.terminalReceipt.eventKey]:['mcp_task']]);
   if(inventories.some(item=>inventoryCore(item)!==inventoryCore(first)))throw Error('attention_inventory_source_conflict');
   const ordinary=createOrdinaryAttentionFacts(db);
   for(const member of members){
    const inventory=inventoryByWatch.get(member.watch.watchId)!;
    if('sourceKind'in inventory&&inventory.sourceKind==='codex_native_approval'){
     const row=db.prepare('SELECT data_json FROM work_projections WHERE watch_id=?').get(member.watch.watchId) as {data_json:string}|undefined;
     if(!row||member.watch.source!=='task_host')throw Error('attention_source_unverified');
     ordinary.read(member.watch,row.data_json);
     reconcileNativeInventoryLocked(db,member.watch,projectionSchema.parse(JSON.parse(row.data_json)),inventory);
    }
   }
   // The caller's old CAS was checked before any writes. This fresh membership
   // contains only this transaction's already-validated fixed Native delta.
   const after=source(watchId),projections:z.infer<typeof projectionSchema>[]=[],facts=members.map(member=>{
    const row=db.prepare('SELECT data_json FROM work_projections WHERE watch_id=?').get(member.watch.watchId) as {data_json:string}|undefined;
    const inventory=inventoryByWatch.get(member.watch.watchId)!;
    if(!row||member.watch.source!=='mcp'&&!('sourceKind'in inventory))throw Error('attention_source_unverified');projections.push(projectionSchema.parse(JSON.parse(row.data_json)));return ordinary.read(member.watch,row.data_json);
   });
   const canonical=canonicalAttentionState(db,state.anchorId,facts,first);
   const freshnessRank={fresh:0,reconnecting:1,stale:2,unavailable:3},aggregateFreshness=projections.reduce((result,item)=>freshnessRank[item.freshness]>freshnessRank[result]?item.freshness:result,'fresh' as z.infer<typeof projectionSchema>['freshness']);
   let result=rebuildLocked(watchId,{expectedMembershipDigest:after.membershipDigest,expectedProjectionVersion:input.expectedProjectionVersion,expectedPresentationIncarnation:input.expectedPresentationIncarnation,
    sourceFacts:canonical.sourceFacts,questions:canonical.questions,deliveryStage:'none'},canonical.canonicalRef,{executionState:facts[0].executionState,freshness:aggregateFreshness}),dismissConflict=false;
   if(input.dismiss){
    dismissConflict=result.projectionVersion!==input.dismiss.expectedProjectionVersion||result.presentationIncarnation!==input.dismiss.expectedPresentationIncarnation;
    if(!dismissConflict)result=dismissLocked(watchId,input.dismiss.expectedProjectionVersion,input.dismiss.expectedPresentationIncarnation);
   }
   return {view:{watch:after.watch,projection:after.projection,presentation:result.presentation!},presentationIncarnation:result.presentationIncarnation,dismissed:result.dismissed,dismissConflict};
  });},
  clearBody(watchId:string,expectedIncarnation:string){incarnationSchema.parse(expectedIncarnation);return transaction(()=>{const state=source(watchId),current=head(state.ids);
   if(!current||current.incarnation!==expectedIncarnation)throw Error('attention_projection_conflict');
   db.prepare('DELETE FROM activity_attention_bodies WHERE profile_id=? AND workspace_id=? AND anchor_id=?').run(...state.ids);
  });},
 });
}
